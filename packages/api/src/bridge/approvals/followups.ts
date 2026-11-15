/**
 * Reads the follow-up tasks an agent suggests at the end of its result. The format is strict on
 * purpose: one optional section, a few one-line items, and anything else is plain text that makes
 * nothing. An item is only a suggestion; nothing runs until a person approves it.
 *
 *   ## Proposed follow-ups
 *   - role: seo-strategist-petvee | task: Draft the Google Play short description.
 */

export const MAX_FOLLOW_UPS = 5;

export interface FollowUpItem {
  /** Position among the items found, from 0. Part of the proposal's dedupe key. */
  index: number;
  role: string;
  task: string;
}

export interface FollowUps {
  items: FollowUpItem[];
  /** Lines inside the section that are not an item. They are ignored. */
  malformed: number;
  /** Items past the limit. They are ignored. */
  overflow: number;
}

const HEADING = /^\s{0,3}#{1,6}\s*proposed follow-ups\s*:?\s*$/i;
const ANY_HEADING = /^\s{0,3}#{1,6}\s/;
const ITEM = /^\s*(?:[-*]|\d{1,2}[.)])\s*role:\s*([a-z0-9][a-z0-9-]{0,79})\s*\|\s*task:\s*(\S.*)$/i;

export function parseFollowUps(text: string, max: number = MAX_FOLLOW_UPS): FollowUps {
  const lines = text.normalize('NFC').split('\n');
  const start = lines.findIndex((line) => HEADING.test(line));
  const found: FollowUps = { items: [], malformed: 0, overflow: 0 };
  if (start === -1) {
    return found;
  }
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (ANY_HEADING.test(line)) {
      break;
    }
    if (line.trim().length === 0) {
      continue;
    }
    const match = ITEM.exec(line);
    if (!match) {
      found.malformed += 1;
      continue;
    }
    if (found.items.length >= max) {
      found.overflow += 1;
      continue;
    }
    found.items.push({
      index: found.items.length,
      role: match[1].toLowerCase(),
      task: match[2].replace(/\s+/g, ' ').trim(),
    });
  }
  return found;
}
