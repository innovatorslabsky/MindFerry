const path = require('node:path');

/**
 * `jest-environment-node` is Jest's own dependency, so with some install layouts (npm nests it under
 * `node_modules/jest`) it cannot be required from here by name. Look beside Jest when it is not found.
 */
function loadNodeEnvironment() {
  try {
    return require('jest-environment-node');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
  // Look beside whatever loaded this file (Jest's own modules), then beside Jest itself.
  const places = [];
  for (
    let parent = module.parent, depth = 0;
    parent && depth < 8;
    parent = parent.parent, depth++
  ) {
    places.push(path.dirname(parent.filename));
  }
  try {
    const jestDir = path.dirname(require.resolve('jest/package.json'));
    places.push(jestDir);
    places.push(path.dirname(require.resolve('jest-config/package.json', { paths: [jestDir] })));
  } catch {
    // Jest not found by name either; the places gathered so far are all there is.
  }
  return require(require.resolve('jest-environment-node', { paths: places }));
}

const { TestEnvironment } = loadNodeEnvironment();

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
