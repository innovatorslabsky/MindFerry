import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';

const user = 'u1';

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

const HEADER =
  'Book Id,Title,Author,My Rating,Number of Pages,Date Read,Bookshelves,Exclusive Shelf';
const csvFile = (text: string) => ({ file: { buffer: Buffer.from(text, 'utf8') } });
const EXPORT = [
  HEADER,
  '1,Dune,Frank Herbert,5,412,2021/05/03,"sci-fi, read",read',
  '2,Hyperion,Dan Simmons,0,482,,to-read,to-read',
].join('\n');

describe('adding a book by hand', () => {
  it('adds a book with no text and puts it away by where the person is with it', async () => {
    const { handlers } = setup();
    const out = reply();
    await handlers.addBook(
      req({
        body: {
          title: ' Piranesi ',
          byline: 'Susanna Clarke',
          pages: 272,
          readingStatus: 'finished',
          rating: 5,
          tags: ['fantasy'],
        },
      }),
      out.response,
    );
    expect(out.out.status).toBe(201);
    expect((out.out.body as { document: unknown }).document).toMatchObject({
      kind: 'manual',
      title: 'Piranesi',
      byline: 'Susanna Clarke',
      pages: 272,
      readingStatus: 'finished',
      rating: 5,
      location: 'archive',
    });
  });

  it('refuses a missing title and numbers that make no sense', async () => {
    const { handlers } = setup();
    for (const body of [
      {},
      { title: '   ' },
      { title: 'x'.repeat(301) },
      { title: 'A', pages: 0 },
      { title: 'A', pages: 1.5 },
      { title: 'A', rating: 6 },
      { title: 'A', readingStatus: 'abandoned' },
      { title: 'A', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    ]) {
      const out = reply();
      await handlers.addBook(req({ body }), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('is for someone who is signed in', async () => {
    const { handlers } = setup();
    const out = reply();
    await handlers.addBook(req({ user: undefined, body: { title: 'A' } }), out.response);
    expect(out.out.status).toBe(401);
  });

  it('has no text to summarize or ask about', async () => {
    const { handlers, service } = setup();
    const made = reply();
    await handlers.addBook(req({ body: { title: 'No text' } }), made.response);
    const id = (made.out.body as { document: { id: string } }).document.id;
    const chat = createLibraryHandlers({
      service,
      importConversation: async () => ({ conversationId: 'c1' }),
    });
    const out = reply();
    await chat.chat(req({ params: { id }, body: { endpoint: 'e', model: 'm' } }), out.response);
    expect(out.out.status).toBe(422);
  });
});

describe('importing from Goodreads', () => {
  it('adds the books of an export, then adds nothing the second time', async () => {
    const { handlers, service } = setup();
    const first = reply();
    await handlers.importGoodreads(req(csvFile(EXPORT)), first.response);
    expect(first.out.status).toBe(200);
    expect(first.out.body).toEqual({ created: 2, existing: 0, skipped: 0 });

    const titles = (await service.list(user, { limit: 10 })).map((d) => d.title).sort();
    expect(titles).toEqual(['Dune', 'Hyperion']);

    const again = reply();
    await handlers.importGoodreads(req(csvFile(EXPORT)), again.response);
    expect(again.out.body).toEqual({ created: 0, existing: 2, skipped: 0 });
  });

  it('refuses a file that is not an export, and a request with no file', async () => {
    const { handlers } = setup();
    const wrong = reply();
    await handlers.importGoodreads(req(csvFile('name,email\nA,a@example.com')), wrong.response);
    expect(wrong.out.status).toBe(422);

    const none = reply();
    await handlers.importGoodreads(req(), none.response);
    expect(none.out.status).toBe(400);
    const empty = reply();
    await handlers.importGoodreads(req(csvFile('')), empty.response);
    expect(empty.out.status).toBe(400);
  });

  it('is for someone who is signed in, and for a deployment that has the library on', async () => {
    const { handlers } = setup();
    const anonymous = reply();
    await handlers.importGoodreads(
      req({ user: undefined, ...csvFile(EXPORT) }),
      anonymous.response,
    );
    expect(anonymous.out.status).toBe(401);
    const off = reply();
    await handlers.importGoodreads(
      req({ config: { contextHub: { enabled: false } }, ...csvFile(EXPORT) }),
      off.response,
    );
    expect(off.out.status).toBe(404);
  });
});
