# MindFerry

MindFerry is a context hub built into this fork: it archives conversations from LibreChat
(and imported exports from other providers) into a canonical, cross-provider thread model,
then serves that archive back out over MCP — so a tool like Claude Code, or Claude.ai's web
connector, can search and read your past conversations as context.

## Enabling it

Nothing is on by default. Add a `contextHub` block to `librechat.yaml`:

```yaml
contextHub:
  enabled: true
  mcp:
    enabled: true
    searchLimit: 20 # 1-100, default 20
    snippetLength: 400 # 80-4000 characters, default 400
    allowNotes: true # let a connected client write notes back, not only read
    allowArchive: true # let a connected client archive a full conversation via archive_thread
  git: # optional: also mirror the archive to a GitHub repo as Markdown
    enabled: true
    owner: your-github-username
    repo: your-notes-repo
    ref: main
    pathPrefix: mindferry
    token: ${MINDFERRY_GIT_TOKEN} # a GitHub token, referenced by env var name only —
    # never write the raw token into librechat.yaml. Set MINDFERRY_GIT_TOKEN in your
    # environment (Railway variables, .env, etc).
```

`contextHub.enabled` controls the feature as a whole (archiving, importing your own exports,
"Save to MindFerry" from the export menu). `contextHub.mcp.enabled` controls whether the
archive is also exposed over `/api/hub/mcp` — you can archive without exposing MCP, but not
the reverse. The `git` block is optional; leave it out if you only want the Mongo-backed
archive.

## Required environment variables

Both are variables this app already uses elsewhere — MindFerry adds no new required env var:

- `DOMAIN_SERVER` — this deployment's public origin (e.g. `https://mindferry.example.com`).
  Used to build every absolute URL the OAuth server below issues. Without it, those URLs
  fall back to the request's `Host` header, which is client-influenced and unsuitable once
  this is reachable from the internet — **set it explicitly for any public deployment.**
- `JWT_SECRET` — signs the short-lived OAuth authorization codes described below. Already
  required by the rest of the app.

## Connecting Claude Code

Add an MCP server entry pointing at `https://<your-domain>/api/hub/mcp`, authenticated with
an Agent API key (Settings → API Keys → Agent API Keys in the LibreChat UI, or minted
automatically the first time a Claude.ai connection below completes). See the endpoint field
in Settings → API Keys once `contextHub.mcp.enabled` is on — it shows the exact URL to paste.

## Connecting Claude.ai (the web app)

Claude.ai's "Add custom connector" dialog only takes a name and a URL — there's no field for
a pre-shared API key — so this app runs a full OAuth 2.1 authorization server
(Dynamic Client Registration + PKCE) to authenticate it instead of trying to fit that flow
into a static key:

1. In Claude.ai, add a custom connector with the URL `https://<your-domain>/api/hub/mcp`.
2. Claude.ai discovers the OAuth flow automatically (via the `WWW-Authenticate` header on the
   MCP endpoint's first, unauthenticated request) and registers itself as a client.
3. It redirects your browser to `https://<your-domain>/mindferry/connect`. Log in to
   LibreChat if you aren't already, then Approve or Deny the connection.
4. Approving mints an Agent API key for you — it shows up in Settings → API Keys →
   Agent API Keys like any other, named `Claude.ai connector (<date>)`, and can be revoked
   there at any time.

Approving requires the `REMOTE_AGENTS` role permission (the same one `/api/api-keys`
requires) — if a user's role doesn't have it, the consent step rejects the request the same
way creating an Agent API key by hand would. Grant it under Admin → Roles if needed.

Every part of this flow — registration, authorize, consent, token exchange, and the two
`/.well-known/oauth-*` discovery documents — is gated behind `contextHub.mcp.enabled`, same
as the MCP endpoint itself: turning that off takes MindFerry's OAuth server down with it.

## Importing a ChatGPT, Claude.ai, or Gemini export

Settings → API Keys → Agent API Keys → Manage shows an importer (next to the MCP endpoint field)
once `contextHub.enabled` is on. Pick a JSON export from ChatGPT, Claude.ai (Settings → Privacy →
Export data), or Gemini (Google Takeout) — the provider is auto-detected from the file's shape, so
there's nothing else to pick. It archives every conversation in the file the same way "Save to
MindFerry" archives one.

## Archiving a live conversation from Claude.ai or Claude Code

`append_note` is deliberately for a short summary, not a transcript — an MCP client that wants the
*whole* conversation kept has `archive_thread` instead, the live-connector counterpart to "Save to
MindFerry" and the file importer, neither of which it can reach. It takes a title and every turn
verbatim (`{ role, text }`), and an optional `sourceId`: passing the same one again updates that
thread instead of creating a duplicate, so a client can re-call it as a conversation grows.
Archived this way, threads carry `provider: "mindferry"`, same as one saved from this app's own
UI. Turning `contextHub.mcp.allowArchive` off removes the tool but leaves `append_note` and the
read tools in place.

## Browsing the archive from MindFerry itself

Settings → API Keys → Agent API Keys → Manage has a **Browse** button (next to the importer) that
opens the archive directly — searchable threads and their notes — for a person who wants to look
without going through an AI client. It reads the same data `search_context`, `get_thread`, and
`read_notes` serve over MCP, through ordinary session-authenticated routes
(`GET /api/hub/threads`, `GET /api/hub/threads/:id`, `GET /api/hub/notes`) rather than the MCP
endpoint, so it works whether or not `contextHub.mcp.enabled` is on.

## Two-way sync between Claude.ai and Claude Code

Claude.ai and Claude Code don't share memory with each other — connecting both to the same
MindFerry hub gives them a common archive and notes store, but something still has to read and
write it. `docs/skills/mindferry-sync/SKILL.md` is a Claude Skill that does that: installed in
either client, it reads notes and searches the archive at the start of a session, and writes a
short summary note at the end (or whenever asked to "sync" or "save this"). Copy it to
`~/.claude/skills/mindferry-sync/SKILL.md` for Claude Code, or upload it as a custom skill in
Claude.ai (Settings → Capabilities → Skills, where available).

## FreeLLMAPI integration

MindFerry can pair with [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi), a
self-hosted proxy that aggregates the free tiers of 20+ LLM providers behind a single
endpoint. Adding it gives every MindFerry user access to 100+ models without configuring
each provider individually. See [docs/freellmapi.md](freellmapi.md) for the setup guide.

## Recommended MCP servers

Beyond the context hub's own MCP endpoint, MindFerry's Agents can connect to any
external MCP server for memory, search, databases, and more. See
[docs/mcp-servers.md](mcp-servers.md) for a curated, self-hosted-first shortlist.

## Semantic search

`search_context` matches keywords by default. Layering semantic re-ranking
on top — so a query finds a thread that used different words for the same
idea — needs an embeddings endpoint (FreeLLMAPI's works) but no schema
change or persisted index. See [docs/semantic-search.md](semantic-search.md).

## Reading a long thread cheaply

`get_thread` used to be all-or-nothing: fetch a whole archived conversation
or nothing. For a long, heavily-branched thread that burns a lot of an MCP
client's context on turns it never needed. `get_thread_outline` is the
middle tier: one line per message — id, role, timestamp, a short preview,
and which segment kinds it carries (`thinking`, `code`, `tool`) — with no
segment bodies. Read the outline, then pass only the message ids that
matter to `get_thread`'s `messageIds` parameter to fetch those in full.
Omitting `messageIds` still returns the whole thread, exactly as before.

Together with `search_context`'s compact result list, this makes three
tiers of increasing cost: search (which threads), outline (which messages
in one thread), full text (only the messages worth reading) — so a client
never has to choose between "a snippet" and "the entire conversation."

## Slack bridge

Send a Slack channel's messages to a MindFerry agent, and post its reply back —
built on the same Remote Agent trigger API `POST /api/agents/v1/events` already
exposes for any external event source. See [docs/slack-bridge.md](slack-bridge.md).

## SearXNG integration

MindFerry's built-in Web Search feature can run against a self-hosted, keyless
[SearXNG](https://docs.searxng.org) instance instead of a paid third-party search
API. See [docs/searxng.md](searxng.md) for the Docker Compose setup.

## What's not built yet

- **Perplexity**: Perplexity has no bulk conversation export, so there's no file format to
  build an import adapter against. Not planned unless that changes.
