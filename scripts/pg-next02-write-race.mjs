#!/usr/bin/env node
/**
 * pg-next02-write-race — R107 NEXT-02 remaining leg: the PostgreSQL
 * cross-row revocation / write-race interleaving gate (master-AI R97/R95
 * requirement: "Test both transaction interleavings on the actual
 * PostgreSQL adapter where concurrency matters ... Verify all-or-nothing
 * side effects and current authority at the actual write").
 *
 * The live-freshness run (review-r107/NEXT-02-LIVE-FRESHNESS) proved
 * read-side revocation freshness through the deployed worker. This harness
 * proves the WRITE side on real PostgreSQL 18 with the PRODUCTION
 * supabaseCompat adapter (mode "full") and the PRODUCTION command builders:
 *
 *   W1. account deactivation commits between command build and provider
 *       transition execute -> the in-write EXISTS(users.is_active=1) arm
 *       makes the UPDATE a zero-row no-op; NO audit, NO outbox (all-or-
 *       nothing side effects)
 *   W2. the legal reverse interleave: transition lands first, deactivation
 *       after -> one row changed, one audit, one outbox (authority was
 *       current at the actual write)
 *   W3. mandate revocation (user_person_links, a DIFFERENT row/table than
 *       the write target) commits before the provider transition -> the
 *       in-write personMandate arm fails closed: zero-row no-op, no side
 *       effects
 *   W4. a provider block lands between create build and execute -> the
 *       receipt INSERT (which embeds ALL create-time authority) matches
 *       zero rows: no receipt, no request, no audit, no outbox
 *   W5. the legal reverse interleave for the block: create lands first
 *       (full side effects), then the production providerBlockStatements
 *       block suppresses the still-queued created notice
 *   W6. the queued-notification consent leg: the drain CLAIMS a due
 *       non-essential notice (production OUTBOX_CLAIM_DUE_SQL), consent
 *       withdrawal then commits (share_contact=0 in-write + suppress), the
 *       drain's lease renewal matches ZERO rows (status no longer queued)
 *       -> NO SEND: the withdrawn content is never disclosed
 *   W7. reverse consent interleave + one-way withdrawal: an already
 *       provider_accepted notice is untouched by suppression (consent was
 *       valid at send time); a second withdrawal is a zero-row no-op
 *   W8. bounded true races (25 rounds each) with randomized jitter:
 *       transition-vs-deactivation and create-vs-block run concurrently;
 *       every round must land all-or-nothing (audit/outbox IFF the guarded
 *       write landed; receipt IFF request) — no torn state in any order
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user@127.0.0.1:PORT/hr_test_x \
 *     PG_PARITY_DISPOSABLE=yes node scripts/pg-next02-write-race.mjs \
 *     [--report review-r107/NEXT-02-PG-WRITE-RACE/pg-write-race.json]
 *
 * Environment/limits: identical disposable rules as the parity gates — a
 * loopback hr_test_ database only; the isolated schema is created and
 * dropped; `public` is never touched. No production system is contacted.
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
const { createServiceStatements, transitionServiceStatements } = require("../src/services/commands.ts");
const { consentWithdrawalStatements, providerBlockStatements } = require("../src/services/privacy.ts");
const { OUTBOX_CLAIM_DUE_SQL } = require("../src/notifications/outbox.ts");
const { serviceReceiptKey } = require("../src/services/policy.ts");

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
  console.error("NEXT-02 write-race requires a loopback hr_test_* database (the same disposable rule as canonical migration gating)");
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

const admin = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
let adapters = [];

async function sha256Hex(value) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value ?? null)));
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
      throw new Error(`migration ${name} failed on the write-race target: ${error.message}`);
    }
  }
  console.log(`migrations applied: ${migrations.length} (schema ${schema})`);
  const dbA = createSupabaseD1Database(adapterUrl, { mode: "full" });
  adapters = [dbA];
  const count = async (sql, ...binds) => Number((await admin.unsafe(sql, binds))[0]?.n ?? 0);

  // -----------------------------------------------------------------------
  // 2. Seed: the NEXT-02 write-race world.
  // -----------------------------------------------------------------------
  const raceUsers = Array.from({ length: 25 }, (_, i) => `rr${i + 1}`);
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('prov','prov@example.test','Provider','not-a-real-hash','user',1),
      ('reqA','reqa@example.test','Requester A','not-a-real-hash','user',1),
      ('reqB','reqb@example.test','Requester B','not-a-real-hash','user',1),
      ('reqC','reqc@example.test','Requester C','not-a-real-hash','user',1),
      ('reqD','reqd@example.test','Requester D','not-a-real-hash','user',1)
      ${raceUsers.map((u) => `,(\'${u}\',\'${u}@example.test\',\'Race ${u}\',\'not-a-real-hash\',\'user\',1)`).join("")};
    INSERT INTO people(id,name_latin) VALUES (1,'NEXT-02 Provider Person');
    INSERT INTO user_person_links(user_id,person_id,status,verified_at) VALUES
      ('prov',1,'verified','2026-01-01 00:00:00');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent,published_at,created_by_user_id)
      VALUES (1,'["farrier","veterinary"]',1,'2026-01-01 00:00:00','prov');
  `));

  let requestSeq = 100;
  async function seedRequest(requesterUserId, opts = {}) {
    const id = ++requestSeq;
    await admin.unsafe(toSeed(`
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,row_version)
        VALUES (${id},'${requesterUserId}',1,'farrier','NEXT-02 write-race fixture ${id}',${opts.shareContact ?? 1},'${opts.status ?? "new"}',1);
    `));
    return id;
  }
  async function seedNotice(requestId, eventKey, status = "queued") {
    await admin.unsafe(toSeed(`
      INSERT INTO notification_outbox(event_key,channel,purpose,essential,recipient_user_id,recipient_masked,payload_ref,status)
        VALUES ('${eventKey}','email','service_request_notice',0,'prov','p***@example.test','service_requests:${requestId}','${status}');
    `));
  }

  const providerTransition = (requestId, operationId) => transitionServiceStatements(dbA, {
    requestId, expectedVersion: 1, from: "new", to: "acknowledged",
    actorUserId: "prov", actor: "provider", operationId,
  });
  const requestState = async (id) => {
    const row = (await admin.unsafe("SELECT status,row_version,share_contact FROM service_requests WHERE id=$1", [id]))[0];
    // The translator maps SQLite INTEGER to PG bigint; postgres.js returns
    // bigint as a string. The adapter passes that through unchanged
    // (production compares row_version only inside SQL), so coerce here.
    return { status: row.status, row_version: Number(row.row_version), share_contact: Number(row.share_contact) };
  };

  // -----------------------------------------------------------------------
  // W1. Deactivation before the provider transition (deterministic).
  // -----------------------------------------------------------------------
  {
    const requestId = await seedRequest("reqA");
    const statements = providerTransition(requestId, crypto.randomUUID());
    await admin.unsafe("UPDATE users SET is_active=0 WHERE id='prov'");
    const outcome = await dbA.batch(statements);
    const changes = Number(outcome[0]?.meta.changes ?? -1);
    const state = await requestState(requestId);
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_type='service_request' AND entity_id=$1 AND action='service_request.transitioned'", String(requestId));
    const outbox = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE 'service-request:' || $1 || ':%'", String(requestId));
    const pass = changes === 0 && state.status === "new" && state.row_version === 1 && audits === 0 && outbox === 0;
    record("W1-deactivation-beats-transition", pass,
      `changes=${changes}, status=${state.status}, row_version=${state.row_version}, audits=${audits}, outbox=${outbox}`);
    await admin.unsafe("UPDATE users SET is_active=1 WHERE id='prov'");
  }

  // -----------------------------------------------------------------------
  // W2. Transition first, deactivation after (the legal interleave).
  // -----------------------------------------------------------------------
  {
    const requestId = await seedRequest("reqA");
    const statements = providerTransition(requestId, crypto.randomUUID());
    const outcome = await dbA.batch(statements);
    const changes = Number(outcome[0]?.meta.changes ?? -1);
    await admin.unsafe("UPDATE users SET is_active=0 WHERE id='prov'");
    const state = await requestState(requestId);
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_type='service_request' AND entity_id=$1 AND action='service_request.transitioned'", String(requestId));
    const outbox = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE 'service-request:' || $1 || ':%'", String(requestId));
    const pass = changes === 1 && state.status === "acknowledged" && state.row_version === 2 && audits === 1 && outbox === 1;
    record("W2-transition-beats-deactivation", pass,
      `changes=${changes}, status=${state.status}, row_version=${state.row_version}, audits=${audits}, outbox=${outbox}`);
    await admin.unsafe("UPDATE users SET is_active=1 WHERE id='prov'");
  }

  // -----------------------------------------------------------------------
  // W3. Mandate revocation before the provider transition (cross-row).
  // -----------------------------------------------------------------------
  {
    const requestId = await seedRequest("reqA");
    const statements = providerTransition(requestId, crypto.randomUUID());
    await admin.unsafe("UPDATE user_person_links SET status='revoked' WHERE user_id='prov' AND person_id=1");
    const outcome = await dbA.batch(statements);
    const changes = Number(outcome[0]?.meta.changes ?? -1);
    const state = await requestState(requestId);
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_type='service_request' AND entity_id=$1 AND action='service_request.transitioned'", String(requestId));
    const outbox = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE 'service-request:' || $1 || ':%'", String(requestId));
    const pass = changes === 0 && state.status === "new" && state.row_version === 1 && audits === 0 && outbox === 0;
    record("W3-mandate-revocation-beats-transition", pass,
      `changes=${changes}, status=${state.status}, row_version=${state.row_version}, audits=${audits}, outbox=${outbox}`);
    await admin.unsafe("UPDATE user_person_links SET status='verified' WHERE user_id='prov' AND person_id=1");
  }

  // -----------------------------------------------------------------------
  // W4. Provider block lands between create build and execute.
  // -----------------------------------------------------------------------
  {
    const payload = { provider_person_id: 1, category: "farrier", note: "NEXT-02 W4 blocked lead", share_contact: 1 };
    const digest = await sha256Hex(payload);
    const receiptKey = await serviceReceiptKey("reqB", "next02-w4-key");
    const operationId = crypto.randomUUID();
    const statements = createServiceStatements(dbA, {
      operationId, receiptKey, digest, actorUserId: "reqB", providerPersonId: 1,
      category: "farrier", province: "IR-07", city: null, horseId: null,
      note: "NEXT-02 W4 blocked lead", shareContact: true,
      responseJson: JSON.stringify({ created: true, request: payload }),
    });
    // The provider's block commits between preflight and the create batch.
    await admin.unsafe(toSeed(`
      INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason,created_by_user_id,creation_operation_id)
        VALUES (1,'reqB','NEXT-02 W4 race block','prov','${crypto.randomUUID()}');
    `));
    const outcome = await dbA.batch(statements);
    const receipts = await count("SELECT COUNT(*)::int AS n FROM service_request_receipts WHERE id=$1", receiptKey);
    const requests = await count("SELECT COUNT(*)::int AS n FROM service_requests WHERE requester_user_id='reqB'");
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='service_request.created' AND actor_user_id='reqB'");
    const outbox = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE '%:created:prov'");
    const pass = receipts === 0 && requests === 0 && audits === 0 && outbox === 0;
    record("W4-block-beats-create", pass,
      `receipts=${receipts}, requests=${requests}, audits=${audits}, outbox=${outbox}`);
  }

  // -----------------------------------------------------------------------
  // W5. Create lands first; the production block then suppresses the notice.
  // -----------------------------------------------------------------------
  {
    const payload = { provider_person_id: 1, category: "farrier", note: "NEXT-02 W5 lead", share_contact: 1 };
    const digest = await sha256Hex(payload);
    const receiptKey = await serviceReceiptKey("reqC", "next02-w5-key");
    const operationId = crypto.randomUUID();
    const statements = createServiceStatements(dbA, {
      operationId, receiptKey, digest, actorUserId: "reqC", providerPersonId: 1,
      category: "farrier", province: "IR-07", city: null, horseId: null,
      note: "NEXT-02 W5 lead", shareContact: true,
      responseJson: JSON.stringify({ created: true, request: payload }),
    });
    const outcome = await dbA.batch(statements);
    const receipts = await count("SELECT COUNT(*)::int AS n FROM service_request_receipts WHERE id=$1", receiptKey);
    const requests = await count("SELECT COUNT(*)::int AS n FROM service_requests WHERE requester_user_id='reqC'");
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='service_request.created' AND actor_user_id='reqC'");
    let outboxQueued = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE '%:created:prov' AND status='queued'");
    // The provider now blocks reqC through the PRODUCTION block statements.
    const blockOutcome = await dbA.batch(providerBlockStatements(dbA, {
      providerPersonId: 1, blockedRequesterUserId: "reqC", actorUserId: "prov",
      reason: "NEXT-02 W5 post-create block", operationId: crypto.randomUUID(),
    }));
    const blockRows = Number(blockOutcome[0]?.meta.changes ?? -1);
    const suppressed = (await admin.unsafe(
      "SELECT status,last_error FROM notification_outbox WHERE event_key LIKE '%:created:prov'"
    ))[0];
    const pass = receipts === 1 && requests === 1 && audits === 1 && outboxQueued === 1
      && blockRows === 1 && suppressed.status === "suppressed" && suppressed.last_error === "provider_blocked_requester";
    record("W5-create-beats-block", pass,
      `receipts=${receipts}, requests=${requests}, audits=${audits}, queued_before_block=${outboxQueued}, block=${blockRows}, notice=${suppressed.status}/${suppressed.last_error}`);
  }

  // -----------------------------------------------------------------------
  // W6. Queued-notification consent leg: withdrawal beats a claimed notice.
  // -----------------------------------------------------------------------
  {
    const requestId = await seedRequest("reqD", { shareContact: 1 });
    const eventKey = `service-request:${requestId}:created:prov`;
    await seedNotice(requestId, eventKey, "queued");
    // 1. The drain claims the due row through the PRODUCTION claim SQL.
    const now = new Date();
    const nowIso = now.toISOString();
    const token = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
    const claimed = await dbA.prepare(OUTBOX_CLAIM_DUE_SQL)
      .bind(token, leaseUntil, nowIso, nowIso, nowIso, nowIso, 10).all();
    const rows = claimed.results ?? [];
    const mine = rows.find((r) => r.event_key === eventKey);
    // 2. Consent withdrawal commits while the row is claimed (status is
    //    still 'queued' — the claim only takes a lease).
    const withdrawal = await dbA.batch(consentWithdrawalStatements(dbA, {
      requestId, requesterUserId: "reqD", operationId: crypto.randomUUID(),
    }));
    const wChanges = withdrawal.map((r) => Number(r?.meta.changes ?? -1));
    // 3. The drain renews ownership just before IO — exact production SQL.
    const renewal = await dbA.prepare(
      "UPDATE notification_outbox SET lease_until=? WHERE id=? AND status='queued' AND lease_token=? AND datetime(lease_until)>datetime(?)"
    ).bind(new Date(now.getTime() + 10 * 60_000).toISOString(), mine.id, token, new Date().toISOString()).run();
    const renewalChanges = Number(renewal.meta.changes ?? -1);
    const notice = (await admin.unsafe("SELECT status,last_error,lease_token FROM notification_outbox WHERE event_key=$1", [eventKey]))[0];
    const state = await requestState(requestId);
    const deliveries = await count("SELECT COUNT(*)::int AS n FROM notification_deliveries WHERE event_key=$1", eventKey);
    const pass = Boolean(mine) && wChanges[0] === 1 && wChanges[1] === 1 && wChanges[2] === 1
      && renewalChanges === 0 && notice.status === "suppressed" && notice.last_error === "consent_withdrawn"
      && notice.lease_token === null && state.share_contact === 0 && deliveries === 0;
    record("W6-consent-withdrawal-beats-claimed-delivery", pass,
      `claimed=${Boolean(mine)}, withdrawal=${JSON.stringify(wChanges)}, lease_renewal=${renewalChanges}, notice=${notice.status}/${notice.last_error}, share_contact=${state.share_contact}, deliveries=${deliveries}`);
  }

  // -----------------------------------------------------------------------
  // W7. Reverse consent interleave + one-way withdrawal.
  // -----------------------------------------------------------------------
  {
    const requestId = await seedRequest("reqD", { shareContact: 1 });
    const eventKey = `service-request:${requestId}:created:prov`;
    await seedNotice(requestId, eventKey, "provider_accepted");
    const withdrawal = await dbA.batch(consentWithdrawalStatements(dbA, {
      requestId, requesterUserId: "reqD", operationId: crypto.randomUUID(),
    }));
    const first = withdrawal.map((r) => Number(r?.meta.changes ?? -1));
    const noticeAfterFirst = (await admin.unsafe("SELECT status,last_error FROM notification_outbox WHERE event_key=$1", [eventKey]))[0];
    const second = (await dbA.batch(consentWithdrawalStatements(dbA, {
      requestId, requesterUserId: "reqD", operationId: crypto.randomUUID(),
    }))).map((r) => Number(r?.meta.changes ?? -1));
    const state = await requestState(requestId);
    const pass = first[0] === 1 && first[1] === 0 && first[2] === 1
      && noticeAfterFirst.status === "provider_accepted"
      && second[0] === 0 && second[1] === 0 && second[2] === 0
      && state.share_contact === 0;
    record("W7-accepted-notice-untouched-second-withdrawal-noop", pass,
      `first=${JSON.stringify(first)}, notice=${noticeAfterFirst.status}, second=${JSON.stringify(second)}, share_contact=${state.share_contact}`);
  }

  // -----------------------------------------------------------------------
  // W8. Bounded true races: no torn state in any landing order.
  // -----------------------------------------------------------------------
  {
    const rounds = 25;
    // The write side gets a small head start so both landing orders occur:
    // the batch opens a transaction and runs several statements, so without
    // jitter the single-statement revocation would always win.
    const writeJitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
    const revokeJitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    let torn = 0, landed = 0, noop = 0, errors = 0;
    for (let i = 0; i < rounds; i++) {
      const requestId = await seedRequest("reqA");
      const operationId = crypto.randomUUID();
      const statements = providerTransition(requestId, operationId);
      const race = await Promise.allSettled([
        (async () => { await writeJitter(); return dbA.batch(statements); })(),
        (async () => { await revokeJitter(); return admin.unsafe("UPDATE users SET is_active=0 WHERE id='prov'"); })(),
      ]);
      await admin.unsafe("UPDATE users SET is_active=1 WHERE id='prov'");
      const writeOutcome = race[0].status === "fulfilled" ? race[0].value : null;
      if (!writeOutcome) { errors += 1; continue; }
      const changes = Number(writeOutcome[0]?.meta.changes ?? -1);
      const state = await requestState(requestId);
      const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='service_request.transitioned' AND entity_id=$1", String(requestId));
      const outbox = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE 'service-request:' || $1 || ':%'", String(requestId));
      const consistent = (changes === 0 || changes === 1)
        && audits === changes && outbox === changes
        && state.row_version === 1 + changes
        && state.status === (changes === 1 ? "acknowledged" : "new");
      if (!consistent) torn += 1;
      if (changes === 1) landed += 1; else noop += 1;
    }
    const pass = torn === 0 && errors === 0 && (landed + noop) === rounds;
    record("W8-race-transition-vs-deactivation", pass,
      `rounds=${rounds}, landed=${landed}, noop=${noop}, torn=${torn}, errors=${errors}`);
  }
  {
    const rounds = 25;
    const writeJitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
    const blockJitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    let torn = 0, created = 0, refused = 0, errors = 0;
    for (let i = 0; i < rounds; i++) {
      const actor = raceUsers[i];
      const note = `NEXT-02 W8 race lead ${i}`;
      const payload = { provider_person_id: 1, category: "farrier", note, share_contact: 1 };
      const digest = await sha256Hex(payload);
      const receiptKey = await serviceReceiptKey(actor, `next02-w8-key-${i}`);
      const statements = createServiceStatements(dbA, {
        operationId: crypto.randomUUID(), receiptKey, digest, actorUserId: actor, providerPersonId: 1,
        category: "farrier", province: "IR-07", city: null, horseId: null,
        note, shareContact: true, responseJson: JSON.stringify({ created: true, request: payload }),
      });
      const race = await Promise.allSettled([
        (async () => { await writeJitter(); return dbA.batch(statements); })(),
        (async () => {
          await blockJitter();
          return admin.unsafe(
            "INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason,created_by_user_id,creation_operation_id) VALUES (1,$1,'W8 race block','prov',$2)",
            [actor, crypto.randomUUID()]);
        })(),
      ]);
      if (race[0].status === "rejected") { errors += 1; continue; }
      const receipts = await count("SELECT COUNT(*)::int AS n FROM service_request_receipts WHERE id=$1", receiptKey);
      const requests = await count("SELECT COUNT(*)::int AS n FROM service_requests WHERE requester_user_id=$1", actor);
      const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='service_request.created' AND actor_user_id=$1", actor);
      const outbox = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key LIKE '%:created:prov' AND payload_ref IN (SELECT 'service_requests:' || CAST(id AS TEXT) FROM service_requests WHERE requester_user_id=$1)", actor);
      const blocks = await count("SELECT COUNT(*)::int AS n FROM service_provider_blocks WHERE blocked_requester_user_id=$1", actor);
      // Honest invariant: the create is all-or-nothing (receipt/audit/request
      // together, 0 or 1). The created-NOTICE is a suppressible side effect:
      // the outbox INSERT re-checks the provider block in-write, so a block
      // landing between the batch's own statements legitimately suppresses
      // the notice (request exists, notice does not). A block landing after
      // the batch leaves the notice queued (the production block path would
      // suppress it on the next block command). Both orders are valid; only
      // a notice without its request, or a request without receipt/audit,
      // would be torn state.
      const consistent = receipts === requests && audits === requests && (requests === 0 || requests === 1)
        && outbox <= requests && (blocks === 0 ? outbox === requests : true);
      if (!consistent) torn += 1;
      if (requests === 1) created += 1; else refused += 1;
    }
    const pass = torn === 0 && errors === 0 && (created + refused) === rounds && created > 0 && refused > 0;
    record("W8-race-create-vs-block", pass,
      `rounds=${rounds}, created=${created}, refused=${refused}, torn=${torn}, errors=${errors}`);
  }

  // -----------------------------------------------------------------------
  // 3. Report
  // -----------------------------------------------------------------------
  const summary = { harness: "pg-next02-write-race", server: serverVersion, migrations_applied: migrations.length,
    scenarios: findings, pass: findings.every((f) => f.pass) };
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`report written: ${reportPath}`);
  }
  console.log(`\npg-next02-write-race: ${findings.filter((f) => f.pass).length}/${findings.length} scenarios passed${summary.pass ? "" : " — FAILURES PRESENT"}`);
  process.exitCode = summary.pass ? 0 : 1;
}

/** Translate + run a raw SQLite-dialect seed block on the admin connection. */
function toSeed(sqlText) {
  return splitStatements(sqlText).map((s) => sqliteSqlToPostgres(ddlNormalize(s))).join(";\n");
}

main().catch(async (error) => {
  console.error("pg-next02-write-race failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  for (const db of adapters) { try { await closeSupabaseD1Database(db); } catch { /* teardown best-effort */ } }
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } catch { /* best-effort cleanup; the schema this process created only */ }
  await admin.end({ timeout: 2 }).catch(() => {});
});
