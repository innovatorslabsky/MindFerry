# SearXNG Integration

[SearXNG](https://docs.searxng.org) is a self-hosted metasearch engine — it queries
Google, Bing, DuckDuckGo, and others on your behalf and returns aggregated results,
with no API key and no third-party search provider in the loop. Paired with
MindFerry's built-in [Web Search](https://www.librechat.ai/docs/features/web_search)
feature, it gives every user real-time web search without anyone paying for Brave,
Serper, or Tavily.

This is the **native** integration path — MindFerry's Web Search feature has
first-class SearXNG support, so no MCP server is needed (compare with the MCP-based
[SearXNG server](mcp-servers.md#web-search) recommended for custom agents that call
search as a *tool* rather than using the built-in feature).

## What you get

- **Fully keyless search stack**: `searchProvider: searxng` + `scraperProvider: keenable`
  (a keyless page-content fetcher) + `rerankerType: none` needs zero API keys —
  no signup, no billing, no rate-limit quota shared with other MindFerry deployments.
- **No data leaves your infrastructure to a search-as-a-service company** — SearXNG
  itself queries the underlying engines, but the aggregation and ranking happen on
  your own container.
- **Configurable engine mix** — pick which upstream engines to query (Google, Bing,
  Startpage, Qwant, and dozens more) per your preference.

## Quick start (Docker Compose)

```bash
cp docker-compose.searxng.yml docker-compose.override.yaml
```

> **Already using another overlay (e.g. [FreeLLMAPI](freellmapi.md))?** Compose only
> auto-loads one `docker-compose.override.yaml`. Instead of overwriting it, open your
> existing override file and add the `searxng` service block from
> `docker-compose.searxng.yml` into it, and add `depends_on: [searxng]` to your `api`
> service if it isn't there already.

Generate a secret key and paste it into `searxng/settings.yml`:

```bash
openssl rand -hex 32
```

```yaml
# searxng/settings.yml
server:
  secret_key: '<paste the generated key here>'
```

Start everything:

```bash
docker compose up -d
```

That's it — `librechat.yaml` already has the `webSearch` block wired to
`http://searxng:8080`, and `searxng/settings.yml` already enables the JSON output
format MindFerry's Web Search feature needs. Open a chat, toggle **Web Search** on,
and ask something time-sensitive to confirm it works.

## Why SearXNG is never exposed to the host

`docker-compose.searxng.yml` deliberately has **no `ports:` entry** on the `searxng`
service — it's reachable only from other containers on the same Compose network, at
`http://searxng:8080`, never from your host machine or the internet.

This matters because a SearXNG instance with JSON output enabled (required here) is
a known target for scraping and DoS-relay abuse if left open: anyone who can reach it
gets a free, anonymized search API. Keeping it internal-only removes that exposure
entirely — there is no port to scan or hit from outside Docker.

If you have a specific reason to reach SearXNG directly (debugging its own web UI,
for instance), publish a port bound to `127.0.0.1` only, never `0.0.0.0`, and remove
it again once you're done.

## The SSRF allowlist

MindFerry's Web Search feature validates outbound search/scrape destinations and
blocks requests to private, loopback, or link-local addresses by default — the same
protection that stops a malicious search result from tricking the server into
fetching `http://169.254.169.254/` (cloud metadata) or an internal service. Since
`http://searxng:8080` is exactly such a private address, it needs an explicit
exemption:

```yaml
webSearch:
  allowedAddresses:
    - 'searxng:8080'
```

This is already in `librechat.yaml`. If you rename the service or move SearXNG
elsewhere, update this entry to match — a private destination not on this list
simply fails, rather than silently falling back to something less safe.

## Choosing a scraper

`searchProvider: searxng` returns search *results* (titles, snippets, URLs) — a
separate scraper fetches full page content when the model needs more than a
snippet. The config here uses `scraperProvider: keenable`, which is keyless (a key
only lifts its rate limit). If you'd rather use a different scraper:

```yaml
webSearch:
  searchProvider: searxng
  searxngInstanceUrl: 'http://searxng:8080'
  scraperProvider: firecrawl
  firecrawlApiKey: '${FIRECRAWL_API_KEY}'
  allowedAddresses:
    - 'searxng:8080'
```

## Tuning the engine mix

`searxngSearchOptions.engines` in `librechat.yaml` lists which of SearXNG's built-in
engines to query. The shipped default (`google`, `bing`, `startpage`, `qwant`) skips
DuckDuckGo, which serves CAPTCHAs to most self-hosted instances and would otherwise
show up as silently missing results. Check which engines are actually enabled on
your instance's `/config` page (internal-only, so you'll need `docker compose exec`
or a temporary port-forward to view it) before adding more.

## Architecture

```
┌─────────────┐  webSearch   ┌──────────┐   queries    ┌──────────────────┐
│  MindFerry   │─────────────▶│ SearXNG  │─────────────▶│ Google/Bing/etc. │
│  (LibreChat) │  (internal)  │ :8080    │  (outbound)  │                  │
└─────────────┘              └──────────┘              └──────────────────┘
       │
       │ scraperProvider: keenable (page content)
       ▼
   keenable.dev (public, keyless)
```

MindFerry sends the user's query to SearXNG over the internal Docker network.
SearXNG queries the upstream engines and returns aggregated JSON results. When the
model needs full page content rather than a snippet, MindFerry's scraper provider
fetches it separately.
