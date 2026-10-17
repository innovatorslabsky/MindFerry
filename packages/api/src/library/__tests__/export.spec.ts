import type { Response } from 'express';
import type { ExportDocument, ExportHighlight } from '../export';
import type { ServerRequest } from '../../types/http';
import { csvCell, highlightsToCsv, highlightsToMarkdown } from '../export';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryService, filenameStem } from '../service';
import { createAnchor } from '../anchor/textQuote';
import { createLibraryHandlers } from '../routes';

const doc = (over: Partial<ExportDocument> = {}): ExportDocument => ({
  id: 'd1',
  title: 'Spaced repetition',
  byline: 'Ada Lovelace',
  siteName: 'example.com',
  normalizedUrl: 'https://example.com/a',
  kind: 'article',
  ...over,
});
const hl = (over: Partial<ExportHighlight> = {}): ExportHighlight => ({
  documentId: 'd1',
  text: 'Memory decays on a curve.',
  color: 'yellow',
  tags: [],
  orphaned: false,
  createdAt: new Date('2026-10-16T08:00:00Z'),
  ...over,
});

describe('csvCell', () => {
  it('quotes what needs quoting and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tcmd', '\rcmd'])(
    'defuses a cell a spreadsheet would run as a formula: %j',
    (cell) => {
      const out = csvCell(cell);
      expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('leaves a dash inside text alone', () => {
    expect(csvCell('well-known')).toBe('well-known');
  });
});

describe('highlightsToCsv', () => {
  it('has a header, one row per highlight, CRLF lines and a BOM for Excel', () => {
    const csv = highlightsToCsv(
      [doc()],
      [
        hl({ note: 'Remember, this', tags: ['psych', 'memory'], unit: { kind: 'page', index: 2 } }),
        hl({ text: '=HYPERLINK("http://evil")', orphaned: true }),
      ],
    );
    expect(
      csv.startsWith(
        '﻿Highlight,Title,Author,Source,URL,Note,Color,Tags,Location,Date,Not found\r\n',
      ),
    ).toBe(true);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain('"Remember, this"');
    expect(rows[2]).toContain('"psych, memory"');
    expect(rows[2]).toContain('Page 3');
    expect(rows[2]).toContain('2026-10-16');
    expect(rows[1].startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(rows[1].endsWith(',yes')).toBe(true);
  });

  it('keeps non-Latin text intact and gives no web address for a file', () => {
    const csv = highlightsToCsv(
      [doc({ title: 'Ôn tập 间隔重复', normalizedUrl: 'upload://abc' })],
      [hl({ text: '한국어 문장' })],
    );
    expect(csv).toContain('한국어 문장');
    expect(csv).toContain('Ôn tập 间隔重复');
    expect(csv).not.toContain('upload://');
  });
});

describe('highlightsToMarkdown', () => {
  it('writes a heading, the source, then each quote with its note and facts', () => {
    const md = highlightsToMarkdown(
      [doc()],
      [hl({ note: 'Why?', tags: ['psych'], unit: { kind: 'chapter', index: 0 } })],
    );
    expect(md).toBe(
      [
        '# Spaced repetition',
        '',
        'Ada Lovelace · example.com — <https://example.com/a>',
        '',
        '> Memory decays on a curve.',
        '',
        '**Note:** Why?',
        '',
        '*yellow · Chapter 1 · tags: psych · 2026-10-16*',
        '',
      ].join('\n'),
    );
  });

  it('keeps a multi-line quote inside its block, and flags a highlight that is no longer found', () => {
    const md = highlightsToMarkdown(
      [doc()],
      [hl({ text: 'first line\n# not a heading\nthird', orphaned: true })],
    );
    expect(md).toContain('> first line\n> # not a heading\n> third');
    expect(md).toContain('text no longer found on the page');
  });

  it('separates documents, in title order, and skips a document with no highlights', () => {
    const md = highlightsToMarkdown(
      [
        doc({ id: 'b', title: 'Beta' }),
        doc({ id: 'a', title: 'Alpha' }),
        doc({ id: 'c', title: 'None' }),
      ],
      [hl({ documentId: 'b' }), hl({ documentId: 'a' })],
    );
    expect(md.indexOf('# Alpha')).toBeLessThan(md.indexOf('# Beta'));
    expect(md).toContain('\n---\n');
    expect(md).not.toContain('# None');
  });

  it('is empty when there is nothing to export', () => {
    expect(highlightsToMarkdown([doc()], [])).toBe('');
  });
});

describe('filenameStem', () => {
  it('is lower-case ASCII, with accents removed, and never empty', () => {
    expect(filenameStem('Ôn tập ngắt quãng!')).toBe('on-tap-ngat-quang');
    expect(filenameStem('间隔重复')).toBe('document');
    expect(filenameStem('A"; filename=evil')).toBe('a-filename-evil');
    expect(filenameStem('x'.repeat(200)).length).toBe(50);
  });
});

describe('the export route', () => {
  const html = `<html lang="en"><head><title>Spaced repetition</title></head><body><article><h1>Spaced repetition</h1><p>${Array.from(
    { length: 14 },
    () => 'Spaced repetition strengthens memory over time.',
  ).join(' ')}</p></article></body></html>`;

  async function setup() {
    const fake = createFakeLibraryMethods();
    const service = createLibraryService({ methods: fake.methods });
    const saved = await service.saveFromHtml('u1', 'https://example.com/a', html);
    const read = (await service.get('u1', saved.document.id))!;
    await service.createHighlight('u1', {
      documentId: read.id,
      anchor: createAnchor(read.text, 0, 6),
      contentHash: read.contentHash,
      color: 'blue',
    });
    return { service, handlers: createLibraryHandlers({ service }), id: read.id };
  }
  const reply = () => {
    const out = {
      status: 0,
      body: undefined as unknown,
      ended: undefined as unknown,
      headers: {} as Record<string, string>,
    };
    const response = {
      status(code: number) {
        out.status = code;
        return response;
      },
      json(body: unknown) {
        out.body = body;
        return response;
      },
      end(body?: unknown) {
        out.ended = body;
        return response;
      },
      setHeader(name: string, value: string) {
        out.headers[name] = value;
      },
    } as unknown as Response;
    return { response, out };
  };
  const req = (query: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
    ({
      user: { id: 'u1' },
      config: { contextHub: { enabled: false, library: { enabled: true } } },
      body: {},
      query,
      params: {},
      ...overrides,
    }) as unknown as ServerRequest;

  it('serves a safe attachment for one document and for everything', async () => {
    const { handlers, id } = await setup();
    const one = reply();
    await handlers.exportHighlights(req({ format: 'markdown', documentId: id }), one.response);
    expect(one.out.status).toBe(200);
    expect(one.out.headers).toMatchObject({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="mindferry-highlights-spaced-repetition.md"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    expect(one.out.ended).toContain('> Spaced');
    const all = reply();
    await handlers.exportHighlights(req({ format: 'csv' }), all.response);
    expect(all.out.headers['Content-Disposition']).toBe(
      'attachment; filename="mindferry-highlights.csv"',
    );
    expect(String(all.out.ended)).toContain('Spaced');
  });

  it('refuses an unknown format, another user’s document and a disabled library', async () => {
    const { handlers, id } = await setup();
    const bad = reply();
    await handlers.exportHighlights(req({ format: 'pdf' }), bad.response);
    expect(bad.out.status).toBe(400);
    const stranger = reply();
    await handlers.exportHighlights(
      req({ format: 'csv', documentId: id }, { user: { id: 'u2' } }),
      stranger.response,
    );
    expect(stranger.out.status).toBe(404);
    const off = reply();
    await handlers.exportHighlights(
      req({ format: 'csv' }, { config: { contextHub: { enabled: true } } }),
      off.response,
    );
    expect(off.out.status).toBe(404);
  });

  it("exports nothing of another user's when everything is asked for", async () => {
    const { handlers } = await setup();
    const other = reply();
    await handlers.exportHighlights(req({ format: 'csv' }, { user: { id: 'u2' } }), other.response);
    expect(other.out.status).toBe(200);
    expect(String(other.out.ended)).not.toContain('Spaced');
  });
});
