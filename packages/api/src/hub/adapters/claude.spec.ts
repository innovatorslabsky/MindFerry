import { claudeExportThreadId, createClaudeSource } from './claude';
import { parseExport, UnknownExportError } from '../source';
import { createDefaultChatSources } from './index';
import { createChatGptSource } from './chatgpt';

/** Shaped after a real Claude account export (`conversations.json`). */
const claudeExport = [
  {
    uuid: 'conv-1',
    name: 'Planning the hub',
    created_at: '2024-01-07T10:00:00.000Z',
    updated_at: '2024-01-08T11:00:00.000Z',
    chat_messages: [
      {
        uuid: 'msg-1',
        sender: 'human',
        created_at: '2024-01-07T10:00:00.000Z',
        text: 'How should I sync my chats?',
        content: [{ type: 'text', text: 'How should I sync my chats?' }],
      },
      {
        uuid: 'msg-2',
        sender: 'assistant',
        created_at: '2024-01-07T10:00:05.000Z',
        text: '',
        content: [
          { type: 'thinking', thinking: 'They want a hub, not live sync.' },
          { type: 'text', text: 'Export, then normalize.' },
        ],
      },
    ],
  },
];

describe('createClaudeSource', () => {
  const source = createClaudeSource();

  it('recognizes an export by its chat_messages list', () => {
    expect(source.detect(claudeExport)).toBe(true);
    expect(source.detect([{ mapping: {} }])).toBe(false);
    expect(source.detect([])).toBe(false);
    expect(source.detect({ conversationId: 'x' })).toBe(false);
  });

  it('normalizes a conversation into a canonical thread', () => {
    const [thread] = source.parse(claudeExport);

    expect(thread.id).toBe('claude:conv-1');
    expect(thread.provider).toBe('claude');
    expect(thread.title).toBe('Planning the hub');
    expect(thread.createdAt.toISOString()).toBe('2024-01-07T10:00:00.000Z');
    expect(thread.updatedAt.toISOString()).toBe('2024-01-08T11:00:00.000Z');
    expect(thread.messages).toHaveLength(2);
  });

  it('links each message to its predecessor so the list becomes a tree', () => {
    const [thread] = source.parse(claudeExport);

    expect(thread.messages[0].parentId).toBeNull();
    expect(thread.messages[1].parentId).toBe('msg-1');
  });

  it('keeps thinking as its own segment ahead of the answer', () => {
    const [thread] = source.parse(claudeExport);

    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.messages[1].segments).toEqual([
      { kind: 'thinking', text: 'They want a hub, not live sync.' },
      { kind: 'text', text: 'Export, then normalize.' },
    ]);
  });

  it('falls back to the flat text field when the content array carries no text', () => {
    const [thread] = source.parse([
      {
        uuid: 'conv-2',
        name: 'Legacy',
        chat_messages: [{ uuid: 'm', sender: 'human', text: 'only here', content: [] }],
      },
    ]);

    expect(thread.messages[0].segments).toEqual([{ kind: 'text', text: 'only here' }]);
  });

  it('records a tool call as a tool segment', () => {
    const [thread] = source.parse([
      {
        uuid: 'conv-3',
        name: 'Tools',
        chat_messages: [
          {
            uuid: 'm',
            sender: 'assistant',
            content: [{ type: 'tool_use', name: 'web_search', input: { query: 'hub' } }],
          },
        ],
      },
    ]);

    expect(thread.messages[0].segments[0]).toEqual({
      kind: 'tool',
      text: '{\n  "query": "hub"\n}',
      name: 'web_search',
    });
  });

  it('drops a message that carries no content at all', () => {
    const [thread] = source.parse([
      {
        uuid: 'conv-4',
        name: 'Sparse',
        chat_messages: [
          { uuid: 'a', sender: 'human', text: 'kept', content: [] },
          { uuid: 'b', sender: 'assistant', text: '', content: [] },
          { uuid: 'c', sender: 'human', text: 'also kept', content: [] },
        ],
      },
    ]);

    expect(thread.messages.map((m) => m.id)).toEqual(['a', 'c']);
    expect(thread.messages[1].parentId).toBe('a');
  });

  it('names an untitled conversation rather than leaving it blank', () => {
    const [thread] = source.parse([{ uuid: 'c', chat_messages: [] }]);

    expect(thread.title).toBe('Untitled Claude conversation');
  });
});

describe('parseExport', () => {
  it('routes an export to the adapter that recognizes it', () => {
    const threads = parseExport(createDefaultChatSources(), claudeExport);

    expect(threads[0].provider).toBe('claude');
  });

  it('lets the ChatGPT adapter claim an empty array only after Claude declines', () => {
    const threads = parseExport(createDefaultChatSources(), []);

    expect(threads).toEqual([]);
    expect(createChatGptSource().detect([])).toBe(true);
  });

  it('throws when no adapter recognizes the payload', () => {
    expect(() => parseExport(createDefaultChatSources(), { version: 4 })).toThrow(
      UnknownExportError,
    );
  });
});

describe('claudeExportThreadId', () => {
  it('names the same thread the Claude.ai adapter archives each conversation under', () => {
    const exported = [
      { uuid: 'c-1', name: 'One', chat_messages: [] },
      { name: 'No uuid', chat_messages: [] },
    ];

    const archived = createClaudeSource()
      .parse(exported)
      .map((thread) => thread.id);

    expect(
      exported.map((conversation, index) => claudeExportThreadId(conversation, index)),
    ).toEqual(archived);
    expect(archived).toEqual(['claude:c-1', 'claude:index-1']);
  });
});
