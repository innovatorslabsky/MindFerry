import type { HubThreadRecord } from '@librechat/data-schemas';
import type { HubContinueImportParams } from '../continueRoute';
import type { ServerRequest } from '../../types/http';
import { ConversationImportError } from '../../conversations/import';
import { createHubOpenInChat } from './chat';

const thread: HubThreadRecord = {
  id: 'mindferry:sess-1',
  provider: 'mindferry',
  surface: 'chat',
  sourceId: 'sess-1',
  title: 'Planning the launch',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  messages: [
    {
      id: 'm1',
      role: 'user',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      segments: [{ kind: 'text', text: 'when do we launch?' }],
      parentId: null,
    },
    {
      id: 'm2',
      role: 'assistant',
      createdAt: new Date('2026-01-01T00:00:05Z'),
      segments: [{ kind: 'text', text: 'Next Monday.' }],
      parentId: 'm1',
    },
  ],
};

const req = {
  user: { id: 'user-a', role: 'USER' },
  config: { contextHub: { enabled: true } },
} as unknown as ServerRequest & { user: { id: string; role?: string } };

function archive(records: HubThreadRecord[]) {
  return jest.fn(async (userId: string, id: string) =>
    userId === 'user-a' ? (records.find((record) => record.id === id) ?? null) : null,
  );
}

describe('createHubOpenInChat', () => {
  it("imports the caller's thread as a chat and links to it", async () => {
    const imported: HubContinueImportParams[] = [];
    const getHubThread = archive([thread]);
    const openInChat = createHubOpenInChat(
      {
        methods: { getHubThread },
        importConversation: async (params) => {
          imported.push(params);
          return { conversationId: 'convo-1' };
        },
        clientOrigin: 'https://mindferry.example.com',
      },
      req,
    );

    const result = await openInChat('mindferry:sess-1');

    expect(result).toEqual({
      status: 'opened',
      conversationId: 'convo-1',
      messageCount: 2,
      url: 'https://mindferry.example.com/c/convo-1',
    });
    expect(getHubThread).toHaveBeenCalledWith('user-a', 'mindferry:sess-1');
    expect(imported).toHaveLength(1);
    expect(imported[0].userId).toBe('user-a');
    expect(imported[0].userRole).toBe('USER');
    expect(imported[0].req).toBe(req);
    expect(imported[0].payload.title).toBe('Planning the launch');
    expect(imported[0].payload.messages.map((message) => message.text)).toEqual([
      'when do we launch?',
      'Next Monday.',
    ]);
  });

  it('leaves the link out when no origin is configured', async () => {
    const openInChat = createHubOpenInChat(
      {
        methods: { getHubThread: archive([thread]) },
        importConversation: async () => ({ conversationId: 'convo-1' }),
      },
      req,
    );

    expect(await openInChat('mindferry:sess-1')).toEqual({
      status: 'opened',
      conversationId: 'convo-1',
      messageCount: 2,
      url: undefined,
    });
  });

  it('reports a thread the caller does not have, without importing', async () => {
    const importConversation = jest.fn();
    const openInChat = createHubOpenInChat(
      { methods: { getHubThread: archive([thread]) }, importConversation },
      req,
    );

    expect(await openInChat('mindferry:other')).toEqual({ status: 'not_found' });
    expect(importConversation).not.toHaveBeenCalled();
  });

  it('reports a thread with nothing a chat could hold', async () => {
    const importConversation = jest.fn();
    const silent: HubThreadRecord = {
      ...thread,
      messages: [{ ...thread.messages[0], role: 'system' }],
    };
    const openInChat = createHubOpenInChat(
      { methods: { getHubThread: archive([silent]) }, importConversation },
      req,
    );

    expect(await openInChat('mindferry:sess-1')).toEqual({ status: 'empty' });
    expect(importConversation).not.toHaveBeenCalled();
  });

  it("reports the importer's refusal with its message", async () => {
    const openInChat = createHubOpenInChat(
      {
        methods: { getHubThread: archive([thread]) },
        importConversation: async () => {
          throw new ConversationImportError('Conversation is too large to import', 413);
        },
      },
      req,
    );

    expect(await openInChat('mindferry:sess-1')).toEqual({
      status: 'refused',
      message: 'Conversation is too large to import',
    });
  });

  it('lets an unexpected failure propagate', async () => {
    const openInChat = createHubOpenInChat(
      {
        methods: { getHubThread: archive([thread]) },
        importConversation: async () => {
          throw new Error('database down');
        },
      },
      req,
    );

    await expect(openInChat('mindferry:sess-1')).rejects.toThrow('database down');
  });
});
