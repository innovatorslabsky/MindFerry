import type { DocumentDraft } from '../ingest/saveDocument';
import type { UploadDraft } from '../ingest/upload';
import type { FeedFetchResult } from '../feed/fetchFeed';
import type { ProcessRunner } from './runner';

/** The four things the service asks a parser to do, in a shape that is the same inline or isolated. */
export interface LibraryIngest {
  saveUrl: (url: string) => Promise<DocumentDraft>;
  saveHtml: (url: string, html: string) => Promise<DocumentDraft>;
  ingestUpload: (bytes: Uint8Array) => Promise<UploadDraft>;
  subscribeToUrl: (url: string) => Promise<FeedFetchResult>;
}

/** Runs every parse in a separate, restricted process. */
export function createIsolatedIngest(runner: ProcessRunner): LibraryIngest {
  return {
    saveUrl: async (url) => (await runner.run({ op: 'fetchArticle', url })) as DocumentDraft,
    saveHtml: async (url, html) =>
      (await runner.run({ op: 'extractHtml', url, html })) as DocumentDraft,
    ingestUpload: async (bytes) => (await runner.run({ op: 'parseUpload', bytes })) as UploadDraft,
    subscribeToUrl: async (url) => (await runner.run({ op: 'readFeed', url })) as FeedFetchResult,
  };
}
