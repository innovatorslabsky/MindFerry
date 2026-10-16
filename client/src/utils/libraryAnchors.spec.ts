import type { TLibraryHighlight } from 'librechat-data-provider';
import {
  buildAnchor,
  clearMarks,
  offsetsFromRange,
  paintHighlights,
  rangeFromOffsets,
  rendersServerText,
} from './libraryAnchors';

const HTML =
  '<h1>Title</h1><p>Memory <em>decays</em> on a forgetting curve.</p><p>Second paragraph.</p>';

function root(html = HTML): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function highlight(
  id: string,
  start: number,
  end: number,
  extra: Partial<TLibraryHighlight> = {},
): TLibraryHighlight {
  return {
    id,
    documentId: 'd',
    anchor: { exact: '', prefix: '', suffix: '', start, end },
    color: 'yellow',
    tags: [],
    contentHash: 'h',
    orphaned: false,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('offsets and ranges', () => {
  it('turns a selection across elements into offsets, and back into the same text', () => {
    const el = root();
    const text = el.textContent as string;
    const start = text.indexOf('Memory');
    const end = text.indexOf('curve') + 'curve'.length;
    const range = rangeFromOffsets(el, start, end);
    expect(range?.toString()).toBe('Memory decays on a forgetting curve');
    expect(offsetsFromRange(el, range as Range)).toEqual({ start, end });
  });

  it('refuses an empty selection, a selection outside the root, and offsets past the end', () => {
    const el = root();
    const outside = root('<p>elsewhere</p>');
    const empty = document.createRange();
    empty.setStart(el.firstChild as Node, 0);
    empty.collapse(true);
    expect(offsetsFromRange(el, empty)).toBeNull();
    const stray = document.createRange();
    stray.selectNodeContents(outside);
    expect(offsetsFromRange(el, stray)).toBeNull();
    expect(rangeFromOffsets(el, 0, 10_000)).toBeNull();
    expect(rangeFromOffsets(el, 5, 5)).toBeNull();
    expect(rangeFromOffsets(el, -1, 4)).toBeNull();
  });
});

describe('buildAnchor', () => {
  it('records the quote with up to 32 characters either side', () => {
    const text = 'a'.repeat(50) + 'QUOTE' + 'b'.repeat(50);
    expect(buildAnchor(text, 50, 55)).toEqual({
      exact: 'QUOTE',
      prefix: 'a'.repeat(32),
      suffix: 'b'.repeat(32),
      start: 50,
      end: 55,
    });
  });

  it('returns null for a range that is not inside the text', () => {
    expect(buildAnchor('abc', 2, 2)).toBeNull();
    expect(buildAnchor('abc', 0, 9)).toBeNull();
    expect(buildAnchor('abc', -1, 2)).toBeNull();
    expect(buildAnchor('abc', 0.5, 2)).toBeNull();
  });
});

describe('rendersServerText', () => {
  it('is true only for the exact text the server anchors in', () => {
    const el = root();
    expect(rendersServerText(el, el.textContent as string)).toBe(true);
    expect(rendersServerText(el, `${el.textContent} `)).toBe(false);
  });
});

describe('paintHighlights (mark fallback)', () => {
  it('wraps highlights without changing the text, including across elements', () => {
    const el = root();
    const before = el.textContent;
    const text = before as string;
    const start = text.indexOf('Memory');
    const end = text.indexOf('curve') + 5;
    const unplaced = paintHighlights(el, [highlight('h1', start, end, { color: 'blue' })]);
    expect(unplaced).toEqual([]);
    expect(el.textContent).toBe(before);
    const marks = Array.from(el.querySelectorAll('mark[data-library-highlight="h1"]'));
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map((m) => m.textContent).join('')).toBe('Memory decays on a forgetting curve');
    expect(marks.every((m) => m.getAttribute('data-color') === 'blue')).toBe(true);
  });

  it('places several highlights, later ones first, without shifting earlier offsets', () => {
    const el = root();
    const text = el.textContent as string;
    const a = text.indexOf('Memory');
    const b = text.indexOf('Second');
    paintHighlights(el, [highlight('a', a, a + 6), highlight('b', b, b + 6)]);
    const painted = (id: string) =>
      Array.from(el.querySelectorAll(`mark[data-library-highlight="${id}"]`))
        .map((m) => m.textContent)
        .join('');
    expect(painted('a')).toBe('Memory');
    expect(painted('b')).toBe('Second');
  });

  it('reports orphaned and out-of-range highlights instead of painting them', () => {
    const el = root();
    const unplaced = paintHighlights(el, [
      highlight('orphan', 0, 5, { orphaned: true }),
      highlight('far', 9000, 9005),
      highlight('ok', 0, 5),
    ]);
    expect(unplaced.sort()).toEqual(['far', 'orphan']);
    expect(el.querySelectorAll('mark[data-library-highlight="ok"]').length).toBe(1);
  });

  it('repaints cleanly and clearMarks restores the original markup', () => {
    const el = root();
    paintHighlights(el, [highlight('a', 0, 5)]);
    paintHighlights(el, [highlight('b', 6, 10)]);
    expect(el.querySelectorAll('mark[data-library-highlight="a"]').length).toBe(0);
    expect(el.querySelectorAll('mark[data-library-highlight="b"]').length).toBe(1);
    clearMarks(el);
    expect(el.innerHTML).toBe(HTML);
  });
});

describe('paintHighlights (CSS Custom Highlight API)', () => {
  const registered = new Map<string, unknown>();

  beforeEach(() => {
    registered.clear();
    (globalThis as unknown as { Highlight: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    (globalThis.CSS as unknown as { highlights: unknown }).highlights = {
      set: (name: string, value: unknown) => registered.set(name, value),
      delete: (name: string) => registered.delete(name),
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
    delete (globalThis.CSS as unknown as { highlights?: unknown }).highlights;
  });

  it('registers ranges by colour and leaves the markup alone', () => {
    const el = root();
    paintHighlights(el, [
      highlight('a', 0, 5, { color: 'green' }),
      highlight('b', 6, 10, { color: 'green' }),
      highlight('c', 12, 15, { color: 'red' }),
    ]);
    expect(el.innerHTML).toBe(HTML);
    expect((registered.get('library-green') as { ranges: Range[] }).ranges).toHaveLength(2);
    expect((registered.get('library-red') as { ranges: Range[] }).ranges).toHaveLength(1);
    expect(registered.has('library-yellow')).toBe(false);
  });

  it('drops a colour that is no longer used when repainting', () => {
    const el = root();
    paintHighlights(el, [highlight('a', 0, 5, { color: 'red' })]);
    paintHighlights(el, [highlight('a', 0, 5, { color: 'blue' })]);
    expect(registered.has('library-red')).toBe(false);
    expect(registered.has('library-blue')).toBe(true);
  });
});
