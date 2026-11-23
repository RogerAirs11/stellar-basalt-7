/** Dependency-light parse gate for source AND tests. Not a semantic typecheck. */
const fs = require('node:fs');
const path = require('node:path');
let ts;
try { ts = require('typescript'); }
catch { ts = require(path.join(require('node:child_process').execFileSync('npm', ['root', '-g'], {encoding: 'utf8'}).trim(), 'typescript')); }
let count = 0;
const failures = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts')) {
      count++;
      const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
      for (const diagnostic of source.parseDiagnostics) {
        const where = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        failures.push(`${file}:${where.line+1}:${where.character+1} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      }
    }
  }
}
for (const dir of ['src','tests','tools','scripts']) walk(dir);
console.log(JSON.stringify({scope: 'source, tests, tools, scripts', files: count, failures}, null, 2));
process.exitCode = failures.length ? 1 : 0;
