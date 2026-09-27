import type { ServerRequest } from '../types/http';
import { createContextHubArchiveHandler } from './archiveRoute';

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'user-a' },
    config: { contextHub: { enabled: true } },
    params: { conversationId: 'c1' },
    ...overrides,
  } as unknown as ServerRequest & { params: { conversationId?: string } };
}

describe('createContextHubArchiveHandler', () => {
  const upsertHubThread = jest.fn().mockResolvedValue(undefined);
  const getConvo = jest.fn();
  const getMessages = jest.fn().mockResolvedValue([]);
  const handler = createContextHubArchiveHandler({
    methods: { upsertHubThread },
    getConvo,
    getMessages,
  });

  beforeEach(() => {
    upsertHubThread.mockClear();
    getConvo.mockReset();
    getMessages.mockClear();
    getMessages.mockResolvedValue([]);
  });

  it('rejects with 404 when the hub is not enabled', async () => {
    const req = fakeReq({ config: undefined });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getConvo).not.toHaveBeenCalled();
  });

  it('rejects with 401 when no user was resolved', async () => {
    const req = fakeReq({ user: undefined });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("looks the conversation up scoped to the caller's own userId", async () => {
    getConvo.mockResolvedValue({ conversationId: 'c1', title: 'T' });
    const req = fakeReq();
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(getConvo).toHaveBeenCalledWith('user-a', 'c1');
  });

  it("reports 404 rather than another user's conversation when the lookup finds nothing", async () => {
    getConvo.mockResolvedValue(null);
    const req = fakeReq();
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(upsertHubThread).not.toHaveBeenCalled();
  });

  it('archives the conversation and reports the thread id', async () => {
    getConvo.mockResolvedValue({ conversationId: 'c1', title: 'Designing the hub' });
    getMessages.mockResolvedValue([
      {
        messageId: 'm1',
        parentMessageId: null,
        isCreatedByUser: true,
        createdAt: '2024-01-01T00:00:00Z',
        content: [{ type: 'text', text: 'hi' }],
      },
    ]);
    const req = fakeReq();
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'mindferry:c1', messageCount: 1 }),
    );
    expect(upsertHubThread).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ id: 'mindferry:c1' }),
    );
  });

  it('rejects with 400 when no conversation id was given', async () => {
    const req = fakeReq({ params: {} });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
