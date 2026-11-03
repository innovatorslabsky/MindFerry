import {
  GoodreadsFormatError,
  MAX_GOODREADS_BOOKS,
  locationFor,
  parseCsv,
  parseGoodreadsCsv,
} from '../import/goodreads';

const HEADER =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';

const row = (fields: Record<string, string>) => {
  const names = HEADER.split(',');
  return names
    .map((name) => (fields[name] ?? '').replace(/"/g, '""'))
    .map((f) => `"${f}"`)
    .join(',');
};

describe('parseCsv', () => {
  it('reads commas, doubled quotes and line breaks inside quotes, CRLF, a BOM and a missing last newline', () => {
    const text = '\uFEFFa,b,c\r\n"x, y","say ""hi""","line\nbreak"\r\n1,2,3';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps an empty field and drops a blank line', () => {
    expect(parseCsv('a,,c\n\nd,e,f\n')).toEqual([
      ['a', '', 'c'],
      ['d', 'e', 'f'],
    ]);
  });
});

describe('parseGoodreadsCsv', () => {
  it('turns a finished book into a finished one with its stars, pages, date, author and shelves', () => {
    const csv = [
      HEADER,
      row({
        'Book Id': '123',
        Title: 'Dune, Book One',
        Author: 'Frank Herbert',
        'My Rating': '5',
        'Number of Pages': '412',
        'Date Read': '2021/05/03',
        'Date Added': '2020/01/01',
        Bookshelves: 'sci-fi, favourites, read',
        'Exclusive Shelf': 'read',
      }),
    ].join('\n');
    const { books, skipped } = parseGoodreadsCsv(csv);
    expect(skipped).toBe(0);
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      externalId: 'goodreads:123',
      title: 'Dune, Book One',
      byline: 'Frank Herbert',
      pages: 412,
      readingStatus: 'finished',
      rating: 5,
      location: 'archive',
    });
    expect(books[0].finishedAt?.toISOString()).toBe('2021-05-03T00:00:00.000Z');
    expect(books[0].tags).toEqual(['goodreads', 'sci-fi', 'favourites']);
  });

  it('maps the other shelves, falls back to the date added, and leaves a zero rating off', () => {
    const csv = [
      HEADER,
      row({ 'Book Id': '1', Title: 'A', 'Exclusive Shelf': 'to-read', 'My Rating': '0' }),
      row({ 'Book Id': '2', Title: 'B', 'Exclusive Shelf': 'currently-reading' }),
      row({ 'Book Id': '3', Title: 'C', 'Exclusive Shelf': 'did-not-finish' }),
      row({ 'Book Id': '4', Title: 'D', 'Exclusive Shelf': 'owned' }),
      row({ 'Book Id': '5', Title: 'E', 'Exclusive Shelf': 'read', 'Date Added': '2019/12/31' }),
    ].join('\n');
    const { books } = parseGoodreadsCsv(csv);
    expect(books.map((b) => [b.title, b.readingStatus, b.location, b.rating])).toEqual([
      ['A', 'want', 'later', undefined],
      ['B', 'reading', 'inbox', undefined],
      ['C', 'dropped', 'archive', undefined],
      ['D', undefined, 'inbox', undefined],
      ['E', 'finished', 'archive', undefined],
    ]);
    expect(books[4].finishedAt?.toISOString()).toBe('2019-12-31T00:00:00.000Z');
  });

  it('ignores a date that is not one, pages that make no sense, and stars out of range', () => {
    const csv = [
      HEADER,
      row({
        'Book Id': '1',
        Title: 'A',
        'Exclusive Shelf': 'read',
        'Date Read': '2021/02/31',
        'Number of Pages': '-5',
        'My Rating': '9',
      }),
    ].join('\n');
    const [book] = parseGoodreadsCsv(csv).books;
    expect(book.finishedAt).toBeUndefined();
    expect(book.pages).toBeUndefined();
    expect(book.rating).toBeUndefined();
  });

  it('names a book without an id by its title and author, so it still imports once', () => {
    const csv = [
      HEADER,
      row({ Title: 'No Id', Author: 'Someone', 'Exclusive Shelf': 'read' }),
    ].join('\n');
    expect(parseGoodreadsCsv(csv).books[0].externalId).toBe('goodreads:no id|someone');
  });

  it('skips a row with no title, cuts long text, and stops at the limit', () => {
    const csv = [
      HEADER,
      row({ 'Book Id': '1', Title: '', 'Exclusive Shelf': 'read' }),
      row({
        'Book Id': '2',
        Title: 'x'.repeat(500),
        Author: 'y'.repeat(500),
        'Exclusive Shelf': 'read',
      }),
    ].join('\n');
    const result = parseGoodreadsCsv(csv);
    expect(result.skipped).toBe(1);
    expect(result.books[0].title).toHaveLength(300);
    expect(result.books[0].byline).toHaveLength(200);

    const many = [
      HEADER,
      ...Array.from({ length: MAX_GOODREADS_BOOKS + 3 }, (_, i) =>
        row({ 'Book Id': String(i), Title: `B${i}`, 'Exclusive Shelf': 'read' }),
      ),
    ].join('\n');
    const capped = parseGoodreadsCsv(many);
    expect(capped.books).toHaveLength(MAX_GOODREADS_BOOKS);
    expect(capped.skipped).toBe(3);
  });

  it('refuses a file that is not a Goodreads export', () => {
    expect(() => parseGoodreadsCsv('name,email\nA,a@example.com')).toThrow(GoodreadsFormatError);
    expect(() => parseGoodreadsCsv('')).toThrow(GoodreadsFormatError);
  });
});

describe('locationFor', () => {
  it('keeps what is done and what is for later out of the inbox', () => {
    expect(locationFor('finished')).toBe('archive');
    expect(locationFor('dropped')).toBe('archive');
    expect(locationFor('want')).toBe('later');
    expect(locationFor('reading')).toBe('inbox');
    expect(locationFor(undefined)).toBe('inbox');
  });
});
