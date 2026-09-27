import type { ServerRequest } from '../types/http';
import {
  createHubListThreadsHandler,
  createHubGetThreadHandler,
  createHubListNotesHandler,
} from './browseRoute';

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
    query: {},
    params: {},
    ...overrides,
  } as unknown as ServerRequest & { params: { id?: string } };
}

describe('createHubListThreadsHandler', () => {
  const listHubThreads = jest.fn().mockResolvedValue([]);
  const searchHubThreads = jest.fn().mockResolvedValue([]);
  const handler = createHubListThreadsHandler({ methods: { listHubThreads, searchHubThreads } });

  beforeEach(() => {
    listHubThreads.mockClear();
    searchHubThreads.mockClear();
  });

  it('rejects with 404 when the hub is not enabled', async () => {
    const req = fakeReq({ config: undefined });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(listHubThreads).not.toHaveBeenCalled();
  });

  it('rejects with 401 when no user was resolved', async () => {
    const req = fakeReq({ user: undefined });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lists recent threads scoped to the caller when no search term is given', async () => {
    const req = fakeReq();
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubThreads).toHaveBeenCalledWith('user-a', 50);
    expect(searchHubThreads).not.toHaveBeenCalled();
  });

  it('searches instead of listing once a query is given', async () => {
    const req = fakeReq({ query: { q: 'sync', limit: '5' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(searchHubThreads).toHaveBeenCalledWith('user-a', { query: 'sync', limit: 5 });
    expect(listHubThreads).not.toHaveBeenCalled();
  });

  it('clamps an out-of-range limit rather than passing it through', async () => {
    const req = fakeReq({ query: { limit: '99999' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubThreads).toHaveBeenCalledWith('user-a', 100);
  });
});

describe('createHubGetThreadHandler', () => {
  const getHubThread = jest.fn();
  const handler = createHubGetThreadHandler({ methods: { getHubThread } });

  beforeEach(() => {
    getHubThread.mockReset();
  });

  it('rejects with 404 when the hub is not enabled', async () => {
    const req = fakeReq({ config: undefined, params: { id: 'claude:c1' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getHubThread).not.toHaveBeenCalled();
  });

  it("looks the thread up scoped to the caller's own userId", async () => {
    getHubThread.mockResolvedValue({ id: 'claude:c1', messages: [] });
    const req = fakeReq({ params: { id: 'claude:c1' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(getHubThread).toHaveBeenCalledWith('user-a', 'claude:c1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reports 404 when no thread has that id', async () => {
    getHubThread.mockResolvedValue(null);
    const req = fakeReq({ params: { id: 'claude:missing' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('createHubListNotesHandler', () => {
  const listHubNotes = jest.fn().mockResolvedValue([]);
  const handler = createHubListNotesHandler({ methods: { listHubNotes } });

  beforeEach(() => {
    listHubNotes.mockClear();
  });

  it('rejects with 404 when the hub is not enabled', async () => {
    const req = fakeReq({ config: undefined });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(listHubNotes).not.toHaveBeenCalled();
  });

  it('lists every note scoped to the caller when no threadId is given', async () => {
    const req = fakeReq();
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubNotes).toHaveBeenCalledWith('user-a', undefined);
  });

  it('restricts to one thread when threadId is given', async () => {
    const req = fakeReq({ query: { threadId: 'claude:c1' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubNotes).toHaveBeenCalledWith('user-a', 'claude:c1');
  });
});
