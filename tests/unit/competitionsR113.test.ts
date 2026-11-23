import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { adminAddResults, adminCreateCompetition } from "../../src/api/modules/competitions";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

describe("R113 competition input consistency through actual handlers", () => {
  let db: D1Database;
  let session: AuthedSession;
  const event = { name_native: "R113 audit event", discipline: "show_jumping", event_date: "2028-02-29", venue: "Fictional audit arena", season: 1406 };
  const env = () => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });
  const create = (changes: Record<string, unknown> = {}) => adminCreateCompetition(authedRequest("/api/admin/competitions", { ...event, ...changes }, { session }), env());
  const result = (changes: Record<string, unknown> = {}) => adminAddResults(authedRequest("/api/admin/competitions/1/results", { results: [{ horse_id: 1, class_name: "Audit", ...changes }] }, { session }), env(), 1);
  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r113-competition-editor", "editor");
    session = await makeSession(db, "r113-competition-editor");
    await db.prepare("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic competition horse')").run();
  });
  it.each(["2026-02-29", "2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31"])("refuses the impossible event date %s", async date => {
    await expect(create({ event_date: date })).rejects.toMatchObject({ status: 400, code: "invalid_competition" });
    expect(await db.prepare("SELECT COUNT(*) n FROM competitions").first("n")).toBe(0);
  });
  it("refuses an impossible end day and a reversed range", async () => {
    await expect(create({ end_date: "2028-02-30" })).rejects.toMatchObject({ status: 400 });
    await expect(create({ end_date: "2028-02-28" })).rejects.toMatchObject({ status: 400 });
    expect(await db.prepare("SELECT COUNT(*) n FROM competitions").first("n")).toBe(0);
  });
  it("accepts a leap day, same-day end, and absent end", async () => {
    expect((await create({ end_date: "2028-02-29" })).status).toBe(201);
    expect((await create()).status).toBe(201);
  });
  it.each([
    { is_eliminated: true, is_withdrawn: true },
    { is_eliminated: true, placement: 1 },
    { is_withdrawn: true, placement: 2 },
  ])("refuses inconsistent result flags %j", async flags => {
    await create();
    await expect(result(flags)).rejects.toMatchObject({ status: 400, code: "invalid_results" });
    expect(await db.prepare("SELECT COUNT(*) n FROM competition_results").first("n")).toBe(0);
  });
  it("accepts unplaced elimination/withdrawal and replays an identical placed result without duplicates", async () => {
    await create();
    // R114-02: the legacy batch endpoint is CREATE-ONLY. Distinct natural keys
    // (separate classes) still create normally...
    expect((await result({ class_name: "Audit-EL", is_eliminated: true, placement_text: "EL" })).status).toBe(201);
    expect((await result({ class_name: "Audit-WD", is_withdrawn: true, placement_text: "WD" })).status).toBe(201);
    expect((await result({ placement: 2, score: "4 faults" })).status).toBe(201);
    // ...an identical natural-key + content replay is an idempotent no-op...
    expect((await result({ placement: 2, score: "4 faults" })).status).toBe(200);
    // ...and the R113 silent upsert (same key, different content) now refuses.
    await expect(result({ placement: 1 })).rejects.toMatchObject({ status: 409, code: "result_conflict" });
    expect(await db.prepare("SELECT COUNT(*) n FROM competition_results").first("n")).toBe(3);
    expect(await db.prepare("SELECT placement,is_eliminated,is_withdrawn FROM competition_results WHERE class_name='Audit'").first()).toEqual({ placement: 2, is_eliminated: 0, is_withdrawn: 0 });
  });
});
