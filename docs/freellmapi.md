# FreeLLMAPI Integration

FreeLLMAPI is a self-hosted proxy that aggregates the free tiers of 20+ LLM providers
behind a single OpenAI-compatible endpoint. Pairing it with MindFerry gives every user
access to 100+ models — Gemini, Llama, Qwen, DeepSeek, Mistral, and more — without
configuring each provider individually, and without paying for API keys.

## What you get

| Feature | How it helps |
|---|---|
| **One endpoint, many providers** | FreeLLMAPI exposes Groq, Cerebras, Mistral, Google, NVIDIA, Cloudflare, HuggingFace, and others through `/v1/chat/completions`. |
| **Smart routing** | A scoring system picks the fastest healthy provider for each request. When one hits a rate limit, it falls back to the next. |
| **Rate-limit pooling** | Free tiers from 20+ providers stack: combined throughput is far higher than any single provider. |
| **Sticky sessions** | Multi-turn conversations stay on the same model for consistency. |
| **Dashboard** | FreeLLMAPI ships a React admin UI for managing keys, viewing analytics, and reordering fallback chains. |
| **Semantic search** | Its `/v1/embeddings` endpoint can power the context hub's [semantic search](semantic-search.md) — no separate embeddings provider needed. |

## Quick start (Docker Compose)

The simplest setup runs both services side by side. Copy the override file and
configure the environment:

```bash
cp docker-compose.freellmapi.yml docker-compose.override.yaml
```

> **Also setting up [SearXNG](searxng.md)?** Compose only auto-loads one
> `docker-compose.override.yaml` — add the `searxng` service block into this same
> file instead of overwriting it, rather than copying both overlays in sequence.

Generate an encryption key for FreeLLMAPI:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add these variables to your `.env`:

```bash
# FreeLLMAPI
FREELLMAPI_ENCRYPTION_KEY=<the-64-char-hex-key-you-just-generated>
```

Start everything:

```bash
docker compose up -d
```

FreeLLMAPI's dashboard is at `http://localhost:3001`. The first visit asks you to
create an account — it is single-user, so keep it off the public internet. Then:

1. Copy the **unified API key** FreeLLMAPI generated for you (`freellmapi-…`; it is
   created by FreeLLMAPI, you cannot choose it) and add it to `.env` as
   `FREELLMAPI_KEY=<that key>`. Restart MindFerry so it picks the value up.
2. Add your free API keys from providers like Groq, Google AI Studio, Mistral,
   Cerebras, and others. Each key you add widens the pool of models and rate-limit
   headroom available to MindFerry.

## How it connects

The `docker-compose.freellmapi.yml` override adds a `freellmapi` service to the
stack and wires it into MindFerry's Docker network. `librechat.yaml` references
it as a custom endpoint:

```yaml
endpoints:
  custom:
    - name: 'FreeLLMAPI'
      apiKey: '${FREELLMAPI_KEY}'
      baseURL: 'http://freellmapi:3001/v1'
      models:
        default:
          - 'gemini-2.5-flash'
          - 'llama-4-scout-17b-16e-instruct'
          - 'qwen3-235b-a22b'
          - 'deepseek-v4-0324'
          - 'mistral-small-latest'
        fetch: true
      titleConvo: true
      titleModel: 'gemini-2.5-flash'
      modelDisplayLabel: 'FreeLLMAPI'
```

`models.fetch: true` means MindFerry queries FreeLLMAPI's `/v1/models` on startup
and discovers every model whose keys you've added — the `default` list is just a
sensible starting set.

## Adding provider keys to FreeLLMAPI

Open FreeLLMAPI's dashboard at `http://localhost:3001` and add keys for the
providers you want. All of these offer a free tier:

| Provider | Where to get a free key |
|---|---|
| Google AI Studio | [aistudio.google.com](https://aistudio.google.com) |
| Groq | [console.groq.com](https://console.groq.com) |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| Mistral | [console.mistral.ai](https://console.mistral.ai) |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com) |
| GitHub Models | [github.com/marketplace/models](https://github.com/marketplace/models) |
| HuggingFace | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |
| Cloudflare Workers AI | [dash.cloudflare.com](https://dash.cloudflare.com) |
| SiliconFlow | [siliconflow.cn](https://siliconflow.cn) |

The more keys you add, the higher your combined throughput and the wider the model
selection in MindFerry's model picker.

## Running FreeLLMAPI separately

If FreeLLMAPI already runs on another machine or port, skip the Docker override and
point `librechat.yaml` at it directly:

```yaml
endpoints:
  custom:
    - name: 'FreeLLMAPI'
      apiKey: '${FREELLMAPI_KEY}'
      baseURL: 'http://your-freellmapi-host:3001/v1'
      models:
        default: []
        fetch: true
      titleConvo: true
      titleModel: 'gemini-2.5-flash'
      modelDisplayLabel: 'FreeLLMAPI'
```

Set `FREELLMAPI_KEY` in `.env` to the unified API key shown by that FreeLLMAPI
instance's dashboard.

## Hosted deployments (Railway and similar)

`docker-compose.freellmapi.yml` only wires the `freellmapi` hostname inside a local
Docker network. On a platform deploy, run FreeLLMAPI as its own service (image
`ghcr.io/tashfeenahmed/freellmapi:latest`, `PORT=3001`, a persistent volume at
`/app/server/data`, and its own `ENCRYPTION_KEY`), keep it on the private network
rather than giving it a public domain, and point `baseURL` at that service's
internal address. Set `FREELLMAPI_KEY` on the MindFerry service as above.

FreeLLMAPI's own README describes the project as personal-use, single-user software.
If MindFerry serves other people, the free-tier terms of each upstream provider
still apply to the traffic you route through it.

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│  MindFerry   │─────▶│  FreeLLMAPI  │─────▶│  Groq / Google  │
│  (LibreChat) │      │  (proxy)     │      │  Cerebras / …   │
│  port 3080   │      │  port 3001   │      │  20+ providers  │
└─────────────┘      └──────────────┘      └─────────────────┘
       │                     │
       │ MCP (context hub)   │ Dashboard
       ▼                     ▼
  Claude Code /         localhost:3001
  Claude.ai
```

MindFerry sends chat requests to FreeLLMAPI as if it were any OpenAI-compatible
provider. FreeLLMAPI scores the available providers and routes the request to the
healthiest, fastest one. If that provider rate-limits, it retries on the next —
transparently, in the same request.
