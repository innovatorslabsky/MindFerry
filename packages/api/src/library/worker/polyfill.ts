/**
 * pdf.js evaluates `new DOMMatrix()` when it loads. In a normal process it borrows one from the
 * optional `@napi-rs/canvas` native addon, which the parser's permission model (rightly) refuses to
 * load. Reading text never touches a matrix, so a stand-in that exists but refuses to do arithmetic is
 * enough: if some path ever did use one, the job fails loudly instead of producing wrong coordinates.
 */
class UnsupportedDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: unknown) {
    if (init !== undefined) {
      throw new Error('DOMMatrix is not available in the parser');
    }
  }
}

for (const method of [
  'multiplySelf',
  'preMultiplySelf',
  'translate',
  'scale',
  'invertSelf',
  'transformPoint',
]) {
  Object.defineProperty(UnsupportedDOMMatrix.prototype, method, {
    value() {
      throw new Error('DOMMatrix is not available in the parser');
    },
  });
}

export function installParserPolyfills(target: Record<string, unknown> = globalThis): void {
  if (target.DOMMatrix === undefined) {
    target.DOMMatrix = UnsupportedDOMMatrix;
  }
}
