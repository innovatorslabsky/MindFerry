# Semantic Search for the Context Hub

`search_context` (the hub's MCP search tool — see [docs/mindferry.md](mindferry.md))
matches on keywords by default, via MongoDB's `$text` index. That misses a
conversation that used different words for the same idea — asking "how do I
reset my password" won't find a thread that only ever said "forgot my login."

Semantic search layers a second signal on top, without replacing the first:
MindFerry embeds your query and the candidate threads' text, then blends
semantic similarity into the ranking `search_context` already returns.

## What this is *not*

- **Not a persisted vector index.** No embeddings are stored. Every search
  embeds the current lexical candidate pool and the query together, in one
  batched call, at query time. This keeps the feature to a pure addition on
  the search path — no schema migration, no re-indexing when you turn it on,
  nothing to keep in sync when a thread's content changes.
- **Not a replacement for keyword search.** MongoDB's `$text` index still
  finds the candidate pool first; semantic similarity only re-ranks *within*
  that pool. A thread that shares no keywords with your query — and so never
  enters the candidate pool — won't surface no matter how semantically close
  it is. This is a deliberate scope: true keyword-free semantic search would
  need a real vector index, which is a bigger feature than a query-time
  re-rank.
- **Off by default.** No `contextHub.mcp.semanticSearch` block, no behavior
  change — `search_context` works exactly as it did before this existed.

## Setup

Point it at any OpenAI-compatible `/embeddings` endpoint. The natural choice,
if you've set up [FreeLLMAPI](freellmapi.md) already, is to reuse it — add an
embedding-capable provider key (Google, NVIDIA NIM, and others expose one) on
its dashboard, then:

```yaml
contextHub:
  mcp:
    semanticSearch:
      enabled: true
      baseURL: 'http://freellmapi:3001/v1'
      apiKey: '${FREELLMAPI_KEY}' # same unified key freellmapi.md's setup uses
      model: 'text-embedding-3-small' # pick a model FreeLLMAPI has a key for
      weight: 0.5 # 0 = lexical rank only, 1 = semantic similarity only
      candidatePoolSize: 50 # lexical candidates re-ranked before truncating to searchLimit
```

Any other OpenAI-compatible embeddings endpoint works the same way — swap
`baseURL`, `apiKey`, and `model` for your provider's.

## Tuning `weight`

- **`0`** — identical to lexical-only search; the option is configured but
  contributes nothing. Useful for A/B-testing the feature without fully
  committing.
- **`0.5`** (default) — splits the difference. A thread that ranks well on
  both signals wins; one that's purely a keyword coincidence with no semantic
  relevance loses ground to a better semantic match elsewhere in the pool.
- **`1`** — ranks purely by semantic similarity within the lexical candidate
  pool, ignoring `$text`'s own relevance order entirely.

There's no universally "right" value — it depends on how literally your
queries tend to match your archive's wording. Start at `0.5` and adjust from
what you see.

## Tuning `candidatePoolSize`

This is the size of the pool `$text` search returns *before* re-ranking —
not the number of results you get back (that's still `searchLimit`, or the
caller's `limit`, unchanged). A larger pool gives the semantic pass more
candidates to find a better match among, at the cost of one bigger batched
embeddings call per search. 50 is a reasonable default for a personal
archive; raise it if you have thousands of threads sharing common keywords.

## Snippets on a semantic-only match

`search_context`'s snippet is still extracted by finding your query's exact
words in the matched thread's text. A thread that ranks highly purely on
semantic similarity — with no literal keyword overlap — will show up with no
snippet, since there's no exact-match position to extract one around. The
thread itself is still returned and correctly ranked; only the preview text
is empty in that case.

## If the embeddings endpoint is unreachable

A failed embeddings call doesn't fail the search — `search_context` falls
back to plain lexical ordering for that one request and logs a warning
server-side. Turning this feature on can never make search stop working,
only stop improving on the lexical baseline temporarily.

## Cost

One embeddings call per search, sized `candidatePoolSize + 1` texts (the
candidates plus the query), each capped at 2000 characters. Against a
self-hosted FreeLLMAPI instance with a free-tier embedding provider key, this
costs nothing beyond that provider's own rate limit. Against a paid
embeddings API, budget for `candidatePoolSize + 1` embedding calls' worth of
tokens per search.
