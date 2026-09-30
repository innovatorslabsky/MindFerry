import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CONTEXT_HUB_MAX_SEARCH_LIMIT,
  CONTEXT_HUB_DEFAULT_SEARCH_LIMIT,
  CONTEXT_HUB_DEFAULT_SNIPPET_LENGTH,
} from 'librechat-data-provider';
import type { HubStore, HubThreadSummary } from './store';
import type { HubProvider } from '../thread';
import { renderThreadMarkdown, renderThreadOutlineMarkdown } from '../render';
import { HUB_PROVIDERS } from '../thread';

/**
 * The hub's MCP surface. One server serves every client that speaks MCP — a
 * chat client that mounts it as a connector and a coding agent that mounts it
 * as a server both read the same archive and write notes the other can read,
 * which is what lets the two sides share context without either reaching into
 * the other's storage.
 */

export interface HubMcpServerOptions {
  store: HubStore;
  /** Ceiling for `search_context`; a larger request is clamped to it. */
  searchLimit?: number;
  snippetLength?: number;
  /** When false, the hub is read-only and `append_note` is not registered. */
  allowNotes?: boolean;
  /** When false, `archive_thread` is not registered — a client can still read
   *  and write notes, but cannot add a full conversation to the archive. */
  allowArchive?: boolean;
  name?: string;
  version?: string;
}

const TEXT = 'text' as const;

const asText = (text: string) => ({ content: [{ type: TEXT, text }] });

function formatSummary(summary: HubThreadSummary): string {
  const lines = [
    `- ${summary.title}`,
    `  id: ${summary.id}`,
    `  provider: ${summary.provider}`,
    `  updated: ${summary.updatedAt.toISOString()}`,
    `  messages: ${summary.messageCount}`,
  ];
  if (summary.snippet) {
    lines.push(`  match: ${summary.snippet}`);
  }
  return lines.join('\n');
}

export function createHubMcpServer(options: HubMcpServerOptions): McpServer {
  const {
    store,
    searchLimit = CONTEXT_HUB_DEFAULT_SEARCH_LIMIT,
    snippetLength = CONTEXT_HUB_DEFAULT_SNIPPET_LENGTH,
    allowNotes = true,
    allowArchive = true,
    name = 'mindferry',
    version = '1.0.0',
  } = options;

  const server = new McpServer({ name, version });

  server.registerTool(
    'search_context',
    {
      title: 'Search archived conversations',
      description:
        'Search conversations archived from every connected assistant. Returns thread ids to pass to get_thread.',
      inputSchema: {
        query: z.string().min(1).describe('Text to look for in titles and message content'),
        providers: z
          .array(z.enum(HUB_PROVIDERS))
          .optional()
          .describe('Restrict the search to these providers'),
        limit: z.number().int().min(1).max(CONTEXT_HUB_MAX_SEARCH_LIMIT).optional(),
      },
    },
    async ({ query, providers, limit }) => {
      const summaries = await store.searchThreads({
        query,
        providers: providers as HubProvider[] | undefined,
        limit: Math.min(limit ?? searchLimit, searchLimit),
        snippetLength,
      });
      if (summaries.length === 0) {
        return asText(`No archived conversation matches "${query}".`);
      }
      return asText(summaries.map(formatSummary).join('\n\n'));
    },
  );

  server.registerTool(
    'get_thread_outline',
    {
      title: "Read one archived conversation's outline",
      description:
        'List every message in an archived conversation as a compact timeline — id, role, ' +
        'timestamp, and a short preview — without the full content. Cheaper than get_thread for ' +
        'a long conversation: read the outline first, then pass just the message ids you need to ' +
        "get_thread's messageIds parameter instead of fetching the whole thing.",
      inputSchema: {
        id: z.string().min(1).describe('Thread id from search_context, such as "claude:abc123"'),
      },
    },
    async ({ id }) => {
      const thread = await store.getThread(id);
      if (!thread) {
        return asText(`No archived conversation has id "${id}".`);
      }
      return asText(renderThreadOutlineMarkdown(thread));
    },
  );

  server.registerTool(
    'get_thread',
    {
      title: 'Read one archived conversation',
      description:
        'Return an archived conversation as Markdown, including reasoning and tool segments the ' +
        'provider exported. Returns every message by default; for a long conversation, call ' +
        'get_thread_outline first and pass messageIds to fetch only the turns that matter.',
      inputSchema: {
        id: z.string().min(1).describe('Thread id from search_context, such as "claude:abc123"'),
        messageIds: z
          .array(z.string().min(1))
          .max(200)
          .optional()
          .describe(
            'Only return these message ids, from get_thread_outline — the cheaper way to read ' +
              'a long conversation. Omit to return every message.',
          ),
      },
    },
    async ({ id, messageIds }) => {
      const thread = await store.getThread(id);
      if (!thread) {
        return asText(`No archived conversation has id "${id}".`);
      }
      return asText(renderThreadMarkdown(thread, { messageIds }));
    },
  );

  server.registerTool(
    'read_notes',
    {
      title: 'Read hub notes',
      description:
        'Read notes written into the hub, optionally only those anchored to one thread. Notes are how one client leaves context for another.',
      inputSchema: {
        threadId: z.string().min(1).optional().describe('Only notes anchored to this thread'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Only the most recent notes, up to this many. Omit to read every note.'),
      },
    },
    async ({ threadId, limit }) => {
      const notes = await store.listNotes(threadId, limit);
      if (notes.length === 0) {
        return asText(
          threadId ? `No notes are anchored to "${threadId}".` : 'The hub has no notes.',
        );
      }
      const rendered = notes.map((note) => {
        const meta = [
          note.createdAt.toISOString(),
          note.surface,
          note.sessionTag,
          note.threadId,
        ].filter(Boolean);
        return `## ${note.title}\n${meta.join(' · ')}\n\n${note.text}`;
      });
      return asText(rendered.join('\n\n'));
    },
  );

  if (allowNotes) {
    server.registerTool(
      'append_note',
      {
        title: 'Write a note into the hub',
        description:
          'Record a durable note other clients can read, optionally anchored to an archived thread.',
        inputSchema: {
          title: z.string().min(1).describe('Short label for the note'),
          text: z.string().min(1).describe('The note body, in Markdown'),
          threadId: z.string().min(1).optional().describe('Anchor the note to this thread'),
          surface: z
            .enum(['chat', 'code', 'agent', 'other'])
            .optional()
            .describe(
              'Which client is writing this note — claude.ai chat, Claude Code, an external agent, or other',
            ),
          sessionTag: z
            .string()
            .max(200)
            .optional()
            .describe('Free text distinguishing this session from others of the same surface'),
        },
      },
      async ({ title, text, threadId, surface, sessionTag }) => {
        const note = await store.appendNote({ title, text, threadId, surface, sessionTag });
        return asText(`Saved note ${note.id}.`);
      },
    );
  }

  if (allowArchive) {
    server.registerTool(
      'archive_thread',
      {
        title: 'Archive a full conversation',
        description:
          'Archive this conversation into the hub verbatim, turn by turn — not a summary. ' +
          'Use append_note for a short summary instead; use this when the user wants the ' +
          'conversation itself kept, the way "Save to MindFerry" keeps one from this app\'s own UI. ' +
          'Pass the same sourceId again later to update this thread instead of creating a new one.',
        inputSchema: {
          title: z.string().min(1).describe('A short, descriptive title for the conversation'),
          sourceId: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe(
              "A stable id for this conversation (e.g. the calling client's own conversation id). Reusing it updates the existing thread; omitting it always creates a new one.",
            ),
          messages: z
            .array(
              z.object({
                role: z.enum(['user', 'assistant']),
                text: z.string().min(1).max(200_000),
              }),
            )
            .min(1)
            .max(2000)
            .describe('Every turn, in order, verbatim — not a summary or excerpt'),
        },
      },
      async ({ title, sourceId, messages }) => {
        const summary = await store.archiveThread({ title, sourceId, messages });
        return asText(`Archived thread ${summary.id} (${summary.messageCount} messages).`);
      },
    );
  }

  return server;
}
