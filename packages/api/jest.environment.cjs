const { TestEnvironment } = require('jest-environment-node');

/**
 * The default Node environment, plus Node's own `require` on the sandbox global. Jest's `require`
 * refuses ES modules, and pdf.js ships only as ES modules; Node's can load one synchronously. Only
 * the reading library's tests use it (through `src/library/__tests__/helpers/pdfjs.cjs`).
 */
class NodeRequireEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.__nodeRequire = require;
  }
}

module.exports = NodeRequireEnvironment;
