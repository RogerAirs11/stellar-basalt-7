#!/usr/bin/env node
/**
 * N14 apply-script smoke: boot the embedded PG, build a disposable database
 * holding ONLY migrations <=0060 plus the old-schema duplicate/stuck states,
 * then run scripts/apply-0061-to-supabase.mjs against it as a subprocess and
 * assert the postflight state (merge, indexes, provenance events).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "/tmp/pgembedded/node_modules/embedded-postgres/dist/index.js";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/pgembedded/data", user: "postgres", password: "postgres",
  port: 5433, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=/tmp"],
});

try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("hr_test_n14apply");
  const { default: postgres } = await import("postgres");
  const admin = postgres("postgres://postgres:postgres@127.0.0.1:5433/postgres", { max: 1 });
  await admin`DROP DATABASE IF EXISTS hr_test_n14apply_template`;
  await admin.end({ timeout: 3 });

  const db = postgres("postgres://postgres:postgres@127.0.0.1:5433/hr_test_n14apply", { max: 1 });
  // Apply <=0060 through the production translator (same loop as the gate).
  const { compileTsRuntime } = await import(join(root, "tools/ts-runtime-loader.mjs"));
  const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
  const { sqliteSqlToPostgres, stripLeadingComments } = rt.load("src/db/sqliteSqlToPostgres.ts");
  const files = readdirSync(join(root, "migrations")).filter(f => /^\d+.*\.sql$/.test(f)).sort()
    .filter(f => Number(f.slice(0, 4)) <= 60);
  for (const name of files) {
    const raw = readFileSync(join(root, "migrations", name), "utf8");
    await db.begin(async (tx) => {
      for (const statement of splitStatements(raw)) {
        const bare = stripLeadingComments(statement);
        if (/^\s*PRAGMA\b/i.test(bare)) continue;
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue;
        await tx.unsafe(sqliteSqlToPostgres(ddlNormalize(statement)));
      }
    });
  }
  console.log("smoke: chain <=0060 applied to hr_test_n14apply");

  // Old-schema state: duplicate actives (new + triaged) and a stuck dismissal.
  await db`
    INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES
      ('r1','r1@t.test','R1','x','user',1),('adm','adm@t.test','ADM','x','admin',1)`;
  await db`INSERT INTO horses(id,name_latin) VALUES (1,'H1'),(2,'H2')`;
  await db`INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) VALUES
    ('L1',1,'r1','S','active','user'),('L2',2,'r1','S','active','user')`;
  // Group (r1, L1): reachable duplicate-ACTIVE pair (10 triaged + 11 new).
  await db`INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES
    (10,'sales_listings','L1','r1','spam','new','2026-10-01 08:00:00')`;
  await db`UPDATE moderation_cases SET status='triaged', assigned_operator_user_id='adm' WHERE id=10 AND status='new'`;
  await db`INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES
    (11,'sales_listings','L1','r1','spam','new','2026-10-01 09:00:00')`;
  // Group (r1, L2): 13 dismissed earlier; 14 the F27-stuck case (its
  // dismissal collided with 13's resolved status under the old constraint).
  await db`INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES
    (13,'sales_listings','L2','r1','spam','new','2026-09-01 08:00:00')`;
  await db`UPDATE moderation_cases SET status='resolved_dismissed', resolved_at=CURRENT_TIMESTAMP WHERE id=13 AND status='new'`;
  await db`INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES
    (14,'sales_listings','L2','r1','fraud_suspected','new','2026-09-05 09:00:00')`;
  await db`INSERT INTO moderation_case_events(id,case_id,actor_user_id,event_type,event_json,created_at) VALUES
    (100,10,'r1','created','{"reason":"spam"}','2026-10-01 08:00:01')`;
  await db`INSERT INTO listing_suspensions(id,listing_id,case_id,suspended_by_user_id,reason,suspended_at) VALUES
    (300,'L1',13,'adm','legacy reason','2026-09-02 00:00:00')`;
  console.log("smoke: old-schema duplicate + stuck states seeded");

  // Run the real apply script as a subprocess (its own connection + transaction).
  const proc = spawnSync(process.execPath, [join(root, "scripts/apply-0061-to-supabase.mjs")], {
    encoding: "utf8",
    env: { ...process.env, PG_PARITY_DISPOSABLE: "yes", SUPABASE_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5433/hr_test_n14apply" },
  });
  console.log(proc.stdout);
  if (proc.status !== 0) { console.error(proc.stderr); throw new Error("apply-0061 subprocess failed"); }

  // Assertions on the final state.
  const cases = await db`SELECT id,status,merged_into_case_id FROM moderation_cases ORDER BY id`;
  console.log("smoke cases:", JSON.stringify(cases));
  const get = (id) => cases.find((c) => Number(c.id) === id);
  if (get(10).status !== "triaged") throw new Error("keeper lost");
  if (get(11).status !== "resolved_merged" || Number(get(11).merged_into_case_id) !== 10) throw new Error("merge wrong");
  if (get(13).status !== "resolved_dismissed") throw new Error("history touched");
  if (get(14).status !== "new") throw new Error("stuck case not kept active");
  const events = await db`SELECT case_id FROM moderation_case_events WHERE actor_user_id='migration_0061'`;
  if (events.length !== 1 || Number(events[0].case_id) !== 11) throw new Error("provenance events wrong: " + JSON.stringify(events));
  const legacyEvent = await db`SELECT id FROM moderation_case_events WHERE id=100`;
  if (legacyEvent.length !== 1) throw new Error("legacy event lost");
  const legacySusp = await db`SELECT id FROM listing_suspensions WHERE id=300`;
  if (legacySusp.length !== 1) throw new Error("legacy suspension lost");
  const stuckDismiss = await db`UPDATE moderation_cases SET status='resolved_dismissed', resolved_at=CURRENT_TIMESTAMP WHERE id=14 AND status='new'`;
  if (stuckDismiss.count !== 1) throw new Error("the stuck dismissal still does not work");
  const indexes = await db`SELECT indexname FROM pg_indexes WHERE indexname IN ('uq_moderation_cases_active','uq_moderation_appeals_one_open')`;
  if (indexes.length !== 2) throw new Error("partial indexes missing");
  // Idempotency: a second run is a no-op.
  const second = spawnSync(process.execPath, [join(root, "scripts/apply-0061-to-supabase.mjs")], {
    encoding: "utf8",
    env: { ...process.env, PG_PARITY_DISPOSABLE: "yes", SUPABASE_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5433/hr_test_n14apply" },
  });
  if (!/already present/.test(second.stdout)) { console.error(second.stdout, second.stderr); throw new Error("second run not idempotent"); }
  console.log("APPLY-0061 SMOKE: ALL ASSERTIONS PASS (merge, stuck unblocked, children preserved, idempotent)");
  await db.end({ timeout: 3 });
} catch (error) {
  console.error("SMOKE FAILURE:", error);
  process.exitCode = 1;
} finally {
  try { await pg.stop(); } catch { /* already down */ }
}
