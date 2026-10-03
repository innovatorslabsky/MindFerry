import type { ServerRequest } from '../types/http';
import {
  createHubListThreadsHandler,
  createHubGetThreadHandler,
  createHubListNotesHandler,
  createHubDeleteNoteHandler,
} from './browseRoute';

function fakeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
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

    expect(listHubThreads).toHaveBeenCalledWith('user-a', 50, undefined);
    expect(searchHubThreads).not.toHaveBeenCalled();
  });

  it('searches instead of listing once a query is given', async () => {
    const req = fakeReq({ query: { q: 'sync', limit: '5' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(searchHubThreads).toHaveBeenCalledWith('user-a', { query: 'sync', limit: 5 });
    expect(listHubThreads).not.toHaveBeenCalled();
  });

  it('narrows the list to one surface when asked', async () => {
    const req = fakeReq({ query: { surface: 'code' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubThreads).toHaveBeenCalledWith('user-a', 50, 'code');
  });

  it('narrows a search to one surface too', async () => {
    const req = fakeReq({ query: { q: 'sync', surface: 'chat' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(searchHubThreads).toHaveBeenCalledWith('user-a', {
      query: 'sync',
      limit: 50,
      surface: 'chat',
    });
  });

  it('ignores a surface it does not know rather than filtering on it', async () => {
    const req = fakeReq({ query: { surface: 'toaster' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubThreads).toHaveBeenCalledWith('user-a', 50, undefined);
  });

  it('clamps an out-of-range limit rather than passing it through', async () => {
    const req = fakeReq({ query: { limit: '99999' } });
    const res = fakeRes();

    await handler(req, res as unknown as import('express').Response);

    expect(listHubThreads).toHaveBeenCalledWith('user-a', 100, undefined);
  });
});

describe('createHubListThreadsHandler with excludeLive', () => {
  const threads = [
    { id: 'mindferry:live-chat', provider: 'mindferry', title: 'Still in Chats' },
    { id: 'mindferry:deleted-chat', provider: 'mindferry', title: 'Chat since deleted' },
    { id: 'claude:c1', provider: 'claude', title: 'From Claude.ai' },
    { id: 'mindferry:session-1', provider: 'mindferry', title: 'Claude Code session' },
  ];
  const listHubThreads = jest.fn().mockResolvedValue(threads);
  const searchHubThreads = jest.fn().mockResolvedValue(threads);
  const findLiveConversationIds = jest.fn(async (_userId: string, ids: string[]) =>
    ids.filter((id) => id === 'live-chat'),
  );
  const handler = createHubListThreadsHandler({
    methods: { listHubThreads, searchHubThreads },
    findLiveConversationIds,
  });

  beforeEach(() => findLiveConversationIds.mockClear());

  it("leaves out the archive copy of a chat that is still in the caller's chat list", async () => {
    const res = fakeRes();

    await handler(fakeReq({ query: { excludeLive: 'true' } }), res as never);

    expect(findLiveConversationIds).toHaveBeenCalledWith('user-a', [
      'live-chat',
      'deleted-chat',
      'session-1',
    ]);
    expect(res.json.mock.calls[0][0].threads.map((t: { title: string }) => t.title)).toEqual([
      'Chat since deleted',
      'From Claude.ai',
      'Claude Code session',
    ]);
  });

  it('applies to a search as well', async () => {
    const res = fakeRes();

    await handler(fakeReq({ query: { q: 'chat', excludeLive: 'true' } }), res as never);

    expect(searchHubThreads).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].threads).toHaveLength(3);
  });

  it('keeps every thread, and asks nothing, without excludeLive', async () => {
    const res = fakeRes();

    await handler(fakeReq(), res as never);

    expect(findLiveConversationIds).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].threads).toHaveLength(4);
  });
});

describe('createHubListThreadsHandler with excludeLive and linked chats', () => {
  const threads = [
    {
      id: 'claude:opened',
      provider: 'claude',
      title: 'Opened as a chat',
      chatConversationIds: ['chat-live'],
    },
    {
      id: 'claude:chat-gone',
      provider: 'claude',
      title: 'Its chat was deleted',
      chatConversationIds: ['chat-deleted'],
    },
    { id: 'claude:older', provider: 'claude', title: 'Opened before links existed' },
    { id: 'mindferry:from-claude-ai', provider: 'mindferry', title: 'Archived by Claude.ai' },
    { id: 'claude:never', provider: 'claude', title: 'Never opened' },
  ];
  const listHubThreads = jest.fn().mockResolvedValue(threads);
  const searchHubThreads = jest.fn();
  const linkHubThreadChats = jest.fn().mockResolvedValue(undefined);
  const findLiveConversationIds = jest.fn(async (_userId: string, ids: string[]) =>
    ids.filter((id) => id === 'chat-live'),
  );
  const findConvosByTitles = jest.fn(async (_userId: string, titles: string[]) =>
    [
      { conversationId: 'chat-older', title: 'Opened before links existed' },
      { conversationId: 'chat-claude-ai', title: 'Archived by Claude.ai' },
    ].filter((chat) => titles.includes(chat.title)),
  );
  const handler = createHubListThreadsHandler({
    methods: { listHubThreads, searchHubThreads, linkHubThreadChats },
    findLiveConversationIds,
    findConvosByTitles,
  });

  beforeEach(() => {
    linkHubThreadChats.mockClear();
    findConvosByTitles.mockClear();
  });

  it('shows each conversation once: a thread whose chat exists is left out until that chat is gone', async () => {
    const res = fakeRes();

    await handler(fakeReq({ query: { excludeLive: 'true' } }), res as never);

    expect(res.json.mock.calls[0][0].threads.map((t: { title: string }) => t.title)).toEqual([
      'Its chat was deleted',
      'Never opened',
    ]);
  });

  it('matches a never-linked thread to a chat of the same title, and records the link', async () => {
    await handler(fakeReq({ query: { excludeLive: 'true' } }), fakeRes() as never);

    expect(findConvosByTitles).toHaveBeenCalledWith('user-a', [
      'Opened before links existed',
      'Archived by Claude.ai',
      'Never opened',
    ]);
    expect(linkHubThreadChats).toHaveBeenCalledWith('user-a', [
      { threadId: 'claude:older', conversationId: 'chat-older' },
      { threadId: 'mindferry:from-claude-ai', conversationId: 'chat-claude-ai' },
    ]);
  });

  it('still lists when recording a title match fails', async () => {
    linkHubThreadChats.mockRejectedValueOnce(new Error('write failed'));
    const res = fakeRes();

    await handler(fakeReq({ query: { excludeLive: 'true' } }), res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].threads).toHaveLength(2);
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

describe('createHubDeleteNoteHandler', () => {
  const notes = new Map([['note-1', 'user-a']]);
  const deleteHubNote = jest.fn(async (userId: string, id: string) => {
    if (notes.get(id) !== userId) {
      return false;
    }
    notes.delete(id);
    return true;
  });
  const handler = createHubDeleteNoteHandler({ methods: { deleteHubNote } });
  const send = (req: ReturnType<typeof fakeReq>) => {
    const res = fakeRes();
    return handler(req, res as unknown as import('express').Response).then(() => res);
  };

  beforeEach(() => {
    notes.set('note-1', 'user-a');
    deleteHubNote.mockClear();
  });

  it("deletes the caller's note and answers 204", async () => {
    const res = await send(fakeReq({ params: { id: 'note-1' } }));

    expect(deleteHubNote).toHaveBeenCalledWith('user-a', 'note-1');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(notes.has('note-1')).toBe(false);
  });

  it("answers 404 for another user's note and leaves it in place", async () => {
    const res = await send(fakeReq({ user: { id: 'user-b' }, params: { id: 'note-1' } }));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(notes.get('note-1')).toBe('user-a');
  });

  it('rejects before deleting when the hub is off, no user was resolved, or no id was given', async () => {
    expect(
      (await send(fakeReq({ config: undefined, params: { id: 'note-1' } }))).status,
    ).toHaveBeenCalledWith(404);
    expect(
      (await send(fakeReq({ user: undefined, params: { id: 'note-1' } }))).status,
    ).toHaveBeenCalledWith(401);
    expect((await send(fakeReq())).status).toHaveBeenCalledWith(400);
    expect(deleteHubNote).not.toHaveBeenCalled();
  });
});
