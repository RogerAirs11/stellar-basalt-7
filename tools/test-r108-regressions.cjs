'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, root } = require('./lib/r104-isolated-module.cjs');
const { createHookHarness } = require('./lib/r108-hook-harness.cjs');
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const functional of [false, true]) test(`R108 repro: stale scoped ${functional ? 'functional' : 'value'} setter cannot erase current principal data`, () => {
  const h = createHookHarness(); const { useScopedState } = load('src/frontend-kit/domain/principalScope.ts', { react: h.react });
  const render = scope => h.render(() => useScopedState(scope, 'EMPTY'));
  let [value, setA] = render('A'); h.flush(); setA('private A'); render('A');
  render('B'); h.flush(); const setB = render('B')[1]; setB('private B');
  let evaluations = 0;
  setA(functional ? () => { evaluations++; return 'late A'; } : 'late A');
  assert.equal(render('B')[0], 'private B');
  assert.equal(evaluations, 0, 'a stale functional updater must not execute'); h.dispose();
});
test('R108 repro: A-B-A does not revive an earlier A setter', () => {
  const h = createHookHarness(); const { useScopedState } = load('src/frontend-kit/domain/principalScope.ts', { react: h.react });
  const render = scope => h.render(() => useScopedState(scope, 'EMPTY'));
  const oldA = render('A')[1]; h.flush(); render('B'); h.flush(); render('A'); h.flush();
  render('A')[1]('fresh A'); oldA('obsolete A'); assert.equal(render('A')[0], 'fresh A'); h.dispose();
});
test('R108 scoped state keeps current functional updates and stable setter', () => {
  const h = createHookHarness(); const { useScopedState } = load('src/frontend-kit/domain/principalScope.ts', { react: h.react });
  const render = scope => h.render(() => useScopedState(scope, 0)); const set = render('A')[1]; h.flush();
  set(n => n + 1); set(n => n + 1); assert.equal(render('A')[0], 2); assert.equal(render('A')[1], set);
  assert.equal(render('B')[0], 0); h.flush(); h.dispose();
});
test('R108 repro: scoped command cannot submit from a stale callback', async () => {
  const h = createHookHarness(); const { usePlatformCommand } = load('src/frontend-kit/domain/commandStatus.ts', { react: h.react });
  const render = scope => h.render(() => usePlatformCommand(scope)); const old = render('A'); h.flush(); render('B'); h.flush();
  let calls = 0; assert.equal(await old.run(async () => { calls++; }), false); assert.equal(calls, 0); h.dispose();
});
test('R108 repro: pending command feedback is masked at principal change', async () => {
  const h = createHookHarness(); const { usePlatformCommand } = load('src/frontend-kit/domain/commandStatus.ts', { react: h.react });
  const render = scope => h.render(() => usePlatformCommand(scope)); const first = render('A'); h.flush();
  const pending = defer(); const completion = first.run(() => pending.promise); assert.equal(render('A').state.phase, 'submitting');
  assert.equal(render('B').state.phase, 'idle'); h.flush(); pending.resolve({ ok: true });
  assert.equal(await completion, false, 'superseded UI must not run success follow-ups'); assert.equal(render('B').state.phase, 'idle'); h.dispose();
});
test('R108 command same-render duplicate is refused and unmount suppresses completion', async () => {
  const h = createHookHarness(); const { usePlatformCommand } = load('src/frontend-kit/domain/commandStatus.ts', { react: h.react });
  const first = h.render(() => usePlatformCommand('A')); h.flush(); const pending = defer(); let calls = 0;
  const one = first.run(() => { calls++; return pending.promise; }); const two = first.run(async () => { calls++; });
  assert.equal(await two, false); assert.equal(calls, 1); h.dispose(); pending.resolve({}); assert.equal(await one, false);
});
const { listingLifecycleView } = load('src/frontend-kit/domain/marketplace.ts', { react: {} });
for (const expires_at of ['2026-10-01 00:00:00', '2026-10-01T00:00:00Z', '2026-10-01T03:30:00+03:30']) {
  test(`R108 repro: listing expiry respects normalized instant ${expires_at}`, () => {
    const view = listingLifecycleView({ listing: { status: 'active', expires_at, seller_mandate_current: true }, viewerRole: 'buyer', now: new Date('2026-10-15T00:00:00Z') });
    assert.equal(view.expired, true); assert.equal(view.effectiveStatus, 'expired'); assert.ok(!view.buyerActions.includes('inquire'));
  });
}
for (const expires_at of ['not-a-date', '2026-02-30T00:00:00Z', '']) test(`R108 repro: invalid listing expiry blocks inquiry ${JSON.stringify(expires_at)}`, () => {
  const view = listingLifecycleView({ listing: { status: 'active', expires_at, seller_mandate_current: true }, viewerRole: 'buyer' });
  assert.ok(!view.buyerActions.includes('inquire')); assert.equal(view.expiryStatus, 'invalid');
});
for (const file of ['app.js', 'core.js', 'hostBridge.js', 'views/admin.js']) test(`R108 repro: shipped Classic matches donor ${file}`, () => {
  const donor = fs.readFileSync(path.join(root, 'standalone-frontends/classic-v1.4/public/ui', file));
  const shipped = fs.readFileSync(path.join(root, 'public/classic-registry/ui', file)); assert.ok(donor.equals(shipped));
});
test('R108 Classic freshness gate is read-only and part of build/check', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.build, /validate:classic:embedded/); assert.match(packageJson.scripts.check, /validate:classic:embedded/);
  const before = fs.readFileSync(path.join(root, 'public/classic-registry/ui/app.js'));
  const run = spawnSync(process.execPath, ['tools/build-classic-embedded.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr); assert.ok(before.equals(fs.readFileSync(path.join(root, 'public/classic-registry/ui/app.js'))));
});

for (const version of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,'2']) test(`R108 conflict envelope refuses non-positive or unsafe row version ${version}`,()=>{
  const {classifyCommandError}=load('src/frontend-kit/domain/commandModel.ts');
  const {PlatformClientError}=require(path.join(root,'src/frontend-kit/errors.ts'));
  const result=classifyCommandError(new PlatformClientError(409,'conflict','Changed',{current_version:version}));
  assert.equal(result.phase,'rejected'); assert.equal(result.currentVersion,undefined);
});

test('R108 conflict envelope preserves a positive safe version',()=>{
  const {classifyCommandError}=load('src/frontend-kit/domain/commandModel.ts');
  const {PlatformClientError}=require(path.join(root,'src/frontend-kit/errors.ts'));
  const state=classifyCommandError(new PlatformClientError(409,'conflict','Changed',{current_version:2}));
  assert.equal(state.phase,'rejected');assert.equal(state.currentVersion,2);
});
