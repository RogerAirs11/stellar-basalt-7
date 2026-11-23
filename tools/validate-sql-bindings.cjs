#!/usr/bin/env node
'use strict';
/** Static literal call audit. Dynamic templates, spread bindings and separately
 * prepared statements require runtime tests; they are counted, never assumed. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./lib/register-typescript.cjs');
const {sqlParameters} = require('../src/db/sqlLex.ts');
const root = path.resolve(__dirname, '..');
const problems = [];
let checked = 0;
let dynamic = 0;
function inspect(file) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'bind') {
      const prepare = node.expression.expression;
      if (ts.isCallExpression(prepare) && ts.isPropertyAccessExpression(prepare.expression) && prepare.expression.name.text === 'prepare') {
        const literal = prepare.arguments[0];
        if (literal && (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) && !node.arguments.some(ts.isSpreadElement)) {
          checked++;
          const line = ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          try {
            const expected = sqlParameters(literal.text).reduce((max, slot) => Math.max(max, slot.index), 0);
            if (expected !== node.arguments.length) problems.push({file: path.relative(root,file), line, expected, actual: node.arguments.length});
          } catch (error) { problems.push({file:path.relative(root,file),line,error:error.message}); }
        } else dynamic++;
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file = path.join(directory,entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) inspect(file);
  }
}
walk(path.join(root,'src'));
console.log(JSON.stringify({checked_literal_calls:checked,skipped_dynamic_calls:dynamic,problems,
  limitations:'Does not prove SQL schema validity, dynamic binding arity, runtime authorization, or dialect parity.'},null,2));
process.exitCode = problems.length ? 1 : 0;
