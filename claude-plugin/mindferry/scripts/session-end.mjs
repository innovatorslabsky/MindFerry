#!/usr/bin/env node
/**
 * SessionEnd hook: saves a short note of the session's user turns back to
 * the hub, so the next session (in this client or Claude.ai) can pick it
 * up via SessionStart's read_notes call. Deliberately not a Stop hook —
 * Stop fires after every single assistant turn, and hooking a note-save to
 * it would flood the hub with one note per turn; SessionEnd fires once,
 * when the session actually ends.
 *
 * Reads the raw transcript JSONL Claude Code writes at `transcript_path`.
 * That entry format is internal and undocumented — Claude Code's own docs
 * warn it "changes between versions, so scripts that parse these files
 * directly can break on any release." Every read here is defensive
 * (malformed or unrecognized lines are skipped, never thrown) for exactly
 * that reason, and this saves the user's own turns verbatim rather than
 * attempting to summarize — no model call fits SessionEnd's tight time
 * budget, and a literal record degrades safely if a future version's
 * shape stops matching what this file assumes.
 */
import { readFileSync, existsSync } from 'node:fs';
import { callHubTool } from './mcp-client.mjs';

const MAX_TURNS = 8;
const MAX_TURN_LENGTH = 300;
const HUB_CALL_TIMEOUT_MS = 8000;

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

/** A user turn's `message.content` is a plain string for a typed message,
 *  or an array of blocks (text mixed with tool results, images, etc.) for
 *  one carrying attachments — only the `text` blocks are turns a person
 *  actually wrote. */
function extractText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

function truncate(text, maxLength) {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

/** Best-effort: the last few things the user actually asked for, as a
 *  factual record — not a generated summary (see the module comment for
 *  why). Never throws; a line it can't make sense of is simply skipped. */
function extractRecentUserTurns(transcriptPath, maxTurns) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return [];
  }
  const lines = readFileSync(transcriptPath, 'utf8').split('\n');
  const turns = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user') {
        continue;
      }
      const text = extractText(entry.message?.content).trim();
      if (text) {
        turns.push(text);
      }
    } catch {
      // Malformed or unrecognized line — the format is internal and can
      // change between Claude Code versions; skip rather than fail.
    }
  }
  return turns.slice(-maxTurns);
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const hubUrl = process.env.CLAUDE_PLUGIN_OPTION_HUB_URL;
  const apiKey = process.env.CLAUDE_PLUGIN_OPTION_API_KEY;
  if (!hubUrl || !apiKey) {
    process.exit(0);
  }

  const stdin = await readStdin();
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  const turns = extractRecentUserTurns(payload.transcript_path, MAX_TURNS);
  if (turns.length === 0) {
    process.exit(0);
  }

  const text = turns.map((turn) => `- ${truncate(turn, MAX_TURN_LENGTH)}`).join('\n');
  const title = `Session ${new Date().toISOString().slice(0, 10)} — ${payload.cwd ?? 'unknown directory'}`;

  try {
    await withTimeout(
      callHubTool(hubUrl, apiKey, 'append_note', {
        title,
        text,
        surface: 'code',
        sessionTag: payload.cwd,
      }),
      HUB_CALL_TIMEOUT_MS,
    );
  } catch (error) {
    console.error(`[mindferry] Could not save session note: ${error.message}`);
  }
  process.exit(0);
}

void main();
