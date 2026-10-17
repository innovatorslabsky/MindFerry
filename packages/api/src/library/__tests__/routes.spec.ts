import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import {
  ParseTimeoutError,
  WorkerBusyError,
  WorkerCrashedError,
  WorkerResultTooLargeError,
  WorkerUnavailableError,
} from '../worker/errors';
import { FetchError, TooLargeError, UnsafeUrlError } from '../net/safeFetch';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { NotReadableError } from '../ingest/extract';
import { createAnchor } from '../anchor/textQuote';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';

const ENABLED = { contextHub: { enabled: false, library: { enabled: true } } };

function res() {
  const out = { status: 0, body: undefined as unknown, ended: false };
  const response = {
    status(code: number) {
      out.status = code;
      return response;
    },
    json(body: unknown) {
      out.body = body;
      return response;
    },
    end() {
      out.ended = true;
      return response;
    },
  } as unknown as Response;
  return { response, out };
}

function req(overrides: Record<string, unknown> = {}): ServerRequest {
  return {
    user: { id: 'u1' },
    config: ENABLED,
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as ServerRequest;
}

const HTML = `<html><head><title>Memory notes</title></head><body><article><h1>Memory notes</h1><p>${Array.from(
  { length: 12 },
  () => 'Memory decays on a forgetting curve.',
).join(
  ' ',
)}</p><p>${Array.from({ length: 8 }, () => 'A second paragraph for length and readability.').join(' ')}</p></article></body></html>`;

function setup(serviceOverrides: Record<string, unknown> = {}) {
  const fake = createFakeLibraryMethods();
  const service = Object.assign(createLibraryService({ methods: fake.methods }), serviceOverrides);
  return { ...fake, service, handlers: createLibraryHandlers({ service }) };
}

describe('gating', () => {
  it.each([
    ['save', {}],
    ['list', {}],
    ['get', { params: { id: 'x' } }],
    ['createHighlight', {}],
  ] as const)('%s is a 404 when the library is not enabled', async (name, extra) => {
    const { handlers } = setup();
    const { response, out } = res();
    await handlers[name](req({ config: { contextHub: { enabled: true } }, ...extra }), response);
    expect(out.status).toBe(404);
  });

  it('is a 404 with no config at all, and a 401 when nobody is signed in', async () => {
    const { handlers } = setup();
    const first = res();
    await handlers.list(req({ config: undefined }), first.response);
    expect(first.out.status).toBe(404);
    const second = res();
    await handlers.list(req({ user: undefined }), second.response);
    expect(second.out.status).toBe(401);
  });
});

describe('save', () => {
  it('saves client-supplied HTML with a 201, then a 200 for the same page', async () => {
    const { handlers } = setup();
    const body = { url: 'https://example.test/m', html: HTML };
    const first = res();
    await handlers.save(req({ body }), first.response);
    expect(first.out.status).toBe(201);
    const second = res();
    await handlers.save(req({ body }), second.response);
    expect(second.out.status).toBe(200);
  });

  it('rejects a body without a valid url, or an empty html string', async () => {
    const { handlers } = setup();
    for (const body of [{}, { url: 'not a url' }, { url: 'https://a.test/', html: '' }]) {
      const { response, out } = res();
      await handlers.save(req({ body }), response);
      expect(out.status).toBe(400);
    }
  });

  it.each([
    [new UnsafeUrlError('blocked'), 400, 'unsafe_url'],
    [new TooLargeError('big'), 413, 'too_large'],
    [new NotReadableError('nope'), 422, 'not_readable'],
    [new FetchError('upstream 500'), 502, 'fetch_failed'],
    [new Error('boom'), 500, 'internal_error'],
  ])('maps %p to %i', async (error, status, code) => {
    const { handlers } = setup({
      saveFromUrl: async () => {
        throw error;
      },
    });
    const { response, out } = res();
    await handlers.save(req({ body: { url: 'https://example.test/m' } }), response);
    expect(out.status).toBe(status);
    expect(out.body).toMatchObject({ error: { code } });
  });

  it.each([
    [new WorkerBusyError('busy'), 503, 'busy'],
    [new ParseTimeoutError('slow'), 422, 'timeout'],
    [new WorkerResultTooLargeError('big'), 413, 'too_large'],
    [new WorkerCrashedError('boom: /srv/app/secret/path'), 422, 'unreadable_file'],
    [new WorkerUnavailableError('entry missing at /srv/app'), 503, 'unavailable'],
  ])('maps the isolated parser failure %p to %i', async (error, status, code) => {
    const { handlers } = setup({
      saveFromUrl: async () => {
        throw error;
      },
    });
    const { response, out } = res();
    await handlers.save(req({ body: { url: 'https://example.test/m' } }), response);
    expect(out.status).toBe(status);
    expect(out.body).toMatchObject({ error: { code } });
    // Internals (paths, stderr) stay in the log, not in the response.
    expect(JSON.stringify(out.body)).not.toMatch(/\/srv\/app|boom/);
  });

  it('does not leak an internal error message to the client', async () => {
    const { handlers } = setup({
      saveFromUrl: async () => {
        throw new Error('mongodb://secret-host:27017 refused');
      },
    });
    const { response, out } = res();
    await handlers.save(req({ body: { url: 'https://example.test/m' } }), response);
    expect(JSON.stringify(out.body)).not.toContain('secret-host');
  });
});

describe('documents', () => {
  it('lists, reads with highlights and progress, patches and deletes', async () => {
    const { handlers, service } = setup();
    const saved = await service.saveFromHtml('u1', 'https://example.test/m', HTML);
    const id = saved.document.id;

    const listed = res();
    await handlers.list(req(), listed.response);
    expect((listed.out.body as { documents: unknown[] }).documents).toHaveLength(1);

    const read = res();
    await handlers.get(req({ params: { id } }), read.response);
    expect(read.out.status).toBe(200);
    expect(read.out.body).toMatchObject({ document: { id }, highlights: [], progress: null });

    const patched = res();
    await handlers.patch(req({ params: { id }, body: { location: 'archive' } }), patched.response);
    expect(patched.out.body).toMatchObject({ document: { location: 'archive' } });

    const removed = res();
    await handlers.remove(req({ params: { id } }), removed.response);
    expect(removed.out.status).toBe(204);
    const gone = res();
    await handlers.get(req({ params: { id } }), gone.response);
    expect(gone.out.status).toBe(404);
  });

  it("returns 404, not 403, for another user's document", async () => {
    const { handlers, service } = setup();
    const saved = await service.saveFromHtml('u2', 'https://example.test/m', HTML);
    const params = { id: saved.document.id };
    for (const [name, extra] of [
      ['get', {}],
      ['patch', { body: { location: 'archive' } }],
      ['remove', {}],
    ] as const) {
      const { response, out } = res();
      await handlers[name](req({ params, ...extra }), response);
      expect(out.status).toBe(404);
    }
  });

  it('rejects an empty patch and an unknown location', async () => {
    const { handlers } = setup();
    for (const body of [{}, { location: 'trash' }]) {
      const { response, out } = res();
      await handlers.patch(req({ params: { id: 'x' }, body }), response);
      expect(out.status).toBe(400);
    }
  });

  it('searches when q is given, and ignores an unknown location filter', async () => {
    const { handlers, service } = setup();
    await service.saveFromHtml('u1', 'https://example.test/m', HTML);
    const found = res();
    await handlers.list(req({ query: { q: 'forgetting curve' } }), found.response);
    expect((found.out.body as { documents: unknown[] }).documents).toHaveLength(1);
    const filtered = res();
    await handlers.list(req({ query: { location: 'nonsense' } }), filtered.response);
    expect((filtered.out.body as { documents: unknown[] }).documents).toHaveLength(1);
  });
});

describe('highlights and progress', () => {
  async function withDocument() {
    const ctx = setup();
    const saved = await ctx.service.saveFromHtml('u1', 'https://example.test/m', HTML);
    const doc = (await ctx.service.get('u1', saved.document.id))!;
    return { ...ctx, doc };
  }

  it('creates a highlight (201), then patches and deletes it', async () => {
    const { handlers, doc } = await withDocument();
    const created = res();
    await handlers.createHighlight(
      req({
        body: {
          documentId: doc.id,
          anchor: createAnchor(doc.text, 0, 6),
          contentHash: doc.contentHash,
          note: 'key',
        },
      }),
      created.response,
    );
    expect(created.out.status).toBe(201);
    const { highlight } = created.out.body as { highlight: { id: string } };

    const patched = res();
    await handlers.patchHighlight(
      req({ params: { id: highlight.id }, body: { color: 'blue', note: null } }),
      patched.response,
    );
    expect(patched.out.body).toMatchObject({ highlight: { color: 'blue' } });

    const removed = res();
    await handlers.removeHighlight(req({ params: { id: highlight.id } }), removed.response);
    expect(removed.out.status).toBe(204);
  });

  it('answers 409 for a stale selection and 422 for a mismatched one', async () => {
    const { handlers, doc } = await withDocument();
    const stale = res();
    await handlers.createHighlight(
      req({
        body: {
          documentId: doc.id,
          anchor: createAnchor(doc.text, 0, 6),
          contentHash: 'e'.repeat(64),
        },
      }),
      stale.response,
    );
    expect(stale.out.status).toBe(409);
    const mismatch = res();
    await handlers.createHighlight(
      req({
        body: {
          documentId: doc.id,
          anchor: { ...createAnchor(doc.text, 0, 6), exact: 'Nope!!' },
          contentHash: doc.contentHash,
        },
      }),
      mismatch.response,
    );
    expect(mismatch.out.status).toBe(422);
  });

  it('rejects a malformed highlight body', async () => {
    const { handlers } = await withDocument();
    const { response, out } = res();
    await handlers.createHighlight(req({ body: { documentId: 'x' } }), response);
    expect(out.status).toBe(400);
  });

  it('stores reading progress and rejects a fractional or negative offset', async () => {
    const { handlers, doc } = await withDocument();
    const ok = res();
    await handlers.setProgress(
      req({ params: { id: doc.id }, body: { textOffset: 42 } }),
      ok.response,
    );
    expect(ok.out.body).toMatchObject({ progress: { textOffset: 42 } });
    for (const textOffset of [1.5, -1, 'a']) {
      const { response, out } = res();
      await handlers.setProgress(req({ params: { id: doc.id }, body: { textOffset } }), response);
      expect(out.status).toBe(400);
    }
  });
});

describe('followed feeds', () => {
  const followed = {
    status: 'followed' as const,
    feed: { id: 'f1', feedUrl: 'https://b.test/rss', title: 'B', createdAt: new Date() },
    refresh: { added: 2, failed: 0, skipped: 0, notModified: false },
  };

  it('creates a follow with 201, and reports an existing one with 200', async () => {
    const first = setup({ followFeed: async () => followed });
    const a = res();
    await first.handlers.followFeed(req({ body: { url: 'https://b.test' } }), a.response);
    expect(a.out.status).toBe(201);

    const second = setup({ followFeed: async () => ({ status: 'exists', feed: followed.feed }) });
    const b = res();
    await second.handlers.followFeed(req({ body: { url: 'https://b.test' } }), b.response);
    expect(b.out.status).toBe(200);
  });

  it('refuses past the follow limit with 409 and a bad url with 400', async () => {
    const { handlers } = setup({ followFeed: async () => ({ status: 'limit' }) });
    const a = res();
    await handlers.followFeed(req({ body: { url: 'https://b.test' } }), a.response);
    expect(a.out.status).toBe(409);
    const b = res();
    await handlers.followFeed(req({ body: { url: 'nope' } }), b.response);
    expect(b.out.status).toBe(400);
  });

  it('maps fetch failures like the preview does', async () => {
    const { handlers } = setup({
      followFeed: async () => {
        throw new UnsafeUrlError('blocked');
      },
      refreshFeed: async () => {
        throw new FetchError('down');
      },
    });
    const a = res();
    await handlers.followFeed(req({ body: { url: 'http://10.0.0.1' } }), a.response);
    expect(a.out.status).toBe(400);
    const b = res();
    await handlers.refreshFeed(req({ params: { id: 'f1' } }), b.response);
    expect(b.out.status).toBe(502);
  });

  it("lists, refreshes and unfollows only the signed-in user's feeds", async () => {
    const ctx = setup({ followFeed: async () => followed });
    await ctx.feeds.set('mine', {
      id: 'mine',
      userId: 'u1',
      feedUrl: 'https://a.test/rss',
      title: 'A',
      seenKeys: [],
      createdAt: new Date(),
    });
    const listed = res();
    await ctx.handlers.listFeeds(req(), listed.response);
    expect((listed.out.body as { feeds: unknown[] }).feeds).toHaveLength(1);

    const stranger = res();
    await ctx.handlers.unfollowFeed(
      req({ user: { id: 'u2' }, params: { id: 'mine' } }),
      stranger.response,
    );
    expect(stranger.out.status).toBe(404);
    const missing = res();
    await ctx.handlers.refreshFeed(
      req({ user: { id: 'u2' }, params: { id: 'mine' } }),
      missing.response,
    );
    expect(missing.out.status).toBe(404);

    const removed = res();
    await ctx.handlers.unfollowFeed(req({ params: { id: 'mine' } }), removed.response);
    expect(removed.out.status).toBe(204);
  });

  it('filters the document list by tag', async () => {
    const ctx = setup();
    const saved = await ctx.service.saveFromHtml('u1', 'https://x.test/a', HTML);
    await ctx.service.saveFromHtml('u1', 'https://x.test/b', HTML.replace('Memory notes', 'Other'));
    await ctx.service.update('u1', saved.document.id, { tags: ['psych'] });
    const out = res();
    await ctx.handlers.list(req({ query: { tag: 'psych' } }), out.response);
    expect((out.out.body as { documents: unknown[] }).documents).toHaveLength(1);
  });
});
