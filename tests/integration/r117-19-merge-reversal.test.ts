import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { adminMergeHorses, adminMergePreview, adminUnmergeHorses } from "../../src/api/modules/imports";
import { HORSE_REFERENCE_INVENTORY_VERSION } from "../../src/registry/horseReferenceInventory";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R117-19 acceptance (Master AI R117 handoff D31 / NEXT_BACKEND.md D31-B):
 * reversible duplicate resolution — the versioned merge/unmerge commands over
 * the complete horse-reference inventory, through the REAL handlers on the
 * fully migrated database.
 *
 * Required semantics (the documented barrier matrix):
 *  - the dry run enumerates EVERY affected reference with its disposition and
 *    the permissions that govern the command (nothing written);
 *  - the merge commits only against the operator-approved manifest digest —
 *    a new reference after the preview or a changed FK before the commit
 *    refuses (merge_state_changed);
 *  - the unmerge verifies every manifest entry's CURRENT value first: a later
 *    legitimate reassignment or an identifier reallocation refuses the WHOLE
 *    reversal with an exact report (never a blind manifest replay — the
 *    barrier is REPRODUCED before the guard is asserted);
 *  - two concurrent merges sharing a horse: exactly one succeeds;
 *  - two unmerge attempts: the second refuses; an exact same-key retry
 *    replays the stored receipt with no second audit;
 *  - a demoted operator writes nothing (authority rechecked in-transaction);
 *  - the approved import-row identity is never rewritten by merge/unmerge;
 *  - out-of-order reversal of chained merges is refused; in-order reversal
 *    restores every layer exactly.
 */

const KEPT = 10;
const MERGED = 20;
const THIRD = 30;
const OTHER_KEPT = 11;

describe("R117-19 — reversible duplicate resolution (D31-B barrier matrix)", () => {
  let db: D1Database;
  let operator: AuthedSession;
  const env = (database = db) => ({ DB: database, SESSION_COOKIE_NAME: "hr_session" });

  const preview = (keptId: number, mergedId: number, session: AuthedSession = operator) =>
    adminMergePreview(authedRequest(`/api/admin/horses/${keptId}/merge-preview?merge_horse_id=${mergedId}`, undefined, { method: "GET", session }), env(), keptId);
  const merge = (keptId: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminMergeHorses(authedRequest(`/api/admin/horses/${keptId}/merge`, body, { session }), env(), keptId);
  const unmerge = (mergeId: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminUnmergeHorses(authedRequest(`/api/admin/horse-merges/${mergeId}/unmerge`, body, { session }), env(), mergeId);

  const number = async (sql: string, ...args: unknown[]) => Number(await db.prepare(sql).bind(...args).first("n"));
  const value = async <T>(sql: string, ...args: unknown[]) => await db.prepare(sql).bind(...args).first() as T | null;
  const mergeIds = async () => (await db.prepare("SELECT id FROM horse_merges ORDER BY id").all()).results as Array<{ id: number }>;

  /** Preview + merge through the real flow; returns the merge row id. */
  async function mergeThroughPreview(keptId: number, mergedId: number, operationId: string, reason: string): Promise<{ digest: string; mergeId: number }> {
    const previewResponse = await preview(keptId, mergedId);
    expect(previewResponse.status).toBe(200);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const response = await merge(keptId, { merge_horse_id: mergedId, reason, operation_id: operationId, expected_manifest_digest: digest });
    expect(response.status).toBe(201);
    const row = await value<{ id: number }>("SELECT id FROM horse_merges WHERE operation_id=?", operationId);
    return { digest, mergeId: Number(row!.id) };
  }

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r117-19-operator", "editor");
    operator = await makeSession(db, "r117-19-operator");

    // Horses: kept (10), merged duplicate (20), a legitimate third horse (30),
    // a second candidate kept horse (11) for the concurrency barrier, and a
    // child whose structural father link points at the merged horse.
    // (The operator user is seeded above before any FK needs it.)
    await db.exec(`
      INSERT INTO horses(id,register_no,name_latin,birth_year) VALUES
        (${KEPT},'R117-K','Kept Horse',2015),
        (${OTHER_KEPT},'R117-K2','Second Kept Horse',2016),
        (${MERGED},'R117-M','Duplicate Horse',2015),
        (${THIRD},'R117-T','Third Horse',2014),
        (21,'R117-C','Child Horse',2019);
      UPDATE horses SET father_id=${MERGED} WHERE id=21;
      INSERT INTO people(id,name_latin) VALUES(1,'Fixture Person');
      INSERT INTO competitions(id,name_native,discipline,event_date,venue,season) VALUES(1,'Fixture Cup','endurance','2024-03-01','Fixture Venue',2024);
      INSERT INTO issuers(id,slug,name,kind) VALUES('iss-r117','iss-r117','R117 Fixture Issuer','federation');
      INSERT INTO breeding_records(id,sire_id,dam_id) VALUES(500,${MERGED},${THIRD});
      INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES(${MERGED},1,'owner',1);
      INSERT INTO genetic_tests(horse_id,test_type,result) VALUES(${MERGED},'CA','clear');
      INSERT INTO competition_results(id,competition_id,horse_id) VALUES(600,1,${MERGED});
      INSERT INTO horse_media(id,horse_id,media_type,file_name,mime_type,size_bytes) VALUES('m-r117',${MERGED},'photo','dup.jpg','image/jpeg',1024);
      INSERT INTO sales_listings(id,horse_id,seller_contact_name,status) VALUES(700,${MERGED},'Fixture Seller','active');
      INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis) VALUES(800,${MERGED},'r117-19-operator','owner','read','claim_approval');
      INSERT INTO horse_ownership_periods(id,horse_id,owner_person_id,start_value,start_precision,start_calendar) VALUES(810,${MERGED},1,2020,'year','gregorian');
      INSERT INTO horse_lifecycle_events(id,horse_id,event_type,date_value,date_precision,date_calendar) VALUES(820,${MERGED},'retirement','2015-04-01','day','gregorian');
      INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,attested_by_user_id) VALUES('att-r117','iss-r117',${MERGED},'horse_identity','20','r117-19-operator');
      -- the merged horse's LIVE typed identifiers (archived on merge)
      INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id)
        VALUES('register_no','registry:r117','R117-M','R117-M',${MERGED},'live',NULL),
               ('microchip_no','microchip','9001170019','9001170019',${MERGED},'live',NULL);
      -- the KEPT horse keeps its own live identifier (never touched)
      INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id)
        VALUES('register_no','registry:r117','R117-K','R117-K',${KEPT},'live',NULL);
      -- a reference that STAYS with the merged subject (never moved)
      INSERT INTO data_quality_issues(horse_id,issue_code,severity,message) VALUES(${MERGED},'missing_parent','warning','Sire unverified');
      -- a companion-operation reference (workspace content stays put)
      INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Fixture Collection','r117-19-operator');
      INSERT INTO workspace_tasks(id,collection_id,horse_id,title,category,due_date,created_by_user_id,occurrence_key)
        VALUES(900,1,${MERGED},'Check duplicate dossier','other','2026-11-01','r117-19-operator','r117-task-1');
      -- the APPROVED import-row identity (immutable through merge/unmerge)
      INSERT INTO import_sources(id,name,issuer_namespace,scope_note,is_synthetic) VALUES(1,'R117 fixture source','registry:r117','Test fixture only',0);
      INSERT INTO import_batches(id,source_id,file_name,file_sha256,mapping_version,status,rows_total,created_by_user_id)
        VALUES(1,1,'r117.json','digest-fixture','v1','staged',1,'r117-19-operator');
      INSERT INTO import_staging_rows(id,batch_id,external_id,raw_json,normalized_json,row_checksum,row_action,outcome,horse_id)
        VALUES(1,1,'m','{}','{}','checksum','update','pending',${MERGED});
    `);
  });

  it("the dry run enumerates every affected reference, disposition and permission — and writes nothing", async () => {
    const response = await preview(KEPT, MERGED);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.dry_run).toBe(true);
    expect(body.command_permission).toBe("horse.edit");
    expect(body.operator).toMatchObject({ user_id: "r117-19-operator", role: "editor", capability: "horse.edit", authorized: true });
    expect((body.kept as Record<string, unknown>).id).toBe(KEPT);
    expect((body.merged as Record<string, unknown>).id).toBe(MERGED);
    expect(body.blockers).toEqual([]);
    expect(body.inventory_version).toBe(HORSE_REFERENCE_INVENTORY_VERSION);

    const policy = body.policy as Array<Record<string, unknown>>;
    const byKey = (table: string, column: string) => policy.find((row) => row.table === table && row.column === column);
    // Every disposition class is represented with its live count.
    expect(byKey("horses", "father_id")).toMatchObject({ disposition: "moves", references_on_merged_horse: 1, manifest_count: 1 });
    expect(byKey("horses", "father_id")!.manifest_row_ids).toEqual([21]);
    expect(byKey("breeding_records", "sire_id")).toMatchObject({ disposition: "moves", manifest_count: 1 });
    expect(byKey("horse_identifiers", "horse_id")).toMatchObject({ disposition: "archives", manifest_count: 2 });
    expect(byKey("data_quality_issues", "horse_id")).toMatchObject({ disposition: "stays_with_merged_subject", references_on_merged_horse: 1 });
    expect(byKey("workspace_tasks", "horse_id")).toMatchObject({ disposition: "requires_companion_operation", references_on_merged_horse: 1 });
    expect(byKey("import_staging_rows", "horse_id")).toMatchObject({ disposition: "immutable_history", references_on_merged_horse: 1 });
    expect(byKey("horse_search_source", "horse_id")).toMatchObject({ disposition: "derived_data" });
    // The full inventory is enumerated (41 classified references).
    expect(policy.length).toBeGreaterThanOrEqual(41);
    for (const row of policy) expect(typeof row.note).toBe("string");

    const summary = body.manifest_summary as Record<string, unknown>;
    expect(summary.moves).toBe(11); // child + breeding + people + genetics + competition + media + listing + grant + ownership + lifecycle + attestation
    expect(summary.archives).toBe(2);
    expect((body.bounds as Record<string, unknown>).within_bounds).toBe(true);
    expect(body.manifest_digest).toMatch(/^[0-9a-f]{64}$/);
    // Companion items are surfaced as warnings, never moved silently.
    const warnings = JSON.stringify(body.warnings);
    expect(warnings).toContain("companion_operations_required");
    expect(warnings).toContain("workspace_tasks");

    // Read-only: nothing moved, no merge machinery written.
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NOT NULL")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horse_identifiers WHERE horse_id=? AND status='live'", MERGED)).toBe(2);

    // A preview of an already-merged horse reports the blocker honestly (200, no throw).
    const first = await mergeThroughPreview(KEPT, MERGED, "r117-19-preview-blocker-merge", "First merge so the second preview can show its blocker.");
    expect(first.mergeId).toBeGreaterThan(0);
    const blocked = await preview(OTHER_KEPT, MERGED);
    expect(blocked.status).toBe(200);
    const blockedBody = await blocked.json() as Record<string, unknown>;
    expect(JSON.stringify(blockedBody.blockers)).toContain("already_merged");
  });

  it("counts only horse-namespaced policy history and preserves it through merge and unmerge", async () => {
    for (const subjectType of ["horse_update", "submission_review", "import"]) {
      await db.prepare(`INSERT INTO registry_rule_outcomes(rule_id,rule_version,subject_type,subject_ref,outcome,detail_json)
        VALUES('historical-rule',1,?,?,'fail','{}')`).bind(subjectType, String(MERGED)).run();
      await db.prepare(`INSERT INTO registry_policy_receipts(operation_id,policy_revision,subject_type,subject_ref,decision,evaluated_rules_json,context_json)
        VALUES(?,1,?,?,'accepted','[]','{}')`).bind(`history-${subjectType}`, subjectType, String(MERGED)).run();
    }
    const body = await (await preview(KEPT, MERGED)).json() as { policy: Array<Record<string, unknown>> };
    for (const table of ["registry_rule_outcomes", "registry_policy_receipts"]) {
      expect(body.policy.find(row => row.table === table && row.column === "subject_ref"))
        .toMatchObject({ disposition: "immutable_history", references_on_merged_horse: 1 });
    }
    const { mergeId } = await mergeThroughPreview(KEPT, MERGED, "r148-history-merge", "Reviewed duplicate, preserve original decisions.");
    for (const table of ["registry_rule_outcomes", "registry_policy_receipts"]) {
      expect(await number(`SELECT COUNT(*) AS n FROM ${table} WHERE subject_ref=?`, String(MERGED))).toBe(3);
      expect(await number(`SELECT COUNT(*) AS n FROM ${table} WHERE subject_ref=?`, String(KEPT))).toBe(0);
    }
    expect((await unmerge(mergeId, { reason: "Restore original records without rewriting decisions.", operation_id: "r148-history-unmerge" })).status).toBe(200);
    for (const table of ["registry_rule_outcomes", "registry_policy_receipts"]) {
      expect(await number(`SELECT COUNT(*) AS n FROM ${table} WHERE subject_ref=?`, String(MERGED))).toBe(3);
    }
  });

  it("the versioned merge moves every manifest reference, archives identifiers, and writes exactly one receipt and audit; an exact retry replays", async () => {
    const previewResponse = await preview(KEPT, MERGED);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const response = await merge(KEPT, {
      merge_horse_id: MERGED, reason: "Same horse registered twice under two namespaces.",
      operation_id: "r117-19-merge-0001", expected_manifest_digest: digest,
    });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ merged: true, replayed: false, kept_horse_id: KEPT, merged_horse_id: MERGED, moved_references: 13, manifest_digest: digest, policy_version: HORSE_REFERENCE_INVENTORY_VERSION });

    // Every move-table row now references the kept horse; the child too.
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE father_id=?", KEPT)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", KEPT)).toBe(1);
    for (const [table] of [["horse_people"], ["genetic_tests"], ["competition_results"], ["horse_media"], ["sales_listings"], ["horse_access_grants"], ["horse_ownership_periods"], ["horse_lifecycle_events"], ["attestations"]] as const) {
      expect(await number(`SELECT COUNT(*) AS n FROM ${table} WHERE horse_id=?`, KEPT)).toBe(1);
    }
    // Identifiers archived on their original horse; the kept horse's own stay live.
    expect(await number("SELECT COUNT(*) AS n FROM horse_identifiers WHERE horse_id=? AND status='archived'", MERGED)).toBe(2);
    expect(await number("SELECT COUNT(*) AS n FROM horse_identifiers WHERE horse_id=? AND status='live'", KEPT)).toBe(1);
    // Soft delete + alias + merge record with provenance columns.
    expect(await value<{ deleted_at: string | null }>("SELECT deleted_at FROM horses WHERE id=?", MERGED)!.then((row) => row!.deleted_at)).toBeTruthy();
    expect(await value<{ deleted_at: string | null }>("SELECT deleted_at FROM horses WHERE id=?", KEPT)!.then((row) => row!.deleted_at)).toBeNull();
    expect(await value<{ kept_horse_id: number }>("SELECT kept_horse_id FROM horse_redirect_aliases WHERE alias_horse_id=?", MERGED)).toEqual({ kept_horse_id: KEPT });
    const mergeRow = await value<{ moved_manifest: string; manifest_digest: string; policy_version: string; operation_id: string }>("SELECT * FROM horse_merges WHERE operation_id='r117-19-merge-0001'");
    expect(mergeRow).toMatchObject({ manifest_digest: digest, policy_version: HORSE_REFERENCE_INVENTORY_VERSION, operation_id: "r117-19-merge-0001" });
    expect((JSON.parse(mergeRow!.moved_manifest) as unknown[]).length).toBe(13);
    // Exactly ONE audit and ONE receipt; the reindex fan-out covers kept, merged and the child.
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.merged'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts WHERE command='merge'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM horse_search_reindex_queue WHERE horse_id IN (?,?,?) AND reason LIKE 'merge%'", KEPT, MERGED, 21)).toBe(3);
    // Stays/companion/immutable references are untouched.
    expect(await number("SELECT COUNT(*) AS n FROM data_quality_issues WHERE horse_id=?", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM workspace_tasks WHERE horse_id=?", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM import_staging_rows WHERE horse_id=?", MERGED)).toBe(1);

    // Exact same-key retry replays the stored receipt — no second anything.
    const retry = await merge(KEPT, {
      merge_horse_id: MERGED, reason: "Same horse registered twice under two namespaces.",
      operation_id: "r117-19-merge-0001", expected_manifest_digest: digest,
    });
    expect(retry.status).toBe(200);
    expect(await (retry.json() as Promise<Record<string, unknown>>)).toMatchObject({ merged: true, replayed: true });
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.merged'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts")).toBe(1);
    // A reused key with different content refuses.
    await expect(merge(KEPT, {
      merge_horse_id: MERGED, reason: "A different reason under the same key must refuse.",
      operation_id: "r117-19-merge-0001", expected_manifest_digest: digest,
    })).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    // The versioned command refuses a body without the digest/operation key.
    await expect(merge(KEPT, { merge_horse_id: MERGED, reason: "Legacy unversioned body must refuse." })).rejects.toMatchObject({ status: 400, code: "invalid_merge" });
  });

  it("BARRIER: a reference inserted after the preview changes the digest and the merge refuses until re-approved", async () => {
    const first = await (await preview(KEPT, MERGED)).json() as { manifest_digest: string };
    // A new breeding record referencing the merged horse appears AFTER the preview.
    await db.exec(`INSERT INTO breeding_records(id,sire_id,dam_id) VALUES(501,${MERGED},${THIRD})`);
    await expect(merge(KEPT, { merge_horse_id: MERGED, reason: "Approving a stale preview must refuse.", operation_id: "r117-19-merge-stale-1", expected_manifest_digest: first.manifest_digest }))
      .rejects.toMatchObject({ status: 409, code: "merge_state_changed" });
    // Nothing merged: the merged horse is still live and no record exists.
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NOT NULL")).toBe(0);
    // The fresh preview reflects the new reference; its digest differs; the merge then succeeds.
    const second = await (await preview(KEPT, MERGED)).json() as { manifest_digest: string; manifest_summary: { per_pair: Array<{ table: string; count: number }> } };
    expect(second.manifest_digest).not.toBe(first.manifest_digest);
    expect(second.manifest_summary.per_pair.find((pair) => pair.table === "breeding_records")!.count).toBe(2);
    const done = await merge(KEPT, { merge_horse_id: MERGED, reason: "Fresh digest approved after the new reference.", operation_id: "r117-19-merge-stale-2", expected_manifest_digest: second.manifest_digest });
    expect(done.status).toBe(201);
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", KEPT)).toBe(2);
  });

  it("BARRIER: a FK reassigned before the commit changes the digest and the merge refuses", async () => {
    const { manifest_digest: digest } = await (await preview(KEPT, MERGED)).json() as { manifest_digest: string };
    // The child is legitimately re-sired onto the third horse before the commit.
    await db.exec(`UPDATE horses SET father_id=${THIRD} WHERE id=21`);
    await expect(merge(KEPT, { merge_horse_id: MERGED, reason: "The approved set no longer matches reality.", operation_id: "r117-19-merge-changed-1", expected_manifest_digest: digest }))
      .rejects.toMatchObject({ status: 409, code: "merge_state_changed" });
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=21 AND father_id=?", THIRD)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=? AND deleted_at IS NULL", MERGED)).toBe(1);
  });

  it("BARRIER: a FK changed between merge and unmerge refuses the WHOLE reversal with an exact report (the documented naive-replay clobber is reproduced first)", async () => {
    const { mergeId } = await mergeThroughPreview(KEPT, MERGED, "r117-19-merge-drift", "Merge before demonstrating the unmerge barrier.");
    // A later legitimate reassignment moves the competition result to the third horse.
    await db.exec(`UPDATE competition_results SET horse_id=${THIRD} WHERE id=600`);

    // REPRODUCE the documented barrier: the pre-R117-19 unmerge replayed the
    // manifest by row id WITHOUT checking the current value — exactly this
    // statement — and silently clobbered the legitimate reassignment.
    await db.exec(`UPDATE competition_results SET horse_id=${MERGED} WHERE id=600`);
    expect(await number("SELECT COUNT(*) AS n FROM competition_results WHERE id=600 AND horse_id=?", THIRD)).toBe(0); // clobbered by the naive replay
    await db.exec(`UPDATE competition_results SET horse_id=${THIRD} WHERE id=600`); // restore the legitimate write

    // The guarded unmerge refuses with the exact drifted entry.
    const driftError = await unmerge(mergeId, { reason: "Trying to reverse after a legitimate reassignment.", operation_id: "r117-19-unmerge-drift-1" })
      .then(() => null, (cause: unknown) => cause);
    expect(driftError).toMatchObject({ status: 409, code: "unmerge_state_changed" });
    expect((driftError as { details?: { drifted_entries?: unknown[] } }).details).toMatchObject({
      drifted_entries: [{ table: "competition_results", row_id: 600, column: "horse_id", expected: KEPT, actual: String(THIRD) }],
    });
    // Nothing was restored: every other moved row still points at the kept
    // horse, the merged horse stays soft-deleted, no receipt, no audit.
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", KEPT)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=? AND deleted_at IS NOT NULL", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts WHERE command='unmerge'")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.unmerged'")).toBe(0);

    // Once the drifted reference is resolved back to the merge-written value,
    // the reversal succeeds and restores it to the ORIGINAL horse.
    await db.exec(`UPDATE competition_results SET horse_id=${KEPT} WHERE id=600`);
    const response = await unmerge(mergeId, { reason: "Drift resolved; the reversal can proceed.", operation_id: "r117-19-unmerge-drift-2" });
    expect(response.status).toBe(200);
    expect(await number("SELECT COUNT(*) AS n FROM competition_results WHERE id=600 AND horse_id=?", MERGED)).toBe(1);
  });

  it("BARRIER: an identifier reallocated after the merge refuses the reversal (identifier_reallocated)", async () => {
    const { mergeId } = await mergeThroughPreview(KEPT, MERGED, "r117-19-merge-realloc", "Merge before the identifier reallocation barrier.");
    const identifierRow = await value<{ id: number }>("SELECT id FROM horse_identifiers WHERE horse_id=? AND kind='register_no'", MERGED);
    // The archived register is re-activated on the THIRD horse through the
    // identifier adjudication path (a reallocation, not an undo).
    await db.exec(`UPDATE horse_identifiers SET status='live', horse_id=${THIRD} WHERE id=${Number(identifierRow!.id)}`);
    await expect(unmerge(mergeId, { reason: "Reversal must not steal a reallocated identifier.", operation_id: "r117-19-unmerge-realloc" }))
      .rejects.toMatchObject({ status: 409, code: "identifier_reallocated" });
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts WHERE command='unmerge'")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=? AND deleted_at IS NOT NULL", MERGED)).toBe(1);
    // Restoring the archived state lets the reversal proceed; the identifier
    // returns live to its ORIGINAL horse.
    await db.exec(`UPDATE horse_identifiers SET status='archived', horse_id=${MERGED} WHERE id=${Number(identifierRow!.id)}`);
    const response = await unmerge(mergeId, { reason: "Adjudication rolled back; reversal proceeds.", operation_id: "r117-19-unmerge-realloc-2" });
    expect(response.status).toBe(200);
    expect(await number("SELECT COUNT(*) AS n FROM horse_identifiers WHERE id=? AND horse_id=? AND status='live'", Number(identifierRow!.id), MERGED)).toBe(1);
  });

  it("the guarded unmerge restores EVERY manifest entry exactly; a second attempt refuses and an exact retry replays", async () => {
    const { mergeId } = await mergeThroughPreview(KEPT, MERGED, "r117-19-merge-happy", "Merge before the exact restore.");
    const response = await unmerge(mergeId, { reason: "The duplicate resolution was wrong; restore the original.", operation_id: "r117-19-unmerge-0001" });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ unmerged: true, replayed: false, merge_id: mergeId, kept_horse_id: KEPT, merged_horse_id: MERGED, restored_references: 13 });

    // Every moved row is back at the merged horse — including the child.
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=21 AND father_id=?", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", MERGED)).toBe(1);
    for (const [table] of [["horse_people"], ["genetic_tests"], ["competition_results"], ["horse_media"], ["sales_listings"], ["horse_access_grants"], ["horse_ownership_periods"], ["horse_lifecycle_events"], ["attestations"]] as const) {
      expect(await number(`SELECT COUNT(*) AS n FROM ${table} WHERE horse_id=?`, MERGED)).toBe(1);
    }
    // Identifiers live again on their original horse; the kept horse's own untouched.
    expect(await number("SELECT COUNT(*) AS n FROM horse_identifiers WHERE horse_id=? AND status='live'", MERGED)).toBe(2);
    expect(await number("SELECT COUNT(*) AS n FROM horse_identifiers WHERE horse_id=? AND status='live'", KEPT)).toBe(1);
    // The merged horse is live again, the alias is gone, the register is stamped.
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=? AND deleted_at IS NULL", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM horse_redirect_aliases")).toBe(0);
    expect(await value<{ unmerged_at: string | null; unmerge_operation_id: string }>("SELECT unmerged_at,unmerge_operation_id FROM horse_merges WHERE id=?", mergeId))
      .toMatchObject({ unmerge_operation_id: "r117-19-unmerge-0001" });
    // The merge AUDIT history is preserved (append-only); exactly one unmerge audit + receipt.
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.merged'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.unmerged'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts WHERE command='unmerge'")).toBe(1);
    // The approved import-row identity survived BOTH directions untouched.
    expect(await number("SELECT COUNT(*) AS n FROM import_staging_rows WHERE horse_id=?", MERGED)).toBe(1);

    // A second unmerge attempt (new key) refuses.
    await expect(unmerge(mergeId, { reason: "A second reversal of the same merge.", operation_id: "r117-19-unmerge-0002" }))
      .rejects.toMatchObject({ status: 409, code: "already_unmerged" });
    // The exact same-key retry replays the stored receipt.
    const retry = await unmerge(mergeId, { reason: "The duplicate resolution was wrong; restore the original.", operation_id: "r117-19-unmerge-0001" });
    expect(retry.status).toBe(200);
    expect(await (retry.json() as Promise<Record<string, unknown>>)).toMatchObject({ unmerged: true, replayed: true });
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.unmerged'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts WHERE command='unmerge'")).toBe(1);
  });

  it("BARRIER: a demoted operator writes nothing (authority rechecked inside the guarded transaction)", async () => {
    const { manifest_digest: digest } = await (await preview(KEPT, MERGED)).json() as { manifest_digest: string };
    let first = true;
    const demoted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") return async (statements: D1PreparedStatement[]) => {
          if (first) { await db.exec("UPDATE users SET role='user' WHERE id='r117-19-operator'"); first = false; }
          return db.batch(statements);
        };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    await expect(adminMergeHorses(authedRequest(`/api/admin/horses/${KEPT}/merge`, {
      merge_horse_id: MERGED, reason: "The operator was demoted between preflight and commit.",
      operation_id: "r117-19-merge-demoted", expected_manifest_digest: digest,
    }, { session: operator }), { DB: demoted, SESSION_COOKIE_NAME: "hr_session" }, KEPT))
      .rejects.toMatchObject({ status: 403, code: "forbidden" });
    // Nothing was written: no merge record, no receipt, no audit, horses untouched.
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.merged'")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NOT NULL")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", KEPT)).toBe(0);
  });

  it("BARRIER: two concurrent merges sharing a horse — exactly one succeeds with exactly one audit", async () => {
    const digest1 = ((await (await preview(KEPT, MERGED)).json()) as { manifest_digest: string }).manifest_digest;
    const digest2 = ((await (await preview(OTHER_KEPT, MERGED)).json()) as { manifest_digest: string }).manifest_digest;
    const outcomes = await Promise.allSettled([
      merge(KEPT, { merge_horse_id: MERGED, reason: "First keeper wins the shared horse.", operation_id: "r117-19-race-1", expected_manifest_digest: digest1 }),
      merge(OTHER_KEPT, { merge_horse_id: MERGED, reason: "Second keeper loses the shared horse.", operation_id: "r117-19-race-2", expected_manifest_digest: digest2 }),
    ]);
    const settled = outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value.status : `rejected:${(outcome.reason as { code?: string }).code ?? (outcome.reason as Error).message}`);
    const winners = settled.filter((code) => code === 201);
    expect(winners).toHaveLength(1);
    // The loser refuses honestly — never a partial merge.
    const loser = settled.find((code) => code !== 201) as string;
    expect(["rejected:already_merged", "rejected:merge_state_changed", "rejected:not_found", "rejected:merge_unconfirmed"]).toContain(loser);
    // Exactly one merge record, one audit, one receipt — and every moved reference points at ONE kept horse.
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.merged'")).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM merge_command_receipts")).toBe(1);
    const winnerKept = await value<{ kept_horse_id: number }>("SELECT kept_horse_id FROM horse_merges");
    const otherKept = Number(winnerKept!.kept_horse_id) === KEPT ? OTHER_KEPT : KEPT;
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", Number(winnerKept!.kept_horse_id))).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", otherKept)).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NOT NULL")).toBe(1);
  });

  it("BOUND: a merge above the per-pair bound refuses honestly (merge_too_large) and offers no digest", async () => {
    // 501 breeding records as sire — one above the bounded reversal limit.
    await db.exec(`
      INSERT INTO breeding_records(id,sire_id,dam_id)
      WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM seq WHERE value < 501)
      SELECT 1000 + value, ${MERGED}, ${THIRD} FROM seq
    `);
    const response = await preview(KEPT, MERGED);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.manifest_digest).toBeNull();
    expect((body.bounds as Record<string, unknown>)).toMatchObject({ within_bounds: false });
    const pair = (body.manifest_summary as { per_pair: Array<{ table: string; over_bound: boolean }> }).per_pair.find((entry) => entry.table === "breeding_records");
    expect(pair!.over_bound).toBe(true);
    // The command refuses with the honest bound — the fixture digest is never usable.
    await expect(merge(KEPT, { merge_horse_id: MERGED, reason: "An unbounded merge cannot be reversed safely.", operation_id: "r117-19-merge-bound", expected_manifest_digest: "0".repeat(64) }))
      .rejects.toMatchObject({ status: 409, code: "merge_too_large" });
    expect(await number("SELECT COUNT(*) AS n FROM horse_merges")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE deleted_at IS NOT NULL")).toBe(0);
  });

  it("CHAINED: out-of-order reversal is refused; in-order reversal restores every layer exactly", async () => {
    // Layer 1: MERGED (20) into KEPT (10). Layer 2: KEPT (10) into THIRD (30).
    const layer1 = await mergeThroughPreview(KEPT, MERGED, "r117-19-chain-1", "First the duplicate merges into the kept horse.");
    const layer2 = await mergeThroughPreview(THIRD, KEPT, "r117-19-chain-2", "Then the kept horse itself merges into the third horse.");
    // After layer 2, layer 1's manifest entries were carried to THIRD — an
    // out-of-order unmerge of layer 1 must refuse (entries no longer hold the
    // value layer 1 wrote; the kept horse is itself merged away).
    await expect(unmerge(layer1.mergeId, { reason: "Out-of-order reversal must refuse.", operation_id: "r117-19-chain-unmerge-1" }))
      .rejects.toMatchObject({ status: 409, code: "unmerge_state_changed" });
    // In-order: unmerge layer 2 first — KEPT is restored (with layer 1's rows back on it).
    const undo2 = await unmerge(layer2.mergeId, { reason: "Undo the newest layer first.", operation_id: "r117-19-chain-unmerge-2" });
    expect(undo2.status).toBe(200);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=? AND deleted_at IS NULL", KEPT)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM breeding_records WHERE sire_id=?", KEPT)).toBe(1);
    // Now layer 1 can reverse: everything returns to the original duplicate horse.
    const undo1 = await unmerge(layer1.mergeId, { reason: "Then undo the older layer.", operation_id: "r117-19-chain-unmerge-3" });
    expect(undo1.status).toBe(200);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=? AND deleted_at IS NULL", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM horses WHERE id=21 AND father_id=?", MERGED)).toBe(1);
    expect(await number("SELECT COUNT(*) AS n FROM horse_redirect_aliases")).toBe(0);
    expect(await number("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.unmerged'")).toBe(2);
  });
});
