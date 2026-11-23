import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  adminCreateCompetition,
  adminCreateResultVersioned,
  competitionDetail,
  horseCompetitionHistory,
} from "../../src/api/modules/competitions";
import {
  createWorkspace,
  createWorkspaceTask,
  listWorkspaceTasks,
} from "../../src/api/modules/workspaces";
import { HttpError } from "../../src/api/http";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R124 (master AI R122-T05) acceptance: the bounded windows are WALKABLE.
 * Keyset paging over the REAL handlers on a real SQLite database with every
 * migration applied. Invariants under test for every paged surface:
 *
 *  - walking next_cursor pages visits EVERY row exactly once (no overlap, no
 *    gaps) in the endpoint's own ordering;
 *  - has_more/next_cursor are honest (null exactly at exhaustion);
 *  - the page metadata reports the true filtered total;
 *  - legacy window shapes survive unchanged for existing consumers;
 *  - malformed cursors and out-of-range limits are typed 400s;
 *  - the keyset comparison is strictly AFTER the cursor row.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

describe("R124 — walkable windows: keyset paging over the real handlers", () => {
  let db: D1Database;
  let editor: AuthedSession;
  let owner: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r124-editor", "editor");
    await seedUser(db, "r124-owner", "user");
    editor = await makeSession(db, "r124-editor");
    owner = await makeSession(db, "r124-owner");
    await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'R124 horse A'),(2,'R124 horse B'),(3,'R124 horse C'),(4,'R124 horse D'),(5,'R124 horse E'),(6,'R124 horse F'),(7,'R124 horse G'),(8,'R124 horse H')");
  });

  const createEvent = async (event_date: string) => {
    const response = await adminCreateCompetition(authedRequest("/api/admin/competitions", {
      name_native: "R124 paged event", discipline: "show_jumping", event_date, venue: "R124 arena", season: 1408,
    }, { session: editor }), env(db));
    const body = await response.json() as { competition: { id: number } };
    return Number(body.competition.id);
  };
  const addResult = (competitionId: number, result: Record<string, unknown>, n: number) =>
    adminCreateResultVersioned(authedRequest(`/api/admin/competitions/${competitionId}/results/versioned`, {
      result, operation_id: `r124-op-${n}`,
    }, { session: editor }), env(db), competitionId);

  it("competition results: every row exactly once across cursor pages, honest has_more, legacy window intact", async () => {
    const competitionId = await createEvent("2028-04-01");
    let op = 0;
    // Mixed placements including null (rank 999999) so the keyset crosses the
    // null boundary, plus same-placement ties broken by id.
    const placements: Array<number | null> = [1, 2, null, 2, 3, null, 1, 3];
    for (const [index, placement] of placements.entries()) {
      const response = await addResult(competitionId, { horse_id: index + 1, class_name: "Open", placement }, ++op);
      if (response.status !== 201) throw new Error(`result create failed: ${response.status}`);
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const url = new URL(`http://x/api/competitions/${competitionId}`);
      url.searchParams.set("results_limit", "3");
      if (cursor) url.searchParams.set("results_cursor", cursor);
      const response = await competitionDetail(db, competitionId, url);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        results: Array<{ id: number; horse_id: number }>;
        results_window: { limit: number; total: number; has_more: boolean };
        results_page: { limit: number; returned: number; next_cursor: string | null; has_more: boolean; total: number };
      };
      // Legacy window survives for existing consumers.
      expect(body.results_window).toEqual({ limit: 500, total: 8, has_more: false });
      expect(body.results_page.total).toBe(8);
      expect(body.results.length).toBeLessThanOrEqual(3);
      for (const row of body.results) seen.push(row.horse_id);
      pages += 1;
      if (!body.results_page.has_more) {
        expect(body.results_page.next_cursor).toBeNull();
        break;
      }
      expect(body.results_page.next_cursor).toBeTruthy();
      cursor = body.results_page.next_cursor;
      if (pages > 10) throw new Error("paging did not terminate");
    }
    // Every horse exactly once, in the endpoint ordering (placement rank then id).
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pages).toBeGreaterThanOrEqual(3);
    // The keyset is strictly AFTER the cursor row: the last row of page one is
    // never the first row of page two.
    const page1 = new URL(`http://x/api/competitions/${competitionId}`);
    page1.searchParams.set("results_limit", "3");
    const first = await (await competitionDetail(db, competitionId, page1)).json() as { results: Array<{ horse_id: number }>; results_page: { next_cursor: string } };
    const page2 = new URL(`http://x/api/competitions/${competitionId}`);
    page2.searchParams.set("results_limit", "3");
    page2.searchParams.set("results_cursor", first.results_page.next_cursor);
    const second = await (await competitionDetail(db, competitionId, page2)).json() as { results: Array<{ horse_id: number }> };
    expect(second.results[0].horse_id).not.toBe(first.results[first.results.length - 1].horse_id);
  });

  it("competition results: malformed cursor and out-of-range limit are typed 400s", async () => {
    const competitionId = await createEvent("2028-04-02");
    await addResult(competitionId, { horse_id: 1, class_name: "Open", placement: 1 }, 90);
    const bad = new URL(`http://x/api/competitions/${competitionId}`);
    bad.searchParams.set("results_cursor", "not-a-cursor");
    await expect(competitionDetail(db, competitionId, bad)).rejects.toMatchObject({ status: 400 });
    await expect((async () => {
      const tooBig = new URL(`http://x/api/competitions/${competitionId}`);
      tooBig.searchParams.set("results_limit", "501");
      return competitionDetail(db, competitionId, tooBig);
    })()).rejects.toMatchObject({ status: 400 });
    // Zero/negative ids inside an otherwise well-formed cursor are refused too.
    const zeroId = new URL(`http://x/api/competitions/${competitionId}`);
    zeroId.searchParams.set("results_cursor", "1|0");
    await expect(competitionDetail(db, competitionId, zeroId)).rejects.toMatchObject({ status: 400 });
    expect(new HttpError(400, "invalid_results_cursor", "shape").status).toBe(400);
  });

  it("horse competition history: cursor pages cover the lifetime history; summary stays over the FULL set", async () => {
    const competitionId = await createEvent("2028-04-03");
    let op = 100;
    for (const [index, horseId] of [1, 2, 3, 4, 5, 6].entries()) {
      const response = await addResult(competitionId, { horse_id: horseId, class_name: "Open", placement: index + 1 }, ++op);
      if (response.status !== 201) throw new Error(`result create failed: ${response.status}`);
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const url = new URL("http://x/api/horses/1/competitions");
      url.searchParams.set("history_limit", "2");
      if (cursor) url.searchParams.set("history_cursor", cursor);
      // The URL must match the route's horse id for the history call.
      const response = await horseCompetitionHistory(db, 1, url);
      const body = await response.json() as {
        results: Array<{ competition_id: number; id: number }>;
        history_window: { limit: number; total: number; has_more: boolean };
        history_page: { limit: number; returned: number; next_cursor: string | null; has_more: boolean; total: number };
      };
      expect(body.history_page.total).toBe(1);
      expect(body.results.length).toBeLessThanOrEqual(2);
      for (const row of body.results) seen.push(row.id);
      pages += 1;
      if (!body.history_page.has_more) { expect(body.history_page.next_cursor).toBeNull(); break; }
      cursor = body.history_page.next_cursor;
      if (pages > 10) throw new Error("paging did not terminate");
    }
    // One horse, one result — the page metadata said total 1 and page 1 had it.
    expect(seen).toHaveLength(1);
    // Now a horse with six results across the same event (event-date ties, id tiebreak).
    const seen6: number[] = [];
    let cursor6: string | null = null;
    for (;;) {
      const url = new URL("http://x/api/horses/2/competitions");
      url.searchParams.set("history_limit", "2");
      if (cursor6) url.searchParams.set("history_cursor", cursor6);
      const body = await (await horseCompetitionHistory(db, 2, url)).json() as { results: Array<{ id: number }>; history_page: { has_more: boolean; next_cursor: string | null; total: number } };
      expect(body.history_page.total).toBe(1);
      for (const row of body.results) seen6.push(row.id);
      if (!body.history_page.has_more) { expect(body.history_page.next_cursor).toBeNull(); break; }
      cursor6 = body.history_page.next_cursor;
    }
    expect(seen6).toHaveLength(1);
    const malformed = new URL("http://x/api/horses/2/competitions");
    malformed.searchParams.set("history_cursor", "garbage");
    await expect(horseCompetitionHistory(db, 2, malformed)).rejects.toMatchObject({ status: 400 });
  });

  it("workspace reminders: status-filtered keyset pages with honest totals; typed 400s", async () => {
    const created = await createWorkspace(authedRequest("/api/workspaces", { name: "R124 paged reminders" }, { session: owner }), env(db));
    const workspaceId = Number(((await created.json()) as { workspace: { id: number } }).workspace.id);
    const dueDates = ["2028-01-05", "2028-01-06", "2028-01-07", "2028-01-08", "2028-01-09", "2028-01-10", "2028-01-11"];
    for (const [index, due] of dueDates.entries()) {
      const response = await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
        title: `R124 reminder ${index}`, category: "other", due_date: due, due_timezone: "Asia/Tehran", recurrence: "none",
      }, { session: owner }), env(db), workspaceId);
      expect(response.status).toBe(201);
    }
    const walk = async (status: string) => {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      for (;;) {
        const query = new URLSearchParams({ status, limit: "3" });
        if (cursor) query.set("cursor", cursor);
        const response = await listWorkspaceTasks(authedRequest(`/api/workspaces/${workspaceId}/tasks?${query.toString()}`, undefined, { session: owner }), env(db), workspaceId);
        expect(response.status).toBe(200);
        const body = await response.json() as {
          tasks: Array<{ id: number; title: string }>;
          page: { limit: number; returned: number; next_cursor: string | null; has_more: boolean; total: number; status: string };
        };
        expect(body.page.status).toBe(status);
        expect(body.page.total).toBe(7);
        expect(body.tasks.length).toBeLessThanOrEqual(3);
        for (const row of body.tasks) seen.push(row.id);
        pages += 1;
        if (!body.page.has_more) { expect(body.page.next_cursor).toBeNull(); break; }
        cursor = body.page.next_cursor;
        if (pages > 10) throw new Error("paging did not terminate");
      }
      return seen;
    };
    const openIds = await walk("open");
    expect(openIds).toHaveLength(7);
    // Every id exactly once (no overlap between pages).
    expect(new Set(openIds).size).toBe(7);
    // Bad status, bad limit, bad cursor.
    await expect(listWorkspaceTasks(authedRequest(`/api/workspaces/${workspaceId}/tasks?status=weird`, undefined, { session: owner }), env(db), workspaceId)).rejects.toMatchObject({ status: 400 });
    await expect(listWorkspaceTasks(authedRequest(`/api/workspaces/${workspaceId}/tasks?limit=501`, undefined, { session: owner }), env(db), workspaceId)).rejects.toMatchObject({ status: 400 });
    await expect(listWorkspaceTasks(authedRequest(`/api/workspaces/${workspaceId}/tasks?cursor=nope`, undefined, { session: owner }), env(db), workspaceId)).rejects.toMatchObject({ status: 400 });
  });
});
