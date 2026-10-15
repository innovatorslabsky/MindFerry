import type { WorkerJob, WorkerReply } from './protocol';
import { ingestUpload } from '../ingest/upload';
import { saveHtml, saveUrl } from '../ingest/saveDocument';
import { subscribeToUrl } from '../feed/fetchFeed';
import { WorkerResultTooLargeError } from './errors';

/** The work an isolated parser does for one job. Kept apart from the process bootstrap so it can be tested. */

export const DEFAULT_MAX_RESULT_CHARS = 60_000_000;

/** Counts the text a result carries without serializing it a second time. */
export function approxChars(value: unknown, budget: number): number {
  let total = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      total += current.length;
    } else if (current instanceof Uint8Array) {
      total += current.byteLength;
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
    case 'parseUpload': {
      const draft = await ingestUpload(job.bytes);
      // Image bytes are not stored, so they are not sent back across the boundary either.
      return draft.kind === 'epub'
        ? { kind: 'epub', draft: { ...draft.draft, resources: [] } }
        : draft;
    }
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
