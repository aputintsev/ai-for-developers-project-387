"""Render and publish the OpenCode issue drafts approved in GitHub comments."""

import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess

DRAFT_PREFIX = "<!-- opencode-issue-draft "
LABEL = "ready-for-agent"
MAX_DRAFT_BYTES = 60_000


def validate(draft):
    if draft["skill"] not in {"to-spec", "to-tickets"}:
        raise ValueError("Unsupported skill")
    if type(draft["source"]) is not int or draft["source"] < 1:
        raise ValueError("Invalid source issue")
    items = draft["items"]
    limit = 1 if draft["skill"] == "to-spec" else 12
    if not isinstance(items, list) or not 1 <= len(items) <= limit:
        raise ValueError("Invalid number of issues")
    for index, item in enumerate(items, start=1):
        title, body, blockers = item["title"], item["body"], item["blocked_by"]
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200 or "\n" in title or "<!--" in title:
            raise ValueError(f"Invalid title for item {index}")
        if not isinstance(body, str) or not 1 <= len(body.strip()) <= 8000 or "<!--" in body:
            raise ValueError(f"Invalid body for item {index}")
        if not isinstance(blockers, list) or any(
            type(blocker) is not int or blocker not in range(1, index) for blocker in blockers
        ) or (draft["skill"] == "to-spec" and blockers) or len(set(blockers)) != len(blockers):
            raise ValueError(f"Item {index} must reference distinct earlier blockers")


def render(draft):
    validate(draft)
    lines = [f"## OpenCode draft · {draft['skill']}", "", f"Source issue #{draft['source']}"]
    for index, item in enumerate(draft["items"], start=1):
        blockers = ", ".join(map(str, item["blocked_by"])) or "None"
        lines.extend(["", f"### {index}. {item['title']}", "", f"Blocked by draft items: {blockers}", "", item["body"]])
    encoded = base64.b64encode(json.dumps(draft, ensure_ascii=False, separators=(",", ":")).encode()).decode()
    if draft.get("review_testing") is True:
        lines.extend(["", "Review Testing Decisions. Reply in this discussion to approve the draft for publication or request changes."])
    lines.extend(["", "After review, the owner can publish this exact draft with `/oc skill publish <comment ID>`.",
                  "", f"{DRAFT_PREFIX}{encoded} -->"])
    result = "\n".join(lines) + "\n"
    if len(result.encode()) > MAX_DRAFT_BYTES:
        raise ValueError(f"Draft exceeds the {MAX_DRAFT_BYTES}-byte reply limit")
    return result


def gh(*args, data=None):
    options = ["--method", "POST", "--input", "-"] if data is not None else []
    output = subprocess.check_output(
        ["gh", "api", *options, *args],
        input=json.dumps(data).encode() if data is not None else None,
    )
    return json.loads(output)


def paginate(endpoint):
    return [item for page in gh("--paginate", "--slurp", endpoint) for item in page]


def bot_authored(item):
    return item["user"]["login"] == "github-actions[bot]" and item["user"]["type"] == "Bot"


def ensure_label(root):
    endpoint = f"{root}/labels?per_page=100"

    def exists():
        return any(label["name"].casefold() == LABEL for label in paginate(endpoint))

    if not exists():
        try:
            gh(f"{root}/labels", data={"name": LABEL, "color": "0E8A16", "description": "Ready for an agent"})
        except subprocess.CalledProcessError:
            if not exists():
                raise


def read_draft(body):
    body = body.rstrip("\n")
    marker = body.splitlines()[-1] if body else ""
    match = re.fullmatch(re.escape(DRAFT_PREFIX) + r"([A-Za-z0-9+/=]+) -->", marker)
    if not match:
        raise ValueError("No OpenCode draft found in the approved comment")
    draft = json.loads(base64.b64decode(match[1], validate=True))
    if render(draft).rstrip("\n") != body:
        raise ValueError("Draft data differs from the displayed proposal")
    return draft


def pending_spec(comments, approval):
    published = set()
    for comment in comments:
        if bot_authored(comment) and comment["body"].startswith("## Published OpenCode issues\n"):
            published.update(re.findall(r"^<!-- opencode-published-summary:([0-9]+) -->$", comment["body"], re.MULTILINE))
    for comment in reversed(comments):
        if not bot_authored(comment):
            continue
        if not comment["body"].startswith("## OpenCode draft · to-spec\n"):
            continue
        if (comment["id"] < approval and str(comment["id"]) not in published
                and read_draft(comment["body"])["skill"] == "to-spec"):
            return comment["id"]
        break
    return None


def publish(repo, thread, comment_id):
    root = f"repos/{repo}"
    comment = gh(f"{root}/issues/comments/{comment_id}")
    expected_issue = f"{os.environ['GITHUB_API_URL']}/{root}/issues/{thread}"
    if not bot_authored(comment) or comment["issue_url"] != expected_issue:
        raise ValueError("Expected a bot draft in this discussion")
    draft = read_draft(comment["body"])
    source = draft["source"]
    if "pull_request" in gh(f"{root}/issues/{source}"):
        raise ValueError("Draft source must be an issue")

    ensure_label(root)

    prefix = f"<!-- opencode-published:{comment_id}:"
    existing = {}
    for issue in paginate(f"{root}/issues?state=all&per_page=100"):
        if "pull_request" in issue or not bot_authored(issue):
            continue
        for line in (issue["body"] or "").splitlines():
            match = re.fullmatch(re.escape(prefix) + r"([0-9]+) -->", line)
            if match:
                index = int(match[1])
                if index in existing:
                    raise ValueError(f"Duplicate published issue for draft item {index}")
                existing[index] = issue

    published = {}
    for index, item in enumerate(draft["items"], start=1):
        issue = existing.get(index)
        if issue is None:
            issue = gh(f"{root}/issues", data={
                "title": item["title"],
                "body": f"{item['body'].rstrip()}\n\n{prefix}{index} -->",
                "labels": [LABEL],
            })
        published[index] = issue
        if draft["skill"] == "to-tickets":
            children = f"{root}/issues/{source}/sub_issues"
            if not any(child["id"] == issue["id"] for child in paginate(f"{children}?per_page=100")):
                gh(children, data={"sub_issue_id": issue["id"]})
            dependencies = f"{root}/issues/{issue['number']}/dependencies/blocked_by"
            if item["blocked_by"]:
                linked = {blocker["id"] for blocker in paginate(f"{dependencies}?per_page=100")}
                for blocker in item["blocked_by"]:
                    blocker_id = published[blocker]["id"]
                    if blocker_id not in linked:
                        gh(dependencies, data={"issue_id": blocker_id})

    summary = "\n".join(f"- {issue['html_url']}" for issue in published.values())
    comments = f"{root}/issues/{thread}/comments"
    summary_marker = f"<!-- opencode-published-summary:{comment_id} -->"
    if not any(
        bot_authored(comment) and summary_marker in comment["body"].splitlines()
        for comment in paginate(f"{comments}?per_page=100")
    ):
        gh(comments, data={"body": f"## Published OpenCode issues\n\n{summary}\n\n{summary_marker}"})
    print(summary)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    draft = commands.add_parser("draft")
    draft.add_argument("skill", choices=["to-spec", "to-tickets"])
    draft.add_argument("source", type=int)
    draft.add_argument("output", type=Path)
    draft.add_argument("--title", help="Source issue title for a to-spec draft")
    pending = commands.add_parser("pending-spec")
    pending.add_argument("comments", type=Path)
    pending.add_argument("approval", type=int)
    apply = commands.add_parser("publish")
    apply.add_argument("repo")
    apply.add_argument("thread", type=int)
    apply.add_argument("comment_id", type=int)
    args = parser.parse_args()
    if args.command == "draft":
        raw = args.output.read_text().strip()
        try:
            if args.skill == "to-spec":
                if args.title is None:
                    raise ValueError("Source issue title is required for to-spec")
                fenced = re.fullmatch(r"```(?:markdown|md)?\n(.*)\n```", raw, flags=re.DOTALL)
                body = fenced[1] if fenced else raw
                items = [{"title": args.title.strip(), "body": body.strip(), "blocked_by": []}]
            else:
                fenced = re.fullmatch(r"```(?:json)?\n(.*)\n```", raw, flags=re.DOTALL)
                items = json.loads(fenced[1] if fenced else raw)["items"]
            draft_data = {"skill": args.skill, "source": args.source, "items": items}
            if args.skill == "to-spec":
                draft_data["review_testing"] = True
            result = render(draft_data)
        except json.JSONDecodeError as error:
            parser.exit(1, f"OpenCode draft is not valid JSON (line {error.lineno}, column {error.colno}).\n")
        except ValueError as error:
            parser.exit(1, f"Invalid OpenCode draft: {error}.\n")
        except (KeyError, TypeError):
            parser.exit(1, "OpenCode draft does not match the required issue format.\n")
        print(result, end="")
    elif args.command == "pending-spec":
        comment_id = pending_spec(json.loads(args.comments.read_text()), args.approval)
        if comment_id is not None:
            print(comment_id)
    else:
        publish(args.repo, args.thread, args.comment_id)


if __name__ == "__main__":
    main()
