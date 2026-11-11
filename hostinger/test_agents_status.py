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


def as_printed(listing):
    """The listing the way the real CLI printed it on the VPS: a blank first line, the job line
    indented two spaces and its fields four, which a copy from a chat message loses."""
    lines = listing.splitlines()
    return "\n" + "\n".join(("  " + lines[0] if i == 0 else "    " + line.strip()) for i, line in enumerate(lines)) + "\n"


class HermesTests(unittest.TestCase):
    def test_reads_the_listing_as_the_real_cli_prints_it(self):
        printed = as_printed(HERMES_LIST)
        self.assertTrue(printed.startswith("\n  a90596dc9e6f [active]\n    Name:"))
        self.assertEqual(
            status.parse_hermes_list(printed, "a90596dc9e6f"),
            {"enabled": True, "lastRunAt": "2026-11-09T13:16:27Z", "lastOk": True},
        )

    def test_reads_it_with_windows_line_ends_and_a_title_above(self):
        printed = "Scheduled jobs\r\n" + as_printed(HERMES_LIST).replace("\n", "\r\n")
        self.assertEqual(status.parse_hermes_list(printed, "a90596dc9e6f")["lastOk"], True)

    def test_each_job_is_read_from_its_own_block(self):
        other = HERMES_LIST.replace("a90596dc9e6f", "bbbbbbbbbbbb").replace("[active]", "[paused]")
        other = other.replace("13:16:27.793674+00:00 ok", "12:00:00+00:00 error")
        both = as_printed(other) + as_printed(HERMES_LIST)
        self.assertEqual(
            status.parse_hermes_list(both, "a90596dc9e6f"),
            {"enabled": True, "lastRunAt": "2026-11-09T13:16:27Z", "lastOk": True},
        )
        self.assertEqual(
            status.parse_hermes_list(both, "bbbbbbbbbbbb"),
            {"enabled": False, "lastRunAt": "2026-11-09T12:00:00Z", "lastOk": False},
        )

    def test_a_job_with_no_last_run_yet(self):
        fresh = "  a90596dc9e6f [active]\n    Name:      tasks-bridge-poll\n    Next run:  2026-11-09T13:26:27+00:00\n"
        self.assertEqual(status.parse_hermes_list(fresh, "a90596dc9e6f"), {"enabled": True})

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
        "hermes cron list": as_printed(HERMES_LIST),
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


# The tail of poll-openclaw-gated.log exactly as the VPS printed it (all empty ticks).
REAL_LOG = """\
[2026-11-10 21:50:01 UTC] NO-TASKS (no agent call)
[2026-11-10 22:00:01 UTC] NO-TASKS (no agent call)
[2026-11-10 22:10:01 UTC] NO-TASKS (no agent call)
[2026-11-10 22:20:01 UTC] NO-TASKS (no agent call)
[2026-11-10 22:30:02 UTC] NO-TASKS (no agent call)
[2026-11-10 22:40:02 UTC] NO-TASKS (no agent call)
[2026-11-10 22:50:01 UTC] NO-TASKS (no agent call)
[2026-11-10 23:00:01 UTC] NO-TASKS (no agent call)
[2026-11-10 23:10:01 UTC] NO-TASKS (no agent call)
[2026-11-10 23:20:02 UTC] NO-TASKS (no agent call)
[2026-11-10 23:30:01 UTC] NO-TASKS (no agent call)
[2026-11-10 23:40:02 UTC] NO-TASKS (no agent call)
[2026-11-10 23:50:01 UTC] NO-TASKS (no agent call)
[2026-11-11 00:00:02 UTC] NO-TASKS (no agent call)
[2026-11-11 00:10:02 UTC] NO-TASKS (no agent call)
[2026-11-11 00:20:01 UTC] NO-TASKS (no agent call)
[2026-11-11 00:30:02 UTC] NO-TASKS (no agent call)
[2026-11-11 00:40:01 UTC] NO-TASKS (no agent call)
[2026-11-11 00:50:01 UTC] NO-TASKS (no agent call)
[2026-11-11 01:00:01 UTC] NO-TASKS (no agent call)
"""

TASK_ID = "2026-11-11-0105-openclaw-readme-summary"
PATH = f"/home/deploy/tasks/processing/{TASK_ID}.md"


def at(text):
    """Epoch seconds of 'YYYY-MM-DD HH:MM:SS' in UTC."""
    from datetime import datetime, timezone

    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()


def line(stamp, message, zone="UTC"):
    return f"[{stamp} {zone}] {message}\n"


def start(stamp, task=TASK_ID):
    return line(stamp, f"TASK {task} at {PATH} -- calling gateway agent")


def ok(stamp, task=TASK_ID):
    return line(stamp, f"TASK {task} agent call OK")


def failed(stamp, rc=1, task=TASK_ID):
    return line(stamp, f"TASK {task} AGENT-FAILED rc={rc} (task left in processing)")


BILLING = "openrouter (anthropic/claude-sonnet-4.6) returned a billing error: check your account's balance\n"


class GatedLogTests(unittest.TestCase):
    NOW = at("2026-11-11 01:03:00")

    def parse(self, text, now=None):
        return status.parse_gated_log(text, now or self.NOW)

    def test_a_quiet_log_of_empty_ticks_is_healthy(self):
        job = self.parse(REAL_LOG)
        self.assertEqual(job, {"lastRunAt": "2026-11-11T01:00:01Z", "lastOk": True})

    def test_a_hand_over_that_worked(self):
        log = REAL_LOG + start("2026-11-11 01:10:01") + "Wrote the summary.\nAll done.\n" + ok("2026-11-11 01:10:40")
        job = self.parse(log, at("2026-11-11 01:12:00"))
        self.assertEqual(
            job,
            {
                "lastRunAt": "2026-11-11T01:10:40Z",
                "lastCallAt": "2026-11-11T01:10:01Z",
                "lastCallOk": True,
                "lastOk": True,
            },
        )

    def test_a_failed_hand_over_is_not_hidden_by_the_empty_ticks_after_it(self):
        log = (
            REAL_LOG
            + start("2026-11-11 01:10:01")
            + BILLING
            + failed("2026-11-11 01:10:09")
            + line("2026-11-11 01:20:01", "NO-TASKS (no agent call)")
            + line("2026-11-11 01:30:01", "NO-TASKS (no agent call)")
        )
        job = self.parse(log, at("2026-11-11 01:31:00"))
        self.assertEqual(job["lastRunAt"], "2026-11-11T01:30:01Z")
        self.assertEqual(job["lastCallAt"], "2026-11-11T01:10:01Z")
        self.assertIs(job["lastCallOk"], False)
        self.assertIs(job["lastOk"], False)
        self.assertEqual(job["consecutiveErrors"], 1)
        self.assertEqual(job["errorKind"], "billing")

    def test_only_a_later_successful_hand_over_clears_it_and_failures_are_counted(self):
        two = REAL_LOG + start("2026-11-11 01:10:01") + failed("2026-11-11 01:10:09") + start("2026-11-11 01:20:01") + failed("2026-11-11 01:20:09")
        self.assertEqual(self.parse(two, at("2026-11-11 01:21:00"))["consecutiveErrors"], 2)
        fixed = two + start("2026-11-11 01:30:01") + ok("2026-11-11 01:30:30")
        job = self.parse(fixed, at("2026-11-11 01:31:00"))
        self.assertTrue(job["lastOk"])
        self.assertTrue(job["lastCallOk"])
        self.assertNotIn("consecutiveErrors", job)
        self.assertNotIn("errorKind", job)

    def test_a_poll_error_is_cleared_by_the_next_good_poll(self):
        bad = REAL_LOG + line("2026-11-11 01:10:01", "ERROR unexpected poll output: something odd") + "second line of that output\n"
        job = self.parse(bad, at("2026-11-11 01:11:00"))
        self.assertIs(job["lastOk"], False)
        self.assertEqual(job["consecutiveErrors"], 1)
        self.assertEqual(job["errorKind"], "other")
        good = bad + line("2026-11-11 01:20:01", "NO-TASKS (no agent call)")
        self.assertIs(self.parse(good, at("2026-11-11 01:21:00"))["lastOk"], True)

    def test_a_hand_over_still_running_is_fine_but_one_with_no_ending_is_not(self):
        running = REAL_LOG + start("2026-11-11 01:10:01") + "thinking...\n"
        job = self.parse(running, at("2026-11-11 01:15:00"))
        self.assertIs(job["lastOk"], True)
        self.assertNotIn("lastCallOk", job)

        died = self.parse(running, at("2026-11-11 01:25:00"))
        self.assertIs(died["lastOk"], False)
        self.assertIs(died["lastCallOk"], False)
        self.assertEqual(died["errorKind"], "timeout")

    def test_what_the_agent_wrote_cannot_be_taken_for_a_failure_reason(self):
        text = "Updated the author list and the credit card statement. Authentication of users reviewed.\n"
        log = start("2026-11-11 01:10:01") + text + failed("2026-11-11 01:10:09", rc=2)
        self.assertEqual(self.parse(log, at("2026-11-11 01:11:00"))["errorKind"], "other")

    def test_other_lines_are_ignored_not_trusted_as_events(self):
        log = REAL_LOG + "[2026-11-11 01:10:01 UTC] something nobody logs\n[not a stamp] NO-TASKS\n"
        self.assertEqual(self.parse(log)["lastRunAt"], "2026-11-11T01:00:01Z")

    def test_empty_garbage_and_bad_dates_give_nothing(self):
        for text in ("", "hello\nworld\n", "[2026-13-45 99:99:99 UTC] NO-TASKS (no agent call)\n"):
            self.assertEqual(self.parse(text), {})

    def test_a_stamp_in_another_zone_is_read_in_the_hosts_zone(self):
        import time as _time

        old = os.environ.get("TZ")
        os.environ["TZ"] = "Asia/Bangkok"
        _time.tzset()
        try:
            job = self.parse(line("2026-11-11 08:00:01", "NO-TASKS (no agent call)", zone="+07"))
        finally:
            if old is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = old
            _time.tzset()
        self.assertEqual(job["lastRunAt"], "2026-11-11T01:00:01Z")

    def test_none_of_the_agents_output_reaches_what_is_reported(self):
        log = start("2026-11-11 01:10:01") + "token=SUPER-SECRET-VALUE-123 and a private note\n" + failed("2026-11-11 01:10:09")
        job = self.parse(log, at("2026-11-11 01:11:00"))
        self.assertNotIn("SUPER-SECRET", json.dumps(job))
        self.assertNotIn("private note", json.dumps(job))


class CronTests(unittest.TestCase):
    SCRIPT = "poll-openclaw-gated.sh"
    REAL = (
        "*/2 * * * * flock -n /tmp/mf-agents-status.lock /usr/bin/python3 /opt/agents/mindferry/scripts/agents-status.py\n"
        "*/10 * * * * flock -n /tmp/oc-bridge-poll.lock /home/deploy/tasks/poll-openclaw-gated.sh >> /home/deploy/tasks/.status/poll-openclaw-gated.log 2>&1\n"
    )

    def test_reads_the_real_crontab(self):
        self.assertEqual(status.parse_cron(self.REAL, self.SCRIPT), (True, 10))

    def test_a_commented_out_or_missing_line_is_off(self):
        self.assertEqual(status.parse_cron("# " + self.REAL.splitlines()[1] + "\n", self.SCRIPT), (False, None))
        self.assertEqual(status.parse_cron(self.REAL.splitlines()[0] + "\n", self.SCRIPT), (False, None))
        self.assertEqual(status.parse_cron("", self.SCRIPT), (False, None))

    def test_the_interval_of_simple_schedules_only(self):
        cases = {
            ("*/10", "*"): 10,
            ("*", "*"): 1,
            ("0,15,30,45", "*"): 15,
            ("0,20,40", "*"): 20,
            ("7", "*"): 60,
            ("0,5,30", "*"): None,
            ("*/10", "8-18"): None,
            ("*/0", "*"): None,
            ("*/90", "*"): None,
            ("61", "*"): None,
        }
        for (minute, hour), want in cases.items():
            self.assertEqual(status.cron_interval(minute, hour), want, (minute, hour))


class TailTests(unittest.TestCase):
    def test_reads_only_the_end_and_drops_the_cut_first_line(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "log")
            with open(path, "w", encoding="utf8") as handle:
                handle.write("".join(f"line {n:04d}\n" for n in range(1000)))
            text = status.read_tail(path, 100)
            self.assertLessEqual(len(text), 100)
            self.assertTrue(text.startswith("line "))
            self.assertTrue(text.endswith("line 0999\n"))
            self.assertEqual(status.read_tail(path, 10**6).splitlines()[0], "line 0000")

    def test_refuses_a_symlink_a_folder_and_a_missing_file(self):
        with tempfile.TemporaryDirectory() as root:
            real = os.path.join(root, "real")
            open(real, "w").close()
            link = os.path.join(root, "link")
            os.symlink(real, link)
            self.assertIsNone(status.read_tail(link, 100))
            self.assertIsNone(status.read_tail(root, 100))
            self.assertIsNone(status.read_tail(os.path.join(root, "nope"), 100))


class CollectGatedTests(unittest.TestCase):
    CRON = CronTests.REAL
    BASE = {
        "inspect -f {{.State.Status}}|{{.State.StartedAt}} hermes": "running|2026-11-07T01:36:18Z\n",
        "inspect -f {{.State.Status}}|{{.State.StartedAt}} openclaw-openclaw-gateway-1": "running|2026-11-07T01:29:39Z\n",
        "hermes --version": "Hermes Agent v0.22.7\n",
        "hermes cron list": as_printed(HERMES_LIST),
        "hermes cron runs": HERMES_RUNS,
        "openclaw --version": "OpenClaw 2026.10.10 (7dc3350)\n",
    }

    def collect(self, table, log=None):
        with tempfile.TemporaryDirectory() as root:
            if log is not None:
                os.makedirs(os.path.join(root, ".status"))
                with open(os.path.join(root, ".status", "poll-openclaw-gated.log"), "w", encoding="utf8") as handle:
                    handle.write(log)
            with mock.patch.object(status, "run", fake_run(table)):
                return status.collect(root, int(at("2026-11-11 01:03:00")))[0]

    def test_reads_the_poll_from_the_log_and_the_crontab_not_from_the_old_cron_job(self):
        table = dict(self.BASE, **{"crontab -l": self.CRON, "openclaw cron get": json.dumps(dict(OPENCLAW_JOB, enabled=False))})
        job = self.collect(table, REAL_LOG)["agents"]["openclaw"]["job"]
        self.assertEqual(
            job,
            {
                "kind": "host-cron",
                "enabled": True,
                "intervalMinutes": 10,
                "lastRunAt": "2026-11-11T01:00:01Z",
                "lastOk": True,
            },
        )
        self.assertEqual(self.collect(table, REAL_LOG)["agents"]["hermes"]["job"]["lastOk"], True)

    def test_a_removed_cron_line_is_reported_as_off(self):
        table = dict(self.BASE, **{"crontab -l": self.CRON.splitlines()[0] + "\n"})
        job = self.collect(table, REAL_LOG)["agents"]["openclaw"]["job"]
        self.assertIs(job["enabled"], False)
        self.assertNotIn("intervalMinutes", job)

    def test_an_unreadable_crontab_is_unknown_not_off(self):
        job = self.collect(dict(self.BASE), REAL_LOG)["agents"]["openclaw"]["job"]
        self.assertNotIn("enabled", job)
        self.assertEqual(job["kind"], "host-cron")

    def test_a_cron_line_with_no_log_yet_is_still_the_new_poll(self):
        job = self.collect(dict(self.BASE, **{"crontab -l": self.CRON}))["agents"]["openclaw"]["job"]
        self.assertEqual(job, {"kind": "host-cron", "enabled": True, "intervalMinutes": 10})

    def test_without_any_sign_of_the_new_poll_the_old_reading_is_used(self):
        table = dict(self.BASE, **{"crontab -l": "", "openclaw cron get": json.dumps(OPENCLAW_JOB)})
        job = self.collect(table)["agents"]["openclaw"]["job"]
        self.assertNotIn("kind", job)
        self.assertTrue(job["lastOk"])

    def test_a_failed_hand_over_shows_in_the_snapshot_without_the_agents_words(self):
        log = REAL_LOG + start("2026-11-11 01:00:30") + "sk-ant-api03-LEAKED-KEY-VALUE\n" + BILLING + failed("2026-11-11 01:00:40")
        table = dict(self.BASE, **{"crontab -l": self.CRON})
        out = self.collect(table, log)
        job = out["agents"]["openclaw"]["job"]
        self.assertEqual((job["lastCallOk"], job["lastOk"], job["errorKind"]), (False, False, "billing"))
        text = json.dumps(out)
        self.assertNotIn("LEAKED", text)
        self.assertNotIn("check your account", text)


if __name__ == "__main__":
    unittest.main()
