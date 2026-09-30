import type {
  HubStore,
  HubNote,
  HubNoteInput,
  HubSearchParams,
  HubThreadSummary,
  HubArchiveThreadInput,
} from './store';
import type { HubThread } from '../thread';
import { buildThreadFromArchiveInput, summarize } from './store';
import { hubThreadId, threadText } from '../thread';
import { snippetAround } from './snippet';

/**
 * A complete `HubStore` held in memory. It is the reference implementation of
 * the search and note semantics a persistent store must reproduce, and it lets
 * the MCP server be tested against real behavior rather than a mock.
 */

export interface HubMemoryStoreOptions {
  threads?: readonly HubThread[];
  now?: () => Date;
  newId?: () => string;
}

export function createHubMemoryStore(options: HubMemoryStoreOptions = {}): HubStore {
  const threads = new Map<string, HubThread>();
  const haystacks = new Map<string, string>();
  const notes: HubNote[] = [];
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  const newId = options.newId ?? (() => `note-${++sequence}`);

  for (const thread of options.threads ?? []) {
    threads.set(thread.id, thread);
    haystacks.set(thread.id, `${thread.title}\n${threadText(thread)}`);
  }

  return {
    async searchThreads(params: HubSearchParams): Promise<HubThreadSummary[]> {
      const needle = params.query.trim().toLowerCase();
      if (needle.length === 0) {
        return [];
      }
      const allowed = params.providers?.length ? new Set(params.providers) : undefined;

      const matches: HubThreadSummary[] = [];
      for (const thread of threads.values()) {
        if (allowed && !allowed.has(thread.provider)) {
          continue;
        }
        if (params.surface && (thread.surface ?? 'chat') !== params.surface) {
          continue;
        }
        const haystack = haystacks.get(thread.id) ?? '';
        const at = haystack.toLowerCase().indexOf(needle);
        if (at < 0) {
          continue;
        }
        matches.push(summarize(thread, snippetAround(haystack, at, params.snippetLength)));
      }

      matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return matches.slice(0, params.limit);
    },

    async getThread(id: string): Promise<HubThread | undefined> {
      return threads.get(id);
    },

    async listNotes(threadId?: string, limit?: number): Promise<HubNote[]> {
      const matching =
        threadId === undefined ? notes : notes.filter((note) => note.threadId === threadId);
      return limit === undefined ? [...matching] : matching.slice(-limit);
    },

    async searchNotes(query: string, limit: number): Promise<HubNote[]> {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) {
        return [];
      }
      return notes
        .filter((note) => `${note.title}\n${note.text}`.toLowerCase().includes(needle))
        .reverse()
        .slice(0, limit);
    },

    async appendNote(note: HubNoteInput): Promise<HubNote> {
      const stored: HubNote = { ...note, id: newId(), createdAt: now() };
      notes.push(stored);
      return stored;
    },

    async archiveThread(input: HubArchiveThreadInput): Promise<HubThreadSummary> {
      const sourceId = input.sourceId?.trim();
      const previous = sourceId ? threads.get(hubThreadId('mindferry', sourceId)) : undefined;
      const thread = buildThreadFromArchiveInput(input, now(), previous);
      threads.set(thread.id, thread);
      haystacks.set(thread.id, `${thread.title}\n${threadText(thread)}`);
      return summarize(thread);
    },
  };
}
