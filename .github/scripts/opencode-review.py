"""Collect GitHub context for the OpenCode reviewer without giving it a token."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys


def api(endpoint, *flags):
    result = subprocess.run(
        ["gh", "api", *flags, endpoint], stdout=subprocess.PIPE, check=False
    )
    return json.loads(result.stdout) if result.returncode == 0 else None


def discussion(endpoint):
    pages = api(f"{endpoint}?per_page=100", "--paginate", "--slurp")
    if pages is None:
        return None
    return [
        {
            "author": (comment["user"] or {}).get("login"),
            "author_type": (comment["user"] or {}).get("type"),
            "author_association": comment["author_association"],
            "body": comment["body"],
            "url": comment["html_url"],
            **(
                {"path": comment["path"], "line": comment.get("line")}
                if "path" in comment
                else {}
            ),
        }
        for page in pages
        for comment in page
    ]


def issue_references(text, repo):
    # A link label can contain an unrelated number, such as "Actions run #123".
    text = re.sub(r"\[[^\]\n]*\]\(([^)\n]*)\)", r"\1", text)
    escaped_repo = re.escape(repo)
    pattern = (
        rf"https://github\.com/{escaped_repo}/issues/(?P<link>[1-9][0-9]*)\b"
        rf"|(?<![\w/#-])(?:{escaped_repo})?#(?P<short>[1-9][0-9]*)\b"
    )
    return list(dict.fromkeys(
        match["link"] or match["short"]
        for match in re.finditer(pattern, text, flags=re.IGNORECASE)
    ))


def linked_issue(repository, number):
    endpoint = f"{repository}/issues/{number}"
    issue = api(endpoint)
    if issue is None or "pull_request" in issue:
        return {"number": number, "issue_available": False}
    return {
        "number": number,
        "title": issue["title"],
        "body": issue["body"],
        "url": issue["html_url"],
        "author": (issue["user"] or {}).get("login"),
        "comments": discussion(f"{endpoint}/comments"),
    }


def check_runs(repository, sha):
    result = api(f"{repository}/commits/{sha}/check-runs")
    if result is None:
        return None
    return [
        {key: run[key] for key in ("name", "status", "conclusion", "details_url")}
        for run in result["check_runs"]
    ]


def main():
    pr_file, merge_sha = sys.argv[1:]
    pr = json.loads(Path(pr_file).read_text(encoding="utf-8"))
    repo = os.environ["GH_REPO"]
    repository = f"repos/{repo}"
    number = pr["number"]
    head_sha = pr["head"]["sha"]
    references = issue_references(f"{pr['title']}\n{pr['body'] or ''}", repo)
    status = api(f"{repository}/commits/{head_sha}/status")
    quality = api(
        f"{repository}/actions/workflows/quality.yml/runs?head_sha={head_sha}&per_page=10"
    )
    context = {
        "pull_request": {
            "title": pr["title"],
            "body": pr["body"],
            "author": pr["user"]["login"],
            "head_sha": head_sha,
            "merge_sha": merge_sha,
            "comments": discussion(f"{repository}/issues/{number}/comments"),
            "review_comments": discussion(f"{repository}/pulls/{number}/comments"),
        },
        "linked_issues": [linked_issue(repository, ref) for ref in references[:20]],
        "additional_issue_references": references[20:],
        "ci_snapshot": {
            "head_checks": check_runs(repository, head_sha),
            "merge_checks": check_runs(repository, merge_sha),
            "head_commit_statuses": None if status is None else [
                {key: item[key] for key in ("context", "state", "target_url")}
                for item in status["statuses"]
            ],
            "quality_runs_for_head": None if quality is None else [
                {key: run[key] for key in ("event", "status", "conclusion", "html_url")}
                for run in quality["workflow_runs"]
            ],
        },
    }
    print(json.dumps(context, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
