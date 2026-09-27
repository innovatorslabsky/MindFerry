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
