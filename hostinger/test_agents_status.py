"""Tests for agents-status.py, run on the outputs the real agents printed. No Docker needed.

  python3 -m unittest hostinger/test_agents_status.py
"""
import importlib.util
import json
import os
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("agents_status", os.path.join(HERE, "agents-status.py"))
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)

HERMES_LIST = """\
a90596dc9e6f [active]
  Name:      tasks-bridge-poll
  Schedule:  every 10m
  Repeat:    ∞
  Next run:  2026-11-09T13:26:27.793674+00:00
  Deliver:   local
  Monitor:   poll-hermes.sh (agent runs only on output change)
  Changed:   2026-11-07T01:52:27.690827+00:00
  Last run:  2026-11-09T13:16:27.793674+00:00 ok
  Dispatch:  on time (scheduled 2026-11-09T13:15:27.799244+00:00)
  Execution: completed 29cefad11fac4548ae479ba99a25bc69
"""

HERMES_RUNS = """\
5388a0a3c224c728b24e687c4ab027d  completed  job=a90596dc9e6f  source=builtin  2026-11-09T13:27:27.636021+00:00
29cefad11fac4548ae479ba99a25bc69  completed  job=a90596dc9e6f  source=builtin  2026-11-09T13:16:27.637013+00:00
"""

OPENCLAW_JOB = {
    "id": "e67c8fd7-05e8-4e13-9f31-d508f3aba071",
    "name": "tasks-bridge-poll",
    "enabled": True,
    "payload": {"kind": "agentTurn", "message": "Task-bridge worker. Run poll-openclaw.sh", "toolsAllow": ["*"]},
    "state": {
        "lastRunAtMs": 1794230656945,
        "lastRunStatus": "ok",
        "lastStatus": "ok",
        "consecutiveErrors": 0,
        "nextRunAtMs": 1794231256945,
    },
    "lastRunStatus": "ok",
}

BILLING = "openrouter (anthropic/claude-sonnet-4.6) returned a billing error — check your account's balance"


class HermesTests(unittest.TestCase):
    def test_reads_an_active_job_whose_last_run_was_ok(self):
        self.assertEqual(
            status.parse_hermes_list(HERMES_LIST, "a90596dc9e6f"),
            {"enabled": True, "lastRunAt": "2026-11-09T13:16:27Z", "lastOk": True},
        )

    def test_a_paused_job_is_not_enabled(self):
        paused = HERMES_LIST.replace("[active]", "[paused]")
        self.assertFalse(status.parse_hermes_list(paused, "a90596dc9e6f")["enabled"])

    def test_a_failed_last_run_is_not_ok(self):
        failed = HERMES_LIST.replace("13:16:27.793674+00:00 ok", "13:16:27.793674+00:00 error")
        job = status.parse_hermes_list(failed, "a90596dc9e6f")
        self.assertIs(job["lastOk"], False)

    def test_another_job_or_empty_output_gives_nothing(self):
        self.assertIsNone(status.parse_hermes_list(HERMES_LIST, "ffffffffffff"))
        self.assertIsNone(status.parse_hermes_list("", "a90596dc9e6f"))

    def test_counts_failures_in_a_row_from_the_newest_run(self):
        self.assertEqual(status.parse_hermes_runs(HERMES_RUNS, "a90596dc9e6f"), 0)
        runs = (
            "r3  failed  job=a90596dc9e6f  source=builtin  2026-11-09T13:27:27+00:00\n"
            "r2  failed  job=a90596dc9e6f  source=builtin  2026-11-09T13:16:27+00:00\n"
            "r1  completed  job=a90596dc9e6f  source=builtin  2026-11-09T13:05:27+00:00\n"
            "r0  failed  job=a90596dc9e6f  source=builtin  2026-11-09T12:54:27+00:00\n"
        )
        self.assertEqual(status.parse_hermes_runs(runs, "a90596dc9e6f"), 2)

    def test_a_run_still_going_neither_counts_nor_ends_the_streak(self):
        runs = (
            "r3  running  job=a90596dc9e6f  source=builtin  2026-11-09T13:27:27+00:00\n"
            "r2  failed  job=a90596dc9e6f  source=builtin  2026-11-09T13:16:27+00:00\n"
            "r1  completed  job=a90596dc9e6f  source=builtin  2026-11-09T13:05:27+00:00\n"
        )
        self.assertEqual(status.parse_hermes_runs(runs, "a90596dc9e6f"), 1)

    def test_ignores_runs_of_other_jobs(self):
        runs = "x  failed  job=other  source=builtin  2026-11-09T13:27:27+00:00\n"
        self.assertEqual(status.parse_hermes_runs(runs, "a90596dc9e6f"), 0)


class OpenClawTests(unittest.TestCase):
    def test_reads_the_job_from_the_real_output(self):
        self.assertEqual(
            status.parse_openclaw_job(OPENCLAW_JOB),
            {"enabled": True, "lastRunAt": "2026-11-09T13:24:16Z", "lastOk": True},
        )

    def test_a_switched_off_job_with_failures(self):
        data = dict(OPENCLAW_JOB, enabled=False)
        data["state"] = dict(OPENCLAW_JOB["state"], lastRunStatus="error", consecutiveErrors=10)
        job = status.parse_openclaw_job(data)
        self.assertEqual(
            job,
            {"enabled": False, "lastRunAt": "2026-11-09T13:24:16Z", "lastOk": False, "consecutiveErrors": 10},
        )

    def test_not_a_job_gives_nothing(self):
        for value in (None, [], "text", 5):
            self.assertIsNone(status.parse_openclaw_job(value))

    def test_finds_the_runs_list_whatever_it_is_called(self):
        runs = [{"ts": 1, "error": "old"}, {"ts": 2, "error": BILLING}]
        for wrapper in (runs, {"entries": runs, "total": 2}, {"runs": runs, "hasMore": False}):
            text = status.openclaw_failure_text(wrapper, OPENCLAW_JOB)
            self.assertIn("billing error", text)
            self.assertNotIn("old", text)

    def test_the_newest_failure_decides_the_reason(self):
        self.assertEqual(status.error_kind(BILLING), "billing")


class ErrorKindTests(unittest.TestCase):
    def test_classifies(self):
        cases = {
            "returned a billing error": "billing",
            "HTTP 402 Payment Required": "billing",
            "401 Unauthorized": "auth",
            "invalid API key": "auth",
            "request timed out": "timeout",
            "something odd": "other",
            "": "other",
        }
        for text, kind in cases.items():
            self.assertEqual(status.error_kind(text), kind, text)

    def test_text_is_shortened_and_cleaned(self):
        self.assertEqual(status.short("a\n\x07b   c" + "x" * 200, 10), "a b cxxxxx")


class TimeTests(unittest.TestCase):
    def test_normalises_timestamps_to_utc_seconds(self):
        self.assertEqual(status.iso_text("2026-11-09T13:16:27.793674+00:00"), "2026-11-09T13:16:27Z")
        self.assertEqual(status.iso_text("2026-11-09T20:34:26.598+07:00"), "2026-11-09T13:34:26Z")
        self.assertEqual(status.iso_text("2026-11-07T01:36:18Z"), "2026-11-07T01:36:18Z")
        self.assertIsNone(status.iso_text("not a date"))
        self.assertIsNone(status.iso_text(None))

    def test_milliseconds(self):
        self.assertEqual(status.iso_ms(1794230656945), "2026-11-09T13:24:16Z")


def fake_run(table):
    """A stand-in for `docker`: answers a command from a table of its words, or fails."""

    def run(args, timeout=0):
        key = " ".join(args)
        for needle, output in table.items():
            if needle in key:
                return output
        return None

    return run


class CollectTests(unittest.TestCase):
    def collect(self, table, tasks_dir=None):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(status, "run", fake_run(table)):
            return status.collect(tasks_dir or root, 1794231000)[0]

    HEALTHY = {
        "inspect -f {{.State.Status}}|{{.State.StartedAt}} hermes": "running|2026-11-07T01:36:18.5Z\n",
        "inspect -f {{.State.Status}}|{{.State.StartedAt}} openclaw-openclaw-gateway-1": "running|2026-11-07T01:29:39.1Z\n",
        "hermes --version": "Hermes Agent v0.22.7 (2026.9.24)\nPython 3.14.9\n",
        "hermes cron list": HERMES_LIST,
        "hermes cron runs": HERMES_RUNS,
        "openclaw --version": "OpenClaw 2026.10.10 (7dc3350)\n",
        "openclaw cron get": json.dumps(OPENCLAW_JOB),
    }

    def test_a_healthy_pair(self):
        out = self.collect(self.HEALTHY)
        self.assertEqual(out["schema"], 1)
        self.assertEqual(out["generatedAt"], "2026-11-09T13:30:00Z")
        self.assertEqual(
            out["agents"]["hermes"],
            {
                "container": {"state": "running", "startedAt": "2026-11-07T01:36:18Z"},
                "version": "Hermes Agent v0.22.7 (2026.9.24)",
                "job": {"enabled": True, "lastRunAt": "2026-11-09T13:16:27Z", "lastOk": True},
            },
        )
        self.assertEqual(out["agents"]["openclaw"]["version"], "OpenClaw 2026.10.10 (7dc3350)")
        self.assertTrue(out["agents"]["openclaw"]["job"]["lastOk"])

    def test_openclaw_switched_off_for_billing(self):
        broken = dict(OPENCLAW_JOB, enabled=False)
        broken["state"] = dict(OPENCLAW_JOB["state"], lastRunStatus="error", consecutiveErrors=10)
        table = dict(self.HEALTHY)
        table["openclaw cron get"] = json.dumps(broken)
        table["openclaw cron runs"] = json.dumps({"entries": [{"ts": 5, "status": "error", "error": BILLING}], "total": 1})
        job = self.collect(table)["agents"]["openclaw"]["job"]
        self.assertEqual(job["enabled"], False)
        self.assertEqual(job["consecutiveErrors"], 10)
        self.assertEqual(job["errorKind"], "billing")

    def test_a_stopped_container_has_no_version_or_job(self):
        table = dict(self.HEALTHY)
        table["inspect -f {{.State.Status}}|{{.State.StartedAt}} hermes"] = "exited|2026-11-07T01:36:18Z\n"
        self.assertEqual(
            self.collect(table)["agents"]["hermes"],
            {"container": {"state": "exited", "startedAt": "2026-11-07T01:36:18Z"}},
        )

    def test_an_agent_that_cannot_be_read_is_left_empty_and_the_other_still_works(self):
        table = {k: v for k, v in self.HEALTHY.items() if "hermes" not in k}
        out = self.collect(table)
        self.assertEqual(out["agents"]["hermes"], {})
        self.assertIn("job", out["agents"]["openclaw"])

    def test_a_failing_cli_leaves_the_job_out_but_keeps_the_container(self):
        table = dict(self.HEALTHY)
        del table["hermes cron list"]
        del table["hermes cron runs"]
        entry = self.collect(table)["agents"]["hermes"]
        self.assertEqual(entry["container"]["state"], "running")
        self.assertNotIn("job", entry)

    def test_garbage_json_is_ignored(self):
        table = dict(self.HEALTHY)
        table["openclaw cron get"] = "{not json"
        self.assertNotIn("job", self.collect(table)["agents"]["openclaw"])

    def test_the_output_holds_only_whitelisted_fields(self):
        text = json.dumps(self.collect(self.HEALTHY))
        for leaked in ("toolsAllow", "payload", "Task-bridge worker", "configRevision", "sessionKey", "usage"):
            self.assertNotIn(leaked, text)


class VersionCacheTests(unittest.TestCase):
    def test_reads_the_version_only_again_when_the_container_changes(self):
        calls = []

        def counting(args, timeout=0):
            calls.append(args)
            return "v1\n"

        cache = {}
        with mock.patch.object(status, "run", counting):
            self.assertEqual(status.version_of("c", ["x", "--version"], "T1", cache, 1000), "v1")
            self.assertEqual(status.version_of("c", ["x", "--version"], "T1", cache, 1060), "v1")
            self.assertEqual(len(calls), 1)
            status.version_of("c", ["x", "--version"], "T2", cache, 1120)
            self.assertEqual(len(calls), 2)
            status.version_of("c", ["x", "--version"], "T2", cache, 1120 + status.VERSION_MAX_AGE + 1)
            self.assertEqual(len(calls), 3)


class WriteTests(unittest.TestCase):
    def test_writes_atomically_with_readable_permissions_and_leaves_no_temp_file(self):
        with tempfile.TemporaryDirectory() as root:
            target = os.path.join(root, ".status", "agents.json")
            status.write_atomic(target, '{"a": 1}\n')
            status.write_atomic(target, '{"a": 2}\n')
            with open(target, encoding="utf8") as handle:
                self.assertEqual(handle.read(), '{"a": 2}\n')
            self.assertEqual(os.stat(target).st_mode & 0o777, 0o644)
            self.assertEqual(os.listdir(os.path.dirname(target)), ["agents.json"])

    def test_main_prints_without_writing(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.object(status, "run", lambda *a, **k: None):
            with mock.patch("sys.stdout") as out:
                self.assertEqual(status.main(["--tasks-dir", root, "--print"]), 0)
            self.assertFalse(os.path.exists(os.path.join(root, ".status")))
            self.assertTrue(out.write.called)


if __name__ == "__main__":
    unittest.main()
