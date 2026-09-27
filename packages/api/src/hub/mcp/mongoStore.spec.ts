import type { HubStoreMethods } from './mongoStore';
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

    expect(methods.searchHubThreads).toHaveBeenCalledWith('user-a', expect.any(Object));
    expect(methods.getHubThread).toHaveBeenCalledWith('user-a', 'claude:c1');
    expect(methods.listHubNotes).toHaveBeenCalledWith('user-a', 'claude:c1');
    expect(methods.appendHubNote).toHaveBeenCalledWith('user-a', { title: 't', text: 'x' });
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
