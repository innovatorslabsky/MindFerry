import type { TranslationKeys } from '~/hooks';

/** The `error.code` the library API puts in its JSON error body, if the failure came from it. */
export function libraryErrorCode(error: unknown): string | undefined {
  const code = (error as { response?: { data?: { error?: { code?: unknown } } } } | null)?.response
    ?.data?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

const MESSAGES: Record<string, TranslationKeys> = {
  unsafe_url: 'com_library_error_unsafe_url',
  not_readable: 'com_library_error_not_readable',
  too_large: 'com_library_error_too_large',
  busy: 'com_library_error_busy',
  timeout: 'com_library_error_timeout',
  unreadable_file: 'com_library_error_unreadable_file',
  encrypted: 'com_library_error_encrypted',
  drm: 'com_library_error_drm',
  unsupported_file: 'com_library_error_unsupported_file',
  unavailable: 'com_library_error_unavailable',
  not_a_feed: 'com_library_error_not_a_feed',
  fetch_failed: 'com_library_error_fetch_failed',
  has_text: 'com_library_error_has_text',
  empty_text: 'com_library_error_empty_text',
  folder_exists: 'com_library_error_folder_exists',
  folder_limit: 'com_library_error_folder_limit',
  feed_limit: 'com_library_error_feed_limit',
  view_exists: 'com_library_error_view_exists',
  view_limit: 'com_library_error_view_limit',
  stale_content: 'com_library_error_stale',
  anchor_mismatch: 'com_library_error_mismatch',
  no_matches: 'com_library_ask_library_no_matches',
  empty_library: 'com_library_ask_library_empty',
  empty_document: 'com_library_ask_empty',
};

/** A message the person can act on for a failed save, upload or highlight. */
export function libraryErrorKey(error: unknown, fallback: TranslationKeys): TranslationKeys {
  const code = libraryErrorCode(error);
  return (code && MESSAGES[code]) || fallback;
}
