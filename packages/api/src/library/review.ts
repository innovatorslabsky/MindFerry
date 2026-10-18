import type { LibraryDocumentSummary, LibraryHighlightRecord } from '@librechat/data-schemas';

/** A browser's `getTimezoneOffset` stays within a day either way; anything else is ignored. */
const MAX_OFFSET_MINUTES = 14 * 60;

/** How many extra highlights one "review more" can add, at most. */
export const MAX_REVIEW_EXTRA = 100;

export const DEFAULT_REVIEW_PER_DAY = 5;

export interface ReviewItem {
  highlight: LibraryHighlightRecord;
  document: Pick<LibraryDocumentSummary, 'id' | 'title' | 'siteName' | 'kind'>;
}

export interface DailyReview {
  items: ReviewItem[];
  /** Highlights the person has been through since the day began. */
  reviewedToday: number;
  /** How many make up a day's review, counting any "review more". */
  goal: number;
}

export type ReviewAction = 'done' | 'mute';

/**
 * When the person's day began, in UTC. `offsetMinutes` is what the browser reports (minutes behind
 * UTC, so negative east of Greenwich); without a usable one the day is the UTC day.
 */
export function startOfDay(now: Date, offsetMinutes?: number): Date {
  const offset =
    typeof offsetMinutes === 'number' &&
    Number.isInteger(offsetMinutes) &&
    Math.abs(offsetMinutes) <= MAX_OFFSET_MINUTES
      ? offsetMinutes
      : 0;
  const local = new Date(now.getTime() - offset * 60_000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight + offset * 60_000);
}
