import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { cleanOcrText, createLibraryService, MAX_OCR_PAGE_CHARS } from '../service';
import { createLibraryHandlers } from '../routes';
import { makePdf } from './helpers/pdfFixture';

const user = 'user-a';

// Pages with no text at all, as a scan has: pdf.js finds nothing to read.
const SCAN = makePdf({ title: 'Scan', pages: [[], [], []] });
const TEXTY = makePdf({
  title: 'Paper',
  pages: [[[72, 720, 'This page has real text on it already']], []],
});

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { ...fake, service, handlers: createLibraryHandlers({ service }) };
}

function reply() {
  const out = { status: 0, body: undefined as unknown };
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
      return response;
    },
  } as unknown as Response;
  return { response, out };
}

const req = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: user },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

describe('cleanOcrText', () => {
  it('keeps plain text, normalises line breaks and drops control characters', () => {
    expect(cleanOcrText('  Hello\r\nworld\u0000\u0007 \n\n\n\nnext\tline  ')).toBe(
      'Hello\nworld\n\nnext\tline',
    );
  });

  it('is capped', () => {
    expect(cleanOcrText('a'.repeat(MAX_OCR_PAGE_CHARS + 50)).length).toBe(MAX_OCR_PAGE_CHARS);
  });
});

describe('saving OCR text for a scanned page', () => {
  it('fills a blank page with a fresh hash and word count, and updates the document', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, SCAN);
    expect(saved.document.needsOcr).toBe(true);
    const outcome = await service.saveUnitText(
      user,
      saved.document.id,
      1,
      'The quick brown fox jumps over the lazy dog.',
    );
    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.unit).toMatchObject({
      index: 1,
      text: 'The quick brown fox jumps over the lazy dog.',
      wordCount: 9,
    });
    expect(outcome.unit.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await service.getUnit(user, saved.document.id, 1))?.text).toContain('quick brown');
  });

  it('refuses a page that already has text, nothing readable, or another user’s page', async () => {
    const { service } = setup();
    const saved = await service.saveUpload(user, TEXTY);
    expect(
      await service.saveUnitText(user, saved.document.id, 0, 'overwrite attempt text'),
    ).toEqual({
      status: 'has_text',
    });
    expect(await service.saveUnitText(user, saved.document.id, 1, '  \n ')).toEqual({
      status: 'empty',
    });
    expect(await service.saveUnitText(user, saved.document.id, 1, 'ab')).toEqual({
      status: 'empty',
    });
    expect(
      await service.saveUnitText('user-b', saved.document.id, 1, 'someone else writes here'),
    ).toEqual({ status: 'not_found' });
    expect(
      await service.saveUnitText(user, saved.document.id, 7, 'past the last page here'),
    ).toEqual({
      status: 'not_found',
    });
  });
});

describe('the OCR text route', () => {
  it('maps each outcome to a status', async () => {
    const { service, handlers } = setup();
    const saved = await service.saveUpload(user, TEXTY);
    const id = saved.document.id;
    const call = async (index: number, text: unknown, who = user) => {
      const { response, out } = reply();
      await handlers.saveUnitText(
        req({ user: { id: who }, params: { id, index: String(index) }, body: { text } }),
        response,
      );
      return out.status;
    };
    expect(await call(1, 'Text read from the page image.')).toBe(200);
    expect(await call(1, 'Trying to write again later.')).toBe(409);
    expect(await call(0, 'Overwrite the real text now.')).toBe(409);
    expect(await call(1, '   ', user)).toBe(422);
    expect(await call(9, 'No such page exists at all.')).toBe(404);
    expect(await call(1, 'Strangers cannot write this.', 'user-b')).toBe(404);
    expect(await call(1, 42)).toBe(400);
  });

  it('answers 422 for a blank read and 404 when the library is off', async () => {
    const { service, handlers } = setup();
    const saved = await service.saveUpload(user, SCAN);
    const blank = reply();
    await handlers.saveUnitText(
      req({ params: { id: saved.document.id, index: '0' }, body: { text: ' ' } }),
      blank.response,
    );
    expect(blank.out.status).toBe(422);
    const off = reply();
    await handlers.saveUnitText(
      req({
        config: { contextHub: { enabled: true } },
        params: { id: saved.document.id, index: '0' },
        body: { text: 'Some text for a page.' },
      }),
      off.response,
    );
    expect(off.out.status).toBe(404);
  });
});
