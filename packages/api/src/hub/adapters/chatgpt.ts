import type {
  ChatGptCitation,
  ChatGptMappingNode,
  ChatGptExportMessage,
  ChatGptExportContent,
} from '../../conversations/chatgpt';
import type { HubThread, HubMessage, HubSegment, HubRole } from '../thread';
import type { ChatSource } from '../source';
import { compactMessages, orderMessages, hubThreadId } from '../thread';
import { linkChatGptCitations } from '../../conversations/chatgpt';

/**
 * ChatGPT exports one JSON array of conversations, each holding a `mapping`
 * tree keyed by node id. The tree is kept as-is: a regenerated answer is a
 * sibling branch, and flattening it here would silently discard that history.
 */

/** Fields the export carries that the import path does not read. */
interface ChatGptHubContent extends ChatGptExportContent {
  parts?: readonly unknown[] | null;
  text?: string | null;
  language?: string | null;
}

interface ChatGptHubMessage extends ChatGptExportMessage {
  author?: { role?: string | null; name?: string | null } | null;
  content?: ChatGptHubContent | null;
  create_time?: number | null;
  metadata?: { model_slug?: string | null; citations?: readonly ChatGptCitation[] | null } | null;
}

interface ChatGptHubNode extends ChatGptMappingNode {
  message?: ChatGptHubMessage | null;
}

interface ChatGptConversation {
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  conversation_id?: string | null;
  id?: string | null;
  default_model_slug?: string | null;
  mapping?: Readonly<Record<string, ChatGptHubNode | undefined>> | null;
}

const TOOL_CONTENT_TYPES = new Set([
  'execution_output',
  'tether_browsing_display',
  'tether_quote',
  'system_error',
]);

function toDate(seconds: number | null | undefined, fallback: Date): Date {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return fallback;
  }
  return new Date(seconds * 1000);
}

function toRole(role: string | null | undefined): HubRole {
  if (role === 'user') {
    return 'user';
  }
  if (role === 'system') {
    return 'system';
  }
  return 'assistant';
}

function joinParts(parts: readonly unknown[] | null | undefined): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      texts.push(part);
    }
  }
  return texts.join('\n');
}

function joinThoughts(content: ChatGptHubContent): string {
  if (!Array.isArray(content.thoughts)) {
    return '';
  }
  const texts: string[] = [];
  for (const thought of content.thoughts) {
    const text = thought?.content || thought?.summary || '';
    if (text) {
      texts.push(text);
    }
  }
  return texts.join('\n\n');
}

function toSegments(message: ChatGptHubMessage): HubSegment[] {
  const content = message.content;
  if (!content) {
    return [];
  }
  const contentType = content.content_type ?? 'text';

  if (contentType === 'thoughts') {
    return [{ kind: 'thinking', text: joinThoughts(content) }];
  }
  if (contentType === 'reasoning_recap') {
    return [{ kind: 'thinking', text: content.text ?? '' }];
  }
  if (contentType === 'code') {
    return [{ kind: 'code', text: content.text ?? '', language: content.language ?? undefined }];
  }
  if (TOOL_CONTENT_TYPES.has(contentType)) {
    const text = content.text ?? joinParts(content.parts);
    return [{ kind: 'tool', text, name: message.author?.name ?? undefined }];
  }

  const text = joinParts(content.parts) || content.text || '';
  return [{ kind: 'text', text: linkChatGptCitations(text, message.metadata?.citations ?? null) }];
}

function chatGptSourceId(
  conversation: Pick<ChatGptConversation, 'conversation_id' | 'id'>,
  index: number,
): string {
  return conversation.conversation_id || conversation.id || `index-${index}`;
}

/** The hub thread id the conversation at `index` of a ChatGPT export is archived under. */
export function chatGptExportThreadId(
  conversation: Pick<ChatGptConversation, 'conversation_id' | 'id'>,
  index: number,
): string {
  return hubThreadId('chatgpt', chatGptSourceId(conversation, index));
}

function toThread(conversation: ChatGptConversation, index: number): HubThread {
  const createdAt = toDate(conversation.create_time, new Date(0));
  const updatedAt = toDate(conversation.update_time, createdAt);
  const sourceId = chatGptSourceId(conversation, index);
  const mapping = conversation.mapping ?? {};

  const messages: HubMessage[] = [];
  for (const [id, node] of Object.entries(mapping)) {
    const message = node?.message;
    if (!message) {
      continue;
    }
    messages.push({
      id,
      role: toRole(message.author?.role),
      createdAt: toDate(message.create_time, createdAt),
      segments: toSegments(message),
      parentId: node?.parent ?? null,
      model: message.metadata?.model_slug ?? conversation.default_model_slug ?? undefined,
    });
  }

  return {
    id: hubThreadId('chatgpt', sourceId),
    provider: 'chatgpt',
    sourceId,
    title: conversation.title?.trim() || 'Untitled ChatGPT conversation',
    createdAt,
    updatedAt,
    messages: orderMessages(compactMessages(messages)),
  };
}

export function createChatGptSource(): ChatSource {
  return {
    provider: 'chatgpt',
    detect(payload: unknown): boolean {
      if (!Array.isArray(payload)) {
        return false;
      }
      if (payload.length === 0) {
        return true;
      }
      const first = payload[0] as ChatGptConversation | null;
      return typeof first === 'object' && first !== null && first.mapping != null;
    },
    parse(payload: unknown): HubThread[] {
      const conversations = payload as readonly ChatGptConversation[];
      return conversations.map(toThread);
    },
  };
}
