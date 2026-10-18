import { createHash, randomBytes } from 'node:crypto';

/** A newsletter, as read from whatever an email service posted. */
export interface InboundEmail {
  /** The sender as written: `Name <address>` or an address. */
  from: string;
  fromName?: string;
  fromAddress?: string;
  subject: string;
  html?: string;
  text?: string;
  /** What identifies the message, so a retried delivery saves the same document. */
  messageId?: string;
  date?: string;
}

/** The most HTML or text taken from one message; the rest is dropped before anything reads it. */
export const MAX_EMAIL_HTML_CHARS = 2_000_000;
export const MAX_EMAIL_TEXT_CHARS = 500_000;

/** Long enough that it cannot be guessed: 192 random bits. */
const TOKEN_BYTES = 24;

export function generateInboxToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashInboxToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** What a real token looks like, so a request with anything else is turned away before a lookup. */
export function isInboxToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}

/** The first of these keys that holds a non-empty string, matching names regardless of case. */
function pick(body: Record<string, unknown>, keys: readonly string[]): string | undefined {
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(body)) {
    lower.set(key.toLowerCase(), value);
  }
  for (const key of keys) {
    const value = lower.get(key.toLowerCase());
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/** `"Ada L." <ada@example.com>`, `Ada <ada@example.com>` or `ada@example.com` into name and address. */
export function parseSender(from: string): { name?: string; address?: string } {
  const bracketed = from.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (bracketed) {
    const name = bracketed[1].trim();
    return { ...(name ? { name } : {}), address: bracketed[2] };
  }
  const bare = from.trim().match(/^[^<>\s]+@[^<>\s]+$/);
  return bare ? { address: bare[0] } : { name: from.trim().slice(0, 200) };
}

/**
 * Reads the message out of what an email service posted. Accepts the plain shape (`from`, `subject`,
 * `html`, `text`, `messageId`, `date`) and the names Postmark (`From`, `HtmlBody`, `TextBody`,
 * `MessageID`) and Mailgun (`sender`, `body-html`, `body-plain`, `Message-Id`) use. Nothing is
 * returned for a message with neither HTML nor text.
 */
export function parseInboundEmail(body: unknown): InboundEmail | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const fields = body as Record<string, unknown>;
  const html = pick(fields, ['html', 'HtmlBody', 'body-html'])?.slice(0, MAX_EMAIL_HTML_CHARS);
  const text = pick(fields, ['text', 'TextBody', 'body-plain'])?.slice(0, MAX_EMAIL_TEXT_CHARS);
  if (html === undefined && text === undefined) {
    return null;
  }
  const from = (pick(fields, ['from', 'From', 'sender']) ?? '').slice(0, 500);
  const sender = parseSender(from);
  return {
    from,
    ...(sender.name ? { fromName: sender.name } : {}),
    ...(sender.address ? { fromAddress: sender.address } : {}),
    subject: (pick(fields, ['subject']) ?? '').trim().slice(0, 300),
    ...(html === undefined ? {} : { html }),
    ...(text === undefined ? {} : { text }),
    ...(pick(fields, ['messageId', 'MessageID', 'Message-Id'])
      ? { messageId: pick(fields, ['messageId', 'MessageID', 'Message-Id'])!.slice(0, 500) }
      : {}),
    ...(pick(fields, ['date']) ? { date: pick(fields, ['date'])!.slice(0, 100) } : {}),
  };
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** A plain-text message as HTML the reader can show: paragraphs, with nothing in it taken as markup. */
export function textToHtml(subject: string, text: string): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ESCAPES[char]);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escape(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<article><h1>${escape(subject || 'Newsletter')}</h1>${paragraphs}</article>`;
}

/** The identity of a message for the library: the same message delivered twice is one document. */
export function emailKey(email: InboundEmail): string {
  const basis = email.messageId ?? `${email.from}|${email.subject}|${email.date ?? ''}`;
  return createHash('sha256').update(basis).digest('hex');
}
