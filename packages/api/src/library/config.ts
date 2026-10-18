import type { AppConfig } from '@librechat/data-schemas';
import type { LibraryIsolationConfig } from './worker';
import { DEFAULT_REVIEW_PER_DAY } from './review';
import { DEFAULT_CHAT_MAX_CHARS } from './chat';

const ISOLATION_DEFAULTS: LibraryIsolationConfig = {
  mode: 'process',
  maxConcurrent: 2,
  maxQueue: 16,
  timeoutMs: 60_000,
  memoryMb: 768,
};

/** The isolation settings in force: the operator's, with anything unset filled in safe defaults. */
export function getLibraryIsolation(config: AppConfig | undefined): LibraryIsolationConfig {
  return { ...ISOLATION_DEFAULTS, ...config?.contextHub?.library?.isolation };
}

/** New documents are tagged with their site and keywords unless the operator turns it off. */
export function getLibraryAutoTag(config: AppConfig | undefined): boolean {
  return config?.contextHub?.library?.autoTag !== false;
}

/** How many highlights the daily review shows in a day (`contextHub.library.reviewPerDay`). */
export function getLibraryReviewPerDay(config: AppConfig | undefined): number {
  return config?.contextHub?.library?.reviewPerDay ?? DEFAULT_REVIEW_PER_DAY;
}

/** How much text "Ask about this" shows the model (`contextHub.library.chatMaxChars`). */
export function getLibraryChatMaxChars(config: AppConfig | undefined): number {
  return config?.contextHub?.library?.chatMaxChars ?? DEFAULT_CHAT_MAX_CHARS;
}

/**
 * Whether an uploaded PDF's original file is kept so its pages can be shown as the page itself.
 * Off by default: it multiplies what is stored per user, and keeps a copy of the file, not only text.
 */
export function getLibraryKeepPdfOriginals(config: AppConfig | undefined): boolean {
  return config?.contextHub?.library?.keepPdfOriginals === true;
}

/**
 * The reading library is opt-in per deployment (`contextHub.library.enabled`). It fetches URLs on
 * behalf of users and stores third-party content, so an operator turns it on deliberately.
 */
export function isLibraryEnabled(config: AppConfig | undefined): boolean {
  return config?.contextHub?.library?.enabled === true;
}
