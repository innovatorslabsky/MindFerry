import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';
import { createAnchor } from '../anchor/textQuote';
import { uploadKey } from '../book';
import { FeedParseError } from '../feed/parseFeed';
import { UnsafeUrlError } from '../net/safeFetch';
import { epub3, rawZip } from './helpers/epubFixture';
import { makePdf } from './helpers/pdfFixture';

const user = 'user-a';
const other = 'user-b';

const PDF = makePdf({
  title: 'A Test Paper',
  author: 'Ada Lovelace',
  outline: [
    { title: 'Intro', page: 0 },
    { title: 'Later', page: 1 },
  ],
  pages: [
    [
      [72, 720, 'Hello brave new world of reading'],
      [72, 700, 'second line of the first page'],
    ],
    [[72, 720, 'Page two talks about spaced repetition']],
  ],
});

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { ...fake, service };
}

describe('saveUpload', () => {
  it('stores an EPUB as a book with a chapter per unit and its table of contents', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, epub3());
    expect(saved.created).toBe(true);
    expect(saved.document).toMatchObject({
      kind: 'epub',
      title: 'The Test Book',
      byline: 'Ada Lovelace, Alan Turing',
      siteName: 'Open Press',
      unitCount: 2,
    });
    expect(saved.document).not.toHaveProperty('text');
    expect(saved.document.toc.length).toBeGreaterThan(0);
    const units = await service.listUnits(user, saved.document.id);
    expect(units.map((unit) => unit.kind)).toEqual(['chapter', 'chapter']);
  });

  it('stores a PDF as a book with a page per unit, anchored on the exact text', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, PDF);
    expect(saved.document).toMatchObject({ kind: 'pdf', title: 'A Test Paper', unitCount: 2 });
    expect(saved.document.toc).toEqual([
      { title: 'Intro', depth: 0, unitIndex: 0 },
      { title: 'Later', depth: 0, unitIndex: 1 },
    ]);
    const page = await service.getUnit(user, saved.document.id, 1);
    expect(page?.kind).toBe('page');
    expect(page?.text).toContain('spaced repetition');
    expect(page?.readableText).toContain('spaced repetition');
  });

  it('keeps the highlight coordinate space apart from the reflowed text on a PDF page', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, PDF);
    const first = (await service.getUnit(user, saved.document.id, 0))!;
    // Anchors are offsets into the page's concatenated text items; the reflowed text joins the two
    // lines with a space. They must stay different strings, or a client's selection drifts.
    expect(first.text).toContain('readingsecond');
    expect(first.readableText).toContain('reading second');
  });

  it('treats the same file as the same document, and a different file as a new one', async () => {
    const { service, documents } = setup();
    const first = await service.saveUpload(user, PDF);
    const again = await service.saveUpload(user, PDF);
    expect(again.created).toBe(false);
    expect(again.document.id).toBe(first.document.id);
    const revised = await service.saveUpload(
      user,
      makePdf({ title: 'A Test Paper', pages: [[[72, 720, 'A revised first page']]] }),
    );
    expect(revised.created).toBe(true);
    expect(documents.size).toBe(2);
  });

  it('keys an upload by its bytes, not its name', () => {
    expect(uploadKey(PDF)).toEqual(uploadKey(PDF.slice()));
    expect(uploadKey(PDF).urlKey).not.toBe(uploadKey(epub3()).urlKey);
    expect(uploadKey(PDF).normalizedUrl).toMatch(/^upload:\/\/[0-9a-f]{64}$/);
  });

  it('refuses a file that is neither', async () => {
    const { service } = setup();
    await expect(service.saveUpload(user, rawZip({ 'a.txt': 'x' }))).rejects.toThrow();
    await expect(service.saveUpload(user, new TextEncoder().encode('plain'))).rejects.toThrow(
      /Unsupported/,
    );
  });

  it('keeps one reader from seeing another reader’s book', async () => {
    const { service } = setup();
    const theirs = await service.saveUpload(other, PDF);
    expect(await service.get(user, theirs.document.id)).toBeNull();
    expect(await service.getUnit(user, theirs.document.id, 0)).toBeNull();
    expect(await service.listUnits(user, theirs.document.id)).toEqual([]);
  });
});

describe('highlights in a book', () => {
  async function pdfBook() {
    const ctx = setup();
    const saved = await ctx.service.saveUpload(user, PDF);
    const page = (await ctx.service.getUnit(user, saved.document.id, 1))!;
    return { ...ctx, id: saved.document.id, page };
  }

  it('anchors a highlight in a page and checks it against that page’s text and hash', async () => {
    const { service, id, page } = await pdfBook();
    const outcome = await service.createHighlight(user, {
      documentId: id,
      anchor: createAnchor(page.text, 0, 8),
      contentHash: page.contentHash,
      unit: { kind: 'page', index: 1 },
    });
    expect(outcome.status).toBe('created');
  });

  it('rejects a selection from an older copy of the page as stale', async () => {
    const { service, id, page } = await pdfBook();
    const outcome = await service.createHighlight(user, {
      documentId: id,
      anchor: createAnchor(page.text, 0, 8),
      contentHash: 'a'.repeat(64),
      unit: { kind: 'page', index: 1 },
    });
    expect(outcome.status).toBe('stale');
  });

  it('refuses the wrong page text, the wrong unit kind, a missing unit and a missing page', async () => {
    const { service, id, page } = await pdfBook();
    const base = { documentId: id, contentHash: page.contentHash };
    const anchor = createAnchor(page.text, 0, 8);
    const attempts = [
      {
        ...base,
        anchor: { ...anchor, exact: 'Nope nope' },
        unit: { kind: 'page' as const, index: 1 },
      },
      { ...base, anchor, unit: { kind: 'chapter' as const, index: 1 } },
      { ...base, anchor },
      { ...base, anchor, unit: { kind: 'page' as const, index: 9 } },
    ];
    for (const attempt of attempts) {
      expect((await service.createHighlight(user, attempt)).status).toBe('mismatch');
    }
  });

  it('refuses a unit on an article, so an article never holds a stray unit highlight', async () => {
    const { service } = setup();
    const html = `<html><head><title>A</title></head><body><article><h1>A</h1><p>${'Memory decays over time. '.repeat(20)}</p><p>${'Another long paragraph. '.repeat(20)}</p></article></body></html>`;
    const saved = await service.saveFromHtml(user, 'https://example.test/a', html);
    const doc = (await service.get(user, saved.document.id))!;
    const outcome = await service.createHighlight(user, {
      documentId: doc.id,
      anchor: createAnchor(doc.text, 0, 6),
      contentHash: doc.contentHash,
      unit: { kind: 'page', index: 0 },
    });
    expect(outcome.status).toBe('mismatch');
  });

  it('works for an EPUB chapter too', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, epub3());
    const chapter = (await service.getUnit(user, saved.document.id, 0))!;
    const outcome = await service.createHighlight(user, {
      documentId: saved.document.id,
      anchor: createAnchor(chapter.text, 0, 5),
      contentHash: chapter.contentHash,
      unit: { kind: 'chapter', index: 0 },
    });
    expect(outcome.status).toBe('created');
  });
});

describe('progress in a book', () => {
  it('needs a unit for a book, refuses one for an article, and clamps to the unit text', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, PDF);
    const id = saved.document.id;
    const page = (await service.getUnit(user, id, 0))!;
    expect(await service.setProgress(user, id, 5)).toBeNull();
    expect(await service.setProgress(user, id, 5, 9)).toBeNull();
    const ok = await service.setProgress(user, id, 10_000_000, 0);
    expect(ok).toMatchObject({ unitIndex: 0, textOffset: page.text.length });
    expect(ok?.contentHash).toBe(page.contentHash);
  });
});

describe('previewFeed', () => {
  const feed = {
    feed: {
      format: 'rss' as const,
      title: 'Notes',
      siteUrl: 'https://example.test/',
      feedUrl: 'https://example.test/feed.xml',
      description: null,
      language: null,
      items: [
        {
          guid: 'g1',
          url: 'https://example.test/one',
          title: 'One',
          author: null,
          publishedAt: '2026-01-01T00:00:00.000Z',
          summaryHtml: '<p>A <b>short</b> teaser</p>',
          contentHtml: null,
          enclosures: [],
          categories: [],
        },
      ],
    },
    notModified: false,
    feedUrl: 'https://example.test/feed.xml',
    etag: null,
    lastModified: null,
  };

  it('lists the items as plain text and stores nothing', async () => {
    const fake = createFakeLibraryMethods();
    const service = createLibraryService({
      methods: fake.methods,
      ingest: { subscribeToUrl: async () => feed },
    });
    const preview = await service.previewFeed('https://example.test/');
    expect(preview.items[0]).toMatchObject({ title: 'One', summary: 'A short teaser' });
    expect(fake.documents.size).toBe(0);
  });
});

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

const req = (overrides: Record<string, unknown> = {}): ServerRequest =>
  ({
    user: { id: user },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

describe('book routes', () => {
  it('upload: 201 then 200, and a book read returns units instead of its text', async () => {
    const ctx = setup();
    const handlers = createLibraryHandlers({ service: ctx.service });
    const first = res();
    await handlers.upload(req({ file: { buffer: PDF } }), first.response);
    expect(first.out.status).toBe(201);
    const second = res();
    await handlers.upload(req({ file: { buffer: PDF } }), second.response);
    expect(second.out.status).toBe(200);

    const { document } = first.out.body as { document: { id: string } };
    const read = res();
    await handlers.get(req({ params: { id: document.id } }), read.response);
    const body = read.out.body as {
      document: Record<string, unknown>;
      units: Array<Record<string, unknown>>;
    };
    expect(body.units).toHaveLength(2);
    expect(body.document).not.toHaveProperty('text');
    expect(body.document).not.toHaveProperty('contentHtml');
    expect(body.units[0]).not.toHaveProperty('text');
  });

  it('upload: 400 with no file, 415 for an unsupported one, 422 for a damaged one', async () => {
    const handlers = createLibraryHandlers({ service: setup().service });
    const none = res();
    await handlers.upload(req(), none.response);
    expect(none.out.status).toBe(400);
    const plain = res();
    await handlers.upload(
      req({ file: { buffer: new TextEncoder().encode('plain') } }),
      plain.response,
    );
    expect(plain.out.status).toBe(415);
    const damaged = res();
    await handlers.upload(
      req({ file: { buffer: new TextEncoder().encode('%PDF-1.4 this is not really a pdf') } }),
      damaged.response,
    );
    expect(damaged.out.status).toBe(422);
  });

  it('upload: is a 404 when the library is off', async () => {
    const handlers = createLibraryHandlers({ service: setup().service });
    const { response, out } = res();
    await handlers.upload(req({ config: {}, file: { buffer: PDF } }), response);
    expect(out.status).toBe(404);
  });

  it('getUnit: returns the unit with only its own highlights, and 404 for a bad index or owner', async () => {
    const ctx = setup();
    const handlers = createLibraryHandlers({ service: ctx.service });
    const saved = await ctx.service.saveUpload(user, PDF);
    const id = saved.document.id;
    const p0 = (await ctx.service.getUnit(user, id, 0))!;
    const p1 = (await ctx.service.getUnit(user, id, 1))!;
    for (const [unit, index] of [
      [p0, 0],
      [p1, 1],
    ] as const) {
      await ctx.service.createHighlight(user, {
        documentId: id,
        anchor: createAnchor(unit.text, 0, 5),
        contentHash: unit.contentHash,
        unit: { kind: 'page', index },
      });
    }
    const one = res();
    await handlers.getUnit(req({ params: { id, index: '1' } }), one.response);
    const body = one.out.body as {
      unit: { index: number };
      highlights: Array<{ unit: { index: number } }>;
    };
    expect(body.unit.index).toBe(1);
    expect(body.highlights.map((h) => h.unit.index)).toEqual([1]);

    for (const params of [
      { id, index: '9' },
      { id, index: 'x' },
      { id, index: '-1' },
    ]) {
      const bad = res();
      await handlers.getUnit(req({ params }), bad.response);
      expect(bad.out.status).toBe(404);
    }
    const stranger = res();
    await handlers.getUnit(
      req({ user: { id: other }, params: { id, index: '0' } }),
      stranger.response,
    );
    expect(stranger.out.status).toBe(404);
  });

  it('progress: takes a unit index for a book and says 404 when it does not fit', async () => {
    const ctx = setup();
    const handlers = createLibraryHandlers({ service: ctx.service });
    const saved = await ctx.service.saveUpload(user, PDF);
    const id = saved.document.id;
    const ok = res();
    await handlers.setProgress(
      req({ params: { id }, body: { textOffset: 3, unitIndex: 1 } }),
      ok.response,
    );
    expect(ok.out.body).toMatchObject({ progress: { unitIndex: 1, textOffset: 3 } });
    const missing = res();
    await handlers.setProgress(req({ params: { id }, body: { textOffset: 3 } }), missing.response);
    expect(missing.out.status).toBe(404);
  });

  it('previewFeed: validates the url and maps feed errors', async () => {
    const make = (error?: Error) =>
      createLibraryHandlers({
        service: Object.assign(setup().service, {
          previewFeed: async () => {
            if (error) throw error;
            return { title: 'T', siteUrl: null, feedUrl: 'u', description: null, items: [] };
          },
        }),
      });
    const bad = res();
    await make().previewFeed(req({ body: { url: 'nope' } }), bad.response);
    expect(bad.out.status).toBe(400);
    const good = res();
    await make().previewFeed(req({ body: { url: 'https://example.test/feed' } }), good.response);
    expect(good.out.status).toBe(200);
    const notFeed = res();
    await make(new FeedParseError('nope')).previewFeed(
      req({ body: { url: 'https://example.test/feed' } }),
      notFeed.response,
    );
    expect(notFeed.out.status).toBe(422);
    const unsafe = res();
    await make(new UnsafeUrlError('blocked')).previewFeed(
      req({ body: { url: 'http://169.254.169.254/' } }),
      unsafe.response,
    );
    expect(unsafe.out.status).toBe(400);
  });
});
