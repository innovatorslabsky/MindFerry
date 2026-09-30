---
name: mindferry-sync
description: Two-way context sync between Claude sessions through MindFerry. Use at the start of a session to catch up on relevant prior context, and at the end (or whenever the user asks to "save", "sync", or "remember this") to write a summary back, so a Claude.ai chat and a Claude Code session can pick up each other's work through MindFerry's shared archive and notes.
---

# MindFerry Sync

MindFerry is a context hub: it archives conversations and stores notes, then serves both back
over MCP. Claude.ai and Claude Code don't share memory with each other directly — this skill is
the manual bridge, using MindFerry's `search_context`, `get_thread_outline`, `get_thread`,
`read_notes`, `append_note`, and `archive_thread` tools (named `search_context` etc., typically
prefixed `mcp__mindferry__` or `mcp__MindFerry__` depending on the client).

If none of those tools are available in this session, MindFerry isn't connected here — tell the
user and point them at `docs/mindferry.md` to connect it (Claude.ai: a custom connector; Claude
Code: `claude mcp add --transport http ...`), rather than proceeding without it.

## Catching up (read side)

Do this at the start of a session working on something the user has touched before, or whenever
they ask to "pick up where we left off," "sync," or "check MindFerry":

1. Call `read_notes` first — notes are short, deliberately-written summaries and are cheaper to
   read than reconstructing context from a full thread.
2. Call `search_context` with the topic, project name, or persona the user mentions. If nothing
   turns up under one term, try an adjacent one (a project's short name vs. its full name) before
   concluding there's nothing archived — don't stop at the first empty result.
3. For a promising hit, call `get_thread` to read the full conversation before summarizing it back
   to the user — a search snippet is not enough to act on. For a long or heavily-branched thread,
   call `get_thread_outline` first and pass only the message ids that matter to `get_thread`'s
   `messageIds` parameter, instead of fetching the whole thing.
4. Tell the user plainly what you found (or didn't): which thread or note, roughly when, and the
   one or two facts relevant to the current ask. Don't claim continuity you don't have — you are
   reading an archive, not remembering a prior conversation.

## Saving progress (write side)

Do this at the end of a session, or whenever the user asks to "save this," "sync," or "remember
this for later":

1. Write one `append_note`, not a transcript. Cover: what was decided, what's still open, and the
   concrete next step — the three things the *other* session will need to continue without
   re-reading everything here.
2. Give the note a short, greppable title (a project name, a persona name, a feature name) — the
   read side finds notes by keyword, so an untitled or vaguely-titled note is effectively lost.
3. If the conversation itself is worth keeping verbatim, not just its summary, call
   `archive_thread` with the title and every turn so far (`{ role, text }`) — this is a second,
   separate write from the note. Pass a stable `sourceId` (e.g. this session's own conversation
   id) if you might call it again later in the same conversation, so it updates the existing
   thread instead of creating a duplicate. Also pass `surface`: `"chat"` from Claude.ai,
   `"code"` from Claude Code, so the person can tell where each conversation came from when they
   browse the archive. `append_note` is still the right tool for the short
   bridging summary; `archive_thread` is for keeping the transcript itself. If `archive_thread`
   isn't available (the operator disabled it), tell the user to use "Save to MindFerry" from the
   conversation's export menu instead — the UI-side equivalent of the same archive.
4. Confirm to the user what you wrote and its title, so they know what the other session will see.

## What this does not do

- It does not run automatically — nothing polls MindFerry in the background. Sync happens because
  this skill (or the user, by name) triggers a read or write in a given turn.
- It does not merge or resolve conflicting notes. If two sessions both wrote about the same topic,
  `search_context` returns both; read both rather than trusting whichever comes back first.
- It does not substitute for the full archive. Notes are a small, hand-written bridge — the
  authoritative record of a conversation is the archived thread itself (`get_thread`), not the note
  written about it.
