import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { bufferPathFor } from './session-stop.mjs';

const SCRIPT = fileURLToPath(new URL('./session-stop.mjs', import.meta.url));

function runScript(stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

function readBufferEntries(sessionId) {
  const path = bufferPathFor(sessionId);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('appends the last assistant message to a buffer file keyed by session_id', async (t) => {
  const sessionId = `test-${randomUUID()}`;
  t.after(() => {
    try {
      rmSync(bufferPathFor(sessionId));
    } catch {
      // already cleaned up by the test
    }
  });

  const { code } = await runScript(
    JSON.stringify({ session_id: sessionId, last_assistant_message: 'did the thing' }),
  );

  assert.equal(code, 0);
  const entries = readBufferEntries(sessionId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'did the thing');
  assert.ok(entries[0].timestamp);
});

test('appends multiple turns across repeated invocations', async (t) => {
  const sessionId = `test-${randomUUID()}`;
  t.after(() => {
    try {
      rmSync(bufferPathFor(sessionId));
    } catch {
      // already cleaned up by the test
    }
  });

  await runScript(JSON.stringify({ session_id: sessionId, last_assistant_message: 'first' }));
  await runScript(JSON.stringify({ session_id: sessionId, last_assistant_message: 'second' }));

  const entries = readBufferEntries(sessionId);
  assert.deepEqual(
    entries.map((e) => e.message),
    ['first', 'second'],
  );
});

test('truncates an overly long assistant message', async (t) => {
  const sessionId = `test-${randomUUID()}`;
  t.after(() => {
    try {
      rmSync(bufferPathFor(sessionId));
    } catch {
      // already cleaned up by the test
    }
  });

  const long = 'x'.repeat(500);
  await runScript(JSON.stringify({ session_id: sessionId, last_assistant_message: long }));

  const entries = readBufferEntries(sessionId);
  assert.ok(entries[0].message.length < 500);
  assert.ok(entries[0].message.endsWith('…'));
});

test('does not write when stop_hook_active is true', async () => {
  const sessionId = `test-${randomUUID()}`;
  await runScript(
    JSON.stringify({ session_id: sessionId, last_assistant_message: 'x', stop_hook_active: true }),
  );
  assert.equal(existsSync(bufferPathFor(sessionId)), false);
});

test('does not write when session_id is missing', async () => {
  const { code } = await runScript(JSON.stringify({ last_assistant_message: 'no session' }));
  assert.equal(code, 0);
});

test('does not write when last_assistant_message is missing or blank', async () => {
  const sessionId = `test-${randomUUID()}`;
  await runScript(JSON.stringify({ session_id: sessionId, last_assistant_message: '   ' }));
  assert.equal(existsSync(bufferPathFor(sessionId)), false);
});

test('exits 0 on malformed stdin JSON, never crashing the turn', async () => {
  const { code } = await runScript('not json');
  assert.equal(code, 0);
});

test('bufferPathFor places files under a shared plugin tmp directory', () => {
  const path = bufferPathFor('abc');
  assert.ok(path.includes(join(tmpdir(), 'mindferry-plugin')));
  assert.ok(path.endsWith('abc.jsonl'));
});
