import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { HubThreadRecord } from '~/types';
import hubOAuthClientSchema from '~/schema/hubOAuthClient';
import { createHubMethods, type HubMethods } from './hub';
import hubThreadSchema from '~/schema/hubThread';
import hubNoteSchema from '~/schema/hubNote';

let mongoServer: MongoMemoryServer;
let methods: HubMethods;

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();

const thread = (overrides: Partial<HubThreadRecord> = {}): HubThreadRecord => ({
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
      segments: [{ kind: 'text', text: 'How do I sync context between clients?' }],
      parentId: null,
    },
  ],
  ...overrides,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  if (!mongoose.models.HubThread) {
    mongoose.model('HubThread', hubThreadSchema);
  }
  if (!mongoose.models.HubNote) {
    mongoose.model('HubNote', hubNoteSchema);
  }
  if (!mongoose.models.HubOAuthClient) {
    mongoose.model('HubOAuthClient', hubOAuthClientSchema);
  }
  methods = createHubMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
});

describe('upsertHubThread / getHubThread', () => {
  it('archives a thread and reads it back by canonical id', async () => {
    await methods.upsertHubThread(userA, thread());

    const stored = await methods.getHubThread(userA, 'claude:c1');

    expect(stored?.title).toBe('Designing the context hub');
    expect(stored?.messages).toHaveLength(1);
    expect(stored?.messages[0].segments[0].text).toContain('sync context');
  });

  it('re-archiving the same id upserts in place rather than duplicating', async () => {
    await methods.upsertHubThread(userA, thread());
    await methods.upsertHubThread(userA, thread({ title: 'Renamed' }));

    const stored = await methods.getHubThread(userA, 'claude:c1');
    const HubThread = mongoose.models.HubThread;
    const count = await HubThread.countDocuments({ id: 'claude:c1' });

    expect(count).toBe(1);
    expect(stored?.title).toBe('Renamed');
  });

  it('scopes a thread to its owner, invisible to another user', async () => {
    await methods.upsertHubThread(userA, thread());

    expect(await methods.getHubThread(userB, 'claude:c1')).toBeNull();
  });

  it('returns null for an id that was never archived', async () => {
    expect(await methods.getHubThread(userA, 'claude:missing')).toBeNull();
  });
});

describe('searchHubThreads', () => {
  beforeEach(async () => {
    await methods.upsertHubThread(userA, thread());
    await methods.upsertHubThread(
      userA,
      thread({
        id: 'chatgpt:g1',
        provider: 'chatgpt',
        sourceId: 'g1',
        title: 'Roasting carrots',
        messages: [
          {
            id: 'm1',
            role: 'user',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            segments: [{ kind: 'text', text: 'How long do I roast carrots?' }],
            parentId: null,
          },
        ],
      }),
    );
    await methods.upsertHubThread(userB, thread({ title: 'Someone else entirely' }));
  });

  it('finds a thread by message content', async () => {
    const results = await methods.searchHubThreads(userA, {
      query: 'sync context',
      limit: 10,
    });

    expect(results.map((r) => r.id)).toEqual(['claude:c1']);
  });

  it("never returns another user's archive", async () => {
    const results = await methods.searchHubThreads(userA, { query: 'entirely', limit: 10 });

    expect(results).toEqual([]);
  });

  it('restricts results to the requested providers', async () => {
    const results = await methods.searchHubThreads(userA, {
      query: 'context carrots',
      providers: ['chatgpt'],
      limit: 10,
    });

    expect(results.map((r) => r.id)).toEqual(['chatgpt:g1']);
  });

  it('honors the caller-supplied limit', async () => {
    const results = await methods.searchHubThreads(userA, { query: 'context carrots', limit: 1 });

    expect(results).toHaveLength(1);
  });

  it('treats a blank query as no search rather than matching everything', async () => {
    expect(await methods.searchHubThreads(userA, { query: '   ', limit: 10 })).toEqual([]);
  });
});

describe('listHubThreads', () => {
  it('lists threads most-recently-updated first, without requiring a search term', async () => {
    await methods.upsertHubThread(
      userA,
      thread({
        id: 'claude:older',
        sourceId: 'older',
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      }),
    );
    await methods.upsertHubThread(
      userA,
      thread({
        id: 'claude:newer',
        sourceId: 'newer',
        updatedAt: new Date('2024-06-01T00:00:00Z'),
      }),
    );

    const results = await methods.listHubThreads(userA, 10);

    expect(results.map((r) => r.id)).toEqual(['claude:newer', 'claude:older']);
  });

  it("never returns another user's archive", async () => {
    await methods.upsertHubThread(userA, thread());
    await methods.upsertHubThread(userB, thread({ id: 'claude:other', sourceId: 'other' }));

    const results = await methods.listHubThreads(userA, 10);

    expect(results.map((r) => r.id)).toEqual(['claude:c1']);
  });

  it('honors the caller-supplied limit', async () => {
    await methods.upsertHubThread(userA, thread({ id: 'claude:a', sourceId: 'a' }));
    await methods.upsertHubThread(userA, thread({ id: 'claude:b', sourceId: 'b' }));

    const results = await methods.listHubThreads(userA, 1);

    expect(results).toHaveLength(1);
  });
});

describe('thread surface', () => {
  const archiveAcrossSurfaces = async () => {
    await methods.upsertHubThread(
      userA,
      thread({ id: 'mindferry:code1', provider: 'mindferry', sourceId: 'code1', surface: 'code' }),
    );
    await methods.upsertHubThread(
      userA,
      thread({ id: 'mindferry:chat1', provider: 'mindferry', sourceId: 'chat1', surface: 'chat' }),
    );
    await methods.upsertHubThread(userA, thread({ id: 'claude:legacy', sourceId: 'legacy' }));
  };

  it('persists which client archived a thread and reads it back', async () => {
    await methods.upsertHubThread(
      userA,
      thread({ id: 'mindferry:s1', provider: 'mindferry', sourceId: 's1', surface: 'code' }),
    );

    const stored = await methods.getHubThread(userA, 'mindferry:s1');

    expect(stored?.surface).toBe('code');
  });

  it('leaves the surface unset for a thread archived without one', async () => {
    await methods.upsertHubThread(userA, thread());

    expect((await methods.getHubThread(userA, 'claude:c1'))?.surface).toBeUndefined();
  });

  it('keeps the stored surface when the thread is upserted again without one', async () => {
    await methods.upsertHubThread(
      userA,
      thread({ id: 'mindferry:s2', provider: 'mindferry', sourceId: 's2', surface: 'code' }),
    );
    await methods.upsertHubThread(
      userA,
      thread({ id: 'mindferry:s2', provider: 'mindferry', sourceId: 's2', title: 'Renamed' }),
    );

    const stored = await methods.getHubThread(userA, 'mindferry:s2');

    expect(stored?.title).toBe('Renamed');
    expect(stored?.surface).toBe('code');
  });

  it('lists only threads from the requested surface', async () => {
    await archiveAcrossSurfaces();

    const results = await methods.listHubThreads(userA, 10, 'code');

    expect(results.map((r) => r.id)).toEqual(['mindferry:code1']);
    expect(results[0].surface).toBe('code');
  });

  it('counts a thread with no recorded surface as chat', async () => {
    await archiveAcrossSurfaces();

    const results = await methods.listHubThreads(userA, 10, 'chat');

    expect(results.map((r) => r.id).sort()).toEqual(['claude:legacy', 'mindferry:chat1']);
  });

  it('narrows a text search to the requested surface', async () => {
    await archiveAcrossSurfaces();

    const results = await methods.searchHubThreads(userA, {
      query: 'context',
      surface: 'code',
      limit: 10,
    });

    expect(results.map((r) => r.id)).toEqual(['mindferry:code1']);
  });
});

describe('notes', () => {
  it('carries an appended note through to a later read', async () => {
    await methods.appendHubNote(userA, {
      title: 'Decision',
      text: 'No live sync; import exports instead.',
      threadId: 'claude:c1',
    });

    const notes = await methods.listHubNotes(userA, 'claude:c1');

    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('No live sync; import exports instead.');
  });

  it('returns only the notes anchored to the requested thread', async () => {
    await methods.appendHubNote(userA, { title: 'Anchored', text: 'a', threadId: 'claude:c1' });
    await methods.appendHubNote(userA, { title: 'Floating', text: 'b' });

    const anchored = await methods.listHubNotes(userA, 'claude:c1');
    const all = await methods.listHubNotes(userA);

    expect(anchored.map((n) => n.title)).toEqual(['Anchored']);
    expect(all.map((n) => n.title).sort()).toEqual(['Anchored', 'Floating']);
  });

  it('reads one note by id, only for the user who wrote it', async () => {
    const written = await methods.appendHubNote(userA, {
      title: 'Handoff',
      text: 'Next: update the plugin.',
      surface: 'code',
    });

    const own = await methods.getHubNote(userA, written.id);

    expect(own).toMatchObject({ id: written.id, title: 'Handoff', surface: 'code' });
    expect(await methods.getHubNote(userB, written.id)).toBeNull();
    expect(await methods.getHubNote(userA, new mongoose.Types.ObjectId().toString())).toBeNull();
    expect(await methods.getHubNote(userA, 'not-an-object-id')).toBeNull();
  });

  it("deletes only the caller's own note", async () => {
    const mine = await methods.appendHubNote(userA, { title: 'Old', text: 'stale' });
    const kept = await methods.appendHubNote(userA, { title: 'Keep', text: 'fresh' });
    const theirs = await methods.appendHubNote(userB, { title: 'Theirs', text: 'not yours' });

    expect(await methods.deleteHubNote(userB, mine.id)).toBe(false);
    expect(await methods.deleteHubNote(userA, theirs.id)).toBe(false);
    expect(await methods.deleteHubNote(userA, 'not-an-object-id')).toBe(false);
    expect(await methods.deleteHubNote(userA, mine.id)).toBe(true);
    expect(await methods.deleteHubNote(userA, mine.id)).toBe(false);

    expect((await methods.listHubNotes(userA)).map((n) => n.id)).toEqual([kept.id]);
    expect(await methods.getHubNote(userB, theirs.id)).not.toBeNull();
  });

  it('returns the most recent notes, oldest first, when limited', async () => {
    for (const title of ['one', 'two', 'three']) {
      await methods.appendHubNote(userA, { title, text: title });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const recent = await methods.listHubNotes(userA, undefined, 2);

    expect(recent.map((n) => n.title)).toEqual(['two', 'three']);
  });

  it('finds notes by a word in the title or body, scoped to their owner', async () => {
    await methods.appendHubNote(userA, { title: 'Zebra plan', text: 'about stripes' });
    await methods.appendHubNote(userA, { title: 'Other', text: 'nothing relevant' });
    await methods.appendHubNote(userB, { title: 'Zebra secret', text: 'not yours' });

    const found = await methods.searchHubNotes(userA, 'zebra', 10);

    expect(found.map((n) => n.title)).toEqual(['Zebra plan']);
  });

  it('scopes notes to their owner', async () => {
    await methods.appendHubNote(userA, { title: 'Private', text: 'a' });

    expect(await methods.listHubNotes(userB)).toEqual([]);
  });

  it('persists which surface wrote the note and its session tag', async () => {
    await methods.appendHubNote(userA, {
      title: 'Refactor plan',
      text: 'Splitting the render module.',
      threadId: 'claude:c1',
      surface: 'code',
      sessionTag: '/home/user/LibreChat',
    });

    const [note] = await methods.listHubNotes(userA, 'claude:c1');

    expect(note.surface).toBe('code');
    expect(note.sessionTag).toBe('/home/user/LibreChat');
  });

  it('leaves surface and session tag unset when the caller does not provide them', async () => {
    await methods.appendHubNote(userA, { title: 'Untagged', text: 'no metadata' });

    const [note] = await methods.listHubNotes(userA);

    expect(note.surface).toBeUndefined();
    expect(note.sessionTag).toBeUndefined();
  });
});

describe('deleteAllHubData', () => {
  it("removes only the requested user's threads and notes", async () => {
    await methods.upsertHubThread(userA, thread());
    await methods.upsertHubThread(userB, thread());
    await methods.appendHubNote(userA, { title: 'A note', text: 'x' });
    await methods.appendHubNote(userB, { title: 'B note', text: 'y' });

    const result = await methods.deleteAllHubData(userA);

    expect(result).toEqual({ deletedThreads: 1, deletedNotes: 1 });
    expect(await methods.getHubThread(userA, 'claude:c1')).toBeNull();
    expect(await methods.getHubThread(userB, 'claude:c1')).not.toBeNull();
    expect(await methods.listHubNotes(userB)).toHaveLength(1);
  });
});

describe('OAuth client registration', () => {
  it('registers a client and reads it back by id', async () => {
    await methods.registerHubOAuthClient({
      clientId: 'mf_abc123',
      clientName: 'Claude',
      redirectUris: ['https://claude.ai/api/mcp/callback'],
    });

    const client = await methods.getHubOAuthClient('mf_abc123');

    expect(client?.clientName).toBe('Claude');
    expect(client?.redirectUris).toEqual(['https://claude.ai/api/mcp/callback']);
  });

  it('returns null for a client id that was never registered', async () => {
    expect(await methods.getHubOAuthClient('mf_missing')).toBeNull();
  });

  it('rejects a second registration reusing the same client id', async () => {
    await methods.registerHubOAuthClient({
      clientId: 'mf_dup',
      redirectUris: ['https://example.com/callback'],
    });

    await expect(
      methods.registerHubOAuthClient({
        clientId: 'mf_dup',
        redirectUris: ['https://example.com/callback'],
      }),
    ).rejects.toThrow();
  });
});
