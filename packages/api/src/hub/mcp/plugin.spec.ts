import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { HubStore } from './store';
import { createHubMemoryStore } from './memory';
import { handleHubMcpRequest } from './http';

/**
 * Runs the Claude Code plugin's real SessionEnd hook script as a child
 * process, exactly as Claude Code would, against the hub's real MCP server
 * over HTTP — only the store behind it is in memory. What this proves is the
 * seam between the two: a hook payload and a transcript go in, and what comes
 * out is a thread and note the hub's own tools and browse queries can read.
 */

const SCRIPT = path.resolve(
  __dirname,
  '../../../../../claude-plugin/mindferry/scripts/session-end.mjs',
);

async function startHub(store: HubStore) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw.length > 0 ? JSON.parse(raw) : undefined;
      void handleHubMcpRequest({ req, res, body, options: { store } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function runHook(params: { url: string; payload: Record<string, unknown> }) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_OPTION_HUB_URL: params.url,
        CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
      },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(params.payload));
  });
}

const human = (content: string) => ({
  type: 'user',
  origin: { kind: 'human' },
  message: { role: 'user', content },
});
const reply = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const toolCall = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } };
const toolResult = {
  type: 'user',
  message: { content: [{ type: 'tool_result', content: 'secret-tool-output' }] },
};

describe('the Claude Code plugin against the hub', () => {
  let dir: string;
  let store: HubStore;
  let hub: Awaited<ReturnType<typeof startHub>>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindferry-plugin-e2e-'));
    store = createHubMemoryStore();
    hub = await startHub(store);
  });

  afterEach(async () => {
    await hub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeTranscript = (entries: unknown[]): string => {
    const file = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    return file;
  };

  it('leaves a searchable Claude Code thread with an anchored note behind', async () => {
    const transcript = writeTranscript([
      { type: 'ai-title', aiTitle: 'Fixing the checkout' },
      human('why does the flamingo checkout fail?'),
      reply('Let me look.'),
      toolCall,
      toolResult,
      reply('The cart total is stale.'),
      human('fix it'),
      reply('Fixed and tested.'),
    ]);

    const { code, stderr } = await runHook({
      url: hub.url,
      payload: { session_id: 'sess-1', transcript_path: transcript, cwd: '/home/u/shop' },
    });

    expect(stderr).toBe('');
    expect(code).toBe(0);

    const thread = await store.getThread('mindferry:sess-1');
    expect(thread?.surface).toBe('code');
    expect(thread?.title).toBe('Fixing the checkout — shop');
    expect(thread?.messages.map((m) => [m.role, m.segments[0].text])).toEqual([
      ['user', 'why does the flamingo checkout fail?'],
      ['assistant', 'Let me look.\n\nThe cart total is stale.'],
      ['user', 'fix it'],
      ['assistant', 'Fixed and tested.'],
    ]);
    expect(JSON.stringify(thread)).not.toContain('secret-tool-output');

    const notes = await store.listNotes('mindferry:sess-1');
    expect(notes).toHaveLength(1);
    expect(notes[0].surface).toBe('code');

    const fromCode = await store.searchThreads({
      query: 'flamingo',
      surface: 'code',
      limit: 5,
      snippetLength: 80,
    });
    const fromChat = await store.searchThreads({
      query: 'flamingo',
      surface: 'chat',
      limit: 5,
      snippetLength: 80,
    });
    expect(fromCode.map((t) => t.id)).toEqual(['mindferry:sess-1']);
    expect(fromChat).toEqual([]);
  });

  it('updates the same thread, keeping its creation time, when the session ends again', async () => {
    const first = writeTranscript([human('hello'), reply('hi')]);
    await runHook({ url: hub.url, payload: { session_id: 'sess-2', transcript_path: first } });
    const before = await store.getThread('mindferry:sess-2');

    await new Promise((resolve) => setTimeout(resolve, 20));
    const resumed = writeTranscript([
      human('hello'),
      reply('hi'),
      human('and another thing'),
      reply('noted'),
    ]);
    await runHook({ url: hub.url, payload: { session_id: 'sess-2', transcript_path: resumed } });
    const after = await store.getThread('mindferry:sess-2');

    expect(after?.messages).toHaveLength(4);
    expect(after?.createdAt).toEqual(before?.createdAt);
    expect(after?.messages[0].createdAt).toEqual(before?.messages[0].createdAt);
    expect(after?.messages[2].createdAt.getTime()).toBeGreaterThan(
      (before?.createdAt ?? new Date(0)).getTime(),
    );
    const all = await store.searchThreads({ query: 'hello', limit: 10, snippetLength: 40 });
    expect(all).toHaveLength(1);
  });

  it('still leaves the note when the operator has turned archiving off', async () => {
    const closed = createHubMemoryStore();
    const noArchive = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        void handleHubMcpRequest({
          req,
          res,
          body,
          options: { store: closed, allowArchive: false },
        });
      });
    });
    await new Promise<void>((resolve) => noArchive.listen(0, '127.0.0.1', resolve));
    const { port } = noArchive.address() as AddressInfo;

    const transcript = writeTranscript([human('a question'), reply('an answer')]);
    const { code, stderr } = await runHook({
      url: `http://127.0.0.1:${port}`,
      payload: { session_id: 'sess-3', transcript_path: transcript },
    });
    await new Promise<void>((resolve) => noArchive.close(() => resolve()));

    expect(code).toBe(0);
    expect(stderr).toContain('Could not archive the session');
    expect(await closed.getThread('mindferry:sess-3')).toBeUndefined();
    const notes = await closed.listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].threadId).toBeUndefined();
  });
});
