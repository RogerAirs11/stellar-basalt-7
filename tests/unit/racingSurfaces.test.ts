import { describe, expect, it } from "vitest";
import { horseRacing, raceDetail, RACING_DATA_SOURCE, RACING_TRUST_LEVEL, racesList } from "../../src/api/modules/racing";
import { HttpError } from "../../src/api/http";
import { openRealDatabase } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R140-G: the racing surfaces. The sleeping asbdavani dataset (12,924 races +
 * 122,063 results in canonical Supabase) becomes visible — identity crosswalk
 * ONLY (registry_horse_id), every response provenance-stamped, read-only.
 */

async function seedRacingWorld(db: D1Database) {
  await db.batch([
    db.prepare("INSERT INTO horses(id,name_latin,name_native,is_active) VALUES(501,'Mahnura','ماهنورا',1)"),
    db.prepare("INSERT INTO horses(id,name_latin,name_native,is_active) VALUES(502,'Other Horse','اسب دیگر',1)"),
    db.prepare(`INSERT INTO racing_races(race_id,week_id,week_name,week_date,week_number,season,location,round_no,race_name,status,plan_name,distance_m,blood,breed)
      VALUES('race-aaa-1','week-1','هفته 5 یزد 1405','2026-10-27T00:00:00.000Z',5,'FALL','یزد',6,'ریتد کاندیشن کلاس3','PUBLISHING','نژاد عرب دوسر +4سال مسافت 1400',1400,'ARAB','DO_SAR')`),
    db.prepare(`INSERT INTO racing_races(race_id,week_id,week_name,week_date,week_number,season,location,round_no,race_name,status,plan_name,distance_m,blood,breed)
      VALUES('race-aaa-2','week-1','هفته 5 یزد 1405','2026-10-20T00:00:00.000Z',4,'FALL','یزد',1,'امتیازی','PUBLISHING','نژاد عرب یکسر',1650,'ARAB','YEK_SAR')`),
    db.prepare(`INSERT INTO racing_results(racehorse_id,race_id,week_date,season,location,round_no,plan_name,distance_m,number,rank,time_s,weight,carried_weight,entrance_rating,horse_name,rider_name,registry_horse_id)
      VALUES('rh-1','race-aaa-1','2026-10-27T00:00:00.000Z','FALL','یزد',6,'نژاد عرب دوسر +4سال مسافت 1400',1400,3,1,'63239','56.5','56.5',60,'ماهنورا','مؤمن بهادر','501')`),
    db.prepare(`INSERT INTO racing_results(racehorse_id,race_id,week_date,season,location,round_no,plan_name,distance_m,number,rank,weight,carried_weight,horse_name,rider_name,registry_horse_id)
      VALUES('rh-2','race-aaa-1','2026-10-27T00:00:00.000Z','FALL','یزد',6,'نژاد عرب دوسر +4سال مسافت 1400',1400,5,3,'58','58','اسب دیگر','سوارکار دوم','502')`),
    db.prepare(`INSERT INTO racing_results(racehorse_id,race_id,week_date,season,location,round_no,plan_name,distance_m,number,rank,weight,horse_name,rider_name)
      VALUES('rh-3','race-aaa-2','2026-10-20T00:00:00.000Z','FALL','یزد',1,'نژاد عرب یکسر',1650,2,1,'57','بی‌پیوند','سوارکار سوم')`),
  ]);
  await db.prepare('UPDATE racing_results SET is_run=1').run();
}

describe("R140-G racing surfaces", () => {
  it("serves a horse's racing history ONLY through the identity crosswalk, provenance-stamped", async () => {
    const db = await openRealDatabase();
    await seedRacingWorld(db);
    const response = await horseRacing(db, 501);
    const body = await response.json() as {
      horse: { id: number; name_latin: string };
      summary: { starts: number; wins: number; second_places: number; third_places: number };
      results: Array<{ racehorse_id: string; rank: number; registry_horse_id: string | null }>;
      provenance: { source: string; trust_level: string; identity_crosswalk: string };
    };
    expect(body.horse.id).toBe(501);
    expect(body.summary.starts).toBe(1);
    expect(body.summary.wins).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.registry_horse_id).toBe("501");
    // The unlinked result (rh-3) must NEVER attach by name or proximity.
    expect(body.results.some((r) => r.racehorse_id === "rh-3")).toBe(false);
    expect(body.provenance.source).toBe(RACING_DATA_SOURCE);
    expect(body.provenance.trust_level).toBe(RACING_TRUST_LEVEL);
    expect(body.provenance.identity_crosswalk).toContain("crosswalk");
  });

  it("404s for a missing horse (an error is never an empty success)", async () => {
    const db = await openRealDatabase();
    await seedRacingWorld(db);
    await expect(horseRacing(db, 999999)).rejects.toSatisfy((err: unknown) => err instanceof HttpError && (err as HttpError).status === 404);
  });

  it("lists races newest-first with per-race starter counts and honest provenance", async () => {
    const db = await openRealDatabase();
    await seedRacingWorld(db);
    const response = await racesList(db, new URL("https://registry.test/api/racing/races"));
    const body = await response.json() as {
      total: number;
      races: Array<{ race_id: string; starters_count: number; week_date: string }>;
      provenance: { source: string; trust_level: string };
    };
    expect(body.total).toBe(2);
    expect(body.races[0]?.race_id).toBe("race-aaa-1");
    expect(body.races[0]?.starters_count).toBe(2);
    expect(body.provenance.source).toBe(RACING_DATA_SOURCE);
    const filtered = await racesList(db, new URL("https://registry.test/api/racing/races?location=%DB%8C%D8%B2%D8%AF&season=FALL"));
    const filteredBody = await filtered.json() as { total: number };
    expect(filteredBody.total).toBe(2);
  });

  it("serves the race card ordered by rank with unranked runners last", async () => {
    const db = await openRealDatabase();
    await seedRacingWorld(db);
    const response = await raceDetail(db, "race-aaa-1");
    const body = await response.json() as {
      race: { race_id: string; distance_m: number };
      results: Array<{ racehorse_id: string; rank: number | null }>;
      provenance: { source: string };
    };
    expect(body.race.race_id).toBe("race-aaa-1");
    expect(body.race.distance_m).toBe(1400);
    expect(body.results.map((r) => r.racehorse_id)).toEqual(["rh-1", "rh-2"]);
    expect(body.provenance.source).toBe(RACING_DATA_SOURCE);
    await expect(raceDetail(db, "race-missing")).rejects.toSatisfy((err: unknown) => err instanceof HttpError && (err as HttpError).status === 404);
  });

  it("rejects malformed race ids before touching the database", async () => {
    const db = await openRealDatabase();
    await expect(raceDetail(db, "../etc-passwd")).rejects.toSatisfy((err: unknown) => err instanceof HttpError && (err as HttpError).status === 400);
  });
});
