import type { WorkerJob, WorkerReply } from './protocol';
import { fetchFeed, subscribeToUrl } from '../feed/fetchFeed';
import { saveHtml, saveUrl } from '../ingest/saveDocument';
import { WorkerResultTooLargeError } from './errors';
import { ingestUpload } from '../ingest/upload';

/** The work an isolated parser does for one job. Kept apart from the process bootstrap so it can be tested. */

export const DEFAULT_MAX_RESULT_CHARS = 60_000_000;

/** Images kept per book. The parser drops further ones, and chapters stop pointing at them. */
export const MAX_STORED_IMAGE_BYTES = 40 * 1024 * 1024;

/** Counts the text a result carries without serializing it a second time. */
export function approxChars(value: unknown, budget: number): number {
  let total = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      total += current.length;
    } else if (current instanceof Uint8Array) {
      // Binary is not text and is bounded by the parsers' own limits (images, entry sizes), so it
      // is left out of the text budget rather than letting a few pictures use it up.
      continue;
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current !== null && typeof current === 'object') {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
    if (total > budget) {
      return total;
    }
  }
  return total;
}

async function run(job: WorkerJob): Promise<unknown> {
  switch (job.op) {
    case 'fetchArticle':
      return saveUrl(job.url);
    case 'extractHtml':
      return saveHtml(job.url, job.html);
    case 'parseUpload':
      return ingestUpload(job.bytes, { epub: { maxImagesTotalBytes: MAX_STORED_IMAGE_BYTES } });
    case 'pollFeed':
      return fetchFeed(job.url, { etag: job.etag, lastModified: job.lastModified });
    case 'readFeed':
      return subscribeToUrl(job.url);
    default:
      throw new Error('Unknown job');
  }
}

export async function handleJob(job: WorkerJob, maxChars: number): Promise<WorkerReply> {
  try {
    const result = await run(job);
    if (approxChars(result, maxChars) > maxChars) {
      throw new WorkerResultTooLargeError('The document is too large to process');
    }
    return { ok: true, result };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: { name, message } };
  }
}
