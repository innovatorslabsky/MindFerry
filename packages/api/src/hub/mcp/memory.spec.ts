import type { HubThread } from '../thread';
import { createHubMemoryStore } from './memory';

const thread = (id: string, title: string, text: string, updatedAt: string): HubThread => ({
  id,
  provider: 'claude',
  sourceId: id,
  title,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date(updatedAt),
  messages: [
    {
      id: `${id}-m`,
      role: 'user',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      segments: [{ kind: 'text', text }],
      parentId: null,
    },
  ],
});

const search = (store: ReturnType<typeof createHubMemoryStore>, query: string, limit = 10) =>
  store.searchThreads({ query, limit, snippetLength: 60 });

describe('createHubMemoryStore', () => {
  it('matches titles and message text case-insensitively', async () => {
    const store = createHubMemoryStore({
      threads: [thread('a', 'Deploy Notes', 'nothing here', '2024-02-01T00:00:00Z')],
    });

    expect(await search(store, 'deploy')).toHaveLength(1);
    expect(await search(store, 'NOTHING')).toHaveLength(1);
    expect(await search(store, 'absent')).toHaveLength(0);
  });

  it('returns the most recently updated match first', async () => {
    const store = createHubMemoryStore({
      threads: [
        thread('old', 'First', 'shared word', '2024-01-01T00:00:00Z'),
        thread('new', 'Second', 'shared word', '2024-06-01T00:00:00Z'),
      ],
    });

    expect((await search(store, 'shared')).map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('honors the caller-supplied limit', async () => {
    const store = createHubMemoryStore({
      threads: [
        thread('a', 'A', 'shared', '2024-01-01T00:00:00Z'),
        thread('b', 'B', 'shared', '2024-02-01T00:00:00Z'),
      ],
    });

    expect(await search(store, 'shared', 1)).toHaveLength(1);
  });

  it('bounds the snippet and marks where it was cut', async () => {
    const long = `${'padding '.repeat(30)}needle${' trailing'.repeat(30)}`;
    const store = createHubMemoryStore({
      threads: [thread('a', 'Long', long, '2024-01-01T00:00:00Z')],
    });

    const [match] = await search(store, 'needle');

    expect(match.snippet).toContain('needle');
    expect(match.snippet?.length).toBeLessThanOrEqual(64);
    expect(match.snippet?.startsWith('…')).toBe(true);
    expect(match.snippet?.endsWith('…')).toBe(true);
  });

  it('treats a blank query as no search rather than matching everything', async () => {
    const store = createHubMemoryStore({
      threads: [thread('a', 'A', 'text', '2024-01-01T00:00:00Z')],
    });

    expect(await search(store, '   ')).toEqual([]);
  });

  it('reports the message count a summary promises', async () => {
    const store = createHubMemoryStore({
      threads: [thread('a', 'A', 'text', '2024-01-01T00:00:00Z')],
    });

    const [match] = await search(store, 'text');

    expect(match.messageCount).toBe(1);
    expect(match.provider).toBe('claude');
  });

  it('keeps notes in the order they were appended', async () => {
    const store = createHubMemoryStore();

    await store.appendNote({ title: 'one', text: 'first' });
    await store.appendNote({ title: 'two', text: 'second' });

    expect((await store.listNotes()).map((n) => n.title)).toEqual(['one', 'two']);
  });

  it('returns only the most recent notes, oldest first, when given a limit', async () => {
    const store = createHubMemoryStore();

    await store.appendNote({ title: 'one', text: 'first' });
    await store.appendNote({ title: 'two', text: 'second' });
    await store.appendNote({ title: 'three', text: 'third' });

    expect((await store.listNotes(undefined, 2)).map((n) => n.title)).toEqual(['two', 'three']);
  });
});
