import { JSDOM } from 'jsdom';
import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { sanitizeArticleHtml } from '../ingest/extract';
import { createLibraryHandlers } from '../routes';
import { createLibraryService } from '../service';

const user = 'u1';
const SEP = '==========';
const entry = (title: string, meta: string, text: string) =>
  `${title}\r\n- ${meta}\r\n\r\n${text}\r\n${SEP}\r\n`;
const clip = (n: number, text: string) =>
  entry(
    'Dune (Herbert, Frank)',
    `Your Highlight on page ${n} | location ${n * 10}-${n * 10 + 1} | Added on x`,
    text,
  );

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

const file = (text: string) => ({ file: { buffer: Buffer.from(text, 'utf8') } });

describe('importing Kindle highlights', () => {
  it('makes a document per book with each highlight highlighted, and the note kept on it', async () => {
    const { handlers, service } = setup();
    const text =
      '\uFEFF' +
      clip(1, 'I must not fear.') +
      clip(2, 'Fear is the mind-killer.') +
      entry(
        'Dune (Herbert, Frank)',
        'Your Note on page 1 | location 10 | Added on x',
        'My first note',
      );
    const out = reply();
    await handlers.importKindle(req(file(text)), out.response);
    expect(out.out.status).toBe(200);
    expect(out.out.body).toEqual({ books: 1, highlights: 2, existing: 0, notes: 1, skipped: 0 });

    const [doc] = await service.list(user, { limit: 10 });
    expect(doc).toMatchObject({ title: 'Dune', byline: 'Frank Herbert', location: 'archive' });
    const full = (await service.get(user, doc.id))!;
    expect(full.text).toBe('I must not fear.\nFear is the mind-killer.');
    const highlights = await service.listHighlights(user, doc.id);
    expect(highlights.map((h) => full.text.slice(h.anchor.start, h.anchor.end))).toEqual([
      'I must not fear.',
      'Fear is the mind-killer.',
    ]);
    expect(highlights[0].note).toBe('My first note');
  });

  it('adds nothing the second time, and only what is new when the file has grown', async () => {
    const { handlers, service } = setup();
    const first = '\uFEFF' + clip(1, 'One.') + clip(2, 'Two.');
    await handlers.importKindle(req(file(first)), reply().response);

    const again = reply();
    await handlers.importKindle(req(file(first)), again.response);
    expect(again.out.body).toMatchObject({ highlights: 0, existing: 2 });

    const grown = reply();
    await handlers.importKindle(req(file(first + clip(3, 'Three.'))), grown.response);
    expect(grown.out.body).toMatchObject({ highlights: 1, existing: 2 });
    const [doc] = await service.list(user, { limit: 10 });
    expect(await service.listHighlights(user, doc.id)).toHaveLength(3);
  });

  it('keeps one document for a book, apart from another person’s', async () => {
    const { handlers, service } = setup();
    await handlers.importKindle(req(file(clip(1, 'Mine.'))), reply().response);
    await handlers.importKindle(
      req({ user: { id: 'u2' }, ...file(clip(1, 'Theirs.')) }),
      reply().response,
    );
    expect(await service.list(user, { limit: 10 })).toHaveLength(1);
    expect(await service.list('u2', { limit: 10 })).toHaveLength(1);
  });

  it('refuses a file that is not clippings, and a request with no file', async () => {
    const { handlers } = setup();
    const wrong = reply();
    await handlers.importKindle(req(file('hello\nthere')), wrong.response);
    expect(wrong.out.status).toBe(422);
    const none = reply();
    await handlers.importKindle(req(), none.response);
    expect(none.out.status).toBe(400);
    const anonymous = reply();
    await handlers.importKindle(
      req({ user: undefined, ...file(clip(1, 'x')) }),
      anonymous.response,
    );
    expect(anonymous.out.status).toBe(401);
  });

  it('shows on screen exactly the text the highlights are anchored in, whatever the highlights contain', () => {
    const paragraphs = [
      'Plain.',
      'Has <b>tags</b> & "quotes" and \'apostrophes\'.',
      'Two\nlines.',
      '  padded  ',
    ];
    const html = sanitizeArticleHtml(
      paragraphs
        .map(
          (p) =>
            `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`,
        )
        .join('\n'),
    );
    const shown = new JSDOM(`<body>${html}</body>`).window.document.body.textContent;
    expect(shown).toBe(paragraphs.join('\n'));
  });
});
