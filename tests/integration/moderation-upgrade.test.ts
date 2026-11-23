import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openLocalSqlite } from "../../src/db/localSqlite";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N14 completion evidence: the migration UPGRADE fixture.
 *
 * The chain is applied up to 0060, the database is loaded with the states
 * that were possible ONLY under the old schema (duplicate ACTIVE reports in
 * different active statuses; a case STUCK because its decision would collide
 * with an earlier case's resolved status), and then 0061 is applied. The
 * assertions pin the documented merge/link review and post-upgrade behavior.
 */

const MIGRATIONS_DIR = join(__dirname, "../../migrations");

function migrationFiles(filter: (name: string) => boolean): string[] {
  return readdirSync(MIGRATIONS_DIR).filter(f => /^\d+.*\.sql$/.test(f) && filter(f)).sort();
}

async function apply(db: D1Database, files: string[]): Promise<void> {
  for (const file of files) await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

describe("R95-N14 migration upgrade fixture (0060 -> 0061)", () => {
  it("merges duplicate ACTIVE reports deterministically (oldest wins), preserves every child row, and unblocks the stuck decision", async () => {
    const db = openLocalSqlite(":memory:");
    await apply(db, migrationFiles(name => Number(name.slice(0, 4)) <= 60));

    // Users, horses, listings (two listings so the two groups are distinct).
    await db.exec(`
      INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('r1','r1@t.test','R1','x','user',1);
      INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('adm','adm@t.test','ADM','x','admin',1);
      INSERT INTO horses(id,name_latin) VALUES (1,'H1'),(2,'H2');
      INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance)
        VALUES ('L1',1,'r1','S','active','user'),('L2',2,'r1','S','active','user');
    `);

    // OLD-schema state, group (r1, L1): case 10 filed as new, assigned to
    // triaged; case 11 filed (new tuple freed); assigning case 11 collides
    // with case 10's triaged tuple — the old UNIQUE blocked it, leaving the
    // reachable duplicate-ACTIVE pair (one triaged + one new).
    await db.exec(`
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status,created_at)
        VALUES(10,'sales_listings','L1','r1','spam','first','new','2026-10-01 08:00:00');
      UPDATE moderation_cases SET status='triaged',assigned_operator_user_id='adm' WHERE id=10 AND status='new';
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,details,status,created_at)
        VALUES(11,'sales_listings','L1','r1','spam','second','new','2026-10-01 09:00:00');
    `);
    await expect(db.exec("UPDATE moderation_cases SET status='triaged',assigned_operator_user_id='adm' WHERE id=11 AND status='new'"))
      .rejects.toThrow(/UNIQUE constraint/);

    // OLD-schema state, group (r1, L2): case 13 dismissed; case 16 hidden
    // with an upheld appeal + a suspension row (child data the swap must
    // preserve verbatim); case 14 filed for a NEW incident — and its
    // dismissal collides with case 13's resolved_dismissed tuple: the F27
    // manifestation, leaving case 14 STUCK as new.
    await db.exec(`
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at)
        VALUES(13,'sales_listings','L2','r1','spam','new','2026-09-01 08:00:00');
      UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=13 AND status='new';
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at)
        VALUES(16,'sales_listings','L2','r1','offensive_content','new','2026-09-02 08:00:00');
      UPDATE moderation_cases SET status='resolved_hidden',resolved_at=CURRENT_TIMESTAMP WHERE id=16 AND status='new';
      INSERT INTO moderation_appeals(id,case_id,appellant_user_id,statement,status,decided_by_user_id)
        VALUES(200,16,'r1','the listing content is being misread, please reconsider','upheld','adm');
      INSERT INTO listing_suspensions(id,listing_id,case_id,suspended_by_user_id,reason)
        VALUES(300,'L2',16,'adm','offensive content confirmed on review');
      INSERT INTO moderation_case_events(id,case_id,actor_user_id,event_type,event_json)
        VALUES(100,10,'r1','created','{"reason":"spam"}');
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,created_at)
        VALUES(14,'sales_listings','L2','r1','fraud_suspected','new','2026-09-05 09:00:00');
    `);
    await expect(db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=14 AND status='new'"))
      .rejects.toThrow(/UNIQUE constraint/);

    // Apply 0061.
    await apply(db, migrationFiles(name => name.startsWith("0061")));

    // The documented merge: oldest stays active exactly as it was; the
    // younger duplicate becomes resolved_merged linked to the keeper, with a
    // provenance event; closed history untouched.
    const rows = await db.prepare("SELECT id,status,merged_into_case_id FROM moderation_cases ORDER BY id").all<{ id: number; status: string; merged_into_case_id: number | null }>();
    const byId = new Map(rows.results.map(r => [Number(r.id), r]));
    expect(byId.get(10)).toMatchObject({ status: "triaged", merged_into_case_id: null });
    expect(byId.get(11)).toMatchObject({ status: "resolved_merged", merged_into_case_id: 10 });
    expect(byId.get(13)).toMatchObject({ status: "resolved_dismissed", merged_into_case_id: null });
    expect(byId.get(14)).toMatchObject({ status: "new", merged_into_case_id: null });
    expect(byId.get(16)).toMatchObject({ status: "resolved_hidden", merged_into_case_id: null });

    const mergeEvents = await db.prepare("SELECT case_id,actor_user_id,event_type FROM moderation_case_events WHERE actor_user_id='migration_0061'").all<{ case_id: number; actor_user_id: string; event_type: string }>();
    expect(mergeEvents.results).toHaveLength(1);
    expect(Number(mergeEvents.results[0]!.case_id)).toBe(11);
    expect(mergeEvents.results[0]!.event_type).toBe("note");

    // Child rows survived the swap verbatim.
    expect((await db.prepare("SELECT 1 FROM moderation_case_events WHERE id=100 AND case_id=10").first())?.["1"]).toBe(1);
    expect((await db.prepare("SELECT 1 FROM moderation_appeals WHERE id=200 AND case_id=16 AND status='upheld'").first())?.["1"]).toBe(1);
    expect((await db.prepare("SELECT 1 FROM listing_suspensions WHERE id=300 AND case_id=16").first())?.["1"]).toBe(1);

    // Post-upgrade: the STUCK decision now works (same resolved status as
    // the earlier case — the operation the old schema refused).
    await db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=14 AND status='new'");

    // Post-upgrade: while case 10 is active, a duplicate ACTIVE report for
    // (r1, L1) is refused by the partial index — any active status pair.
    await expect(db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(17,'sales_listings','L1','r1','spam','triaged')"))
      .rejects.toThrow(/UNIQUE constraint/);
    await expect(db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason) VALUES(18,'sales_listings','L1','r1','spam')"))
      .rejects.toThrow(/UNIQUE constraint/);

    // Post-upgrade: close the keeper, then a NEW incident can be filed and
    // dismissed — with the SAME resolved status as earlier closed cases.
    await db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=10 AND status='triaged'");
    await db.exec("INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status) VALUES(15,'sales_listings','L1','r1','misrepresentation','new')");
    await db.exec("UPDATE moderation_cases SET status='resolved_dismissed',resolved_at=CURRENT_TIMESTAMP WHERE id=15 AND status='new'");
    const dismissed = await db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE status='resolved_dismissed' AND target_id='L1'").first<{ n: number }>();
    expect(dismissed?.n).toBe(2);

    // The new indexes exist and the old table constraint is gone: two
    // resolved_dismissed rows for the same reporter+target coexist (above),
    // and the partial index predicate is exactly the active set.
    const idx = await db.prepare("SELECT sql FROM sqlite_master WHERE name='uq_moderation_cases_active'").first<{ sql: string }>();
    expect(idx?.sql).toMatch(/WHERE status IN \('new','triaged','action_pending'\)/);
    const tableSql = await db.prepare("SELECT sql FROM sqlite_master WHERE name='moderation_cases'").first<{ sql: string }>();
    expect(tableSql?.sql).not.toMatch(/UNIQUE\(reporter_user_id,\s*target_table,\s*target_id,\s*status\)/);

    // FKs still enforced after the swap (children reference the replacement).
    await expect(db.exec("INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json) VALUES(9999,'x','note','{}')"))
      .rejects.toThrow(/FOREIGN KEY/);
  });

  it("the fresh chain (0001..0061) applies cleanly and carries the same guarantees", async () => {
    const db = openLocalSqlite(":memory:");
    await apply(db, migrationFiles(() => true));
    // resolved_merged is a legal status; a merged case never blocks a new report.
    await db.exec(`
      INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('r1','r1@t.test','R1','x','user',1);
      INSERT INTO horses(id,name_latin) VALUES (1,'H1');
      INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) VALUES('L1',1,'r1','S','active','user');
      INSERT INTO moderation_cases(id,target_table,target_id,reporter_user_id,reason,status,merged_into_case_id)
        VALUES(1,'sales_listings','L1','r1','spam','resolved_merged',7);
      INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason) VALUES('sales_listings','L1','r1','fraud_suspected');
    `);
    const active = await db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE reporter_user_id='r1' AND target_id='L1' AND status NOT LIKE 'resolved%'").first<{ n: number }>();
    expect(active?.n).toBe(1);
    // One open appeal per case is structural.
    await db.exec("UPDATE moderation_cases SET status='resolved_hidden',resolved_at=CURRENT_TIMESTAMP WHERE status='new'");
    await db.exec("INSERT INTO moderation_appeals(case_id,appellant_user_id,statement) VALUES(2,'r1','appeal text long enough')");
    await expect(db.exec("INSERT INTO moderation_appeals(case_id,appellant_user_id,statement) VALUES(2,'r1','second appeal')"))
      .rejects.toThrow(/UNIQUE constraint/);
  });
});
