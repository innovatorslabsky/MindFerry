// pdf.js ships only as ES modules, and Jest's `require` refuses them. `jest.config.mjs` maps the
// library's `import('pdfjs-dist/legacy/build/pdf.mjs')` here, and this loads the real thing with
// Node's own `require` (exposed by `jest.environment.cjs`). The namespace is copied into a plain
// object because Jest's interop does not see through a module namespace.
const nodeRequire = globalThis.__nodeRequire;
module.exports = Object.assign(
  { __esModule: true },
  nodeRequire(nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
);
