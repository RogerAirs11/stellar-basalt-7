/* Execute real source with explicit external-driver/React doubles. These tests
 * verify adapter/control-flow behavior, NOT hosted drivers or React DOM. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./register-typescript.cjs');
const root = process.env.HR_R104_SOURCE_ROOT || path.resolve(__dirname, '../..');
function load(relative, stubs = {}) {
  const filename = path.join(root, relative);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = id => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : original(id);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  module._compile(result.outputText, filename);
  return module.exports;
}
module.exports = { load, root };
