import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

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
      message: { content: [{ type: 'tool_result', text: 'ignored' }, { type: 'text', text: 'second question' }] },
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
      env: { CLAUDE_PLUGIN_OPTION_HUB_URL: 'http://127.0.0.1:1', CLAUDE_PLUGIN_OPTION_API_KEY: 'k' },
    });
    assert.equal(code, 0);
    assert.ok(Date.now() - start < 5000, 'should fail fast on connection refused, not hang');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
        onToolCall(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: 'Saved note test-1.' }] },
          })}\n\n`,
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}
