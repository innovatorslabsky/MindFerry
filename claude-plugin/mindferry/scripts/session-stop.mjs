#!/usr/bin/env node
/**
 * Stop hook: buffers each turn's final assistant message to a small local
 * JSONL file, keyed by session_id, so SessionEnd can build a richer note
 * without relying solely on Claude Code's internal, undocumented
 * transcript format.
 *
 * Stop fires after every single assistant turn. This hook only ever
 * writes to local disk — never to the hub — which is what makes it safe
 * to run on every turn: a hub call here would either add network latency
 * to every response, or (the reason SessionEnd was chosen over Stop for
 * saving notes in the first place) flood the hub with one note per turn.
 * SessionEnd remains the only thing that talks to the hub.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_MESSAGE_LENGTH = 300;
const BUFFER_DIR = join(tmpdir(), 'mindferry-plugin');

export function bufferPathFor(sessionId) {
  return join(BUFFER_DIR, `${sessionId}.jsonl`);
}

function truncate(text, maxLength) {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const stdin = await readStdin();
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  // Only set when a Stop hook previously blocked this same turn and is now
  // being asked again; this hook never blocks, so that should not happen,
  // but exiting immediately is the documented safe behavior either way.
  if (payload.stop_hook_active) {
    process.exit(0);
  }

  const sessionId = payload.session_id;
  const message = payload.last_assistant_message;
  if (!sessionId || typeof message !== 'string' || !message.trim()) {
    process.exit(0);
  }

  try {
    mkdirSync(BUFFER_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      message: truncate(message, MAX_MESSAGE_LENGTH),
    };
    appendFileSync(bufferPathFor(sessionId), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error(`[mindferry] Could not buffer turn: ${error.message}`);
  }
  process.exit(0);
}

// Only self-execute when run directly as the hook command — not when
// imported for `bufferPathFor` (by session-end.mjs, and by tests), which
// would otherwise also read and consume this process's own stdin.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
