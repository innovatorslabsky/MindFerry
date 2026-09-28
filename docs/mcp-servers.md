# Recommended MCP Servers

MindFerry's Agents feature can connect to any MCP server via the `mcpServers` block in
`librechat.yaml`. This page curates a short, high-signal list from the
[awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) directory (2,800+
entries) down to the ones that pair well with a self-hosted, multi-AI chat platform —
prioritizing self-hostable, no-API-key options that fit MindFerry's own local-first
posture, alongside a few widely-used cloud services where no free self-hosted
equivalent exists.

Each entry notes whether it needs a paid API key (💳) or runs free/self-hosted (🏠).

## Memory & knowledge graphs

These overlap conceptually with MindFerry's own [context hub](mindferry.md) — most
useful when an agent needs a *working* memory during a task, distinct from the hub's
*archival* record of finished conversations.

| Server | Repo | Notes |
|---|---|---|
| Memory (official) | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/memory) | 🏠 Knowledge-graph memory, the reference implementation. |
| MCP Memory Service | [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | 🏠 Semantic search over stored memories, autonomous consolidation. |
| Cross-LLM MCP | [JamesANZ/cross-llm-mcp](https://github.com/JamesANZ/cross-llm-mcp) | 🏠 Shares memory and context across different models — same goal as MindFerry's hub, worth comparing notes with rather than running both. |
| cognee | [topoteretes/cognee](https://github.com/topoteretes/cognee/tree/dev/cognee-mcp) | 🏠 Graph + vector hybrid memory, ingests from 30+ sources. |
| ApeRAG | [apecloud/ApeRAG](https://github.com/apecloud/ApeRAG) | 🏠 Full Graph RAG + vector + full-text platform if you outgrow the hub's built-in search. |

## Web search

MindFerry ships its own [Web Search](https://www.librechat.ai/docs/features/web_search)
feature independent of MCP, but these are worth knowing about for custom agents:

| Server | Repo | Notes |
|---|---|---|
| SearXNG | [ihor-sokoliuk/mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng) | 🏠 Points at your own SearXNG instance — fully self-hosted search, no API key at all. Best fit if you want zero external dependency. |
| DuckDuckGo | [nickclyde/duckduckgo-mcp-server](https://github.com/nickclyde/duckduckgo-mcp-server) | 🏠 No API key required, hits DuckDuckGo directly. |
| Brave Search | [brave/brave-search-mcp-server](https://github.com/brave/brave-search-mcp-server) | 💳 Official, generous free tier. |
| Exa | [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server) | 💳 Neural search tuned for AI agents. |

## Databases

Point an agent directly at your own data. MindFerry itself runs on MongoDB, so that
entry is the most natural starting point if you want an agent to query your own
LibreChat data (read-only access recommended — see the security note below).

| Server | Repo | Notes |
|---|---|---|
| MongoDB | [kiliczsh/mcp-mongo-server](https://github.com/kiliczsh/mcp-mongo-server) | 🏠 Matches MindFerry's default database. |
| PostgreSQL (official) | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres) | 🏠 Schema inspection + queries against your own Postgres (e.g. the `vectordb` pgvector container MindFerry's RAG API already uses). |
| Redis (official) | [redis/mcp-redis](https://github.com/redis/mcp-redis) | 🏠 If you run Redis for caching/resumable streams. |
| SQLite (official) | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite) | 🏠 Handy for [FreeLLMAPI](freellmapi.md)'s SQLite store or any local analysis. |
| Supabase (official) | [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) | 💳 Free tier; only relevant if you already use Supabase. |

## Version control

| Server | Repo | Notes |
|---|---|---|
| Git (official) | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/git) | 🏠 Local repo operations, no token needed. |
| GitHub (official) | [github/github-mcp-server](https://github.com/github/github-mcp-server) | 💳 Requires a GitHub token (free); the standard choice for PR/issue-aware agents. |

## Browser automation

| Server | Repo | Notes |
|---|---|---|
| Playwright (official, Microsoft) | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 🏠 Structured accessibility snapshots rather than screenshots — the current recommended default. |
| Puppeteer (official) | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer) | 🏠 Older reference implementation, still widely deployed. |

## Filesystem

| Server | Repo | Notes |
|---|---|---|
| Filesystem (official) | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/filesystem) | 🏠 Already shown as an example in `librechat.example.yaml`. Scope it to a specific directory, never the whole filesystem. |

## Aggregators

Run one MCP endpoint that fans out to many underlying tools or services, instead of
listing each one in `librechat.yaml` individually.

| Server | Repo | Notes |
|---|---|---|
| MetaMCP | [metatool-ai/metatool-app](https://github.com/metatool-ai/metatool-app) | 🏠 Self-hosted middleware with a GUI to manage multiple MCP connections behind one endpoint. |
| Pipedream | [PipedreamHQ/pipedream](https://github.com/PipedreamHQ/pipedream/tree/master/modelcontextprotocol) | 💳 2,500+ app connectors through one server; free tier, paid at scale. |

## Adding one to MindFerry

Add an entry under `mcpServers` in `librechat.yaml`. For a `stdio`-type server (most
of the official reference servers), no extra infrastructure is needed — LibreChat
spawns the process itself:

```yaml
mcpServers:
  filesystem:
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - /app/uploads   # scope this to a specific, non-sensitive directory
```

For an `sse` or `streamable-http` server (self-hosted services like SearXNG, MetaMCP,
or a remote Postgres MCP server), point at its URL instead:

```yaml
mcpServers:
  searxng:
    type: streamable-http
    url: http://searxng-mcp:8080/mcp
```

See the commented `mcpServers` block in `librechat.example.yaml` for the full option
set (OAuth, custom headers, timeouts).

## A security note

An MCP server that can read your database, filesystem, or Git history is a direct
extension of whatever runs it. Before adding one:

- Prefer `🏠` self-hosted entries over `☁️` cloud ones when a self-hosted option exists
  — no third party sees your data or requests.
- Scope filesystem and database servers narrowly (a single directory, a read-only
  database user) rather than granting full access.
- Treat any server you didn't write as untrusted input to your agents, same as any
  other tool call — LibreChat's MCP trust-checkbox dialog exists for this reason.
