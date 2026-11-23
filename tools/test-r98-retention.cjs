/* Real command execution with explicit interleaving before the batch. This is
 * not a substitute for the production PostgreSQL concurrent-session gate. */
require('./lib/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../tests/helpers/realDatabase.ts');
const privacy = require('../src/services/privacy.ts');
const NOW = '2026-10-05T12:00:00Z';
async function fixture() {
    const db = await fx.openRealDatabase();
    await fx.seedUser(db, 'admin', 'admin');
    await fx.seedUser(db, 'buyer', 'user');
    await db.exec(`INSERT INTO people(id,name_latin) VALUES(1,'Synthetic provider');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,status,created_at,updated_at)
    VALUES(1,'buyer',1,'trainer','Synthetic retained evidence','closed','2024-01-01','2024-01-01');`);
    return db;
}
const place = db => privacy.placeServiceRequestHoldStatements(db, { requestId: 1, operatorUserId: 'admin', holdKind: 'legal_hold', reason: 'Synthetic evidence preservation decision' });
const release = (db, operatorUserId = 'admin') => privacy.releaseServiceRequestHoldStatements(db, { requestId: 1, operatorUserId, releaseReason: 'Synthetic evidence hold release decision' });
test('R98 hold placed after retention selection prevents irreversible minimization', async () => {
    const db = await fixture();
    let inserted = false;
    const proxy = Object.create(db);
    proxy.batch = async (statements) => { if (!inserted) {
        inserted = true;
        await db.batch(place(db));
    } return db.batch(statements); };
    assert.equal((await privacy.serviceRetentionSweep(proxy, NOW)).minimized_requests, 0);
    assert.equal((await db.prepare('SELECT note FROM service_requests WHERE id=1').first()).note, 'Synthetic retained evidence');
    assert.equal(await fx.countRows(db, 'audit_events', "action='service_request.retention_minimized'"), 0);
});
test('R98 hold release retry cannot fabricate another audit event', async () => {
    const db = await fixture();
    await db.batch(place(db));
    await db.batch(release(db));
    await db.batch(release(db));
    assert.equal(await fx.countRows(db, 'audit_events', "action='service_request.hold_released'"), 1);
});
test('R98 deactivated former releaser cannot append historical release audits', async () => {
    const db = await fixture();
    await db.batch(place(db));
    await db.batch(release(db));
    await db.exec("UPDATE users SET is_active=0 WHERE id='admin'");
    await db.batch(release(db));
    assert.equal(await fx.countRows(db, 'audit_events', "action='service_request.hold_released'"), 1);
});
test('R98 released hold permits subsequent retention exactly once', async () => {
    const db = await fixture();
    await db.batch(place(db));
    assert.equal((await privacy.serviceRetentionSweep(db, NOW)).minimized_requests, 0);
    await db.batch(release(db));
    assert.equal((await privacy.serviceRetentionSweep(db, NOW)).minimized_requests, 1);
    assert.equal((await privacy.serviceRetentionSweep(db, NOW)).minimized_requests, 0);
});
test('R98 a newly active hold cannot be mistaken for an old release', async () => {
    const db = await fixture();
    await db.batch(place(db));
    await db.batch(release(db));
    await db.batch(place(db));
    assert.equal((await privacy.serviceRetentionSweep(db, NOW)).minimized_requests, 0);
    assert.equal(await fx.countRows(db, 'service_request_holds', 'released_at IS NULL'), 1);
});
test('R98 failed release is distinguishable from the parent lock result', async () => {
    const db = await fixture();
    const results = await db.batch(release(db));
    assert.equal(results[0].meta.changes, 1);
    assert.equal(results[1].meta.changes, 0);
    assert.equal(await fx.countRows(db, 'audit_events'), 0);
});
test('R98 duplicate hold is distinguishable from the parent lock result', async () => {
    const db = await fixture();
    await db.batch(place(db));
    const results = await db.batch(place(db));
    assert.equal(results[0].meta.changes, 1);
    assert.equal(results[1].meta.changes, 0);
    assert.equal(await fx.countRows(db, 'audit_events', "action='service_request.hold_placed'"), 1);
});
