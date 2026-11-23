/**
 * R140-G — the racing surfaces: the single biggest sleeping asset of the
 * registry becomes visible. racing_races (12,924) + racing_results (122,063)
 * were merged from asbdavani.app (the federation's official racing system)
 * and sat unserved by any API until this module.
 *
 * Serving doctrine:
 *  - IDENTITY CROSSWALK ONLY: a result is attached to a registry horse through
 *    racing_results.registry_horse_id (= horses.id, 14,083 linked horses).
 *    Name-only matching is deliberately NOT implemented — two different
 *    horses can share a name, and a national registry must never guess.
 *  - Every response is provenance-stamped: source "asbdavani", trust level
 *    "imported_unverified" until an issuer attests the rows. The client
 *    proposal (§3/§8) asks exactly for this honesty.
 *  - Read-only: no endpoint here writes. The tables are import-owned.
 *
 * Dialect: plain SQLite-style SQL — the Supabase compatibility layer
 * translates it to PostgreSQL in production; local dev/tests run the stock
 * SQLite engine with the migration-0104 parity schema.
 */
import { HttpError, json } from "../http";
import type { D1Database } from "@cloudflare/workers-types";

export const RACING_DATA_SOURCE = "asbdavani";
export const RACING_TRUST_LEVEL = "imported_unverified";
export const RACING_IDENTITY_CROSSWALK_NOTE =
  "Results attach to registry horses by the federation racing system's identity crosswalk (registry_horse_id), never by name.";
export const RACING_MAX_PAGE_SIZE = 50;
export const RACING_DEFAULT_PAGE_SIZE = 12;
export const RACING_MAX_OFFSET = 100_000;
export const RACING_MAX_RESULTS_PER_RACE = 40;
export const RACING_MAX_RESULTS_PER_HORSE = 120;

function pageSize(value: string | null): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n) || n <= 0) return RACING_DEFAULT_PAGE_SIZE;
  return Math.min(RACING_MAX_PAGE_SIZE, Math.trunc(n));
}

function safeOffset(value: string | null): number {
  const n = Number(value ?? "");
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(RACING_MAX_OFFSET, Math.trunc(n));
}

const RACE_COLUMNS = "race_id, week_id, week_name, week_date, week_number, league_id, season, location, round_no, race_name, status, plan_id, plan_name, distance_m, age_class, blood, breed, condition_name, condition_type, prize_name, prizes, data_origin";

const RESULT_COLUMNS = "racehorse_id, race_id, week_id, week_date, season, location, round_no, plan_name, distance_m, number, rank, is_run, time_s, weight, carried_weight, tools_weight, entrance_rating, dl, registration_cost, owner_text, horse_id, horse_name, horse_sex, horse_birthdate, horse_starts, horse_p1, horse_p2, horse_p3, sire_id, sire_name, dam_id, dam_name, rider_id, rider_name, coach_id, coach_name, data_origin, registry_horse_id";

// An import crosswalk must not re-publish an unavailable registry subject.
// Source-only/unlinked entries remain source records and never match by name.
const VISIBLE_RESULT = `(rr.registry_horse_id IS NULL OR rr.registry_horse_id='' OR EXISTS(SELECT 1 FROM horses visible_horse WHERE CAST(visible_horse.id AS TEXT)=rr.registry_horse_id AND visible_horse.deleted_at IS NULL AND visible_horse.is_active=1))`;

function raceProvenance() {
  return { source: RACING_DATA_SOURCE, trust_level: RACING_TRUST_LEVEL, identity_crosswalk: RACING_IDENTITY_CROSSWALK_NOTE };
}

/** GET /api/horses/:id/racing — one horse's served racing history + honest summary. */
export async function horseRacing(db: D1Database, horseId: number): Promise<Response> {
  const [horseResult, summaryResult, rowsResult] = await db.batch([
    db.prepare("SELECT id,name_latin,name_native FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(horseId),
    db.prepare(`
      SELECT COUNT(*) AS entries,
             SUM(CASE WHEN is_run=1 THEN 1 ELSE 0 END) AS starts,
             SUM(CASE WHEN is_run=0 THEN 1 ELSE 0 END) AS non_runners,
             SUM(CASE WHEN is_run IS NULL OR is_run NOT IN (0,1) THEN 1 ELSE 0 END) AS unknown_run_status,
             SUM(CASE WHEN is_run=1 AND rank=1 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN is_run=1 AND rank=2 THEN 1 ELSE 0 END) AS second_places,
             SUM(CASE WHEN is_run=1 AND rank=3 THEN 1 ELSE 0 END) AS third_places,
             MIN(CASE WHEN is_run=1 THEN week_date ELSE NULL END) AS first_race_date,
             MAX(CASE WHEN is_run=1 THEN week_date ELSE NULL END) AS last_race_date,
             COUNT(DISTINCT CASE WHEN is_run=1 THEN season ELSE NULL END) AS seasons_count
      FROM racing_results WHERE registry_horse_id=?
    `).bind(String(horseId)),
    db.prepare(`
      SELECT ${RESULT_COLUMNS}
      FROM racing_results WHERE registry_horse_id=?
      ORDER BY week_date DESC, race_id DESC, rank ASC
      LIMIT ${RACING_MAX_RESULTS_PER_HORSE}
    `).bind(String(horseId)),
  ]);
  const horse = horseResult.results?.[0];
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  const summary = (summaryResult.results?.[0] ?? {}) as Record<string, unknown>;
  return json({
    horse,
    summary: {
      entries: Number(summary.entries ?? 0),
      starts: Number(summary.starts ?? 0),
      non_runners: Number(summary.non_runners ?? 0),
      unknown_run_status: Number(summary.unknown_run_status ?? 0),
      wins: Number(summary.wins ?? 0),
      second_places: Number(summary.second_places ?? 0),
      third_places: Number(summary.third_places ?? 0),
      first_race_date: (summary.first_race_date as string | null) ?? null,
      last_race_date: (summary.last_race_date as string | null) ?? null,
      seasons_count: Number(summary.seasons_count ?? 0),
    },
    results: rowsResult.results ?? [],
    provenance: raceProvenance(),
  });
}

/** GET /api/racing/races — race-card browse (offset pagination, like competitions). */
export async function racesList(db: D1Database, url: URL): Promise<Response> {
  const limit = pageSize(url.searchParams.get("limit"));
  const offset = safeOffset(url.searchParams.get("offset"));
  const season = (url.searchParams.get("season") ?? "").trim().slice(0, 40);
  const location = (url.searchParams.get("location") ?? "").trim().slice(0, 120);
  const weekId = (url.searchParams.get("week_id") ?? "").trim().slice(0, 64);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (season) { where.push("season=?"); binds.push(season); }
  if (location) { where.push("location=?"); binds.push(location); }
  if (weekId) { where.push("week_id=?"); binds.push(weekId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [countResult, rowsResult] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM racing_races ${whereSql}`).bind(...binds),
    db.prepare(`
      SELECT ${RACE_COLUMNS},
        (SELECT COUNT(*) FROM racing_results rr WHERE rr.race_id=racing_races.race_id AND ${VISIBLE_RESULT}) AS entries_count,
        (SELECT COUNT(*) FROM racing_results rr WHERE rr.race_id=racing_races.race_id AND rr.is_run=1 AND ${VISIBLE_RESULT}) AS starters_count,
        (SELECT COUNT(*) FROM racing_results rr WHERE rr.race_id=racing_races.race_id AND rr.is_run=1 AND rr.rank=1 AND ${VISIBLE_RESULT}) AS decided_count
      FROM racing_races ${whereSql}
      ORDER BY week_date DESC, race_id ASC LIMIT ${limit} OFFSET ${offset}
    `).bind(...binds),
  ]);
  return json({
    total: Number((countResult.results?.[0] as { total?: number } | undefined)?.total ?? 0),
    limit,
    offset,
    races: rowsResult.results ?? [],
    provenance: raceProvenance(),
  });
}

/** GET /api/racing/races/:raceId — the race card with its ordered results. */
export async function raceDetail(db: D1Database, raceId: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(raceId)) throw new HttpError(400, "invalid_race_id", "The race id has an unexpected shape");
  const [raceResult, rowsResult] = await db.batch([
    db.prepare(`SELECT ${RACE_COLUMNS} FROM racing_races WHERE race_id=?`).bind(raceId),
    db.prepare(`
      SELECT ${RESULT_COLUMNS}
      FROM racing_results rr WHERE race_id=? AND ${VISIBLE_RESULT}
      ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END ASC, rank ASC, number ASC
      LIMIT ${RACING_MAX_RESULTS_PER_RACE}
    `).bind(raceId),
  ]);
  const race = raceResult.results?.[0];
  if (!race) throw new HttpError(404, "not_found", "Race not found");
  return json({ race, results: rowsResult.results ?? [], provenance: raceProvenance() });
}
