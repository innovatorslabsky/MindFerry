import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { NotReadableError } from '../ingest/extract';
import { createAnchor } from '../anchor/textQuote';
import { createLibraryService } from '../service';

const PAGE = (
  body: string,
) => `<!doctype html><html lang="en"><head><title>Memory notes</title></head>
<body><article><h1>Memory notes</h1>${body}</article></body></html>`;

const LONG = (sentence: string) =>
  `<p>${Array.from({ length: 8 }, () => sentence).join(' ')}</p><p>${Array.from({ length: 8 }, () => 'Another paragraph keeps the article long enough to be readable.').join(' ')}</p>`;

const URL_A = 'https://example.test/memory?utm_source=x';
const user = 'user-a';
const other = 'user-b';

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { ...fake, service };
}

describe('saveFromHtml', () => {
  it('stores a readable page once and dedupes a tracking-parameter variant', async () => {
    const { service, documents } = setup();
    const html = PAGE(LONG('Memory decays on a forgetting curve.'));
    const first = await service.saveFromHtml(user, URL_A, html);
    const second = await service.saveFromHtml(user, 'https://example.test/memory', html);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(documents.size).toBe(1);
    expect(first.document).not.toHaveProperty('contentHtml');
    expect(first.document.title).toBe('Memory notes');
  });

  it('refuses a page with no readable article', async () => {
    const { service } = setup();
    await expect(
      service.saveFromHtml(user, 'https://example.test/x', '<html><body>tiny</body></html>'),
    ).rejects.toBeInstanceOf(NotReadableError);
  });

  it('passes the chosen location to a new document only', async () => {
    const { service } = setup();
    const html = PAGE(LONG('Spacing beats cramming.'));
    const first = await service.saveFromHtml(user, URL_A, html, 'later');
    expect(first.document.location).toBe('later');
  });
});

describe('re-saving a page whose text changed', () => {
  async function savedWithHighlight(sentence: string, exactStart: number, exactEnd: number) {
    const ctx = setup();
    const saved = await ctx.service.saveFromHtml(user, URL_A, PAGE(LONG(sentence)));
    const doc = (await ctx.service.get(user, saved.document.id))!;
    const anchor = createAnchor(doc.text, exactStart, exactEnd);
    const outcome = await ctx.service.createHighlight(user, {
      documentId: doc.id,
      anchor,
      contentHash: doc.contentHash,
    });
    expect(outcome.status).toBe('created');
    return { ...ctx, doc, anchor };
  }

  it('moves a highlight whose passage survived and reports it as kept', async () => {
    const sentence = 'Memory decays on a forgetting curve.';
    const { service, doc, highlights } = await savedWithHighlight(sentence, 0, 6);
    const edited = PAGE(`<p>A new opening line was added above.</p>${LONG(sentence)}`);
    const result = await service.saveFromHtml(user, URL_A, edited);
    expect(result.created).toBe(false);
    expect(result.reanchored).toEqual({ kept: 1, orphaned: 0 });
    const stored = [...highlights.values()][0]!;
    const fresh = (await service.get(user, doc.id))!;
    expect(fresh.text.slice(stored.anchor.start, stored.anchor.end)).toBe(stored.anchor.exact);
    expect(stored.contentHash).toBe(fresh.contentHash);
    expect(stored.orphaned).toBe(false);
  });

  it('orphans a highlight whose passage is gone, without deleting it', async () => {
    const { service, highlights } = await savedWithHighlight(
      'Memory decays on a forgetting curve.',
      0,
      36,
    );
    const result = await service.saveFromHtml(
      user,
      URL_A,
      PAGE(LONG('Completely different wording appears here instead of the original.')),
    );
    expect(result.reanchored).toEqual({ kept: 0, orphaned: 1 });
    expect(highlights.size).toBe(1);
    expect([...highlights.values()][0]!.orphaned).toBe(true);
  });

  it('recovers an orphaned highlight when its passage comes back', async () => {
    const sentence = 'Memory decays on a forgetting curve.';
    const { service, highlights } = await savedWithHighlight(sentence, 0, 36);
    await service.saveFromHtml(
      user,
      URL_A,
      PAGE(LONG('Completely different wording appears here instead of the original.')),
    );
    expect([...highlights.values()][0]!.orphaned).toBe(true);
    const back = await service.saveFromHtml(user, URL_A, PAGE(LONG(sentence)));
    expect(back.reanchored).toEqual({ kept: 1, orphaned: 0 });
    expect([...highlights.values()][0]!.orphaned).toBe(false);
  });

  it('leaves highlights alone when the text did not change', async () => {
    const sentence = 'Memory decays on a forgetting curve.';
    const { service } = await savedWithHighlight(sentence, 0, 6);
    const result = await service.saveFromHtml(user, URL_A, PAGE(LONG(sentence)));
    expect(result.reanchored).toEqual({ kept: 0, orphaned: 0 });
  });
});

describe('createHighlight', () => {
  async function doc() {
    const ctx = setup();
    const saved = await ctx.service.saveFromHtml(
      user,
      URL_A,
      PAGE(LONG('Memory decays on a forgetting curve.')),
    );
    const record = (await ctx.service.get(user, saved.document.id))!;
    return { ...ctx, record };
  }

  it('rejects a selection made against an older version as stale', async () => {
    const { service, record } = await doc();
    const outcome = await service.createHighlight(user, {
      documentId: record.id,
      anchor: createAnchor(record.text, 0, 6),
      contentHash: 'f'.repeat(64),
    });
    expect(outcome.status).toBe('stale');
  });

  it('rejects an anchor whose quote is not what the text holds at that range', async () => {
    const { service, record } = await doc();
    const anchor = { ...createAnchor(record.text, 0, 6), exact: 'Wrong!' };
    const outcome = await service.createHighlight(user, {
      documentId: record.id,
      anchor,
      contentHash: record.contentHash,
    });
    expect(outcome.status).toBe('mismatch');
  });

  it('rejects a range past the end of the text', async () => {
    const { service, record } = await doc();
    const anchor = {
      exact: 'x',
      prefix: '',
      suffix: '',
      start: record.text.length + 5,
      end: record.text.length + 6,
    };
    const outcome = await service.createHighlight(user, {
      documentId: record.id,
      anchor,
      contentHash: record.contentHash,
    });
    expect(outcome.status).toBe('mismatch');
  });

  it('does not accept a unit highlight yet, because books are not stored', async () => {
    const { service, record } = await doc();
    const outcome = await service.createHighlight(user, {
      documentId: record.id,
      anchor: createAnchor(record.text, 0, 6),
      contentHash: record.contentHash,
      unit: { kind: 'page', index: 0 },
    });
    expect(outcome.status).toBe('mismatch');
  });

  it("will not attach to another user's document", async () => {
    const { service, record } = await doc();
    const outcome = await service.createHighlight(other, {
      documentId: record.id,
      anchor: createAnchor(record.text, 0, 6),
      contentHash: record.contentHash,
    });
    expect(outcome.status).toBe('not_found');
  });
});

describe('setProgress', () => {
  it("clamps the offset into the text and refuses another user's document", async () => {
    const { service } = setup();
    const saved = await service.saveFromHtml(user, URL_A, PAGE(LONG('Spacing beats cramming.')));
    const record = (await service.get(user, saved.document.id))!;
    const clamped = await service.setProgress(user, record.id, 10_000_000);
    expect(clamped?.textOffset).toBe(record.text.length);
    expect((await service.setProgress(user, record.id, -5))?.textOffset).toBe(0);
    expect(await service.setProgress(other, record.id, 3)).toBeNull();
  });
});
