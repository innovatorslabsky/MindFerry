import path from 'node:path';
import { logger } from '@librechat/data-schemas';
import type { LibraryIngest } from './ingest';
import { createIsolatedIngest } from './ingest';
import { createProcessRunner } from './runner';

export type { LibraryIngest } from './ingest';
export { createIsolatedIngest } from './ingest';
export { createProcessRunner } from './runner';
export type { ProcessRunner, ProcessRunnerOptions } from './runner';

export interface LibraryIsolationConfig {
  /**
   * `process` parses every untrusted page, file and feed in a short-lived, restricted child process.
   * `inline` parses in the API process itself, which is only suitable for a single trusted user.
   */
  mode: 'process' | 'inline';
  maxConcurrent: number;
  maxQueue: number;
  timeoutMs: number;
  memoryMb: number;
}

/** Where the built parser program sits next to the API package's own build output. */
export function resolveWorkerEntry(): string {
  return path.join(path.dirname(require.resolve('@librechat/api')), 'library/worker/entry.cjs');
}

let warnedInline = false;

/**
 * The parsers the library service should use for this configuration. `process` mode fails closed: if
 * the parser program is missing, saves are refused rather than quietly parsed in the API process.
 */
export function createLibraryIngest(
  config: LibraryIsolationConfig,
  entryPath: string = resolveWorkerEntry(),
): Partial<LibraryIngest> {
  if (config.mode === 'inline') {
    if (!warnedInline) {
      warnedInline = true;
      logger.warn(
        '[library] contextHub.library.isolation.mode is "inline": untrusted pages and files are parsed inside the API process.',
      );
    }
    return {};
  }
  return createIsolatedIngest(
    createProcessRunner({
      entryPath,
      maxConcurrent: config.maxConcurrent,
      maxQueue: config.maxQueue,
      timeoutMs: config.timeoutMs,
      memoryMb: config.memoryMb,
    }),
  );
}
