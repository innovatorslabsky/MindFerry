import type { AppConfig } from '@librechat/data-schemas';
import { getLibraryIsolation, getLibraryKeepPdfOriginals } from '../config';
import { createLibraryIngest } from '../worker';
import { WorkerUnavailableError } from '../worker/errors';

const configWith = (isolation?: Record<string, unknown>) =>
  ({
    contextHub: { enabled: false, library: { enabled: true, isolation } },
  }) as unknown as AppConfig;

describe('getLibraryIsolation', () => {
  it('is process isolation with safe limits when nothing is configured', () => {
    for (const config of [undefined, {} as AppConfig, configWith(undefined)]) {
      expect(getLibraryIsolation(config)).toEqual({
        mode: 'process',
        maxConcurrent: 2,
        maxQueue: 16,
        timeoutMs: 60_000,
        memoryMb: 768,
      });
    }
  });

  it('keeps what the operator set and fills in the rest', () => {
    expect(getLibraryIsolation(configWith({ mode: 'inline', memoryMb: 512 }))).toMatchObject({
      mode: 'inline',
      memoryMb: 512,
      timeoutMs: 60_000,
    });
  });
});

describe('getLibraryKeepPdfOriginals', () => {
  it('is off unless the operator turned it on', () => {
    expect(getLibraryKeepPdfOriginals(undefined)).toBe(false);
    expect(getLibraryKeepPdfOriginals({} as AppConfig)).toBe(false);
    expect(getLibraryKeepPdfOriginals(configWith())).toBe(false);
    const on = {
      contextHub: { enabled: false, library: { enabled: true, keepPdfOriginals: true } },
    } as unknown as AppConfig;
    expect(getLibraryKeepPdfOriginals(on)).toBe(true);
  });
});

describe('createLibraryIngest', () => {
  const base = {
    mode: 'process' as const,
    maxConcurrent: 1,
    maxQueue: 1,
    timeoutMs: 5_000,
    memoryMb: 256,
  };

  it('inline mode supplies no parsers, so the service parses in its own process', () => {
    expect(createLibraryIngest({ ...base, mode: 'inline' })).toEqual({});
  });

  it('process mode supplies every isolated parser', () => {
    const ingest = createLibraryIngest(base, '/nonexistent/entry.cjs');
    expect(Object.keys(ingest).sort()).toEqual([
      'fetchFeed',
      'ingestUpload',
      'saveHtml',
      'saveUrl',
      'subscribeToUrl',
    ]);
  });

  it('process mode fails closed when the parser program is missing, instead of parsing inline', async () => {
    const ingest = createLibraryIngest(base, '/nonexistent/entry.cjs');
    await expect(ingest.saveHtml!('https://example.test/a', '<p>x</p>')).rejects.toBeInstanceOf(
      WorkerUnavailableError,
    );
    await expect(ingest.ingestUpload!(new Uint8Array([1]))).rejects.toBeInstanceOf(
      WorkerUnavailableError,
    );
  });
});
