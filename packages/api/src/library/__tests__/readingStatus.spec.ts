import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';

const user = 'u1';

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${'This essay explains why spaced repetition works and how to use it well. '.repeat(12)}</p></article></body></html>`;

function setup() {
  const fake = createFakeLibraryMethods();
  const service = createLibraryService({ methods: fake.methods });
  return { service, handlers: createLibraryHandlers({ service }) };
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

describe('reading status and rating over HTTP', () => {
  it('sets, changes and clears a status and stars through the document patch', async () => {
    const { service, handlers } = setup();
    const id = (await service.saveFromHtml(user, 'https://example.com/a', html('A'))).document.id;

    const set = reply();
    await handlers.patch(
      req({ params: { id }, body: { readingStatus: 'finished', rating: 5 } }),
      set.response,
    );
    expect(set.out.status).toBe(200);
    expect((set.out.body as { document: unknown }).document).toMatchObject({
      readingStatus: 'finished',
      rating: 5,
    });

    const cleared = reply();
    await handlers.patch(
      req({ params: { id }, body: { readingStatus: null, rating: null } }),
      cleared.response,
    );
    const document = (cleared.out.body as { document: Record<string, unknown> }).document;
    expect(document.readingStatus).toBeUndefined();
    expect(document.rating).toBeUndefined();
  });

  it('refuses a status that is not one, and stars out of range or not whole', async () => {
    const { service, handlers } = setup();
    const id = (await service.saveFromHtml(user, 'https://example.com/a', html('A'))).document.id;
    for (const body of [
      { readingStatus: 'abandoned' },
      { rating: 0 },
      { rating: 6 },
      { rating: 3.5 },
      { rating: '4' },
    ]) {
      const out = reply();
      await handlers.patch(req({ params: { id }, body }), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('lists by status, and by none', async () => {
    const { service, handlers } = setup();
    const a = (await service.saveFromHtml(user, 'https://example.com/a', html('A'))).document.id;
    await service.saveFromHtml(user, 'https://example.com/b', html('B'));
    await service.update(user, a, { readingStatus: 'want' });

    const want = reply();
    await handlers.list(req({ query: { status: 'want' } }), want.response);
    expect(
      (want.out.body as { documents: Array<{ title: string }> }).documents.map((d) => d.title),
    ).toEqual(['A']);

    const none = reply();
    await handlers.list(req({ query: { status: 'none' } }), none.response);
    expect(
      (none.out.body as { documents: Array<{ title: string }> }).documents.map((d) => d.title),
    ).toEqual(['B']);

    const nonsense = reply();
    await handlers.list(req({ query: { status: 'whatever' } }), nonsense.response);
    expect((nonsense.out.body as { documents: unknown[] }).documents).toHaveLength(2);
  });

  it('is the owner’s alone', async () => {
    const { service, handlers } = setup();
    const id = (await service.saveFromHtml(user, 'https://example.com/a', html('A'))).document.id;
    const out = reply();
    await handlers.patch(
      req({ user: { id: 'u2' }, params: { id }, body: { readingStatus: 'finished' } }),
      out.response,
    );
    expect(out.out.status).toBe(404);
  });
});
