import type { TranslationKeys } from '~/hooks';

type Localize = (key: TranslationKeys, options?: Record<string, string | number>) => string;

/** "1h 05m", "12m", or "Under a minute": how long, in words a person reads at a glance. */
export function durationLabel(seconds: number, localize: Localize): string {
  const minutes = Math.round(seconds / 60);
  if (seconds > 0 && minutes === 0) {
    return localize('com_library_duration_under_minute');
  }
  if (minutes < 60) {
    return localize('com_library_duration_m', { 0: minutes });
  }
  return localize('com_library_duration_hm', {
    0: Math.floor(minutes / 60),
    1: String(minutes % 60).padStart(2, '0'),
  });
}

export function sessionCountLabel(count: number, localize: Localize): string {
  return localize(count === 1 ? 'com_library_session_count_one' : 'com_library_session_count', {
    count,
  });
}
