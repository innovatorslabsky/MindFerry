# Notion weekly review

A scheduled agent reads the week's archived conversations through MindFerry's MCP endpoint and
writes one digest row to a Notion database. MindFerry keeps the verbatim record; Notion keeps the
distilled decisions and action items, each row pointing back to its source thread ids.

It is built entirely from existing features: scheduled chats, the context hub's MCP tools, and
a Notion MCP server. No application code is involved.

## Cost

One run per week reads about 3K tokens of search snippets plus a small Notion lookup and writes
about 2K, roughly 7K tokens per run and 30K per month. On Claude Haiku that is a few cents a month.
A deployment that also runs FreeLLMAPI ([freellmapi.md](freellmapi.md)) can point the agent at it
instead and stay inside free-tier limits; the Railway deployment does not run it. The prompt below only uses the
first search tier and reaches for `get_thread_outline` / `get_thread` with `messageIds` when a
thread needs a closer look, so a long thread is never read whole.

## Setup

1. **Notion.** The `MindFerry Weekly Review` database already holds the schema the prompt expects
   (`Week` title, `Week start`, `Threads reviewed`, `Decisions`, `Action items`,
   `Open questions`, `MindFerry thread IDs`, `Status`). Create an internal integration at
   notion.so/profile/integrations, copy its secret into `NOTION_TOKEN`, then open the database →
   `…` → Connections and add the integration.
2. **MindFerry key.** Settings → API Keys → Agent API Keys, create a key, and put it in
   `MINDFERRY_AGENT_API_KEY`.
3. **Config.** `librechat.yaml` in this repo already declares the `mindferry-hub` and `notion`
   servers and enables schedules. `DOMAIN_SERVER` must be set (see [mindferry.md](mindferry.md)).
   Without Redis, also set `SCHEDULES_SINGLE_PROCESS=true`. On Railway, set `NOTION_TOKEN`,
   `MINDFERRY_AGENT_API_KEY` and `SCHEDULES_SINGLE_PROCESS` as service variables; the compose files
   read them from `.env` through `env_file`.

   The `notion` server is `@notionhq/notion-mcp-server`, started with `npx` (present in the
   `node:24-alpine` image). It reads `NOTION_TOKEN` (checked against v2.5.2) and exposes the Notion
   API as tools, so the first run downloads the package.
4. **Agent.** Create an agent, enable both MCP servers, choose a small model (Claude Haiku on the
   Anthropic endpoint, or `gemini-2.5-flash` through FreeLLMAPI where it runs), and paste the instructions below.
5. **Schedule.** Create a scheduled chat on that agent, weekly, Monday morning.

Scheduled runs have no browser session. If the Notion secret is wrong or missing the occurrence
reports `mcp_configuration_missing` and the schedule disables itself; fix the variable and
re-enable it. See `packages/api/src/schedules/README.md`.

## Agent instructions

```
You write the weekly digest of my archived conversations into Notion. Work in this order and
stop early when a step finds nothing.

1. Compute the ISO week label for the previous Monday–Sunday, for example 2026-W41, and that
   Monday's date.
2. Query the Notion data source "MindFerry Weekly Review" (database id
   2a7eb145-6aa0-4e0d-a2eb-98768c4d22fa, data source id dceb2cfd-de1b-4486-bc80-c4d06af66f74)
   for a row whose Week equals that label. If one exists, update it instead of creating another.
3. Call mindferry-hub search_context several times with short queries that cover the week's
   topics (limit 20, no more than 5 calls). Keep only threads whose `updated` falls inside the
   week. Do not call get_thread on a whole thread. When a snippet is not enough, call
   get_thread_outline and then get_thread with only the messageIds you need.
4. From what you read, write:
   - Decisions: what was settled, one line each, with the thread id in brackets.
   - Action items: concrete next steps, one line each, with the thread id in brackets.
   - Open questions: what is still unresolved.
5. Create or update the row: Week, Week start, Threads reviewed (count), Decisions,
   Action items, Open questions, MindFerry thread IDs (comma-separated), Status = Draft.
6. If the week has no threads, create the row with Threads reviewed = 0 and nothing else.

Never invent a decision. If a snippet is ambiguous, list it under Open questions.
Do not write anything to MindFerry; this agent only reads it.
```

The `Week` lookup in step 2 is what makes a manual re-run safe: it updates the same row.
