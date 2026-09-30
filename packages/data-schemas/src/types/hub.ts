/**
 * Public, storage-engine-neutral shapes for the context hub archive. These
 * intentionally duplicate the field shapes in `@librechat/api`'s canonical
 * `HubThread` rather than importing them — `data-schemas` does not depend on
 * `packages/api` — and carry no Mongoose type (`ObjectId`, `Document`,
 * `FilterQuery`) in any exported signature, so a caller depends on the data
 * these describe rather than on Mongo.
 */

export type HubSegmentKind = 'text' | 'thinking' | 'code' | 'tool';

export interface HubSegmentRecord {
  kind: HubSegmentKind;
  text: string;
  language?: string;
  name?: string;
}

export type HubMessageRole = 'user' | 'assistant' | 'system';

export interface HubMessageRecord {
  id: string;
  role: HubMessageRole;
  createdAt: Date;
  segments: HubSegmentRecord[];
  parentId: string | null;
  model?: string;
}

export interface HubThreadRecord {
  /** Canonical `${provider}:${sourceId}`. */
  id: string;
  provider: string;
  /** Which client the conversation came from; absent for imported exports, which read as `chat`. */
  surface?: HubNoteSurface;
  sourceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: HubMessageRecord[];
}

export interface HubThreadSearchQuery {
  query: string;
  providers?: readonly string[];
  /** Only threads from this client; `chat` also matches threads with no recorded surface. */
  surface?: HubNoteSurface;
  limit: number;
}

export interface HubThreadSearchResult {
  id: string;
  provider: string;
  surface?: HubNoteSurface;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  /** Denormalized title + message text this row matched against. */
  searchText: string;
}

/**
 * Which client wrote a note — `chat` (claude.ai web), `code` (Claude Code),
 * `agent` (an external agent such as Muse, Hermes, or OpenClaw), or `other`.
 * This is what lets a note left by one surface read as distinct from one
 * left by another when several clients share the same archive.
 */
export type HubNoteSurface = 'chat' | 'code' | 'agent' | 'other';

export interface HubNoteInput {
  title: string;
  text: string;
  threadId?: string;
  surface?: HubNoteSurface;
  /** Free text distinguishing one session from another of the same surface,
   *  e.g. a Claude Code working directory or a scheduled task's name. */
  sessionTag?: string;
}

export interface HubNoteRecord extends HubNoteInput {
  id: string;
  createdAt: Date;
}

export interface HubDataDeleteResult {
  deletedThreads: number;
  deletedNotes: number;
}

export interface HubOAuthClientInput {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
}

export interface HubOAuthClientRecord extends HubOAuthClientInput {
  createdAt: Date;
}
