import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@librechat/data-schemas';
import { WORKER_RESULT_CHARS_ENV } from './protocol';
import type { WorkerJob, WorkerReply } from './protocol';
import {
  ParseTimeoutError,
  WorkerBusyError,
  WorkerCrashedError,
  WorkerUnavailableError,
  reviveError,
} from './errors';

export interface ProcessRunnerOptions {
  /** Absolute path of the built parser program (`entry.cjs`). */
  entryPath: string;
  /** Parsers running at once. Default 2. */
  maxConcurrent?: number;
  /** Jobs allowed to wait for a slot; more than this are refused at once. Default 16. */
  maxQueue?: number;
  /** Wall-clock budget for one job, after which the process is killed. Default 60 s. */
  timeoutMs?: number;
  /** V8 heap ceiling for one parser, in MiB. Default 768. */
  memoryMb?: number;
  /** Characters of text a result may carry. Default 60 million. */
  maxResultChars?: number;
  /**
   * Run the parser under Node's permission model: no writes, no child processes, no workers, no
   * addons, and reads only of its own code and `node_modules`. Default true.
   */
  permission?: boolean;
  /** The Node binary to run. Default: the current one. */
  execPath?: string;
  /** Extra variables the child may see. Everything else in the environment is withheld. */
  env?: Record<string, string>;
}

export interface ProcessRunner {
  run: (job: WorkerJob) => Promise<unknown>;
  /** Parsers running now, and jobs waiting. */
  stats: () => { running: number; queued: number };
}

const DEFAULTS = { maxConcurrent: 2, maxQueue: 16, timeoutMs: 60_000, memoryMb: 768 };

/** Environment the child may inherit: how to find certificates and nothing that is a secret. */
const PASSTHROUGH_ENV = ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'TZ'] as const;

/**
 * Directories the parser must be able to read: the package that holds it (the bundler splits shared
 * code into sibling files, so the entry file's own folder is not enough) and every `node_modules`
 * above it. Nothing else on the disk is readable, and nothing is writable.
 */
export function readablePaths(entryPath: string): string[] {
  const paths = new Set<string>();
  let foundPackage = false;
  let dir = path.dirname(entryPath);
  for (;;) {
    if (!foundPackage && fs.existsSync(path.join(dir, 'package.json'))) {
      foundPackage = true;
      paths.add(dir);
    }
    const modules = path.join(dir, 'node_modules');
    if (fs.existsSync(modules)) {
      paths.add(modules);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return paths.size > 0 ? [...paths] : [path.dirname(entryPath)];
}

export function supportsPermissionModel(execPath: string = process.execPath): boolean {
  return execPath !== process.execPath || process.allowedNodeEnvironmentFlags.has('--permission');
}

export function buildExecArgv(
  options: Required<Pick<ProcessRunnerOptions, 'entryPath' | 'memoryMb' | 'permission'>>,
): string[] {
  // Not `--disallow-code-generation-from-strings`: jsdom's selector engine (nwsapi) compiles selectors
  // with `new Function`, so that flag would break every article extraction.
  const args = [`--max-old-space-size=${options.memoryMb}`];
  if (options.permission) {
    args.push('--permission');
    for (const readable of readablePaths(options.entryPath)) {
      args.push(`--allow-fs-read=${readable}`);
    }
  }
  return args;
}

export function createProcessRunner(options: ProcessRunnerOptions): ProcessRunner {
  const {
    entryPath,
    maxConcurrent = DEFAULTS.maxConcurrent,
    maxQueue = DEFAULTS.maxQueue,
    timeoutMs = DEFAULTS.timeoutMs,
    memoryMb = DEFAULTS.memoryMb,
    permission = true,
    execPath = process.execPath,
  } = options;

  let running = 0;
  const waiting: Array<() => void> = [];

  function childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? 'production' };
    for (const name of PASSTHROUGH_ENV) {
      const value = process.env[name];
      if (value !== undefined) {
        env[name] = value;
      }
    }
    if (options.maxResultChars !== undefined) {
      env[WORKER_RESULT_CHARS_ENV] = String(options.maxResultChars);
    }
    return { ...env, ...options.env };
  }

  function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running++;
      return Promise.resolve();
    }
    if (waiting.length >= maxQueue) {
      return Promise.reject(new WorkerBusyError('The reader is busy; try again shortly'));
    }
    return new Promise((resolve) => {
      waiting.push(() => {
        running++;
        resolve();
      });
    });
  }

  function release(): void {
    running--;
    waiting.shift()?.();
  }

  function execute(job: WorkerJob): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = fork(entryPath, [], {
          execPath,
          execArgv: buildExecArgv({ entryPath, memoryMb, permission }),
          env: childEnv(),
          serialization: 'advanced',
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
      } catch {
        reject(new WorkerUnavailableError('The parser could not be started'));
        return;
      }

      let settled = false;
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 4096) {
          stderr += chunk.toString('utf8');
        }
      });

      const finish = (outcome: { value: unknown } | { error: Error }) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
        if ('error' in outcome) {
          reject(outcome.error);
        } else {
          resolve(outcome.value);
        }
      };

      const timer = setTimeout(() => {
        finish({ error: new ParseTimeoutError('Reading this took too long and was stopped') });
      }, timeoutMs);

      child.once('message', (reply: WorkerReply) => {
        if (reply && reply.ok === true) {
          finish({ value: reply.result });
        } else if (reply && reply.ok === false) {
          const error = reviveError(String(reply.error?.name), String(reply.error?.message));
          if (error.name === 'WorkerError') {
            // An error the parent does not recognise: the client gets a generic answer, the log the cause.
            logger.error(
              `[library] The parser failed with ${String(reply.error?.name)}: ${String(reply.error?.message)}`,
            );
          }
          finish({ error });
        } else {
          finish({ error: new WorkerCrashedError('The parser sent an unreadable answer') });
        }
      });
      child.once('error', () => {
        finish({ error: new WorkerUnavailableError('The parser could not be started') });
      });
      child.once('exit', (code, signal) => {
        const detail = stderr.trim().slice(0, 300);
        // The answer and the exit can arrive in either order; give a pending answer a moment to land.
        setTimeout(() => {
          finish({
            error: new WorkerCrashedError(
              `The parser stopped unexpectedly (${signal ?? `exit ${code}`})${detail ? `: ${detail}` : ''}`,
            ),
          });
        }, 50);
      });

      child.send(job, (error) => {
        if (error) {
          finish({ error: new WorkerCrashedError('The job could not be sent to the parser') });
        }
      });
    });
  }

  return {
    async run(job) {
      if (!fs.existsSync(entryPath)) {
        throw new WorkerUnavailableError('The parser program is not built');
      }
      await acquire();
      try {
        return await execute(job);
      } finally {
        release();
      }
    },
    stats: () => ({ running, queued: waiting.length }),
  };
}
