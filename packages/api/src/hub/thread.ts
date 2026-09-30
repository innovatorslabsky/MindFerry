/**
 * Canonical, provider-neutral representation of one exported conversation.
 *
 * Every adapter normalizes into this shape and every consumer — the markdown
 * renderer, the archive targets, the MCP server — reads only this shape, so a
 * new provider is a new adapter rather than a new branch in shared code.
 */

export const HUB_PROVIDERS = ['chatgpt', 'claude', 'gemini', 'perplexity', 'mindferry'] as const;

export type HubProvider = (typeof HUB_PROVIDERS)[number];

/** Which client a conversation or note came from — claude.ai web, Claude Code, an external agent, or other. */
export const HUB_SURFACES = ['chat', 'code', 'agent', 'other'] as const;

export type HubSurface = (typeof HUB_SURFACES)[number];

export type HubRole = 'user' | 'assistant' | 'system';

/**
 * `thinking` carries reasoning the provider exposed separately from the answer.
 * `tool` carries a tool or function call; `name` is the provider's label for it.
 */
export type HubSegmentKind = 'text' | 'thinking' | 'code' | 'tool';

export interface HubSegment {
  kind: HubSegmentKind;
  text: string;
  /** Present on `code` segments when the provider reported a language. */
  language?: string;
  /** Present on `tool` segments. */
  name?: string;
}

export interface HubMessage {
  id: string;
  role: HubRole;
  createdAt: Date;
  segments: HubSegment[];
  /**
   * Preserves the provider's branching. ChatGPT exports a tree, Claude a list;
   * a list is a tree whose every node has one child, so both round-trip here.
   */
  parentId: string | null;
  model?: string;
}

export interface HubThread {
  /** `${provider}:${sourceId}` — stable across re-imports of the same export. */
  id: string;
  provider: HubProvider;
  /** Which client held the conversation; absent for imported exports, which read as `chat`. */
  surface?: HubSurface;
  /** The provider's own conversation identifier. */
  sourceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: HubMessage[];
}

export function hubThreadId(provider: HubProvider, sourceId: string): string {
  return `${provider}:${sourceId}`;
}

const isNonEmpty = (segment: HubSegment): boolean => segment.text.trim().length > 0;

/**
 * Drops blank segments, then the messages left with nothing to say, rewiring
 * each survivor to its nearest surviving ancestor. Providers emit placeholder
 * nodes mid-tree — a hidden system prompt, an empty tool turn — and simply
 * removing them would orphan every reply beneath one.
 */
export function compactMessages(messages: readonly HubMessage[]): HubMessage[] {
  const survivors = new Map<string, HubMessage>();
  const parents = new Map<string, string | null>();

  for (const message of messages) {
    parents.set(message.id, message.parentId);
    const segments = message.segments.filter(isNonEmpty);
    if (segments.length > 0) {
      survivors.set(message.id, { ...message, segments });
    }
  }

  const resolved = new Map<string, string | null>();
  const nearestSurviving = (startId: string | null): string | null => {
    const walked = new Set<string>();
    let found: string | null = null;
    let id = startId;
    while (id !== null) {
      const known = resolved.get(id);
      if (known !== undefined) {
        found = known;
        break;
      }
      if (survivors.has(id)) {
        found = id;
        break;
      }
      if (walked.has(id) || !parents.has(id)) {
        break;
      }
      walked.add(id);
      id = parents.get(id) ?? null;
    }
    for (const walkedId of walked) {
      resolved.set(walkedId, found);
    }
    return found;
  };

  const compacted: HubMessage[] = [];
  for (const message of messages) {
    const survivor = survivors.get(message.id);
    if (survivor) {
      compacted.push({ ...survivor, parentId: nearestSurviving(survivor.parentId) });
    }
  }
  return compacted;
}

/**
 * Orders messages parent-before-child, which neither provider guarantees and
 * every consumer assumes. Roots keep their relative order; siblings follow
 * `createdAt`, falling back to input order so the result is deterministic.
 * Messages whose parent is missing are treated as roots rather than dropped.
 */
export function orderMessages(messages: readonly HubMessage[]): HubMessage[] {
  const positions = new Map<string, number>();
  const children = new Map<string | null, HubMessage[]>();

  for (let i = 0; i < messages.length; i++) {
    positions.set(messages[i].id, i);
  }

  for (const message of messages) {
    const parentId =
      message.parentId !== null && positions.has(message.parentId) ? message.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) {
      siblings.push(message);
      continue;
    }
    children.set(parentId, [message]);
  }

  for (const siblings of children.values()) {
    siblings.sort((a, b) => {
      const byTime = a.createdAt.getTime() - b.createdAt.getTime();
      if (byTime !== 0) {
        return byTime;
      }
      return (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0);
    });
  }

  const ordered: HubMessage[] = [];
  const pending: HubMessage[] = [...(children.get(null) ?? [])].reverse();
  while (pending.length > 0) {
    const message = pending.pop() as HubMessage;
    ordered.push(message);
    const siblings = children.get(message.id);
    if (!siblings) {
      continue;
    }
    for (let i = siblings.length - 1; i >= 0; i--) {
      pending.push(siblings[i]);
    }
  }

  return ordered;
}

/** Concatenated text of a thread, for indexing and previews. */
export function threadText(thread: HubThread): string {
  const pieces: string[] = [];
  for (const message of thread.messages) {
    for (const segment of message.segments) {
      pieces.push(segment.text);
    }
  }
  return pieces.join('\n');
}
