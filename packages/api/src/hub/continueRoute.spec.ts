import type { HubThreadRecord } from '@librechat/data-schemas';
import type { HubContinueImportParams } from './continueRoute';
import type { ServerRequest } from '../types/http';
import { createContextHubContinueHandler } from './continueRoute';
import { ContentFilterError } from '../middleware/contentFilter';

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

type Req = ServerRequest & { params: { id?: string }; body?: Record<string, unknown> };

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'user-a', role: 'USER' },
    config: { contextHub: { enabled: true } },
    params: { id: 'mindferry:sess-1' },
    body: {},
    ...overrides,
  } as unknown as Req;
}

const thread: HubThreadRecord = {
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
      segments: [{ kind: 'text', text: 'The cart total is stale.' }],
      parentId: 'm1',
    },
  ],
};

describe('createContextHubContinueHandler', () => {
  const getHubThread = jest.fn();
  const importConversation = jest.fn();
  const handler = createContextHubContinueHandler({
    methods: { getHubThread },
    importConversation,
  });
  const res = () => fakeRes() as unknown as import('express').Response & ReturnType<typeof fakeRes>;

  beforeEach(() => {
    getHubThread.mockReset().mockResolvedValue(thread);
    importConversation.mockReset().mockResolvedValue({ conversationId: 'new-convo' });
  });

  it('rejects with 404 when the hub is not enabled', async () => {
    const response = res();

    await handler(fakeReq({ config: undefined }), response);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(getHubThread).not.toHaveBeenCalled();
  });

  it('rejects with 401 when no user was resolved', async () => {
    const response = res();

    await handler(fakeReq({ user: undefined }), response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(importConversation).not.toHaveBeenCalled();
  });

  it("reads the thread scoped to the caller's own userId and answers 404 for one that isn't theirs", async () => {
    getHubThread.mockResolvedValue(null);
    const response = res();

    await handler(fakeReq(), response);

    expect(getHubThread).toHaveBeenCalledWith('user-a', 'mindferry:sess-1');
    expect(response.status).toHaveBeenCalledWith(404);
    expect(importConversation).not.toHaveBeenCalled();
  });

  it('hands the converted conversation to the importer as the caller and returns the new id', async () => {
    const response = res();
    const req = fakeReq();

    await handler(req, response);

    const params: HubContinueImportParams = importConversation.mock.calls[0][0];
    expect(params.userId).toBe('user-a');
    expect(params.userRole).toBe('USER');
    expect(params.req).toBe(req);
    expect(params.payload.title).toBe('Fixing the checkout');
    expect(params.payload.messages.map((message) => message.text)).toEqual([
      'why does checkout fail?',
      'The cart total is stale.',
    ]);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ conversationId: 'new-convo', messageCount: 2 });
  });

  it('runs the chat on the endpoint and model the client names', async () => {
    await handler(fakeReq({ body: { endpoint: 'anthropic', model: 'claude-sonnet-4-6' } }), res());

    const { payload } = importConversation.mock.calls[0][0] as HubContinueImportParams;
    expect(payload.endpoint).toBe('anthropic');
    expect(payload.options).toEqual({ model: 'claude-sonnet-4-6' });
  });

  it('ignores an endpoint or model that is not a plain name rather than passing it on', async () => {
    await handler(fakeReq({ body: { endpoint: { $ne: 'x' }, model: 'a'.repeat(500) } }), res());

    const { payload } = importConversation.mock.calls[0][0] as HubContinueImportParams;
    expect(payload).not.toHaveProperty('endpoint');
    expect(payload).not.toHaveProperty('options');
  });

  it('answers 422 without importing when the thread has no text a chat could continue from', async () => {
    getHubThread.mockResolvedValue({
      ...thread,
      messages: [
        { ...thread.messages[0], segments: [{ kind: 'thinking', text: 'only thoughts' }] },
      ],
    });
    const response = res();

    await handler(fakeReq(), response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(importConversation).not.toHaveBeenCalled();
  });

  it('passes a content-filter refusal from the importer back with its own status and body', async () => {
    const refusal = new ContentFilterError({
      source: 'message',
      field: 'text',
    } as ConstructorParameters<typeof ContentFilterError>[0]);
    importConversation.mockRejectedValue(refusal);
    const response = res();

    await handler(fakeReq(), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(refusal.body);
  });

  it('answers 500 without leaking details when the importer fails unexpectedly', async () => {
    importConversation.mockRejectedValue(new Error('mongo exploded: password=hunter2'));
    const response = res();

    await handler(fakeReq(), response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('hunter2');
  });
});
