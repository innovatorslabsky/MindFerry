import type { DocumentDraft } from '../ingest/saveDocument';
import type { FeedFetchResult } from '../feed/fetchFeed';
import type { UploadDraft } from '../ingest/upload';

/**
 * What the parent asks an isolated parser to do, and what it gets back. Everything crossing the
 * process boundary is plain data (structured clone), so a parser that is compromised or confused can
 * only hand back a value, which the parent then validates like any other input.
 */
export type WorkerJob =
  | { op: 'fetchArticle'; url: string }
  | { op: 'extractHtml'; url: string; html: string }
  | { op: 'parseUpload'; bytes: Uint8Array }
  | { op: 'readFeed'; url: string }
  | { op: 'pollFeed'; url: string; etag?: string | null; lastModified?: string | null };

export interface WorkerResultByOp {
  fetchArticle: DocumentDraft;
  extractHtml: DocumentDraft;
  parseUpload: UploadDraft;
  readFeed: FeedFetchResult;
  pollFeed: FeedFetchResult;
}

export type WorkerReply =
  { ok: true; result: unknown } | { ok: false; error: { name: string; message: string } };

/** Settings the child process receives on the command line / environment, never from the job. */
export const WORKER_RESULT_CHARS_ENV = 'LIBRARY_WORKER_MAX_RESULT_CHARS';
