import { Constants } from 'librechat-data-provider';
import type { HubThreadRecord } from '@librechat/data-schemas';
import type { HubThread, HubMessage, HubSegment, HubRole } from '../thread';
import { compactMessages, orderMessages, hubThreadId } from '../thread';

/**
 * Converts a LibreChat conversation already loaded from the database — not
 * an exported JSON file — into the canonical archive shape. This is what the
 * "Save to MindFerry" action uses: it reads the conversation the user
 * already has open and converts it directly, rather than round-tripping
 * through an export file and the upload endpoint.
 */

export interface LibreChatArchiveContentPart {
  type: string;
  text?: string | null;
  think?: string | null;
  tool_call?: { name?: string | null; args?: unknown } | null;
}

export interface LibreChatArchiveMessage {
  messageId: string;
  parentMessageId?: string | null;
  text?: string | null;
  isCreatedByUser: boolean;
  createdAt: Date | string;
  model?: string | null;
  content?: readonly LibreChatArchiveContentPart[] | null;
}

export interface LibreChatArchiveConversation {
  conversationId: string;
  title?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function toDate(value: Date | string | null | undefined, fallback: Date): Date {
  if (value == null) {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function toParentId(parentMessageId: string | null | undefined): string | null {
  if (!parentMessageId || parentMessageId === Constants.NO_PARENT) {
    return null;
  }
  return parentMessageId;
}

function toSegments(message: LibreChatArchiveMessage): HubSegment[] {
  const parts = message.content;
  if (!parts || parts.length === 0) {
    return message.text ? [{ kind: 'text', text: message.text }] : [];
  }

  const segments: HubSegment[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      segments.push({ kind: 'text', text: part.text });
    } else if (part.type === 'think' && part.think) {
      segments.push({ kind: 'thinking', text: part.think });
    } else if (part.type === 'tool_call' && part.tool_call) {
      const { name, args } = part.tool_call;
      segments.push({
        kind: 'tool',
        text: args === undefined ? '' : JSON.stringify(args, null, 2),
        name: name ?? undefined,
      });
    }
  }
  return segments;
}

export function convertLibreChatConversation(
  conversation: LibreChatArchiveConversation,
  messages: readonly LibreChatArchiveMessage[],
): HubThread {
  const createdAt = toDate(conversation.createdAt, new Date(0));
  const updatedAt = toDate(conversation.updatedAt, createdAt);

  const converted: HubMessage[] = messages.map((message) => ({
    id: message.messageId,
    role: (message.isCreatedByUser ? 'user' : 'assistant') as HubRole,
    createdAt: toDate(message.createdAt, createdAt),
    segments: toSegments(message),
    parentId: toParentId(message.parentMessageId),
    model: message.model ?? undefined,
  }));

  return {
    id: hubThreadId('mindferry', conversation.conversationId),
    provider: 'mindferry',
    surface: 'chat',
    sourceId: conversation.conversationId,
    title: conversation.title?.trim() || 'Untitled conversation',
    createdAt,
    updatedAt,
    messages: orderMessages(compactMessages(converted)),
  };
}

/** Where a continued conversation should run; each field falls back to the deployment's own default when absent. */
export interface HubContinueTarget {
  endpoint?: string;
  model?: string;
}

export interface HubContinueMessage {
  messageId: string;
  parentMessageId: string;
  text: string;
  sender: string;
  isCreatedByUser: boolean;
  createdAt: string;
  endpoint?: string;
  model?: string;
}

/**
 * The shape LibreChat's own conversation importer accepts (`conversationId`
 * plus a flat `messages` list with parent links) — so a continued chat goes
 * through the same content filters, size limits and model defaulting as any
 * other import rather than a second write path.
 */
export interface HubContinueImport {
  conversationId: string;
  title: string;
  endpoint?: string;
  options?: { endpoint?: string; model?: string };
  messages: HubContinueMessage[];
}

const ASSISTANT_LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

function segmentToMarkdown(segment: HubSegment): string {
  if (segment.kind === 'code') {
    return `\`\`\`${segment.language ?? ''}\n${segment.text}\n\`\`\``;
  }
  return segment.text;
}

/** The parts of a message a chat can carry forward: its text and code. Reasoning and tool calls stay in the archive. */
function toChatSegments(segments: readonly HubSegment[]): HubSegment[] {
  return segments.filter((segment) => segment.kind === 'text' || segment.kind === 'code');
}

/**
 * Converts an archived thread into something a person can keep chatting in.
 * System messages, reasoning and tool calls are left behind; a message with
 * nothing else to say is dropped and its replies re-parented, so branching
 * survives. Returns no messages when the thread has nothing a chat could show.
 */
export function convertHubThreadToChat(
  thread: HubThreadRecord,
  target: HubContinueTarget = {},
): HubContinueImport {
  const assistant = ASSISTANT_LABELS[thread.provider] ?? 'Assistant';
  const chatMessages: HubMessage[] = thread.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      ...message,
      segments: toChatSegments(message.segments),
    }));

  const messages = orderMessages(compactMessages(chatMessages)).map(
    (message): HubContinueMessage => {
      const isCreatedByUser = message.role === 'user';
      return {
        messageId: message.id,
        parentMessageId: message.parentId ?? Constants.NO_PARENT,
        text: message.segments.map(segmentToMarkdown).join('\n\n'),
        sender: isCreatedByUser ? 'User' : assistant,
        isCreatedByUser,
        createdAt: message.createdAt.toISOString(),
        ...(isCreatedByUser || !target.endpoint ? {} : { endpoint: target.endpoint }),
        ...(isCreatedByUser || !target.model ? {} : { model: target.model }),
      };
    },
  );

  return {
    conversationId: thread.id,
    title: thread.title,
    ...(target.endpoint ? { endpoint: target.endpoint } : {}),
    ...(target.model ? { options: { model: target.model } } : {}),
    messages,
  };
}
