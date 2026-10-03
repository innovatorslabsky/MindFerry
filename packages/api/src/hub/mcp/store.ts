import { randomUUID } from 'node:crypto';
import type { HubThread, HubMessage, HubProvider, HubSurface } from '../thread';
import { hubThreadId } from '../thread';

/**
 * The storage surface the hub's MCP server needs, and nothing more. The caller
 * constructs it, so the server can be exercised against a real in-memory store
 * without a database and moved behind a different one without a rewrite.
 */

export interface HubThreadSummary {
  id: string;
  provider: HubProvider;
  surface?: HubSurface;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  /** Text around the match, already bounded by the caller's snippet length. */
  snippet?: string;
}

export interface HubSearchParams {
  query: string;
  providers?: readonly HubProvider[];
  surface?: HubSurface;
  /** Already clamped by the server to the configured ceiling. */
  limit: number;
  snippetLength: number;
}

/** Which client wrote a note — lets a note left by one surface read as
 *  distinct from one left by another when several clients share the archive. */
export type HubNoteSurface = HubSurface;

export interface HubNoteInput {
  title: string;
  text: string;
  /** Anchors the note to a thread when the writer knows which one it is about. */
  threadId?: string;
  surface?: HubNoteSurface;
  /** Distinguishes one session from another of the same surface. */
  sessionTag?: string;
}

export interface HubNote extends HubNoteInput {
  id: string;
  createdAt: Date;
}

/** One turn of a conversation an MCP client submits verbatim for archiving. */
export interface HubArchiveMessageInput {
  role: 'user' | 'assistant';
  text: string;
}

export interface HubArchiveThreadInput {
  title: string;
  /** Pass the same id again to update this thread instead of creating a new one. */
  sourceId?: string;
  /** Which client is archiving it; kept from the earlier archive when omitted on an update. */
  surface?: HubSurface;
  messages: HubArchiveMessageInput[];
  /**
   * Where `messages` start in the conversation, counting turns from 0. Omitted,
   * they are the whole conversation. Set, the thread keeps its turns before
   * that point and these replace the rest — how a conversation too long for one
   * call is archived in parts under one `sourceId`. Sending a part again is safe.
   */
  startAt?: number;
  /** Largest thread the archive keeps, in UTF-8 bytes of turn text, counting earlier parts. */
  maxBytes?: number;
}

/** An `archiveThread` input the store refuses, with a message the client can act on. */
export class HubArchiveInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HubArchiveInputError';
  }
}

export interface HubStore {
  searchThreads(params: HubSearchParams): Promise<HubThreadSummary[]>;
  getThread(id: string): Promise<HubThread | undefined>;
  /** Oldest first; with `limit`, only the most recent `limit` notes. */
  listNotes(threadId?: string, limit?: number): Promise<HubNote[]>;
  appendNote(note: HubNoteInput): Promise<HubNote>;
  /** Notes matching `query` in title or body, best match first. */
  searchNotes(query: string, limit: number): Promise<HubNote[]>;
  /** Archives a full, verbatim conversation submitted by an MCP client — the
   *  live-connector counterpart to "Save to MindFerry" and the file importer,
   *  neither of which an external client can reach. */
  archiveThread(input: HubArchiveThreadInput): Promise<HubThreadSummary>;
}

/**
 * Builds a linear thread from an MCP client's flat turn list — there is no
 * branching to preserve here, unlike a provider export, so each message's
 * parent is simply the one before it. Shared by every `HubStore`
 * implementation's `archiveThread`, rather than each rebuilding this shape.
 */
export function buildThreadFromArchiveInput(
  input: HubArchiveThreadInput,
  now: Date,
  previous?: HubThread,
): HubThread {
  const sourceId = input.sourceId?.trim() || randomUUID();
  const startAt = input.startAt ?? 0;
  const kept = previous?.messages.slice(0, startAt) ?? [];
  if (kept.length < startAt) {
    throw new HubArchiveInputError(
      `This part starts at turn ${startAt}, but the archived thread has only ${kept.length} turns. ` +
        `Send the earlier turns first, or pass startAt: ${kept.length}.`,
    );
  }

  let parentId: string | null = kept.length > 0 ? kept[kept.length - 1].id : null;
  const added: HubMessage[] = input.messages.map((message, offset) => {
    const index = startAt + offset;
    const id = `m${index + 1}`;
    const earlier = previous?.messages[index];
    const unchanged =
      earlier?.id === id &&
      earlier.role === message.role &&
      earlier.segments.length === 1 &&
      earlier.segments[0].text === message.text;
    const converted: HubMessage = {
      id,
      role: message.role,
      createdAt: unchanged ? earlier.createdAt : now,
      segments: [{ kind: 'text', text: message.text }],
      parentId,
    };
    parentId = id;
    return converted;
  });
  const messages = [...kept, ...added];

  if (input.maxBytes !== undefined) {
    const bytes = messages.reduce(
      (total, message) =>
        total + message.segments.reduce((sum, segment) => sum + Buffer.byteLength(segment.text), 0),
      0,
    );
    if (bytes > input.maxBytes) {
      throw new HubArchiveInputError(
        `With this part the thread would be ${bytes} bytes, over the ${input.maxBytes}-byte limit for one archived thread. Archive the rest as a new thread with a different sourceId.`,
      );
    }
  }

  return {
    id: hubThreadId('mindferry', sourceId),
    provider: 'mindferry',
    surface: input.surface ?? previous?.surface,
    sourceId,
    title: input.title.trim() || 'Untitled conversation',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    messages,
  };
}

export function summarize(thread: HubThread, snippet?: string): HubThreadSummary {
  return {
    id: thread.id,
    provider: thread.provider,
    surface: thread.surface,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    snippet,
  };
}
