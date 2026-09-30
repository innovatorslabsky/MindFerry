const { EModelEndpoint, Constants } = require('librechat-data-provider');
const { convertHubThreadToChat, convertHubNoteToChat } = require('@librechat/api');
const { importHubConversation } = require('./hub');
const { bulkSaveMessages, bulkSaveConvos } = require('~/models');

const mockGetEndpointsConfig = jest.fn();
const mockGetModelsConfig = jest.fn();

jest.mock('~/server/services/Config', () => ({
  getEndpointsConfig: (...args) => mockGetEndpointsConfig(...args),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: (...args) => mockGetModelsConfig(...args),
}));

jest.mock('~/models', () => ({
  bulkSaveConvos: jest.fn(),
  bulkSaveMessages: jest.fn(),
  bulkIncrementTagCounts: jest.fn(),
  getFiles: jest.fn(),
}));

const thread = {
  id: 'mindferry:sess-1',
  provider: 'mindferry',
  surface: 'code',
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
      segments: [
        { kind: 'thinking', text: 'private' },
        { kind: 'text', text: 'The cart total is stale.' },
      ],
      parentId: 'm1',
    },
    {
      id: 'm3',
      role: 'user',
      createdAt: new Date('2026-01-01T00:00:10Z'),
      segments: [{ kind: 'text', text: 'fix it' }],
      parentId: 'm2',
    },
  ],
};

const req = { config: {} };

const runImport = (target) =>
  importHubConversation({
    userId: 'user-1',
    userRole: 'USER',
    payload: convertHubThreadToChat(thread, target),
    req,
  });

describe('importHubConversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEndpointsConfig.mockResolvedValue({
      [EModelEndpoint.anthropic]: { userProvide: false },
      [EModelEndpoint.openAI]: { userProvide: false },
    });
    mockGetModelsConfig.mockResolvedValue({
      [EModelEndpoint.anthropic]: ['claude-sonnet-4-6'],
    });
  });

  it('saves the thread as a new conversation the user owns and returns its id', async () => {
    const { conversationId } = await runImport({
      endpoint: EModelEndpoint.anthropic,
      model: 'claude-sonnet-4-6',
    });

    const [[conversations]] = bulkSaveConvos.mock.calls;
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      conversationId,
      user: 'user-1',
      title: 'Fixing the checkout',
      endpoint: EModelEndpoint.anthropic,
      model: 'claude-sonnet-4-6',
    });
    expect(conversationId).not.toBe(thread.id);
  });

  it('saves the messages as one chain, in order, with fresh ids and the right authors', async () => {
    const { conversationId } = await runImport({
      endpoint: EModelEndpoint.anthropic,
      model: 'claude-sonnet-4-6',
    });

    const [[messages]] = bulkSaveMessages.mock.calls;
    expect(messages.map((message) => message.text)).toEqual([
      'why does checkout fail?',
      'The cart total is stale.',
      'fix it',
    ]);
    expect(messages.map((message) => message.isCreatedByUser)).toEqual([true, false, true]);
    expect(messages.every((message) => message.conversationId === conversationId)).toBe(true);
    expect(messages.every((message) => message.user === 'user-1')).toBe(true);
    expect(messages[0].parentMessageId).toBe(Constants.NO_PARENT);
    expect(messages[1].parentMessageId).toBe(messages[0].messageId);
    expect(messages[2].parentMessageId).toBe(messages[1].messageId);
    expect(new Set(messages.map((message) => message.messageId)).size).toBe(3);
    expect(messages.some((message) => message.messageId === 'm1')).toBe(false);
    expect(JSON.stringify(messages)).not.toContain('private');
  });

  it('saves a note as a new conversation that opens on the note, ready for a reply', async () => {
    const note = {
      id: '6abd5b35268e36677724bf4f',
      title: 'Plugin handoff',
      text: 'Next step: update the plugin.',
      createdAt: new Date('2026-09-30T18:55:49Z'),
    };

    const { conversationId } = await importHubConversation({
      userId: 'user-1',
      userRole: 'USER',
      payload: convertHubNoteToChat(note, {
        endpoint: EModelEndpoint.anthropic,
        model: 'claude-sonnet-4-6',
      }),
      req,
    });

    const [[conversations]] = bulkSaveConvos.mock.calls;
    const [[messages]] = bulkSaveMessages.mock.calls;
    expect(conversations[0]).toMatchObject({
      conversationId,
      user: 'user-1',
      title: 'Plugin handoff',
      endpoint: EModelEndpoint.anthropic,
      model: 'claude-sonnet-4-6',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      conversationId,
      isCreatedByUser: false,
      parentMessageId: Constants.NO_PARENT,
      text: '**Plugin handoff**\n\nNext step: update the plugin.',
    });
    expect(messages[0].messageId).not.toBe('note-6abd5b35268e36677724bf4f');
  });

  it('makes a new conversation each time, leaving earlier ones alone', async () => {
    const first = await runImport({ endpoint: EModelEndpoint.anthropic });
    const second = await runImport({ endpoint: EModelEndpoint.anthropic });

    expect(first.conversationId).not.toBe(second.conversationId);
    expect(bulkSaveConvos).toHaveBeenCalledTimes(2);
  });

  it('falls back to a configured endpoint and its default model when none is named', async () => {
    mockGetEndpointsConfig.mockResolvedValue({ [EModelEndpoint.anthropic]: {} });

    await runImport();

    const [[conversations]] = bulkSaveConvos.mock.calls;
    expect(conversations[0].endpoint).toBe(EModelEndpoint.anthropic);
    expect(conversations[0].model).toBe('claude-sonnet-4-6');
  });

  it('uses a configured endpoint when the one asked for is not available', async () => {
    mockGetEndpointsConfig.mockResolvedValue({ [EModelEndpoint.anthropic]: {} });

    await runImport({ endpoint: 'gone-endpoint' });

    const [[conversations]] = bulkSaveConvos.mock.calls;
    expect(conversations[0].endpoint).toBe(EModelEndpoint.anthropic);
  });

  it('applies the deployment content filter, refusing a thread it blocks and saving nothing', async () => {
    const filters = {
      messages: {
        pii: {
          fields: ['text'],
          starterPatterns: [],
          customPatterns: [{ id: 'checkout', label: 'restricted value', regex: 'checkout' }],
        },
      },
    };
    const attempt = importHubConversation({
      userId: 'user-1',
      userRole: 'USER',
      payload: convertHubThreadToChat(thread, { endpoint: EModelEndpoint.anthropic }),
      req: { config: { filters } },
    });

    await expect(attempt).rejects.toBeDefined();
    expect(bulkSaveMessages).not.toHaveBeenCalled();
    expect(bulkSaveConvos).not.toHaveBeenCalled();
  });
});
