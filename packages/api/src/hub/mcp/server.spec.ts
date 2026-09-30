import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { HubMcpServerOptions } from './server';
import type { HubThread } from '../thread';
import { createChatGptSource } from '../adapters/chatgpt';
import { createClaudeSource } from '../adapters/claude';
import { createHubMemoryStore } from './memory';
import { createHubMcpServer } from './server';

const claudeThreads: HubThread[] = createClaudeSource().parse([
  {
    uuid: 'c1',
    name: 'Designing the context hub',
    created_at: '2024-01-07T10:00:00.000Z',
    updated_at: '2024-01-09T10:00:00.000Z',
    chat_messages: [
      {
        uuid: 'm1',
        sender: 'human',
        created_at: '2024-01-07T10:00:00.000Z',
        content: [{ type: 'text', text: 'How do I sync context between clients?' }],
      },
      {
        uuid: 'm2',
        sender: 'assistant',
        created_at: '2024-01-07T10:00:05.000Z',
        content: [
          { type: 'thinking', thinking: 'They need a shared archive.' },
          { type: 'text', text: 'Archive both sides, then read one canonical store.' },
        ],
      },
    ],
  },
]);

const chatGptThreads: HubThread[] = createChatGptSource().parse([
  {
    title: 'Unrelated recipe chat',
    conversation_id: 'g1',
    create_time: 1704629915,
    update_time: 1704629999,
    mapping: {
      a: {
        id: 'a',
        parent: null,
        message: {
          author: { role: 'user' },
          create_time: 1704629915,
          content: { content_type: 'text', parts: ['How long do I roast carrots?'] },
        },
      },
    },
  },
]);

const textOf = (result: CallToolResult): string => {
  const [first] = result.content;
  return first && first.type === 'text' ? first.text : '';
};

async function connect(options: Partial<HubMcpServerOptions> = {}) {
  const store =
    options.store ?? createHubMemoryStore({ threads: [...claudeThreads, ...chatGptThreads] });
  const server = createHubMcpServer({ ...options, store });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'hub-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, store, close: () => client.close() };
}

const call = (client: Client, name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

describe('createHubMcpServer', () => {
  it('advertises the read tools and, by default, the write tool', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'append_note',
      'archive_thread',
      'get_thread',
      'get_thread_outline',
      'read_notes',
      'search_context',
    ]);
    await close();
  });

  it('withholds append_note when the hub is configured read-only', async () => {
    const { client, close } = await connect({ allowNotes: false });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain('append_note');
    await close();
  });

  it('withholds archive_thread when the operator disables archiving over MCP', async () => {
    const { client, close } = await connect({ allowArchive: false });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain('archive_thread');
    await close();
  });

  describe('search_context', () => {
    it('lists a matching note separately, with the thread it is anchored to', async () => {
      const { client, store, close } = await connect();
      await store.appendNote({
        title: 'Sync decision',
        text: 'We chose zebra archiving over live sync.',
        threadId: 'claude:c1',
        surface: 'code',
      });

      const found = textOf(await call(client, 'search_context', { query: 'zebra' }));

      expect(found).toContain('Notes');
      expect(found).toContain('Sync decision');
      expect(found).toContain('zebra archiving');
      expect(found).toContain('thread: claude:c1');
      await close();
    });

    it('leaves notes out when the search is restricted to providers', async () => {
      const { client, store, close } = await connect();
      await store.appendNote({ title: 'N', text: 'zebra note' });

      const found = textOf(
        await call(client, 'search_context', { query: 'zebra', providers: ['claude'] }),
      );

      expect(found).toContain('No archived conversation matches');
      await close();
    });

    it('finds a thread by its message content and returns its id', async () => {
      const { client, close } = await connect();

      const text = textOf(await call(client, 'search_context', { query: 'canonical store' }));

      expect(text).toContain('Designing the context hub');
      expect(text).toContain('id: claude:c1');
      expect(text).toContain('match:');
      await close();
    });

    it('searches across providers and can be restricted to one', async () => {
      const { client, close } = await connect();

      const all = textOf(await call(client, 'search_context', { query: 'how' }));
      const claudeOnly = textOf(
        await call(client, 'search_context', { query: 'how', providers: ['claude'] }),
      );

      expect(all).toContain('claude:c1');
      expect(all).toContain('chatgpt:g1');
      expect(claudeOnly).toContain('claude:c1');
      expect(claudeOnly).not.toContain('chatgpt:g1');
      await close();
    });

    it('clamps a request for more results than the configured ceiling', async () => {
      const seen: number[] = [];
      const store = createHubMemoryStore({ threads: claudeThreads });
      const { client, close } = await connect({
        searchLimit: 2,
        store: {
          ...store,
          searchThreads: (params) => {
            seen.push(params.limit);
            return store.searchThreads(params);
          },
        },
      });

      await call(client, 'search_context', { query: 'how', limit: 50 });
      await call(client, 'search_context', { query: 'how' });

      expect(seen).toEqual([2, 2]);
      await close();
    });

    it('says so plainly when nothing matches', async () => {
      const { client, close } = await connect();

      const text = textOf(await call(client, 'search_context', { query: 'kubernetes' }));

      expect(text).toContain('No archived conversation matches');
      await close();
    });

    it('rejects an empty query at the protocol boundary', async () => {
      const { client, close } = await connect();

      const result = await call(client, 'search_context', { query: '' });

      expect(result.isError).toBe(true);
      await close();
    });
  });

  describe('get_thread', () => {
    it('returns the full conversation as Markdown, reasoning included', async () => {
      const { client, close } = await connect();

      const text = textOf(await call(client, 'get_thread', { id: 'claude:c1' }));

      expect(text).toContain('provider: claude');
      expect(text).toContain('# Designing the context hub');
      expect(text).toContain('## User · 2024-01-07T10:00:00.000Z');
      expect(text).toContain('```thinking\nThey need a shared archive.\n```');
      await close();
    });

    it('reports an unknown id instead of failing the call', async () => {
      const { client, close } = await connect();

      const result = await call(client, 'get_thread', { id: 'claude:missing' });

      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain('No archived conversation has id');
      await close();
    });

    it('returns only the requested messages when messageIds is given', async () => {
      const { client, close } = await connect();

      const text = textOf(
        await call(client, 'get_thread', { id: 'claude:c1', messageIds: ['m1'] }),
      );

      expect(text).toContain('How do I sync context between clients?');
      expect(text).not.toContain('Archive both sides, then read one canonical store.');
      await close();
    });
  });

  describe('get_thread_outline', () => {
    it('lists every message as a compact entry, without the full segment text', async () => {
      const { client, close } = await connect();

      const text = textOf(await call(client, 'get_thread_outline', { id: 'claude:c1' }));

      expect(text).toContain('- m1 · User ·');
      expect(text).toContain('How do I sync context between clients?');
      expect(text).toContain('- m2 · Assistant ·');
      expect(text).toContain('· thinking');
      await close();
    });

    it("names an id get_thread's messageIds can then fetch in full", async () => {
      const { client, close } = await connect();

      const outline = textOf(await call(client, 'get_thread_outline', { id: 'claude:c1' }));
      expect(outline).toContain('m2');

      const full = textOf(
        await call(client, 'get_thread', { id: 'claude:c1', messageIds: ['m2'] }),
      );
      expect(full).toContain('Archive both sides, then read one canonical store.');
      await close();
    });

    it('reports an unknown id instead of failing the call', async () => {
      const { client, close } = await connect();

      const result = await call(client, 'get_thread_outline', { id: 'claude:missing' });

      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain('No archived conversation has id');
      await close();
    });
  });

  describe('notes', () => {
    it('carries a note from one client through to the next reader', async () => {
      const store = createHubMemoryStore({ threads: claudeThreads });
      const writer = await connect({ store });
      const reader = await connect({ store });

      await call(writer.client, 'append_note', {
        title: 'Decision',
        text: 'No live sync; import exports instead.',
        threadId: 'claude:c1',
      });
      const text = textOf(await call(reader.client, 'read_notes', { threadId: 'claude:c1' }));

      expect(text).toContain('## Decision');
      expect(text).toContain('No live sync; import exports instead.');
      await writer.close();
      await reader.close();
    });

    it('returns only the notes anchored to the requested thread', async () => {
      const { client, close } = await connect();

      await call(client, 'append_note', { title: 'Anchored', text: 'a', threadId: 'claude:c1' });
      await call(client, 'append_note', { title: 'Floating', text: 'b' });

      expect(textOf(await call(client, 'read_notes', { threadId: 'claude:c1' }))).not.toContain(
        'Floating',
      );
      expect(textOf(await call(client, 'read_notes'))).toContain('Floating');
      await close();
    });

    it('says so plainly when there are no notes yet', async () => {
      const { client, close } = await connect();

      expect(textOf(await call(client, 'read_notes'))).toContain('The hub has no notes.');
      await close();
    });

    it('tags a note with which client wrote it and a session, so readers can tell them apart', async () => {
      const store = createHubMemoryStore({ threads: claudeThreads });
      const codeSession = await connect({ store });
      const chatSession = await connect({ store });

      await call(codeSession.client, 'append_note', {
        title: 'Refactor plan',
        text: 'Splitting the render module.',
        threadId: 'claude:c1',
        surface: 'code',
        sessionTag: '/home/user/LibreChat',
      });
      await call(chatSession.client, 'append_note', {
        title: 'Design question',
        text: 'Should notes be per-thread or global?',
        threadId: 'claude:c1',
        surface: 'chat',
      });

      const text = textOf(await call(chatSession.client, 'read_notes', { threadId: 'claude:c1' }));

      expect(text).toContain('code');
      expect(text).toContain('/home/user/LibreChat');
      expect(text).toContain('chat');
      await codeSession.close();
      await chatSession.close();
    });

    it('leaves surface and session tag off the rendering when a note carries neither', async () => {
      const { client, close } = await connect();

      await call(client, 'append_note', { title: 'Untagged', text: 'no metadata here' });
      const text = textOf(await call(client, 'read_notes'));

      expect(text).toContain('## Untagged');
      expect(text).not.toContain('undefined');
      await close();
    });
  });

  describe('archive_thread', () => {
    it('archives a full conversation verbatim, readable by get_thread and search_context', async () => {
      const store = createHubMemoryStore();
      const writer = await connect({ store });
      const reader = await connect({ store });

      const archived = await call(writer.client, 'archive_thread', {
        title: 'Deciding on the sync mechanism',
        sourceId: 'session-1',
        messages: [
          { role: 'user', text: 'How should two clients share context?' },
          { role: 'assistant', text: 'Archive the whole thread, not just a summary.' },
        ],
      });

      expect(textOf(archived)).toContain('mindferry:session-1');
      expect(textOf(archived)).toContain('2 messages');

      const found = textOf(await call(reader.client, 'search_context', { query: 'share context' }));
      expect(found).toContain('mindferry:session-1');

      const full = textOf(await call(reader.client, 'get_thread', { id: 'mindferry:session-1' }));
      expect(full).toContain('How should two clients share context?');
      expect(full).toContain('Archive the whole thread, not just a summary.');

      await writer.close();
      await reader.close();
    });

    it('updates the existing thread when called again with the same sourceId', async () => {
      const { client, close } = await connect();

      await call(client, 'archive_thread', {
        title: 'Draft title',
        sourceId: 'session-2',
        messages: [{ role: 'user', text: 'First turn only.' }],
      });
      await call(client, 'archive_thread', {
        title: 'Final title',
        sourceId: 'session-2',
        messages: [
          { role: 'user', text: 'First turn only.' },
          { role: 'assistant', text: 'Now with a reply.' },
        ],
      });

      const full = textOf(await call(client, 'get_thread', { id: 'mindferry:session-2' }));

      expect(full).toContain('Now with a reply.');
      const found = textOf(await call(client, 'search_context', { query: 'Final title' }));
      expect(found.match(/mindferry:session-2/g)).toHaveLength(1);
      await close();
    });

    it('keeps the original creation time of a thread and its unchanged turns on update', async () => {
      let tick = 0;
      const store = createHubMemoryStore({
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      });
      const { client, close } = await connect({ store });
      const turns = [{ role: 'user', text: 'First turn.' }];

      await call(client, 'archive_thread', { title: 'T', sourceId: 'keep', messages: turns });
      await call(client, 'archive_thread', {
        title: 'T',
        sourceId: 'keep',
        messages: [...turns, { role: 'assistant', text: 'Later reply.' }],
      });

      const thread = await store.getThread('mindferry:keep');
      const [first, second] = thread?.messages ?? [];
      expect(thread?.createdAt.getTime()).toBe(first.createdAt.getTime());
      expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
      await close();
    });

    it('rejects a conversation over the configured byte limit with an actionable error', async () => {
      const { client, close } = await connect({ maxArchiveBytes: 1000 });

      const result = await call(client, 'archive_thread', {
        title: 'Too big',
        sourceId: 'big',
        messages: [{ role: 'user', text: 'x'.repeat(1001) }],
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('different sourceIds');
      expect(textOf(await call(client, 'get_thread', { id: 'mindferry:big' }))).toContain(
        'No archived conversation',
      );
      await close();
    });

    it('records which client archived a thread and shows it in search results', async () => {
      const { client, close } = await connect();

      await call(client, 'archive_thread', {
        title: 'A Claude Code session',
        sourceId: 'code-1',
        surface: 'code',
        messages: [{ role: 'user', text: 'refactor the flamingo module' }],
      });

      const found = textOf(await call(client, 'search_context', { query: 'flamingo' }));

      expect(found).toContain('mindferry:code-1');
      expect(found).toContain('surface: code');
      await close();
    });

    it('filters search_context by surface, counting a thread with no surface as chat', async () => {
      const { client, close } = await connect();
      await call(client, 'archive_thread', {
        title: 'Code one',
        sourceId: 'c1',
        surface: 'code',
        messages: [{ role: 'user', text: 'pelican in the terminal' }],
      });
      await call(client, 'archive_thread', {
        title: 'Chat one',
        sourceId: 'c2',
        surface: 'chat',
        messages: [{ role: 'user', text: 'pelican in the browser' }],
      });
      await call(client, 'archive_thread', {
        title: 'Legacy one',
        sourceId: 'c3',
        messages: [{ role: 'user', text: 'pelican from an old client' }],
      });

      const code = textOf(
        await call(client, 'search_context', { query: 'pelican', surface: 'code' }),
      );
      const chat = textOf(
        await call(client, 'search_context', { query: 'pelican', surface: 'chat' }),
      );

      expect(code).toContain('mindferry:c1');
      expect(code).not.toContain('mindferry:c2');
      expect(code).not.toContain('mindferry:c3');
      expect(chat).toContain('mindferry:c2');
      expect(chat).toContain('mindferry:c3');
      expect(chat).not.toContain('mindferry:c1');
      await close();
    });

    it('keeps the recorded surface when the same sourceId is archived again without one', async () => {
      const { client, close } = await connect();

      await call(client, 'archive_thread', {
        title: 'Session',
        sourceId: 'keep-surface',
        surface: 'code',
        messages: [{ role: 'user', text: 'first ibis turn' }],
      });
      await call(client, 'archive_thread', {
        title: 'Session',
        sourceId: 'keep-surface',
        messages: [
          { role: 'user', text: 'first ibis turn' },
          { role: 'assistant', text: 'second ibis turn' },
        ],
      });

      const found = textOf(await call(client, 'search_context', { query: 'ibis' }));
      expect(found).toContain('surface: code');
      await close();
    });

    it('creates a new thread each time when no sourceId is given', async () => {
      const { client, close } = await connect();

      const first = textOf(
        await call(client, 'archive_thread', {
          title: 'One-off chat',
          messages: [{ role: 'user', text: 'Hello there.' }],
        }),
      );
      const second = textOf(
        await call(client, 'archive_thread', {
          title: 'Another one-off chat',
          messages: [{ role: 'user', text: 'Hello again.' }],
        }),
      );

      expect(first).not.toEqual(second);
      await close();
    });
  });
});
