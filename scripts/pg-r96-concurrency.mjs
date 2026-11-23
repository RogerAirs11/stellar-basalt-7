#!/usr/bin/env node
/**
 * pg-r96-concurrency — R96 agent plan N02: PostgreSQL adapter concurrency.
 *
 * The DDL gate proves the chain applies; pg-execution-parity proves statement
 * equivalence. This harness proves the R96 INVARIANTS under true multi-client
 * concurrency on PostgreSQL, using the PRODUCTION supabaseCompat adapter
 * (createSupabaseD1Database, mode "full") and the PRODUCTION command builders:
 *
 *   A. duplicate refund requests racing        -> exactly one active request
 *      (migration 0063 partial unique index, adapter error class)
 *   B. concurrent refund confirmations         -> exactly one winner; one
 *      entitlement_events trail; replay is a no-op (F08 fresh operation gate)
 *   C. refund confirmation vs concurrent renewal -> the later purchase's
 *      access is never destroyed (F07: exact-interval CAS or explicit review)
 *   D. cross-case standing changes racing      -> user-row lock serializes;
 *      stale expected-standing refuses (F13)
 *   E. consent withdrawal vs outbox claim race -> the notice can never be
 *      dispatched after withdrawal (F04 recheck closes the gap either order)
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user@127.0.0.1:PORT/hr_test_x \
 *     PG_PARITY_DISPOSABLE=yes node scripts/pg-r96-concurrency.mjs \
 *     [--report audit/r96/evidence-integration/pg-concurrency.json]
 *
 * Environment/limits: identical disposable rules as the parity gates — a
 * loopback hr_test_ database only; the isolated schema is created and dropped;
 * `public` is never touched. No production system is contacted.
 */
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
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
const refunds = require("../src/commerce/refunds.ts");
const paymentCommands = require("../src/commerce/paymentCommands.ts");
const moderation = require("../src/moderation/commands.ts");
const privacy = require("../src/services/privacy.ts");
const { resolveServiceRequestNotice } = require("../src/notifications/serviceNotice.ts");
const dossierCommands = require("../src/dossiers/commands.ts");

const NOW = "2026-10-05T12:00:00.000Z";

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
  console.error("R96 concurrency requires a loopback hr_test_* database (the same disposable rule as canonical migration gating)");
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
  // 2. Seed: the R96 world through PRODUCTION builders where money is involved.
  // -----------------------------------------------------------------------
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('buyer','buyer@example.test','buyer','not-a-real-hash','user',1),
      ('owner','owner@example.test','owner','not-a-real-hash','admin',1),
      ('operator2','op2@example.test','op2','not-a-real-hash','admin',1),
      ('seller','seller@example.test','seller','not-a-real-hash','user',1),
      ('svc-req','svcreq@example.test','svcreq','not-a-real-hash','user',1);
    INSERT INTO horses(id,name_latin) VALUES(1,'N02 Horse');
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

  /** An order with a redirected attempt (authority attached, NOT verified) —
   * the genuine renewal racer: its verify creates a FRESH grant. */
  async function orderWithAttempt(orderKey, buyer = "buyer") {
    const operationId = crypto.randomUUID();
    const digest = await paymentCommands.orderIntentDigest([{ sku: LINE.sku, quantity: 1 }], null);
    await dbB.batch(paymentCommands.atomicOrderStatements(dbB, {
      operationId, orderKey, buyerUserId: buyer, organizationId: null,
      digest, totalMinor: LINE.line_total_minor, lines: [LINE],
    }));
    const order = await dbB.prepare("SELECT id FROM orders WHERE order_key=?").bind(orderKey).first();
    const requestKey = crypto.randomUUID();
    await dbB.batch(paymentCommands.reservePaymentStatements(dbB, { orderId: Number(order.id), buyerUserId: buyer, requestKey, provider: "zarinpal" }));
    const attempt = await dbB.prepare("SELECT id FROM payment_attempts WHERE request_key=?").bind(requestKey).first();
    await dbB.batch(paymentCommands.attachAuthorityStatements(dbB, { requestKey, authority: `AUTH-${orderKey}`, provider: "zarinpal" }));
    return { orderId: Number(order.id), attemptId: Number(attempt.id) };
  }

  const policy = { kind: "full_unused", sku: LINE.sku, granted_days: 30, consumed_days: 0, remaining_days: 30,
    access_action: "cancel_full_period", history_note: "N02 concurrency fixture policy" };
  async function requestRefund(p, generation = 1, actor = "buyer") {
    return dbA.batch(refunds.requestRefundStatements(dbA, {
      orderId: p.orderId, attemptId: p.attemptId, buyerUserId: actor, reason: `N02 ${p.orderKey ?? ""}`.trim() || "N02 refund", generation,
    }, policy));
  }
  async function refundIdFor(p) {
    const row = await dbA.prepare("SELECT id FROM refund_requests WHERE payment_attempt_id=?").bind(p.attemptId).first();
    return Number(row.id);
  }

  // -----------------------------------------------------------------------
  // A. Duplicate refund requests racing (0063 partial unique index).
  // -----------------------------------------------------------------------
  const orderA = await paidOrder("n02-race-a");
  // DIFFERENT generations (different request keys) so the racers exercise the
  // 0063 partial unique index path, not the same-key idempotent replay.
  const dupResults = await both((db, i) => db.batch(refunds.requestRefundStatements(db, {
    orderId: orderA.orderId, attemptId: orderA.attemptId, buyerUserId: "buyer",
    reason: "N02 duplicate race", generation: i === 0 ? 1 : 2,
  }, policy)));
  const dupErrors = dupResults.map((r) => (r.status === "rejected" ? pgErrorClass(r.reason) : null));
  const activeA = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM refund_requests WHERE payment_attempt_id=$1 AND status IN ('requested','approved','provider_pending','confirmed')`, [orderA.attemptId]))[0].n);
  const totalRequestsA = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM refund_requests WHERE payment_attempt_id=$1`, [orderA.attemptId]))[0].n);
  const requestEventsA = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM refund_events WHERE to_status='requested'`))[0].n);
  // The command layer is deliberately silent-no-op (NOT EXISTS + ON CONFLICT DO
  // NOTHING); the partial index is the structural backstop. The invariant:
  // exactly ONE request row and ONE event — whichever racer wins.
  record("A-duplicate-refund-requests-race", activeA === 1 && totalRequestsA === 1 && requestEventsA === 1,
    `active=${activeA}, rows=${totalRequestsA}, events=${requestEventsA}, errors=${JSON.stringify(dupErrors)}`);

  // -----------------------------------------------------------------------
  // B. Concurrent refund confirmations (fresh-operation gate, F08).
  // -----------------------------------------------------------------------
  const refundA = await refundIdFor(orderA);
  await dbA.batch(refunds.approveRefundStatements(dbA, { refundId: refundA, operatorUserId: "owner", note: "N02 approve", partialPolicyEnabled: false }));
  const confirmResults = await both((db) => db.batch(refunds.recordProviderRefundOutcomeStatements(db, {
    refundId: refundA, operatorUserId: "owner", kind: "full_unused",
    result: { outcome: "confirmed", providerReference: "N02-CONFIRM-1" },
  })));
  const confirmWinners = (await Promise.all(confirmResults.map(async (r) => {
    if (r.status === "rejected") return { error: pgErrorClass(r.reason) };
    const events = await admin.unsafe(`SELECT COUNT(*)::int AS n FROM entitlement_events WHERE kind='refund_reversal'`);
    return { changes: r.value.length, reversalRows: events[0].n };
  })));
  const reversalTotal = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM entitlement_events WHERE kind='refund_reversal'`))[0].n);
  const refundStatus = (await admin.unsafe(`SELECT status FROM refund_requests WHERE id=$1`, [refundA]))[0].status;
  record("B-concurrent-confirmations-single-winner", refundStatus === "confirmed" && reversalTotal === 1,
    `status=${refundStatus}, reversalEvents=${reversalTotal}, outcomes=${JSON.stringify(confirmWinners)}`);

  // -----------------------------------------------------------------------
  // C. Refund confirmation vs concurrent renewal (F07).
  // -----------------------------------------------------------------------
  // C1 is paid (grant 1 live). Its approved refund is confirmed by racer A
  // WHILE racer B verifies a second, redirected attempt (a genuine renewal:
  // fresh receipt, fresh grant) on the same holder+sku. Whichever commits
  // first, the later purchase's access must survive — via the exact-interval
  // CAS (cancel only grant 1) or via an explicit review_required disposition.
  const orderC1 = await paidOrder("n02-renew-c1");
  await requestRefund(orderC1);
  const refundC = await refundIdFor(orderC1);
  await dbA.batch(refunds.approveRefundStatements(dbA, { refundId: refundC, operatorUserId: "owner", note: "N02 approve C", partialPolicyEnabled: false }));
  const orderC2 = await orderWithAttempt("n02-renew-c2"); // authority attached, NOT verified yet
  const raceC = await Promise.allSettled([
    dbA.batch(refunds.recordProviderRefundOutcomeStatements(dbA, { refundId: refundC, operatorUserId: "owner", kind: "full_unused", result: { outcome: "confirmed", providerReference: "N02-CONFIRM-C" } })),
    dbB.batch(paymentCommands.verifiedOrderStatements(dbB, { operationId: crypto.randomUUID(), attemptId: orderC2.attemptId, orderId: orderC2.orderId, buyerUserId: "buyer", organizationId: null, providerReference: "N02-RENEW-C2", nowIso: NOW, totalMinor: LINE.line_total_minor, lines: [LINE] })),
  ]);
  // F07 core invariant: after the refund of C1 confirmed concurrently with the
  // C2 renewal, the LATER grant is either still active or explicitly under
  // review — never silently destroyed. The renewal grant itself always exists.
  const c2GrantRows = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM entitlement_events WHERE payment_attempt_id=$1 AND kind='grant'`, [orderC2.attemptId]))[0].n);
  const c1Disposition = (await admin.unsafe(`
    SELECT a.disposition FROM refund_access_adjustments a WHERE a.grant_event_id=(
      SELECT id FROM entitlement_events WHERE payment_attempt_id=$1 AND kind='grant')`, [orderC1.attemptId]))[0]?.disposition ?? "none";
  const c2Lineage = (await admin.unsafe(`
    SELECT e.id AS grant_id, COALESCE(ent.id::text,'none') AS entitlement_id, COALESCE(ent.active::int,0) AS active
    FROM entitlement_events e LEFT JOIN entitlements ent ON ent.source_event_id=e.id
    WHERE e.payment_attempt_id=$1 AND e.kind='grant'`, [orderC2.attemptId]))[0];
  const reviewRows = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM refund_access_reviews`))[0].n);
  const laterAccessSurvives = c2GrantRows === 1 && (
    (c2Lineage && Number(c2Lineage.active) === 1) || c1Disposition === "review_required" || reviewRows >= 1);
  record("C-later-purchase-access-survives-refund", laterAccessSurvives,
    `c2Grant=${c2GrantRows}, c2Active=${c2Lineage?.active}, c1Disposition=${c1Disposition}, reviews=${reviewRows}, outcomes=${JSON.stringify(raceC.map((r) => r.status === "fulfilled" ? "ok" : pgErrorClass(r.reason)))}`);

  // -----------------------------------------------------------------------
  // D. Cross-case standing changes racing (F13 user-row lock).
  // -----------------------------------------------------------------------
  await admin.unsafe(toSeed(`
    INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance)
      VALUES('n02-listing',1,'seller','N02 SELLER','active','user');
    INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status)
      VALUES(101,'sales_listings','n02-listing','svc-req','spam','new'),
            (102,'sales_listings','n02-listing','buyer','offensive_content','new');
  `));
  // two operators decide the two cases and then race standing changes for the
  // same account through DIFFERENT cases.
  const decide = (db, caseId, decision, actor) => db.batch(moderation.decideCaseStatements(db, {
    caseId, expectedStatus: "new", targetId: "n02-listing", targetTable: "sales_listings",
    actorUserId: actor, operationId: crypto.randomUUID(), decision, note: `N02 decide ${caseId}`,
  }));
  await decide(dbA, 101, "hide", "owner");
  await decide(dbB, 102, "dismiss", "operator2");
  const standingRace = await Promise.allSettled([
    dbA.batch(moderation.setStandingStatements(dbA, { caseId: 101, accountUserId: "seller", standing: "restricted", expectedStanding: "normal", reason: "N02 case 101 restricted", actorUserId: "owner", operationId: crypto.randomUUID() })),
    dbB.batch(moderation.setStandingStatements(dbB, { caseId: 102, accountUserId: "seller", standing: "suspended", expectedStanding: "normal", reason: "N02 case 102 suspended", actorUserId: "operator2", operationId: crypto.randomUUID() })),
  ]);
  const finalStanding = (await admin.unsafe(`SELECT standing FROM service_abuse_standing WHERE user_id='seller'`))[0]?.standing ?? null;
  const standingEvents = Number((await admin.unsafe(`SELECT COUNT(*)::int AS n FROM moderation_case_events WHERE event_type='standing'`))[0].n);
  const raceErrors = standingRace.map((r) => (r.status === "rejected" ? pgErrorClass(r.reason) : "ok"));
  // Both expected normal->X; the second commit sees the changed standing and its
  // guarded upsert refuses (zero-row) — exactly one standing transition lands.
  record("D-cross-case-standing-serialized", standingEvents === 1 && ["restricted", "suspended"].includes(finalStanding),
    `final=${finalStanding}, standingEvents=${standingEvents}, outcomes=${JSON.stringify(raceErrors)}`);

  // -----------------------------------------------------------------------
  // E. Consent withdrawal vs outbox claim race (F04).
  // -----------------------------------------------------------------------
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('n02-prov','prov@example.test','prov','not-a-real-hash','user',1);
    INSERT INTO people(id,name_latin) VALUES(1,'N02 Provider Person');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('n02-prov',1,'verified');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,created_at,updated_at)
      VALUES(500,'svc-req',1,'trainer','IR-23','N02 city','N02 private note',1,'new','2026-01-01 00:00:00','2026-01-01 00:00:00');
    INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status,attempts,max_attempts,next_attempt_at)
      VALUES('service-request:500:created:n02-prov','email','service_request_notice',0,'n02-prov','p***@example.test','service_requests:500','queued',0,5,'2026-01-01 00:00:00');
  `));
  const OUTBOX_LEASE = `
    UPDATE notification_outbox SET lease_token='claim-racer',lease_until=datetime('now','+5 minutes')
    WHERE event_key='service-request:500:created:n02-prov' AND status='queued'`;
  const withdrawOp = crypto.randomUUID();
  const raceE = await Promise.allSettled([
    dbA.batch(privacy.consentWithdrawalStatements(dbA, { requestId: 500, requesterUserId: "svc-req", operationId: withdrawOp })),
    dbB.batch([dbB.prepare(OUTBOX_LEASE)]),
  ]);
  const outboxState = (await admin.unsafe(`SELECT status,last_error FROM notification_outbox WHERE event_key='service-request:500:created:n02-prov'`))[0];
  const consent = (await admin.unsafe(`SELECT share_contact,consent_updated_at IS NOT NULL AS withdrawn FROM service_requests WHERE id=500`))[0];
  // Send-time resolution must suppress regardless of claim order (F04).
  const resolution = await resolveServiceRequestNotice(dbA, { eventKey: "service-request:500:created:n02-prov", payloadRef: "service_requests:500" });
  const suppressedAfterWithdrawal = Boolean(consent.withdrawn)
    && (outboxState.status === "suppressed" || resolution.kind === "suppressed");
  record("E-consent-withdrawal-beats-dispatch", suppressedAfterWithdrawal,
    `outbox=${outboxState.status}/${outboxState.last_error}, consentWithdrawn=${consent.withdrawn}, resolution=${JSON.stringify(resolution).slice(0, 120)}`);

  // -----------------------------------------------------------------------
  // F. R96-N07 — dossier view claim: ONE linearization point on real PG.
  // -----------------------------------------------------------------------
  // The public view's authorization+counter is ONE conditional UPDATE. F1
  // proves the claim lands on a live world through the PRODUCTION adapter +
  // translator (datetime() expiry, row-derived creator mandate, editorial
  // arm); F2 proves the mandate arm refuses after revocation; F3 races a
  // claim against a concurrent grant revocation (any serialization order is
  // legal, but the claim must land or refuse COHERENTLY — never error, never
  // both); F4 proves concurrent claims never lose or double-count an access.
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('n07-seller','n07s@example.test','N07 Seller','not-a-real-hash','user',1);
    INSERT INTO horses(id,name_latin) VALUES(9,'N07 Star');
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
      VALUES ('n07-g1',9,'n07-seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','claim_approval','2026-01-01 00:00:00');
  `));
  async function mintN07Link(linkIndex) {
    await dbA.batch(dossierCommands.createDossierStatements(dbA, {
      operationId: crypto.randomUUID(), actorUserId: "n07-seller", actorRole: "user",
      horseId: 9, version: 2, snapshotJson: JSON.stringify({ source: { schema_version: 2 } }),
      sectionsMetaJson: "{}", issuedDigest: "f".repeat(64),
    }));
    const dossierRow = await dbA.prepare("SELECT id FROM dossier_snapshots ORDER BY id DESC LIMIT 1").first();
    const [linkInsert] = await dbA.batch(dossierCommands.createDossierLinkStatements(dbA, {
      operationId: crypto.randomUUID(), actorUserId: "n07-seller", actorRole: "user",
      dossierId: Number(dossierRow.id), tokenHash: "f".repeat(63) + String(linkIndex),
      expiresAt: "2026-12-01T00:00:00.000Z", recipientUserId: null,
    }));
    return Number(linkInsert.meta.last_row_id);
  }
  const claimChanges = async (db, linkId) => {
    const [claimResult] = await db.batch(dossierCommands.claimDossierViewStatements(db, {
      linkId, viewerUserId: null, nowIso: NOW,
    }));
    return Number(claimResult?.meta?.changes ?? 0);
  };

  const n07Link1 = await mintN07Link(1);
  const f1 = await claimChanges(dbA, n07Link1);
  const f1Counter = Number((await admin.unsafe(`SELECT access_count::int AS n FROM dossier_share_links WHERE id=$1`, [n07Link1]))[0].n);
  record("F1-dossier-claim-lands-live-world", f1 === 1 && f1Counter === 1, `changes=${f1}, counter=${f1Counter}`);

  await admin.unsafe(`UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='n07-g1'`);
  const f2 = await claimChanges(dbB, n07Link1);
  const f2Counter = Number((await admin.unsafe(`SELECT access_count::int AS n FROM dossier_share_links WHERE id=$1`, [n07Link1]))[0].n);
  record("F2-dossier-claim-refuses-revoked-mandate", f2 === 0 && f2Counter === 1, `changes=${f2}, counter still=${f2Counter}`);

  // Fresh grant + fresh link: a TRUE race — claim on dbA vs revocation on dbB.
  await admin.unsafe(`UPDATE horse_access_grants SET revoked_at=NULL WHERE id='n07-g1'`);
  const n07Link2 = await mintN07Link(2);
  const raceF3 = await Promise.allSettled([
    claimChanges(dbA, n07Link2),
    (async () => dbB.batch([dbB.prepare(`UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='n07-g1'`)]))(),
  ]);
  const f3Claim = raceF3[0].status === "fulfilled" ? raceF3[0].value : pgErrorClass(raceF3[0].reason);
  const f3Counter = Number((await admin.unsafe(`SELECT access_count::int AS n FROM dossier_share_links WHERE id=$1`, [n07Link2]))[0].n);
  record("F3-dossier-claim-vs-revocation-race-coherent", f3Claim === 0 || f3Claim === 1,
    `claimOutcome=${JSON.stringify(f3Claim)}, counter=${f3Counter} (either serialization order is legal; the claim itself must never error)`);

  // Two concurrent authorized claims on one link: the row lock serializes
  // them — every landed claim increments exactly once, none is lost.
  await admin.unsafe(`UPDATE horse_access_grants SET revoked_at=NULL WHERE id='n07-g1'`);
  const n07Link3 = await mintN07Link(3);
  const raceF4 = await Promise.allSettled([claimChanges(dbA, n07Link3), claimChanges(dbB, n07Link3)]);
  const f4Claims = raceF4.map((r) => (r.status === "fulfilled" ? r.value : pgErrorClass(r.reason)));
  const f4Counter = Number((await admin.unsafe(`SELECT access_count::int AS n FROM dossier_share_links WHERE id=$1`, [n07Link3]))[0].n);
  record("F4-dossier-claims-never-lost-or-double-counted", f4Counter === f4Claims.reduce((sum, v) => sum + (v === 1 ? 1 : 0), 0),
    `claims=${JSON.stringify(f4Claims)}, counter=${f4Counter}`);

  // -----------------------------------------------------------------------
  // 3. Report
  // -----------------------------------------------------------------------
  const summary = { generated_at: new Date().toISOString(), target: `${target.host}:${target.port || 5432}/${target.pathname.slice(1)} (schema ${schema})`,
    migrations_applied: migrations.length, scenarios: findings, pass: findings.every((f) => f.pass) };
  if (reportPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`report written: ${reportPath}`);
  }
  console.log(`\npg-r96-concurrency: ${findings.filter((f) => f.pass).length}/${findings.length} scenarios passed${summary.pass ? "" : " — FAILURES PRESENT"}`);
  process.exitCode = summary.pass ? 0 : 1;
}

/** Translate + run a raw SQLite-dialect seed block on the admin connection. */
function toSeed(sqlText) {
  return splitStatements(sqlText).map((s) => sqliteSqlToPostgres(ddlNormalize(s))).join(";\n");
}

main().catch(async (error) => {
  console.error("pg-r96-concurrency failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  for (const db of adapters) { try { await closeSupabaseD1Database(db); } catch { /* teardown best-effort */ } }
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`DROP TABLE IF EXISTS pg_parity_gate_journal`); // never created here; safe no-op
  } catch { /* best-effort cleanup */ }
  await admin.end({ timeout: 2 }).catch(() => {});
});
