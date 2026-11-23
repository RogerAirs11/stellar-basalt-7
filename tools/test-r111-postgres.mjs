#!/usr/bin/env node
/**
 * R111 disposable PostgreSQL regression rehearsal.
 *
 * Install the pinned tool OUTSIDE the application, then run:
 *   npm install --prefix /path/to/pg-tools embedded-postgres@18.4.0-beta.17
 *   R111_EMBEDDED_POSTGRES_ROOT=/path/to/pg-tools node tools/test-r111-postgres.mjs
 *
 * Creates its own loopback cluster, database and isolated hr_test_* schema.
 * Never accepts an existing database URL. All objects and credentials are
 * ephemeral. When running as root, it uses existing nobody uid/gid 65534;
 * it never creates a system account or changes existing directory permissions.
 * Uses the production Worker, SQL translator, sessions and PostgreSQL adapter.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, cp, mkdir, chmod, chown, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyMigrationChain } from '../scripts/lib/pg-ddl.mjs';
import { createOwnedSchema, disposableSchemaName, requireDisposableLocalDatabase } from '../scripts/lib/disposable-schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require('./lib/register-typescript.cjs');
const worker = require('../src/worker.ts').default;
const { createSupabaseD1Database, closeSupabaseD1Database } = require('../src/db/supabaseCompat.ts');
const { seedUser, makeSession, authedRequest } = require('../tests/helpers/realDatabase.ts');
const { parseUtcTimestamp } = require('../src/shared/utcTimestamp.ts');
const { utcTimestampMillisSql } = require('../src/shared/utcTimestampSql.ts');
const { listListings, isActiveSponsoredPlacement } = require('../src/api/modules/marketplace.ts');
const { images } = JSON.parse(await readFile(join(root, 'tests/fixtures/media-r111/images.json'), 'utf8'));
const timestampCases = JSON.parse(await readFile(join(root, 'tests/fixtures/r111-timestamps.json'), 'utf8'));
const output = join(root, 'review-r111/evidence/postgres');
const report = { started_at: new Date().toISOString(), boundary: 'Disposable loopback PostgreSQL; actual Worker Request/Response and production adapter; no live deployment', checks: [] };
await mkdir(output, { recursive: true });
let temporary, child, admin, seedDb, ownedSchema;
let childLogs = '';

function pass(id, detail) {
  report.checks.push({ id, pass: true, detail });
  console.log(`PASS ${id}: ${detail}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((res, rej) => server.listen(0, '127.0.0.1', res).once('error', rej));
  const port = server.address().port;
  await new Promise((res, rej) => server.close(error => error ? rej(error) : res()));
  return port;
}

async function startCluster() {
  const installation = process.env.R111_EMBEDDED_POSTGRES_ROOT;
  if (!installation) throw new Error('R111_EMBEDDED_POSTGRES_ROOT must name an external pinned embedded-postgres installation.');
  const manifest = JSON.parse(await readFile(join(installation, 'node_modules/embedded-postgres/package.json'), 'utf8'));
  assert.equal(manifest.version, '18.4.0-beta.17', 'Use the documented pinned rehearsal runtime');
  report.embedded_postgres = manifest.version;
  temporary = await mkdtemp(join(process.env.R111_PG_TEMP_ROOT || tmpdir(), 'hr_test_r111_'));
  // A copy permits the existing unprivileged child to traverse the binaries
  // even when the developer's workspace parents are private to root.
  await chmod(temporary, 0o755);
  await cp(join(installation, 'node_modules'), join(temporary, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const data = join(temporary, 'data');
  const files = join(temporary, 'tmp');
  await mkdir(data, { mode: 0o700 });
  await mkdir(files, { mode: 0o700 });
  const dropRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (dropRoot) { await chown(data, 65534, 65534); await chown(files, 65534, 65534); }
  const password = randomBytes(24).toString('hex');
  const port = await freePort();
  const database = `hr_test_r111_${randomBytes(8).toString('hex')}`;
  const bootFile = join(temporary, 'boot.mjs');
  await writeFile(bootFile, `
import EmbeddedPostgres from './node_modules/embedded-postgres/dist/index.js';
const pg = new EmbeddedPostgres({databaseDir:process.env.R111_PG_DATA, user:'postgres', password:process.env.R111_PG_PASSWORD,
  port:Number(process.env.R111_PG_PORT), persistent:false, createPostgresUser:false,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+process.env.R111_PG_DATA],
  onLog:()=>{}, onError:error=>process.stderr.write(String(error)+'\\n')});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await pg.stop();}finally{process.exit(0);}}
process.on('message',message=>{if(message==='stop')void stop();});
process.on('disconnect',()=>void stop());
process.on('SIGTERM',()=>void stop());
try{await pg.initialise();await pg.start();await pg.createDatabase(process.env.R111_PG_DATABASE);process.send({ready:true});}
catch(error){process.stderr.write(String(error)+'\\n');await pg.stop().catch(()=>{});process.exit(1);}
`, { mode: 0o644 });
  child = spawn(process.execPath, [bootFile], { cwd: temporary, ...(dropRoot ? { uid: 65534, gid: 65534 } : {}),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, TMPDIR: files,
      R111_PG_DATA: data, R111_PG_PASSWORD: password, R111_PG_PORT: String(port), R111_PG_DATABASE: database } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childLogs = (childLogs + String(chunk)).slice(-20_000); });
  await new Promise((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('Disposable PostgreSQL startup exceeded 45 seconds')), 45_000);
    const exited = code => { clearTimeout(timeout); rej(new Error(`Disposable PostgreSQL startup exited ${code}: ${childLogs}`)); };
    child.once('exit', exited);
    child.once('error', error => { clearTimeout(timeout); rej(error); });
    child.on('message', message => { if (message?.ready) { clearTimeout(timeout); child.off('exit', exited); res(); } });
  });
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/${database}`;
  requireDisposableLocalDatabase(url, 'yes');
  assert.match(database, /^hr_test_[a-z0-9_]+$/);
  report.cluster = { host: '127.0.0.1', disposable_database_prefix: 'hr_test_', process_uid: dropRoot ? 65534 : process.getuid?.() };
  return url;
}

try {
  const connection = await startCluster();
  admin = postgres(connection, { max: 1, connect_timeout: 8, onnotice: () => {} });
  report.postgres_version = (await admin.unsafe('SELECT version()'))[0].version;
  ownedSchema = await createOwnedSchema(admin, disposableSchemaName());
  await admin.unsafe(`SET search_path TO ${ownedSchema}`);
  report.migrations = await applyMigrationChain(admin);
  pass('migrations', `${report.migrations.applied} migrations through the production SQL translator; ${report.migrations.skippedFts} SQLite-only FTS declarations skipped`);
  const target = `${connection}?options=${encodeURIComponent(`-c search_path=${ownedSchema}`)}`;
  seedDb = createSupabaseD1Database(target, { mode: 'full' });
  const secret = randomBytes(32).toString('hex');
  const users = { owner: ['pg-owner', 'owner'], other: ['pg-other', 'owner'], admin: ['pg-admin', 'admin'], a: ['pg-editor-a', 'editor'], b: ['pg-editor-b', 'editor'] };
  const sessions = {};
  for (const [key, [id, role]] of Object.entries(users)) { await seedUser(seedDb, id, role); sessions[key] = await makeSession(seedDb, id); }
  await admin.unsafe(`INSERT INTO horses(id,name_latin,sex_desc) VALUES(9101,'Fictional sire','Stallion'),(9102,'Fictional dam','Mare');
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
      VALUES('pg-owner-grant',9101,'pg-owner','owner','manage_profile,upload_media,create_listing','admin_grant','2000-01-01 00:00:00');`);
  const number = async (query, values = []) => Number((await admin.unsafe(query, values))[0].n);
  async function request(path, body, actor, options = {}) {
    const db = createSupabaseD1Database(target, { mode: 'full' });
    const wired = options.wrap ? options.wrap(db) : db;
    try {
      const response = await worker.fetch(authedRequest(path, body, { session: sessions[actor], method: options.method,
        headers: options.key ? { 'idempotency-key': options.key } : undefined }), {
        DB: wired, APP_ENV: 'test', DB_PROVIDER_MODE: 'd1_full', SESSION_COOKIE_NAME: 'hr_session', MEDIA_ACCESS_TOKEN_SECRET: secret,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      let json; try { json = JSON.parse(text); } catch { /* binary is intentionally retained */ }
      return { status: response.status, json, text, bytes, headers: response.headers };
    } finally { await closeSupabaseD1Database(db); }
  }
  async function upload(extra = {}) {
    const reply = await request('/api/horses/9101/media', { media_type: 'photo', role: 'gallery', file_name: 'FICTIONAL.png',
      mime_type: 'image/png', data_base64: images['metadata.png'].base64, ...extra }, 'owner');
    assert.equal(reply.status, 201, reply.text); return reply.json.media;
  }
  const publication = (id, state, version, options = {}) => request(`/api/media/${id}/publication`, { consent_state: state, expected_version: version }, 'owner', options);
  const review = (id, version, decision = 'platform_reviewed', actor = 'admin') => request(`/api/admin/media/${id}/verify`, { expected_version: version, decision }, actor);
  const access = async (id, actor = 'owner') => { const r = await request(`/api/media/${id}/access`, {}, actor); assert.equal(r.status, 201, r.text); return r.json; };

  const media = await upload();
  assert.equal((await request(`/api/media/file/${media.id}`)).status, 404);
  assert.equal((await request(`/api/media/file/${media.id}`, undefined, 'owner')).status, 200);
  assert.equal((await review(media.id, 1)).status, 200);
  assert.equal((await request(`/api/media/file/${media.id}`)).status, 404);
  assert.deepEqual((await request('/api/horses/9101/media')).json.counts, { photos: 0, documents: 0, verified: 0 });
  pass('private-review', 'Private upload delivers only to authorized reader; editorial approval leaves public metadata, counts and bytes private');

  const keys = [randomUUID(), randomUUID()];
  const competing = await Promise.all(keys.map(key => publication(media.id, 'shared_public', 2, { key })));
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409], JSON.stringify(competing.map(r => r.json)));
  assert.equal(await number("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id=$1 AND action='media.publication'", [media.id]), 1);
  assert.equal(await number('SELECT COUNT(*) AS n FROM media_consent_receipts WHERE media_id=$1', [media.id]), 1);
  const winningKey = keys[competing.findIndex(r => r.status === 200)];
  const replay = await publication(media.id, 'shared_public', 2, { key: winningKey });
  assert.equal(replay.status, 200, replay.text); assert.equal(replay.json.replayed, true);
  assert.equal((await publication(media.id, 'private', 2, { key: winningKey })).status, 409);
  pass('publication-cas-replay', 'Two real connections: one publication and one 409, one audit and receipt; same intent replays and changed intent conflicts');

  const visible = await request('/api/horses/9101/media');
  assert.deepEqual(visible.json.counts, { photos: 1, documents: 0, verified: 1 });
  assert.equal(visible.json.media[0].public_visible, true);
  assert.equal(typeof visible.json.media[0].row_version, 'number');
  assert.equal('uploaded_by_user_id' in visible.json.media[0], false);
  const file = await request(`/api/media/file/${media.id}`);
  assert.equal(file.status, 200); assert.equal(file.text.includes('SYNTHETIC-'), false);
  assert.equal(file.headers.get('cache-control'), 'private, no-store');
  pass('public-projection-bytes', 'Public list/count/file agree, internal uploader is absent, PostgreSQL int8 is normalized, served metadata sentinels removed');

  const publicLink = await access(media.id, 'other');
  assert.equal((await request(publicLink.url)).status, 200);
  assert.equal((await publication(media.id, 'private', 3)).status, 200);
  assert.equal((await request(publicLink.url)).status, 404);
  const first = await access(media.id), second = await access(media.id), staff = await access(media.id, 'admin');
  assert.notEqual(first.grant_id, second.grant_id);
  assert.equal((await request(`/api/media/${media.id}/access/${first.grant_id}`, undefined, 'owner', { method: 'DELETE' })).status, 200);
  assert.equal((await request(first.url)).status, 404); assert.equal((await request(second.url)).status, 200);
  await admin.unsafe("UPDATE users SET role='user' WHERE id='pg-admin'");
  assert.equal((await request(staff.url)).status, 404);
  await admin.unsafe("UPDATE users SET role='admin' WHERE id='pg-admin'");
  await admin.unsafe("UPDATE users SET is_active=0 WHERE id='pg-owner'");
  assert.equal((await request(second.url)).status, 404);
  await admin.unsafe("UPDATE users SET is_active=1 WHERE id='pg-owner'");
  pass('exact-grants-current-authority', 'Withdrawal revokes previous URLs; exact one-grant revocation preserves the second; live staff role and account deactivation deny old links');

  const raced = await access(media.id, 'owner');
  const revoke = await request(`/api/media/${media.id}/access/${raced.grant_id}`, undefined, 'admin', { method: 'DELETE', wrap(db) {
    const outer = Object.create(db);
    outer.prepare = sql => {
      const original = db.prepare(sql);
      if (!/^UPDATE media_access_grants SET revoked_at=/.test(sql)) return original;
      return { bind(...values) { const bound = original.bind(...values); return { async run() {
        await admin.unsafe("UPDATE users SET role='user' WHERE id='pg-admin'");
        return bound.run();
      } }; } };
    };
    return outer;
  } });
  assert.equal(revoke.status, 409, revoke.text);
  assert.equal(await number('SELECT COUNT(*) AS n FROM media_access_grants WHERE token_binding=$1 AND revoked_at IS NULL', [raced.grant_id]), 1);
  assert.equal((await request(raced.url)).status, 200);
  await admin.unsafe("UPDATE users SET role='admin' WHERE id='pg-admin'");
  pass('revoke-authority-interleave', 'Staff authority removed on a separate connection after grant lookup: guarded write changes zero, truthful 409, still-live owner URL not reported revoked');

  const blockedPublication = await publication(media.id, 'shared_public', 4, { key: randomUUID(), wrap(db) {
    const outer = Object.create(db); outer.batch = async statements => {
      await admin.unsafe("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='pg-owner-grant'");
      return db.batch(statements);
    }; return outer;
  } });
  assert.equal(blockedPublication.status, 403, blockedPublication.text);
  assert.equal(await number('SELECT row_version AS n FROM horse_media WHERE id=$1', [media.id]), 4);
  assert.equal(await number("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id=$1 AND action='media.publication'", [media.id]), 2);
  await admin.unsafe("UPDATE horse_access_grants SET revoked_at=NULL WHERE id='pg-owner-grant'");
  pass('publication-grant-interleave', 'Horse upload grant revoked after initial authorization: no publication, version, receipt or audit side effect');

  const doc = await upload({ media_type: 'document', role: 'passport' });
  await admin.unsafe("UPDATE horse_media SET consent_state='shared_public',verification='federation_verified' WHERE id=$1", [doc.id]);
  const rejected = await upload();
  await admin.unsafe("UPDATE horse_media SET consent_state='shared_public',verification='rejected' WHERE id=$1", [rejected.id]);
  const quarantine = await upload();
  await admin.unsafe("UPDATE horse_media SET consent_state='shared_public',verification='federation_verified',quarantine_reason='Private operator reason' WHERE id=$1", [quarantine.id]);
  const safeList = await request('/api/horses/9101/media');
  assert.deepEqual(safeList.json.counts, { photos: 0, documents: 0, verified: 0 });
  for (const id of [doc.id, rejected.id, quarantine.id]) assert.equal((await request(`/api/media/file/${id}`)).status, 404);
  pass('legacy-negative-matrix', 'Legacy consent flags cannot expose documents, rejected rows or reason-only quarantine through metadata/count/file paths');

  const avif = await request('/api/horses/9101/media', { media_type: 'photo', role: 'gallery', file_name: 'fictional.avif', mime_type: 'image/avif', data_base64: images['metadata.avif'].base64 }, 'owner');
  assert.equal(avif.status, 415); assert.equal(await number('SELECT COUNT(*) AS n FROM horse_media'), 4);
  pass('avif-fail-closed', 'Unsupported AVIF refuses before a media row is written');

  const correction = extra => ({ expected_version: 1, operation_id: randomUUID(), covering_date: '2026-04-16', season: 1405, reason: 'Corrected against a fictional covering record', ...extra });
  await admin.unsafe(`INSERT INTO breeding_records(id,sire_id,dam_id,covering_date,season,provenance)
    VALUES(9501,9101,9102,'2026-04-15',1405,'demo'),(9502,9101,9102,'2026-04-15',1405,'demo'),(9503,9101,9102,'2026-04-15',1405,'demo'),(9504,9101,9102,'2026-04-15',1405,'demo');`);
  const intents = [correction(), correction({ covering_date: '2026-04-17' })];
  const correctRace = await Promise.all(['a', 'b'].map((actor, index) => request('/api/admin/breeding/9501/correct', intents[index], actor)));
  assert.deepEqual(correctRace.map(r => r.status).sort(), [200, 409], JSON.stringify(correctRace.map(r => r.json)));
  assert.equal(await number('SELECT COUNT(*) AS n FROM breeding_record_corrections WHERE record_id=9501'), 1);
  assert.equal(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='breeding.record.corrected' AND entity_id='9501'"), 1);
  const winIndex = correctRace.findIndex(r => r.status === 200);
  const correctReplay = await request('/api/admin/breeding/9501/correct', intents[winIndex], ['a', 'b'][winIndex]);
  assert.equal(correctReplay.status, 200); assert.equal(correctReplay.json.replayed, true);
  pass('breeding-correction-cas', 'Two editors / real connections: exactly one correction, one receipt, one audit; winning intent replays');

  const duplicate = correction();
  const recordRace = await Promise.all([9502, 9503].map(id => request(`/api/admin/breeding/${id}/correct`, duplicate, 'a')));
  assert.deepEqual(recordRace.map(r => r.status).sort(), [200, 409], JSON.stringify(recordRace.map(r => r.json)));
  assert.equal(await number('SELECT COUNT(*) AS n FROM breeding_records WHERE id IN (9502,9503) AND row_version=2'), 1);
  assert.equal(await number('SELECT COUNT(*) AS n FROM breeding_record_corrections WHERE operation_id=$1', [duplicate.operation_id]), 1);
  pass('breeding-operation-collision', 'One operation races onto two records: unique receipt conflict rolls back the losing record, normalized 409');

  const deactivated = await request('/api/admin/breeding/9504/correct', correction(), 'a', { wrap(db) {
    const outer = Object.create(db); outer.batch = async statements => {
      await admin.unsafe("UPDATE users SET is_active=0 WHERE id='pg-editor-a'"); return db.batch(statements);
    }; return outer;
  } });
  assert.equal(deactivated.status, 409, deactivated.text);
  assert.equal(await number('SELECT row_version AS n FROM breeding_records WHERE id=9504'), 1);
  assert.equal(await number('SELECT COUNT(*) AS n FROM breeding_record_corrections WHERE record_id=9504'), 0);
  await admin.unsafe("UPDATE users SET is_active=1 WHERE id='pg-editor-a'");
  pass('breeding-authority-interleave', 'Editor deactivated between read and write: no correction, version or receipt');

  await admin.unsafe(`INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,lab_accession,notes)
    VALUES(9601,9101,'CA','disease','N/CA',1,'demo','PRIVATE-ACCESSION','PRIVATE-NOTE'),(9602,9102,'CA','disease','N/CA',1,'demo','PRIVATE-ACCESSION','PRIVATE-NOTE');`);
  const mapping = extra => ({ assay_key: 'CA', expected_version: 0, expected_test_type: 'CA', expected_result: 'N/CA', state: 'accepted', reason: 'Reviewed fictional genotype for a synthetic demonstration', ...extra });
  const unmapped = await request('/api/breeding/pairing-evidence?sire=9101&dam=9102');
  assert.equal(unmapped.status, 200, unmapped.text); assert.equal(unmapped.json.calculableVariants, 0);
  const mappingRace = await Promise.all(['a', 'b'].map(actor => request('/api/admin/genetic-tests/9601/pairing-review', mapping(), actor)));
  assert.deepEqual(mappingRace.map(r => r.status).sort(), [200, 409], JSON.stringify(mappingRace.map(r => r.json)));
  assert.equal(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='genetic.pairing_review.accepted'"), 1);
  assert.equal((await request('/api/admin/genetic-tests/9602/pairing-review', mapping(), 'a')).status, 200);
  pass('pairing-first-review-cas', 'Unmapped free text stays unknown; concurrent first reviews produce one accepted row and audit, one stale 409');

  const evidence = await request('/api/breeding/pairing-evidence?sire=9101&dam=9102');
  assert.equal(evidence.status, 200); assert.equal(evidence.json.syntheticEvidence, true);
  assert.deepEqual(evidence.json.variants.find(v => v.variant === 'CA').probabilities, { zeroVariantCopies: .25, oneVariantCopy: .5, twoVariantCopies: .25 });
  assert.doesNotMatch(evidence.text, /PRIVATE-ACCESSION|PRIVATE-NOTE/);
  assert.equal((await request('/api/admin/genetic-tests/9601/pairing-review', mapping({ expected_version: 1, state: 'withdrawn' }), 'a')).status, 200);
  assert.equal((await request('/api/breeding/pairing-evidence?sire=9101&dam=9102')).json.calculableVariants, 0);
  pass('pairing-public-safe-withdrawal', 'Explicit synthetic mappings yield 25/50/25 without private raw fields; withdrawal immediately removes calculability');

  for (const item of timestampCases) {
    const row = await seedDb.prepare(`SELECT ${utcTimestampMillisSql('candidate.stamp')} AS value FROM (SELECT ? AS stamp) candidate`).bind(item.value).first();
    assert.equal(row.value, parseUtcTimestamp(item.value), item.label);
  }
  pass('sponsorship-sql-parser-parity', `${timestampCases.length} grammar/calendar/fraction/offset/trim cases match parseUtcTimestamp through the production PostgreSQL adapter, including invalid text without query failures`);
  for (const [index, item] of timestampCases.entries()) {
    await seedDb.prepare('INSERT INTO horses(id,name_latin) VALUES(?,?)').bind(18000 + index, `Fictional ${item.label}`).run();
    await seedDb.prepare("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,sponsored_until,listed_at) VALUES(?,?,'pg-owner','Fictional seller','active',?,'2026-10-01 00:00:00')")
      .bind(`sponsor-${String(index).padStart(3, '0')}`, 18000 + index, item.value).run();
  }
  const fixedTime = Date.parse('2026-10-17T12:00:00Z');
  const expectedOrder = timestampCases.map((item, index) => ({ id: `sponsor-${String(index).padStart(3, '0')}`, active: isActiveSponsoredPlacement(item.value, fixedTime) }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id));
  const listingResponse = await (await listListings(seedDb, new URL('https://registry.example/api/marketplace?limit=60'), fixedTime)).json();
  assert.deepEqual(listingResponse.rows.map(row => row.id), expectedOrder.map(row => row.id));
  for (const row of listingResponse.rows) {
    assert.equal(row.sponsored, isActiveSponsoredPlacement(row.sponsored_until, fixedTime));
    assert.deepEqual(row.sponsored_label, row.sponsored ? { en: 'Sponsored', fa: 'تبلیغ' } : null);
    assert.equal('sponsored_active' in row, false);
  }
  const paginated = await (await listListings(seedDb, new URL('https://registry.example/api/marketplace?limit=7&offset=5'), fixedTime)).json();
  assert.deepEqual(paginated.rows.map(row => row.id), expectedOrder.slice(5, 12).map(row => row.id));
  const afterMillisecond = await (await listListings(seedDb, new URL('https://registry.example/api/marketplace?limit=60'), fixedTime + 1)).json();
  for (const row of afterMillisecond.rows) assert.equal(row.sponsored, isActiveSponsoredPlacement(row.sponsored_until, fixedTime + 1));
  pass('sponsorship-order-label-pagination', 'Actual listing SELECT, ordering, labels and pagination share strict SQL eligibility and one bound clock; equal and malformed paid expiries are inactive');
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
  console.error(`FAIL R111 PostgreSQL: ${report.error.message}`);
  process.exitCode = 1;
} finally {
  if (seedDb) await closeSupabaseD1Database(seedDb).catch(() => {});
  if (admin) {
    if (ownedSchema) await admin.unsafe(`DROP SCHEMA ${ownedSchema} CASCADE`).catch(error => { report.cleanup_error = String(error); process.exitCode = 1; });
    await admin.end({ timeout: 2 }).catch(() => {});
  }
  if (child && child.exitCode === null) {
    await new Promise(resolveStop => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); resolveStop(); }, 10_000);
      child.once('exit', () => { clearTimeout(timer); resolveStop(); });
      if (child.connected) child.send('stop'); else child.kill('SIGTERM');
    });
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
  report.finished_at = new Date().toISOString();
  report.cleanup = { owned_schema_dropped: !report.cleanup_error, temporary_cluster_removed: Boolean(temporary), child_exit: child?.exitCode };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (!report.pass && childLogs) await writeFile(join(output, 'startup-error.txt'), childLogs);
  else if (report.pass) await rm(join(output, 'startup-error.txt'), { force: true });
  console.log(`${report.checks.length} PostgreSQL checks completed; report: review-r111/evidence/postgres/report.json`);
}
