import { Constants } from 'librechat-data-provider';
import type { LibreChatArchiveMessage } from './librechat';
import {
  convertHubNoteToChat,
  convertHubThreadToChat,
  convertLibreChatConversation,
} from './librechat';

const conversation = {
  conversationId: 'c1',
  title: 'Designing the hub',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

describe('convertLibreChatConversation', () => {
  it('converts a linear conversation into the canonical shape', () => {
    const messages: LibreChatArchiveMessage[] = [
      {
        messageId: 'm1',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        isCreatedByUser: true,
        createdAt: '2024-01-01T00:00:00Z',
        content: [{ type: 'text', text: 'hello' }],
      },
      {
        messageId: 'm2',
        parentMessageId: 'm1',
        isCreatedByUser: false,
        createdAt: '2024-01-01T00:00:05Z',
        model: 'gpt-4',
        content: [
          { type: 'think', think: 'considering' },
          { type: 'text', text: 'hi back' },
        ],
      },
    ];

    const thread = convertLibreChatConversation(conversation, messages);

    expect(thread.id).toBe('mindferry:c1');
    expect(thread.provider).toBe('mindferry');
    expect(thread.surface).toBe('chat');
    expect(thread.title).toBe('Designing the hub');
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].parentId).toBeNull();
    expect(thread.messages[1].parentId).toBe('m1');
    expect(thread.messages[1].segments).toEqual([
      { kind: 'thinking', text: 'considering' },
      { kind: 'text', text: 'hi back' },
    ]);
    expect(thread.messages[1].model).toBe('gpt-4');
  });

  it('falls back to the flat text field when content is absent', () => {
    const messages: LibreChatArchiveMessage[] = [
      {
        messageId: 'm1',
        parentMessageId: null,
        isCreatedByUser: true,
        createdAt: '2024-01-01T00:00:00Z',
        text: 'legacy plain text',
      },
    ];

    const thread = convertLibreChatConversation(conversation, messages);

    expect(thread.messages[0].segments).toEqual([{ kind: 'text', text: 'legacy plain text' }]);
  });

  it('reads a tool_call segment', () => {
    const messages: LibreChatArchiveMessage[] = [
      {
        messageId: 'm1',
        parentMessageId: null,
        isCreatedByUser: false,
        createdAt: '2024-01-01T00:00:00Z',
        content: [{ type: 'tool_call', tool_call: { name: 'web_search', args: { q: 'hub' } } }],
      },
    ];

    const thread = convertLibreChatConversation(conversation, messages);

    expect(thread.messages[0].segments).toEqual([
      { kind: 'tool', text: '{\n  "q": "hub"\n}', name: 'web_search' },
    ]);
  });

  it('compacts a message left with no segments, rewiring its children', () => {
    const messages: LibreChatArchiveMessage[] = [
      {
        messageId: 'root',
        parentMessageId: null,
        isCreatedByUser: true,
        createdAt: '2024-01-01T00:00:00Z',
        content: [{ type: 'text', text: 'kept' }],
      },
      {
        messageId: 'empty',
        parentMessageId: 'root',
        isCreatedByUser: false,
        createdAt: '2024-01-01T00:00:01Z',
        content: [],
      },
      {
        messageId: 'leaf',
        parentMessageId: 'empty',
        isCreatedByUser: true,
        createdAt: '2024-01-01T00:00:02Z',
        content: [{ type: 'text', text: 'also kept' }],
      },
    ];

    const thread = convertLibreChatConversation(conversation, messages);

    expect(thread.messages.map((m) => m.id)).toEqual(['root', 'leaf']);
    expect(thread.messages[1].parentId).toBe('root');
  });

  it('names an untitled conversation rather than leaving it blank', () => {
    const thread = convertLibreChatConversation({ conversationId: 'c2' }, []);

    expect(thread.title).toBe('Untitled conversation');
  });
});

describe('convertHubThreadToChat', () => {
  const record = (
    overrides: Partial<import('@librechat/data-schemas').HubThreadRecord> = {},
  ): import('@librechat/data-schemas').HubThreadRecord => ({
    id: 'mindferry:sess-1',
    provider: 'mindferry',
    sourceId: 'sess-1',
    title: 'Fixing the checkout',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        segments: [{ kind: 'text', text: 'why does checkout fail?' }],
        parentId: null,
      },
      {
        id: 'm2',
        role: 'assistant',
        createdAt: new Date('2026-01-01T00:00:05Z'),
        segments: [{ kind: 'text', text: 'The cart total is stale.' }],
        parentId: 'm1',
      },
    ],
    ...overrides,
  });

  it('turns a linear thread into a rooted chain of user and assistant messages', () => {
    const chat = convertHubThreadToChat(record());

    expect(chat.title).toBe('Fixing the checkout');
    expect(chat.messages).toEqual([
      {
        messageId: 'm1',
        parentMessageId: Constants.NO_PARENT,
        text: 'why does checkout fail?',
        sender: 'User',
        isCreatedByUser: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        messageId: 'm2',
        parentMessageId: 'm1',
        text: 'The cart total is stale.',
        sender: 'Assistant',
        isCreatedByUser: false,
        createdAt: '2026-01-01T00:00:05.000Z',
      },
    ]);
  });

  it('labels the assistant by the provider the thread came from', () => {
    const chat = convertHubThreadToChat(record({ provider: 'claude' }));

    expect(chat.messages[1].sender).toBe('Claude');
  });

  it('carries the chosen endpoint and model onto the conversation and its assistant messages only', () => {
    const chat = convertHubThreadToChat(record(), {
      endpoint: 'anthropic',
      model: 'claude-sonnet-4-6',
    });

    expect(chat.endpoint).toBe('anthropic');
    expect(chat.options).toEqual({ model: 'claude-sonnet-4-6' });
    expect(chat.messages[0]).not.toHaveProperty('model');
    expect(chat.messages[1]).toMatchObject({ endpoint: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('leaves the endpoint and model to the deployment when none is chosen', () => {
    const chat = convertHubThreadToChat(record());

    expect(chat).not.toHaveProperty('endpoint');
    expect(chat).not.toHaveProperty('options');
  });

  it('keeps code as a fenced block and leaves reasoning, tool calls and system messages behind', () => {
    const chat = convertHubThreadToChat(
      record({
        messages: [
          {
            id: 'm0',
            role: 'system',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            segments: [{ kind: 'text', text: 'hidden system prompt' }],
            parentId: null,
          },
          {
            id: 'm1',
            role: 'user',
            createdAt: new Date('2026-01-01T00:00:01Z'),
            segments: [{ kind: 'text', text: 'show me' }],
            parentId: 'm0',
          },
          {
            id: 'm2',
            role: 'assistant',
            createdAt: new Date('2026-01-01T00:00:02Z'),
            segments: [
              { kind: 'thinking', text: 'private reasoning' },
              { kind: 'text', text: 'Here:' },
              { kind: 'tool', text: '{"a":1}', name: 'Bash' },
              { kind: 'code', text: 'npm test', language: 'bash' },
            ],
            parentId: 'm1',
          },
        ],
      }),
    );

    expect(chat.messages.map((message) => message.text)).toEqual([
      'show me',
      'Here:\n\n```bash\nnpm test\n```',
    ]);
    expect(JSON.stringify(chat)).not.toMatch(/hidden system prompt|private reasoning|Bash/);
    expect(chat.messages[0].parentMessageId).toBe(Constants.NO_PARENT);
  });

  it('re-parents the replies of a message that had nothing a chat can show', () => {
    const chat = convertHubThreadToChat(
      record({
        messages: [
          {
            id: 'm1',
            role: 'user',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            segments: [{ kind: 'text', text: 'question' }],
            parentId: null,
          },
          {
            id: 'm2',
            role: 'assistant',
            createdAt: new Date('2026-01-01T00:00:01Z'),
            segments: [{ kind: 'tool', text: '{}', name: 'Bash' }],
            parentId: 'm1',
          },
          {
            id: 'm3',
            role: 'assistant',
            createdAt: new Date('2026-01-01T00:00:02Z'),
            segments: [{ kind: 'text', text: 'answer' }],
            parentId: 'm2',
          },
        ],
      }),
    );

    expect(chat.messages.map((message) => [message.messageId, message.parentMessageId])).toEqual([
      ['m1', Constants.NO_PARENT],
      ['m3', 'm1'],
    ]);
  });

  it('preserves branching from an exported tree', () => {
    const chat = convertHubThreadToChat(
      record({
        messages: [
          {
            id: 'a',
            role: 'user',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            segments: [{ kind: 'text', text: 'root' }],
            parentId: null,
          },
          {
            id: 'b1',
            role: 'assistant',
            createdAt: new Date('2026-01-01T00:00:01Z'),
            segments: [{ kind: 'text', text: 'first try' }],
            parentId: 'a',
          },
          {
            id: 'b2',
            role: 'assistant',
            createdAt: new Date('2026-01-01T00:00:02Z'),
            segments: [{ kind: 'text', text: 'regenerated' }],
            parentId: 'a',
          },
        ],
      }),
    );

    expect(chat.messages.map((message) => message.parentMessageId)).toEqual([
      Constants.NO_PARENT,
      'a',
      'a',
    ]);
  });

  it('returns no messages for a thread with nothing to show', () => {
    const chat = convertHubThreadToChat(
      record({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            segments: [{ kind: 'thinking', text: 'only thoughts' }],
            parentId: null,
          },
        ],
      }),
    );

    expect(chat.messages).toEqual([]);
  });
});

describe('convertHubNoteToChat', () => {
  const note = {
    id: 'n1',
    title: '  Plugin handoff ',
    text: 'Update the plugin.\n\n- then end a session',
    createdAt: new Date('2026-09-30T18:55:49Z'),
  };

  it('opens as one assistant message that carries the note, with no parent', () => {
    const chat = convertHubNoteToChat(note);

    expect(chat.title).toBe('Plugin handoff');
    expect(chat.conversationId).toBe('note:n1');
    expect(chat.messages).toEqual([
      {
        messageId: 'note-n1',
        parentMessageId: Constants.NO_PARENT,
        text: '**Plugin handoff**\n\nUpdate the plugin.\n\n- then end a session',
        sender: 'MindFerry',
        isCreatedByUser: false,
        createdAt: '2026-09-30T18:55:49.000Z',
      },
    ]);
    expect(chat).not.toHaveProperty('endpoint');
    expect(chat).not.toHaveProperty('options');
  });

  it('runs on the target endpoint and model when one is given', () => {
    const chat = convertHubNoteToChat(note, { endpoint: 'anthropic', model: 'claude-sonnet-4-6' });

    expect(chat.endpoint).toBe('anthropic');
    expect(chat.options).toEqual({ model: 'claude-sonnet-4-6' });
    expect(chat.messages[0]).toMatchObject({ endpoint: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('leaves the heading out for an untitled note, and has no messages for an empty one', () => {
    expect(convertHubNoteToChat({ ...note, title: ' ' }).messages[0].text).toBe(
      'Update the plugin.\n\n- then end a session',
    );
    expect(convertHubNoteToChat({ ...note, title: ' ' }).title).toBe('MindFerry note');
    expect(convertHubNoteToChat({ ...note, text: '\n ' }).messages).toEqual([]);
  });
});
