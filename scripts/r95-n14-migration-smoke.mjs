#!/usr/bin/env node
/**
 * N14 migration smoke: apply the full chain to a real SQLite (node:sqlite),
 * then exercise the 0061 upgrade path specifically — apply ≤0060, seed the
 * states that were possible under the OLD schema (duplicate actives with
 * different active statuses; two closed cases with the SAME resolved status),
 * apply 0061, and assert the merge + the new indexes + post-upgrade behavior.
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../migrations");
const all = readdirSync(dir).filter(f => /^\d+.*\.sql$/.test(f)).sort();
const upTo60 = all.filter(f => Number(f.slice(0, 4)) <= 60);
const m61 = all.find(f => f.startsWith("0061"));

function apply(db, files) {
  for (const f of files) db.exec(readFileSync(join(dir, f), "utf8"));
}

// --- Phase 1: full-chain fresh apply (fresh DB sees 0061 in sequence) ---
{
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  apply(db, all);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('uq_moderation_cases_active','uq_moderation_appeals_one_open','idx_moderation_cases_queue','idx_moderation_cases_target','idx_moderation_case_events_case','idx_moderation_appeals_case','idx_listing_suspensions_listing')").all();
  console.log("phase1 indexes:", idx.map(r => r.name).sort());
  if (idx.length !== 7) throw new Error("phase1: expected 7 moderation indexes");
  // old table constraint must be GONE: two closed cases with the same resolved status
  db.exec("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('r1','r1@t.test','R1','x','user',1),('adm','adm@t.test','ADM','x','admin',1)");
  db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'H1')");
  db.exec("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) VALUES('L1',1,'r1','S','active','user')");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(1,'sales_listings','L1','r1','spam','resolved_dismissed')");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(2,'sales_listings','L1','r1','spam','new')");
  db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=2"); // the F27 blocker: same resolved status twice
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(3,'sales_listings','L1','r1','spam','resolved_dismissed')"); // a THIRD one, same closed status again
  const n = db.prepare("SELECT COUNT(*) c FROM moderation_cases WHERE status='resolved_dismissed'").get();
  if (n.c !== 3) throw new Error("phase1: same-resolved-status multiplicity broken");
  // duplicate ACTIVE with different active statuses must fail (partial index)
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(4,'sales_listings','L1','r1','spam','new')");
  let dupFailed = false;
  try { db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(5,'sales_listings','L1','r1','spam','triaged')"); }
  catch (e) { dupFailed = /UNIQUE constraint/.test(String(e.message)); }
  if (!dupFailed) throw new Error("phase1: cross-status duplicate active was NOT blocked");
  // but a different reporter CAN be active on the same target
  db.exec("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('r2','r2@t.test','R2','x','user',1)");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(6,'sales_listings','L1','r2','spam','new')");
  // two open appeals for one case must fail (structural)
  db.exec("UPDATE moderation_cases SET status='resolved_hidden',resolved_at=CURRENT_TIMESTAMP WHERE id=4");
  db.exec("INSERT INTO moderation_appeals(id,case_id,appellant_user_id,statement) VALUES(1,4,'r1','first appeal statement long enough')");
  let appealDup = false;
  try { db.exec("INSERT INTO moderation_appeals(id,case_id,appellant_user_id,statement) VALUES(2,4,'r1','second appeal statement long enough')"); }
  catch (e) { appealDup = /UNIQUE constraint/.test(String(e.message)); }
  if (!appealDup) throw new Error("phase1: two open appeals were NOT blocked");
  // a decided appeal frees the slot
  db.exec("UPDATE moderation_appeals SET status='overturned',decided_at=CURRENT_TIMESTAMP WHERE id=1");
  db.exec("INSERT INTO moderation_appeals(id,case_id,appellant_user_id,statement) VALUES(3,4,'r1','later appeal after decision, valid again')");
  // FK integrity of the swap: children still enforce the parent
  try { db.exec("INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json) VALUES(9999,'x','note','{}')"); throw new Error("phase1: FK on events not enforced after swap"); }
  catch (e) { if (!/FOREIGN KEY/.test(String(e.message))) throw e; }
  // merged status accepted by CHECK
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,merged_into_case_id) VALUES(7,'sales_listings','L1','r2','spam','resolved_merged',6)");
  console.log("phase1 OK: same-resolved-status x3, cross-status active dedup, one-open-appeal, FKs intact, resolved_merged accepted");
  db.close();
}

// --- Phase 2: the upgrade fixture (only states REACHABLE under the old schema) ---
{
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  apply(db, upTo60);
  db.exec("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('r1','r1@t.test','R1','x','user',1),('adm','adm@t.test','ADM','x','admin',1)");
  db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'H1'),(2,'H2')");
  db.exec("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) VALUES('L1',1,'r1','S','active','user'),('L2',2,'r1','S','active','user')");

  // Group (r1, L1) — the reachable duplicate-ACTIVE pair. Chronology under
  // the OLD schema: file case 10 ('new'), assign it (-> 'triaged'), file
  // case 11 ('new' tuple now free). Assigning case 11 to 'triaged' collides
  // with case 10's tuple and FAILS — case 11 stays an unassigned 'new'.
  // Two actives for the same reporter+target is exactly what 0061's merge
  // exists to resolve.
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status,created_at) VALUES(10,'sales_listings','L1','r1','spam','first','new','2026-10-01 08:00:00')");
  db.exec("UPDATE moderation_cases SET status='triaged',assigned_operator_user_id='adm' WHERE id=10 AND status='new'");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status,created_at) VALUES(11,'sales_listings','L1','r1','spam','second','new','2026-10-01 09:00:00')");
  let assignBlocked = false;
  try { db.exec("UPDATE moderation_cases SET status='triaged',assigned_operator_user_id='adm' WHERE id=11 AND status='new'"); }
  catch (e) { assignBlocked = /UNIQUE constraint/.test(String(e.message)); }
  if (!assignBlocked) throw new Error("phase2: old-schema assign collision not reproduced (case 11 should be stuck as new)");

  // Group (r1, L2) — the F27 manifestation. Case 13 filed and dismissed.
  // Case 16 filed and hidden (with an upheld appeal + a suspension row —
  // child data the swap must preserve verbatim). Then case 14 filed for a
  // new incident; the operator's DISMISS collides with case 13's
  // resolved_dismissed tuple and fails — case 14 stays stuck as 'new'.
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES(13,'sales_listings','L2','r1','spam','new','2026-09-01 08:00:00')");
  db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=13 AND status='new'");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES(16,'sales_listings','L2','r1','offensive_content','new','2026-09-02 08:00:00')");
  db.exec("UPDATE moderation_cases SET status='resolved_hidden',resolved_at=CURRENT_TIMESTAMP WHERE id=16 AND status='new'");
  db.exec("INSERT INTO moderation_appeals(id,case_id,appellant_user_id,statement,status,decided_by_user_id) VALUES(200,16,'r1','the listing content is being misread, please reconsider','upheld','adm')");
  db.exec("INSERT INTO listing_suspensions(id,listing_id,case_id,suspended_by_user_id,reason) VALUES(300,'L2',16,'adm','offensive content confirmed on review')");
  db.exec("INSERT INTO moderation_case_events(id,case_id,actor_user_id,event_type,event_json) VALUES(100,10,'r1','created','{\"reason\":\"spam\"}')");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at) VALUES(14,'sales_listings','L2','r1','fraud_suspected','new','2026-09-05 09:00:00')");
  let dismissBlocked = false;
  try { db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=14 AND status='new'"); }
  catch (e) { dismissBlocked = /UNIQUE constraint/.test(String(e.message)); }
  if (!dismissBlocked) throw new Error("phase2: old-schema F27 decision block not reproduced (case 14 dismiss should collide with case 13)");

  apply(db, [m61]);

  const after = db.prepare("SELECT id,status,merged_into_case_id FROM moderation_cases ORDER BY id").all();
  console.log("phase2 cases:", after);
  const exp = [
    { id: 10, status: "triaged", merged: null },        // keeper stays active, exactly as it was
    { id: 11, status: "resolved_merged", merged: 10 },  // the younger duplicate merged away
    { id: 13, status: "resolved_dismissed", merged: null }, // closed history untouched
    { id: 14, status: "new", merged: null },            // the F27-stuck case: sole active in its group, kept active
    { id: 16, status: "resolved_hidden", merged: null },
  ];
  for (const e of exp) {
    const row = after.find(r => r.id === e.id);
    if (!row) throw new Error(`phase2: case ${e.id} missing`);
    if (row.status !== e.status) throw new Error(`phase2: case ${e.id} expected ${e.status} got ${row.status}`);
    if ((row.merged_into_case_id ?? null) !== e.merged) throw new Error(`phase2: case ${e.id} merge link mismatch: ${row.merged_into_case_id}`);
  }
  const mergeEvents = db.prepare("SELECT case_id FROM moderation_case_events WHERE actor_user_id='migration_0061' AND event_type='note' ORDER BY case_id").all();
  if (mergeEvents.length !== 1 || mergeEvents[0].case_id !== 11) throw new Error("phase2: merge provenance events wrong: " + JSON.stringify(mergeEvents));
  // pre-existing child rows survived the swap verbatim
  if (!db.prepare("SELECT 1 FROM moderation_case_events WHERE id=100 AND case_id=10").get()) throw new Error("phase2: event row lost in swap");
  if (!db.prepare("SELECT 1 FROM moderation_appeals WHERE id=200 AND case_id=16 AND status='upheld'").get()) throw new Error("phase2: appeal row lost in swap");
  if (!db.prepare("SELECT 1 FROM listing_suspensions WHERE id=300 AND case_id=16").get()) throw new Error("phase2: suspension row lost in swap");

  // post-upgrade behavior:
  // (1) the previously-STUCK decision now works: dismiss case 14 to the SAME
  //     resolved status case 13 already has.
  db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=14 AND status='new'");
  // (2) while case 10 is still active, a duplicate active report is blocked
  let dup2 = false;
  try { db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(17,'sales_listings','L1','r1','spam','triaged')"); }
  catch (e) { dup2 = /UNIQUE constraint/.test(String(e.message)); }
  if (!dup2) throw new Error("phase2: post-upgrade duplicate active not blocked");
  // (3) close the keeper, then a NEW incident CAN be filed, and its dismissal
  //     to the same resolved status as earlier cases is legal.
  db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=10 AND status='triaged'");
  db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(15,'sales_listings','L1','r1','misrepresentation','new')");
  db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=15 AND status='new'");
  const dismissedCount = db.prepare("SELECT COUNT(*) c FROM moderation_cases WHERE status='resolved_dismissed' AND target_id='L1'").get();
  if (dismissedCount.c !== 2) throw new Error("phase2: same-resolved-status multiplicity still blocked: " + JSON.stringify(dismissedCount));
  const idxDef = db.prepare("SELECT sql FROM sqlite_master WHERE name='uq_moderation_cases_active'").get();
  if (!/WHERE status IN \('new','triaged','action_pending'\)/.test(String(idxDef.sql))) throw new Error("phase2: partial index predicate wrong");
  console.log("phase2 OK: reachable old states seeded; merge kept 10 active, merged 11; 14 unblocked; multiplicity legal; children preserved");
  db.close();
}

console.log("N14 MIGRATION SMOKE: ALL PHASES PASS");
