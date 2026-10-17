/* eslint-disable jest/no-standalone-expect -- `permissionIt` is `it` or `it.skip`, which the rule does not see through */
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ProcessRunnerOptions } from '../worker/runner';
import type { WorkerJob } from '../worker/protocol';
import {
  ParseTimeoutError,
  WorkerBusyError,
  WorkerCrashedError,
  WorkerError,
  WorkerUnavailableError,
  reviveError,
} from '../worker/errors';
import {
  buildExecArgv,
  createProcessRunner,
  readablePaths,
  supportsPermissionModel,
} from '../worker/runner';
import { PdfEncryptedError, PdfError } from '../pdf/parsePdf';
import { WORKER_RESULT_CHARS_ENV } from '../worker/protocol';
import { UnsafeUrlError } from '../net/safeFetch';

const PROBE = path.join(__dirname, 'helpers', 'probeWorker.cjs');
const probe = (action: string, extra: Record<string, unknown> = {}) =>
  ({ action, ...extra }) as unknown as WorkerJob;

const permissionIt = supportsPermissionModel() ? it : it.skip;

function runner(overrides: Partial<ProcessRunnerOptions> = {}) {
  return createProcessRunner({ entryPath: PROBE, timeoutMs: 20_000, ...overrides });
}

describe('process runner: what the child can see', () => {
  const secret = 'LIBRARY_TEST_SECRET';
  beforeEach(() => {
    process.env[secret] = 'hunter2';
    process.env.MONGO_URI = 'mongodb://user:pass@db/prod';
    process.env.JWT_SECRET = 'jwt';
    process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/certs/ca-certificates.crt';
  });
  afterEach(() => {
    delete process.env[secret];
    delete process.env.MONGO_URI;
    delete process.env.JWT_SECRET;
    delete process.env.NODE_EXTRA_CA_CERTS;
  });

  permissionIt('gets none of the parent’s environment, only certificate paths', async () => {
    const result = (await runner().run(probe('env'))) as { env: Record<string, string> };
    // Only certificate locations and the mode may pass; the sandbox may set any of them.
    const allowed = ['NODE_ENV', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'TZ'];
    expect(Object.keys(result.env).every((name) => allowed.includes(name))).toBe(true);
    expect(result.env.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/certs/ca-certificates.crt');
    expect(JSON.stringify(result.env)).not.toMatch(/hunter2|mongodb|jwt/);
  });

  permissionIt('hands the parser its result ceiling and nothing else extra', async () => {
    const result = (await runner({ maxResultChars: 1234 }).run(probe('env'))) as {
      env: Record<string, string>;
    };
    expect(result.env[WORKER_RESULT_CHARS_ENV]).toBe('1234');
  });

  permissionIt('runs under the permission model with a memory ceiling', async () => {
    const result = (await runner({ memoryMb: 256 }).run(probe('env'))) as { execArgv: string[] };
    expect(result.execArgv).toContain('--permission');
    expect(result.execArgv).toContain('--max-old-space-size=256');
    expect(result.execArgv.some((arg) => arg.startsWith('--allow-fs-read='))).toBe(true);
    expect(result.execArgv).not.toContain('--allow-child-process');
    expect(result.execArgv).not.toContain('--allow-worker');
    expect(result.execArgv).not.toContain('--allow-addons');
    expect(result.execArgv.some((arg) => arg.startsWith('--allow-fs-write'))).toBe(false);
  });
});

describe('process runner: what the child can do', () => {
  permissionIt(
    'reads its own code but not the rest of the disk, and cannot write, spawn or thread',
    async () => {
      const result = (await runner().run(probe('sandbox'))) as Record<
        string,
        { allowed: boolean; code?: string }
      >;
      expect(result.readOwn.allowed).toBe(true);
      expect(result.readOutside).toMatchObject({ allowed: false, code: 'ERR_ACCESS_DENIED' });
      expect(result.write).toMatchObject({ allowed: false, code: 'ERR_ACCESS_DENIED' });
      expect(result.spawn).toMatchObject({ allowed: false, code: 'ERR_ACCESS_DENIED' });
      expect(result.worker).toMatchObject({ allowed: false, code: 'ERR_ACCESS_DENIED' });
    },
  );

  it('without the permission model the same child could read outside its folder', async () => {
    const result = (await runner({ permission: false }).run(probe('sandbox'))) as Record<
      string,
      { allowed: boolean }
    >;
    // This is the control for the test above: it is the permission model, not the probe, that denies.
    expect(result.readOutside.allowed).toBe(true);
  });

  it('receives binary input intact', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    const result = await runner().run(probe('echoSize', { bytes }));
    expect(result).toEqual({ received: 5, isUint8Array: true });
    const fromBuffer = await runner().run(probe('echoSize', { bytes: Buffer.from(bytes) }));
    expect(fromBuffer).toMatchObject({ received: 5 });
  });
});

describe('process runner: when the child misbehaves', () => {
  it('kills a parser that hangs, and says so', async () => {
    const started = Date.now();
    await expect(runner({ timeoutMs: 700 }).run(probe('hang'))).rejects.toBeInstanceOf(
      ParseTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('leaves no process behind after a timeout', async () => {
    const hung = runner({ timeoutMs: 600 });
    await expect(hung.run(probe('hang'))).rejects.toBeInstanceOf(ParseTimeoutError);
    expect(hung.stats()).toEqual({ running: 0, queued: 0 });
    const left = async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const out = execSync("pgrep -f '[p]robeWorker.cjs' || true").toString().trim();
        if (!out) return '';
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return execSync("pgrep -f '[p]robeWorker.cjs' || true").toString().trim();
    };
    expect(await left()).toBe('');
  });

  it('reports a parser that exits without answering as crashed', async () => {
    await expect(runner().run(probe('exit', { code: 3 }))).rejects.toBeInstanceOf(
      WorkerCrashedError,
    );
  });

  permissionIt(
    'contains an out-of-memory parser: the parent survives and reports it',
    async () => {
      await expect(runner({ memoryMb: 128 }).run(probe('oom'))).rejects.toBeInstanceOf(
        WorkerCrashedError,
      );
    },
    60_000,
  );

  it('treats an unreadable answer as a crash, not as data', async () => {
    await expect(runner().run(probe('garbage'))).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(runner().run(probe('reply', { payload: { ok: 'maybe' } }))).rejects.toBeInstanceOf(
      WorkerCrashedError,
    );
  });

  it('fails closed when the parser program is not built', async () => {
    const missing = createProcessRunner({ entryPath: path.join(__dirname, 'nope.cjs') });
    await expect(missing.run(probe('env'))).rejects.toBeInstanceOf(WorkerUnavailableError);
  });
});

describe('process runner: errors the parser reports', () => {
  it('keeps the type of an error about the input', async () => {
    const encrypted = runner().run(
      probe('reply', {
        payload: { ok: false, error: { name: 'PdfEncryptedError', message: 'pw' } },
      }),
    );
    await expect(encrypted).rejects.toBeInstanceOf(PdfEncryptedError);
    await expect(encrypted).rejects.toBeInstanceOf(PdfError);
    await expect(
      runner().run(
        probe('reply', { payload: { ok: false, error: { name: 'UnsafeUrlError', message: 'x' } } }),
      ),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('turns any other name into a generic error and never builds a class the child chose', () => {
    for (const name of [
      'Error',
      'TypeError',
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      const error = reviveError(name, 'secret detail');
      expect(error).toBeInstanceOf(WorkerError);
      expect(error.message).toBe('The parser failed');
    }
  });
});

describe('process runner: load', () => {
  it('runs at most maxConcurrent at once, queues the rest and refuses past the queue', async () => {
    const r = runner({ maxConcurrent: 1, maxQueue: 1, timeoutMs: 3_000 });
    const first = r.run(probe('hang')).catch((error) => error);
    // Let the first one take the only slot.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(r.stats()).toEqual({ running: 1, queued: 0 });
    const second = r.run(probe('env')).catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(r.stats()).toEqual({ running: 1, queued: 1 });
    await expect(r.run(probe('env'))).rejects.toBeInstanceOf(WorkerBusyError);

    expect(await first).toBeInstanceOf(ParseTimeoutError);
    expect(await second).toMatchObject({ env: expect.any(Object) });
    expect(r.stats()).toEqual({ running: 0, queued: 0 });
  }, 30_000);

  it('does not let one failure take a slot with it', async () => {
    const r = runner({ maxConcurrent: 1, maxQueue: 4 });
    await expect(r.run(probe('exit'))).rejects.toBeInstanceOf(WorkerCrashedError);
    await expect(r.run(probe('exit'))).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(await r.run(probe('echoSize', { bytes: new Uint8Array(2) }))).toMatchObject({
      received: 2,
    });
  });
});

describe('sandbox arguments', () => {
  it('allows reading the package and its node_modules, and nothing broader', () => {
    const entry = path.join(__dirname, '..', 'worker', 'entry.ts');
    const readable = readablePaths(entry);
    const packageRoot = path.resolve(__dirname, '..', '..', '..');
    expect(readable).toContain(packageRoot);
    expect(readable.every((p) => p === packageRoot || p.endsWith('node_modules'))).toBe(true);
    expect(readable).not.toContain(path.sep);
  });

  it('adds the permission flags only when asked', () => {
    const base = { entryPath: PROBE, memoryMb: 300 };
    expect(buildExecArgv({ ...base, permission: false })).toEqual(['--max-old-space-size=300']);
    expect(buildExecArgv({ ...base, permission: true })).toContain('--permission');
  });
});
