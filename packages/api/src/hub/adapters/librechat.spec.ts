import type { LibreChatArchiveMessage } from './librechat';
import { convertLibreChatConversation } from './librechat';

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
