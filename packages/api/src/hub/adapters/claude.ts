import type { HubThread, HubMessage, HubSegment } from '../thread';
import type { ChatSource } from '../source';
import { compactMessages, hubThreadId } from '../thread';

/**
 * Claude exports one JSON array of conversations, each holding a flat
 * `chat_messages` list. A list is a tree whose every node has one child, so
 * each message is linked to its predecessor and the canonical shape is the
 * same one the branching providers produce.
 */

interface ClaudeContentPart {
  type?: string | null;
  text?: string | null;
  thinking?: string | null;
  name?: string | null;
  input?: unknown;
}

interface ClaudeMessage {
  uuid?: string | null;
  text?: string | null;
  sender?: string | null;
  created_at?: string | null;
  content?: readonly ClaudeContentPart[] | null;
}

interface ClaudeConversation {
  uuid?: string | null;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  chat_messages?: readonly ClaudeMessage[] | null;
}

function toDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toSegments(message: ClaudeMessage): HubSegment[] {
  const segments: HubSegment[] = [];
  let hasText = false;

  for (const part of message.content ?? []) {
    if (part?.type === 'text' && part.text) {
      segments.push({ kind: 'text', text: part.text });
      hasText = true;
      continue;
    }
    if (part?.type === 'thinking' && part.thinking) {
      segments.push({ kind: 'thinking', text: part.thinking });
      continue;
    }
    if (part?.type === 'tool_use') {
      segments.push({
        kind: 'tool',
        text: part.input === undefined ? '' : JSON.stringify(part.input, null, 2),
        name: part.name ?? undefined,
      });
    }
  }

  if (!hasText && message.text) {
    segments.push({ kind: 'text', text: message.text });
  }
  return segments;
}

function claudeSourceId(conversation: Pick<ClaudeConversation, 'uuid'>, index: number): string {
  return conversation.uuid || `index-${index}`;
}

/** The hub thread id the conversation at `index` of a Claude.ai export is archived under. */
export function claudeExportThreadId(
  conversation: Pick<ClaudeConversation, 'uuid'>,
  index: number,
): string {
  return hubThreadId('claude', claudeSourceId(conversation, index));
}

function toThread(conversation: ClaudeConversation, index: number): HubThread {
  const createdAt = toDate(conversation.created_at, new Date(0));
  const updatedAt = toDate(conversation.updated_at, createdAt);
  const sourceId = claudeSourceId(conversation, index);

  const messages: HubMessage[] = [];
  let parentId: string | null = null;
  let position = 0;
  for (const message of conversation.chat_messages ?? []) {
    const id = message?.uuid || `${sourceId}-${position}`;
    position++;
    messages.push({
      id,
      role: message?.sender === 'human' ? 'user' : 'assistant',
      createdAt: toDate(message?.created_at, createdAt),
      segments: toSegments(message ?? {}),
      parentId,
    });
    parentId = id;
  }

  return {
    id: hubThreadId('claude', sourceId),
    provider: 'claude',
    sourceId,
    title: conversation.name?.trim() || 'Untitled Claude conversation',
    createdAt,
    updatedAt,
    /** Export order is authoritative here, so it is kept rather than re-sorted. */
    messages: compactMessages(messages),
  };
}

export function createClaudeSource(): ChatSource {
  return {
    provider: 'claude',
    detect(payload: unknown): boolean {
      if (!Array.isArray(payload) || payload.length === 0) {
        return false;
      }
      const first = payload[0] as ClaudeConversation | null;
      return typeof first === 'object' && first !== null && Array.isArray(first.chat_messages);
    },
    parse(payload: unknown): HubThread[] {
      const conversations = payload as readonly ClaudeConversation[];
      return conversations.map(toThread);
    },
  };
}
