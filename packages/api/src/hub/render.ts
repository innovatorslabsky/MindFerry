import type { HubThread, HubMessage, HubSegment, HubSegmentKind, HubRole } from './thread';

/**
 * Renders a canonical thread as Markdown once, for every archive target.
 * Git targets write the result as a file; a target whose storage is not
 * Markdown converts from here, so its lossiness stays inside that adapter
 * instead of reaching the canonical model.
 */

const ROLE_HEADINGS: Readonly<Record<HubRole, string>> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

const FENCE = '```';

/** Quotes and escapes a YAML scalar so any title survives a round trip. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/**
 * A fence long enough to contain `text`, so a message that itself shows a
 * code block does not terminate the block that wraps it.
 */
function fenceFor(text: string): string {
  let longest = 0;
  const runs = text.match(/^\s*`{3,}/gm);
  if (runs) {
    for (const run of runs) {
      longest = Math.max(longest, run.trim().length);
    }
  }
  return longest < FENCE.length ? FENCE : '`'.repeat(longest + 1);
}

function renderSegment(segment: HubSegment): string {
  const text = segment.text.trim();
  if (segment.kind === 'text') {
    return text;
  }
  const fence = fenceFor(text);
  if (segment.kind === 'code') {
    return `${fence}${segment.language ?? ''}\n${text}\n${fence}`;
  }
  if (segment.kind === 'tool') {
    return `${fence}tool${segment.name ? `:${segment.name}` : ''}\n${text}\n${fence}`;
  }
  return `${fence}thinking\n${text}\n${fence}`;
}

function renderMessage(message: HubMessage): string {
  const heading = ROLE_HEADINGS[message.role];
  const model = message.model ? ` · ${message.model}` : '';
  const parts = [`## ${heading} · ${message.createdAt.toISOString()}${model}`];
  for (const segment of message.segments) {
    parts.push(renderSegment(segment));
  }
  return parts.join('\n\n');
}

export interface RenderThreadMarkdownOptions {
  /** Render only these messages, in the thread's own order — the cheap way
   *  to read a long conversation once `threadOutline` has shown which turns
   *  matter, instead of the whole thing. Omitting it renders every message,
   *  unchanged from before this option existed. Unknown ids are dropped
   *  silently, same as an outline entry that names a message that's since
   *  moved — a filter, not a lookup that can fail. */
  messageIds?: readonly string[];
}

export function renderThreadMarkdown(
  thread: HubThread,
  options?: RenderThreadMarkdownOptions,
): string {
  const messages = options?.messageIds
    ? thread.messages.filter((message) => options.messageIds?.includes(message.id))
    : thread.messages;

  const frontmatter = [
    '---',
    `id: ${yamlString(thread.id)}`,
    `provider: ${thread.provider}`,
    ...(thread.surface ? [`surface: ${thread.surface}`] : []),
    `sourceId: ${yamlString(thread.sourceId)}`,
    `title: ${yamlString(thread.title)}`,
    `createdAt: ${thread.createdAt.toISOString()}`,
    `updatedAt: ${thread.updatedAt.toISOString()}`,
    `messages: ${thread.messages.length}`,
    ...(options?.messageIds ? [`shown: ${messages.length}`] : []),
    '---',
  ].join('\n');

  const body = messages.map(renderMessage);
  return [frontmatter, `# ${thread.title}`, ...body].join('\n\n') + '\n';
}

/** Bounds a preview to `maxLength` characters, collapsing whitespace first
 *  so a preview never breaks mid-line on a newline the caller didn't ask for. */
function previewText(text: string, maxLength: number): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

export interface ThreadOutlineEntry {
  id: string;
  role: HubRole;
  createdAt: Date;
  /** Every distinct segment kind present, in the order first seen — lets a
   *  caller spot "this turn has code" or "this turn has reasoning" without
   *  fetching the segment bodies. */
  kinds: readonly HubSegmentKind[];
  preview: string;
}

const DEFAULT_OUTLINE_PREVIEW_LENGTH = 160;

/**
 * The middle tier between `search_context`'s snippet and `get_thread`'s full
 * body: one entry per message, id + role + timestamp + a short preview, with
 * no segment bodies. Cheap enough to read an entire long conversation's
 * shape before deciding which message ids are actually worth fetching in
 * full via `renderThreadMarkdown`'s `messageIds` filter.
 */
export function threadOutline(
  thread: HubThread,
  previewLength: number = DEFAULT_OUTLINE_PREVIEW_LENGTH,
): ThreadOutlineEntry[] {
  return thread.messages.map((message) => {
    const kinds: HubSegmentKind[] = [];
    for (const segment of message.segments) {
      if (!kinds.includes(segment.kind)) {
        kinds.push(segment.kind);
      }
    }
    return {
      id: message.id,
      role: message.role,
      createdAt: message.createdAt,
      kinds,
      preview: previewText(
        message.segments.map((segment) => segment.text).join(' '),
        previewLength,
      ),
    };
  });
}

export function renderThreadOutlineMarkdown(
  thread: HubThread,
  previewLength: number = DEFAULT_OUTLINE_PREVIEW_LENGTH,
): string {
  const entries = threadOutline(thread, previewLength);
  const lines = entries.map((entry) => {
    const heading = ROLE_HEADINGS[entry.role];
    const extraKinds = entry.kinds.filter((kind) => kind !== 'text');
    const kindsSuffix = extraKinds.length > 0 ? ` · ${extraKinds.join('+')}` : '';
    return `- ${entry.id} · ${heading} · ${entry.createdAt.toISOString()}${kindsSuffix}\n  ${entry.preview}`;
  });

  const header = [`# ${thread.title}`, `${thread.messages.length} messages`];
  if (lines.length === 0) {
    return [...header, '(no messages)'].join('\n\n') + '\n';
  }
  return [...header, lines.join('\n')].join('\n\n') + '\n';
}
