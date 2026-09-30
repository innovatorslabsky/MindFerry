#!/usr/bin/env node
/**
 * SessionEnd hook: saves a short note of the session back to the hub, so
 * the next session (in this client or Claude.ai) can pick it up via
 * SessionStart's read_notes call. The note-save itself is deliberately
 * only here, not in the Stop hook — Stop fires after every single
 * assistant turn, and a hub call on every turn would either flood the hub
 * with one note per turn or add network latency to every response;
 * SessionEnd fires once, when the session actually ends. session-stop.mjs
 * still runs on Stop, but only to buffer turns locally (see
 * readAssistantBuffer below) — never to talk to the hub.
 *
 * The whole conversation is also archived as one thread (`archive_thread`,
 * keyed by the session id so a resumed session updates the same thread
 * rather than adding another), tagged as coming from Claude Code, and the
 * summary note is anchored to it. If that archive fails — the operator turned
 * `allowArchive` off, or the hub is an older build — the note is still saved,
 * unanchored, exactly as before.
 *
 * User turns come from the raw transcript JSONL Claude Code writes at
 * `transcript_path`. That entry format is internal and undocumented —
 * Claude Code's own docs warn it "changes between versions, so scripts
 * that parse these files directly can break on any release." Every read
 * here is defensive (malformed or unrecognized lines are skipped, never
 * thrown) for exactly that reason, and this saves turns verbatim rather
 * than attempting to summarize — no model call fits SessionEnd's tight
 * time budget, and a literal record degrades safely if a future version's
 * shape stops matching what this file assumes.
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { callHubTool } from './mcp-client.mjs';
import { bufferPathFor } from './session-stop.mjs';
import { readConversation, fitToLimits, conversationTitle } from './transcript.mjs';

const MAX_TURNS = 8;
const MAX_TURN_LENGTH = 300;
const HUB_CALL_TIMEOUT_MS = 8000;
const ARCHIVE_CALL_TIMEOUT_MS = 20000;
/** Under the hub's default `contextHub.mcp.maxArchiveBytes` (6000000), with room for the omission marker. */
const ARCHIVE_LIMITS = { maxBytes: 5_000_000, maxTurnChars: 150_000, maxTurns: 2000 };

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

/** Reads and consumes the Stop hook's local buffer for this session (see
 *  session-stop.mjs) — a small set of the assistant's own recent replies,
 *  written in a format this plugin controls rather than guessed from
 *  Claude Code's internal transcript. Missing entirely (no Stop hook ran,
 *  or an older install without one) is a normal case, not an error: it
 *  just means the note falls back to user turns alone. Always deletes the
 *  buffer file once read, win or lose, so it never grows across sessions. */
function readAssistantBuffer(sessionId, maxEntries) {
  if (!sessionId) {
    return [];
  }
  const path = bufferPathFor(sessionId);
  if (!existsSync(path)) {
    return [];
  }
  const messages = [];
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (typeof entry.message === 'string' && entry.message) {
          messages.push(entry.message);
        }
      } catch {
        // Malformed buffer line — skip.
      }
    }
  } catch {
    // Unreadable buffer — treat as if none was written.
  }
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup; a leftover file just gets overwritten next session.
  }
  return messages.slice(-maxEntries);
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

/** Archives the whole session as one thread; returns its id, or undefined
 *  when there is nothing to archive or the hub refused it. */
async function archiveSession({ hubUrl, apiKey, payload }) {
  const sessionId = payload.session_id;
  if (!sessionId) {
    return undefined;
  }
  const { messages, aiTitle } = readConversation(payload.transcript_path);
  if (messages.length === 0) {
    return undefined;
  }
  const fitted = fitToLimits(messages, ARCHIVE_LIMITS);
  try {
    const result = await withTimeout(
      callHubTool(hubUrl, apiKey, 'archive_thread', {
        title: conversationTitle({ aiTitle, messages, cwd: payload.cwd }),
        sourceId: sessionId,
        surface: 'code',
        messages: fitted.messages,
      }),
      ARCHIVE_CALL_TIMEOUT_MS,
    );
    return /Archived thread (\S+)/.exec(result)?.[1] ?? `mindferry:${sessionId}`;
  } catch (error) {
    console.error(`[mindferry] Could not archive the session: ${error.message}`);
    return undefined;
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
  const assistantHighlights = readAssistantBuffer(payload.session_id, MAX_TURNS);
  if (turns.length === 0 && assistantHighlights.length === 0) {
    process.exit(0);
  }

  const threadId = await archiveSession({ hubUrl, apiKey, payload });

  const sections = [];
  if (turns.length > 0) {
    sections.push(['User asked', turns]);
  }
  if (assistantHighlights.length > 0) {
    sections.push(['Claude did', assistantHighlights]);
  }
  const text = sections
    .map(
      ([heading, items]) =>
        `${heading}:\n${items.map((item) => `- ${truncate(item, MAX_TURN_LENGTH)}`).join('\n')}`,
    )
    .join('\n\n');
  const title = `Session ${new Date().toISOString().slice(0, 10)} — ${payload.cwd ?? 'unknown directory'}`;

  try {
    await withTimeout(
      callHubTool(hubUrl, apiKey, 'append_note', {
        title,
        text,
        threadId,
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
