/**
 * Query-time semantic re-ranking for the hub's search — not a persisted
 * vector index. `HubMongoStore` embeds the lexical candidate pool and the
 * query together in one batched call and blends the result into ranking,
 * so no schema change or write-path change is needed to turn this on: it
 * only touches how search results already found by `$text` get ordered.
 */

export interface EmbeddingProvider {
  /** Batched: implementations should send every text in one request where the
   *  underlying API supports it, since the caller always passes the whole
   *  candidate pool plus the query together. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface OpenAICompatEmbeddingOptions {
  /** e.g. `http://freellmapi:3001/v1` — any endpoint serving OpenAI's
   *  `POST {baseURL}/embeddings` shape, including FreeLLMAPI. */
  baseURL: string;
  apiKey: string;
  model: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * A minimal OpenAI-compatible `/embeddings` client. Deliberately not a
 * general-purpose HTTP client: one method, one shape, matching exactly what
 * `EmbeddingProvider` needs and nothing an embeddings endpoint doesn't offer.
 */
export function createOpenAICompatEmbeddingProvider(
  options: OpenAICompatEmbeddingOptions,
): EmbeddingProvider {
  const { baseURL, apiKey, model, fetchFn = fetch } = options;
  const url = `${baseURL.replace(/\/+$/, '')}/embeddings`;

  return {
    async embed(texts: readonly string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });

      if (!response.ok) {
        throw new Error(
          `Embeddings request failed: ${response.status} ${await response.text().catch(() => '')}`,
        );
      }

      const body = (await response.json()) as OpenAIEmbeddingResponse;
      const vectors = new Array<number[]>(texts.length);
      for (const entry of body.data) {
        vectors[entry.index] = entry.embedding;
      }
      return vectors;
    },
  };
}

/** Undefined for a zero vector against anything, including itself — callers
 *  treat that as "no similarity signal" rather than a false 0. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | undefined {
  if (a.length !== b.length || a.length === 0) {
    return undefined;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return undefined;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
