import { logger } from '@librechat/data-schemas';
import type { HubMethods, HubThreadRecord, HubMessageRecord } from '@librechat/data-schemas';
import type {
  HubStore,
  HubNote,
  HubNoteInput,
  HubSearchParams,
  HubThreadSummary,
  HubArchiveThreadInput,
} from './store';
import type { HubThread, HubMessage, HubProvider } from '../thread';
import type { EmbeddingProvider } from './embeddings';
import { buildThreadFromArchiveInput, summarize } from './store';
import { cosineSimilarity } from './embeddings';
import { snippetAround } from './snippet';
import { hubThreadId } from '../thread';

/**
 * Query-time re-ranking, not a persisted vector index (see embeddings.ts):
 * the store embeds the lexical candidate pool plus the query in one batched
 * call and blends that into ranking. Off by default (`semanticSearch`
 * undefined) — `searchThreads` then behaves exactly as it did before this
 * option existed.
 */
export interface HubSemanticSearchOptions {
  provider: EmbeddingProvider;
  /** 0 = lexical rank only, 1 = semantic similarity only. */
  weight: number;
  /** Lexical candidates pulled and re-embedded before truncating to the
   *  caller's `limit` — must be >= limit to have anything to re-rank. */
  candidatePoolSize: number;
}

/** Best lexical rank scores 1, worst scores 0 — used because `HubThreadSearchResult`
 *  carries no numeric relevance score, only rank order (see mongoStore.ts's
 *  header comment on why: `$text`'s score isn't exposed past the data-schemas
 *  boundary). A single candidate has nothing to rank against, so it scores 1. */
function lexicalRankScore(rank: number, poolSize: number): number {
  return poolSize > 1 ? 1 - rank / (poolSize - 1) : 1;
}

async function rerankBySemanticSimilarity(
  candidates: ReadonlyArray<{ summary: HubThreadSummary; searchText: string }>,
  query: string,
  semantic: HubSemanticSearchOptions,
): Promise<HubThreadSummary[]> {
  if (candidates.length === 0) {
    return [];
  }
  let vectors: number[][];
  try {
    const texts = [query, ...candidates.map((candidate) => candidate.searchText.slice(0, 2000))];
    vectors = await semantic.provider.embed(texts);
  } catch (error) {
    logger.warn('[HubMongoStore] Semantic re-rank failed, keeping lexical order:', error);
    return candidates.map((candidate) => candidate.summary);
  }

  const [queryVector, ...candidateVectors] = vectors;
  const scored = candidates.map((candidate, rank) => {
    const lexicalScore = lexicalRankScore(rank, candidates.length);
    const similarity =
      queryVector && candidateVectors[rank]
        ? cosineSimilarity(queryVector, candidateVectors[rank])
        : undefined;
    const blended =
      similarity === undefined
        ? lexicalScore
        : (1 - semantic.weight) * lexicalScore + semantic.weight * similarity;
    return { summary: candidate.summary, blended };
  });

  scored.sort((a, b) => b.blended - a.blended);
  return scored.map((entry) => entry.summary);
}

/**
 * The `HubStore` deps this adapter actually calls, not the whole method set
 * `@librechat/data-schemas` exposes — the constructor receives exactly what
 * it uses, in line with "a backend module takes its dependencies."
 */
export type HubStoreMethods = Pick<
  HubMethods,
  | 'upsertHubThread'
  | 'getHubThread'
  | 'searchHubThreads'
  | 'listHubNotes'
  | 'appendHubNote'
  | 'searchHubNotes'
>;

export interface HubMongoStoreOptions {
  methods: HubStoreMethods;
  /** The store is bound to one user at construction, so every call it makes
   * is scoped to that user's own archive — no method here takes a userId,
   * which is what makes a cross-user read impossible to write by mistake. */
  userId: string;
  /** Undefined (the default) reproduces pre-existing lexical-only behavior
   *  exactly — see `HubSemanticSearchOptions`. */
  semanticSearch?: HubSemanticSearchOptions;
}

function toMessageRecord(message: HubMessage): HubMessageRecord {
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    segments: message.segments,
    parentId: message.parentId,
    model: message.model,
  };
}

function toThreadRecord(thread: HubThread): HubThreadRecord {
  return {
    id: thread.id,
    provider: thread.provider,
    sourceId: thread.sourceId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: thread.messages.map(toMessageRecord),
  };
}

function toThread(record: HubThreadRecord): HubThread {
  return {
    id: record.id,
    provider: record.provider as HubProvider,
    sourceId: record.sourceId,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messages: record.messages,
  };
}

/**
 * Persists the hub archive through `@librechat/data-schemas`, so the
 * MCP server's storage survives a restart and is shared across replicas.
 * Every call goes through the data-schemas method layer rather than a
 * mongoose model directly — this file never sees `Types.ObjectId` or
 * `FilterQuery`, only the plain records that layer returns.
 */
export function createHubMongoStore(options: HubMongoStoreOptions): HubStore {
  const { methods, userId, semanticSearch } = options;

  return {
    async searchThreads(params: HubSearchParams): Promise<HubThreadSummary[]> {
      const fetchLimit = semanticSearch
        ? Math.max(params.limit, semanticSearch.candidatePoolSize)
        : params.limit;

      const results = await methods.searchHubThreads(userId, {
        query: params.query,
        providers: params.providers,
        limit: fetchLimit,
      });

      const needle = params.query.trim().toLowerCase();
      const candidates = results.map((result) => {
        const at = result.searchText.toLowerCase().indexOf(needle);
        const snippet =
          at >= 0 ? snippetAround(result.searchText, at, params.snippetLength) : undefined;
        const summary: HubThreadSummary = {
          id: result.id,
          provider: result.provider as HubProvider,
          title: result.title,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          messageCount: result.messageCount,
          snippet,
        };
        return { summary, searchText: result.searchText };
      });

      if (!semanticSearch) {
        return candidates.map((candidate) => candidate.summary);
      }

      const reranked = await rerankBySemanticSimilarity(candidates, params.query, semanticSearch);
      return reranked.slice(0, params.limit);
    },

    async getThread(id: string): Promise<HubThread | undefined> {
      const record = await methods.getHubThread(userId, id);
      return record ? toThread(record) : undefined;
    },

    async listNotes(threadId?: string, limit?: number): Promise<HubNote[]> {
      return methods.listHubNotes(userId, threadId, limit);
    },

    async searchNotes(query: string, limit: number): Promise<HubNote[]> {
      return methods.searchHubNotes(userId, query, limit);
    },

    async appendNote(note: HubNoteInput): Promise<HubNote> {
      return methods.appendHubNote(userId, note);
    },

    async archiveThread(input: HubArchiveThreadInput): Promise<HubThreadSummary> {
      const sourceId = input.sourceId?.trim();
      const record = sourceId
        ? await methods.getHubThread(userId, hubThreadId('mindferry', sourceId))
        : null;
      const previous = record ? toThread(record) : undefined;
      const thread = buildThreadFromArchiveInput(input, new Date(), previous);
      await methods.upsertHubThread(userId, toThreadRecord(thread));
      return summarize(thread);
    },
  };
}

/** Persists one archived thread for a user. Exposed for the import/ingest path. */
export async function archiveHubThread(
  methods: Pick<HubMethods, 'upsertHubThread'>,
  userId: string,
  thread: HubThread,
): Promise<void> {
  await methods.upsertHubThread(userId, toThreadRecord(thread));
}
