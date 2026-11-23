import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  adminApplyImportBatch,
  adminImportBatchPreview,
  adminImportReviewReport,
  adminReviewImportRow,
  adminStageImportBatch,
} from "../../src/api/modules/imports";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R114-03 acceptance (Master AI R113 handoff, NEXT_BACKEND.md D31-A): the
 * staged-import operator surface — bounded preview, blob-free review report
 * and the versioned row-review command — through the REAL handlers.
 *
 * Required semantics:
 *  - preview is read-only and shows raw/normalized side by side with the
 *    classification and review history
 *  - skip moves a row out of the apply pool with one receipt + one audit
 *  - reclassify re-runs classification against CURRENT state; an unchanged
 *    result refuses honestly
 *  - target_override requires typed-identifier proof (register in the source
 *    namespace or microchip) — a name is never evidence; no auto-merge
 *  - exact same-key retry replays; reused key with different content refuses
 *  - a demoted reviewer writes nothing (authority rechecked in-transaction)
 *  - apply then honors the reviewed state (skipped rows stay skipped,
 *    re-adjudicated rows apply)
 */

describe("R114-03 — staged-import operator review surface (D31-A)", () => {
  let db: D1Database;
  let editor: AuthedSession;
  let editorB: AuthedSession;
  const env = (database = db) => ({ DB: database, SESSION_COOKIE_NAME: "hr_session" });

  const stageBody = (suffix = "a", rows?: unknown[]) => ({
    source_id: 1, file_name: `review-${suffix}.json`, mapping_version: "v1",
    rows: rows ?? [{ external_id: suffix, register_no: `R114-${suffix}`, name_latin: `Review ${suffix}` }],
  });
  const stage = async (payload = stageBody(), database = db, session = editor) => {
    const response = await adminStageImportBatch(authedRequest("/api/admin/imports/stage", payload, { session }), env(database));
    return await response.json() as { batch: { id: number } };
  };
  const apply = (batchId: number, database = db, session = editor) =>
    adminApplyImportBatch(authedRequest(`/api/admin/imports/batches/${batchId}/apply`, {}, { session }), env(database), batchId);
  const preview = (batchId: number) => adminImportBatchPreview(authedRequest(`/api/admin/imports/batches/${batchId}/preview`, undefined, { method: "GET", session: editor }), env(), batchId);
  const report = (batchId: number) => adminImportReviewReport(authedRequest(`/api/admin/imports/batches/${batchId}/review-report`, undefined, { method: "GET", session: editor }), env(), batchId);
  const review = (batchId: number, rowId: number, body: Record<string, unknown>, session: AuthedSession = editor) =>
    adminReviewImportRow(authedRequest(`/api/admin/imports/batches/${batchId}/rows/${rowId}/review`, body, { session }), env(), batchId, rowId);
  const number = async (sql: string) => Number(await db.prepare(sql).first("n"));
  const row = async (batchId: number) => db.prepare("SELECT id,row_action,outcome,horse_id,outcome_detail FROM import_staging_rows WHERE batch_id=? ORDER BY id LIMIT 1").bind(batchId).first<{ id: number; row_action: string; outcome: string; horse_id: number | null; outcome_detail: string | null }>();

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r114-reviewer-a", "editor");
    await seedUser(db, "r114-reviewer-b", "editor");
    editor = await makeSession(db, "r114-reviewer-a");
    editorB = await makeSession(db, "r114-reviewer-b");
    await db.prepare("INSERT INTO import_sources(id,name,issuer_namespace,scope_note,is_synthetic) VALUES(1,'Disposable R114 review source','registry:r114','In-memory test fixture only',0)").run();
  });

  it("preview is read-only and shows raw/normalized side by side with classification, target and window", async () => {
    const { batch } = await stage(stageBody("a"), db, editor);
    const response = await preview(batch.id);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const rows = body.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ external_id: "a", row_action: "create", outcome: "pending" });
    expect(rows[0].raw).toMatchObject({ external_id: "a", register_no: "R114-a" });
    expect(rows[0].normalized).toBeTruthy();
    expect((body.batch as Record<string, unknown>)).toMatchObject({ source_name: "Disposable R114 review source", issuer_namespace: "registry:r114", is_synthetic: false, mapping_version: "v1" });
    expect(body.rows_window).toEqual({ limit: 500, total: 1, has_more: false });
    // Preview never writes: no canonical rows, no reviews.
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(0);
    expect(await number("SELECT COUNT(*) n FROM import_row_reviews")).toBe(0);
  });

  it("the review report excludes raw blobs and carries outcome counts", async () => {
    const { batch } = await stage(stageBody("a"), db, editor);
    const response = await report(batch.id);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.outcome_counts).toMatchObject({ pending: 1, applied_create: 0, conflict: 0, skipped: 0 });
    const rows = body.rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ external_id: "a", row_action: "create", outcome: "pending" });
    expect("raw" in rows[0]).toBe(false);
    expect("raw_json" in rows[0]).toBe(false);
    expect("normalized" in rows[0]).toBe(false);
  });

  it("skip removes a pending row from the apply pool with one receipt and one audit; apply then completes without it", async () => {
    const { batch } = await stage(stageBody("a"), db, editor);
    const staged = await row(batch.id);
    const response = await review(batch.id, Number(staged!.id), { decision: "skip", reason: "The source row duplicates a horse the registry already recorded.", operation_id: "r114-rev-0001" });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ reviewed: true, replayed: false });
    expect((body.row as Record<string, unknown>)).toMatchObject({ row_action: "create", outcome: "skipped" });
    expect(await number("SELECT COUNT(*) n FROM import_row_reviews")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM audit_events WHERE action='import.row.reviewed'")).toBe(1);
    // Same-key exact retry replays the stored response; no second receipt.
    const retry = await review(batch.id, Number(staged!.id), { decision: "skip", reason: "The source row duplicates a horse the registry already recorded.", operation_id: "r114-rev-0001" });
    expect(retry.status).toBe(200);
    expect(await (retry.json() as Promise<Record<string, unknown>>)).toMatchObject({ reviewed: true, replayed: true });
    expect(await number("SELECT COUNT(*) n FROM import_row_reviews")).toBe(1);
    // Reused key with different content refuses.
    await expect(review(batch.id, Number(staged!.id), { decision: "skip", reason: "A different reason under the same key must refuse.", operation_id: "r114-rev-0001" }))
      .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    // Apply finalizes: the skipped row never creates a horse.
    const applied = await apply(batch.id);
    expect(applied.status).toBe(200);
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(0);
    expect(await db.prepare("SELECT status,rows_skipped FROM import_batches WHERE id=?").bind(batch.id).first()).toMatchObject({ status: "completed", rows_skipped: 1 });
  });

  it("reclassify re-runs classification against CURRENT state and refuses an unchanged result", async () => {
    // Stage a row whose register matches an EXISTING horse: classification is 'update'.
    await db.exec("INSERT INTO horses(id,register_no,name_latin) VALUES(501,'R114-existing','Existing review horse')");
    await db.exec("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id) VALUES('register_no','registry:r114','R114-existing','R114-existing',501,'live',1)");
    const { batch } = await stage(stageBody("existing", [{ external_id: "existing", register_no: "R114-existing", name_latin: "Existing review horse" }]));
    let staged = await row(batch.id);
    expect(staged).toMatchObject({ row_action: "update", horse_id: 501 });
    // Nothing changed on the canonical side: reclassification reproduces 'update' => refuse.
    await expect(review(batch.id, Number(staged!.id), { decision: "reclassify", reason: "Re-check this row against the current registry state.", operation_id: "r114-rev-0002" }))
      .rejects.toMatchObject({ status: 409, code: "reclassification_unchanged" });
    expect(await number("SELECT COUNT(*) n FROM import_row_reviews")).toBe(0);
    // Now archive the live identifier (revoked outside): reclassification sees a free register => create.
    await db.exec("UPDATE horse_identifiers SET status='archived' WHERE horse_id=501");
    const reclassified = await review(batch.id, Number(staged!.id), { decision: "reclassify", reason: "The identifier was revoked after staging; the row should create a new horse.", operation_id: "r114-rev-0003" });
    expect(reclassified.status).toBe(201);
    const body = await reclassified.json() as Record<string, unknown>;
    expect((body.row as Record<string, unknown>)).toMatchObject({ row_action: "create", outcome: "pending", horse_id: null });
    expect(body.reclassified).toMatchObject({ action: "create" });
    // The prior decision state is preserved in the history.
    const history = await db.prepare("SELECT prior_row_action,prior_outcome,prior_horse_id,new_row_action FROM import_row_reviews WHERE operation_id='r114-rev-0003'").first();
    expect(history).toMatchObject({ prior_row_action: "update", prior_outcome: "pending", prior_horse_id: 501, new_row_action: "create" });
    // Apply honors the re-adjudicated row.
    await apply(batch.id);
    expect(await number("SELECT COUNT(*) n FROM horses WHERE register_no='R114-existing'")).toBe(2);
  });

  it("target_override requires typed-identifier proof — a name match is never evidence", async () => {
    // Two horses share a name; only one holds the row's register.
    await db.exec("INSERT INTO horses(id,register_no,name_latin) VALUES(601,'R114-twin-a','Twin Horse'),(602,'R114-twin-b','Twin Horse')");
    await db.exec("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id) VALUES('register_no','registry:r114','R114-twin-a','R114-twin-a',601,'live',1),('register_no','registry:r114','R114-twin-b','R114-twin-b',602,'live',1)");
    // A row whose identifiers point at BOTH horses (register matches 601, microchip matches 602) => ambiguous conflict.
    await db.exec("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id) VALUES('microchip_no','microchip','9001000011','9001000011',602,'live',1)");
    const { batch } = await stage(stageBody("ambiguous", [{ external_id: "ambiguous", register_no: "R114-twin-a", microchip_no: "9001000011", name_latin: "Twin Horse" }]));
    const staged = await row(batch.id);
    expect(staged).toMatchObject({ row_action: "conflict" });
    // A decoy horse that shares the display name but holds NEITHER of the
    // row's typed identifiers: name similarity is never targeting evidence.
    await db.exec("INSERT INTO horses(id,register_no,name_latin) VALUES(603,'R114-decoy','Twin Horse decoy')");
    await expect(review(batch.id, Number(staged!.id), { decision: "target_override", reason: "The name looks like this decoy horse.", operation_id: "r114-rev-0005", target_horse_id: 603 }))
      .rejects.toMatchObject({ status: 409, code: "target_not_proven" });
    // An identifier-holding but non-existent/other-namespace target also refuses (horse 999).
    await expect(review(batch.id, Number(staged!.id), { decision: "target_override", reason: "Targeting a horse that does not exist.", operation_id: "r114-rev-0011", target_horse_id: 999 }))
      .rejects.toMatchObject({ status: 409, code: "target_not_proven" });
    // The register-proven target is accepted; the row becomes a fill-once update.
    const overridden = await review(batch.id, Number(staged!.id), { decision: "target_override", reason: "The register number belongs to horse 601; the microchip collision is the real conflict.", operation_id: "r114-rev-0006", target_horse_id: 601 });
    expect(overridden.status).toBe(201);
    const body = await overridden.json() as Record<string, unknown>;
    expect((body.row as Record<string, unknown>)).toMatchObject({ row_action: "update", outcome: "pending", horse_id: 601 });
    expect(body.target_evidence).toMatchObject({ via: "register_no", target_horse_id: 601 });
    // Apply fills once — no new horse, no merge, 601 keeps its identity.
    await apply(batch.id);
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(3);
    expect(await number("SELECT COUNT(*) n FROM horse_merges")).toBe(0);
  });

  it("a demoted reviewer writes nothing (authority rechecked inside the guarded transition)", async () => {
    const { batch } = await stage(stageBody("a"), db, editor);
    const staged = await row(batch.id);
    let first = true;
    const demoted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") return async (statements: D1PreparedStatement[]) => {
          if (first) { await db.exec("UPDATE users SET role='user' WHERE id='r114-reviewer-a'"); first = false; }
          return db.batch(statements);
        };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    await expect(adminReviewImportRow(authedRequest(`/api/admin/imports/batches/${batch.id}/rows/${staged!.id}/review`, {
      decision: "skip", reason: "The reviewer was demoted between preflight and commit.", operation_id: "r114-rev-0007",
    }, { session: editor }), { DB: demoted, SESSION_COOKIE_NAME: "hr_session" }, batch.id, Number(staged!.id)))
      .rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(await number("SELECT COUNT(*) n FROM import_row_reviews")).toBe(0);
    expect(await number("SELECT COUNT(*) n FROM audit_events WHERE action='import.row.reviewed'")).toBe(0);
    const untouched = await row(batch.id);
    expect(untouched).toMatchObject({ outcome: "pending" });
  });

  it("a completed batch refuses reviews; a changed row refuses with its current state", async () => {
    const { batch } = await stage(stageBody("a"), db, editor);
    await apply(batch.id);
    const staged = await row(batch.id);
    await expect(review(batch.id, Number(staged!.id), { decision: "skip", reason: "Too late: the batch already completed.", operation_id: "r114-rev-0008" }))
      .rejects.toMatchObject({ status: 409, code: "batch_not_reviewable" });
    // Row-change race: two reviewers, same prior state, different decisions — one wins.
    const { batch: batch2 } = await stage(stageBody("b"), db, editor);
    const staged2 = await row(batch2.id);
    const winner = await review(batch2.id, Number(staged2!.id), { decision: "skip", reason: "First reviewer decision wins the race.", operation_id: "r114-rev-0009" }, editor);
    expect(winner.status).toBe(201);
    await expect(review(batch2.id, Number(staged2!.id), { decision: "skip", reason: "Second reviewer replays a stale view of the row.", operation_id: "r114-rev-0010" }, editorB))
      .rejects.toMatchObject({ status: 409, code: "row_not_reviewable" });
    expect(await number("SELECT COUNT(*) n FROM import_row_reviews")).toBe(1);
  });
});
