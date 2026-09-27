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
import { buildThreadFromArchiveInput, summarize } from './store';
import { snippetAround } from './snippet';

/**
 * The `HubStore` deps this adapter actually calls, not the whole method set
 * `@librechat/data-schemas` exposes — the constructor receives exactly what
 * it uses, in line with "a backend module takes its dependencies."
 */
export type HubStoreMethods = Pick<
  HubMethods,
  'upsertHubThread' | 'getHubThread' | 'searchHubThreads' | 'listHubNotes' | 'appendHubNote'
>;

export interface HubMongoStoreOptions {
  methods: HubStoreMethods;
  /** The store is bound to one user at construction, so every call it makes
   * is scoped to that user's own archive — no method here takes a userId,
   * which is what makes a cross-user read impossible to write by mistake. */
  userId: string;
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
  const { methods, userId } = options;

  return {
    async searchThreads(params: HubSearchParams): Promise<HubThreadSummary[]> {
      const results = await methods.searchHubThreads(userId, {
        query: params.query,
        providers: params.providers,
        limit: params.limit,
      });

      const needle = params.query.trim().toLowerCase();
      return results.map((result) => {
        const at = result.searchText.toLowerCase().indexOf(needle);
        const snippet =
          at >= 0 ? snippetAround(result.searchText, at, params.snippetLength) : undefined;
        return {
          id: result.id,
          provider: result.provider as HubProvider,
          title: result.title,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          messageCount: result.messageCount,
          snippet,
        };
      });
    },

    async getThread(id: string): Promise<HubThread | undefined> {
      const record = await methods.getHubThread(userId, id);
      return record ? toThread(record) : undefined;
    },

    async listNotes(threadId?: string): Promise<HubNote[]> {
      return methods.listHubNotes(userId, threadId);
    },

    async appendNote(note: HubNoteInput): Promise<HubNote> {
      return methods.appendHubNote(userId, note);
    },

    async archiveThread(input: HubArchiveThreadInput): Promise<HubThreadSummary> {
      const thread = buildThreadFromArchiveInput(input, new Date());
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
