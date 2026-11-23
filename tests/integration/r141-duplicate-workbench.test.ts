import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { adminDuplicateCandidates, adminMergeHistory } from "../../src/api/modules/duplicates";
import { adminMergeHorses, adminMergePreview, adminUnmergeHorses } from "../../src/api/modules/imports";
import { HttpError } from "../../src/api/http";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R141 — duplicate-resolution workbench acceptance (Master AI
 * workflow-completeness standard): the R117-19 versioned merge commands were
 * never reachable through an interface. These read-only surfaces close the gap:
 *
 *  - the candidate miner groups live horses by exact register number, exact
 *    microchip, normalized name + birth-year proximity and same parents;
 *  - archived/merged horses never appear as candidates;
 *  - every group carries >= 2 members and a stable key;
 *  - the merge-receipt list feeds the guarded unmerge (newest first,
 *    resolved rows hidden unless include_resolved=1);
 *  - both reads gate on horse.edit; a plain authenticated user gets 403.
 */

const KEPT = 10;
const DUP = 20;

describe("R141 — duplicate-resolution workbench surfaces", () => {
  let db: D1Database;
  let operator: AuthedSession;
  let plain: AuthedSession;
  const env = (database = db) => ({ DB: database, SESSION_COOKIE_NAME: "hr_session" });

  const candidates = (query = "", session: AuthedSession = operator) =>
    adminDuplicateCandidates(authedRequest(`/api/admin/duplicates${query}`, undefined, { method: "GET", session }), env());
  const history = (query = "", session: AuthedSession = operator) =>
    adminMergeHistory(authedRequest(`/api/admin/horse-merges${query}`, undefined, { method: "GET", session }), env());
  const preview = (keptId: number, mergedId: number, session: AuthedSession = operator) =>
    adminMergePreview(authedRequest(`/api/admin/horses/${keptId}/merge-preview?merge_horse_id=${mergedId}`, undefined, { method: "GET", session }), env(), keptId);
  const merge = (keptId: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminMergeHorses(authedRequest(`/api/admin/horses/${keptId}/merge`, body, { session }), env(), keptId);
  const unmerge = (mergeId: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminUnmergeHorses(authedRequest(`/api/admin/horse-merges/${mergeId}/unmerge`, body, { session }), env(), mergeId);

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r141-operator", "editor");
    await seedUser(db, "r141-plain", "user");
    operator = await makeSession(db, "r141-operator");
    plain = await makeSession(db, "r141-plain");

    // Two horses sharing register_no AND microchip AND normalized name with a
    // birth-year gap of 1 (name_year_match), plus two offspring sharing both
    // parents (same_parents), plus one unrelated horse.
    await db.exec(`
      INSERT INTO horses(id,register_no,microchip_no,name_latin,birth_year,sex_desc) VALUES
        (${KEPT},'R141-DUP','9001410001','Duplicate Mare',2015,'mare'),
        (${DUP},'R141-DUP','9001410001','Duplicate  Mare',2016,'mare'),
        (30,NULL,NULL,'Unrelated Horse',2012,'stallion'),
        (40,NULL,NULL,'Full Sibling One',2018,NULL),
        (41,NULL,NULL,'Full Sibling Two',2019,NULL);
      UPDATE horses SET father_id=30, mother_id=${KEPT} WHERE id IN (40,41);
    `);
  });

  it("mines candidate groups by every reason and never serves archived horses", async () => {
    const response = await candidates();
    expect(response.status).toBe(200);
    const body = await response.json() as {
      groups: Array<{ reason: string; key: string; members: Array<{ id: number }> }>;
      total_groups: number;
    };
    const reasons = new Set(body.groups.map((group) => group.reason));
    expect(reasons.has("register_no_exact")).toBe(true);
    expect(reasons.has("microchip_exact")).toBe(true);
    expect(reasons.has("name_year_match")).toBe(true);
    expect(reasons.has("same_parents")).toBe(true);
    for (const group of body.groups) {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
      const ids = group.members.map((member) => member.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // The register_no group holds exactly the two duplicate rows.
    const registerGroup = body.groups.find((group) => group.reason === "register_no_exact")!;
    expect(new Set(registerGroup.members.map((member) => member.id))).toEqual(new Set([KEPT, DUP]));

    // Merge the duplicate away through the real versioned flow, then re-mine:
    // the archived horse must disappear from every candidate group.
    const previewResponse = await preview(KEPT, DUP);
    expect(previewResponse.status).toBe(200);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const mergeResponse = await merge(KEPT, { merge_horse_id: DUP, reason: "R141 test: same animal registered twice", operation_id: "r141-test-merge-1", expected_manifest_digest: digest });
    expect(mergeResponse.status).toBe(201);
    const after = await (await candidates()).json() as typeof body;
    for (const group of after.groups) {
      expect(group.members.map((member) => member.id)).not.toContain(DUP);
    }
  });

  it("filters by reason and bounds the limit", async () => {
    const response = await candidates("?reason=register_no_exact&limit=5");
    expect(response.status).toBe(200);
    const body = await response.json() as { reasons: string[]; groups: Array<{ reason: string }>; group_limit: number };
    expect(body.reasons).toEqual(["register_no_exact"]);
    expect(body.group_limit).toBe(5);
    for (const group of body.groups) expect(group.reason).toBe("register_no_exact");
    // An unknown reason filter refuses with the exact bounded-code contract.
    await expect(candidates("?reason=nonsense")).rejects.toMatchObject({ status: 400, code: "invalid_reason_filter" });
  });

  it("lists recent merge receipts newest-first and hides resolved rows unless asked", async () => {
    // Merge, then reverse through the guarded unmerge.
    const previewResponse = await preview(KEPT, DUP);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    await merge(KEPT, { merge_horse_id: DUP, reason: "R141 test: receipt list fixture", operation_id: "r141-test-merge-2", expected_manifest_digest: digest });
    const mergeRow = await db.prepare("SELECT id FROM horse_merges WHERE operation_id='r141-test-merge-2'").first<{ id: number }>();
    const mergeId = Number(mergeRow!.id);

    const openList = await (await history()).json() as { merges: Array<{ id: number; unmerged_at: string | null; merged_horse_id: number; kept_horse_id: number }> };
    expect(openList.merges[0].id).toBe(mergeId);
    expect(openList.merges[0].merged_horse_id).toBe(DUP);
    expect(openList.merges[0].kept_horse_id).toBe(KEPT);

    const unmergeResponse = await unmerge(mergeId, { reason: "R141 test: reversal restores the fixture", operation_id: "r141-test-unmerge-1" });
    expect(unmergeResponse.status).toBe(200);

    const afterReversal = await (await history()).json() as { merges: Array<{ id: number }> };
    expect(afterReversal.merges.find((row) => row.id === mergeId)).toBeUndefined();
    const withResolved = await (await history("?include_resolved=1")).json() as { merges: Array<{ id: number; unmerged_at: string | null }>; include_resolved: boolean };
    expect(withResolved.include_resolved).toBe(true);
    const resolvedRow = withResolved.merges.find((row) => row.id === mergeId);
    expect(resolvedRow?.unmerged_at).toBeTruthy();
  });

  it("refuses both reads without the horse.edit permission", async () => {
    await expect(candidates("", plain)).rejects.toMatchObject({ status: 403, code: "forbidden" } satisfies Partial<HttpError>);
    await expect(history("", plain)).rejects.toMatchObject({ status: 403, code: "forbidden" } satisfies Partial<HttpError>);
  });
});
