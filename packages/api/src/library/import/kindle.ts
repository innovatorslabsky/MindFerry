export class KindleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KindleFormatError';
  }
}

export interface KindleHighlight {
  text: string;
  note?: string;
}

export interface KindleBook {
  title: string;
  author?: string;
  highlights: KindleHighlight[];
}

export interface KindleImport {
  books: KindleBook[];
  /** Entries with nothing to keep (bookmarks, empty ones, oversized ones) or past the limits. */
  skipped: number;
}

export const MAX_KINDLE_BOOKS = 200;
export const MAX_KINDLE_HIGHLIGHTS_PER_BOOK = 3000;
const MAX_HIGHLIGHT_CHARS = 10_000;

/** Words for "note" in the languages a Kindle writes its clippings in; anything else is read as a highlight. */
const NOTE = /\b(note|nota|notiz|notitie|заметка|ghi chú)\b|メモ|ノート|笔记|筆記|메모/i;
const LOCATION_SEGMENT =
  /\b(location|loc\.?|posición|ubicación|emplacement|posizione|posição|posiçao|standort|locatie)\b|位置|場所|местоположение|vị trí|위치/i;

/** "Dune (Herbert, Frank)" is the book Dune by Frank Herbert; Kindle writes some authors last name first. */
function splitTitle(line: string): { title: string; author?: string } {
  const trimmed = line.replace(/^\uFEFF/, '').trim();
  const match = /^(.*)\s\(([^()]*)\)\s*$/.exec(trimmed);
  if (!match) {
    return { title: trimmed };
  }
  const title = match[1].trim();
  let author = match[2].trim();
  const parts = author.split(',').map((part) => part.trim());
  if (!author.includes(';') && parts.length === 2 && parts[0] && parts[1]) {
    author = `${parts[1]} ${parts[0]}`;
  }
  return title ? { title, ...(author ? { author } : {}) } : { title: trimmed };
}

/** Where in the book an entry is, as a range of Kindle locations, when it says so. */
function locationOf(meta: string): { from: number; to: number } | undefined {
  const segment = meta.split('|').find((part) => LOCATION_SEGMENT.test(part));
  const numbers = segment?.match(/(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (!numbers) {
    return undefined;
  }
  const from = Number(numbers[1]);
  return { from, to: numbers[2] ? Number(numbers[2]) : from };
}

type Entry = {
  key: string;
  title: string;
  author?: string;
  kind: 'highlight' | 'note';
  text: string;
  location?: { from: number; to: number };
};

function entryOf(block: string): Entry | 'skip' | null {
  const lines = block
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\uFEFF/, ''));
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) {
    return null;
  }
  const metaAt = lines.findIndex((line, i) => i > first && line.trim().startsWith('-'));
  if (metaAt === -1) {
    return 'skip';
  }
  const { title, author } = splitTitle(lines[first]);
  const text = lines
    .slice(metaAt + 1)
    .join('\n')
    .trim();
  if (!title || text === '' || text.length > MAX_HIGHLIGHT_CHARS) {
    return 'skip';
  }
  const meta = lines[metaAt];
  return {
    key: `${title.toLowerCase()}|${(author ?? '').toLowerCase()}`,
    title,
    ...(author ? { author } : {}),
    kind: NOTE.test(meta.split('|')[0]) ? 'note' : 'highlight',
    text,
    location: locationOf(meta),
  };
}

/** The index of the highlight a note belongs to: the latest one whose locations include the note's. */
function noteTarget(located: Entry[], at: { from: number; to: number } | undefined): number {
  if (at) {
    for (let i = located.length - 1; i >= 0; i--) {
      const range = located[i].location;
      if (range && at.from >= range.from && at.from <= range.to) {
        return i;
      }
    }
  }
  return located.length - 1;
}

/**
 * The books and highlights in a Kindle `My Clippings.txt`. Bookmarks (which have no text) are left out, a
 * note goes with the highlight at its location (or the one before it), and a highlight that was extended
 * later, so that both the short and the long one were kept by the Kindle, is kept once, as the long one.
 */
export function parseKindleClippings(input: string): KindleImport {
  const blocks = input.split(/^={5,}\s*$/m);
  const books = new Map<string, { book: KindleBook; located: Entry[] }>();
  let skipped = 0;
  let recognised = 0;
  for (const block of blocks) {
    const entry = entryOf(block);
    if (entry === null) {
      continue;
    }
    if (entry === 'skip') {
      skipped++;
      continue;
    }
    recognised++;
    let held = books.get(entry.key);
    if (!held) {
      if (books.size >= MAX_KINDLE_BOOKS) {
        skipped++;
        continue;
      }
      held = {
        book: {
          title: entry.title,
          ...(entry.author ? { author: entry.author } : {}),
          highlights: [],
        },
        located: [],
      };
      books.set(entry.key, held);
    }
    const { book, located } = held;
    if (entry.kind === 'note') {
      // The highlight the note was written on: the one at its location, or else the one before it.
      const index = noteTarget(located, entry.location);
      if (index === -1) {
        skipped++;
      } else {
        const existing = book.highlights[index];
        book.highlights[index] = {
          ...existing,
          note: existing.note ? `${existing.note}\n${entry.text}` : entry.text,
        };
      }
      continue;
    }
    if (book.highlights.length >= MAX_KINDLE_HIGHLIGHTS_PER_BOOK) {
      skipped++;
      continue;
    }
    book.highlights.push({ text: entry.text });
    located.push(entry);
  }
  if (recognised === 0) {
    throw new KindleFormatError('Not a Kindle clippings file: no highlights were found');
  }
  const result: KindleBook[] = [];
  for (const { book } of books.values()) {
    const kept = book.highlights.filter(
      (candidate, i) =>
        !book.highlights.some(
          (other, j) =>
            j !== i &&
            (other.text.length > candidate.text.length ||
              (other.text === candidate.text && j < i)) &&
            other.text.includes(candidate.text),
        ),
    );
    skipped += book.highlights.length - kept.length;
    if (kept.length > 0) {
      result.push({ ...book, highlights: kept });
    }
  }
  return { books: result, skipped };
}
