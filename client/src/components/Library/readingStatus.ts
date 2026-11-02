import type { TLibraryReadingStatus } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** Written out so each label key is visible to the unused-key check. */
export const READING_STATUS_LABEL: Record<TLibraryReadingStatus, TranslationKeys> = {
  want: 'com_library_status_want',
  reading: 'com_library_status_reading',
  finished: 'com_library_status_finished',
  dropped: 'com_library_status_dropped',
};

export const READING_STATUSES: readonly TLibraryReadingStatus[] = [
  'want',
  'reading',
  'finished',
  'dropped',
];
