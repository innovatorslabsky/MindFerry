import { durationLabel, sessionCountLabel } from '../readingTime';

const localize = (key: string, options?: Record<string, string | number>) =>
  options ? `${key}:${Object.values(options).join(',')}` : key;

describe('durationLabel', () => {
  it('says under a minute for a little, minutes for less than an hour, and hours with padded minutes', () => {
    expect(durationLabel(20, localize as never)).toBe('com_library_duration_under_minute');
    expect(durationLabel(0, localize as never)).toBe('com_library_duration_m:0');
    expect(durationLabel(12 * 60, localize as never)).toBe('com_library_duration_m:12');
    expect(durationLabel(65 * 60, localize as never)).toBe('com_library_duration_hm:1,05');
    expect(durationLabel(3 * 3600 + 30 * 60, localize as never)).toBe(
      'com_library_duration_hm:3,30',
    );
  });
});

describe('sessionCountLabel', () => {
  it('uses the singular for one', () => {
    expect(sessionCountLabel(1, localize as never)).toBe('com_library_session_count_one:1');
    expect(sessionCountLabel(3, localize as never)).toBe('com_library_session_count:3');
  });
});
