import { sourceTag, suggestTags } from '../autotag';

const memory = Array.from({ length: 6 }, () => 'Spaced repetition strengthens memory.').join(' ');

describe('sourceTag', () => {
  it('is the site without www, and nothing for a file or a bad address', () => {
    expect(sourceTag('https://www.Example.com/post/1?x=1')).toBe('example.com');
    expect(sourceTag('https://blog.example.com/a')).toBe('blog.example.com');
    expect(sourceTag('upload://abc123')).toBeUndefined();
    expect(sourceTag('not a url')).toBeUndefined();
  });
});

describe('suggestTags', () => {
  const article = (over = {}) => ({
    kind: 'article' as const,
    title: 'Spaced repetition',
    text: memory,
    normalizedUrl: 'https://www.example.com/p',
    ...over,
  });

  it('tags the site first, then the most repeated meaningful words, title words counting more', () => {
    expect(suggestTags(article())).toEqual(['example.com', 'repetition', 'spaced', 'memory']);
  });

  it('is the same every time', () => {
    expect(suggestTags(article())).toEqual(suggestTags(article()));
  });

  it('ignores common words and words said too few times', () => {
    const tags = suggestTags(
      article({
        title: 'About this',
        text: 'Because about which there would their. '.repeat(5) + 'zebra once.',
      }),
    );
    expect(tags).toEqual(['example.com']);
  });

  it('adds the file kind for a book, and nothing for a site when it was uploaded', () => {
    expect(suggestTags(article({ kind: 'pdf', normalizedUrl: 'upload://x' }))).toEqual([
      'pdf',
      'repetition',
      'spaced',
      'memory',
    ]);
  });

  it('skips keywords for a language other than English, but keeps the site', () => {
    expect(suggestTags(article({ lang: 'fr' }))).toEqual(['example.com']);
    expect(suggestTags(article({ lang: 'en-GB' })).length).toBe(4);
  });

  it('never goes past five tags', () => {
    const text = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
      .map((w) => `${w} `.repeat(5))
      .join('');
    expect(suggestTags(article({ kind: 'epub', text })).length).toBeLessThanOrEqual(5);
  });
});
