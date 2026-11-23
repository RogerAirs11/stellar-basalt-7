import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { adminQualityScan } from "../../src/api/modules/qualityQueue";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R146 — production corpus-scan windowing regression.
 *
 * The R145 keyset scan bounded each detector with `LIMIT 3000` only, so at
 * production scale a rare-match query (PARENT_BOTH_SIDES, BIRTH_DATE_YEAR_
 * MISMATCH) re-scanned the whole remaining 95k-row tail on EVERY pass —
 * 6.5s+ per statement, past the adapter's 8s statement deadline, and every
 * production pass 500'd. The R146 fix scans a bounded ID RANGE
 * (id > resume_after AND id <= resume_after + 3000): every pass is a PK
 * range scan, the cursor advances to the window end, and completed fires
 * when the window covers the max horse id.
 *
 * This test pins that behavior on a real database: conflicts beyond the
 * first window (id > 3000) are NOT flagged by pass 1, ARE flagged by the
 * resumed pass, the cursor advances, completed fires, and a full re-scan
 * stays idempotent (created=0).
 */

interface ScanBody {
  created: number;
  detected_candidates: number;
  open_issues: number;
  completed: boolean;
  resume_after: number | null;
  scanned_from: number;
  scanned_to: number;
}

describe("R146 — corpus scan ID-window paging", () => {
  let db: D1Database;
  let operator: AuthedSession;
  const env = () => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

  const scan = (resumeAfter = 0, session: AuthedSession = operator) =>
    adminQualityScan(
      authedRequest(`/api/admin/quality/scan?resume_after=${resumeAfter}`, {}, { session }),
      env(),
    );

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-operator", "editor");
    operator = await makeSession(db, "r146-operator");
    // Conflicts deliberately BEYOND the first 3000-id window:
    // 3100 mare recorded as father of 3101 (SEX_ROLE_SIRE_FEMALE);
    // 3102 birth_date contradicts birth_year (BIRTH_DATE_YEAR_MISMATCH).
    await db.exec(`
      INSERT INTO horses(id,register_no,name_latin,birth_year,sex_desc,birth_date) VALUES
        (3100,NULL,'Window Female Sire',2005,'mare',NULL),
        (3101,NULL,'Window Sire Child',2018,'stallion',NULL),
        (3102,NULL,'Window Date Conflict',2001,'mare','2012-07-01');
      UPDATE horses SET father_id=3100 WHERE id=3101;
    `);
  });

  it("pass 1 skips the empty id-gap in one pass: no findings beyond id 3000, cursor lands on the next existing id", async () => {
    const body = await (await scan(0)).json() as ScanBody;
    // Horses exist only at 3100-3102; ids 1..3000 are empty. The pass must
    // jump the gap: cursor = next existing id - 1, not windowEnd.
    expect(body.completed).toBe(false);
    expect(body.resume_after).toBe(3099);
    expect(body.scanned_to).toBe(3099);
    expect(body.created).toBe(0);
    expect(body.detected_candidates).toBe(0);
    expect(body.open_issues).toBe(0);
  });

  it("a pass started past the last horse completes immediately (gap probe returns none)", async () => {
    const body = await (await scan(3200)).json() as ScanBody;
    expect(body.completed).toBe(true);
    expect(body.resume_after).toBeNull();
    expect(body.created).toBe(0);
  });

  it("resumed pass covers the tail: flags the beyond-window conflicts and completes", async () => {
    await scan(0);
    const body = await (await scan(3099)).json() as ScanBody;
    expect(body.completed).toBe(true);
    expect(body.resume_after).toBeNull();
    // 1 sire-female (3100 via child 3101) + 1 date contradiction (3102).
    expect(body.detected_candidates).toBeGreaterThanOrEqual(2);
    expect(body.created).toBeGreaterThanOrEqual(2);
    const rows = (await db.prepare("SELECT DISTINCT issue_code FROM data_quality_issues WHERE horse_id IN (3100,3102)").all()).results as Array<Record<string, unknown>>;
    const codes = rows.map((r) => String(r.issue_code)).sort();
    expect(codes).toEqual(["BIRTH_DATE_YEAR_MISMATCH", "SEX_ROLE_SIRE_FEMALE"]);
  });

  it("a full re-scan across all windows stays idempotent (created=0)", async () => {
    await scan(0);
    await scan(3099);
    const pass1 = await (await scan(0)).json() as ScanBody;
    const pass2 = await (await scan(3099)).json() as ScanBody;
    expect(pass1.created).toBe(0);
    expect(pass2.created).toBe(0);
  });
});
