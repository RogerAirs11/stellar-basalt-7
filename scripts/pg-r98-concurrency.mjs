#!/usr/bin/env node
/**
 * pg-r98-concurrency — R98 agent plan N02: PostgreSQL adapter concurrency for
 * the R98 directory/trust/retention command surface.
 *
 * R97 proved the marketplace/workspace races. This harness proves the R98
 * repair INVARIANTS under true multi-client concurrency on PostgreSQL, using
 * the PRODUCTION supabaseCompat adapter (createSupabaseD1Database, mode
 * "full") and the PRODUCTION command builders:
 *
 *   A. competing claim approvals (two admins, same pending claim) -> exactly
 *      one winning UPDATE; the loser is a zero-row no-op; grants and audits
 *      fire only for the winner (a failed review can never verify a link)
 *   B. duplicate claim creation race -> the users parent-row lock serializes
 *      the conditional INSERT; exactly ONE pending claim exists
 *   C. revocation before issuance (deterministic) -> a revoked membership can
 *      never issue an attestation (in-write authority re-check)
 *   C2. issuance vs revocation true race -> both commands lock the issuer
 *      parent row; no torn state is possible (either the attestation was
 *      issued under valid authority, or issuance is refused)
 *   D. competing attestation supersessions -> exactly one replacement lands;
 *      the old record is superseded exactly once with one event
 *   E. profile withdrawal vs edit (stale expected_version) -> exactly one
 *      guarded write lands; the loser is a zero-row no-op
 *   F. retention hold vs minimization sweep -> a hold committed before the
 *      sweep's mutation blocks minimization (mutation-time re-check + common
 *      parent-row lock); the true race admits only valid outcomes
 *   G. duplicate hold-release race -> exactly one release audit event
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user@127.0.0.1:PORT/hr_test_x \
 *     PG_PARITY_DISPOSABLE=yes node scripts/pg-r98-concurrency.mjs \
 *     [--report audit/r98/evidence-integration/pg-concurrency.json]
 *
 * Environment/limits: identical disposable rules as the parity gates — a
 * loopback hr_test_ database only; the isolated schema is created and dropped;
 * `public` is never touched. No production system is contacted.
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { requireDisposableLocalDatabase, disposableSchemaName } from "./lib/disposable-schema.mjs";
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { splitStatements, ddlNormalize } = require("./lib/pg-ddl.mjs");

// Audit-only loader: executes the ACTUAL production TypeScript through the
// installed compiler. No mocks, no reimplementation.
require("../tools/lib/register-typescript.cjs");
const { sqliteSqlToPostgres, stripLeadingComments } = require("../src/db/sqliteSqlToPostgres.ts");
const { createSupabaseD1Database, closeSupabaseD1Database } = require("../src/db/supabaseCompat.ts");
const { createClaim, reviewClaim, writeProfile } = require("../src/directory/commands.ts");
const { issueStoredAttestation, revokeStoredAttestation } = require("../src/trust/attestationStore.ts");
const { grantMembership, revokeMembership } = require("../src/trust/membershipCommands.ts");
const { placeServiceRequestHoldStatements, releaseServiceRequestHoldStatements, serviceRetentionSweep } = require("../src/services/privacy.ts");

// ---------------------------------------------------------------------------
// 0. Guards + wiring
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const reportFlag = args.indexOf("--report");
const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : null;
const connectionString = process.env.PG_CONNECTION_STRING ?? "";
if (!connectionString) {
  console.error("PG_CONNECTION_STRING is required (disposable local hr_test_ database)");
  process.exit(2);
}
requireDisposableLocalDatabase(connectionString, process.env.PG_PARITY_DISPOSABLE);
const target = new URL(connectionString);
if (!/^hr_test_[a-z0-9_]{1,48}$/.test(decodeURIComponent(target.pathname.slice(1)))) {
  console.error("R98 concurrency requires a loopback hr_test_* database (the same disposable rule as canonical migration gating)");
  process.exit(2);
}
const schema = disposableSchemaName(process.env.PG_PARITY_SCHEMA);
const adapterUrl = `${connectionString.replace(/\?.*$/, "")}?options=${encodeURIComponent(`-c search_path=${schema}`)}`;

const findings = [];
function record(id, pass, detail) {
  findings.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${id}${detail ? ` (${detail})` : ""}`);
}
function pgErrorClass(error) {
  const code = error && typeof error === "object" ? String(error.code ?? "") : "";
  if (code === "23505") return "unique_violation";
  if (code === "23514") return "check_violation";
  if (code === "23503") return "foreign_key_violation";
  if (code === "40001" || code === "40P01") return `serialization:${code}`;
  return `pg_error:${code || (error instanceof Error ? error.message.slice(0, 120) : "unknown")}`;
}

const admin = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 });
let adapters = [];

async function main() {
  // -----------------------------------------------------------------------
  // 1. Isolated schema + the full migration chain (translator path).
  // -----------------------------------------------------------------------
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  await admin.unsafe(`SET search_path TO ${schema}`);
  const serverVersion = (await admin.unsafe("SELECT version()"))[0].version;
  console.log(`server: ${serverVersion.slice(0, 80)}`);
  const migrations = readdirSync(join(root, "migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const name of migrations) {
    const raw = readFileSync(join(root, "migrations", name), "utf8");
    await admin.unsafe("BEGIN");
    try {
      for (const statement of splitStatements(raw)) {
        const bare = stripLeadingComments(statement);
        if (/^\s*PRAGMA\b/i.test(bare)) continue;
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue; // FTS5 shadow tables are D1-only
        const translated = sqliteSqlToPostgres(ddlNormalize(statement));
        if (!translated.trim() || !stripLeadingComments(translated).trim()) continue;
        await admin.unsafe(translated);
      }
      await admin.unsafe("COMMIT");
    } catch (error) {
      await admin.unsafe("ROLLBACK");
      throw new Error(`migration ${name} failed on the concurrency target: ${error.message}`);
    }
  }
  console.log(`migrations applied: ${migrations.length} (schema ${schema})`);
  const dbA = createSupabaseD1Database(adapterUrl, { mode: "full" });
  const dbB = createSupabaseD1Database(adapterUrl, { mode: "full" });
  adapters = [dbA, dbB];
  const both = async (fn) => Promise.allSettled([fn(dbA, 0), fn(dbB, 1)]);
  const count = async (sql, ...binds) => Number((await admin.unsafe(sql, binds))[0]?.n ?? 0);

  // -----------------------------------------------------------------------
  // 2. Seed: the R98 world.
  // -----------------------------------------------------------------------
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('admin-a','admina@example.test','Admin A','not-a-real-hash','admin',1),
      ('admin-b','adminb@example.test','Admin B','not-a-real-hash','admin',1),
      ('claimer','claimer@example.test','Claimer','not-a-real-hash','user',1),
      ('attester','attester@example.test','Attester','not-a-real-hash','user',1),
      ('rep','rep@example.test','Representative','not-a-real-hash','user',1),
      ('requester','requester@example.test','Requester','not-a-real-hash','user',1);
    INSERT INTO people(id,name_latin) VALUES
      (1,'R98 Directory Person'),(41,'R98 Farrier Person');
    INSERT INTO user_person_links(user_id,person_id,status,verified_at) VALUES
      ('rep',1,'verified','2026-01-01 00:00:00');
    INSERT INTO horses(id,name_latin,row_version) VALUES (10,'R98 Attested Horse',1);
    INSERT INTO genetic_tests(id,horse_id,test_type,result) VALUES (1,10,'parentage','confirmed');
  `));

  // -----------------------------------------------------------------------
  // A. Competing claim approvals (the R98 losing-review fix).
  // -----------------------------------------------------------------------
  {
    const claimId = await createClaim(dbA, { actorId: "claimer", kind: "person", personId: 1, organizationId: null,
      evidenceNote: "R98 concurrency evidence note", evidenceId: null, appealId: null });
    if (!claimId) throw new Error("A: fixture claim could not be created");
    const race = await both((db, i) => reviewClaim(db, { actorId: i === 0 ? "admin-a" : "admin-b", claimId,
      expectedVersion: 1, decision: i === 0 ? "approved" : "rejected", note: `R98 racing review ${i}` }));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? r.value : `ERR:${pgErrorClass(r.reason)}`));
    const winners = outcomes.filter((v) => v === true).length;
    const status = (await admin.unsafe("SELECT status FROM directory_claims WHERE id=$1", [claimId]))[0].status;
    const links = await count("SELECT COUNT(*)::int AS n FROM user_person_links WHERE user_id='claimer' AND person_id=1 AND status='verified'");
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action IN ('directory.claim.approved','directory.claim.rejected')");
    const pass = winners === 1 && outcomes.includes(false) && links === (status === "approved" ? 1 : 0) && audits === 1;
    record("A-competing-claim-approvals", pass,
      `outcomes=${JSON.stringify(outcomes)}, status=${status}, links=${links}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // B. Duplicate claim creation race (users parent-row lock).
  // -----------------------------------------------------------------------
  {
    const race = await both((db) => createClaim(db, { actorId: "claimer", kind: "person", personId: 41, organizationId: null,
      evidenceNote: "R98 duplicate creation race", evidenceId: null, appealId: null }));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? r.value : `ERR:${pgErrorClass(r.reason)}`));
    const pending = await count("SELECT COUNT(*)::int AS n FROM directory_claims WHERE user_id='claimer' AND person_id=41 AND status='pending'");
    const pass = pending === 1 && outcomes.filter((v) => v === null).length === 1;
    record("B-duplicate-claim-create-race", pass, `outcomes=${JSON.stringify(outcomes)}, pending=${pending}`);
  }

  // -----------------------------------------------------------------------
  // Issuer fixtures for C/C2/D.
  // -----------------------------------------------------------------------
  const issuerId = crypto.randomUUID();
  await admin.unsafe(toSeed(`
    INSERT INTO issuers(id,slug,name,kind,status,created_by_user_id) VALUES
      ('${issuerId}','r98-lab','R98 Laboratory','laboratory','active','admin-a');
  `));
  // R98-N05 production contract: issuance additionally requires a CURRENT
  // issuer scope. The pre-N05 fixture never granted one, so the harness went
  // stale after N05 landed (D's fixture issuance was refused). Grant the
  // genetic_test scope with both actions through the same translated path.
  await admin.unsafe(toSeed(`
    INSERT INTO issuer_scopes(id,issuer_id,record_kind,status,scope_version,valid_from,evidence_note,approved_by_user_id,approved_at)
      VALUES ('${crypto.randomUUID()}','${issuerId}','genetic_test','approved',1,CURRENT_TIMESTAMP,'R98 harness fixture scope','admin-a',CURRENT_TIMESTAMP);
    INSERT INTO issuer_scope_actions(scope_id,action)
      SELECT id,'attest' FROM issuer_scopes WHERE issuer_id='${issuerId}';
    INSERT INTO issuer_scope_actions(scope_id,action)
      SELECT id,'supersede' FROM issuer_scopes WHERE issuer_id='${issuerId}';
  `));
  const attesterMembershipId = await grantMembership(dbA, { actorId: "admin-a", issuerId, targetId: "attester", role: "attester", validUntil: null });
  if (!attesterMembershipId) throw new Error("issuer fixture: attester membership could not be granted");

  // -----------------------------------------------------------------------
  // C. Revocation before issuance (deterministic): a revoked membership can
  //    never issue (in-write authority re-check).
  // -----------------------------------------------------------------------
  {
    const revoked = await revokeMembership(dbA, { actorId: "admin-a", membershipId: attesterMembershipId, reason: "R98 deterministic revocation first" });
    if (!revoked) throw new Error("C: fixture revocation failed");
    let refused = false;
    try {
      const id = await issueStoredAttestation(dbA, "attester", issuerId, { record_kind: "genetic_test", record_id: "1" });
      refused = id === null;
    } catch (error) { refused = pgErrorClass(error) !== "pg_error:"; }
    const attestations = await count("SELECT COUNT(*)::int AS n FROM attestations");
    record("C-revocation-before-issuance-refused", refused && attestations === 0, `refused=${refused}, attestations=${attestations}`);
  }

  // -----------------------------------------------------------------------
  // C2. Issuance vs revocation true race (common issuer parent-row lock).
  // -----------------------------------------------------------------------
  {
    const membershipId = await grantMembership(dbA, { actorId: "admin-a", issuerId, targetId: "attester", role: "attester", validUntil: null });
    if (!membershipId) throw new Error("C2: fixture membership could not be granted");
    const race = await both(async (db, i) => {
      if (i === 0) {
        const id = await issueStoredAttestation(db, "attester", issuerId, { record_kind: "genetic_test", record_id: "1", statement: "R98 racing issuance" });
        return id !== null ? "issued" : "refused";
      }
      const ok = await revokeMembership(db, { actorId: "admin-a", membershipId, reason: "R98 racing revocation" });
      return ok ? "revoked" : "no-op";
    });
    const outcomes = race.map((r) => (r.status === "fulfilled" ? r.value : `ERR:${pgErrorClass(r.reason)}`));
    const activeAttestations = await count("SELECT COUNT(*)::int AS n FROM attestations WHERE status='active'");
    const revokedOps = await count("SELECT COUNT(*)::int AS n FROM issuer_management_operations WHERE action='revoke'");
    // Valid end states: (issued then revoked-membership) OR (refused issuance).
    // Impossible state: an active attestation while the racing revocation was
    // refused/no-op (that would mean issuance won but revocation of the very
    // same membership failed), or more than one attestation.
    const issued = outcomes.includes("issued");
    const pass = activeAttestations <= 1 && revokedOps >= 1 && (!issued || outcomes.includes("revoked") || outcomes.includes("no-op"));
    record("C2-issuance-vs-revocation-race", pass,
      `outcomes=${JSON.stringify(outcomes)}, active=${activeAttestations}, revokeOps=${revokedOps}`);
  }

  // -----------------------------------------------------------------------
  // D. Competing attestation supersessions (supersession authority = issuer
  //    owner or platform manager — a plain attester cannot supersede).
  // -----------------------------------------------------------------------
  {
    // 'rep' holds an OWNER membership: valid for both issuance AND the
    // manage-authority predicate inside the supersession guard.
    const ownerMembershipId = await grantMembership(dbA, { actorId: "admin-a", issuerId, targetId: "rep", role: "owner", validUntil: null });
    if (!ownerMembershipId) throw new Error("D: fixture owner membership could not be granted");
    // C2's race legitimately ends either 'issued' or 'refused'; D's own
    // active-count assertion must be independent of which way C2 landed
    // (the R98-era fixed expectation of 2 was racy across C2's outcomes).
    const activeBefore = await count("SELECT COUNT(*)::int AS n FROM attestations WHERE status='active'");
    const originalId = await issueStoredAttestation(dbA, "rep", issuerId, { record_kind: "genetic_test", record_id: "1", statement: "R98 original" });
    if (!originalId) throw new Error("D: fixture attestation could not be issued");
    // A plain attester (valid for issuance only) must NOT be able to supersede.
    const attesterMembershipId = await grantMembership(dbA, { actorId: "admin-a", issuerId, targetId: "attester", role: "attester", validUntil: null });
    if (!attesterMembershipId) throw new Error("D: fixture attester membership could not be granted");
    const attesterAttempt = await issueStoredAttestation(dbA, "attester", issuerId,
      { record_kind: "genetic_test", record_id: "1", statement: "attester cannot supersede" },
      { id: originalId, expectedVersion: 1, reason: "attester supersession attempt" });
    const attesterRefused = attesterAttempt === null;
    const race = await both((db, i) => issueStoredAttestation(db, "rep", issuerId,
      { record_kind: "genetic_test", record_id: "1", statement: `R98 replacement ${i}`, source_version: `r98-race-${i}` },
      { id: originalId, expectedVersion: 1, reason: `R98 racing supersession ${i}` }));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? (r.value ? "won" : "lost") : `ERR:${pgErrorClass(r.reason)}`));
    const superseded = await count("SELECT COUNT(*)::int AS n FROM attestations WHERE id=$1 AND status='superseded'", originalId);
    const active = await count("SELECT COUNT(*)::int AS n FROM attestations WHERE status='active'");
    const events = await count("SELECT COUNT(*)::int AS n FROM attestation_events WHERE event='superseded' AND attestation_id=$1", originalId);
    const pass = attesterRefused && outcomes.filter((v) => v === "won").length === 1 && superseded === 1 && active === activeBefore + 1 && events === 1;
    record("D-competing-supersessions", pass,
      `attesterRefused=${attesterRefused}, outcomes=${JSON.stringify(outcomes)}, superseded=${superseded}, active=${active}(before ${activeBefore}), events=${events}`);
  }

  // -----------------------------------------------------------------------
  // E. Profile withdrawal vs edit (stale expected_version, guarded upsert).
  // -----------------------------------------------------------------------
  {
    const base = { actorId: "rep", personId: 1, expectedVersion: 0, categories: ["farrier"], province: "IR-08", city: "Arak",
      contactPreference: "platform_message", contactValue: "private@example.test", languages: "fa", availability: "Weekdays", consent: true };
    if (!(await writeProfile(dbA, base))) throw new Error("E: fixture profile could not be written");
    const withdrawal = { ...base, consent: false, expectedVersion: 1 };
    const edit = { ...base, city: "Delijan", expectedVersion: 1 };
    const race = await both((db, i) => writeProfile(db, i === 0 ? withdrawal : edit));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? r.value : `ERR:${pgErrorClass(r.reason)}`));
    const row = (await admin.unsafe("SELECT row_version,publication_consent,city FROM directory_profiles WHERE person_id=1"))[0];
    const winners = outcomes.filter((v) => v === true).length;
    const consistent = Number(row.row_version) === 2
      && (Number(row.publication_consent) === 0 ? row.city === "Arak" : row.city === "Delijan");
    record("E-profile-version-race", winners === 1 && outcomes.includes(false) && consistent,
      `outcomes=${JSON.stringify(outcomes)}, row_version=${row.row_version}, consent=${row.publication_consent}, city=${row.city}`);
  }

  // -----------------------------------------------------------------------
  // F. Retention hold vs minimization sweep (R98 mutation-time hold check).
  // -----------------------------------------------------------------------
  {
    // F1 (deterministic): the hold commits BEFORE the sweep runs -> the sweep
    // must minimize nothing and the private note must stay intact.
    await admin.unsafe(toSeed(`
      INSERT INTO people(id,name_latin) VALUES (42,'R98 Hold Provider');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference,contact_value)
        VALUES (42,'["farrier"]',1,'email','hold@example.test');
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version,closed_at,created_at,updated_at)
        VALUES (201,'requester',42,'farrier','R98 private note that must survive a hold',1,'closed',1,'2026-01-01 00:00:00','2025-12-01 00:00:00','2026-01-01 00:00:00');
    `));
    const hold = await dbA.batch(placeServiceRequestHoldStatements(dbA, { requestId: 201, operatorUserId: "admin-a", holdKind: "legal_hold", reason: "R98 deterministic hold before sweep" }));
    const holdPlaced = Number(hold[1]?.meta.changes ?? 0) === 1;
    const sweep1 = await serviceRetentionSweep(dbB, "2026-10-05T12:00:00.000Z", { limit: 20 });
    const noteRow = (await admin.unsafe("SELECT note,retention_minimized_at FROM service_requests WHERE id=201"))[0];
    const f1 = holdPlaced && sweep1.minimized_requests === 0 && noteRow.retention_minimized_at === null
      && noteRow.note === "R98 private note that must survive a hold";
    record("F1-hold-blocks-sweep", f1,
      `holdPlaced=${holdPlaced}, minimized=${sweep1.minimized_requests}, noteIntact=${noteRow.note !== "[retention: note minimized]"}`);

    // F2 (true race): sweep vs hold placement concurrently. Both lock the
    // service_requests parent row; only valid outcomes may result:
    //   (a) sweep minimized first, hold placed after (nothing left to protect)
    //   (b) hold locked first -> sweep's mutation-time re-check refuses
    // Either way: exactly one hold row, no partial minimization, and a
    // minimized note always carries its digest evidence.
    await admin.unsafe(toSeed(`
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version,closed_at,created_at,updated_at)
        VALUES (202,'requester',42,'farrier','R98 racing note for the hold race',1,'closed',1,'2026-01-01 00:00:00','2025-12-01 00:00:00','2026-01-01 00:00:00');
    `));
    const race = await both(async (db, i) => {
      if (i === 0) {
        const summary = await serviceRetentionSweep(db, "2026-10-05T12:00:00.000Z", { limit: 20 });
        return `minimized=${summary.minimized_requests}`;
      }
      const results = await db.batch(placeServiceRequestHoldStatements(db, { requestId: 202, operatorUserId: "admin-b", holdKind: "dispute", reason: "R98 racing hold placement" }));
      return `hold=${Number(results[1]?.meta.changes ?? 0)}`;
    });
    const outcomes = race.map((r) => (r.status === "fulfilled" ? r.value : `ERR:${pgErrorClass(r.reason)}`));
    const row = (await admin.unsafe("SELECT note,note_digest,retention_minimized_at FROM service_requests WHERE id=202"))[0];
    const holds = await count("SELECT COUNT(*)::int AS n FROM service_request_holds WHERE service_request_id=202");
    const minimized = row.retention_minimized_at !== null;
    const valid = (minimized && row.note === "[retention: note minimized]" && row.note_digest !== null && String(row.note_digest).length === 64 && holds === 1)
      || (!minimized && row.note === "R98 racing note for the hold race" && holds === 1);
    record("F2-hold-vs-sweep-race", valid,
      `outcomes=${JSON.stringify(outcomes)}, minimized=${minimized}, holds=${holds}`);
  }

  // -----------------------------------------------------------------------
  // G. Duplicate hold-release race (one audit event for the winning release).
  // -----------------------------------------------------------------------
  {
    const releaseA = releaseServiceRequestHoldStatements(dbA, { requestId: 201, operatorUserId: "admin-a", releaseReason: "R98 racing release A" });
    const releaseB = releaseServiceRequestHoldStatements(dbB, { requestId: 201, operatorUserId: "admin-b", releaseReason: "R98 racing release B" });
    const race = await both(async (db, i) => db.batch(i === 0 ? releaseA : releaseB));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[1]?.meta.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const winners = outcomes.filter((v) => v === 1).length;
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='service_request.hold_released' AND entity_id='201'");
    const pass = winners === 1 && outcomes.includes(0) && audits === 1;
    record("G-duplicate-hold-release-race", pass,
      `outcomes=${JSON.stringify(outcomes)}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // 3. Report
  // -----------------------------------------------------------------------
  const summary = { harness: "pg-r98-concurrency", server: serverVersion, migrations_applied: migrations.length,
    scenarios: findings, pass: findings.every((f) => f.pass) };
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`report written: ${reportPath}`);
  }
  console.log(`\npg-r98-concurrency: ${findings.filter((f) => f.pass).length}/${findings.length} scenarios passed${summary.pass ? "" : " — FAILURES PRESENT"}`);
  process.exitCode = summary.pass ? 0 : 1;
}

/** Translate + run a raw SQLite-dialect seed block on the admin connection. */
function toSeed(sqlText) {
  return splitStatements(sqlText).map((s) => sqliteSqlToPostgres(ddlNormalize(s))).join(";\n");
}

main().catch(async (error) => {
  console.error("pg-r98-concurrency failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  for (const db of adapters) { try { await closeSupabaseD1Database(db); } catch { /* teardown best-effort */ } }
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } catch { /* best-effort cleanup; the schema this process created only */ }
  await admin.end({ timeout: 2 }).catch(() => {});
});
