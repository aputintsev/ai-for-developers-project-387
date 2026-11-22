import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
MOCK_COMMANDS = r"""
base64() {
  if [[ $* == '-w 0' ]]; then
    command base64 | tr -d '\n'
  else
    command base64 "$@"
  fi
}
gh() {
  case "$*" in
    'api repos/owner/repo/pulls/37') printf '%s\n' "$TEST_PR" ;;
    'api --paginate --slurp '*) printf '[[]]\n' ;;
    'api '*'/comments --input - '*|'api '*'/replies --input - '*)
      jq --arg endpoint "$2" '. + {endpoint: $endpoint}' ;;
    'auth setup-git') ;;
    *) printf 'Unexpected GitHub call: %s\n' "$*" >&2; return 1 ;;
  esac
}
"""


class OpenCodeWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Use the YAML parser already installed by npm ci for the application tooling.
        yaml_loader = """
const {readFileSync} = require('node:fs');
const {parse} = require('yaml');
process.stdout.write(JSON.stringify(parse(readFileSync(process.argv[1], 'utf8')).jobs));
"""
        cls.jobs = json.loads(subprocess.check_output(
            ["node", "-e", yaml_loader, "../.github/workflows/opencode.yml"],
            cwd=ROOT / "call-calendar",
        ))

    def setUp(self):
        self.folder = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.event_file = self.folder / "event.json"
        self.output_file = self.folder / "output"
        self.output_file.touch()
        # Do not pass repository credentials or GitHub tokens to the harness.
        self.env = {
            "PATH": os.environ["PATH"],
            "GIT_CONFIG_GLOBAL": str(self.folder / "gitconfig"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GH_REPO": "owner/repo",
            "THREAD_NUMBER": "37",
            "PR_NUMBER": "37",
            "ISSUE_NUMBER": "37",
            "GITHUB_EVENT_NAME": "issue_comment",
            "GITHUB_EVENT_PATH": str(self.event_file),
            "GITHUB_OUTPUT": str(self.output_file),
            "RUNNER_TEMP": str(self.folder),
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
        }
        self.pr = {
            "number": 37, "state": "open", "title": "PR", "body": "",
            "head": {"repo": {"full_name": "owner/repo"}, "sha": "a" * 40, "ref": "pr-head"},
        }

    def run_step(self, job, step_id=None, **env):
        step = next(step for step in self.jobs[job]["steps"]
                    if "run" in step and (step_id is None or step.get("id") == step_id))
        self.output_file.write_text("")
        return subprocess.run(
            ["bash", "-eo", "pipefail", "-c", MOCK_COMMANDS + step["run"]],
            cwd=self.folder, env=self.env | {"TEST_PR": json.dumps(self.pr)} | env,
            capture_output=True, text=True, timeout=15,
        )

    def outputs(self):
        return dict(line.split("=", 1) for line in self.output_file.read_text().splitlines())

    def read_discussion(self, body, owner=True, reply_to=None):
        comment = {"id": 99, "body": body, "in_reply_to_id": reply_to}
        event = {"issue": {"number": 37, "pull_request": {}}, "comment": comment}
        if reply_to:
            event = {"pull_request": self.pr, "comment": comment}
        self.event_file.write_text(json.dumps(event))
        result = self.run_step("analyze", "discussion", OWNER_COMMENT=str(owner).lower(),
                               OWNER_ISSUE_COMMENT="false")
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.outputs()

    def test_accepts_mixed_case_approval_in_conversation_and_review_reply(self):
        for body, reply_to in (("/OC apply Fix the review comment", None), ("/opENCODE Apply", 42)):
            with self.subTest(body=body):
                out = self.read_discussion(body, reply_to=reply_to)
                self.assertEqual(out.get("implement"), "true")
                self.assertEqual(out.get("pr-head"), self.pr["head"]["sha"])
                self.assertEqual(out.get("pr-branch"), "pr-head")

    def test_refuses_unapproved_or_unscoped_edits_before_admission(self):
        steps = {step.get("id"): step for step in self.jobs["analyze"]["steps"]}
        for step_id in ("budget", "install"):
            self.assertIn("steps.discussion.outputs.allowed == 'true'", steps[step_id]["if"])
        self.assertEqual(steps["admission"]["if"], "steps.budget.outputs.available == 'true'")
        self.assertEqual(steps["opencode"]["if"], "steps.install.outcome == 'success'")

        for body, owner in (("/oc apply Fix the test", False), ("/oc apply", True),
                            ("Example /OC Apply Fix the test", True)):
            with self.subTest(body=body, owner=owner):
                out = self.read_discussion(body, owner=owner)
                self.assertIn("reply", out)
                self.assertNotIn("allowed", out)
                self.assertNotIn("implement", out)
                self.assertNotIn("pr-head", out)

    def test_ordinary_pr_request_stays_read_only(self):
        out = self.read_discussion("/oc review the current diff")
        self.assertEqual(out["allowed"], "true")
        self.assertNotIn("implement", out)

    def test_analyze_failure_posts_reason_in_originating_review_thread(self):
        self.assertIn("needs.analyze.result == 'failure'", self.jobs["reply"]["if"])
        self.event_file.write_text(json.dumps({"comment": {"id": 99, "in_reply_to_id": 42}}))
        result = self.run_step("reply", GITHUB_EVENT_NAME="pull_request_review_comment",
                               ANALYZE_FAILED="true", ANALYZE_FAILURE="The proposed patch exceeds 90 KB.",
                               LIMIT_EXHAUSTED="false", REPLY="")
        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads(result.stdout)
        self.assertEqual(response["endpoint"], "repos/owner/repo/pulls/37/comments/42/replies")
        self.assertIn("The proposed patch exceeds 90 KB.", response["body"])
        self.assertIn("actions/runs/123/attempts/1", response["body"])

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.folder, env=self.env,
                                       stderr=subprocess.PIPE)

    def init_pr_branch(self):
        self.git("init", "-q", "-b", "pr-head")
        self.git("config", "user.name", "Workflow test")
        self.git("config", "user.email", "workflow-test@example.com")
        (self.folder / "source").write_text("before\n")
        self.git("add", "source")
        self.git("commit", "-qm", "Initial PR head")
        head = self.git("rev-parse", "HEAD").decode().strip()
        self.pr["head"]["sha"] = head
        self.git("init", "-q", "--bare", str(self.folder / "remote.git"))
        self.git("remote", "add", "origin", str(self.folder / "remote.git"))
        self.git("push", "-q", "origin", "HEAD:refs/heads/pr-head")
        return head

    def make_patch(self, contents):
        (self.folder / "source").write_text(contents)
        self.git("add", "source")
        patch = self.git("diff", "--cached", "--binary")
        self.git("restore", "--staged", "--worktree", "source")
        return base64.b64encode(patch).decode()

    def publish(self, patch, checked_patch):
        return self.run_step("publish-pr-edits", "commit", PR_HEAD=self.pr["head"]["sha"],
                             PR_BRANCH="pr-head", PATCH=patch, CHECKED_PATCH=checked_patch)

    def remote_head(self):
        return self.git("ls-remote", "origin", "refs/heads/pr-head").decode().split()[0]

    def test_checkout_reports_untrusted_project_configuration(self):
        head = self.init_pr_branch()
        (self.folder / "opencode.json").write_text("{}\n")
        self.git("add", "opencode.json")
        self.git("commit", "-qm", "Change OpenCode configuration")
        pr_head = self.git("rev-parse", "HEAD").decode().strip()
        self.git("switch", "--detach", head)
        result = self.run_step("analyze", "pr-checkout", PR_HEAD=pr_head)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configuration from the default branch", self.outputs()["failure"])
        self.assertEqual(self.git("rev-parse", "HEAD").decode().strip(), head)

    def test_publishes_verified_patch_to_same_pr_branch(self):
        head = self.init_pr_branch()
        patch = self.make_patch("approved\n")
        result = self.publish(patch, patch)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_head(), self.outputs()["sha"])
        self.assertEqual(self.git("rev-parse", "HEAD^").decode().strip(), head)
        self.assertEqual(self.git("show", "HEAD:source"), b"approved\n")

    def test_rejects_checked_patch_with_substituted_source_changes(self):
        head = self.init_pr_branch()
        result = self.publish(self.make_patch("approved\n"), self.make_patch("substituted\n"))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.remote_head(), head)

    def test_does_not_overwrite_a_concurrent_push(self):
        head = self.init_pr_branch()
        patch = self.make_patch("approved\n")
        self.git("commit", "--allow-empty", "-qm", "Intervening push")
        self.git("push", "-q", "origin", "HEAD:refs/heads/pr-head")
        newer_head = self.remote_head()
        self.git("switch", "--detach", head)
        result = self.publish(patch, patch)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale info", result.stderr)
        self.assertEqual(self.remote_head(), newer_head)
