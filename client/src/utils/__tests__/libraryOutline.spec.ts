import { outlineOf } from '../libraryOutline';

describe('outlineOf', () => {
  it('lists the headings in order with their level', () => {
    const html =
      '<h1>Title</h1><p>x</p><h2>First  <em>part</em></h2><h3>Detail</h3><h2>Second</h2><h5>Ignored</h5>';
    expect(outlineOf(html)).toEqual([
      { text: 'Title', level: 1, index: 0 },
      { text: 'First part', level: 2, index: 1 },
      { text: 'Detail', level: 3, index: 2 },
      { text: 'Second', level: 2, index: 3 },
    ]);
  });

  it('leaves out an empty heading but keeps counting it, so later ones still point at the right place', () => {
    expect(outlineOf('<h2> </h2><h2>Real</h2>')).toEqual([{ text: 'Real', level: 2, index: 1 }]);
  });

  it('returns nothing for a page with no headings', () => {
    expect(outlineOf('<p>Just text</p>')).toEqual([]);
    expect(outlineOf('')).toEqual([]);
  });

  it('reads text, never runs it', () => {
    const entries = outlineOf('<h2>Hi<img src=x onerror="window.__ran=1"></h2>');
    expect(entries[0]?.text).toBe('Hi');
    expect((window as unknown as { __ran?: number }).__ran).toBeUndefined();
  });
});
