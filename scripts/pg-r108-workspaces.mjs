#!/usr/bin/env node
/**
 * pg-r108-workspaces — R108-20: exact-adapter workspace cases on the real
 * target PostgreSQL engine, using the PRODUCTION supabaseCompat adapter
 * (createSupabaseD1Database, mode "full") and the PRODUCTION command
 * builders. No SQL recorder stands in for the database.
 *
 * Scenarios (each asserts domain rows + audit rows + outbox together):
 *   W1. versioned reassignment race: two concurrent same-version reassign
 *       commands -> exactly ONE winner, row_version advances exactly once,
 *       exactly one operation audit, the loser a zero-row no-op.
 *   W2. duplicate task-create race (same occurrence key) -> exactly one task
 *       and one task_created audit (idempotency by construction).
 *   W3. duplicate invite-accept race: the same invitee accepts through two
 *       adapters concurrently -> exactly ONE assignment row, invite accepted
 *       exactly once, one audit.
 *   W4. inactive-inviter acceptance: a departed inviter's pending invite can
 *       never create a membership (in-write inviter authority re-check).
 *   W5. staff-departure suppression scope: revoking staff in workspace 1
 *       suppresses ONLY workspace 1's queued reminders (marker-gated, same
 *       batch); workspace 2's queue stays intact.
 *   W6. R108-08 document semantics: create with a member horse lands;
 *       versioned update advances the version and never touches horse_id;
 *       a stale version is a zero-row no-op with no audit.
 *   W7. R108-08 import receipts: createTaskStatements stamps the durable
 *       import_intent_key; the same-occurrence replay is a zero-row no-op
 *       (exactly one task stays, no duplicate audit).
 *   W8. FK/predicate enforcement: a document for a NON-member horse writes
 *       zero rows and no audit; a task for a non-member horse likewise.
 *   W9. middle-of-batch rollback: a valid statement followed by a
 *       constraint-violating statement rolls back TOGETHER (atomic batch).
 *
 * Usage:
 *   PG_CONNECTION_STRING=postgres://user@127.0.0.1:PORT/hr_test_r108 \
 *     PG_PARITY_DISPOSABLE=yes node scripts/pg-r108-workspaces.mjs \
 *     [--report review-r108/evidence/pg-r108-workspaces-pg17.json]
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
const {
  inviteStaffStatements, acceptStaffInviteStatements, createDocumentStatements,
  updateDocumentStatements, suppressQueuedWorkspaceNotificationsStatement, reassignTaskStatements,
} = require("../src/workspaces/collaboration.ts");
const { revokeStaffStatements, createTaskStatements } = require("../src/workspaces/mutationCommands.ts");
const { taskOccurrenceKey } = require("../src/workspaces/domain.ts");

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
  console.error("R108 workspace gate requires a loopback hr_test_* database (the same disposable rule as canonical migration gating)");
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
  if (code === "23502") return "not_null_violation";
  if (code === "40001" || code === "40P01") return `serialization:${code}`;
  return `pg_error:${code || (error instanceof Error ? error.message.slice(0, 120) : "unknown")}`;
}

const admin = postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 });
let adapters = [];

/** Translate + run a raw SQLite-dialect seed block on the admin connection. */
function toSeed(sqlText) {
  return splitStatements(sqlText).map((s) => sqliteSqlToPostgres(ddlNormalize(s))).join(";\n");
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
      throw new Error(`migration ${name} failed on the R108 workspace gate target: ${error.message}`);
    }
  }
  console.log(`migrations applied: ${migrations.length} (schema ${schema})`);
  const dbA = createSupabaseD1Database(adapterUrl, { mode: "full" });
  const dbB = createSupabaseD1Database(adapterUrl, { mode: "full" });
  adapters = [dbA, dbB];
  const both = async (fn) => Promise.allSettled([fn(dbA, 0), fn(dbB, 1)]);
  const count = async (sql, ...binds) => Number((await admin.unsafe(sql, binds))[0]?.n ?? 0);

  // -----------------------------------------------------------------------
  // 2. Seed: the R108 workspace world (raw translated SQL, admin connection).
  // -----------------------------------------------------------------------
  await admin.unsafe(toSeed(`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('ws-owner','owner@example.test','WS Owner','not-a-real-hash','user',1),
      ('staff-x','staffx@example.test','Staff X','not-a-real-hash','user',1),
      ('staff-y','staffy@example.test','Staff Y','not-a-real-hash','user',1),
      ('staff-z','staffz@example.test','Staff Z','not-a-real-hash','user',1),
      ('departed','departed@example.test','Departed Inviter','not-a-real-hash','user',1),
      ('invitee','invitee@example.test','Invitee','not-a-real-hash','user',1),
      ('assignee','assignee@example.test','Assignee','not-a-real-hash','user',1);
    INSERT INTO workspace_collections(id,name,owner_user_id) VALUES
      (1,'R108 Herd One','ws-owner'),(2,'R108 Herd Two','ws-owner');
    INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (91,'R108 Gate Horse',1,NULL);
    INSERT INTO workspace_collection_members(collection_id,horse_id,added_by_user_id) VALUES (1,91,'ws-owner');
    INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id,last_operation_id)
      VALUES (1,'staff-x','view,tasks_manage','ws-owner','seed-op-x'),
             (1,'staff-y','view','ws-owner','seed-op-y'),
             (2,'staff-z','view,tasks_manage','ws-owner','seed-op-z'),
             (2,'staff-x','view,tasks_manage','ws-owner','seed-op-x2');
    INSERT INTO workspace_tasks(id,collection_id,horse_id,title,category,due_date,recurrence,created_by_user_id,assigned_to_user_id,occurrence_key,occurrence_index,last_operation_id)
      VALUES (101,1,91,'R108 reassign target','farrier','2026-11-01','none','ws-owner','staff-x','r108:gate:reassign:101',0,'seed-op-t101'),
             (102,1,91,'R108 staff-x reminder','farrier','2026-11-02','none','ws-owner','staff-x','r108:gate:remind:102',0,'seed-op-t102'),
             (201,2,NULL,'R108 ws2 staff-x reminder','other','2026-11-03','none','ws-owner','staff-x','r108:gate:remind:201',0,'seed-op-t201');
    INSERT INTO notification_outbox(event_key,channel,purpose,recipient_user_id,recipient_masked,status,payload_ref)
      VALUES ('r108-w1','email','workspace_task_reminder','staff-x','s***@x.com','queued','workspace_tasks:102'),
             ('r108-w2','email','workspace_task_reminder','staff-x','s***@x.com','queued','workspace_tasks:201');
  `));

  // -----------------------------------------------------------------------
  // W1. Versioned reassignment race (R108 workspace fix).
  // -----------------------------------------------------------------------
  {
    const race = await both((db, i) => db.batch(reassignTaskStatements(db, {
      collectionId: 1, taskId: 101, newAssigneeUserId: i === 0 ? "assignee" : null,
      actorUserId: "ws-owner", operationId: `r108-w1-${i}`, expectedVersion: 1,
    })));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[1]?.meta.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const winners = outcomes.filter((v) => v === 1).length;
    const task = (await admin.unsafe("SELECT row_version, assigned_to_user_id FROM workspace_tasks WHERE id=101"))[0];
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.task_reassigned' AND entity_id='101'");
    const pass = winners === 1 && Number(task.row_version) === 2 && audits === 1;
    record("W1-reassignment-race", pass,
      `outcomes=${JSON.stringify(outcomes)}, row_version=${task.row_version}, assignee=${task.assigned_to_user_id}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // W2. Duplicate task-create race (idempotency by occurrence key).
  // -----------------------------------------------------------------------
  {
    const key = taskOccurrenceKey("r108:gate:dup-create", "2026-11-10", 0);
    const race = await both((db, i) => db.batch(createTaskStatements(db, {
      collectionId: 1, horseId: null, title: "R108 duplicate create", category: "other",
      dueDate: "2026-11-10", recurrence: "none", recurrenceIntervalDays: null,
      actorUserId: "ws-owner", assignedToUserId: null, occurrenceKey: key, operationId: `r108-w2-${i}`,
    })));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[1]?.meta.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const tasks = await count("SELECT COUNT(*)::int AS n FROM workspace_tasks WHERE occurrence_key=$1", key);
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.task_created' AND entity_id=$1", key);
    const pass = tasks === 1 && audits === 1 && outcomes.filter((v) => v === 1).length === 1;
    record("W2-duplicate-task-create-race", pass,
      `outcomes=${JSON.stringify(outcomes)}, tasks=${tasks}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // W3. Duplicate invite-accept race: one assignment, one accepted invite.
  // -----------------------------------------------------------------------
  {
    const invited = await dbA.batch(inviteStaffStatements(dbA, {
      collectionId: 1, inviteeUserId: "invitee", proposedActions: "view", actorUserId: "ws-owner",
      operationId: "r108-w3-invite", expiresAtText: "2026-12-01 00:00:00", note: null,
    }));
    const inviteLanded = Number(invited[1]?.meta.changes ?? 0) === 1;
    const race = await both((db, i) => db.batch(acceptStaffInviteStatements(db, {
      collectionId: 1, inviteeUserId: "invitee", actorUserId: "invitee", operationId: `r108-w3-accept-${i}`,
    })));
    const outcomes = race.map((r) => (r.status === "fulfilled" ? Number(r.value?.[1]?.meta.changes ?? 0) : `ERR:${pgErrorClass(r.reason)}`));
    const assignments = await count("SELECT COUNT(*)::int AS n FROM workspace_staff_assignments WHERE collection_id=1 AND user_id='invitee' AND status='active'");
    const accepted = await count("SELECT COUNT(*)::int AS n FROM workspace_staff_invites WHERE collection_id=1 AND invitee_user_id='invitee' AND status='accepted'");
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.staff_invite_accepted' AND entity_type='workspace_staff_assignments' AND actor_user_id='invitee'");
    const pass = inviteLanded && assignments === 1 && accepted === 1 && audits === 1;
    record("W3-duplicate-invite-accept-race", pass,
      `inviteLanded=${inviteLanded}, outcomes=${JSON.stringify(outcomes)}, assignments=${assignments}, acceptedInvites=${accepted}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // W4. Inactive/departed inviter: acceptance creates nothing.
  // -----------------------------------------------------------------------
  {
    await admin.unsafe(toSeed(`
      INSERT INTO workspace_staff_invites(collection_id,invitee_user_id,invited_by_user_id,proposed_actions,status,note,expires_at,last_invite_operation_id)
        VALUES (2,'invitee','departed','view','pending',NULL,'2026-12-01 00:00:00','r108-w4-invite');
    `));
    const acceptance = await dbA.batch(acceptStaffInviteStatements(dbA, {
      collectionId: 2, inviteeUserId: "invitee", actorUserId: "invitee", operationId: "r108-w4-accept",
    }));
    const inserted = Number(acceptance[1]?.meta.changes ?? 0);
    const assignments = await count("SELECT COUNT(*)::int AS n FROM workspace_staff_assignments WHERE collection_id=2 AND user_id='invitee'");
    const stillPending = await count("SELECT COUNT(*)::int AS n FROM workspace_staff_invites WHERE collection_id=2 AND invitee_user_id='invitee' AND status='pending'");
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.staff_invite_accepted' AND actor_user_id='invitee' AND entity_id='2'");
    const pass = inserted === 0 && assignments === 0 && stillPending === 1 && audits === 0;
    record("W4-departed-inviter-acceptance", pass,
      `inserted=${inserted}, assignments=${assignments}, stillPending=${stillPending}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // W5. Staff-departure suppression scope (workspace-scoped, marker-gated).
  // -----------------------------------------------------------------------
  {
    const opId = "r108-w5-revoke";
    const revoke = revokeStaffStatements(dbA, { collectionId: 1, userId: "staff-x", actorUserId: "ws-owner", operationId: opId });
    const batch = [...revoke, suppressQueuedWorkspaceNotificationsStatement(dbA, "staff-x", 1, opId)];
    const results = await dbA.batch(batch);
    const revoked = Number(results[1]?.meta.changes ?? 0) === 1;
    const suppressedWs1 = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key='r108-w1' AND status='suppressed'");
    const queuedWs2 = await count("SELECT COUNT(*)::int AS n FROM notification_outbox WHERE event_key='r108-w2' AND status='queued'");
    const revokeAudits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.staff_revoked' AND entity_id='1'");
    const pass = revoked && suppressedWs1 === 1 && queuedWs2 === 1 && revokeAudits === 1;
    record("W5-revocation-suppression-scope", pass,
      `revoked=${revoked}, ws1Suppressed=${suppressedWs1}, ws2StillQueued=${queuedWs2}, audits=${revokeAudits}`);
  }

  // -----------------------------------------------------------------------
  // W6. R108-08 document semantics: versioned update never moves horse_id;
  //     stale version is a zero-row no-op with no audit.
  // -----------------------------------------------------------------------
  {
    const created = await dbA.batch(createDocumentStatements(dbA, {
      collectionId: 2, horseId: null, title: "R108 gate document", category: "registration",
      note: "paper file", expiresAtDay: "2027-01-01", actorUserId: "ws-owner", operationId: "r108-w6-create",
    }));
    const createdRows = Number(created[1]?.meta.changes ?? 0);
    const docId = Number(created[1]?.meta.last_row_id ?? 0);
    const updated = await dbA.batch(updateDocumentStatements(dbA, {
      collectionId: 2, documentId: docId, expectedVersion: 1, title: "R108 gate document v2",
      category: "registration", note: "updated", expiresAtDay: "2027-02-01", actorUserId: "ws-owner", operationId: "r108-w6-update",
    }));
    const updatedRows = Number(updated[1]?.meta.changes ?? 0);
    const stale = await dbB.batch(updateDocumentStatements(dbB, {
      collectionId: 2, documentId: docId, expectedVersion: 1, title: "stale attempt",
      category: "registration", note: null, expiresAtDay: null, actorUserId: "ws-owner", operationId: "r108-w6-stale",
    }));
    const staleRows = Number(stale[1]?.meta.changes ?? 0);
    const doc = (await admin.unsafe("SELECT row_version, title, note FROM workspace_documents WHERE id=$1", [docId]))[0];
    // The create audit's entity_id is the operation id; the update audit's is the document id.
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_type='workspace_documents' AND (entity_id=$1 OR entity_id=$2)", String(docId), "r108-w6-create");
    const pass = createdRows === 1 && updatedRows === 1 && staleRows === 0
      && Number(doc.row_version) === 2 && doc.title === "R108 gate document v2" && audits === 2;
    record("W6-document-versioned-update", pass,
      `created=${createdRows}, updated=${updatedRows}, stale=${staleRows}, row_version=${doc.row_version}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // W7. R108-08 import receipts: durable intent stamp + zero-duplicate replay.
  // -----------------------------------------------------------------------
  {
    const key = taskOccurrenceKey("import:2:R108 import row:other:0", "2026-12-01", 0);
    const intentKey = "r108-gate-intent-1";
    const first = await dbA.batch(createTaskStatements(dbA, {
      collectionId: 2, horseId: null, title: "R108 import row", category: "other",
      dueDate: "2026-12-01", recurrence: "none", recurrenceIntervalDays: null,
      actorUserId: "ws-owner", assignedToUserId: null, occurrenceKey: key, operationId: "r108-w7-first",
      importIntentKey: intentKey,
    }));
    const firstRows = Number(first[1]?.meta.changes ?? 0);
    const replay = await dbB.batch(createTaskStatements(dbB, {
      collectionId: 2, horseId: null, title: "R108 import row", category: "other",
      dueDate: "2026-12-01", recurrence: "none", recurrenceIntervalDays: null,
      actorUserId: "ws-owner", assignedToUserId: null, occurrenceKey: key, operationId: "r108-w7-replay",
      importIntentKey: intentKey,
    }));
    const replayRows = Number(replay[1]?.meta.changes ?? 0);
    const tasks = await count("SELECT COUNT(*)::int AS n FROM workspace_tasks WHERE occurrence_key=$1", key);
    const stamped = await count("SELECT COUNT(*)::int AS n FROM workspace_tasks WHERE occurrence_key=$1 AND import_intent_key=$2", key, intentKey);
    const audits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.task_created' AND entity_id=$1", key);
    const pass = firstRows === 1 && replayRows === 0 && tasks === 1 && stamped === 1 && audits === 1;
    record("W7-import-receipt-replay", pass,
      `first=${firstRows}, replay=${replayRows}, tasks=${tasks}, stamped=${stamped}, audits=${audits}`);
  }

  // -----------------------------------------------------------------------
  // W8. FK/predicate enforcement: a NON-member horse writes nothing.
  // -----------------------------------------------------------------------
  {
    await admin.unsafe(toSeed(`
      INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (92,'NOT A MEMBER',1,NULL);
    `));
    const doc = await dbA.batch(createDocumentStatements(dbA, {
      collectionId: 2, horseId: 92, title: "stranger document", category: "other",
      note: null, expiresAtDay: null, actorUserId: "ws-owner", operationId: "r108-w8-doc",
    }));
    const docRows = Number(doc[1]?.meta.changes ?? 0);
    const task = await dbB.batch(createTaskStatements(dbB, {
      collectionId: 2, horseId: 92, title: "stranger task", category: "other",
      dueDate: "2026-12-02", recurrence: "none", recurrenceIntervalDays: null,
      actorUserId: "ws-owner", assignedToUserId: null, occurrenceKey: taskOccurrenceKey("r108:gate:stranger", "2026-12-02", 0), operationId: "r108-w8-task",
    }));
    const taskRows = Number(task[1]?.meta.changes ?? 0);
    const docAudits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.document_created' AND entity_id='r108-w8-doc'");
    const taskAudits = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.task_created' AND entity_id=$1", taskOccurrenceKey("r108:gate:stranger", "2026-12-02", 0));
    const pass = docRows === 0 && taskRows === 0 && docAudits === 0 && taskAudits === 0;
    record("W8-non-member-horse-refused", pass,
      `docRows=${docRows}, taskRows=${taskRows}, docAudits=${docAudits}, taskAudits=${taskAudits}`);
  }

  // -----------------------------------------------------------------------
  // W9. Middle-of-batch rollback: atomic all-or-nothing.
  // -----------------------------------------------------------------------
  {
    const before = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.document_created'");
    const goodBatch = createDocumentStatements(dbA, {
      collectionId: 2, horseId: null, title: "R108 rollback probe", category: "other",
      note: null, expiresAtDay: null, actorUserId: "ws-owner", operationId: "r108-w9-good",
    });
    const failing = dbA.prepare("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES (999,'bad',NULL)");
    let rolled = false;
    try {
      await dbA.batch([...goodBatch, failing]);
    } catch (error) {
      rolled = pgErrorClass(error).startsWith("not_null_violation") || pgErrorClass(error).startsWith("pg_error");
    }
    const docs = await count("SELECT COUNT(*)::int AS n FROM workspace_documents WHERE title='R108 rollback probe'");
    const after = await count("SELECT COUNT(*)::int AS n FROM audit_events WHERE action='workspace.document_created'");
    const pass = rolled && docs === 0 && after === before;
    record("W9-middle-of-batch-rollback", pass,
      `rolledBack=${rolled}, docsSurvived=${docs}, auditsBefore=${before}, auditsAfter=${after}`);
  }

  // -----------------------------------------------------------------------
  // 3. Report
  // -----------------------------------------------------------------------
  const summary = { harness: "pg-r108-workspaces", server: serverVersion, migrations_applied: migrations.length,
    scenarios: findings, pass: findings.every((f) => f.pass) };
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`report written: ${reportPath}`);
  }
  console.log(`\npg-r108-workspaces: ${findings.filter((f) => f.pass).length}/${findings.length} scenarios passed${summary.pass ? "" : " — FAILURES PRESENT"}`);
  process.exitCode = summary.pass ? 0 : 1;
}

main().catch(async (error) => {
  console.error("pg-r108-workspaces failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  for (const db of adapters) { try { await closeSupabaseD1Database(db); } catch { /* teardown best-effort */ } }
  try {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } catch { /* best-effort cleanup; the schema this process created only */ }
  await admin.end({ timeout: 2 }).catch(() => {});
});
