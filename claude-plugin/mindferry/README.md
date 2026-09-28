# MindFerry Claude Code plugin

Connects Claude Code to your [MindFerry](https://github.com/innovatorslabsky/MindFerry) context
hub automatically: mounts the hub as an MCP server, reads its notes at the start of every
session, and (once configured) saves a summary back when a session ends — the automatic version
of the manual steps in
[`docs/skills/mindferry-sync/SKILL.md`](../../docs/skills/mindferry-sync/SKILL.md).

## What it does

- **Adds the `mindferry-hub` MCP server** — `search_context`, `get_thread`, `get_thread_outline`,
  `read_notes`, `append_note`, and `archive_thread` become available as tools in every session,
  the same as [manually connecting](../../docs/mindferry.md#connecting-claude-code) does.
- **`SessionStart` hook** — reads the hub's notes and surfaces them as context automatically, so
  you don't have to ask Claude to check MindFerry every time.
- **`Stop` hook** — fires after every assistant turn, but only ever writes to local disk: it
  appends Claude's last reply to a small buffer file keyed by session id. It never calls the hub,
  so it stays safe to run on every single turn.
- **`SessionEnd` hook** — saves a note back to the hub when the session ends (once per session, not
  once per turn), built from the user's own turns (read from Claude Code's transcript) plus
  whatever the `Stop` hook buffered along the way. The buffer file is deleted once read.

The note-save itself lives only in `SessionEnd`, deliberately: `Stop` fires after every single
response, and a hub call on every turn would either flood the hub with one note per turn or add
network latency to every response. Neither hook ever blocks Claude Code: an unreachable or
misconfigured hub degrades to "no extra context" / "nothing saved," logged to stderr, never a
failed session start, a stuck response, or a stuck session end.

### What actually gets saved

The last ~8 things you typed, verbatim (truncated), plus the last ~8 things Claude said in reply —
not a generated summary. No hook budget allows for an extra model call, so a literal record is what
stays honest if the session covered several unrelated things. User turns come from Claude Code's
own transcript file, whose internal format isn't a documented, stable contract — the read is
defensive (a line it doesn't recognize is skipped, never a crash), but a future Claude Code version
could still change that format enough to turn this into "nothing extracted" for that half of the
note; the reply half doesn't share that risk, since the `Stop` hook writes it itself in a format
this plugin controls. Either half being empty fails safe: a smaller note, or none at all if both
are empty, same as an unreachable hub.

## Setup

You need an MindFerry deployment with the context hub enabled (see
[`docs/mindferry.md`](../../docs/mindferry.md)) and an Agent API key for it (Settings → API Keys
→ Agent API Keys — the same key type [`docs/mindferry.md`](../../docs/mindferry.md) describes for
connecting Claude Code manually). That user needs the `REMOTE_AGENTS` role permission.

### Try it for one session, without installing

```bash
claude --plugin-dir /path/to/MindFerry/claude-plugin/mindferry
```

You'll be prompted for your hub URL and API key on first use.

### Install it persistently

```bash
claude plugin install /path/to/MindFerry/claude-plugin/mindferry
```

(Or point `--plugin-dir` / the install command at a git clone of this repo — plugin discovery
looks in `claude-plugin/mindferry/`, unrelated to how you got the files onto disk.)

## Verifying it's connected

`/mcp` inside a Claude Code session should list `mindferry-hub`. Ask Claude to "check MindFerry
notes" to confirm the tools actually respond.

## Uninstalling

```bash
claude plugin uninstall mindferry
```

Your hub URL and API key are removed from local settings; nothing on the MindFerry side changes
(your API key still works if you reconnect later — revoke it from Settings → API Keys if you want
it gone entirely).
