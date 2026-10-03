import { chatGptExportThreadId, createChatGptSource } from './chatgpt';

/**
 * Shaped after a real ChatGPT account export: a client-side root node with no
 * message, a blank system turn, and a branch where one prompt was answered
 * twice because the answer was regenerated.
 */
const chatGptExport = [
  {
    title: 'Assist user with summary',
    create_time: 1714585031.148505,
    update_time: 1714585060.879308,
    conversation_id: 'conv-1',
    default_model_slug: 'gpt-4',
    mapping: {
      root: { id: 'root', parent: null, message: null },
      sys: {
        id: 'sys',
        parent: 'root',
        message: {
          author: { role: 'system', name: null },
          create_time: null,
          content: { content_type: 'text', parts: [''] },
        },
      },
      ask: {
        id: 'ask',
        parent: 'sys',
        message: {
          author: { role: 'user' },
          create_time: 1714585031.2,
          content: { content_type: 'text', parts: ['Summarize this'] },
        },
      },
      first: {
        id: 'first',
        parent: 'ask',
        message: {
          author: { role: 'assistant' },
          create_time: 1714585040,
          content: { content_type: 'text', parts: ['First answer'] },
          metadata: { model_slug: 'gpt-4' },
        },
      },
      regenerated: {
        id: 'regenerated',
        parent: 'ask',
        message: {
          author: { role: 'assistant' },
          create_time: 1714585050,
          content: { content_type: 'text', parts: ['Second answer'] },
          metadata: { model_slug: 'gpt-4o' },
        },
      },
    },
  },
];

describe('createChatGptSource', () => {
  const source = createChatGptSource();

  it('recognizes an export by its mapping tree', () => {
    expect(source.detect(chatGptExport)).toBe(true);
    expect(source.detect([{ chat_messages: [] }])).toBe(false);
    expect(source.detect({ version: 4, history: [] })).toBe(false);
  });

  it('normalizes a conversation into a canonical thread', () => {
    const [thread] = source.parse(chatGptExport);

    expect(thread.id).toBe('chatgpt:conv-1');
    expect(thread.title).toBe('Assist user with summary');
    expect(thread.createdAt.toISOString()).toBe('2024-05-01T17:37:11.148Z');
  });

  it('drops the empty root and system nodes, rewiring the prompt to the top', () => {
    const [thread] = source.parse(chatGptExport);

    expect(thread.messages.map((m) => m.id)).toEqual(['ask', 'first', 'regenerated']);
    expect(thread.messages[0].parentId).toBeNull();
  });

  it('keeps a regenerated answer as a sibling branch rather than flattening it', () => {
    const [thread] = source.parse(chatGptExport);

    expect(thread.messages[1].parentId).toBe('ask');
    expect(thread.messages[2].parentId).toBe('ask');
    expect(thread.messages[1].model).toBe('gpt-4');
    expect(thread.messages[2].model).toBe('gpt-4o');
  });

  it('reads reasoning out of a thoughts node', () => {
    const [thread] = source.parse([
      {
        title: 'Reasoned',
        conversation_id: 'c',
        mapping: {
          t: {
            id: 't',
            parent: null,
            message: {
              author: { role: 'assistant' },
              content: {
                content_type: 'thoughts',
                thoughts: [{ summary: 'Weighing options' }, { content: 'Picked one' }],
              },
            },
          },
        },
      },
    ]);

    expect(thread.messages[0].segments).toEqual([
      { kind: 'thinking', text: 'Weighing options\n\nPicked one' },
    ]);
  });

  it('reads a code node as a code segment with its language', () => {
    const [thread] = source.parse([
      {
        title: 'Code',
        conversation_id: 'c',
        mapping: {
          k: {
            id: 'k',
            parent: null,
            message: {
              author: { role: 'assistant' },
              content: { content_type: 'code', language: 'python', text: 'print(1)' },
            },
          },
        },
      },
    ]);

    expect(thread.messages[0].segments).toEqual([
      { kind: 'code', text: 'print(1)', language: 'python' },
    ]);
  });

  it('reads a browsing node as a tool segment named after its author', () => {
    const [thread] = source.parse([
      {
        title: 'Browsed',
        conversation_id: 'c',
        mapping: {
          b: {
            id: 'b',
            parent: null,
            message: {
              author: { role: 'tool', name: 'browser' },
              content: { content_type: 'tether_quote', text: 'quoted page' },
            },
          },
        },
      },
    ]);

    expect(thread.messages[0].role).toBe('assistant');
    expect(thread.messages[0].segments).toEqual([
      { kind: 'tool', text: 'quoted page', name: 'browser' },
    ]);
  });

  it('turns webpage citation markers into Markdown links', () => {
    const [thread] = source.parse([
      {
        title: 'Cited',
        conversation_id: 'c',
        mapping: {
          a: {
            id: 'a',
            parent: null,
            message: {
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['See hereX for more'] },
              metadata: {
                citations: [
                  {
                    start_ix: 8,
                    end_ix: 9,
                    metadata: { type: 'webpage', title: 'Docs', url: 'https://example.com' },
                  },
                ],
              },
            },
          },
        },
      },
    ]);

    expect(thread.messages[0].segments[0].text).toBe(
      'See here ([Docs](https://example.com)) for more',
    );
  });

  it('falls back to a positional id when the export omits the conversation id', () => {
    const [thread] = source.parse([{ title: 'No id', mapping: {} }]);

    expect(thread.id).toBe('chatgpt:index-0');
  });
});

describe('chatGptExportThreadId', () => {
  it('names the same thread the ChatGPT adapter archives each conversation under', () => {
    const exported = [
      { title: 'One', conversation_id: 'g-1', mapping: {} },
      { title: 'Two', id: 'g-2', mapping: {} },
      { title: 'Three', mapping: {} },
    ];

    const archived = createChatGptSource()
      .parse(exported)
      .map((thread) => thread.id);

    expect(
      exported.map((conversation, index) => chatGptExportThreadId(conversation, index)),
    ).toEqual(archived);
    expect(archived).toEqual(['chatgpt:g-1', 'chatgpt:g-2', 'chatgpt:index-2']);
  });
});
