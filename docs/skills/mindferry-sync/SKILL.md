---
name: mindferry-sync
description: Two-way context sync between Claude sessions through MindFerry. Use at the start of a session to catch up on relevant prior context, at the end (or whenever the user asks to "save", "sync", or "remember this") to write a summary back, and whenever the user asks to import, move or open a conversation in MindFerry ("import this chat into MindFerry", "đưa chat này vào MindFerry", "open yesterday's Claude Code session here"), so a Claude.ai chat, a Claude Code session and MindFerry's own chat list can pick up each other's work.
---

# MindFerry Sync

MindFerry is a context hub: it archives conversations and stores notes, then serves both back
over MCP. Claude.ai and Claude Code don't share memory with each other directly — this skill is
the manual bridge, using MindFerry's `search_context`, `get_thread_outline`, `get_thread`,
`read_notes`, `append_note`, `archive_thread`, and `open_in_chat` tools (named `search_context` etc., typically
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
3. When the user asks to save, keep, store, import or "lưu" *the chat* or *the conversation*
   (not only a summary, decision or idea), they want the whole transcript, so also archive it as
   described in "Archiving the whole conversation" below. Do not stop at the note. If
   `archive_thread` isn't available (the operator disabled it), say so and tell them to use the
   app's own export instead (Claude.ai: Settings → Privacy → Export data, then Import in MindFerry).
4. Confirm to the user what you wrote and its title, so they know what the other session will see.

## Archiving the whole conversation

`archive_thread` is how the full chat gets into MindFerry by prompt — the same content an exported
JSON file carries, sent through the connector instead of a file.

1. Send every turn of this conversation, oldest first, each `{ role, text }` exactly as written —
   the user's messages and your replies, not a paraphrase, summary or excerpt. Leave out tool
   calls and their raw output, but keep your text around them.
2. Pass a stable `sourceId` for this conversation (reuse it every time you archive this same
   conversation, so it updates one thread), a descriptive `title`, and `surface`: `"chat"` from
   Claude.ai, `"code"` from Claude Code. Getting `surface` right is what lets the person tell
   where a conversation came from.
3. A long conversation will not fit in one call. Send it in parts of about 20 turns: the first
   with `startAt: 0`, each next one with `startAt` set to the number of turns already sent and the
   same `sourceId`, until the last turn is in. Resending a part is safe. Check the message count
   in each reply matches what you sent.
4. You can only send what is still in your context. If earlier parts of this conversation were
   summarized away and you no longer have their exact text, say so plainly — do not reconstruct
   or invent turns — and tell the user the faithful copy is the app's own export (Claude.ai:
   Settings → Privacy → Export data), which the Import button in MindFerry takes.
5. Tell the user the thread id and how many turns were archived.

## Importing a conversation by prompt

When the user asks to import, move, copy or open a conversation in MindFerry — in any language,
for example "import this chat into MindFerry", "đưa chat này qua MindFerry", "lưu nguyên văn rồi
mở trong MindFerry" — do it without asking them to export a file:

1. **This conversation:** archive it as in "Archiving the whole conversation" above. The reply
   gives the thread id (`mindferry:<sourceId>`).
2. **Another conversation already in the archive** (a Claude Code session the plugin archived, an
   earlier Claude.ai chat): find it with `search_context` — pass `surface: "code"` or
   `surface: "chat"` when the user names the client — and confirm the title and date with the user
   if more than one fits.
3. If the user wants it as a chat in MindFerry's own chat list (they said import into MindFerry,
   open it in MindFerry, or continue it there), call `open_in_chat` with the thread id and give
   them the link it returns. Each call makes a new chat, so call it once per conversation and do
   not call it again on a later sync of the same conversation unless they ask. If the tool isn't
   offered, the operator has `contextHub.mcp.allowChatImport` off: say the conversation is in
   the archive and they can open it with Continue in chat from Chat History → Archived.
4. If they want to keep working on it in *this* client instead, read it with `get_thread`
   (outline first for a long one) and carry on from it.

## What this does not do

- It does not run automatically — nothing polls MindFerry in the background. Sync happens because
  this skill (or the user, by name) triggers a read or write in a given turn. (The Claude Code
  plugin is the exception: it archives every Claude Code session on its own.)
- It does not merge or resolve conflicting notes. If two sessions both wrote about the same topic,
  `search_context` returns both; read both rather than trusting whichever comes back first.
- It does not substitute for the full archive. Notes are a small, hand-written bridge — the
  authoritative record of a conversation is the archived thread itself (`get_thread`), not the note
  written about it.
