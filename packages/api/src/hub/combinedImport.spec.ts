import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { HubThreadRecord } from '@librechat/data-schemas';
import type { ImportRefusal } from './combinedImport';
import type { ServerRequest } from '../types/http';
import { createCombinedImportHandler, parseImportTarget } from './combinedImport';

const claudeExport = [
  {
    uuid: 'claude-1',
    name: 'A Claude.ai chat',
    created_at: '2026-09-28T03:44:54Z',
    updated_at: '2026-09-28T03:50:00Z',
    chat_messages: [
      { uuid: 'u1', sender: 'human', text: 'hello', created_at: '2026-09-28T03:44:54Z' },
      { uuid: 'a1', sender: 'assistant', text: 'hi', created_at: '2026-09-28T03:45:00Z' },
    ],
  },
];

const libreChatExport = { conversationId: 'lc-1', messages: [] };

function fakeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

type Res = ReturnType<typeof fakeRes>;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'combined-import-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function upload(payload: unknown): Promise<string> {
  const filepath = path.join(dir, 'upload.json');
  await fs.writeFile(filepath, JSON.stringify(payload));
  return filepath;
}

function makeReq(filepath: string | undefined, target?: string, hub = true) {
  return {
    user: { id: 'user-a', role: 'USER' },
    config: hub ? { contextHub: { enabled: true } } : {},
    file: filepath ? { path: filepath } : undefined,
    body: target === undefined ? {} : { target },
  } as unknown as ServerRequest & { file?: { path: string }; body?: { target?: unknown } };
}

/** The app's chat importer, as the route supplies it: reads the file, deletes it, and rejects formats it cannot read. */
function chatImporter() {
  const seen: unknown[] = [];
  const importChats = jest.fn(async (_req: ServerRequest, filepath: string) => {
    try {
      const data = JSON.parse(await fs.readFile(filepath, 'utf8'));
      if (!Array.isArray(data) && !data.conversationId) {
        throw new Error('Unsupported import type');
      }
      seen.push(data);
    } finally {
      await fs.unlink(filepath).catch(() => undefined);
    }
  });
  return { importChats, seen };
}

function hubStore() {
  const threads: HubThreadRecord[] = [];
  return {
    threads,
    methods: {
      upsertHubThread: jest.fn(async (_userId: string, thread: HubThreadRecord) => {
        threads.push(thread);
      }),
    },
  };
}

describe('parseImportTarget', () => {
  it('reads the three targets and falls back to chats for anything else', () => {
    expect(parseImportTarget('both')).toBe('both');
    expect(parseImportTarget('archive')).toBe('archive');
    expect(parseImportTarget('chats')).toBe('chats');
    expect(parseImportTarget(undefined)).toBe('chats');
    expect(parseImportTarget(['both'])).toBe('chats');
    expect(parseImportTarget('everything')).toBe('chats');
  });
});

describe('createCombinedImportHandler', () => {
  it('imports one file into both the chats and the archive, each from its own copy', async () => {
    const hub = hubStore();
    const chats = chatImporter();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: chats.importChats,
    });
    const res = fakeRes();
    const filepath = await upload(claudeExport);

    await handler(makeReq(filepath, 'both'), res as unknown as Res & import('express').Response);

    expect(chats.seen).toEqual([claudeExport]);
    expect(hub.threads.map((thread) => thread.title)).toEqual(['A Claude.ai chat']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Conversation(s) imported successfully',
      chats: { status: 'imported' },
      archive: { status: 'imported', threadCount: 1 },
    });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('keeps the old chats-only behavior when no target is sent', async () => {
    const hub = hubStore();
    const chats = chatImporter();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: chats.importChats,
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport)), res as never);

    expect(chats.importChats).toHaveBeenCalledTimes(1);
    expect(hub.methods.upsertHubThread).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      message: 'Conversation(s) imported successfully',
      chats: { status: 'imported' },
    });
  });

  it('imports into the archive only, and cleans up the upload', async () => {
    const hub = hubStore();
    const chats = chatImporter();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: chats.importChats,
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport), 'archive'), res as never);

    expect(chats.importChats).not.toHaveBeenCalled();
    expect(hub.threads).toHaveLength(1);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Conversation(s) imported successfully',
      archive: { status: 'imported', threadCount: 1 },
    });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('sends a format only the chat importer reads to the chats, and says the archive skipped it', async () => {
    const hub = hubStore();
    const chats = chatImporter();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: chats.importChats,
    });
    const res = fakeRes();

    await handler(makeReq(await upload(libreChatExport), 'both'), res as never);

    expect(chats.seen).toEqual([libreChatExport]);
    expect(hub.threads).toEqual([]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Conversation(s) imported successfully',
      chats: { status: 'imported' },
      archive: { status: 'unsupported' },
    });
  });

  it('answers 400 when neither side can read the file', async () => {
    const hub = hubStore();
    const chats = chatImporter();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: chats.importChats,
    });
    const res = fakeRes();

    await handler(makeReq(await upload({ unknown: true }), 'both'), res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe('unsupported_export');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("passes an importer's refusal back as it is when nothing was imported", async () => {
    const hub = hubStore();
    const refusal = Object.assign(new Error('blocked'), {
      statusCode: 400,
      body: { error: 'content_filter_block' },
    });
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: jest.fn().mockRejectedValue(refusal),
      isImportRefusal: (error): error is ImportRefusal => error === refusal,
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport)), res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'content_filter_block' });
  });

  it('keeps what the archive imported when the chats side is refused, and reports it', async () => {
    const hub = hubStore();
    const refusal = Object.assign(new Error('blocked'), { statusCode: 400, body: {} });
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: jest.fn().mockRejectedValue(refusal),
      isImportRefusal: (error): error is ImportRefusal => error === refusal,
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport), 'both'), res as never);

    expect(hub.threads).toHaveLength(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Conversation(s) imported successfully',
      chats: { status: 'failed' },
      archive: { status: 'imported', threadCount: 1 },
    });
  });

  it('answers the generic 500 for an unexpected chat import failure', async () => {
    const hub = hubStore();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: jest.fn().mockRejectedValue(new Error('disk on fire')),
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport)), res as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Error processing file');
  });

  it('imports into the chats only when the hub is off, even if both were asked for', async () => {
    const hub = hubStore();
    const chats = chatImporter();
    const handler = createCombinedImportHandler({
      methods: hub.methods,
      importChats: chats.importChats,
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport), 'both', false), res as never);

    expect(chats.importChats).toHaveBeenCalledTimes(1);
    expect(hub.methods.upsertHubThread).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('archive');
  });

  it('refuses an archive-only import when the hub is off, and removes the upload', async () => {
    const handler = createCombinedImportHandler({
      methods: hubStore().methods,
      importChats: jest.fn(),
    });
    const res = fakeRes();

    await handler(makeReq(await upload(claudeExport), 'archive', false), res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('rejects a request with no user or no file', async () => {
    const handler = createCombinedImportHandler({
      methods: hubStore().methods,
      importChats: jest.fn(),
    });

    const anonymous = fakeRes();
    await handler({ ...makeReq(undefined), user: undefined } as never, anonymous as never);
    expect(anonymous.status).toHaveBeenCalledWith(401);

    const empty = fakeRes();
    await handler(makeReq(undefined), empty as never);
    expect(empty.status).toHaveBeenCalledWith(400);
  });
});
