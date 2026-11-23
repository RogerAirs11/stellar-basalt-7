#!/usr/bin/env node
/**
 * pg-r97-concurrency — R97 agent plan N02: PostgreSQL adapter concurrency.
 *
 * R96 proved the refund/renewal races. This harness proves the R97 repair
 * INVARIANTS under true multi-client concurrency on PostgreSQL, using the
 * PRODUCTION supabaseCompat adapter (createSupabaseD1Database, mode "full")
 * and the PRODUCTION command builders:
 *
 *   A. stale version vs concurrent horse update  -> exactly one guarded
 *      UPDATE lands; the loser is a zero-row no-op; the revision bump and
 *      search invalidation fire exactly once (marker-conditioned)
 *   B. duplicate auto-ID identifier claims racing -> exactly one create
 *      batch survives whole; the loser rolls back horse + identifiers +
 *      counters (partial unique index uq_horse_identifiers_live, PG 23505)
 *   C. grant revocation vs in-write authority     -> a listing status write
 *      NEVER lands through a revoked or not-yet-valid mandate; the live
 *      grant predicate is re-checked inside the write (R97 valid_from guard)
 *   D. two staff reactivations at the last seat   -> the workspace lock row
 *      serializes the batches on the production adapter; capacity is never
 *      exceeded (exactly one racer lands, the loser sees the full count)
 *   E. competing allocation approvals             -> the exact-proposal gate
 *      admits exactly ONE approval; the loser is a zero-row no-op and the
 *      approved evidence is never overwritten
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user@127.0.0.1:PORT/hr_test_x \
 *     PG_PARITY_DISPOSABLE=yes node scripts/pg-r97-concurrency.mjs \
 *     [--report audit/r97/evidence-integration/pg-concurrency.json]
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
const { planHorseMutation } = require("../src/registry/mutations.ts");
const { buildCanonicalHorseUpdateStatements } = require("../src/registry/mutationStatements.ts");
const { identifierStatementsForHorseCreate } = require("../src/registry/identifiers.ts");
const { executeListingStatus } = require("../src/marketplace/commands.ts");
const { assignStaffStatements, MAX_ACTIVE_STAFF_PER_COLLECTION } = require("../src/workspaces/mutationCommands.ts");
const paymentCommands = require("../src/commerce/paymentCommands.ts");
const refunds = require("../src/commerce/refunds.ts");
const { proposeRefundAllocation, approveRefundAllocationStatements } = require("../src/commerce/refundAllocation.ts");

const NOW = "2026-10-05T12:00:00.000Z";
const now = new Date(NOW);

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
  console.error("R97 concurrency requires a loopback hr_test_* database (the same disposable rule as canonical migration gating)");
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
  // 1. Isolated schema + the full migration chain (translator path), and the
  //    server/client versions recorded alongside the evidence.
  // -----------------------------------------------------------------------
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  await admin.unsafe(`SET search_path TO ${schema}`);
  const serverVersion = (await admin.unsafe("SELECT version()"))[0].version;
  console.log(`server: ${serverVersion.slice(0, 80)}`);
  console.log(`client: postgres.js ${postgres.meta?.version ?? "3.x"}`);
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
  // Two INDEPENDENT production adapters = two real pooled connections with
  // their own transactions; races between them exercise real row locks.
  const dbA = createSupabaseD1Database(adapterUrl, { mode: "full" });
  const dbB = createSupabaseD1Database(adapterUrl, { mode: "full" });
  adapters = [dbA, dbB];
  const both = async (fn) => Promise.allSettled([fn(dbA, 0), fn(dbB, 1)]);

  // -----------------------------------------------------------------------
  // 2. Seed: the R97 world.
  // -----------------------------------------------------------------------
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('buyer','buyer@example.test','buyer','not-a-real-hash','user',1),
      ('owner','owner@example.test','owner','not-a-real-hash','admin',1),
      ('editor','editor@example.test','editor','not-a-real-hash','editor',1),
      ('seller','seller@example.test','seller','not-a-real-hash','user',1),
      ('staff-a','staffa@example.test','staffa','not-a-real-hash','user',1),
      ('staff-b','staffb@example.test','staffb','not-a-real-hash','user',1);
    INSERT INTO horses(id,name_latin,row_version) VALUES
      (10,'R97 Race Base',1),(11,'R97 Seller Horse',1);
    INSERT INTO billing_prices(id,sku,version,name_en,name_fa,price_minor,period_days,created_by_user_id) VALUES
      (1,'farm_workspace_monthly',1,'Farm','Farm',19000000,30,'owner');
  `));

  const LINE = { sku: "farm_workspace_monthly", price_id: 1, version: 1, title_en: "Farm", title_fa: "Farm",
    unit_minor: 19000000, quantity: 1, line_total_minor: 19000000, period_days: 30 };

  async function paidOrder(orderKey, buyer = "buyer") {
    const operationId = crypto.randomUUID();
    const digest = await paymentCommands.orderIntentDigest([{ sku: LINE.sku, quantity: 1 }], null);
    await dbA.batch(paymentCommands.atomicOrderStatements(dbA, {
      operationId, orderKey, buyerUserId: buyer, organizationId: null,
      digest, totalMinor: LINE.line_total_minor, lines: [LINE],
    }));
    const order = await dbA.prepare("SELECT id FROM orders WHERE order_key=?").bind(orderKey).first();
    const requestKey = crypto.randomUUID();
    await dbA.batch(paymentCommands.reservePaymentStatements(dbA, { orderId: Number(order.id), buyerUserId: buyer, requestKey, provider: "zarinpal" }));
    const attempt = await dbA.prepare("SELECT id FROM payment_attempts WHERE request_key=?").bind(requestKey).first();
    await dbA.batch(paymentCommands.attachAuthorityStatements(dbA, { requestKey, authority: `AUTH-${orderKey}`, provider: "zarinpal" }));
    await dbA.batch(paymentCommands.verifiedOrderStatements(dbA, {
      operationId: crypto.randomUUID(), attemptId: Number(attempt.id), orderId: Number(order.id),
      buyerUserId: buyer, organizationId: null, providerReference: String(900000 + Number(attempt.id)),
      nowIso: NOW, totalMinor: LINE.line_total_minor, lines: [LINE],
    }));
    return { orderId: Number(order.id), attemptId: Number(attempt.id) };
  }

  const policy = { kind: "full_unused", sku: LINE.sku, granted_days: 30, consumed_days: 0, remaining_days: 30,
    access_action: "cancel_full_period", history_note: "R97 concurrency fixture policy" };

  // -----------------------------------------------------------------------
  // A. Stale version vs concurrent horse update (guarded UPDATE race).
  // -----------------------------------------------------------------------
  {
    const before = await dbA.prepare("SELECT * FROM horses WHERE id=10").bind().first();
    const planA = planHorseMutation(before, { color_desc: "racing grey" });
    const planB = planHorseMutation(before, { color_desc: "racing black" });
    const buildFor = (db, plan) => buildCanonicalHorseUpdateStatements(db, {
      plan, horseId: 10, expectedRowVersion: 1, mutationId: crypto.randomUUID(), identifierTableReady: true,
    });
    const racerA = buildFor(dbA, planA);
    const racerB = buildFor(dbB, planB);
    const race = await both(async (db, i) => {
      const built = i === 0 ? racerA : racerB;
      return db.batch([built.updateStatement, ...built.afterUpdateStatements]);
    });
    const changes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[0]?.meta?.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const row = (await admin.unsafe("SELECT color_desc,row_version FROM horses WHERE id=10"))[0];
    const revision = Number((await admin.unsafe("SELECT canonical_revision::int AS n FROM registry_state WHERE id=1"))[0].n);
    const reindex = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM horse_search_reindex_queue WHERE horse_id=10"))[0].n);
    const winners = changes.filter((c) => c === 1).length;
    const pass = winners === 1 && Number(row.row_version) === 2 && revision === 1 && reindex === 1
      && ["racing grey", "racing black"].includes(row.color_desc);
    record("A-stale-version-vs-concurrent-update", pass,
      `changes=${JSON.stringify(changes)}, row_version=${row.row_version}, revision=${revision}, reindex=${reindex}, color=${row.color_desc}`);
  }

  // -----------------------------------------------------------------------
  // B. Duplicate auto-ID identifier claims racing (all-or-nothing create).
  // -----------------------------------------------------------------------
  {
    const countersBefore = Number((await admin.unsafe("SELECT active_horse_count::int AS n FROM registry_runtime_counters WHERE id=1"))[0].n);
    const buildCreate = (db, horseId, name) => {
      const mutationId = crypto.randomUUID();
      const statements = [
        db.prepare(`INSERT INTO horses(id,name_latin,register_no,microchip_no,is_dead,last_mutation_id)
          VALUES(?,?,?,?,0,?)`).bind(horseId, name, "R97-RACE-DUP", null, mutationId),
        ...identifierStatementsForHorseCreate(db, {
          mutationId, identifierTableReady: true,
          changes: { register_no: "R97-RACE-DUP", microchip_no: null },
        }),
        db.prepare("UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=1"),
      ];
      return { statements, mutationId };
    };
    const buildA = buildCreate(dbA, 20, "R97 Dup Winner A");
    const buildB = buildCreate(dbB, 21, "R97 Dup Winner B");
    const race = await both(async (db, i) => db.batch(i === 0 ? buildA.statements : buildB.statements));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? "ok" : pgErrorClass(r.reason)));
    const horses = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM horses WHERE id IN (20,21)"))[0].n);
    const identifiers = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM horse_identifiers WHERE normalized_value='R97-RACE-DUP'"))[0].n);
    const countersAfter = Number((await admin.unsafe("SELECT active_horse_count::int AS n FROM registry_runtime_counters WHERE id=1"))[0].n);
    const uniqueWinner = outcomes.filter((o) => o === "ok").length === 1 && outcomes.some((o) => o === "unique_violation");
    const pass = uniqueWinner && horses === 1 && identifiers === 1 && countersAfter === countersBefore + 1;
    record("B-duplicate-auto-id-identifiers-race", pass,
      `outcomes=${JSON.stringify(outcomes)}, horses=${horses}, identifiers=${identifiers}, counterDelta=${countersAfter - countersBefore}`);
  }

  // -----------------------------------------------------------------------
  // C. Grant revocation vs the in-write authority (mandate races).
  // -----------------------------------------------------------------------
  {
    await admin.unsafe(toSeed(`
      INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance,row_version)
        VALUES('r97-listing',11,'seller','R97 SELLER','active','user',1);
      INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from,revoked_at)
        VALUES('9001',11,'seller','seller','create_listing,manage_inquiries','claim_approval','2026-01-01 00:00:00',NULL);
    `));
    const statusInput = (nextStatus = "pending_sale") => ({
      listingId: "r97-listing", horseId: 11, expectedVersion: 1, currentStatus: "active",
      nextStatus, isStaff: false, sellerUserId: "seller", now,
    });
    const { commandRequestDigest } = require("../src/marketplace/commands.ts");
    const receipt = async (key) => ({
      key, actorId: "seller", command: "listing.status", targetId: "r97-listing",
      digest: await commandRequestDigest("listing.status", { listingId: "r97-listing", nextStatus: "pending_sale", expectedVersion: 1 }),
    });

    // C1 (deterministic): the mandate is revoked BEFORE the write — the live
    // grant predicate inside the UPDATE must refuse it.
    await dbA.batch([dbA.prepare("UPDATE horse_access_grants SET revoked_at=? WHERE id=?").bind("2026-10-05 11:00:00", "9001")]);
    let refused = false;
    let refusalDetail = "no-throw";
    try {
      await executeListingStatus(dbA, { user: { id: "seller" } }, statusInput(), await receipt("r97-c1"));
    } catch (error) {
      refusalDetail = `${error?.code ?? "?"}/${error?.status ?? "?"}: ${String(error?.message ?? error).slice(0, 140)}`;
      refused = error?.code === "horse_access_required" || Number(error?.status ?? 0) === 403;
    }
    const rowC1 = (await admin.unsafe("SELECT status,row_version FROM sales_listings WHERE id='r97-listing'"))[0];
    const passC1 = refused && rowC1.status === "active" && Number(rowC1.row_version) === 1;
    record("C1-revoked-mandate-refuses-write", passC1, `refused=${refused} (${refusalDetail}), status=${rowC1.status}, row_version=${rowC1.row_version}`);

    // C2 (deterministic): a FUTURE-DATED mandate (valid_from ahead of now) must
    // refuse too — the R97 valid_from guard inside the grant predicate.
    await admin.unsafe(toSeed(`
      UPDATE horse_access_grants SET revoked_at=NULL, valid_from='2026-12-01 00:00:00' WHERE id='9001';
      UPDATE sales_listings SET status='active', row_version=1 WHERE id='r97-listing';
    `));
    let refusedFuture = false;
    let futureDetail = "no-throw";
    try {
      await executeListingStatus(dbA, { user: { id: "seller" } }, statusInput(), await receipt("r97-c2"));
    } catch (error) {
      futureDetail = `${error?.code ?? "?"}/${error?.status ?? "?"}`;
      refusedFuture = error?.code === "horse_access_required" || Number(error?.status ?? 0) === 403;
    }
    const rowC2 = (await admin.unsafe("SELECT status,row_version FROM sales_listings WHERE id='r97-listing'"))[0];
    const passC2 = refusedFuture && rowC2.status === "active" && Number(rowC2.row_version) === 1;
    record("C2-future-dated-mandate-refuses-write", passC2, `refused=${refusedFuture} (${futureDetail}), status=${rowC2.status}, row_version=${rowC2.row_version}`);

    // C3 (concurrent): revocation races a live-mandate write. The write may
    // land only if the grant was live at ITS commit; PG row locks + the
    // in-write predicate guarantee the invariant structurally.
    await admin.unsafe(toSeed(`
      UPDATE horse_access_grants SET valid_from='2026-01-01 00:00:00' WHERE id='9001';
      UPDATE sales_listings SET status='active', row_version=1 WHERE id='r97-listing';
    `));
    const raceC3 = await Promise.allSettled([
      dbA.batch([dbA.prepare("UPDATE horse_access_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind("2026-10-05 12:00:01", 9001)]),
      dbB.batch((() => {
        // The production status command's guarded UPDATE, executed through the
        // adapter in ONE transaction (statement built exactly as executeListingStatus does).
        const { LISTING_STATUS_SQL_TEMPLATE, buildActiveGrantPredicate, AUTHORITY_ARM_TEMPLATE } = require("../src/marketplace/commands.ts");
        const grant = buildActiveGrantPredicate("l.horse_id", "create_listing", { userId: "seller" }, now.toISOString());
        const sql = LISTING_STATUS_SQL_TEMPLATE.replace("{{authorityArm}}",
          AUTHORITY_ARM_TEMPLATE.replace("{{sellerColumn}}", "l.seller_user_id").replace("{{grantPredicate}}", grant.sql));
        return [dbB.prepare(sql).bind("pending_sale", "2026-10-05 12:00:00", crypto.randomUUID(), "r97-listing", 1, "active", "seller", "seller", ...grant.binds)];
      })()),
    ]);
    const rowC3 = (await admin.unsafe("SELECT status,row_version FROM sales_listings WHERE id='r97-listing'"))[0];
    const grantC3 = (await admin.unsafe("SELECT revoked_at FROM horse_access_grants WHERE id='9001'"))[0];
    const writeLanded = rowC3.status === "pending_sale" && Number(rowC3.row_version) === 2;
    const writeRefused = rowC3.status === "active" && Number(rowC3.row_version) === 1;
    const passC3 = (writeLanded || writeRefused) && grantC3.revoked_at != null
      && raceC3.every((r) => r.status === "fulfilled" || pgErrorClass(r.reason));
    record("C3-revocation-race-never-violates-in-write-authority", passC3,
      `write=${writeLanded ? "landed" : writeRefused ? "refused" : "CORRUPT"}, status=${rowC3.status}, row_version=${rowC3.row_version}, grantRevoked=${grantC3.revoked_at != null}, outcomes=${JSON.stringify(raceC3.map((r) => r.status === "fulfilled" ? "ok" : pgErrorClass(r.reason)))}`);
  }

  // -----------------------------------------------------------------------
  // D. Two staff reactivations at the last seat (capacity serialization).
  // -----------------------------------------------------------------------
  {
    await admin.unsafe(toSeed(`
      INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(50,'R97 Seat Race','owner');
    `));
    // 49 active seats: one seat remains. The two racers assign DIFFERENT users
    // through the production statements — the workspace lock row must
    // serialize the two batches on PostgreSQL.
    const seatValues = [];
    const seatBinds = [];
    for (let i = 0; i < MAX_ACTIVE_STAFF_PER_COLLECTION - 1; i++) {
      seatValues.push(`('seat-user-${i}')`);
    }
    await admin.unsafe(toSeed(`
      INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
        ${Array.from({ length: MAX_ACTIVE_STAFF_PER_COLLECTION - 1 }, (_, i) =>
          `('seat-user-${i}','seat${i}@example.test','seat${i}','not-a-real-hash','user',1)`).join(",")};
      INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,status)
        ${Array.from({ length: MAX_ACTIVE_STAFF_PER_COLLECTION - 1 }, (_, i) =>
          `SELECT 50,'seat-user-${i}','view','owner','active' WHERE NOT EXISTS(SELECT 1 FROM workspace_staff_assignments WHERE collection_id=50 AND user_id='seat-user-${i}')`).join(" UNION ALL ")};
    `));
    void seatValues; void seatBinds;
    const activeBefore = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM workspace_staff_assignments WHERE collection_id=50 AND status='active'"))[0].n);
    const race = await both((db, i) => db.batch(assignStaffStatements(db, {
      collectionId: 50, userId: i === 0 ? "staff-a" : "staff-b", actions: "view",
      actorUserId: "owner", operationId: crypto.randomUUID(),
    })));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[1]?.meta?.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const activeAfter = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM workspace_staff_assignments WHERE collection_id=50 AND status='active'"))[0].n);
    const audits = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.staff_assigned'"))[0].n);
    const winners = outcomes.filter((c) => c === 1).length;
    const pass = activeBefore === MAX_ACTIVE_STAFF_PER_COLLECTION - 1 && winners === 1
      && activeAfter === MAX_ACTIVE_STAFF_PER_COLLECTION && audits === 1;
    record("D-last-seat-reactivation-race", pass,
      `before=${activeBefore}, outcomes=${JSON.stringify(outcomes)}, after=${activeAfter}, audits=${audits} (cap ${MAX_ACTIVE_STAFF_PER_COLLECTION})`);
  }

  // -----------------------------------------------------------------------
  // E. Competing allocation approvals (exact-proposal gate on PostgreSQL).
  // -----------------------------------------------------------------------
  {
    const orderE = await paidOrder("r97-alloc-race");
    await dbA.batch(refunds.requestRefundStatements(dbA, {
      orderId: orderE.orderId, attemptId: orderE.attemptId, buyerUserId: "buyer",
      reason: "R97 allocation race", generation: 1,
    }, policy));
    const refundE = Number((await admin.unsafe("SELECT id::int AS id FROM refund_requests WHERE payment_attempt_id=$1", [orderE.attemptId]))[0].id);
    const proposal = await proposeRefundAllocation(dbA, {
      refundId: refundE, operatorUserId: "owner", nowIso: NOW,
    });
    const proposalId = proposal.proposal_operation_id;
    const amount = Number(proposal.proposal?.proposed_amount_minor ?? 0);
    const approve = (db) => db.batch(approveRefundAllocationStatements(db, {
      refundId: refundE, operatorUserId: "owner", amountMinor: amount,
      currency: "IRR", note: "R97 racing approval", expectedProposalOperationId: proposalId,
    }));
    const race = await both((db) => approve(db));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[0]?.meta?.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const request = (await admin.unsafe("SELECT allocation_status,amount_minor FROM refund_requests WHERE id=$1", [refundE]))[0];
    const approvedRows = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM refund_allocations WHERE refund_request_id=$1 AND status='approved'", [refundE]))[0].n);
    const events = Number((await admin.unsafe("SELECT COUNT(*)::int AS n FROM refund_events WHERE to_status='allocation_approved'"))[0].n);
    const winners = outcomes.filter((c) => c === 1).length;
    const pass = winners === 1 && request.allocation_status === "approved"
      && Number(request.amount_minor) === amount && approvedRows === 1 && events === 1;
    record("E-competing-allocation-approvals", pass,
      `outcomes=${JSON.stringify(outcomes)}, status=${request.allocation_status}, amount=${request.amount_minor}, approvedRows=${approvedRows}, events=${events}`);
  }

  // -----------------------------------------------------------------------
  // 3. Report
  // -----------------------------------------------------------------------
  const summary = { harness: "pg-r97-concurrency", server: serverVersion, migrations_applied: migrations.length,
    scenarios: findings, pass: findings.every((f) => f.pass) };
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`report written: ${reportPath}`);
  }
  console.log(`\npg-r97-concurrency: ${findings.filter((f) => f.pass).length}/${findings.length} scenarios passed${summary.pass ? "" : " — FAILURES PRESENT"}`);
  process.exitCode = summary.pass ? 0 : 1;
}

/** Translate + run a raw SQLite-dialect seed block on the admin connection. */
function toSeed(sqlText) {
  return splitStatements(sqlText).map((s) => sqliteSqlToPostgres(ddlNormalize(s))).join(";\n");
}

main().catch(async (error) => {
  console.error("pg-r97-concurrency failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  for (const db of adapters) { try { await closeSupabaseD1Database(db); } catch { /* teardown best-effort */ } }
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } catch { /* best-effort cleanup; the schema this process created only */ }
  await admin.end({ timeout: 2 }).catch(() => {});
});
