require('./lib/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../tests/helpers/realDatabase.ts');
const membership = require('../src/trust/membershipCommands.ts');
const store = require('../src/trust/attestationStore.ts');
const { recordPublicationDecision } = require('../src/privacy/publicationDecisions.ts');
async function fixture() {
    const db = await fx.openRealDatabase();
    for (const [id, role] of [['admin', 'admin'], ['owner', 'user'], ['attester', 'user'], ['other', 'user']])
        await fx.seedUser(db, id, role);
    await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic horse'),(2,'Another synthetic horse'); INSERT INTO issuers(id,slug,name,status) VALUES('issuer','synthetic-issuer','Synthetic issuer','active'); INSERT INTO issuer_memberships(id,issuer_id,user_id,role,valid_from) VALUES('owner-m','issuer','owner','owner','2020-01-01 00:00:00'),('attester-m','issuer','attester','attester','2020-01-01 00:00:00')");
    // R98-N04 scope discipline: an issuer needs BOTH a membership and an
    // approved, in-effect issuer_scope (with the attest/supersede actions)
    // for each record kind it attests. The happy-path issuance tests below
    // exercise that full authority, so the fixture seeds one platform-approved
    // scope per record kind used in this suite (horse_identity, media,
    // genetic_test). Without this, issueStoredAttestation correctly fails
    // closed at the commit-time scope proof (this suite predates the wiring
    // of ACTIVE_ISSUER_SCOPE_SQL into issuance and was not CI-gated).
    await db.exec("INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,evidence_note,approved_by_user_id) VALUES('scope-hid','issuer','horse_identity','approved',1,'2020-01-01 00:00:00','Synthetic platform approval for the test fixture','admin'),('scope-media','issuer','media','approved',1,'2020-01-01 00:00:00','Synthetic platform approval for the test fixture','admin'),('scope-gen','issuer','genetic_test','approved',1,'2020-01-01 00:00:00','Synthetic platform approval for the test fixture','admin'); INSERT INTO issuer_scope_actions(scope_id,action) VALUES('scope-hid','attest'),('scope-hid','supersede'),('scope-media','attest'),('scope-media','supersede'),('scope-gen','attest'),('scope-gen','supersede')");
    return db;
}
const grant = (db, overrides = {}) => membership.grantMembership(db, { actorId: 'owner', issuerId: 'issuer', targetId: 'other', role: 'attester', ...overrides });
const issue = (db, overrides = {}, actor = 'attester', supersedes) => store.issueStoredAttestation(db, actor, 'issuer', { record_kind: 'horse_identity', record_id: '1', statement: 'PRIVATE original scope', field_scope: ['private_accession'], ...overrides }, supersedes);
test('R98 issuer owner grants with auditable history and unique current membership', async () => { const db = await fixture(); assert.ok(await grant(db)); assert.ok(await grant(db, { role: 'owner' })); assert.equal(await fx.countRows(db, 'issuer_memberships', "user_id='other' AND status='active'"), 1); assert.equal(await fx.countRows(db, 'issuer_memberships', "user_id='other' AND status='revoked'"), 1); assert.equal(await fx.countRows(db, 'audit_events'), 2); });
for (const state of ['expired', 'future', 'revoked', 'inactive actor', 'suspended issuer', 'ordinary attester', 'invalid date'])
    test(`R98 membership grant denies ${state}`, async () => { const db = await fixture(); let actor = 'owner'; if (state === 'expired')
        await db.exec("UPDATE issuer_memberships SET valid_until='2001-01-01 00:00:00' WHERE id='owner-m'"); if (state === 'future')
        await db.exec("UPDATE issuer_memberships SET valid_from='2099-01-01 00:00:00' WHERE id='owner-m'"); if (state === 'revoked')
        await db.exec("UPDATE issuer_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason='test' WHERE id='owner-m'"); if (state === 'inactive actor')
        await db.exec("UPDATE users SET is_active=0 WHERE id='owner'"); if (state === 'suspended issuer')
        await db.exec("UPDATE issuers SET status='suspended'"); if (state === 'ordinary attester')
        actor = 'attester'; if (state === 'invalid date')
        await db.exec("UPDATE issuer_memberships SET valid_from='invalid' WHERE id='owner-m'"); assert.equal(await grant(db, { actorId: actor }), null); assert.equal(await fx.countRows(db, 'issuer_management_operations'), 0); assert.equal(await fx.countRows(db, 'audit_events'), 0); });
test('R98 issuer admin management does not grant attestation authority by itself', async () => { const db = await fixture(); assert.ok(await grant(db, { actorId: 'admin' })); assert.equal(await issue(db, {}, 'admin'), null); });
test('R98 membership revocation replay is inert and expired owner cannot revoke', async () => { const db = await fixture(); const input = { actorId: 'owner', membershipId: 'attester-m', reason: 'Explicit synthetic revocation' }; await db.exec("UPDATE issuer_memberships SET valid_until='2001-01-01 00:00:00' WHERE id='owner-m'"); assert.equal(await membership.revokeMembership(db, input), false); assert.equal(await membership.revokeMembership(db, { ...input, actorId: 'admin' }), true); assert.equal(await membership.revokeMembership(db, { ...input, actorId: 'admin' }), false); assert.equal(await fx.countRows(db, 'audit_events'), 1); });
test('R98 normalized expiry accepts real leap days and rejects impossible or unzoned instants', () => { assert.equal(membership.normalizeTrustExpiry('2028-02-29', Date.parse('2026-01-01')), '2028-03-01T00:00:00.000Z'); assert.throws(() => membership.normalizeTrustExpiry('2027-02-29'), /real future/); assert.throws(() => membership.normalizeTrustExpiry('2099-01-01T00:00:00'), /offset-qualified/); });
test('R98 attestation issuance is linked to actual record and event', async () => { const db = await fixture(); const id = await issue(db); assert.ok(id); const row = await db.prepare('SELECT * FROM attestations WHERE id=?').bind(id).first(); assert.equal(row.horse_id, 1); assert.equal(row.attested_by_user_id, 'attester'); assert.equal(await fx.countRows(db, 'attestation_events'), 1); });
for (const condition of ['revoked membership', 'inactive account', 'suspended issuer', 'deleted horse', 'scope mismatch', 'missing record', 'expired membership'])
    test(`R98 issuance rejects ${condition} without orphan event`, async () => { const db = await fixture(); let input = {}; if (condition === 'revoked membership')
        await db.exec("UPDATE issuer_memberships SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason='test' WHERE id='attester-m'"); if (condition === 'inactive account')
        await db.exec("UPDATE users SET is_active=0 WHERE id='attester'"); if (condition === 'suspended issuer')
        await db.exec("UPDATE issuers SET status='suspended'"); if (condition === 'deleted horse')
        await db.exec('UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=1'); if (condition === 'scope mismatch')
        input = { horse_id: 2 }; if (condition === 'missing record')
        input = { record_id: '999' }; if (condition === 'expired membership')
        await db.exec("UPDATE issuer_memberships SET valid_until='2001-01-01 00:00:00' WHERE id='attester-m'"); assert.equal(await issue(db, input), null); assert.equal(await fx.countRows(db, 'attestations'), 0); assert.equal(await fx.countRows(db, 'attestation_events'), 0); });
async function media(db, uploader = 'other', horse = 1) { await db.prepare("INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes,uploaded_by_user_id,consent_state) VALUES('m',?,'document','private.pdf','application/pdf',1,?,'private')").bind(horse, uploader).run(); }
test('R98 own upload and evidence from another horse cannot be attested', async () => { const db = await fixture(); await media(db, 'attester'); assert.equal(await issue(db, { record_kind: 'media', record_id: 'm' }), null); assert.equal(await issue(db, { evidence_media_id: 'm' }), null); await db.exec("UPDATE horse_media SET uploaded_by_user_id='other',horse_id=2"); assert.equal(await issue(db, { evidence_media_id: 'm' }), null); assert.equal(await fx.countRows(db, 'attestation_events'), 0); });
test('R98 supersession atomically creates replacement and closes old record', async () => { const db = await fixture(); const id = await issue(db); const replacement = await issue(db, {}, 'owner', { id, expectedVersion: 1, reason: 'Correct recorded statement' }); assert.ok(replacement); const old = await db.prepare('SELECT status,superseded_by FROM attestations WHERE id=?').bind(id).first(); assert.equal(old.status, 'superseded'); assert.equal(old.superseded_by, replacement); assert.equal(await fx.countRows(db, 'attestation_events'), 3); assert.equal(await issue(db, {}, 'owner', { id, expectedVersion: 1, reason: 'stale replay' }), null); assert.equal(await fx.countRows(db, 'attestations'), 2); });
test('R98 supersession cannot change target or be performed by ordinary attester', async () => { const db = await fixture(); const id = await issue(db); const old = { id, expectedVersion: 1, reason: 'Synthetic replacement' }; assert.equal(await issue(db, { record_id: '2' }, 'owner', old), null); assert.equal(await issue(db, {}, 'attester', old), null); assert.equal(await fx.countRows(db, 'attestations'), 1); });
test('R98 failed revocation CAS produces no audit event', async () => { const db = await fixture(); const id = await issue(db); const input = { actorId: 'owner', id, expectedVersion: 1, reason: 'Withdraw evidence' }; assert.equal(await store.revokeStoredAttestation(db, { ...input, expectedVersion: 9 }), false); assert.equal(await store.revokeStoredAttestation(db, input), true); assert.equal(await store.revokeStoredAttestation(db, input), false); assert.equal(await fx.countRows(db, 'attestation_events'), 2); });
test('R98 public attestation metadata omits statement, free-text scope and evidence', async () => { const db = await fixture(); await issue(db); const view = await store.publicHorseAttestations(db, 1); assert.equal(view.attestations.length, 1); assert.equal(view.attestations[0].statement, null); assert.equal(view.attestations[0].field_scope, null); assert.equal(view.attestations[0].scope_redacted, true); assert.ok(!JSON.stringify(view).includes('PRIVATE')); assert.ok(!JSON.stringify(view).includes('private_accession')); });
test('R98 private media attestation and withdrawn media stay out of public view', async () => { const db = await fixture(); await media(db); /* R111: documents remain private even if a legacy consent flag says public. The positive fixture is a reviewed gallery photo. */ await db.exec("UPDATE horse_media SET media_type='photo',role='gallery',file_name='DEMO.png',mime_type='image/png',verification='federation_verified'"); assert.ok(await issue(db, { record_kind: 'media', record_id: 'm' })); assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 0); await db.exec("UPDATE horse_media SET consent_state='shared_public'"); assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 1); await db.exec("UPDATE horse_media SET consent_state='private'"); assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 0); });
test('R98 disease attestations require separate publication and disappear immediately after withdrawal', async () => {
    const db = await fixture();
    await db.exec("INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance) VALUES(1,1,'SCID','disease','N/N',0,'user')");
    assert.ok(await issue(db, { record_kind: 'genetic_test', record_id: '1' }));
    assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 0);
    await db.exec('UPDATE genetic_tests SET verified=1');
    assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 0, 'verification alone cannot publish disease evidence');
    await fx.makeSession(db, 'admin');
    const actorSession = await db.prepare("SELECT id,token_hash FROM sessions WHERE user_id='admin' ORDER BY created_at DESC LIMIT 1").first();
    const actor = { user: {id:'admin',role:'admin'}, sessionId:actorSession.id, sessionTokenHash:actorSession.token_hash };
    await db.exec("INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from) VALUES('synthetic-publication',1,'admin','federation_official','genetic_publish','SYNTHETIC-AUTHORITY','SYNTHETIC-ASSIGNMENT','admin_grant','admin','2020-01-01')");
    const decision = { testId: 1, horseId: 1, actorUserId: 'admin', actorSessionId:actor.sessionId, actor, basis: 'owner_consent', purpose: 'Synthetic specific publication purpose', evidenceRef: 'SYNTHETIC-CONSENT-REFERENCE', reason: 'Explicit fixture publication decision' };
    await recordPublicationDecision(db, { ...decision, desired: 'publish', expectedVersion: 0 });
    assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 1);
    await recordPublicationDecision(db, { ...decision, desired: 'withdraw', expectedVersion: 1, reason: 'Synthetic consent withdrawn' });
    assert.equal((await store.publicHorseAttestations(db, 1)).attestations.length, 0);
    assert.equal(await fx.countRows(db, 'publication_decisions'), 2);
    assert.equal(await db.prepare('SELECT verified FROM genetic_tests WHERE id=1').first('verified'), 1);
});
test('R98 invalid expiry and suspended issuers cannot inflate active count', async () => { const db = await fixture(); await issue(db); assert.equal(await store.activeAttestationCount(db, 'horse_identity', '1'), 1); await db.exec("UPDATE attestations SET expires_at='not-a-date'"); assert.equal(await store.activeAttestationCount(db, 'horse_identity', '1'), 0); await db.exec("UPDATE attestations SET expires_at=NULL; UPDATE issuers SET status='suspended'"); assert.equal(await store.activeAttestationCount(db, 'horse_identity', '1'), 0); assert.equal((await store.publicHorseAttestations(db, 1)).attestations[0].effective_status, 'issuer_suspended'); }); // R98-N04: effective status names the SPECIFIC issuer state (suspended/retired/inactive), not a generic 'inactive'.
for (const field of ['valid_from', 'valid_until'])
    test(`R98 impossible calendar date cannot authorize a command: ${field}`, async () => { const db = await fixture(); const value = field === 'valid_from' ? '2025-02-30 00:00:00' : '2099-02-30 00:00:00'; await db.exec(`UPDATE issuer_memberships SET ${field}='${value}' WHERE id IN ('owner-m','attester-m')`); assert.equal(await grant(db), null); assert.equal(await issue(db), null); assert.equal(await fx.countRows(db, 'audit_events'), 0); });
test('R98 changing validated date bytes before command denies authority', async () => { const db = await fixture(); const raced = { prepare: (...args) => db.prepare(...args), batch: async (statements) => { await db.exec("UPDATE issuer_memberships SET valid_from='2025-02-30 00:00:00' WHERE id='owner-m'"); return db.batch(statements); } }; assert.equal(await grant(raced), null); assert.equal(await fx.countRows(db, 'issuer_management_operations'), 0); });
