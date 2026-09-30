import type { HubStoreMethods, HubSemanticSearchOptions } from './mongoStore';
import type { EmbeddingProvider } from './embeddings';
import type { HubThread } from '../thread';
import { createHubMongoStore, archiveHubThread } from './mongoStore';

const thread: HubThread = {
  id: 'claude:c1',
  provider: 'claude',
  sourceId: 'c1',
  title: 'Designing the context hub',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
  messages: [
    {
      id: 'm1',
      role: 'user',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      segments: [{ kind: 'text', text: 'hello' }],
      parentId: null,
    },
  ],
};

function fakeMethods(overrides: Partial<HubStoreMethods> = {}): jest.Mocked<HubStoreMethods> {
  return {
    upsertHubThread: jest.fn().mockResolvedValue(undefined),
    getHubThread: jest.fn().mockResolvedValue(null),
    searchHubThreads: jest.fn().mockResolvedValue([]),
    listHubNotes: jest.fn().mockResolvedValue([]),
    appendHubNote: jest.fn(),
    searchHubNotes: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<HubStoreMethods>;
}

describe('createHubMongoStore', () => {
  it('binds every call to the userId it was constructed with', async () => {
    const methods = fakeMethods();
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    await store.searchThreads({ query: 'x', limit: 5, snippetLength: 40 });
    await store.getThread('claude:c1');
    await store.listNotes('claude:c1');
    await store.appendNote({ title: 't', text: 'x' });
    await store.searchNotes('zebra', 5);

    expect(methods.searchHubThreads).toHaveBeenCalledWith('user-a', expect.any(Object));
    expect(methods.getHubThread).toHaveBeenCalledWith('user-a', 'claude:c1');
    expect(methods.listHubNotes).toHaveBeenCalledWith('user-a', 'claude:c1', undefined);
    expect(methods.appendHubNote).toHaveBeenCalledWith('user-a', { title: 't', text: 'x' });
    expect(methods.searchHubNotes).toHaveBeenCalledWith('user-a', 'zebra', 5);
  });

  it('archives a verbatim thread under the given sourceId, scoped to the user', async () => {
    const methods = fakeMethods();
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    const summary = await store.archiveThread({
      title: 'Deciding on the sync mechanism',
      sourceId: 'session-1',
      messages: [
        { role: 'user', text: 'How should two clients share context?' },
        { role: 'assistant', text: 'Archive the whole thread.' },
      ],
    });

    expect(summary).toMatchObject({ id: 'mindferry:session-1', messageCount: 2 });
    expect(methods.upsertHubThread).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        id: 'mindferry:session-1',
        provider: 'mindferry',
        sourceId: 'session-1',
        title: 'Deciding on the sync mechanism',
        messages: [
          expect.objectContaining({ role: 'user', parentId: null }),
          expect.objectContaining({ role: 'assistant', parentId: 'm1' }),
        ],
      }),
    );
  });

  it('keeps the stored creation time when a sourceId is archived again', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const methods = fakeMethods({
      getHubThread: jest.fn().mockResolvedValue({
        id: 'mindferry:session-1',
        provider: 'mindferry',
        sourceId: 'session-1',
        title: 'Old title',
        createdAt: created,
        updatedAt: created,
        messages: [
          {
            id: 'm1',
            role: 'user',
            createdAt: created,
            segments: [{ kind: 'text', text: 'Hello' }],
            parentId: null,
          },
        ],
      }),
    });
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    await store.archiveThread({
      title: 'New title',
      sourceId: 'session-1',
      messages: [{ role: 'user', text: 'Hello' }],
    });

    expect(methods.getHubThread).toHaveBeenCalledWith('user-a', 'mindferry:session-1');
    expect(methods.upsertHubThread).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        createdAt: created,
        messages: [expect.objectContaining({ createdAt: created })],
      }),
    );
  });

  it('maps a persisted record back into a HubThread', async () => {
    const methods = fakeMethods({
      getHubThread: jest.fn().mockResolvedValue({
        id: thread.id,
        provider: thread.provider,
        sourceId: thread.sourceId,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messages: thread.messages,
      }),
    });
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    const result = await store.getThread('claude:c1');

    expect(result?.title).toBe('Designing the context hub');
    expect(result?.messages).toHaveLength(1);
  });

  it('returns undefined rather than null when a thread is absent', async () => {
    const store = createHubMongoStore({ methods: fakeMethods(), userId: 'user-a' });

    expect(await store.getThread('claude:missing')).toBeUndefined();
  });

  it('computes a snippet from the persisted searchText around the match', async () => {
    const methods = fakeMethods({
      searchHubThreads: jest.fn().mockResolvedValue([
        {
          id: 'claude:c1',
          provider: 'claude',
          title: 'Designing the context hub',
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messageCount: 1,
          searchText: `${'padding '.repeat(20)}needle${' trailing'.repeat(20)}`,
        },
      ]),
    });
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    const [result] = await store.searchThreads({ query: 'needle', limit: 10, snippetLength: 40 });

    expect(result.snippet).toContain('needle');
    expect(result.snippet?.length).toBeLessThanOrEqual(44);
  });

  it('leaves the snippet undefined when the query no longer matches the stored text', async () => {
    const methods = fakeMethods({
      searchHubThreads: jest.fn().mockResolvedValue([
        {
          id: 'claude:c1',
          provider: 'claude',
          title: 'Designing the context hub',
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messageCount: 1,
          searchText: 'unrelated content entirely',
        },
      ]),
    });
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    const [result] = await store.searchThreads({ query: 'needle', limit: 10, snippetLength: 40 });

    expect(result.snippet).toBeUndefined();
  });

  it('fetches exactly params.limit candidates when semanticSearch is not configured', async () => {
    const methods = fakeMethods();
    const store = createHubMongoStore({ methods, userId: 'user-a' });

    await store.searchThreads({ query: 'needle', limit: 5, snippetLength: 40 });

    expect(methods.searchHubThreads).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ limit: 5 }),
    );
  });
});

describe('createHubMongoStore with semanticSearch', () => {
  function fakeEmbeddingProvider(byText: Record<string, number[]>): EmbeddingProvider {
    return {
      embed: jest.fn(async (texts: readonly string[]) =>
        texts.map((text) => byText[text] ?? [0, 0]),
      ),
    };
  }

  function candidate(overrides: { id: string; searchText: string; updatedAt?: Date }) {
    return {
      id: overrides.id,
      provider: 'claude',
      title: overrides.id,
      createdAt: thread.createdAt,
      updatedAt: overrides.updatedAt ?? thread.updatedAt,
      messageCount: 1,
      searchText: overrides.searchText,
    };
  }

  it('widens the lexical fetch to candidatePoolSize, then truncates back to limit', async () => {
    const methods = fakeMethods({ searchHubThreads: jest.fn().mockResolvedValue([]) });
    const semanticSearch: HubSemanticSearchOptions = {
      provider: fakeEmbeddingProvider({}),
      weight: 0.5,
      candidatePoolSize: 50,
    };
    const store = createHubMongoStore({ methods, userId: 'user-a', semanticSearch });

    await store.searchThreads({ query: 'needle', limit: 5, snippetLength: 40 });

    expect(methods.searchHubThreads).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('reorders results toward the semantically closer candidate over raw lexical rank', async () => {
    // 'lexical-best' ranks first out of $text, but 'semantic-best' is the
    // query's actual nearest neighbor — a high semantic weight should surface it.
    const methods = fakeMethods({
      searchHubThreads: jest
        .fn()
        .mockResolvedValue([
          candidate({ id: 'claude:lexical-best', searchText: 'needle needle needle' }),
          candidate({ id: 'claude:semantic-best', searchText: 'about sewing thread' }),
        ]),
    });
    const semanticSearch: HubSemanticSearchOptions = {
      provider: fakeEmbeddingProvider({
        query: [1, 0],
        'needle needle needle': [0, 1],
        'about sewing thread': [1, 0],
      }),
      weight: 0.9,
      candidatePoolSize: 10,
    };
    const store = createHubMongoStore({ methods, userId: 'user-a', semanticSearch });

    const results = await store.searchThreads({ query: 'query', limit: 2, snippetLength: 40 });

    expect(results.map((r) => r.id)).toEqual(['claude:semantic-best', 'claude:lexical-best']);
  });

  it('falls back to lexical order when the embedding call fails', async () => {
    const methods = fakeMethods({
      searchHubThreads: jest
        .fn()
        .mockResolvedValue([
          candidate({ id: 'claude:a', searchText: 'first' }),
          candidate({ id: 'claude:b', searchText: 'second' }),
        ]),
    });
    const semanticSearch: HubSemanticSearchOptions = {
      provider: { embed: jest.fn().mockRejectedValue(new Error('embeddings endpoint down')) },
      weight: 0.9,
      candidatePoolSize: 10,
    };
    const store = createHubMongoStore({ methods, userId: 'user-a', semanticSearch });

    const results = await store.searchThreads({ query: 'query', limit: 2, snippetLength: 40 });

    expect(results.map((r) => r.id)).toEqual(['claude:a', 'claude:b']);
  });

  it('truncates the re-ranked list back down to the caller-requested limit', async () => {
    const methods = fakeMethods({
      searchHubThreads: jest
        .fn()
        .mockResolvedValue([
          candidate({ id: 'claude:a', searchText: 'a' }),
          candidate({ id: 'claude:b', searchText: 'b' }),
          candidate({ id: 'claude:c', searchText: 'c' }),
        ]),
    });
    const semanticSearch: HubSemanticSearchOptions = {
      provider: fakeEmbeddingProvider({}), // every vector [0, 0] -> similarity undefined -> lexical order kept
      weight: 0.5,
      candidatePoolSize: 10,
    };
    const store = createHubMongoStore({ methods, userId: 'user-a', semanticSearch });

    const results = await store.searchThreads({ query: 'query', limit: 1, snippetLength: 40 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('claude:a');
  });
});

describe('archiveHubThread', () => {
  it('converts a canonical thread into the persisted record shape and scopes it to the user', async () => {
    const upsertHubThread = jest.fn().mockResolvedValue(undefined);

    await archiveHubThread({ upsertHubThread }, 'user-a', thread);

    expect(upsertHubThread).toHaveBeenCalledWith('user-a', {
      id: thread.id,
      provider: thread.provider,
      sourceId: thread.sourceId,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: [
        {
          id: 'm1',
          role: 'user',
          createdAt: thread.createdAt,
          segments: [{ kind: 'text', text: 'hello' }],
          parentId: null,
          model: undefined,
        },
      ],
    });
  });
});
