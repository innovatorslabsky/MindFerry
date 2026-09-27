import { Constants } from 'librechat-data-provider';
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
    sourceId: conversation.conversationId,
    title: conversation.title?.trim() || 'Untitled conversation',
    createdAt,
    updatedAt,
    messages: orderMessages(compactMessages(converted)),
  };
}
