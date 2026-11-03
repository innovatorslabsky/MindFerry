import { MAX_SENTENCE_CHARS, sentenceAt, splitSentences } from '../sentences';

const texts = (text: string) => splitSentences(text, 'en').map((s) => text.slice(s.start, s.end));

describe('splitSentences', () => {
  it('cuts a text into its sentences as ranges of it, without the white space around them', () => {
    const text = 'First one.  Second one? Third!\n\nFourth, with a comma.';
    expect(texts(text)).toEqual(['First one.', 'Second one?', 'Third!', 'Fourth, with a comma.']);
    for (const range of splitSentences(text, 'en')) {
      expect(text[range.start]).not.toMatch(/\s/);
      expect(text[range.end - 1]).not.toMatch(/\s/);
    }
  });

  it('leaves out a stretch with no word in it, such as a rule or a bare number mark', () => {
    expect(texts('Hello there.\n\n* * *\n\nAfter the break.')).toEqual([
      'Hello there.',
      'After the break.',
    ]);
  });

  it('splits a very long sentence at a space, so no piece is longer than the limit', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ') + '.';
    const pieces = texts(long);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    }
    expect(pieces.join(' ')).toBe(long);
  });

  it('gives nothing for an empty text, and keeps text without a full stop whole', () => {
    expect(splitSentences('', 'en')).toEqual([]);
    expect(texts('   \n  ')).toEqual([]);
    expect(texts('No full stop here')).toEqual(['No full stop here']);
  });

  it('reads sentences of other scripts, too', () => {
    expect(texts('Xin chào các bạn. Hôm nay trời đẹp!')).toEqual([
      'Xin chào các bạn.',
      'Hôm nay trời đẹp!',
    ]);
    expect(texts('今日は晴れです。明日は雨です。')).toHaveLength(2);
  });
});

describe('sentenceAt', () => {
  const sentences = [
    { start: 0, end: 10 },
    { start: 12, end: 30 },
    { start: 32, end: 50 },
  ];
  it('finds the sentence a position is in, or the next one when it is between two', () => {
    expect(sentenceAt(sentences, 0)).toBe(0);
    expect(sentenceAt(sentences, 9)).toBe(0);
    expect(sentenceAt(sentences, 11)).toBe(1);
    expect(sentenceAt(sentences, 40)).toBe(2);
  });
  it('is the last sentence for a position past the end, and the first for none', () => {
    expect(sentenceAt(sentences, 999)).toBe(2);
    expect(sentenceAt([], 5)).toBe(0);
  });
});
