#!/usr/bin/env node
/**
 * SessionStart hook: reads MindFerry's hub notes and surfaces them as
 * context at the start of a session — the automatic version of what
 * docs/skills/mindferry-sync/SKILL.md instructs a session to do by hand.
 * Never blocks the session on failure: a hub that's unreachable or
 * misconfigured should degrade to "no extra context," not stop Claude Code
 * from starting.
 */
import { callHubTool } from './mcp-client.mjs';

// Session notes accumulate forever; the newest few carry the context worth injecting.
const MAX_NOTES = 20;

async function main() {
  const hubUrl = process.env.CLAUDE_PLUGIN_OPTION_HUB_URL;
  const apiKey = process.env.CLAUDE_PLUGIN_OPTION_API_KEY;
  if (!hubUrl || !apiKey) {
    // No config yet (plugin installed but not configured) — say nothing,
    // rather than warn on every session before the user has set it up.
    process.exit(0);
  }

  try {
    const notes = await callHubTool(hubUrl, apiKey, 'read_notes', { limit: MAX_NOTES });
    if (notes && !notes.includes('The hub has no notes.')) {
      console.log(
        [
          'MindFerry context hub notes (from other sessions, via the mindferry-hub MCP server):',
          '',
          notes,
        ].join('\n'),
      );
    }
  } catch (error) {
    // Visible to the user (stderr), but does not block the session — see
    // the module comment.
    console.error(`[mindferry] Could not read hub notes: ${error.message}`);
  }
  process.exit(0);
}

void main();
