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
ERROR_KINDS = (
    ("billing", re.compile(r"billing|\b402\b|credit|balance|quota|payment", re.I)),
    ("auth", re.compile(r"\b40[13]\b|unauthori[sz]ed|forbidden|invalid.{0,12}(key|token)|auth", re.I)),
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


def parse_hermes_list(text, job_id):
    """The block for one job in `hermes cron list`: whether it is active and how its last run went."""
    block = None
    for chunk in re.split(r"\n(?=\S)", text):
        if chunk.startswith(job_id):
            block = chunk
            break
    if block is None:
        return None
    head = re.match(r"\S+\s+\[([^\]]+)\]", block)
    job = {"enabled": bool(head and head.group(1).strip().lower() == "active")}
    last = re.search(r"^\s*Last run:\s+(\S+)(?:\s+(\S+))?", block, re.M)
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
        ("hermes", HERMES, ["hermes", "--version"], hermes_job),
        ("openclaw", OPENCLAW, ["openclaw", "--version"], openclaw_job),
    ):
        entry = {}
        container = container_info(spec["container"])
        if container:
            entry["container"] = container
            if container["state"] == "running":
                version = version_of(spec["container"], version_cmd, container.get("startedAt"), cache, now)
                if version:
                    entry["version"] = version
                job = job_reader(spec)
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
