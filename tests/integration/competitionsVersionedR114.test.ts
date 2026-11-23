import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  adminAddResults,
  adminCreateCompetition,
  adminCreateResultVersioned,
  adminUpdateCompetition,
  adminUpdateResult,
  competitionDetail,
  horseCompetitionHistory,
} from "../../src/api/modules/competitions";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R114-02 acceptance (Master AI R113 handoff, NEXT_BACKEND.md D18):
 * versioned competition event/result editing through the REAL handlers on a
 * real SQLite database with every migration applied.
 *
 * Required cases from the handoff:
 *  - two editors save the same version and exactly one wins
 *  - two identical create intentions create one result and one audit
 *  - same key / different payload refuses
 *  - null vs empty class_name still respects identity uniqueness
 *  - editor demoted after preflight writes nothing
 *  - archived/missing horse or event is rejected
 *  - a successful result appears in both the event and horse views
 *  - a stale version produces 409 with the CURRENT row for comparison
 *  - the legacy batch endpoint never overwrites (create-only)
 */

describe("R114-02 — versioned competition editing (D18)", () => {
  let db: D1Database;
  let editor: AuthedSession;
  let editorB: AuthedSession;
  const event = { name_native: "R114 versioned event", discipline: "show_jumping", event_date: "2028-03-05", venue: "Fictional versioned arena", season: 1407 };
  const env = () => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

  const createEvent = async (changes: Record<string, unknown> = {}) => {
    const response = await adminCreateCompetition(authedRequest("/api/admin/competitions", { ...event, ...changes }, { session: editor }), env());
    const body = await response.json() as { competition: { id: number; row_version: number } };
    return { id: Number(body.competition.id), row_version: Number(body.competition.row_version) };
  };
  const createResult = (competitionId: number, result: Record<string, unknown>, operationId: string, session: AuthedSession = editor) =>
    adminCreateResultVersioned(authedRequest(`/api/admin/competitions/${competitionId}/results/versioned`, { result, operation_id: operationId }, { session }), env(), competitionId);
  const updateResult = (competitionId: number, resultId: number, expectedVersion: number, changes: Record<string, unknown>, operationId: string, session: AuthedSession = editor) =>
    adminUpdateResult(authedRequest(`/api/admin/competitions/${competitionId}/results/${resultId}/version`, { expected_version: expectedVersion, changes, operation_id: operationId }, { session }), env(), competitionId, resultId);
  const updateEvent = (competitionId: number, expectedVersion: number, changes: Record<string, unknown>, operationId: string, session: AuthedSession = editor) =>
    adminUpdateCompetition(authedRequest(`/api/admin/competitions/${competitionId}/version`, { expected_version: expectedVersion, changes, operation_id: operationId }, { session }), env(), competitionId);
  const rowCount = async (sql: string, ...binds: unknown[]) => Number(await db.prepare(sql).bind(...binds).first<{ n: number }>().then(r => r?.n ?? 0));
  const audits = (action: string) => rowCount("SELECT COUNT(*) AS n FROM audit_events WHERE action=?", action);
  const receipts = () => rowCount("SELECT COUNT(*) AS n FROM competition_command_receipts");

  /** Interposes a hook before the FIRST db.batch call only, to demote the
   * editor between the handler's preflight read and its guarded mutation. */
  function interposedBatch(hook: () => Promise<unknown>): D1Database {
    let first = true;
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") return async (statements: D1PreparedStatement[]) => {
          if (first) { await hook(); first = false; }
          return db.batch(statements);
        };
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r114-editor-a", "editor");
    await seedUser(db, "r114-editor-b", "editor");
    editor = await makeSession(db, "r114-editor-a");
    editorB = await makeSession(db, "r114-editor-b");
    await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'R114 synthetic horse A'),(2,'R114 synthetic horse B')");
  });

  describe("versioned result create", () => {
    it("creates at row_version 1 with one receipt and one audit; appears in both event and horse views", async () => {
      const competition = await createEvent();
      const response = await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 2, score: "4 faults" }, "r114-create-0001");
      expect(response.status).toBe(201);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toMatchObject({ created: true, replayed: false, row_version: 1 });
      expect((body.receipt as Record<string, unknown>)).toMatchObject({ operation_id: "r114-create-0001", command: "result.create", status_code: 201 });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(1);
      expect(await audits("competition.result_created")).toBe(1);
      expect(await receipts()).toBe(1);

      // Both public views expose the created row with its version.
      const detail = await (await competitionDetail(db, competition.id)).json() as { results: Array<{ horse_id: number; row_version: number }>; results_window: { total: number; has_more: boolean; limit: number } };
      expect(detail.results).toHaveLength(1);
      expect(detail.results[0]).toMatchObject({ horse_id: 1, row_version: 1 });
      expect(detail.results_window).toEqual({ limit: 500, total: 1, has_more: false });
      const history = await (await horseCompetitionHistory(db, 1)).json() as { summary: { starts: number; wins: number }; results: Array<{ row_version: number }>; history_window: { total: number; has_more: boolean } };
      expect(history.summary.starts).toBe(1);
      expect(history.results[0]).toMatchObject({ row_version: 1 });
      expect(history.history_window).toEqual({ limit: 200, total: 1, has_more: false });
    });

    it("an exact same-key retry replays the stored response without a second receipt or audit", async () => {
      const competition = await createEvent();
      const first = await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 3 }, "r114-create-0002");
      expect(first.status).toBe(201);
      const second = await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 3 }, "r114-create-0002");
      expect(second.status).toBe(201);
      const body = await second.json() as Record<string, unknown>;
      expect(body).toMatchObject({ created: true, replayed: true });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(1);
      expect(await audits("competition.result_created")).toBe(1);
      expect(await receipts()).toBe(1);
    });

    it("two identical create intentions (different keys) produce ONE result and ONE audit", async () => {
      const competition = await createEvent();
      const first = await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 4 }, "r114-create-0003");
      expect(first.status).toBe(201);
      const second = await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 4 }, "r114-create-0004");
      expect(second.status).toBe(200);
      const body = await second.json() as Record<string, unknown>;
      expect(body).toMatchObject({ created: false, replayed: false, row_version: 1 });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(1);
      expect(await audits("competition.result_created")).toBe(1);
      expect(await receipts()).toBe(2); // the no-op command still has its own receipt
    });

    it("a reused key with different content refuses (409) and writes nothing", async () => {
      const competition = await createEvent();
      await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 5 }, "r114-create-0005");
      await expect(createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 6 }, "r114-create-0005"))
        .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(1);
      expect(await audits("competition.result_created")).toBe(1);
      const stored = await db.prepare("SELECT placement FROM competition_results").first<{ placement: number }>();
      expect(Number(stored?.placement)).toBe(5);
    });

    it("an existing natural key with different content is a 409 result_conflict carrying the current version", async () => {
      const competition = await createEvent();
      await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 7 }, "r114-create-0006");
      await expect(createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 8 }, "r114-create-0007"))
        .rejects.toMatchObject({ status: 409, code: "result_conflict" });
    });

    it("null and empty class names collide on identity exactly as before (no silent second row)", async () => {
      const competition = await createEvent();
      const first = await createResult(competition.id, { horse_id: 1, placement: 9 }, "r114-create-0008");
      expect(first.status).toBe(201);
      // Same horse, empty-string class: the IFNULL identity treats it as the
      // same natural key; the content differs (class_name '' vs NULL) so it
      // must refuse rather than create a near-duplicate row.
      await expect(createResult(competition.id, { horse_id: 1, class_name: "", placement: 9 }, "r114-create-0009"))
        .rejects.toMatchObject({ status: 409, code: "result_conflict" });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(1);
    });

    it("rejects a missing or archived horse and a missing event", async () => {
      const competition = await createEvent();
      await expect(createResult(competition.id, { horse_id: 999, class_name: "Open" }, "r114-create-0010"))
        .rejects.toMatchObject({ status: 400, code: "unknown_horse" });
      await expect(createResult(424242, { horse_id: 1, class_name: "Open" }, "r114-create-0011"))
        .rejects.toMatchObject({ status: 404, code: "not_found" });
      await db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=2");
      await expect(createResult(competition.id, { horse_id: 2, class_name: "Open" }, "r114-create-0012"))
        .rejects.toMatchObject({ status: 400, code: "unknown_horse" });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(0);
      expect(await receipts()).toBe(0);
    });

    it("keeps the R113 contradiction invariants (eliminated+placing refuses)", async () => {
      const competition = await createEvent();
      await expect(createResult(competition.id, { horse_id: 1, is_eliminated: true, placement: 1 }, "r114-create-0013"))
        .rejects.toMatchObject({ status: 400, code: "invalid_result_command" });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(0);
    });

    it("a demoted editor cannot even register a no-op receipt", async () => {
      const competition = await createEvent();
      await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 2 }, "r114-create-0014");
      const demoted = new Proxy(env(), {
        get(target, prop) {
          if (prop === "DB") return interposedBatch(() => db.exec("UPDATE users SET role='user' WHERE id='r114-editor-a'"));
          return Reflect.get(target, prop);
        },
      }) as { DB: D1Database; SESSION_COOKIE_NAME: string };
      await expect(adminCreateResultVersioned(authedRequest(`/api/admin/competitions/${competition.id}/results/versioned`, { result: { horse_id: 1, class_name: "Open", placement: 2 }, operation_id: "r114-create-0015" }, { session: editor }), demoted, competition.id))
        .rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(await receipts()).toBe(1);
    });
  });

  describe("versioned result update", () => {
    it("two editors save the same version and exactly one wins; the loser keeps a comparable CURRENT row", async () => {
      const competition = await createEvent();
      const created = await (await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 5 }, "r114-upd-0001")).json() as { result: { id: number } };
      const winner = await updateResult(competition.id, created.result.id, 1, { placement: 1, score: "clear round" }, "r114-upd-0002", editor);
      expect(winner.status).toBe(200);
      const winnerBody = await winner.json() as Record<string, unknown>;
      expect(winnerBody).toMatchObject({ updated: true, row_version: 2 });
      // The second editor still holds version 1: stale, refused, and handed
      // the current row for comparison — never an automatic rebase.
      const loser = updateResult(competition.id, created.result.id, 1, { placement: 2 }, "r114-upd-0003", editorB);
      await expect(loser).rejects.toMatchObject({ status: 409, code: "version_conflict" });
      await expect(loser).rejects.toMatchObject({ details: { current: { placement: 1, row_version: 2 } } });
      const stored = await db.prepare("SELECT placement,score,row_version FROM competition_results WHERE id=?").bind(created.result.id).first<{ placement: number; score: string; row_version: number }>();
      expect(stored).toMatchObject({ placement: 1, score: "clear round", row_version: 2 });
      expect(await audits("competition.result_updated")).toBe(1);
      // The winner's own stale retry is also refused with the current row.
      await expect(updateResult(competition.id, created.result.id, 1, { placement: 3 }, "r114-upd-0004", editor))
        .rejects.toMatchObject({ status: 409, code: "version_conflict" });
      expect(await audits("competition.result_updated")).toBe(1);
    });

    it("same-key retry replays the stored update response; different content under the key refuses", async () => {
      const competition = await createEvent();
      const created = await (await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 6 }, "r114-upd-0005")).json() as { result: { id: number } };
      const first = await updateResult(competition.id, created.result.id, 1, { placement: 4 }, "r114-upd-0006");
      expect(first.status).toBe(200);
      const retry = await updateResult(competition.id, created.result.id, 1, { placement: 4 }, "r114-upd-0006");
      expect(retry.status).toBe(200);
      expect(await (retry.json() as Promise<Record<string, unknown>>)).toMatchObject({ updated: true, replayed: true, row_version: 2 });
      await expect(updateResult(competition.id, created.result.id, 1, { placement: 5 }, "r114-upd-0006"))
        .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
      expect(await audits("competition.result_updated")).toBe(1);
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_command_receipts WHERE command='result.update'")).toBe(1);
    });

    it("merged invariants: an update cannot introduce an eliminated+placing contradiction", async () => {
      const competition = await createEvent();
      const created = await (await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 6 }, "r114-upd-0007")).json() as { result: { id: number } };
      await expect(updateResult(competition.id, created.result.id, 1, { is_eliminated: true }, "r114-upd-0008"))
        .rejects.toMatchObject({ status: 400, code: "invalid_result_command" });
      const stored = await db.prepare("SELECT is_eliminated,row_version FROM competition_results WHERE id=?").bind(created.result.id).first<{ is_eliminated: number; row_version: number }>();
      expect(stored).toMatchObject({ is_eliminated: 0, row_version: 1 });
    });

    it("a class rename onto a colliding existing class refuses; a free rename advances the version", async () => {
      const competition = await createEvent();
      await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 1 }, "r114-upd-0009");
      const second = await (await createResult(competition.id, { horse_id: 2, class_name: "Amateur", placement: 2 }, "r114-upd-0010")).json() as { result: { id: number } };
      // horse 2 already owns "Amateur": moving it onto "Open" (owned by
      // horse 1's row) must refuse — wait, identity is per (horse, class);
      // horse 2 does NOT own "Open", so this rename is legal. Instead collide
      // by renaming horse 2's second row onto its own existing class.
      const third = await (await createResult(competition.id, { horse_id: 2, class_name: "Youth", placement: 3 }, "r114-upd-0011")).json() as { result: { id: number } };
      await expect(updateResult(competition.id, third.result.id, 1, { class_name: "Amateur" }, "r114-upd-0012"))
        .rejects.toMatchObject({ status: 409, code: "identity_conflict" });
      const free = await updateResult(competition.id, third.result.id, 1, { class_name: "Junior" }, "r114-upd-0013");
      expect(free.status).toBe(200);
      expect(await (free.json() as Promise<Record<string, unknown>>)).toMatchObject({ row_version: 2 });
      expect(second.result.id).toBeGreaterThan(0);
    });

    it("a demoted editor's update writes nothing (authority rechecked inside the mutation)", async () => {
      const competition = await createEvent();
      const created = await (await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 6 }, "r114-upd-0014")).json() as { result: { id: number } };
      const demoted = new Proxy(env(), {
        get(target, prop) {
          if (prop === "DB") return interposedBatch(() => db.exec("UPDATE users SET role='user' WHERE id='r114-editor-a'"));
          return Reflect.get(target, prop);
        },
      }) as { DB: D1Database; SESSION_COOKIE_NAME: string };
      await expect(adminUpdateResult(authedRequest(`/api/admin/competitions/${competition.id}/results/${created.result.id}/version`, { expected_version: 1, changes: { placement: 1 }, operation_id: "r114-upd-0015" }, { session: editor }), demoted, competition.id, created.result.id))
        .rejects.toMatchObject({ status: 403, code: "forbidden" });
      const stored = await db.prepare("SELECT placement,row_version,last_operation_id FROM competition_results WHERE id=?").bind(created.result.id).first<{ placement: number; row_version: number; last_operation_id: string | null }>();
      expect(stored).toMatchObject({ placement: 6, row_version: 1, last_operation_id: "r114-upd-0014" });
      expect(await audits("competition.result_updated")).toBe(0);
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_command_receipts WHERE command='result.update'")).toBe(0);
    });

    it("an archived horse blocks the update", async () => {
      const competition = await createEvent();
      const created = await (await createResult(competition.id, { horse_id: 1, class_name: "Open", placement: 6 }, "r114-upd-0016")).json() as { result: { id: number } };
      await db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=1");
      await expect(updateResult(competition.id, created.result.id, 1, { placement: 2 }, "r114-upd-0017"))
        .rejects.toMatchObject({ status: 409, code: "horse_archived" });
      expect(await audits("competition.result_updated")).toBe(0);
    });
  });

  describe("versioned event update", () => {
    it("advances the event version, keeps R113 date invariants, and returns the current event on a stale version", async () => {
      const competition = await createEvent();
      const first = await updateEvent(competition.id, 1, { venue: "Renamed fictional arena", end_date: "2028-03-07" }, "r114-evt-0001");
      expect(first.status).toBe(200);
      expect(await (first.json() as Promise<Record<string, unknown>>)).toMatchObject({ updated: true, row_version: 2 });
      expect(await audits("competition.event_updated")).toBe(1);
      // R113 invariant preserved on the MERGED event: reversed range refuses.
      await expect(updateEvent(competition.id, 2, { event_date: "2028-03-10" }, "r114-evt-0002"))
        .rejects.toMatchObject({ status: 400, code: "invalid_event_command" });
      // Stale version: 409 with the current event for comparison.
      const stale = updateEvent(competition.id, 1, { venue: "Should not apply" }, "r114-evt-0003");
      await expect(stale).rejects.toMatchObject({ status: 409, code: "version_conflict" });
      await expect(stale).rejects.toMatchObject({ details: { current: { row_version: 2 } } });
      expect(await audits("competition.event_updated")).toBe(1);
      const stored = await db.prepare("SELECT venue,row_version FROM competitions WHERE id=?").bind(competition.id).first<{ venue: string; row_version: number }>();
      expect(stored).toMatchObject({ venue: "Renamed fictional arena", row_version: 2 });
    });

    it("same-key retry replays; different content under the key refuses", async () => {
      const competition = await createEvent();
      await updateEvent(competition.id, 1, { venue: "Replay venue" }, "r114-evt-0004");
      const retry = await updateEvent(competition.id, 1, { venue: "Replay venue" }, "r114-evt-0004");
      expect(retry.status).toBe(200);
      expect(await (retry.json() as Promise<Record<string, unknown>>)).toMatchObject({ updated: true, replayed: true, row_version: 2 });
      await expect(updateEvent(competition.id, 2, { venue: "Different" }, "r114-evt-0004"))
        .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
      expect(await audits("competition.event_updated")).toBe(1);
    });
  });

  describe("legacy batch endpoint is create-only", () => {
    it("an identical replay is an idempotent no-op; different content is a 409 that never overwrites", async () => {
      const competition = await createEvent();
      const first = await adminAddResults(authedRequest(`/api/admin/competitions/${competition.id}/results`, { results: [{ horse_id: 1, class_name: "Open", placement: 2, score: "4 faults" }] }, { session: editor }), env(), competition.id);
      expect(first.status).toBe(201);
      const firstBody = await first.json() as Record<string, unknown>;
      expect(firstBody).toMatchObject({ applied: 1, existing: 0 });

      const replay = await adminAddResults(authedRequest(`/api/admin/competitions/${competition.id}/results`, { results: [{ horse_id: 1, class_name: "Open", placement: 2, score: "4 faults" }] }, { session: editor }), env(), competition.id);
      expect(replay.status).toBe(200);
      expect(await (replay.json() as Promise<Record<string, unknown>>)).toMatchObject({ applied: 0, existing: 1 });

      // The would-overwrite case that R113 left silently replacing data.
      await expect(adminAddResults(authedRequest(`/api/admin/competitions/${competition.id}/results`, { results: [{ horse_id: 1, class_name: "Open", placement: 1, score: "0 faults" }] }, { session: editor }), env(), competition.id))
        .rejects.toMatchObject({ status: 409, code: "result_conflict" });
      const stored = await db.prepare("SELECT placement,score,row_version FROM competition_results").first<{ placement: number; score: string; row_version: number }>();
      expect(stored).toMatchObject({ placement: 2, score: "4 faults", row_version: 1 });
      // A partially-colliding batch is refused atomically.
      await expect(adminAddResults(authedRequest(`/api/admin/competitions/${competition.id}/results`, { results: [{ horse_id: 2, class_name: "New", placement: 1 }, { horse_id: 1, class_name: "Open", placement: 3 }] }, { session: editor }), env(), competition.id))
        .rejects.toMatchObject({ status: 409, code: "result_conflict" });
      expect(await rowCount("SELECT COUNT(*) AS n FROM competition_results")).toBe(1);
    });
  });
});
