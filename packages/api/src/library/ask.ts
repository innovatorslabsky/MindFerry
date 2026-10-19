import { Constants } from 'librechat-data-provider';
import type { LibraryDocumentSummary, LibraryHighlightRecord } from '@librechat/data-schemas';
import type { HubContinueImport, HubContinueMessage } from '../hub/adapters/librechat';
import { UNTRUSTED_NOTICE, clip, listHighlights } from './chat';

/** What the person wants from the library as a whole. */
export const ASK_MODES = ['find', 'learn', 'research', 'catchup', 'recommend'] as const;
export type AskMode = (typeof ASK_MODES)[number];

/** These are about a subject, so they need one; catching up and recommending look at the whole library. */
export function needsTopic(mode: AskMode): boolean {
  return mode === 'find' || mode === 'learn' || mode === 'research';
}

/** How many documents each mode looks at, and whether it reads their text or only their opening. */
export const ASK_LIMITS: Record<AskMode, { documents: number; fullText: boolean }> = {
  find: { documents: 10, fullText: false },
  learn: { documents: 3, fullText: true },
  research: { documents: 6, fullText: true },
  catchup: { documents: 8, fullText: false },
  recommend: { documents: 12, fullText: false },
};

/** Fewest characters of text each document gets, however many are shown. */
export const MIN_CHARS_PER_DOCUMENT = 1_500;

export interface AskEntry {
  document: LibraryDocumentSummary;
  /** The text shown: the document's text up to its share of the cap, or only its opening. */
  text: string;
  truncated: boolean;
  highlights: LibraryHighlightRecord[];
}

export interface AskSource {
  mode: AskMode;
  topic?: string;
  entries: AskEntry[];
  /** For recommending: what the person has been marking lately, as a hint of what they care about. */
  recentHighlights?: LibraryHighlightRecord[];
}

const MAX_TOPIC_CHARS = 300;

function request(mode: AskMode, topic: string | undefined): string {
  const about = topic ? `“${clip(topic, MAX_TOPIC_CHARS)}”` : 'my library';
  switch (mode) {
    case 'find':
      return (
        `Which of my saved documents are about ${about}? List the ones that match with a line each on ` +
        `why, best match first, and say so plainly if none of them do.`
      );
    case 'learn':
      return (
        `Teach me about ${about} using only the documents below. Explain it step by step, quote the ` +
        `passages you rely on, name the document each one comes from, and tell me what they do not cover.`
      );
    case 'research':
      return (
        `Research ${about} across the documents below. Compare what they say, point out where they ` +
        `agree and disagree, cite the document for every claim, and note what is missing.`
      );
    case 'catchup':
      return (
        `Catch me up on what I saved recently${topic ? `, with a focus on ${about}` : ''}. Give a sentence ` +
        `for each document, group them by theme, and say which are worth reading first.`
      );
    case 'recommend':
      return (
        `From the unread documents below, recommend what I should read next${topic ? ` about ${about}` : ''} ` +
        `and why, given what I have been highlighting. Put the best pick first and say how long it takes.`
      );
  }
}

function describe(document: LibraryDocumentSummary): string {
  return [
    document.siteName ?? document.byline,
    document.kind === 'article' ? undefined : document.kind.toUpperCase(),
    `${Math.max(1, document.readingMinutes)} min`,
    document.tags.length > 0 ? `tags: ${document.tags.slice(0, 8).join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function block(entry: AskEntry, index: number): string {
  const n = index + 1;
  const { document } = entry;
  const lines = [`[Document ${n}] “${clip(document.title, 200)}” (${describe(document)})`];
  if (document.summary) {
    lines.push(`My summary: ${clip(document.summary, 600)}`);
  }
  if (document.note) {
    lines.push(`My note: ${clip(document.note, 600)}`);
  }
  const cut = entry.truncated ? '\n(cut here because it is long)' : '';
  lines.push(
    entry.text ? `<<<TEXT ${n}\n${entry.text}\nTEXT ${n}>>>${cut}` : '(no preview of the text)',
  );
  return lines.join('\n') + listHighlights(entry.highlights);
}

/**
 * A conversation that opens with a handful of the person's saved documents and what they want done
 * with them. The documents were picked once, when the chat was made, so later questions are about
 * these and not about the rest of the library. Like a chat about one document, the first turn is
 * theirs and carries the third-party text behind a notice, and it goes through the app's own
 * conversation importer so content filters and size limits apply.
 */
export function convertLibraryAskToChat(
  source: AskSource,
  target: { endpoint?: string; model?: string } = {},
): HubContinueImport {
  const { mode, topic, entries } = source;
  const when = new Date().toISOString();
  const interests =
    source.recentHighlights && source.recentHighlights.length > 0
      ? `\n\nWhat I have been highlighting lately:\n${source.recentHighlights
          .map((highlight) => `- "${clip(highlight.anchor.exact, 300)}"`)
          .join('\n')}`
      : '';
  const opening =
    `${request(mode, topic)}\n\n${UNTRUSTED_NOTICE}\n\n` +
    `${entries.map((entry, index) => block(entry, index)).join('\n\n')}${interests}`;

  const root: string = Constants.NO_PARENT;
  const stamp = `library-ask-${mode}`;
  const messages: HubContinueMessage[] = [
    {
      messageId: `${stamp}-question`,
      parentMessageId: root,
      text: opening,
      sender: 'User',
      isCreatedByUser: true,
      createdAt: when,
    },
    {
      messageId: `${stamp}-ready`,
      parentMessageId: `${stamp}-question`,
      text:
        `I have ${entries.length} of your saved documents in front of me` +
        `${topic ? ` for “${clip(topic, 80)}”` : ''}. Say “go” and I will do what you asked above, ` +
        `or ask me something else about them.`,
      sender: 'MindFerry',
      isCreatedByUser: false,
      createdAt: when,
      ...(target.endpoint ? { endpoint: target.endpoint } : {}),
      ...(target.model ? { model: target.model } : {}),
    },
  ];

  return {
    conversationId: `library-ask:${mode}`,
    title: (topic ? `${modeTitle(mode)}: ${topic}` : modeTitle(mode)).slice(0, 120),
    ...(target.endpoint ? { endpoint: target.endpoint } : {}),
    ...(target.model ? { options: { model: target.model } } : {}),
    messages,
  };
}

function modeTitle(mode: AskMode): string {
  return {
    find: 'Find in my library',
    learn: 'Learn from my library',
    research: 'Research in my library',
    catchup: 'Catch up on my library',
    recommend: 'What to read next',
  }[mode];
}
