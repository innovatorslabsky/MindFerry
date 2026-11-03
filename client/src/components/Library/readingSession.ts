/** Seconds without the reader doing anything after which they are no longer counted as reading. */
export const IDLE_MS = 90_000;
/** Silence this long ends a session; the next activity starts a new one. */
export const SESSION_GAP_MS = 5 * 60_000;
/** One look at the clock is never worth more than this, so a throttled timer cannot add minutes at once. */
const MAX_TICK_MS = 2_000;
/** A move forward of more than this many characters is a jump (a link, the slider), not reading. */
const MAX_READ_JUMP_CHARS = 4_000;

export type SessionSample = {
  /** Where the top of the screen is in the text, in characters. */
  offset: number;
  /** The text those offsets are in. */
  text: string;
  /** Names the text, so a new chapter or page is a fresh start rather than a leap. */
  unitKey: string;
};

export type SessionReport = {
  sid: string;
  startedAt: string;
  activeSeconds: number;
  words: number;
};

function newSid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Keeps the time and words of one reading session. It is told what the reader is doing and what is on
 * screen, and says what to report. Nothing in it reads a clock or the page, so it can be driven by a test.
 */
export class SessionTracker {
  private sid = newSid();
  private startedAt = 0;
  private activeMs = 0;
  private words = 0;
  private lastTickAt = 0;
  private lastActivityAt = 0;
  private reported = '';
  /** Furthest point reached in each text this session, so reading back over a passage adds nothing. */
  private reached = new Map<string, number>();

  /** The reader did something: moved, scrolled, typed. */
  touch(now: number): void {
    if (this.startedAt !== 0 && now - this.lastActivityAt > SESSION_GAP_MS) {
      this.restart();
    }
    if (this.startedAt === 0) {
      this.startedAt = now;
      this.lastTickAt = now;
    }
    this.lastActivityAt = now;
  }

  /** A moment passes. `attending` is whether the page is in front of the reader. */
  tick(now: number, attending: boolean, sample: SessionSample | null): void {
    if (this.startedAt === 0) {
      return;
    }
    const elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    if (!attending || now - this.lastActivityAt > IDLE_MS) {
      return;
    }
    this.activeMs += Math.min(Math.max(0, elapsed), MAX_TICK_MS);
    if (sample) {
      this.read(sample);
    }
  }

  private read({ offset, text, unitKey }: SessionSample): void {
    const before = this.reached.get(unitKey);
    if (before === undefined || offset - before > MAX_READ_JUMP_CHARS) {
      this.reached.set(unitKey, Math.max(offset, before ?? 0));
      return;
    }
    if (offset > before) {
      this.words += countWords(text.slice(before, offset));
      this.reached.set(unitKey, offset);
    }
  }

  private restart(): void {
    this.sid = newSid();
    this.startedAt = 0;
    this.activeMs = 0;
    this.words = 0;
    this.reported = '';
    this.reached.clear();
  }

  /** What to tell the server now, or `null` when there is nothing new since the last time. */
  report(): SessionReport | null {
    const activeSeconds = Math.floor(this.activeMs / 1000);
    if (this.startedAt === 0 || activeSeconds === 0) {
      return null;
    }
    const key = `${activeSeconds}:${this.words}`;
    if (key === this.reported) {
      return null;
    }
    this.reported = key;
    return {
      sid: this.sid,
      startedAt: new Date(this.startedAt).toISOString(),
      activeSeconds,
      words: this.words,
    };
  }
}
