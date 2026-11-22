import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


module_spec = importlib.util.spec_from_file_location(
    "opencode_issues", Path(__file__).with_name("opencode-issues.py")
)
issues = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(issues)


class ImplementationContextTests(unittest.TestCase):
    def setUp(self):
        self.repo = "owner/repo"
        self.root = f"repos/{self.repo}/issues"
        self.event = {"issue": {"number": 14}, "comment": {"html_url": "approval-url"}}
        self.bot = {"login": "github-actions[bot]", "type": "Bot"}
        self.records = {
            number: {
                "number": number, "state": "open", "labels": [{"name": issues.LABEL}],
                "title": f"Issue {number}", "body": "",
                "html_url": f"https://github.com/{self.repo}/issues/{number}",
                "url": f"https://api.github.com/{self.root}/{number}", "user": self.bot,
            }
            for number in (14, 21, 23, 24)
        }
        self.records[21]["body"] = "Specification\n\n<!-- opencode-published:123:1 -->"
        self.records[23]["body"] = "## Parent\n\nPart of #14 (утверждённая спека: #21)."
        self.records[24]["body"] = "## Parent\n\nЧасть #14 (спецификация: #21)."
        self.comment = {
            "user": self.bot, "issue_url": self.records[14]["url"],
            "body": issues.render({
                "skill": "to-spec", "source": 14,
                "items": [{"title": "Approved spec", "body": "Specification", "blocked_by": []}],
            }),
        }
        self.pages = {
            f"{self.root}/14/comments?per_page=100": [
                dict(self.comment, id=123),
                {"id": 124, "user": self.bot, "body": (
                    f"## Published OpenCode issues\n\n- {self.records[21]['html_url']}\n\n"
                    "<!-- opencode-published-summary:123 -->"
                )},
                {"id": 125, "user": self.bot, "body": (
                    f"## Published OpenCode issues\n\n- {self.records[23]['html_url']}\n\n"
                    "<!-- opencode-published-summary:999 -->"
                )},
            ],
            f"{self.root}/14/sub_issues?per_page=100": [self.records[23], self.records[24]],
            f"{self.root}/21/sub_issues?per_page=100": [],
            f"{self.root}/23/dependencies/blocked_by?per_page=100": [
                {"number": 4, "state": "closed"}
            ],
            f"{self.root}/24/dependencies/blocked_by?per_page=100": [
                {"number": 23, "state": "open"}
            ],
        }
        self.mock_gh = self.enterContext(patch.object(issues, "gh", side_effect=self.github_record))
        self.enterContext(patch.object(issues, "paginate", side_effect=self.pages.__getitem__))

    def github_record(self, endpoint):
        if endpoint == f"{self.root}/comments/123":
            return self.comment
        return self.records[int(endpoint.rsplit("/", 1)[1])]

    def load(self, tickets=(23, 24)):
        return issues.implementation_context(self.repo, self.event, 21, tickets)

    def test_valid_scope_and_cli(self):
        with tempfile.TemporaryDirectory() as folder:
            event = Path(folder) / "event.json"
            event.write_text(json.dumps(self.event))
            args = ["opencode-issues.py", "implementation-context", self.repo, str(event), "21", "23", "24"]
            stdout = io.StringIO()
            with patch("sys.argv", args), contextlib.redirect_stdout(stdout):
                issues.main()
        context = json.loads(stdout.getvalue())
        self.assertEqual(context["specification"]["number"], 21)
        self.assertTrue(context["close_specification"])
        self.assertEqual([ticket["blocked_by"] for ticket in context["tickets"]], [[], [23]])
        self.assertEqual(context["owner_approval"], "approval-url")

    def run_implementation_request(self, command):
        with tempfile.TemporaryDirectory() as folder:
            event = Path(folder) / "event.json"
            event.write_text(json.dumps(self.event))
            request = Path(folder) / "request.json"
            request.write_text(json.dumps({"body": command}))
            args = ["opencode-issues.py", "implementation-context", self.repo, str(event),
                    "--request", str(request)]
            stdout = io.StringIO()
            with patch("sys.argv", args), contextlib.redirect_stdout(stdout):
                issues.main()
        return json.loads(stdout.getvalue())

    def test_implementation_request_preserves_explicit_tickets(self):
        for command in ("skill implement-spec #21 #23", "skill implement-spec: #21 #23"):
            with self.subTest(command=command):
                context = self.run_implementation_request(command)
                self.assertEqual(context["specification"]["number"], 21)
                self.assertEqual([ticket["number"] for ticket in context["tickets"]], [23])

    def test_implementation_request_discovers_scope_for_short_command_or_explanation(self):
        for command in ("skill implement-spec", "skill implement-spec - выполни спецификацию",
                        "skill implement-spec: подготовь черновик PR", "skill implement-spec #21"):
            with self.subTest(command=command):
                context = self.run_implementation_request(command)
                self.assertEqual(context["specification"]["number"], 21)
                self.assertEqual([ticket["number"] for ticket in context["tickets"]], [23, 24])

    def test_implementation_request_rejects_numbers_mixed_with_explanation(self):
        for command in ("skill implement-spec: #21 #23 и подготовь PR",
                        "skill implement-spec - выполни только #23", "skill implement-spec #21 #0"):
            with self.subTest(command=command):
                stderr = io.StringIO()
                with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as error:
                    self.run_implementation_request(command)
                self.assertEqual(error.exception.code, 1)
                self.assertIn("Use /oc skill implement-spec", stderr.getvalue())
        self.mock_gh.assert_not_called()

    def test_rejects_duplicates_before_github_calls(self):
        with self.assertRaisesRegex(ValueError, "distinct"):
            self.load((23, 23))
        self.mock_gh.assert_not_called()

    def test_rejects_closed_issue_or_pull_request(self):
        self.records[21]["state"] = "closed"
        with self.assertRaisesRegex(ValueError, "open issue"):
            self.load()
        self.records[21]["state"] = "open"
        self.records[23]["pull_request"] = {}
        with self.assertRaisesRegex(ValueError, "open issue"):
            self.load()

    def test_requires_approved_label(self):
        self.records[23]["labels"] = []
        with self.assertRaisesRegex(ValueError, "ready-for-agent"):
            self.load()

    def test_rejects_unrelated_specification(self):
        self.comment["issue_url"] = f"https://api.github.com/{self.root}/99"
        with self.assertRaisesRegex(ValueError, "published from #14"):
            self.load()

    def test_requires_published_specification(self):
        self.records[21]["body"] = "A manually labelled issue"
        with self.assertRaisesRegex(ValueError, "published from #14"):
            self.load()

    def test_rejects_unrelated_ticket(self):
        with self.assertRaisesRegex(ValueError, "belong to specification"):
            self.load((30,))

    def test_rejects_ticket_for_another_specification_of_the_same_source(self):
        self.records[24]["body"] = "## Parent\n\nЧасть #14 (спецификация: #99).\n\n## Notes\n\nСпецификация: #21."
        with self.assertRaisesRegex(ValueError, "belong to specification #21"):
            self.load()
        self.assertTrue(self.load((23,))["close_specification"])

    def test_accepts_native_child_of_specification_without_legacy_text(self):
        self.records[24]["body"] = ""
        self.pages[f"{self.root}/14/sub_issues?per_page=100"] = [self.records[23]]
        self.pages[f"{self.root}/21/sub_issues?per_page=100"] = [self.records[24]]
        self.assertTrue(self.load()["close_specification"])

    def test_leaves_specification_open_when_other_tickets_are_open(self):
        self.assertFalse(self.load((23,))["close_specification"])
        self.records[24]["state"] = "closed"
        self.assertTrue(self.load((23,))["close_specification"])

    def test_discovers_specification_and_open_tickets(self):
        self.records[23]["state"] = "closed"
        self.pages[f"{self.root}/24/dependencies/blocked_by?per_page=100"][0]["state"] = "closed"
        context = issues.implementation_context(self.repo, self.event, None, [])
        self.assertEqual(context["specification"]["number"], 21)
        self.assertEqual([ticket["number"] for ticket in context["tickets"]], [24])

    def test_explicit_specification_discovers_tickets_without_reading_comments(self):
        del self.pages[f"{self.root}/14/comments?per_page=100"]
        context = self.load(())
        self.assertEqual([ticket["number"] for ticket in context["tickets"]], [23, 24])

    def test_multiple_open_specifications_require_explicit_selection(self):
        self.records[22] = dict(self.records[21], number=22)
        comments = self.pages[f"{self.root}/14/comments?per_page=100"]
        comments.extend([
            dict(self.comment, id=126),
            {"id": 127, "user": self.bot, "body": (
                f"## Published OpenCode issues\n\n- https://github.com/{self.repo}/issues/22\n\n"
                "<!-- opencode-published-summary:126 -->"
            )},
        ])
        with self.assertRaisesRegex(ValueError, "Multiple open specifications for #14: #21, #22"):
            issues.implementation_context(self.repo, self.event, None, [])
        self.records[22]["state"] = "closed"
        self.assertEqual(issues.implementation_context(self.repo, self.event, None, [])
                         ["specification"]["number"], 21)

    def test_without_published_specification_reports_how_to_continue(self):
        self.pages[f"{self.root}/14/comments?per_page=100"] = []
        with self.assertRaisesRegex(ValueError, "No open published specification for #14"):
            issues.implementation_context(self.repo, self.event, None, [])

    def test_rejects_open_blocker_outside_scope(self):
        with self.assertRaisesRegex(ValueError, "unresolved blockers"):
            self.load((24,))

    def test_pr_body_keeps_template_sections_even_if_agent_only_returns_summary(self):
        template = (Path(__file__).resolve().parents[1] / "pull_request_template.md").read_text()
        body = issues.implementation_pr_body(template, "Closes #23", "Summary", "abc123", "https://example.com/run")
        for line in ("## Change", "## Checks", "## Risk", "## Rollback", "Closes #23", "abc123", "git revert"):
            self.assertIn(line, body)

    def test_pr_body_keeps_only_workflow_checks(self):
        template = (Path(__file__).resolve().parents[1] / "pull_request_template.md").read_text()
        summary = "## Change\nSummary\n## CHECKS\nUnverified model claim\n## Risk\nActual risk"
        body = issues.implementation_pr_body(template, "Closes #23", summary, "abc123", "https://example.com/run")
        self.assertEqual(body.lower().count("## checks"), 1)
        self.assertNotIn("Unverified model claim", body)
        self.assertIn("Actual risk", body)
        self.assertIn("`mise run check` passed for `abc123`", body)
