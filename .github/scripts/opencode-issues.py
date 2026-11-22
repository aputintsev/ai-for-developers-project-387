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
LEGACY_REVIEW_NOTE = "Review the specification and confirm the proposed testing boundaries in Testing Decisions before publishing."
LEGACY_REPLY_REVIEW_NOTE = "Review Testing Decisions. Reply in this discussion to approve the draft for publication or request changes."
TICKETS_REVIEW_NOTE = "Review the proposed tickets and dependencies. Reply in this discussion to approve the draft for publication or request changes."


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


def render(draft, *, review_note=LEGACY_REPLY_REVIEW_NOTE):
    validate(draft)
    lines = [f"## OpenCode draft · {draft['skill']}", "", f"Source issue #{draft['source']}"]
    for index, item in enumerate(draft["items"], start=1):
        blockers = ", ".join(map(str, item["blocked_by"])) or "None"
        lines.extend(["", f"### {index}. {item['title']}", "", f"Blocked by draft items: {blockers}", "", item["body"]])
    encoded = base64.b64encode(json.dumps(draft, ensure_ascii=False, separators=(",", ":")).encode()).decode()
    if "review_note" in draft:
        lines.extend(["", draft["review_note"]])
    elif draft.get("review_testing") is True:
        lines.extend(["", review_note])
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


def read_ticket_items(raw):
    try:
        draft = json.loads(raw)
    except json.JSONDecodeError:
        blocks = re.findall(
            r"^[ \t]*```([^\n`]*)\n(.*?)^[ \t]*```[ \t]*$", raw, re.MULTILINE | re.DOTALL
        )
        candidates = [body for language, body in blocks if language.strip().casefold() in {"", "json"}]
        if len(candidates) > 1:
            raise ValueError("Expected a single JSON code block for the ticket draft")
        if not candidates:
            raise
        draft = json.loads(candidates[0])
    return draft["items"]


def paginate(endpoint):
    return [item for page in gh("--paginate", "--slurp", endpoint) for item in page]


def bot_authored(item):
    user = item.get("user") or {}
    return user.get("login") == "github-actions[bot]" and user.get("type") == "Bot"


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
    if render(draft).rstrip("\n") == body:
        return draft
    if ("review_note" not in draft and draft.get("review_testing") is True
            and render(draft, review_note=LEGACY_REVIEW_NOTE).rstrip("\n") == body):
        return draft
    raise ValueError("Draft data differs from the displayed proposal")


def pending_draft(comments, approval):
    published = set()
    for comment in comments:
        if bot_authored(comment) and comment["body"].startswith("## Published OpenCode issues\n"):
            published.update(re.findall(r"^<!-- opencode-published-summary:([0-9]+) -->$", comment["body"], re.MULTILINE))
    for comment in reversed(comments):
        if comment["id"] >= approval or not bot_authored(comment):
            continue
        if not comment["body"].startswith(("## OpenCode draft · to-spec\n", "## OpenCode draft · to-tickets\n")):
            continue
        if str(comment["id"]) not in published:
            read_draft(comment["body"])
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


def parent_specification(body):
    # Older ticket drafts named the specification in Parent and linked the
    # ticket to the source issue on GitHub.
    parent = re.search(r"^## Parent[ \t]*\n(.*?)(?=^## |\Z)", body or "", re.MULTILINE | re.DOTALL)
    if parent is None:
        return None
    references = set(re.findall(
        r"(?:\bspec(?:ification)?|\bспецификация|\bспека)\s*:\s*#([1-9][0-9]*)\b",
        parent[1], re.IGNORECASE
    ))
    return int(references.pop()) if len(references) == 1 else None


def implementation_references(command):
    prefix = re.fullmatch(r"skill implement-spec(.*)", command.strip(), flags=re.DOTALL)
    if prefix:
        suffix = prefix[1]
        explicit = re.fullmatch(r"(?:\s+|:\s*)(#[1-9][0-9]*(?:\s+#[1-9][0-9]*)*)", suffix)
        if explicit:
            spec, *tickets = (int(reference[1:]) for reference in explicit[1].split())
            return spec, tickets
        explanation = re.fullmatch(r"(?:\s+[-—]|:)\s+\S.*", suffix, flags=re.DOTALL)
        if not suffix or (explanation and not re.search(r"#[0-9]", suffix)):
            return None, []
    raise ValueError(
        "Use /oc skill implement-spec with an optional explanation, or "
        "/oc skill implement-spec #SPEC [#TICKET ...] with issue numbers only"
    )


def discover_specification(root, source):
    number = source["number"]
    comments = {
        str(comment["id"]): comment["body"]
        for comment in paginate(f"{root}/issues/{number}/comments?per_page=100")
        if bot_authored(comment) and comment.get("body")
    }
    issue_prefix = source["html_url"].rsplit("/", 1)[0]
    candidates = set()
    for body in comments.values():
        if not body.startswith("## Published OpenCode issues\n"):
            continue
        summary = re.search(r"^<!-- opencode-published-summary:([1-9][0-9]*) -->$", body, re.MULTILINE)
        draft_body = comments.get(summary[1], "") if summary else ""
        if not draft_body.startswith("## OpenCode draft · to-spec\n"):
            continue
        draft = read_draft(draft_body)
        if draft["source"] != number or draft["skill"] != "to-spec":
            continue
        published = re.findall(rf"^- {re.escape(issue_prefix)}/([1-9][0-9]*)$", body, re.MULTILINE)
        if len(published) == 1:
            candidates.add(int(published[0]))

    open_specs = []
    for candidate in sorted(candidates):
        issue = gh(f"{root}/issues/{candidate}")
        if issue["state"] == "open" and LABEL in {label["name"] for label in issue["labels"]}:
            open_specs.append(candidate)
    if len(open_specs) == 1:
        return open_specs[0]
    if open_specs:
        choices = ", ".join(f"#{spec}" for spec in open_specs)
        raise ValueError(f"Multiple open specifications for #{number}: {choices}. Use /oc skill implement-spec #SPEC")
    raise ValueError(f"No open published specification for #{number}. Publish one or use /oc skill implement-spec #SPEC")


def implementation_context(repo, event, spec_number, ticket_numbers):
    root = f"repos/{repo}"
    source = event["issue"]["number"]
    numbers = [source, spec_number, *ticket_numbers]
    if len(set(numbers)) != len(numbers):
        raise ValueError("Source, specification, and tickets must be distinct issues")

    def open_issue(number):
        issue = gh(f"{root}/issues/{number}")
        if "pull_request" in issue or issue["state"] != "open":
            raise ValueError(f"#{number} must be an open issue")
        if number != source and LABEL not in {label["name"] for label in issue["labels"]}:
            raise ValueError(f"#{number} must have the {LABEL} label")
        return issue

    original = open_issue(source)
    if spec_number is None:
        spec_number = discover_specification(root, original)
    spec = open_issue(spec_number)
    provenance = re.search(r"^<!-- opencode-published:([1-9][0-9]*):1 -->$", spec["body"] or "", re.MULTILINE)
    if not provenance or not bot_authored(spec):
        raise ValueError(f"#{spec_number} must be a specification published from #{source}")
    draft_comment = gh(f"{root}/issues/comments/{provenance[1]}")
    if not bot_authored(draft_comment) or draft_comment["issue_url"] != original["url"]:
        raise ValueError(f"#{spec_number} must be a specification published from #{source}")
    draft = read_draft(draft_comment["body"])
    if draft["skill"] != "to-spec" or draft["source"] != source:
        raise ValueError(f"#{spec_number} must be a specification published from #{source}")

    def issue_context(issue):
        return {key: issue[key] for key in ("number", "title", "body", "html_url")}

    linked = {
        issue["number"]: issue
        for issue in paginate(f"{root}/issues/{source}/sub_issues?per_page=100")
        if parent_specification(issue["body"]) == spec_number
    }
    linked.update({
        issue["number"]: issue
        for issue in paginate(f"{root}/issues/{spec_number}/sub_issues?per_page=100")
    })
    if not ticket_numbers:
        ticket_numbers = sorted(number for number, issue in linked.items() if issue["state"] == "open")
        if not ticket_numbers:
            raise ValueError(f"No open tickets for specification #{spec_number}")
    tickets = []
    for number in ticket_numbers:
        if number not in linked:
            raise ValueError(f"#{number} must belong to specification #{spec_number}")
        ticket = issue_context(open_issue(number))
        blockers = [
            item["number"]
            for item in paginate(f"{root}/issues/{number}/dependencies/blocked_by?per_page=100")
            if item["state"] == "open"
        ]
        if set(blockers) - set(ticket_numbers):
            raise ValueError(f"Include the unresolved blockers of #{number} in the command")
        ticket["blocked_by"] = blockers
        tickets.append(ticket)
    return {
        "source": issue_context(original),
        "specification": issue_context(spec),
        "close_specification": all(
            issue["state"] == "closed" or number in ticket_numbers
            for number, issue in linked.items()
        ),
        "tickets": tickets,
        "owner_approval": event["comment"]["html_url"],
    }


def implementation_pr_body(template, links, summary, sha, run_url):
    sections = re.split(r"^## (Change|Checks|Risk|Rollback)[ \t]*\r?$", summary,
                        flags=re.MULTILINE | re.IGNORECASE)
    content = {name.capitalize(): text for name, text in zip(sections[1::2], sections[2::2])}
    change = content.get("Change", sections[0]).strip() or "Implements the linked specification and tickets."
    risk = content.get("Risk", "").strip() or (
        "Users of the changed flow could encounter a regression. Review the affected behavior "
        "against the specification and the acceptance tests in the linked run."
    )
    rollback = content.get("Rollback", "").strip()
    rollback_steps = (
        "Revert the commit that introduced this change on the base branch "
        "(use `git revert -m 1 <merge-sha>` for a merge commit). "
        "Run `mise run check` and verify the previous behavior for the affected flow."
    )
    values = {
        "Change": f"{links.strip()}\n\n{change}",
        "Checks": f"`mise run check` passed for `{sha}`. [Actions run]({run_url}).",
        "Risk": risk,
        "Rollback": "\n\n".join(filter(None, (rollback, rollback_steps))),
    }
    return re.sub(r"^## (Change|Checks|Risk|Rollback)$",
                  lambda match: f"{match[0]}\n\n{values[match[1]]}",
                  template, flags=re.MULTILINE)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    draft = commands.add_parser("draft")
    draft.add_argument("skill", choices=["to-spec", "to-tickets"])
    draft.add_argument("source", type=int)
    draft.add_argument("output", type=Path)
    draft.add_argument("--title", help="Source issue title for a to-spec draft")
    pending = commands.add_parser("pending-draft")
    pending.add_argument("comments", type=Path)
    pending.add_argument("approval", type=int)
    apply = commands.add_parser("publish")
    apply.add_argument("repo")
    apply.add_argument("thread", type=int)
    apply.add_argument("comment_id", type=int)
    implementation = commands.add_parser("implementation-context")
    implementation.add_argument("repo")
    implementation.add_argument("event", type=Path)
    implementation.add_argument("spec", nargs="?", type=int)
    implementation.add_argument("tickets", nargs="*", type=int)
    implementation.add_argument("--request", type=Path)
    pr_body = commands.add_parser("implementation-pr-body")
    for name in ("template", "links", "summary"):
        pr_body.add_argument(name, type=Path)
    pr_body.add_argument("sha")
    pr_body.add_argument("run_url")
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
                items = read_ticket_items(raw)
            draft_data = {"skill": args.skill, "source": args.source, "items": items}
            draft_data["review_note"] = (
                LEGACY_REPLY_REVIEW_NOTE if args.skill == "to-spec" else TICKETS_REVIEW_NOTE
            )
            result = render(draft_data)
        except json.JSONDecodeError as error:
            parser.exit(1, f"OpenCode draft is not valid JSON (line {error.lineno}, column {error.colno}).\n")
        except ValueError as error:
            parser.exit(1, f"Invalid OpenCode draft: {error}.\n")
        except (KeyError, TypeError):
            parser.exit(1, "OpenCode draft does not match the required issue format.\n")
        print(result, end="")
    elif args.command == "pending-draft":
        comment_id = pending_draft(json.loads(args.comments.read_text()), args.approval)
        if comment_id is not None:
            print(comment_id)
    elif args.command == "implementation-context":
        try:
            spec, tickets = args.spec, args.tickets
            if args.request is not None:
                if spec is not None:
                    raise ValueError("Use either --request or explicit issue numbers")
                spec, tickets = implementation_references(json.loads(args.request.read_text())["body"])
            print(json.dumps(implementation_context(
                args.repo, json.loads(args.event.read_text()), spec, tickets
            ), ensure_ascii=False))
        except ValueError as error:
            parser.exit(1, f"{error}\n")
    elif args.command == "implementation-pr-body":
        print(implementation_pr_body(
            args.template.read_text(), args.links.read_text(), args.summary.read_text(),
            args.sha, args.run_url
        ), end="")
    else:
        publish(args.repo, args.thread, args.comment_id)


if __name__ == "__main__":
    main()
