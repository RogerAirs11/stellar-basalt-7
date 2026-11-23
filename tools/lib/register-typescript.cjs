/* Audit-only loader: executes actual TypeScript through the installed compiler.
 * It never replaces application imports with mocks. Prefer local TypeScript;
 * a global installation is an explicit offline fallback. */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
let ts;
try { ts = require('typescript'); }
catch {
  const globalRoot = cp.execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim();
  ts = require(path.join(globalRoot, 'typescript'));
}
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n'
    }));
    module._compile(result.outputText, filename);
  };
}
module.exports = ts;
