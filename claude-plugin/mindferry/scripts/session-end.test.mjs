import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { bufferPathFor } from './session-stop.mjs';

// Not exported from session-end.mjs (a hook script, not a module other code
// imports) — re-implemented here byte-for-byte is the wrong kind of
// duplicate per CLAUDE.md's DRY rule, so instead these tests exercise the
// script the same way Claude Code actually invokes it: spawned as a child
// process with stdin/env, asserting on its real side effects.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./session-end.mjs', import.meta.url));

function runScript({ stdin, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

function makeTranscript(dir, entries) {
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  return path;
}

test('exits 0 without attempting anything when hub credentials are unset', async () => {
  const { code, stderr } = await runScript({
    stdin: '{}',
    env: { CLAUDE_PLUGIN_OPTION_HUB_URL: '', CLAUDE_PLUGIN_OPTION_API_KEY: '' },
  });
  assert.equal(code, 0);
  assert.equal(stderr, '');
});

test('exits 0 on malformed stdin JSON, never crashing the session end', async () => {
  const { code } = await runScript({
    stdin: 'not json',
    env: { CLAUDE_PLUGIN_OPTION_HUB_URL: 'http://127.0.0.1:1', CLAUDE_PLUGIN_OPTION_API_KEY: 'k' },
  });
  assert.equal(code, 0);
});

test('exits 0 when the transcript path does not exist', async () => {
  const { code } = await runScript({
    stdin: JSON.stringify({ transcript_path: '/does/not/exist.jsonl', cwd: '/tmp' }),
    env: { CLAUDE_PLUGIN_OPTION_HUB_URL: 'http://127.0.0.1:1', CLAUDE_PLUGIN_OPTION_API_KEY: 'k' },
  });
  assert.equal(code, 0);
});

test('extracts only user turns, from both string and array content shapes, ignoring malformed lines', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const transcriptPath = makeTranscript(dir, [
    { type: 'user', message: { content: 'first real question' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'a reply, not a turn' }] } },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', text: 'ignored' },
          { type: 'text', text: 'second question' },
        ],
      },
    },
  ]);

  let capturedBody;
  const server = await startFakeHub((body) => {
    capturedBody = body;
  });
  t.after(() => server.close());

  const { code } = await runScript({
    stdin: JSON.stringify({ transcript_path: transcriptPath, cwd: '/tmp/project' }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });

  assert.equal(code, 0);
  assert.ok(capturedBody, 'expected the fake hub to receive an append_note call');
  const noteText = capturedBody.params.arguments.text;
  assert.match(noteText, /first real question/);
  assert.match(noteText, /second question/);
  assert.doesNotMatch(noteText, /a reply, not a turn/);
  assert.doesNotMatch(noteText, /ignored/);
});

test('malformed lines in the transcript are skipped rather than crashing the extraction', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const transcriptPath = join(dir, 'transcript.jsonl');
  writeFileSync(
    transcriptPath,
    [
      '{not valid json',
      JSON.stringify({ type: 'user', message: { content: 'the only real one' } }),
      JSON.stringify({ type: 'user' }), // missing .message entirely
    ].join('\n') + '\n',
  );

  let capturedBody;
  const server = await startFakeHub((body) => {
    capturedBody = body;
  });
  t.after(() => server.close());

  const { code } = await runScript({
    stdin: JSON.stringify({ transcript_path: transcriptPath, cwd: '/tmp' }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });

  assert.equal(code, 0);
  assert.match(capturedBody.params.arguments.text, /the only real one/);
});

test('exits 0, without hanging, when the hub is unreachable', async () => {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  const transcriptPath = makeTranscript(dir, [{ type: 'user', message: { content: 'x' } }]);
  try {
    const { code } = await runScript({
      stdin: JSON.stringify({ transcript_path: transcriptPath, cwd: '/tmp' }),
      env: {
        CLAUDE_PLUGIN_OPTION_HUB_URL: 'http://127.0.0.1:1',
        CLAUDE_PLUGIN_OPTION_API_KEY: 'k',
      },
    });
    assert.equal(code, 0);
    assert.ok(Date.now() - start < 5000, 'should fail fast on connection refused, not hang');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes buffered assistant turns from session-stop.mjs and deletes the buffer after', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  const sessionId = `test-${randomUUID()}`;
  const bufferPath = bufferPathFor(sessionId);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    try {
      rmSync(bufferPath);
    } catch {
      // deleted by session-end.mjs itself, which is what this test checks
    }
  });

  const transcriptPath = makeTranscript(dir, [
    { type: 'user', message: { content: 'the question' } },
  ]);
  writeFileSync(
    bufferPath,
    [{ timestamp: new Date().toISOString(), message: 'built the thing' }]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n',
  );

  let capturedBody;
  const server = await startFakeHub((body) => {
    capturedBody = body;
  });
  t.after(() => server.close());

  const { code } = await runScript({
    stdin: JSON.stringify({ transcript_path: transcriptPath, cwd: '/tmp', session_id: sessionId }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });

  assert.equal(code, 0);
  const noteText = capturedBody.params.arguments.text;
  assert.match(noteText, /User asked:/);
  assert.match(noteText, /the question/);
  assert.match(noteText, /Claude did:/);
  assert.match(noteText, /built the thing/);
  assert.equal(existsSync(bufferPath), false, 'buffer should be deleted after being read');
});

test('saves a note from buffered assistant turns alone when the transcript has no user turns', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  const sessionId = `test-${randomUUID()}`;
  const bufferPath = bufferPathFor(sessionId);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    try {
      rmSync(bufferPath);
    } catch {
      // deleted by session-end.mjs itself
    }
  });

  const transcriptPath = makeTranscript(dir, [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'not a user turn' }] } },
  ]);
  writeFileSync(
    bufferPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), message: 'summary only' })}\n`,
  );

  let capturedBody;
  const server = await startFakeHub((body) => {
    capturedBody = body;
  });
  t.after(() => server.close());

  const { code } = await runScript({
    stdin: JSON.stringify({ transcript_path: transcriptPath, cwd: '/tmp', session_id: sessionId }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });

  assert.equal(code, 0);
  assert.doesNotMatch(capturedBody.params.arguments.text, /User asked:/);
  assert.match(capturedBody.params.arguments.text, /Claude did:/);
  assert.match(capturedBody.params.arguments.text, /summary only/);
});

test('proceeds normally when no buffer file exists for the session', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const transcriptPath = makeTranscript(dir, [
    { type: 'user', message: { content: 'no buffer here' } },
  ]);

  let capturedBody;
  const server = await startFakeHub((body) => {
    capturedBody = body;
  });
  t.after(() => server.close());

  const { code } = await runScript({
    stdin: JSON.stringify({
      transcript_path: transcriptPath,
      cwd: '/tmp',
      session_id: `test-${randomUUID()}`,
    }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });

  assert.equal(code, 0);
  assert.match(capturedBody.params.arguments.text, /no buffer here/);
  assert.doesNotMatch(capturedBody.params.arguments.text, /Claude did:/);
});

/** A minimal stand-in for the real hub, for the tests above that need to
 *  observe what session-end.mjs actually sent — mirrors the same SSE
 *  envelope shape the real hub's Streamable HTTP transport uses (verified
 *  against the real handler; see mcp-client.test.mjs). */
function startFakeHub(onToolCall) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = JSON.parse(raw);
        const override = onToolCall(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: override ?? { content: [{ type: 'text', text: 'Saved note test-1.' }] },
          })}\n\n`,
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

const OK = (text) => ({ content: [{ type: 'text', text }] });

async function runWithHub(
  t,
  { entries, sessionId = `test-${randomUUID()}`, cwd = '/tmp/shop', respond },
) {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcriptPath = makeTranscript(dir, entries);
  const calls = [];
  const server = await startFakeHub((body) => {
    calls.push(body.params);
    return respond?.(body.params);
  });
  t.after(() => server.close());
  const result = await runScript({
    stdin: JSON.stringify({ transcript_path: transcriptPath, cwd, session_id: sessionId }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });
  return { ...result, calls, sessionId };
}

const conversation = [
  { type: 'ai-title', aiTitle: 'Fixing the checkout' },
  { type: 'user', origin: { kind: 'human' }, message: { content: 'why does checkout fail?' } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'The cart total is stale.' }] } },
  { type: 'user', origin: { kind: 'human' }, message: { content: 'fix it' } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed and tested.' }] } },
];

test('archives the whole session as one Claude Code thread keyed by the session id', async (t) => {
  const { code, calls, sessionId } = await runWithHub(t, {
    entries: conversation,
    respond: (params) =>
      params.name === 'archive_thread'
        ? OK(`Archived thread mindferry:s (4 messages).`)
        : undefined,
  });

  assert.equal(code, 0);
  const archive = calls.find((call) => call.name === 'archive_thread');
  assert.ok(archive, 'expected an archive_thread call');
  assert.equal(archive.arguments.sourceId, sessionId);
  assert.equal(archive.arguments.surface, 'code');
  assert.equal(archive.arguments.title, 'Fixing the checkout — shop');
  assert.deepEqual(archive.arguments.messages, [
    { role: 'user', text: 'why does checkout fail?' },
    { role: 'assistant', text: 'The cart total is stale.' },
    { role: 'user', text: 'fix it' },
    { role: 'assistant', text: 'Fixed and tested.' },
  ]);
});

test('anchors the summary note to the archived thread', async (t) => {
  const { calls } = await runWithHub(t, {
    entries: conversation,
    respond: (params) =>
      params.name === 'archive_thread'
        ? OK('Archived thread mindferry:abc (4 messages).')
        : undefined,
  });

  assert.deepEqual(
    calls.map((call) => call.name),
    ['archive_thread', 'append_note'],
  );
  assert.equal(calls[1].arguments.threadId, 'mindferry:abc');
  assert.equal(calls[1].arguments.surface, 'code');
});

test('still saves the note, unanchored, when the hub refuses the archive', async (t) => {
  const { code, stderr, calls } = await runWithHub(t, {
    entries: conversation,
    respond: (params) =>
      params.name === 'archive_thread'
        ? { isError: true, content: [{ type: 'text', text: 'over the limit' }] }
        : undefined,
  });

  assert.equal(code, 0);
  assert.match(stderr, /Could not archive the session: .*over the limit/);
  const note = calls.find((call) => call.name === 'append_note');
  assert.ok(note, 'expected the note to be saved anyway');
  assert.equal(note.arguments.threadId, undefined);
});

test('does not archive without a session id, since it would create a new thread every time', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mindferry-session-end-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcriptPath = makeTranscript(dir, conversation);
  const calls = [];
  const server = await startFakeHub((body) => {
    calls.push(body.params.name);
  });
  t.after(() => server.close());

  const { code } = await runScript({
    stdin: JSON.stringify({ transcript_path: transcriptPath, cwd: '/tmp' }),
    env: {
      CLAUDE_PLUGIN_OPTION_HUB_URL: `http://127.0.0.1:${server.port}`,
      CLAUDE_PLUGIN_OPTION_API_KEY: 'test-key',
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, ['append_note']);
});

test('sends the same sourceId when the same session ends again, so the thread is updated', async (t) => {
  const sessionId = `test-${randomUUID()}`;
  const first = await runWithHub(t, { entries: conversation, sessionId });
  const second = await runWithHub(t, {
    entries: [
      ...conversation,
      { type: 'user', origin: { kind: 'human' }, message: { content: 'one more thing' } },
    ],
    sessionId,
  });

  const ids = [first, second].map(
    (run) => run.calls.find((call) => call.name === 'archive_thread').arguments.sourceId,
  );
  assert.deepEqual(ids, [sessionId, sessionId]);
});

test('archives a long session within the hub size limit, newest turns kept', async (t) => {
  const big = 'y'.repeat(140_000);
  const entries = [];
  for (let i = 0; i < 60; i++) {
    entries.push({ type: 'user', origin: { kind: 'human' }, message: { content: `q${i} ${big}` } });
    entries.push({
      type: 'assistant',
      message: { content: [{ type: 'text', text: `a${i} ${big}` }] },
    });
  }

  const { code, calls } = await runWithHub(t, { entries });

  assert.equal(code, 0);
  const { messages } = calls.find((call) => call.name === 'archive_thread').arguments;
  const bytes = messages.reduce((total, message) => total + Buffer.byteLength(message.text), 0);
  assert.ok(bytes <= 5_100_000, `archive payload too large: ${bytes}`);
  assert.match(messages[0].text, /earlier conversation not archived/);
  assert.match(messages.at(-1).text, /^a59 /);
});
