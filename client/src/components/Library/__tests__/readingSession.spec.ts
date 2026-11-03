import { IDLE_MS, SESSION_GAP_MS, SessionTracker } from '../readingSession';

const TEXT = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
const sample = (offset: number, unitKey = 'a') => ({ offset, text: TEXT, unitKey });
const T0 = 1_700_000_000_000;

/** Reads for `seconds`, one look a second, scrolling a little each time. */
function readFor(
  tracker: SessionTracker,
  from: number,
  seconds: number,
  startOffset = 0,
  step = 60,
) {
  let offset = startOffset;
  for (let i = 1; i <= seconds; i++) {
    tracker.touch(from + i * 1000);
    offset += step;
    tracker.tick(from + i * 1000, true, sample(offset));
  }
  return offset;
}

describe('SessionTracker', () => {
  it('has nothing to report until the reader does something, and then only what is new', () => {
    const tracker = new SessionTracker();
    tracker.tick(T0, true, sample(0));
    expect(tracker.report()).toBeNull();

    tracker.touch(T0);
    readFor(tracker, T0, 10);
    const first = tracker.report();
    expect(first).toMatchObject({ activeSeconds: 10 });
    expect(first?.sid).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(first?.startedAt).toBe(new Date(T0).toISOString());
    expect(tracker.report()).toBeNull();

    readFor(tracker, T0 + 10_000, 5);
    expect(tracker.report()).toMatchObject({ sid: first?.sid, activeSeconds: 15 });
  });

  it('counts words only for text that went by, not for a jump or for reading back over it', () => {
    const tracker = new SessionTracker();
    tracker.touch(T0);
    tracker.tick(T0 + 1000, true, sample(0));
    // 300 characters of "wordN " is about 40 words.
    tracker.touch(T0 + 2000);
    tracker.tick(T0 + 2000, true, sample(300));
    const afterScroll = tracker.report()!.words;
    expect(afterScroll).toBeGreaterThan(30);
    expect(afterScroll).toBeLessThan(60);

    // Back up and down over the same stretch: nothing new.
    tracker.tick(T0 + 3000, true, sample(100));
    tracker.tick(T0 + 4000, true, sample(300));
    expect(tracker.report()?.words ?? afterScroll).toBe(afterScroll);

    // A leap of thousands of characters is a jump, not reading.
    tracker.tick(T0 + 5000, true, sample(9000));
    expect(tracker.report()?.words ?? afterScroll).toBe(afterScroll);
  });

  it('keeps each chapter or page apart', () => {
    const tracker = new SessionTracker();
    tracker.touch(T0);
    tracker.tick(T0 + 1000, true, sample(0, 'one'));
    tracker.tick(T0 + 2000, true, sample(300, 'one'));
    const one = tracker.report()!.words;
    // The first look at another chapter only marks where it starts.
    tracker.tick(T0 + 3000, true, sample(5000, 'two'));
    expect(tracker.report()?.words ?? one).toBe(one);
    tracker.tick(T0 + 4000, true, sample(5300, 'two'));
    expect(tracker.report()!.words).toBeGreaterThan(one);
  });

  it('stops counting while the page is not in front of the reader, or the reader has gone quiet', () => {
    const tracker = new SessionTracker();
    tracker.touch(T0);
    for (let i = 1; i <= 5; i++) tracker.tick(T0 + i * 1000, true, sample(0));
    expect(tracker.report()?.activeSeconds).toBe(5);

    // The tab is hidden for a while: no time is added.
    for (let i = 6; i <= 60; i++) tracker.tick(T0 + i * 1000, false, sample(0));
    expect(tracker.report()).toBeNull();

    // Back and then silent past the idle limit: time stops where the reader stopped.
    for (let i = 61; i <= 60 + IDLE_MS / 1000 + 30; i++)
      tracker.tick(T0 + i * 1000, true, sample(0));
    const report = tracker.report();
    expect(report!.activeSeconds).toBeLessThanOrEqual(5 + IDLE_MS / 1000);
  });

  it('never lets one slow timer add minutes at once', () => {
    const tracker = new SessionTracker();
    tracker.touch(T0);
    tracker.tick(T0 + 60_000, true, sample(0));
    expect(tracker.report()?.activeSeconds).toBe(2);
  });

  it('starts a new session after a long silence', () => {
    const tracker = new SessionTracker();
    tracker.touch(T0);
    readFor(tracker, T0, 5);
    const first = tracker.report()!;

    const later = T0 + SESSION_GAP_MS + 60_000;
    tracker.touch(later);
    readFor(tracker, later, 3);
    const second = tracker.report()!;
    expect(second.sid).not.toBe(first.sid);
    expect(second.activeSeconds).toBe(3);
    expect(second.startedAt).toBe(new Date(later).toISOString());
  });
});
