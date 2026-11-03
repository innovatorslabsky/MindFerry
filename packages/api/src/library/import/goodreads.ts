import type { LibraryManualBookInput } from '@librechat/data-schemas';

/** Largest export read in one go; an account's worth of books is far below it. */
export const MAX_GOODREADS_BOOKS = 5000;

export class GoodreadsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoodreadsFormatError';
  }
}

export interface GoodreadsImport {
  books: LibraryManualBookInput[];
  /** Rows with no title, or past the limit. */
  skipped: number;
}

/** Reads CSV as Goodreads writes it: quoted fields with commas, doubled quotes and line breaks inside. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    endRow();
  }
  return rows;
}

const NOT_FINISHED = /\b(dnf|did[-_ ]?not[-_ ]?finish|abandon(ed)?|stopped|gave[-_ ]?up)\b/i;

function statusOf(shelf: string): LibraryManualBookInput['readingStatus'] {
  const name = shelf.trim().toLowerCase();
  if (name === 'read') return 'finished';
  if (name === 'currently-reading') return 'reading';
  if (name === 'to-read') return 'want';
  return NOT_FINISHED.test(name) ? 'dropped' : undefined;
}

/** `2021/05/03` as that day in UTC, or nothing for a date that is not one. */
function dateOf(value: string): Date | undefined {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

function whole(value: string, min: number, max: number): number | undefined {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

/** Where a book is put away: finished and set aside books out of the inbox, books to read later. */
export function locationFor(
  status: LibraryManualBookInput['readingStatus'],
): NonNullable<LibraryManualBookInput['location']> {
  if (status === 'finished' || status === 'dropped') return 'archive';
  return status === 'want' ? 'later' : 'inbox';
}

/** The books in a Goodreads library export (My Books → Import and export → Export Library). */
export function parseGoodreadsCsv(text: string): GoodreadsImport {
  const rows = parseCsv(text);
  const header = rows[0]?.map((name) => name.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const title = col('title');
  if (title === -1) {
    throw new GoodreadsFormatError('Not a Goodreads library export: there is no Title column');
  }
  const cell = (row: string[], name: string) => {
    const index = col(name);
    return index === -1 ? '' : (row[index] ?? '').trim();
  };

  const books: LibraryManualBookInput[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const name = (row[title] ?? '').trim();
    if (!name || books.length >= MAX_GOODREADS_BOOKS) {
      skipped++;
      continue;
    }
    const shelf = cell(row, 'exclusive shelf');
    const readingStatus = statusOf(shelf);
    const author = cell(row, 'author');
    const id = cell(row, 'book id');
    const finishedAt =
      readingStatus === 'finished'
        ? (dateOf(cell(row, 'date read')) ?? dateOf(cell(row, 'date added')))
        : undefined;
    const rating = whole(cell(row, 'my rating'), 1, 5);
    const pages = whole(cell(row, 'number of pages'), 1, 20_000);
    const shelves = new Set<string>(['goodreads']);
    for (const raw of cell(row, 'bookshelves').split(',')) {
      const tag = raw.trim().toLowerCase();
      if (tag && tag !== shelf.toLowerCase() && tag.length <= 64) shelves.add(tag);
    }
    books.push({
      externalId: /^\d+$/.test(id)
        ? `goodreads:${id}`
        : `goodreads:${name.toLowerCase()}|${author.toLowerCase()}`,
      title: name.slice(0, 300),
      ...(author ? { byline: author.slice(0, 200) } : {}),
      ...(pages ? { pages } : {}),
      ...(readingStatus ? { readingStatus } : {}),
      ...(rating ? { rating } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      tags: [...shelves].slice(0, 20),
      location: locationFor(readingStatus),
    });
  }
  return { books, skipped };
}
