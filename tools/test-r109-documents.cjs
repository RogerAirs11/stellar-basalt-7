'use strict';
/** Real TSX render functions against explicit element/hook/command doubles.
 * Checks workflow guards and row ownership, not React DOM, layout or networking. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./lib/register-typescript.cjs');
const { createHookHarness } = require('./lib/r108-hook-harness.cjs');
const node = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== null && x !== false && x !== undefined) } });
const find = (tree, predicate) => { if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...(tree.props?.children ?? []).flatMap(child => find(child, predicate))]; };
function setup(t, { phase = 'empty', stale = false, mayTask = true, rows = [], commands = {} } = {}) {
  const h = createHookHarness(); t.after(() => h.dispose()); let state = phase === 'ready' || phase === 'reloading' ? { phase, data: { rows } } : { phase };
  const calls = []; const pending = []; const scopes = [];
  const kit = { useDomainResource: () => ({ state, retry() {} }),
    usePlatformCommand: (scope) => { scopes.push(scope); return { state: { phase: commands[scope] ?? 'idle' }, reset() {}, run(fn) { const promise = fn(); pending.push(promise); return promise; } }; },
    pick: (text) => text?.en ?? '', WORKSPACES: {}, };
  const filename = path.resolve(__dirname, '../src/web/heritage/WorkspaceDocumentsPanel.tsx');
  const mod = new Module(filename); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const stubs = { react: { ...h.react, createElement: node }, '../../frontend-kit': kit, '../i18n': { useI18n: () => ({ locale: 'en' }) }, './DomainFeedback': { HeritageResourceNotice: 'resource-notice', HeritageCommandNotice: 'command-notice' }, '../../shared/uiLocale': { uiText: (_locale, english) => english, legacyUiLocale: () => 'en' } };
  mod.require = id => { if (Object.hasOwn(stubs, id)) return stubs[id]; throw new Error(`Unexpected runtime import ${id}`); };
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } });
  mod._compile(compiled.outputText, filename);
  const platform = { modules: { workspaces: { async createDocument(...args) { calls.push(args); return { id: 1 }; } } } };
  const render = () => h.render(() => mod.exports.HeritageWorkspaceDocumentsPanel({ platform, workspaceId: 7, mayTask, stale, refresh() {} }));
  return { h, render, calls, pending, scopes, kit, state(value) { state = value; } };
}
for (const phase of ['empty', 'ready']) test(`R109 document: ${phase} resource permits first/new tracker`, t => {
  const x = setup(t, { phase }); const tree = x.render();
  assert.equal(find(tree, n => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, false);
});
for (const phase of ['loading', 'reloading', 'forbidden', 'unavailable', 'error']) test(`R109 document: ${phase} resource cannot dispatch creation`, async t => {
  const x = setup(t, { phase }); const tree = x.render();
  assert.equal(find(tree, n => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, true);
  find(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await Promise.all(x.pending); assert.equal(x.calls.length, 0);
});
test('R109 document: stale parent and missing permission both prevent creation', t => {
  let x = setup(t, { phase: 'ready', stale: true });
  assert.equal(find(x.render(), n => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, true);
  x = setup(t, { phase: 'empty', mayTask: false });
  assert.equal(find(x.render(), n => n.type === 'form').length, 0);
});
test('R109 document: invalid optional horse id is not silently omitted', async t => {
  const x = setup(t); let tree = x.render();
  for (const value of ['-1', '1.5', '9007199254740992', 'not-a-number']) {
    find(tree, n => n.type === 'input' && n.props.type === 'number')[0].props.onChange({ target: { value } }); tree = x.render();
    find(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  }
  await Promise.all(x.pending); assert.equal(x.calls.length, 0);
});
test('R109 document: valid optional horse id is retained in creation payload', async t => {
  const x = setup(t); let tree = x.render();
  find(tree, n => n.type === 'input' && n.props.type === 'number')[0].props.onChange({ target: { value: '42' } }); tree = x.render();
  find(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await Promise.all(x.pending); assert.equal(x.calls[0][0], 7); assert.equal(x.calls[0][1].horse_id, 42);
});
test('R109 document: row feedback belongs to workspace and document identity', t => {
  const rows = [1, 2].map(id => ({ id, title: `Document ${id}`, note: null, category: 'registration', horse_id: null, status: 'active', row_version: 1 }));
  const x = setup(t, { phase: 'ready', rows, commands: { 'workspace-document-archive:7:1': 'failed' } });
  const childRows = find(x.render(), n => typeof n.type === 'function' && n.type.name === 'DocumentRow');
  assert.equal(childRows.length, 2);
  const rendered = childRows.map(child => x.h.render(() => child.type(child.props))); // Command scope isolation, not real renderer instance mounting.
  assert.deepEqual(x.scopes.filter(scope => scope.includes(':')), ['workspace-document-update:7:1', 'workspace-document-archive:7:1', 'workspace-document-update:7:2', 'workspace-document-archive:7:2']);
  assert.equal(find(rendered[0], n => n.type === 'button').every(n => n.props.disabled), true);
  assert.equal(find(rendered[1], n => n.type === 'button').every(n => !n.props.disabled), true);
  assert.equal(find(rendered[0], n => n.type === 'command-notice' && n.props.state.phase === 'failed').length, 1);
  assert.equal(find(rendered[1], n => n.type === 'command-notice' && n.props.state.phase === 'failed').length, 0);
});
