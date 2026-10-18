import { anchorToLayer, layerToAnchor } from '../pdfTextMap';

/** What the text layer holds: items one after another, with no line breaks between them. */
const LAYER = 'Memory decays on a curve. The curve is steep at first and ';
/** What is stored: the same words, reflowed into one paragraph. */
const ANCHOR = 'Memory decays on a curve. The curve is steep at first and';

const slice = (text: string, range: { start: number; end: number } | null) =>
  range ? text.slice(range.start, range.end) : null;

describe('carrying a position between the text layer and the stored text', () => {
  it('finds the same words in the other text', () => {
    const start = LAYER.indexOf('decays');
    const mapped = layerToAnchor(LAYER, ANCHOR, start, start + 'decays on a curve'.length);

    expect(slice(ANCHOR, mapped)).toBe('decays on a curve');
  });

  it('works the other way round', () => {
    const start = ANCHOR.indexOf('steep at first');
    const mapped = anchorToLayer(LAYER, ANCHOR, start, start + 'steep at first'.length);

    expect(slice(LAYER, mapped)).toBe('steep at first');
  });

  it('does not mind how the two texts break their lines', () => {
    const layer = 'Memory decays\non a\ncurve';
    const anchor = 'Memory   decays on a curve';
    const start = layer.indexOf('decays');

    const mapped = layerToAnchor(layer, anchor, start, layer.length);

    expect(slice(anchor, mapped)).toBe('decays on a curve');
  });

  it('does not mind a word that was split by a hyphen at the end of a line', () => {
    const layer = 'A well-\nknown result';
    const anchor = 'A wellknown result';
    const start = layer.indexOf('well-');

    const mapped = layerToAnchor(layer, anchor, start, layer.indexOf('known') + 5);

    expect(slice(anchor, mapped)).toBe('wellknown');
  });

  it('tells apart a passage that appears twice, by which one it is', () => {
    const text = 'the curve rises and the curve falls';
    const second = text.lastIndexOf('the curve');

    const mapped = layerToAnchor(text, text, second, second + 'the curve'.length);

    expect(mapped).toEqual({ start: second, end: second + 'the curve'.length });
  });

  it('keeps the count right when the texts differ in whitespace before the passage', () => {
    const layer = 'the curve\n rises and the curve falls';
    const anchor = 'the curve rises and the curve falls';
    const second = layer.lastIndexOf('the curve');

    const mapped = layerToAnchor(layer, anchor, second, second + 'the curve'.length);

    expect(mapped).toEqual({
      start: anchor.lastIndexOf('the curve'),
      end: anchor.lastIndexOf('the curve') + 9,
    });
  });

  it('gives up on a passage the other text does not have', () => {
    expect(layerToAnchor('alpha beta', 'alpha gamma', 6, 10)).toBeNull();
    expect(anchorToLayer('alpha beta', 'alpha gamma', 6, 11)).toBeNull();
  });

  it('gives up when the occurrence number runs past what the other text holds', () => {
    const layer = 'the curve and the curve and the curve';
    const anchor = 'the curve and the curve';
    const third = layer.lastIndexOf('the curve');

    expect(layerToAnchor(layer, anchor, third, third + 9)).toBeNull();
  });

  it('refuses empty, reversed and out-of-range selections', () => {
    expect(layerToAnchor('abc', 'abc', 1, 1)).toBeNull();
    expect(layerToAnchor('abc', 'abc', 2, 1)).toBeNull();
    expect(layerToAnchor('abc', 'abc', 0, 9)).toBeNull();
    expect(layerToAnchor('abc', 'abc', -1, 2)).toBeNull();
    expect(layerToAnchor('   ', 'abc', 0, 3)).toBeNull();
  });

  it('puts the end after the last character, not after trailing space', () => {
    const mapped = layerToAnchor('alpha beta  ', 'alpha beta', 6, 12);

    expect(mapped).toEqual({ start: 6, end: 10 });
  });
});
