import type { WorkerJob } from './protocol';
import { DEFAULT_MAX_RESULT_CHARS, handleJob } from './job';
import { WORKER_RESULT_CHARS_ENV } from './protocol';
import { installParserPolyfills } from './polyfill';

/**
 * The isolated parser: one process, one job, then exit. It holds no database handle, no API keys and
 * no user data, runs under Node's permission model with read access to its own code only, and is
 * killed by the parent if it hangs. It parses; it never decides what to store.
 *
 * Only the bootstrap lives here (it reacts to an IPC channel the moment it is loaded); the work is in
 * `job.ts`.
 */
if (typeof process.send === 'function') {
  installParserPolyfills();
  const maxChars = Number(process.env[WORKER_RESULT_CHARS_ENV]) || DEFAULT_MAX_RESULT_CHARS;
  process.once('message', (job: WorkerJob) => {
    void handleJob(job, maxChars).then((reply) => {
      process.send?.(reply, () => process.exit(0));
    });
  });
}
