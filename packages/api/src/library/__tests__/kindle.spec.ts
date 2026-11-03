import { KindleFormatError, MAX_KINDLE_BOOKS, parseKindleClippings } from '../import/kindle';

const SEP = '==========';
const entry = (title: string, meta: string, text: string) =>
  `${title}\r\n- ${meta}\r\n\r\n${text}\r\n${SEP}\r\n`;
const FILE = (...entries: string[]) => `\uFEFF${entries.join('')}`;

describe('parseKindleClippings', () => {
  it('reads books and their highlights, with the author turned the right way round', () => {
    const { books, skipped } = parseKindleClippings(
      FILE(
        entry(
          'Dune (Herbert, Frank)',
          'Your Highlight on page 12 | location 180-181 | Added on Monday, 3 March 2025 10:15:20',
          'I must not fear.',
        ),
        entry(
          'Dune (Herbert, Frank)',
          'Your Highlight on page 40 | location 600-601 | Added on Monday, 3 March 2025 10:20:20',
          'Fear is the mind-killer.',
        ),
        entry(
          'Piranesi (Susanna Clarke)',
          'Your Highlight at location 50-51 | Added on x',
          'The Beauty is immeasurable.',
        ),
      ),
    );
    expect(skipped).toBe(0);
    expect(books).toEqual([
      {
        title: 'Dune',
        author: 'Frank Herbert',
        highlights: [{ text: 'I must not fear.' }, { text: 'Fear is the mind-killer.' }],
      },
      {
        title: 'Piranesi',
        author: 'Susanna Clarke',
        highlights: [{ text: 'The Beauty is immeasurable.' }],
      },
    ]);
  });

  it('attaches a note to the highlight at its location, or else to the one before it', () => {
    const { books } = parseKindleClippings(
      FILE(
        entry(
          'B (A)',
          'Your Highlight on page 1 | location 100-110 | Added on x',
          'First passage.',
        ),
        entry(
          'B (A)',
          'Your Highlight on page 2 | location 200-210 | Added on x',
          'Second passage.',
        ),
        entry('B (A)', 'Your Note on page 1 | location 105 | Added on x', 'About the first.'),
        entry(
          'B (A)',
          'Your Note on page 9 | location 999 | Added on x',
          'Where no location matches.',
        ),
      ),
    );
    expect(books[0].highlights).toEqual([
      { text: 'First passage.', note: 'About the first.' },
      { text: 'Second passage.', note: 'Where no location matches.' },
    ]);
  });

  it('leaves out bookmarks, which have no text, and counts them as skipped', () => {
    const { books, skipped } = parseKindleClippings(
      FILE(
        entry('B (A)', 'Your Bookmark on page 5 | Location 70 | Added on x', ''),
        entry('B (A)', 'Your Highlight on page 6 | location 80-81 | Added on x', 'Kept.'),
      ),
    );
    expect(books[0].highlights).toEqual([{ text: 'Kept.' }]);
    expect(skipped).toBe(1);
  });

  it('keeps an extended highlight once, as the longer one, and an exact repeat once', () => {
    const { books, skipped } = parseKindleClippings(
      FILE(
        entry('B (A)', 'Your Highlight at location 10-11 | Added on x', 'The quick brown fox'),
        entry(
          'B (A)',
          'Your Highlight at location 10-14 | Added on x',
          'The quick brown fox jumps over the dog.',
        ),
        entry('B (A)', 'Your Highlight at location 30-31 | Added on x', 'Something else.'),
        entry('B (A)', 'Your Highlight at location 30-31 | Added on x', 'Something else.'),
      ),
    );
    expect(books[0].highlights.map((h) => h.text)).toEqual([
      'The quick brown fox jumps over the dog.',
      'Something else.',
    ]);
    expect(skipped).toBe(2);
  });

  it('reads entries of another language by their shape: a title, a dash line, and the text', () => {
    const { books } = parseKindleClippings(
      FILE(
        entry(
          '本の題名 (山田太郎)',
          'あなたのハイライト 位置No. 100-101 | 追加日: 2025年3月3日',
          '大切な一文。',
        ),
        entry(
          '本の題名 (山田太郎)',
          'あなたのメモ 位置No. 100 | 追加日: 2025年3月3日',
          'これは私のメモ',
        ),
      ),
    );
    expect(books[0]).toMatchObject({
      title: '本の題名',
      author: '山田太郎',
      highlights: [{ text: '大切な一文。', note: 'これは私のメモ' }],
    });
  });

  it('keeps a book with no author, and a title that has parentheses of its own', () => {
    const { books } = parseKindleClippings(
      FILE(
        entry('A Book With No Author', 'Your Highlight at location 1-2 | Added on x', 'Text one.'),
        entry(
          'Title (Second Edition) (Jane Doe)',
          'Your Highlight at location 1-2 | Added on x',
          'Text two.',
        ),
      ),
    );
    expect(books[0]).toMatchObject({ title: 'A Book With No Author' });
    expect(books[0].author).toBeUndefined();
    expect(books[1]).toMatchObject({ title: 'Title (Second Edition)', author: 'Jane Doe' });
  });

  it('keeps multi-line highlights, skips one that is huge, and stops at the limit of books', () => {
    const { books, skipped } = parseKindleClippings(
      FILE(
        entry('B (A)', 'Your Highlight at location 1-2 | Added on x', 'Line one\r\nline two'),
        entry('B (A)', 'Your Highlight at location 3-4 | Added on x', 'x'.repeat(10_001)),
      ),
    );
    expect(books[0].highlights).toEqual([{ text: 'Line one\nline two' }]);
    expect(skipped).toBe(1);

    const many = FILE(
      ...Array.from({ length: MAX_KINDLE_BOOKS + 2 }, (_, i) =>
        entry(`Book ${i} (A)`, 'Your Highlight at location 1-2 | Added on x', `Text ${i}.`),
      ),
    );
    const capped = parseKindleClippings(many);
    expect(capped.books).toHaveLength(MAX_KINDLE_BOOKS);
    expect(capped.skipped).toBe(2);
  });

  it('refuses a file with no highlights in it', () => {
    expect(() => parseKindleClippings('just some text\nwith lines')).toThrow(KindleFormatError);
    expect(() => parseKindleClippings('')).toThrow(KindleFormatError);
    expect(() =>
      parseKindleClippings(FILE(entry('B (A)', 'Your Bookmark | Location 1 | Added on x', ''))),
    ).toThrow(KindleFormatError);
  });
});
