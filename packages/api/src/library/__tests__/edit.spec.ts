import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryService } from '../service';
import { createLibraryHandlers } from '../routes';

const HTML = `<html lang="en"><head><title>Spaced repetition</title></head><body><article><h1>Spaced repetition</h1><p>${Array.from(
  { length: 14 },
  () => 'Spaced repetition strengthens memory over time.',
).join(' ')}</p></article></body></html>`;

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods, autoTag: false });
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
    user: { id: 'u1' },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body: {},
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

type Doc = { document: { title: string; byline?: string; note?: string; summary?: string } };

describe('editing a document over HTTP', () => {
  async function saved() {
    const ctx = setup();
    const made = await ctx.service.saveFromHtml('u1', 'https://example.test/a', HTML);
    return { ...ctx, id: made.document.id };
  }

  it('sets a title, an author, a note and a summary, then removes them', async () => {
    const { handlers, id } = await saved();
    const edited = reply();
    await handlers.patch(
      req({
        params: { id },
        body: { title: '  My title ', byline: 'Me', note: 'Check it', summary: 'Short.' },
      }),
      edited.response,
    );
    expect(edited.out.status).toBe(200);
    expect((edited.out.body as Doc).document).toMatchObject({
      title: 'My title',
      byline: 'Me',
      note: 'Check it',
      summary: 'Short.',
    });

    const cleared = reply();
    await handlers.patch(
      req({ params: { id }, body: { byline: null, note: '', summary: '' } }),
      cleared.response,
    );
    const document = (cleared.out.body as Doc).document;
    expect(document.byline).toBeUndefined();
    expect(document.note).toBeUndefined();
    expect(document.summary).toBeUndefined();
  });

  it('refuses an empty title and text that is too long', async () => {
    const { handlers, id } = await saved();
    for (const body of [
      { title: '   ' },
      { title: 'x'.repeat(301) },
      { byline: 'x'.repeat(201) },
      { note: 'x'.repeat(5001) },
      { summary: 'x'.repeat(2001) },
    ]) {
      const out = reply();
      await handlers.patch(req({ params: { id }, body }), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('accepts a restore of the page’s own title on its own, not with an edit of the same fields', async () => {
    const { handlers, id } = await saved();
    const alone = reply();
    await handlers.patch(req({ params: { id }, body: { restoreMeta: true } }), alone.response);
    expect(alone.out.status).toBe(200);
    for (const body of [
      { restoreMeta: true, title: 'x' },
      { restoreMeta: true, byline: 'x' },
      { restoreMeta: false },
    ]) {
      const out = reply();
      await handlers.patch(req({ params: { id }, body }), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('does not edit another person’s document', async () => {
    const { handlers, id } = await saved();
    const out = reply();
    await handlers.patch(
      req({ user: { id: 'u2' }, params: { id }, body: { note: 'mine now' } }),
      out.response,
    );
    expect(out.out.status).toBe(404);
  });
});
