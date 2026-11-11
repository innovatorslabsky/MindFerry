#!/usr/bin/env python3
"""Writes <tasks>/.status/agents.json: read-only facts about the Hermes and OpenClaw agents.

Run once a minute by the `deploy` user (see hostinger/README-agents.md). MindFerry only reads the
file; it never runs a command and never touches Docker. Each agent is read independently, and a
part that cannot be read is left out, which the page shows as "unknown" rather than guessing.

Everything this runs is a fixed, read-only command: `docker inspect`, and the agents' own
`--version` and `cron list|get|runs`. Only a short list of fields is copied into the file, so
nothing secret can reach it.

  agents-status.py [--tasks-dir /home/deploy/tasks] [--print]
"""
import argparse
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERMES = {"container": "hermes", "job": "a90596dc9e6f"}
OPENCLAW = {"container": "openclaw-openclaw-gateway-1", "job": "e67c8fd7-05e8-4e13-9f31-d508f3aba071"}

COMMAND_TIMEOUT = 25
VERSION_MAX_AGE = 6 * 3600
SUCCESS_WORDS = ("completed", "ok", "success", "succeeded")
FAILURE_WORDS = ("failed", "error", "errored", "timeout", "timed_out", "crashed", "cancelled")
GATED_SCRIPT = "poll-openclaw-gated.sh"
GATED_LOG = "poll-openclaw-gated.log"
GATED_TAIL_BYTES = 256 * 1024
MAX_BLOCK_CHARS = 4000
# `openclaw agent --timeout 600` plus a minute: a hand-over with no ending line after this long died.
CALL_HUNG_SECONDS = 660
# Specific on purpose: this text is an agent's own output, which can mention credit cards or authors.
ERROR_KINDS = (
    ("billing", re.compile(r"billing error|\b402\b|payment required|insufficient (credit|fund|balance)|out of credit|quota (exceeded|exhausted)", re.I)),
    ("auth", re.compile(r"\b40[13]\b|unauthori[sz]ed|forbidden|invalid.{0,12}(key|token)|authentication (failed|error)", re.I)),
    ("timeout", re.compile(r"time(d)? ?out", re.I)),
)


def run(args, timeout=COMMAND_TIMEOUT):
    """Output of a command, or None if it failed or took too long."""
    try:
        done = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout if done.returncode == 0 else None


def iso_ms(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_text(value):
    """Normalises an ISO timestamp (with fractions or an offset) to UTC seconds, or None."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def error_kind(text):
    for kind, pattern in ERROR_KINDS:
        if pattern.search(text or ""):
            return kind
    return "other"


def short(text, limit=80):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", text or "")).strip()[:limit]


def container_info(name):
    out = run(["docker", "inspect", "-f", "{{.State.Status}}|{{.State.StartedAt}}", name])
    if out is None or "|" not in out:
        return None
    state, started = out.strip().split("|", 1)
    info = {"state": short(state, 20)}
    started_iso = iso_text(started)
    if started_iso:
        info["startedAt"] = started_iso
    return info


JOB_HEADER = re.compile(r"^\s*([0-9a-f]{6,})\s+\[([^\]]+)\]\s*$", re.I)


def parse_hermes_list(text, job_id):
    """The block for one job in `hermes cron list`: whether it is active and how its last run went.

    A job starts at a line like `  a90596dc9e6f [active]` (indented or not, with blank lines around)
    and runs to the next such line, so indentation never decides where a block begins.
    """
    block = None
    state = None
    for line in text.splitlines():
        header = JOB_HEADER.match(line)
        if header:
            if block is not None:
                break
            if header.group(1) == job_id:
                block, state = [], header.group(2)
            continue
        if block is not None:
            block.append(line)
    if block is None:
        return None
    job = {"enabled": state.strip().lower() == "active"}
    body = "\n".join(block)
    last = re.search(r"^\s*Last run:\s+(\S+)(?:\s+(\S+))?", body, re.M)
    if last:
        stamp = iso_text(last.group(1))
        if stamp:
            job["lastRunAt"] = stamp
        outcome = (last.group(2) or "").lower()
        if outcome:
            job["lastOk"] = outcome == "ok"
    return job


def parse_hermes_runs(text, job_id):
    """Newest first: `<runId>  <status>  job=<id>  source=...  <timestamp>`. Counts failures in a row.
    A run still going (or any status not known to be a failure) neither counts nor ends the streak."""
    streak = 0
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 2 or f"job={job_id}" not in line:
            continue
        outcome = fields[1].lower()
        if outcome in SUCCESS_WORDS:
            break
        if outcome in FAILURE_WORDS:
            streak += 1
    return streak


def hermes_job(spec):
    listing = run(["docker", "exec", spec["container"], "hermes", "cron", "list"])
    job = parse_hermes_list(listing, spec["job"]) if listing else None
    if job is None:
        return None
    runs = run(["docker", "exec", spec["container"], "hermes", "cron", "runs", spec["job"]])
    if runs is not None:
        streak = parse_hermes_runs(runs, spec["job"])
        if streak:
            job["consecutiveErrors"] = streak
    if job.get("lastOk") is False or job.get("consecutiveErrors"):
        job["errorKind"] = error_kind(listing)
    return job


def entries_of(value):
    """The list of run entries in `openclaw cron runs --json`, whatever the wrapper calls it."""
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        for item in value.values():
            if isinstance(item, list) and item and isinstance(item[0], dict):
                return item
    return []


def parse_openclaw_job(data):
    """`openclaw cron get <id> --json`."""
    if not isinstance(data, dict):
        return None
    state = data.get("state") if isinstance(data.get("state"), dict) else {}
    job = {"enabled": data.get("enabled") is True}
    last_ms = state.get("lastRunAtMs", data.get("lastRunAtMs"))
    if isinstance(last_ms, (int, float)):
        job["lastRunAt"] = iso_ms(last_ms)
    status = state.get("lastRunStatus", data.get("lastRunStatus"))
    if isinstance(status, str):
        job["lastOk"] = status.lower() == "ok"
    errors = state.get("consecutiveErrors")
    if isinstance(errors, int) and errors > 0:
        job["consecutiveErrors"] = errors
    return job


def openclaw_failure_text(runs_json, data):
    """The words an error might be written in: the job state and the newest run's error and summary."""
    parts = []
    state = data.get("state") if isinstance(data.get("state"), dict) else {}
    for key in ("lastError", "lastErrorMessage", "error"):
        if isinstance(state.get(key), str):
            parts.append(state[key])
    entries = sorted(entries_of(runs_json), key=lambda e: e.get("ts", 0), reverse=True)
    if entries:
        for key in ("error", "errorMessage", "summary", "status"):
            if isinstance(entries[0].get(key), str):
                parts.append(entries[0][key])
    return " ".join(parts)


def openclaw_job(spec):
    out = run(["docker", "exec", spec["container"], "openclaw", "cron", "get", spec["job"], "--json"])
    try:
        data = json.loads(out) if out else None
    except ValueError:
        data = None
    job = parse_openclaw_job(data)
    if job is None:
        return None
    if job.get("lastOk") is False or job.get("consecutiveErrors") or job["enabled"] is False:
        runs = run(["docker", "exec", spec["container"], "openclaw", "cron", "runs", spec["job"], "--json"])
        try:
            runs_json = json.loads(runs) if runs else None
        except ValueError:
            runs_json = None
        text = openclaw_failure_text(runs_json, data)
        if job.get("lastOk") is False or job.get("consecutiveErrors"):
            job["errorKind"] = error_kind(text)
    return job


LOG_LINE = re.compile(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([^\]\s]{1,8})\] (.*)$")
EVENT_PATTERNS = (
    ("empty", re.compile(r"^NO-TASKS\b")),
    ("start", re.compile(r"^TASK \S+ at \S+ -- calling gateway agent")),
    ("ok", re.compile(r"^TASK \S+ agent call OK\s*$")),
    ("fail", re.compile(r"^TASK \S+ AGENT-FAILED rc=\d+")),
    ("poll_error", re.compile(r"^ERROR\b")),
)


def parse_log_time(stamp, zone):
    """Epoch seconds of a `date "+%Y-%m-%d %H:%M:%S %Z"` stamp: UTC when it says so, else the host's zone."""
    try:
        naive = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    if zone.upper() in ("UTC", "GMT", "Z"):
        return naive.replace(tzinfo=timezone.utc).timestamp()
    return naive.astimezone().timestamp()


def log_events(text):
    """The poller's own lines as events. Any other line (the agent's output, which the script appends
    to the same file) belongs to the event before it and is only ever read to classify a failure."""
    events = []
    for line in text.splitlines():
        match = LOG_LINE.match(line)
        kind = None
        if match:
            for name, pattern in EVENT_PATTERNS:
                if pattern.match(match.group(3)):
                    kind = name
                    break
        stamp = parse_log_time(match.group(1), match.group(2)) if kind else None
        if kind and stamp is not None:
            events.append({"kind": kind, "ts": stamp, "text": match.group(3)[:MAX_BLOCK_CHARS]})
        elif events and len(events[-1]["text"]) < MAX_BLOCK_CHARS:
            events[-1]["text"] += "\n" + line[:MAX_BLOCK_CHARS]
    return events


def parse_gated_log(text, now):
    """Health of the host-cron poll from its log: when it last ticked, when it last handed a task to
    the agent and how that went. An empty tick is normal. A failed hand-over leaves its task unfinished
    and the ticks after it log NO-TASKS, so the failure is tracked apart from the ticks and only a later
    successful hand-over clears it."""
    events = log_events(text)
    job = {}
    if not events:
        return job
    call_fails = poll_errors = 0
    last_call_ok = None
    call_text = poll_text = ""
    pending = None
    last_start = None
    for event in events:
        kind = event["kind"]
        if kind == "start":
            pending = last_start = event
            poll_errors = 0
        elif kind == "ok":
            pending, call_fails, poll_errors, last_call_ok = None, 0, 0, True
        elif kind == "fail":
            call_text = (pending["text"] if pending else "") + "\n" + event["text"]
            pending, last_call_ok = None, False
            call_fails += 1
        elif kind == "poll_error":
            poll_text, poll_errors = event["text"], poll_errors + 1
        else:
            poll_errors = 0
    hung = pending is not None and now - pending["ts"] > CALL_HUNG_SECONDS
    if hung:
        call_fails, last_call_ok = call_fails + 1, False
    errors = call_fails + poll_errors
    job["lastRunAt"] = iso_ms(events[-1]["ts"] * 1000)
    if last_start:
        job["lastCallAt"] = iso_ms(last_start["ts"] * 1000)
    if last_call_ok is not None:
        job["lastCallOk"] = last_call_ok
    job["lastOk"] = errors == 0
    if errors:
        job["consecutiveErrors"] = errors
        if hung and not poll_errors:
            job["errorKind"] = "timeout"
        else:
            job["errorKind"] = error_kind(poll_text if poll_errors else call_text)
    return job


def cron_interval(minute, hour):
    """Minutes between runs for the simple schedules a poll uses, or None when it is not simple."""
    if hour != "*":
        return None
    if minute == "*":
        return 1
    step = re.fullmatch(r"\*/(\d{1,2})", minute)
    if step and 1 <= int(step.group(1)) <= 59:
        return int(step.group(1))
    if re.fullmatch(r"\d{1,2}(,\d{1,2})*", minute):
        marks = sorted({int(m) for m in minute.split(",")})
        if all(m < 60 for m in marks):
            gaps = {(b - a) % 60 or 60 for a, b in zip(marks, marks[1:] + marks[:1])}
            return gaps.pop() if len(gaps) == 1 else None
    return None


def parse_cron(text, script):
    """(enabled, interval) from a crontab: the live line that runs `script`, or (False, None) if none."""
    for line in text.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or script not in raw:
            continue
        fields = raw.split(None, 5)
        if len(fields) == 6:
            return True, cron_interval(fields[0], fields[1])
    return False, None


def read_tail(path, max_bytes):
    """The last `max_bytes` of a regular file (never through a symlink), without a cut first line."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return None
        start = max(0, info.st_size - max_bytes)
        os.lseek(fd, start, os.SEEK_SET)
        with os.fdopen(os.dup(fd), "rb") as handle:
            data = handle.read(max_bytes)
    finally:
        os.close(fd)
    text = data.decode("utf-8", errors="replace")
    if start > 0:
        text = text.split("\n", 1)[1] if "\n" in text else ""
    return text


def openclaw_gated_job(tasks_dir, now):
    """The poll that replaced OpenClaw's own cron job: the host's cron runs a script that calls the agent
    only when a task is waiting. None when there is no sign of it, so the old reading can still be used."""
    text = read_tail(os.path.join(tasks_dir, ".status", GATED_LOG), GATED_TAIL_BYTES)
    crontab = run(["crontab", "-l"])
    enabled, interval = parse_cron(crontab, GATED_SCRIPT) if crontab is not None else (None, None)
    if text is None and enabled is not True:
        return None
    job = parse_gated_log(text or "", now)
    job["kind"] = "host-cron"
    if enabled is not None:
        job["enabled"] = enabled
    if interval:
        job["intervalMinutes"] = interval
    return job


def hermes_poll(spec, tasks_dir, now):
    return hermes_job(spec)


def openclaw_poll(spec, tasks_dir, now):
    return openclaw_gated_job(tasks_dir, now) or openclaw_job(spec)


def read_cache(path):
    try:
        with open(path, encoding="utf8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def version_of(name, command, started, cache, now):
    """A version only changes when the container is recreated, so it is read again only then."""
    entry = cache.get(name, {})
    fresh = now - entry.get("at", 0) < VERSION_MAX_AGE
    if entry.get("startedAt") == started and fresh and entry.get("version"):
        return entry["version"]
    out = run(["docker", "exec", name] + command)
    version = short(out.strip().splitlines()[0]) if out and out.strip() else ""
    cache[name] = {"startedAt": started, "version": version, "at": now}
    return version


def collect(tasks_dir, now):
    cache_path = os.path.join(tasks_dir, ".status", ".cache.json")
    cache = read_cache(cache_path)
    agents = {}
    for key, spec, version_cmd, job_reader in (
        ("hermes", HERMES, ["hermes", "--version"], hermes_poll),
        ("openclaw", OPENCLAW, ["openclaw", "--version"], openclaw_poll),
    ):
        entry = {}
        container = container_info(spec["container"])
        if container:
            entry["container"] = container
            if container["state"] == "running":
                version = version_of(spec["container"], version_cmd, container.get("startedAt"), cache, now)
                if version:
                    entry["version"] = version
                job = job_reader(spec, tasks_dir, now)
                if job:
                    entry["job"] = job
        agents[key] = entry
    return {
        "schema": 1,
        "generatedAt": datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "agents": agents,
    }, cache, cache_path


def write_atomic(path, text):
    folder = os.path.dirname(path)
    os.makedirs(folder, mode=0o755, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=folder, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf8") as handle:
            handle.write(text)
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--tasks-dir", default="/home/deploy/tasks")
    parser.add_argument("--print", action="store_true", help="print the JSON instead of writing it")
    args = parser.parse_args(argv)

    status, cache, cache_path = collect(args.tasks_dir, int(datetime.now(tz=timezone.utc).timestamp()))
    text = json.dumps(status, indent=2) + "\n"
    if args.print:
        sys.stdout.write(text)
        return 0
    write_atomic(os.path.join(args.tasks_dir, ".status", "agents.json"), text)
    write_atomic(cache_path, json.dumps(cache) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
