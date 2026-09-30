import { randomUUID } from 'node:crypto';
import type { HubThread, HubMessage, HubProvider } from '../thread';
import { hubThreadId } from '../thread';

/**
 * The storage surface the hub's MCP server needs, and nothing more. The caller
 * constructs it, so the server can be exercised against a real in-memory store
 * without a database and moved behind a different one without a rewrite.
 */

export interface HubThreadSummary {
  id: string;
  provider: HubProvider;
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
  /** Already clamped by the server to the configured ceiling. */
  limit: number;
  snippetLength: number;
}

/** Which client wrote a note — lets a note left by one surface read as
 *  distinct from one left by another when several clients share the archive. */
export type HubNoteSurface = 'chat' | 'code' | 'agent' | 'other';

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
  messages: HubArchiveMessageInput[];
}

export interface HubStore {
  searchThreads(params: HubSearchParams): Promise<HubThreadSummary[]>;
  getThread(id: string): Promise<HubThread | undefined>;
  /** Oldest first; with `limit`, only the most recent `limit` notes. */
  listNotes(threadId?: string, limit?: number): Promise<HubNote[]>;
  appendNote(note: HubNoteInput): Promise<HubNote>;
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
export function buildThreadFromArchiveInput(input: HubArchiveThreadInput, now: Date): HubThread {
  const sourceId = input.sourceId?.trim() || randomUUID();
  let parentId: string | null = null;
  const messages: HubMessage[] = input.messages.map((message, index) => {
    const id = `m${index + 1}`;
    const converted: HubMessage = {
      id,
      role: message.role,
      createdAt: now,
      segments: [{ kind: 'text', text: message.text }],
      parentId,
    };
    parentId = id;
    return converted;
  });

  return {
    id: hubThreadId('mindferry', sourceId),
    provider: 'mindferry',
    sourceId,
    title: input.title.trim() || 'Untitled conversation',
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

export function summarize(thread: HubThread, snippet?: string): HubThreadSummary {
  return {
    id: thread.id,
    provider: thread.provider,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    snippet,
  };
}
