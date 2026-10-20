import type { Response } from 'express';
import type { ServerRequest } from '../../types/http';
import type { LibraryChatImporter } from '../routes';
import { createFakeLibraryMethods } from './helpers/fakeLibraryMethods';
import { convertLibraryAskToChat, needsTopic } from '../ask';
import { createLibraryService } from '../service';
import { createLibraryHandlers } from '../routes';

const user = 'u1';
const HASH = 'a'.repeat(64);

const TEXTS: Record<string, string> = {
  memory: 'Memory decays on a forgetting curve and spacing helps.',
  sleep: 'Sleep consolidates what was learned during the day.',
  cooking: 'Salt the water before the pasta goes in.',
};

async function setup(options: { chatMaxChars?: number } = {}) {
  const fake = createFakeLibraryMethods();
  const imports: Array<{ payload: ReturnType<typeof convertLibraryAskToChat> }> = [];
  const importConversation: LibraryChatImporter = async ({ payload }) => {
    imports.push({ payload });
    return { conversationId: 'chat-1' };
  };
  const service = createLibraryService({
    methods: fake.methods,
    chatMaxChars: options.chatMaxChars,
  });
  const ids: Record<string, string> = {};
  for (const [key, text] of Object.entries(TEXTS)) {
    const saved = await fake.methods.saveLibraryDocument(user, {
      urlKey: key,
      normalizedUrl: `https://example.test/${key}`,
      title: `About ${key}`,
      siteName: 'example.test',
      contentHtml: `<p>${text}</p>`,
      text,
      contentHash: HASH,
      wordCount: 8,
      readingMinutes: 2,
      fetchedAt: new Date(),
      tags: [key],
      location: key === 'cooking' ? 'archive' : 'inbox',
    });
    ids[key] = saved.document.id;
  }
  return {
    ...fake,
    service,
    imports,
    ids,
    handlers: createLibraryHandlers({ service, importConversation }),
  };
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

const req = (body: unknown, overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: user },
    config: { contextHub: { enabled: false, library: { enabled: true } } },
    body,
    query: {},
    params: {},
    ...overrides,
  }) as unknown as ServerRequest;

describe('asking the whole library', () => {
  it('needs a subject only for the modes that are about one', () => {
    expect(['find', 'learn', 'research'].every((m) => needsTopic(m as never))).toBe(true);
    expect(['catchup', 'recommend'].some((m) => needsTopic(m as never))).toBe(false);
  });

  it('finds documents about a subject and opens a chat on them', async () => {
    const { handlers, imports } = await setup();
    const out = reply();
    await handlers.ask(
      req({ mode: 'learn', topic: 'Memory', endpoint: 'openAI', model: 'gpt-x' }),
      out.response,
    );
    expect(out.out.status).toBe(201);
    expect(out.out.body).toEqual({ conversationId: 'chat-1' });
    const { payload } = imports[0];
    expect(payload.endpoint).toBe('openAI');
    const [question, ready] = payload.messages;
    expect(question.isCreatedByUser).toBe(true);
    expect(question.text).toContain('Teach me about “Memory”');
    expect(question.text).toContain('Memory decays on a forgetting curve');
    expect(question.text).not.toContain('Salt the water');
    expect(question.text).toContain('written by a third party');
    expect(ready.isCreatedByUser).toBe(false);
    expect(ready.text).toContain('1 of your saved documents');
  });

  it('shows only the opening of each document when finding', async () => {
    const { service } = await setup();
    const found = await service.askSource(user, { mode: 'find', topic: 'a' });
    expect('entries' in found).toBe(true);
    if ('entries' in found) {
      expect(found.entries.every((entry) => entry.highlights.length === 0)).toBe(true);
    }
  });

  it('shares the character cap between the documents it reads in full', async () => {
    const { service } = await setup({ chatMaxChars: 100 });
    const found = await service.askSource(user, { mode: 'research', topic: 'e' });
    if (!('entries' in found)) throw new Error('expected entries');
    // The share has a floor, so a tiny cap never leaves a document with no text at all.
    expect(found.entries.length).toBeGreaterThan(1);
    expect(found.entries.every((entry) => entry.text.length > 0)).toBe(true);
  });

  it('recommends only what is not archived, and catches up on everything', async () => {
    const { service } = await setup();
    const recommend = await service.askSource(user, { mode: 'recommend' });
    const catchup = await service.askSource(user, { mode: 'catchup' });
    if (!('entries' in recommend) || !('entries' in catchup)) throw new Error('expected entries');
    expect(recommend.entries.map((e) => e.document.title).sort()).toEqual([
      'About memory',
      'About sleep',
    ]);
    expect(catchup.entries).toHaveLength(3);
  });

  it('refuses a subject-less find, an empty library and a subject nothing matches', async () => {
    const { handlers } = await setup();
    const noTopic = reply();
    await handlers.ask(req({ mode: 'find' }), noTopic.response);
    expect(noTopic.out.status).toBe(400);
    const none = reply();
    await handlers.ask(req({ mode: 'find', topic: 'quantum' }), none.response);
    expect(none.out.status).toBe(422);
    expect((none.out.body as { error: { code: string } }).error.code).toBe('no_matches');
    const empty = reply();
    await handlers.ask(req({ mode: 'catchup' }, { user: { id: 'someone-else' } }), empty.response);
    expect(empty.out.status).toBe(422);
    expect((empty.out.body as { error: { code: string } }).error.code).toBe('empty_library');
  });

  it('refuses a mode it does not know and a model name that is not a name', async () => {
    const { handlers } = await setup();
    for (const body of [
      { mode: 'summarise', topic: 'x' },
      { mode: 'find', topic: 'x'.repeat(301) },
      { mode: 'find', topic: 'memory', model: 'bad name; drop' },
    ]) {
      const out = reply();
      await handlers.ask(req(body), out.response);
      expect(out.out.status).toBe(400);
    }
  });

  it('only ever reads the caller’s own documents', async () => {
    const { handlers, imports } = await setup();
    const out = reply();
    await handlers.ask(req({ mode: 'catchup' }, { user: { id: 'u2' } }), out.response);
    expect(out.out.status).toBe(422);
    expect(imports).toHaveLength(0);
  });

  it('counts the documents of the person asking', async () => {
    const { handlers } = await setup();
    const mine = reply();
    await handlers.count(req({}), mine.response);
    expect(mine.out.body).toEqual({ count: 3 });
    const other = reply();
    await handlers.count(req({}, { user: { id: 'u2' } }), other.response);
    expect(other.out.body).toEqual({ count: 0 });
  });
});

describe('convertLibraryAskToChat', () => {
  it('labels each document and leaves the last word to the person', () => {
    const doc = (id: string, extra: Record<string, unknown> = {}) =>
      ({
        id,
        title: `Doc ${id}`,
        kind: 'article',
        readingMinutes: 3,
        tags: ['a', 'b'],
        ...extra,
      }) as never;
    const payload = convertLibraryAskToChat({
      mode: 'catchup',
      entries: [
        {
          document: doc('1', { summary: 'Short.', note: 'Mine' }),
          text: 'Opening.',
          truncated: false,
          highlights: [],
        },
        { document: doc('2'), text: '', truncated: false, highlights: [] },
      ],
    });
    const text = payload.messages[0].text;
    expect(text).toContain('[Document 1] “Doc 1”');
    expect(text).toContain('My summary: Short.');
    expect(text).toContain('My note: Mine');
    expect(text).toContain('<<<TEXT 1\nOpening.\nTEXT 1>>>');
    expect(text).toContain('(no preview of the text)');
    expect(payload.messages[1].isCreatedByUser).toBe(false);
    expect(payload.messages[1].parentMessageId).toBe(payload.messages[0].messageId);
  });
});
