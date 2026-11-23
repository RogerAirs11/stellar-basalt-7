import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { adminMergeHorses, adminMergePreview, adminUnmergeHorses } from "../../src/api/modules/imports";
import { openLocalSqlite } from "../../src/db/localSqlite";
import { authedRequest, makeSession, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R122 / R122-T01 acceptance — the merge/unmerge ATOMIC INVARIANT PROTOCOL.
 *
 * Master AI's R122 audit reproduced two unsafe outcomes with actual production
 * SQL slices (review-r122/scripts/reproduce-merge-gates.cjs):
 *
 *   R122-A01 "late reference": a merge could partially commit — references
 *   moved, source horse archived, redirect alias created — while its final
 *   merge-record INSERT affected ZERO rows, and the post-batch exception could
 *   not undo the committed writes.
 *
 *   R122-A02 "ancestor collapse": merging an ancestor into its descendant
 *   produced a horse whose father_id was its own id; the advisory lock
 *   serializes operations but never validated the resulting graph.
 *
 * This suite converts BOTH reproductions into negative regression assertions
 * against the REAL handlers on the fully migrated database, and adds the
 * in-window failure-injection matrix (the interfering write lands between the
 * handler's preflight reads and its locked batch — deterministic, via a
 * batch-intercepting proxy over a second real connection to the same
 * file-backed database):
 *
 *   - a late reference after preflight causes TOTAL rollback;
 *   - ancestor collapse (direct self-parent AND a longer chain) refuses
 *     atomically with a typed graph-unsafe error;
 *   - an in-window operator demotion causes total rollback (403);
 *   - opposite merges racing in-window: exactly one commits, the loser fully
 *     rolls back;
 *   - unmerge drift in-window (a manifest row reassigned between preflight and
 *     batch) refuses atomically — nothing restored, no receipt;
 *   - the canonical revision and the active-horse counter settle exactly once
 *     per successful command, in the same transaction;
 *   - mid-batch failures at arbitrary positions leave zero residue.
 */

const KEPT = 10;
const MERGED = 20;
const CHILD = 21;
const LATER_CHILD = 22;
const THIRD = 30;

describe("R122/T01 — merge/unmerge atomic invariant protocol", () => {
  let db: D1Database;
  let interferer: D1Database;
  let operator: AuthedSession;
  let tempDir: string;
  const env = (database = db) => ({ DB: database, SESSION_COOKIE_NAME: "hr_session" });

  const preview = (keptId: number, mergedId: number, session: AuthedSession = operator) =>
    adminMergePreview(authedRequest(`/api/admin/horses/${keptId}/merge-preview?merge_horse_id=${mergedId}`, undefined, { method: "GET", session }), env(), keptId);
  const merge = (keptId: number, body: Record<string, unknown>, session: AuthedSession = operator, database = db) =>
    adminMergeHorses(authedRequest(`/api/admin/horses/${keptId}/merge`, body, { session }), { DB: database, SESSION_COOKIE_NAME: "hr_session" }, keptId);
  const unmerge = (mergeId: number, body: Record<string, unknown>, session: AuthedSession = operator, database = db) =>
    adminUnmergeHorses(authedRequest(`/api/admin/horse-merges/${mergeId}/unmerge`, body, { session }), { DB: database, SESSION_COOKIE_NAME: "hr_session" }, mergeId);

  /**
   * Deterministic in-window failure injection: a proxy database whose batch()
   * performs the interfering write through a SECOND real connection to the
   * same file — exactly between the handler's preflight reads and its locked
   * transaction. Preflight reads pass through untouched, so the digest check
   * sees the pre-poison state, as in the real race.
   */
  function poisonedDb(poison: () => void | Promise<void>): D1Database {
    return {
      prepare: (sql: string) => db.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        await poison();
        return db.batch(statements);
      },
      exec: (sql: string) => db.exec(sql),
    } as unknown as D1Database;
  }

  const scalar = async <T>(sql: string, ...args: unknown[]): Promise<T | null> => await db.prepare(sql).bind(...args).first<T>();
  const countOf = async (sql: string): Promise<number> => Number(((await db.prepare(sql).first<{ n: number }>()) ?? { n: 0 }).n);

  /** The complete acceptance snapshot: every write surface the merge touches. */
  async function mergeSurface() {
    return {
      keptRow: await scalar<{ deleted_at: string | null; father_id: number | null }>("SELECT deleted_at,father_id FROM horses WHERE id=?", KEPT),
      mergedRow: await scalar<{ deleted_at: string | null }>("SELECT deleted_at FROM horses WHERE id=?", MERGED),
      childFather: await scalar<{ father_id: number | null }>("SELECT father_id FROM horses WHERE id=?", CHILD),
      laterChildFather: await scalar<{ father_id: number | null }>("SELECT father_id FROM horses WHERE id=?", LATER_CHILD),
      alias: await scalar<{ kept_horse_id: number }>("SELECT kept_horse_id FROM horse_redirect_aliases WHERE alias_horse_id=?", MERGED),
      mergeRecords: await countOf("SELECT COUNT(*) AS n FROM horse_merges"),
      receipts: await countOf("SELECT COUNT(*) AS n FROM merge_command_receipts"),
      assertions: await db.prepare("SELECT command,ok FROM merge_invariant_assertions ORDER BY id").all().then((r) => r.results),
      revision: await countOf("SELECT canonical_revision AS n FROM registry_state WHERE id=1"),
      activeCount: await countOf("SELECT active_horse_count AS n FROM registry_runtime_counters WHERE id=1"),
      auditMerges: await countOf("SELECT COUNT(*) AS n FROM audit_events WHERE action='horse.merged'"),
      reindex: await countOf("SELECT COUNT(*) AS n FROM horse_search_reindex_queue"),
    };
  }

  async function seedRegistry() {
    await seedUser(db, "r122-operator", "editor");
    await db.exec(`
      INSERT INTO horses(id,register_no,name_latin,birth_year) VALUES
        (${KEPT},'R122-K','Kept Horse',2015),
        (${MERGED},'R122-M','Duplicate Horse',2015),
        (${CHILD},'R122-C','Child Horse',2019),
        (${LATER_CHILD},'R122-L','Later Child Horse',2020),
        (${THIRD},'R122-T','Third Horse',2014);
      UPDATE horses SET father_id=${MERGED} WHERE id=${CHILD};
    `);
    // Mirror the runtime invariant: the counter reflects live horses.
    await db.exec(`UPDATE registry_runtime_counters SET active_horse_count=(SELECT COUNT(*) FROM horses WHERE deleted_at IS NULL) WHERE id=1`);
  }

  /** Preview + merge through the real flow; returns the merge row id. */
  async function mergeThroughPreview(keptId: number, mergedId: number, operationId: string, database = db): Promise<{ digest: string; mergeId: number }> {
    const previewResponse = database === db ? await preview(keptId, mergedId) : await adminMergePreview(
      authedRequest(`/api/admin/horses/${keptId}/merge-preview?merge_horse_id=${mergedId}`, undefined, { method: "GET", session: operator }),
      { DB: database, SESSION_COOKIE_NAME: "hr_session" }, keptId);
    expect(previewResponse.status).toBe(200);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const response = await merge(keptId, { merge_horse_id: mergedId, reason: "R122 atomicity fixture merge", operation_id: operationId, expected_manifest_digest: digest }, operator, database);
    expect(response.status).toBe(201);
    const row = await db.prepare("SELECT id FROM horse_merges WHERE operation_id=?").bind(operationId).first<{ id: number }>();
    return { digest, mergeId: Number(row!.id) };
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "r122-merge-atomic-"));
    const file = join(tempDir, "registry.sqlite");
    db = openLocalSqlite(file);
    interferer = openLocalSqlite(file);
    const files = readdirSync(join(__dirname, "../../migrations")).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
    for (const migration of files) await db.exec(readFileSync(join(__dirname, "../../migrations", migration), "utf8"));
    await seedRegistry();
    operator = await makeSession(db, "r122-operator");
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* temp cleanup is best-effort */ }
  });

  it("R122-A01 regression: a late reference after preflight causes TOTAL rollback (no partial commit)", async () => {
    const previewResponse = await preview(KEPT, MERGED);
    expect(previewResponse.status).toBe(200);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const before = await mergeSurface();

    // The interfering writer adds ANOTHER child of the merged horse after the
    // digest was approved but before the locked transaction runs.
    const poisoned = poisonedDb(() => {
      void interferer.prepare(`UPDATE horses SET father_id=${MERGED} WHERE id=${LATER_CHILD}`).run();
    });
    const attempt = merge(KEPT, { merge_horse_id: MERGED, reason: "R122 late-reference race fixture", operation_id: "r122-late-ref-0001", expected_manifest_digest: digest }, operator, poisoned);
    await expect(attempt).rejects.toMatchObject({ status: 409, code: "merge_state_changed" });

    const after = await mergeSurface();
    expect(after.mergedRow!.deleted_at).toBeNull();          // NOT archived
    expect(after.childFather!.father_id).toBe(MERGED);        // NOT moved
    expect(after.alias).toBeNull();                           // NO alias created
    expect(after.mergeRecords).toBe(0);                       // NO merge record
    expect(after.receipts).toBe(0);                           // NO receipt
    expect(after.assertions).toEqual([]);                     // rolled back with everything else
    expect(after.revision).toBe(before.revision);             // revision not advanced
    expect(after.activeCount).toBe(before.activeCount);       // counter not decremented
    expect(after.auditMerges).toBe(0);
  });

  it("R122-A02 regression (direct): merging a parent into its own child refuses atomically (no self-parent)", async () => {
    // kept is a CHILD of merged: the manifest would move kept.father_id
    // merged -> kept, a self-parent. This is the audit's exact reproduction.
    await db.exec(`UPDATE horses SET father_id=${MERGED} WHERE id=${KEPT}`);
    const previewResponse = await preview(KEPT, MERGED);
    expect(previewResponse.status).toBe(200);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const before = await mergeSurface();

    const attempt = merge(KEPT, { merge_horse_id: MERGED, reason: "R122 ancestor-collapse fixture", operation_id: "r122-ancestor-0001", expected_manifest_digest: digest });
    await expect(attempt).rejects.toMatchObject({ status: 409, code: "merge_graph_unsafe" });

    const after = await mergeSurface();
    expect(after.keptRow!.father_id).toBe(MERGED);            // NOT repointed at itself
    expect(after.mergedRow!.deleted_at).toBeNull();           // NOT archived
    expect(after.childFather!.father_id).toBe(MERGED);        // NOT moved
    expect(after.alias).toBeNull();
    expect(after.mergeRecords).toBe(0);
    expect(after.receipts).toBe(0);
    expect(after.assertions).toEqual([]);
    expect(after.revision).toBe(before.revision);
    expect(after.activeCount).toBe(before.activeCount);
  });

  it("R122-A02 regression (longer chain): merging an ancestor into a deep descendant refuses atomically", async () => {
    // kept -> CHILD -> merged: merged is a grandancestor of kept. The moves
    // would repoint CHILD.father_id at kept while kept's own chain reaches
    // CHILD — a longer cycle through the kept horse.
    await db.exec(`UPDATE horses SET father_id=${CHILD} WHERE id=${KEPT}`);
    await db.exec(`UPDATE horses SET father_id=${MERGED} WHERE id=${CHILD}`);
    const previewResponse = await preview(KEPT, MERGED);
    expect(previewResponse.status).toBe(200);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const before = await mergeSurface();

    const attempt = merge(KEPT, { merge_horse_id: MERGED, reason: "R122 deep ancestor-chain fixture", operation_id: "r122-ancestor-0002", expected_manifest_digest: digest });
    await expect(attempt).rejects.toMatchObject({ status: 409, code: "merge_graph_unsafe" });

    const after = await mergeSurface();
    expect(after.keptRow!.father_id).toBe(CHILD);             // chains untouched
    expect(after.childFather!.father_id).toBe(MERGED);
    expect(after.mergedRow!.deleted_at).toBeNull();
    expect(after.mergeRecords).toBe(0);
    expect(after.receipts).toBe(0);
    expect(after.revision).toBe(before.revision);
    expect(after.activeCount).toBe(before.activeCount);
  });

  it("an in-window operator demotion causes total rollback (authority is rechecked inside the transaction)", async () => {
    const previewResponse = await preview(KEPT, MERGED);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const before = await mergeSurface();

    const poisoned = poisonedDb(() => {
      void interferer.prepare("UPDATE users SET is_active=0 WHERE id='r122-operator'").run();
    });
    const attempt = merge(KEPT, { merge_horse_id: MERGED, reason: "R122 demotion race fixture", operation_id: "r122-demote-0001", expected_manifest_digest: digest }, operator, poisoned);
    await expect(attempt).rejects.toMatchObject({ status: 403, code: "forbidden" });

    const after = await mergeSurface();
    expect(after.mergedRow!.deleted_at).toBeNull();
    expect(after.childFather!.father_id).toBe(MERGED);
    expect(after.mergeRecords).toBe(0);
    expect(after.receipts).toBe(0);
    expect(after.revision).toBe(before.revision);
    expect(after.activeCount).toBe(before.activeCount);
  });

  it("opposite merges racing in-window: exactly one commits, the loser rolls back completely", async () => {
    const forwardPreview = await preview(KEPT, MERGED);
    const forwardDigest = ((await forwardPreview.json()) as { manifest_digest: string }).manifest_digest;
    const backwardPreview = await adminMergePreview(
      authedRequest(`/api/admin/horses/${MERGED}/merge-preview?merge_horse_id=${KEPT}`, undefined, { method: "GET", session: operator }),
      env(), MERGED);
    expect(backwardPreview.status).toBe(200);
    const backwardDigest = ((await backwardPreview.json()) as { manifest_digest: string }).manifest_digest;

    // The backward merge's preflight has ALREADY passed (both horses live at
    // preview time). The forward merge commits BETWEEN that preflight and the
    // backward merge's locked batch — injected deterministically at batch
    // time — so the backward batch itself must refuse atomically.
    const poisoned = poisonedDb(async () => {
      const forward = await merge(KEPT, { merge_horse_id: MERGED, reason: "R122 opposite-merge forward fixture", operation_id: "r122-opposite-fwd", expected_manifest_digest: forwardDigest }, operator, interferer);
      expect(forward.status).toBe(201);
    });
    const backward = merge(MERGED, { merge_horse_id: KEPT, reason: "R122 opposite-merge backward fixture", operation_id: "r122-opposite-bwd", expected_manifest_digest: backwardDigest }, operator, poisoned);
    let backwardError: { status?: number; code?: string } | null = null;
    try { await backward; } catch (error) { backwardError = error as { status?: number; code?: string }; }
    expect(backwardError?.status).toBe(409);
    expect(["merge_state_changed", "merge_graph_unsafe", "already_merged"]).toContain(backwardError?.code);

    const after = await mergeSurface();
    expect(after.mergeRecords).toBe(1);                       // exactly one record
    expect(after.receipts).toBe(1);                           // exactly one receipt
    expect(after.alias!.kept_horse_id).toBe(KEPT);            // the forward alias
    expect(after.mergedRow!.deleted_at).not.toBeNull();       // MERGED archived by the winner
    expect(after.keptRow!.deleted_at).toBeNull();             // KEPT still live
    expect(after.childFather!.father_id).toBe(KEPT);          // child moved to the winner
  });

  it("unmerge drift in-window (a manifest row reassigned between preflight and batch) refuses atomically", async () => {
    const { mergeId } = await mergeThroughPreview(KEPT, MERGED, "r122-unmerge-drift-merge");
    const afterFirstMerge = await mergeSurface();
    expect(afterFirstMerge.mergedRow!.deleted_at).not.toBeNull();
    expect(afterFirstMerge.childFather!.father_id).toBe(KEPT);

    const clean = await unmerge(mergeId, { reason: "R122 unmerge drift fixture", operation_id: "r122-unmerge-drift-0001" });
    // Baseline: a clean unmerge succeeds first (guards against fixture rot).
    expect(clean.status).toBe(200);
    const restored = await mergeSurface();
    expect(restored.mergedRow!.deleted_at).toBeNull();
    expect(restored.childFather!.father_id).toBe(MERGED);
    expect(restored.revision).toBe(afterFirstMerge.revision + 1);   // only the unmerge bumps from here
    expect(restored.activeCount).toBe(afterFirstMerge.activeCount + 1); // unmerge restored the archived horse

    // Now the drift race: re-merge, then reassign the child BETWEEN the
    // unmerge preflight and its batch — the restore must refuse atomically.
    const second = await mergeThroughPreview(KEPT, MERGED, "r122-unmerge-drift-merge-2");
    const preDrift = await mergeSurface();
    const poisoned = poisonedDb(() => {
      void interferer.prepare(`UPDATE horses SET father_id=${THIRD} WHERE id=${CHILD}`).run();
    });
    const drifting = unmerge(second.mergeId, { reason: "R122 unmerge drift race fixture", operation_id: "r122-unmerge-drift-0002" }, operator, poisoned);
    let driftError: { status?: number; code?: string } | null = null;
    try { await drifting; } catch (error) { driftError = error as { status?: number; code?: string }; }
    expect(driftError?.status).toBe(409);
    expect(driftError?.code).toBe("unmerge_state_changed");

    const afterDrift = await mergeSurface();
    expect(afterDrift.mergedRow!.deleted_at).not.toBeNull();  // NOT restored
    expect(afterDrift.childFather!.father_id).toBe(THIRD);    // the legitimate reassignment survives
    expect(afterDrift.alias!.kept_horse_id).toBe(KEPT);       // alias intact
    expect(afterDrift.receipts).toBe(preDrift.receipts);      // no new receipt
    expect(afterDrift.revision).toBe(preDrift.revision);      // no revision bump
    expect(afterDrift.activeCount).toBe(preDrift.activeCount);// no counter change
  });

  it("the revision and active-horse counter settle exactly once per successful command (R122-A03)", async () => {
    const before = await mergeSurface();
    const { mergeId } = await mergeThroughPreview(KEPT, MERGED, "r122-counters-merge");
    const afterMerge = await mergeSurface();
    expect(afterMerge.revision).toBe(before.revision + 1);
    expect(afterMerge.activeCount).toBe(before.activeCount - 1);
    expect(afterMerge.assertions).toEqual([{ command: "merge", ok: 1 }]);

    const response = await unmerge(mergeId, { reason: "R122 counters unmerge fixture", operation_id: "r122-counters-unmerge-0001" });
    expect(response.status).toBe(200);
    const afterUnmerge = await mergeSurface();
    expect(afterUnmerge.revision).toBe(afterMerge.revision + 1);
    expect(afterUnmerge.activeCount).toBe(afterMerge.activeCount + 1);
    expect(afterUnmerge.assertions).toEqual([{ command: "merge", ok: 1 }, { command: "unmerge", ok: 1 }]);

    // An exact same-key retry replays the stored receipt — no second bump.
    const retry = await unmerge(mergeId, { reason: "R122 counters unmerge fixture", operation_id: "r122-counters-unmerge-0001" });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { replayed: boolean }).replayed).toBe(true);
    const afterRetry = await mergeSurface();
    expect(afterRetry.revision).toBe(afterUnmerge.revision);
    expect(afterRetry.activeCount).toBe(afterUnmerge.activeCount);
    expect(afterRetry.receipts).toBe(afterUnmerge.receipts);
  });

  it("a mid-batch failure at ANY position leaves zero residue (position-independent rollback)", async () => {
    const previewResponse = await preview(KEPT, MERGED);
    const digest = ((await previewResponse.json()) as { manifest_digest: string }).manifest_digest;
    const before = await mergeSurface();

    // Rebuild the batch's statement family and inject a hard failure at an
    // arbitrary position (after the moves, after the archive, after the
    // alias) — each prefix must leave NOTHING behind.
    const positions = ["after-moves", "after-archive", "after-alias"] as const;
    for (const position of positions) {
      const statements: D1PreparedStatement[] = [];
      statements.push(db.prepare(`UPDATE horses SET father_id=${KEPT} WHERE id=${CHILD} AND father_id=${MERGED}`));
      if (position !== "after-moves") {
        statements.push(db.prepare(`UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=${MERGED} AND deleted_at IS NULL`));
      }
      if (position === "after-alias") {
        statements.push(db.prepare(`INSERT INTO horse_redirect_aliases(alias_horse_id,kept_horse_id) SELECT ${MERGED},${KEPT} WHERE NOT EXISTS(SELECT 1 FROM horse_redirect_aliases WHERE alias_horse_id=${MERGED})`));
      }
      // The injected failure: a statement that cannot parse/execute.
      statements.push(db.prepare("INSERT INTO r122_nonexistent_table VALUES (1)"));
      let batchError: unknown = null;
      try {
        await db.batch(statements);
      } catch (cause) {
        batchError = cause;
      }
      expect(batchError).toBeTruthy();
      const after = await mergeSurface();
      expect(after.childFather!.father_id).toBe(MERGED);   // move rolled back
      expect(after.mergedRow!.deleted_at).toBeNull();      // archive rolled back
      expect(after.alias).toBeNull();                      // alias rolled back
      expect(after.revision).toBe(before.revision);        // revision untouched
      expect(after.activeCount).toBe(before.activeCount);  // counter untouched
      expect(after.mergeRecords).toBe(0);
      expect(after.receipts).toBe(0);
    }
    void digest;
  });
});
