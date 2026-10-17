import type { ProcessRunner } from '../worker/runner';
import type { WorkerJob } from '../worker/protocol';
import { DEFAULT_MAX_RESULT_CHARS, approxChars, handleJob } from '../worker/job';
import { installParserPolyfills } from '../worker/polyfill';
import { createIsolatedIngest } from '../worker/ingest';
import { makePdf } from './helpers/pdfFixture';
import { epub3 } from './helpers/epubFixture';

const html = `<html><head><title>Notes</title></head><body><article><h1>Notes</h1><p>${'Memory decays over time. '.repeat(20)}</p><p>${'A second paragraph for length. '.repeat(20)}</p></article></body></html>`;

describe('approxChars', () => {
  it('counts text through nesting without serializing, and leaves binary out of the text budget', () => {
    expect(
      approxChars({ a: 'abc', b: ['de', { c: 'f' }], d: new Uint8Array(1_000_000), e: 5 }, 1_000),
    ).toBe(6);
  });

  it('stops counting once past the budget', () => {
    const big = { pages: Array.from({ length: 1000 }, () => 'x'.repeat(1000)) };
    expect(approxChars(big, 5_000)).toBeGreaterThan(5_000);
    expect(approxChars(big, 5_000)).toBeLessThan(1_000_000);
  });

  it('survives an empty value and null', () => {
    expect(approxChars(null, 10)).toBe(0);
    expect(approxChars([], 10)).toBe(0);
  });
});

describe('handleJob', () => {
  it('extracts an article from HTML', async () => {
    const reply = await handleJob(
      { op: 'extractHtml', url: 'https://example.test/a', html },
      DEFAULT_MAX_RESULT_CHARS,
    );
    expect(reply.ok).toBe(true);
    if (reply.ok)
      expect(reply.result).toMatchObject({
        title: 'Notes',
        normalizedUrl: 'https://example.test/a',
      });
  });

  it('parses a PDF and an EPUB, sending back the images the book really contains', async () => {
    const pdf = await handleJob(
      {
        op: 'parseUpload',
        bytes: makePdf({ title: 'T', pages: [[[72, 720, 'Hello brave new world']]] }),
      },
      DEFAULT_MAX_RESULT_CHARS,
    );
    expect(pdf.ok && (pdf.result as { kind: string }).kind).toBe('pdf');
    const epub = await handleJob({ op: 'parseUpload', bytes: epub3() }, DEFAULT_MAX_RESULT_CHARS);
    expect(epub.ok).toBe(true);
    if (epub.ok) {
      const draft = (
        epub.result as {
          draft: {
            resources: Array<{ path: string; mediaType: string; bytes: Uint8Array }>;
            chapters: unknown[];
          };
        }
      ).draft;
      expect(draft.resources.length).toBeGreaterThan(0);
      expect(
        draft.resources.every((r) => r.mediaType === 'image/png' && r.bytes.byteLength > 0),
      ).toBe(true);
      // Only raster images that passed the content check; the fixture's fake .png is not among them.
      expect(draft.resources.map((r) => r.path)).not.toContain('OEBPS/images/fake.png');
      expect(draft.chapters.length).toBeGreaterThan(0);
    }
  });

  it('reports an error by name and message, never the error object', async () => {
    const reply = await handleJob(
      { op: 'parseUpload', bytes: new TextEncoder().encode('plain') },
      DEFAULT_MAX_RESULT_CHARS,
    );
    expect(reply).toEqual({
      ok: false,
      error: { name: 'UnsupportedUploadError', message: expect.stringContaining('Unsupported') },
    });
  });

  it('refuses a result bigger than the ceiling', async () => {
    const reply = await handleJob({ op: 'extractHtml', url: 'https://example.test/a', html }, 100);
    expect(reply).toMatchObject({ ok: false, error: { name: 'WorkerResultTooLargeError' } });
  });

  it('answers an unknown operation with an error rather than doing anything', async () => {
    const reply = await handleJob(
      { op: 'rm -rf' } as unknown as WorkerJob,
      DEFAULT_MAX_RESULT_CHARS,
    );
    expect(reply.ok).toBe(false);
  });
});

describe('parser polyfills', () => {
  it('provides a DOMMatrix that exists but refuses arithmetic', () => {
    const target: Record<string, unknown> = {};
    installParserPolyfills(target);
    const Matrix = target.DOMMatrix as new (init?: unknown) => Record<string, unknown>;
    const identity = new Matrix();
    expect(identity).toMatchObject({ a: 1, d: 1, e: 0, f: 0 });
    expect(() => new Matrix([1, 0, 0, 1, 0, 0])).toThrow(/not available/);
    expect(() => (identity.translate as () => void)()).toThrow(/not available/);
  });

  it('leaves a real DOMMatrix alone', () => {
    class Real {}
    const target: Record<string, unknown> = { DOMMatrix: Real };
    installParserPolyfills(target);
    expect(target.DOMMatrix).toBe(Real);
  });
});

describe('createIsolatedIngest', () => {
  it('turns each service call into the matching job', async () => {
    const jobs: WorkerJob[] = [];
    const runner: ProcessRunner = {
      run: async (job) => {
        jobs.push(job);
        return { echoed: job.op };
      },
      stats: () => ({ running: 0, queued: 0 }),
    };
    const ingest = createIsolatedIngest(runner);
    const bytes = new Uint8Array([1]);
    await ingest.saveUrl('https://example.test/a');
    await ingest.saveHtml('https://example.test/b', '<p>x</p>');
    await ingest.ingestUpload(bytes);
    await ingest.subscribeToUrl('https://example.test/feed');
    await ingest.fetchFeed('https://example.test/feed', { etag: 'v1' });
    expect(jobs).toEqual([
      { op: 'fetchArticle', url: 'https://example.test/a' },
      { op: 'extractHtml', url: 'https://example.test/b', html: '<p>x</p>' },
      { op: 'parseUpload', bytes },
      { op: 'readFeed', url: 'https://example.test/feed' },
      { op: 'pollFeed', url: 'https://example.test/feed', etag: 'v1', lastModified: undefined },
    ]);
  });
});
