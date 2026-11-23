import { z } from "zod";
import { COMPETITION_DISCIPLINES } from "../../contracts/platform";
import { parseBoundedIntegerParam } from "../../registry/query";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf, requirePermission } from "../../auth/guards";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { isValidDay } from "../../workspaces/domain";

// Competition records (client requirement: سوابق مسابقات).
// Reads are public; writes are federation-staff only. Every row carries a
// provenance column so demo-seeded events are always distinguishable from
// federation-entered results.
//
// R114-02 (Master AI R113 handoff, NEXT_BACKEND.md D18): versioned event and
// result editing. The legacy batch endpoint POST /api/admin/competitions/:id/results
// is now CREATE-ONLY: an identical natural-key replay is an idempotent no-op,
// and a would-overwrite submission is refused with the current row version so
// the editor can compare and move to the versioned update route. All edits go
// through the new versioned commands, which require the exact expected row
// version, write one immutable receipt per caller operation key, and recheck
// editorial authority inside the mutation itself.

export const DISCIPLINES = COMPETITION_DISCIPLINES;
export const TIERS = ["local", "regional", "national", "international"] as const;

const CompetitionInputSchema = z.object({
  name_native: z.string().trim().min(2).max(220),
  name_latin: z.string().trim().max(220).nullable().optional(),
  discipline: z.enum(DISCIPLINES),
  event_date: z.string().refine(isValidDay, "event_date must be a real Gregorian day (YYYY-MM-DD)"),
  end_date: z.string().refine(isValidDay, "end_date must be a real Gregorian day (YYYY-MM-DD)").nullable().optional(),
  venue: z.string().trim().min(1).max(220),
  city: z.string().trim().max(120).nullable().optional(),
  organizer: z.string().trim().max(220).nullable().optional(),
  tier: z.enum(TIERS).default("regional"),
  season: z.number().int().min(1380).max(1500),
  notes: z.string().trim().max(4000).nullable().optional(),
  provenance: z.enum(["demo", "federation", "user"]).default("user"),
}).refine(event => event.end_date == null || event.end_date >= event.event_date,
  { message: "end_date cannot be earlier than event_date", path: ["end_date"] });

const ResultInputSchema = z.object({
  horse_id: z.number().int().positive(),
  rider_name: z.string().trim().max(200).nullable().optional(),
  rider_club: z.string().trim().max(200).nullable().optional(),
  class_name: z.string().trim().max(200).nullable().optional(),
  placement: z.number().int().min(1).max(999).nullable().optional(),
  placement_text: z.string().trim().max(120).nullable().optional(),
  score: z.string().trim().max(120).nullable().optional(),
  is_eliminated: z.boolean().optional(),
  is_withdrawn: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).superRefine((result, context) => {
  if (result.is_eliminated && result.is_withdrawn) {
    context.addIssue({ code: "custom", message: "A result cannot be both eliminated and withdrawn", path: ["is_withdrawn"] });
  }
  if ((result.is_eliminated || result.is_withdrawn) && result.placement != null) {
    context.addIssue({ code: "custom", message: "An eliminated or withdrawn result cannot have a numeric placing", path: ["placement"] });
  }
});

const ResultsBatchSchema = z.object({
  results: z.array(ResultInputSchema).min(1).max(20),
});

const OperationKeySchema = z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/, "operation_id must be an opaque caller-generated key (letters, digits, dot, colon, dash, underscore)");

const VersionedResultCreateSchema = z.object({
  result: ResultInputSchema,
  operation_id: OperationKeySchema,
});

const VersionedResultUpdateSchema = z.object({
  expected_version: z.number().int().min(1),
  changes: z.object({
    rider_name: z.string().trim().max(200).nullable().optional(),
    rider_club: z.string().trim().max(200).nullable().optional(),
    class_name: z.string().trim().max(200).nullable().optional(),
    placement: z.number().int().min(1).max(999).nullable().optional(),
    placement_text: z.string().trim().max(120).nullable().optional(),
    score: z.string().trim().max(120).nullable().optional(),
    is_eliminated: z.boolean().optional(),
    is_withdrawn: z.boolean().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  }).strict(),
  operation_id: OperationKeySchema,
});

const VersionedEventUpdateSchema = z.object({
  expected_version: z.number().int().min(1),
  changes: z.object({
    name_native: z.string().trim().min(2).max(220).optional(),
    name_latin: z.string().trim().max(220).nullable().optional(),
    discipline: z.enum(DISCIPLINES).optional(),
    event_date: z.string().refine(isValidDay, "event_date must be a real Gregorian day (YYYY-MM-DD)").optional(),
    end_date: z.string().refine(isValidDay, "end_date must be a real Gregorian day (YYYY-MM-DD)").nullable().optional(),
    venue: z.string().trim().min(1).max(220).optional(),
    city: z.string().trim().max(120).nullable().optional(),
    organizer: z.string().trim().max(220).nullable().optional(),
    tier: z.enum(TIERS).optional(),
    season: z.number().int().min(1380).max(1500).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  }).strict().refine(changes => Object.keys(changes).length > 0, { message: "At least one field must change" }),
  operation_id: OperationKeySchema,
});

const COMPETITION_COLUMNS = "c.id,c.name_native,c.name_latin,c.discipline,c.event_date,c.end_date,c.venue,c.city,c.organizer,c.tier,c.season,c.provenance,c.row_version,c.image_url,c.image_credit,(SELECT COUNT(*) FROM competition_results r JOIN horses visible_horse ON visible_horse.id=r.horse_id AND visible_horse.deleted_at IS NULL AND visible_horse.is_active=1 WHERE r.competition_id=c.id) AS result_count" as const;

const RESULT_COLUMNS = "r.id,r.competition_id,r.horse_id,r.rider_name,r.rider_club,r.class_name,r.placement,r.placement_text,r.score,r.is_eliminated,r.is_withdrawn,r.notes,r.provenance,r.row_version,r.updated_at" as const;

/** Mirrors requirePermission("horse.edit") — exactly the roles that hold the
 * competition editorial capability in src/auth/capabilities.ts. Repeated
 * inside every guarded mutation so a demotion between the preflight check and
 * the committed write changes nothing. */
const EDITOR_AUTHORITY_SQL = "EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))";

/** Serialize the writer's transaction with the editor's demotion or
 * deactivation (same doctrine as PRIVACY_ADMIN_LOCK_SQL in privacyPolicy). */
const EDITOR_LOCK_SQL = "UPDATE users SET is_active=is_active WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin')";

/** Natural-key identity lookup. Deliberately keeps the existing null/empty
 * class_name collision semantics (IFNULL comparison) — no normalization. */
const RESULT_IDENTITY_SQL = "SELECT id,horse_id,class_name,rider_name,rider_club,placement,placement_text,score,is_eliminated,is_withdrawn,notes,row_version FROM competition_results WHERE competition_id=? AND horse_id=? AND IFNULL(class_name,'')=IFNULL(?,'')";

/** NULL-safe content equality between a submitted result and a stored row.
 * class_name participates: NULL and '' share one IDENTITY but are DIFFERENT
 * content, so a submitter moving between them must use the update route. */
const RESULT_CONTENT_EQUAL_SQL = "class_name IS ? AND rider_name IS ? AND rider_club IS ? AND placement IS ? AND placement_text IS ? AND score IS ? AND is_eliminated=? AND is_withdrawn=? AND notes IS ?";

interface CompetitionReceiptRow {
  id: string;
  actor_user_id: string;
  command: "result.create" | "result.update" | "event.update";
  competition_id: number;
  result_id: number | null;
  request_digest: string;
  status_code: 200 | 201;
  response_json: string;
  created_at: string;
}

const RECEIPT_COLUMNS = "id,actor_user_id,command,competition_id,result_id,request_digest,status_code,response_json,created_at" as const;

function receiptProjection(row: CompetitionReceiptRow): { operation_id: string; command: string; competition_id: number; result_id: number | null; status_code: number; created_at: string } {
  return { operation_id: row.id, command: row.command, competition_id: Number(row.competition_id), result_id: row.result_id === null ? null : Number(row.result_id), status_code: Number(row.status_code), created_at: row.created_at };
}

/** Local canonical JSON + digest (same shape as the marketplace helper; kept
 * local so the competitions module stays independently reviewable). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** A stored receipt under this key means either an exact retry (replay the
 * stored response) or a reused key with different content (refuse). */
async function resolveOperationKey(db: D1Database, scope: { operationId: string; actorId: string; command: CompetitionReceiptRow["command"]; competitionId: number; resultId: number | null; digest: string }): Promise<{ replayed: true; statusCode: number; body: Record<string, unknown> } | null> {
  const stored = await db.prepare(`SELECT ${RECEIPT_COLUMNS} FROM competition_command_receipts WHERE id=?`).bind(scope.operationId).first<CompetitionReceiptRow>();
  if (!stored) return null;
  // result.create receipts learn their result_id only from the created row,
  // so the replay scope cannot know it in advance: match it leniently for
  // creates and strictly (actor+command+target+digest) for every other command.
  const resultIdMatches = stored.command === "result.create"
    ? true
    : (stored.result_id === null ? scope.resultId === null : Number(stored.result_id) === scope.resultId);
  const matches = stored.actor_user_id === scope.actorId && stored.command === scope.command
    && Number(stored.competition_id) === scope.competitionId
    && resultIdMatches
    && stored.request_digest === scope.digest;
  if (!matches) {
    throw new HttpError(409, "idempotency_conflict", "This operation_id was already used for a different competition command");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(stored.response_json) as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "idempotency_receipt_corrupt", "The stored competition command receipt could not be decoded");
  }
  return { replayed: true, statusCode: Number(stored.status_code), body: { ...body, replayed: true, receipt: receiptProjection(stored) } };
}

function isReceiptPrimaryKeyConflict(cause: unknown): boolean {
  const error = cause as { message?: string; constraint?: string; cause?: { message?: string; constraint?: string } } | null;
  const message = [error?.message, error?.constraint, error?.cause?.message, error?.cause?.constraint].filter(Boolean).join(" ");
  return /competition_command_receipts/i.test(message) && /UNIQUE constraint failed|duplicate key|PRIMARY KEY/i.test(message);
}

interface ResultRow {
  id: number;
  horse_id: number;
  class_name: string | null;
  rider_name: string | null;
  rider_club: string | null;
  placement: number | null;
  placement_text: string | null;
  score: string | null;
  is_eliminated: number;
  is_withdrawn: number;
  notes: string | null;
  row_version: number;
}

function resultProjection(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    competition_id: Number(row.competition_id),
    horse_id: Number(row.horse_id),
    rider_name: row.rider_name ?? null,
    rider_club: row.rider_club ?? null,
    class_name: row.class_name ?? null,
    placement: row.placement === null || row.placement === undefined ? null : Number(row.placement),
    placement_text: row.placement_text ?? null,
    score: row.score ?? null,
    is_eliminated: Number(row.is_eliminated ?? 0),
    is_withdrawn: Number(row.is_withdrawn ?? 0),
    notes: row.notes ?? null,
    provenance: row.provenance ?? "user",
    row_version: Number(row.row_version ?? 1),
    updated_at: row.updated_at ?? null,
  };
}

/** All inputs are normalized before this call (schema-parsed). */
function resultContentBinds(r: { class_name?: string | null; rider_name?: string | null; rider_club?: string | null; placement?: number | null; placement_text?: string | null; score?: string | null; is_eliminated?: boolean; is_withdrawn?: boolean; notes?: string | null }): unknown[] {
  return [
    r.class_name ?? null,
    r.rider_name ?? null,
    r.rider_club ?? null,
    r.placement ?? null,
    r.placement_text ?? null,
    r.score ?? null,
    r.is_eliminated ? 1 : 0,
    r.is_withdrawn ? 1 : 0,
    r.notes ?? null,
  ];
}

export async function listCompetitions(db: D1Database, url: URL): Promise<Response> {
  const limit = parseBoundedIntegerParam(url.searchParams.get("limit"), 20, 1, 100, "limit");
  const offset = parseBoundedIntegerParam(url.searchParams.get("offset"), 0, 0, 100_000, "offset");
  const where: string[] = [];
  const binds: unknown[] = [];
  const discipline = url.searchParams.get("discipline");
  if (discipline) {
    if (!(DISCIPLINES as readonly string[]).includes(discipline)) throw new HttpError(400, "invalid_discipline", "Unknown discipline");
    where.push("c.discipline=?"); binds.push(discipline);
  }
  const season = url.searchParams.get("season");
  if (season && /^\d{4}$/.test(season)) { where.push("c.season=?"); binds.push(Number(season)); }
  const tier = url.searchParams.get("tier");
  if (tier) {
    if (!(TIERS as readonly string[]).includes(tier)) throw new HttpError(400, "invalid_tier", "Unknown tier");
    where.push("c.tier=?"); binds.push(tier);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total] = await db.batch([
    db.prepare(`SELECT ${COMPETITION_COLUMNS} FROM competitions c ${whereSql} ORDER BY c.event_date DESC, c.id DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM competitions c ${whereSql}`).bind(...binds),
  ]);
  return json({ rows: rows.results ?? [], total: Number((total.results?.[0] as { n?: number } | undefined)?.n ?? 0), limit, offset });
}

export async function competitionDetail(db: D1Database, id: number, url?: URL): Promise<Response> {
  const competition = await db.prepare(`SELECT ${COMPETITION_COLUMNS} FROM competitions c WHERE c.id=?`).bind(id).first();
  if (!competition) throw new HttpError(404, "not_found", "Competition not found");
  // R114-02: bounded-history semantics — the 500-row window is now explicit,
  // with the true total so a UI never presents the window as the whole event.
  // R124 (master AI R122-T05): the window is now WALKABLE — keyset paging on
  // (placement-rank, id). ?results_cursor=<placement>|<id> resumes strictly
  // AFTER that row (placement omitted = null = rank 999999), so every row is
  // reachable without offset drift. The default single page stays 500 and the
  // legacy results_window shape is preserved for existing consumers.
  const resultsLimit = url ? parseBoundedIntegerParam(url.searchParams.get("results_limit"), 500, 1, 500, "results_limit") : 500;
  const cursorRaw = url?.searchParams.get("results_cursor") ?? null;
  let cursorPlacement: number | null = null;
  let cursorId: number | null = null;
  if (cursorRaw) {
    const match = /^(\d*)\|(\d+)$/.exec(cursorRaw);
    if (!match) throw new HttpError(400, "invalid_results_cursor", "results_cursor must be '<placement>|<id>' from results_page.next_cursor");
    cursorPlacement = match[1] === "" ? null : Number(match[1]);
    if (cursorPlacement !== null && (cursorPlacement < 1 || cursorPlacement > 999998)) throw new HttpError(400, "invalid_results_cursor", "results_cursor placement is out of range");
    cursorId = Number(match[2]);
    if (cursorId < 1) throw new HttpError(400, "invalid_results_cursor", "results_cursor id is out of range");
  }
  const rankSql = "COALESCE(r.placement, 999999)";
  const cursorSql = cursorId != null ? `AND (${rankSql} > ? OR (${rankSql} = ? AND r.id > ?))` : "";
  const cursorBinds: unknown[] = cursorId != null ? [cursorPlacement ?? 999999, cursorPlacement ?? 999999, cursorId] : [];
  const [results, totals] = await db.batch([
    db.prepare(`
      SELECT ${RESULT_COLUMNS},
             h.name_latin,h.name_native,h.breed_desc,h.sex_desc,h.birth_year,h.color_desc
      FROM competition_results r JOIN horses h ON h.id=r.horse_id AND h.deleted_at IS NULL AND h.is_active=1
      WHERE r.competition_id=? ${cursorSql}
      ORDER BY COALESCE(r.placement, 999999), r.id ASC
      LIMIT ?
    `).bind(id, ...cursorBinds, resultsLimit + 1),
    db.prepare("SELECT COUNT(*) AS n FROM competition_results r JOIN horses h ON h.id=r.horse_id AND h.deleted_at IS NULL AND h.is_active=1 WHERE r.competition_id=?").bind(id),
  ]);
  const pageRows = (results.results ?? []) as Array<{ id: number; placement: number | null; [key: string]: unknown }>;
  const hasMore = pageRows.length > resultsLimit;
  const page = hasMore ? pageRows.slice(0, resultsLimit) : pageRows;
  const total = Number((totals.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? `${lastRow.placement ?? ""}|${lastRow.id}` : null;
  return json({
    competition,
    results: page,
    results_window: { limit: 500, total, has_more: total > 500 },
    results_page: { limit: resultsLimit, returned: page.length, next_cursor: nextCursor, has_more: hasMore, total },
  });
}

export async function horseCompetitionHistory(db: D1Database, horseId: number, url?: URL): Promise<Response> {
  // R132 PERFORMANCE: the horse existence lookup used to run before the
  // history batch — two sequential Hyperdrive round trips (~2.4s measured).
  // All three statements are pre-bound, so one ordered batch preserves the
  // exact D1 semantics at a single round trip.
  const historyLimit = url ? parseBoundedIntegerParam(url.searchParams.get("history_limit"), 200, 1, 500, "history_limit") : 200;
  const cursorRaw = url?.searchParams.get("history_cursor") ?? null;
  let cursorDate: string | null = null;
  let cursorId: number | null = null;
  if (cursorRaw) {
    const match = /^(\d{4}-\d{2}-\d{2})\|(\d+)$/.exec(cursorRaw);
    if (!match) throw new HttpError(400, "invalid_history_cursor", "history_cursor must be '<event_date>|<id>' from history_page.next_cursor");
    cursorDate = match[1];
    cursorId = Number(match[2]);
    if (cursorId < 1) throw new HttpError(400, "invalid_history_cursor", "history_cursor id is out of range");
  }
  const cursorSql = cursorId != null ? "AND (c.event_date < ? OR (c.event_date = ? AND c.id < ?))" : "";
  const cursorBinds: unknown[] = cursorId != null ? [cursorDate, cursorDate, cursorId] : [];
  const [horseResult, rows, aggregate] = await db.batch([
    db.prepare("SELECT id,name_latin,name_native FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(horseId),
    db.prepare(`
      SELECT r.id,r.competition_id,r.rider_name,r.rider_club,r.class_name,r.placement,r.placement_text,r.score,
             r.is_eliminated,r.is_withdrawn,r.provenance,r.row_version,
             c.name_native AS competition_name,c.discipline,c.event_date,c.venue,c.city,c.tier,c.season
      FROM competition_results r JOIN competitions c ON c.id=r.competition_id
      WHERE r.horse_id=? ${cursorSql}
      ORDER BY c.event_date DESC, c.id DESC
      LIMIT ?
    `).bind(horseId, ...cursorBinds, historyLimit + 1),
    db.prepare(`
      SELECT COUNT(*) AS entries,
             COALESCE(SUM(CASE WHEN r.is_withdrawn=0 THEN 1 ELSE 0 END),0) AS starts,
             COALESCE(SUM(CASE WHEN r.is_withdrawn=1 THEN 1 ELSE 0 END),0) AS withdrawals,
             COALESCE(SUM(CASE WHEN r.placement=1 AND r.is_withdrawn=0 AND r.is_eliminated=0 THEN 1 ELSE 0 END),0) AS wins,
             COALESCE(SUM(CASE WHEN r.placement IS NOT NULL AND r.placement<=3 AND r.is_withdrawn=0 AND r.is_eliminated=0 THEN 1 ELSE 0 END),0) AS podium,
             COALESCE(SUM(CASE WHEN r.is_eliminated=1 THEN 1 ELSE 0 END),0) AS eliminations
      FROM competition_results r WHERE r.horse_id=?
    `).bind(horseId),
  ]);
  const horse = horseResult.results?.[0];
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  const pageRows = (rows.results ?? []) as Array<{ id: number; event_date: string | null; [key: string]: unknown }>;
  const hasMore = pageRows.length > historyLimit;
  const page = hasMore ? pageRows.slice(0, historyLimit) : pageRows;
  const agg = (aggregate.results?.[0] ?? {}) as { entries?:number|string;withdrawals?:number|string;starts?: number | string; wins?: number | string; podium?: number | string; eliminations?: number | string };
  const total = Number(agg.entries ?? agg.starts ?? 0);
  const summary = {
    entries: total,
    starts: Number(agg.starts ?? 0),
    withdrawals: Number(agg.withdrawals ?? 0),
    wins: Number(agg.wins ?? 0),
    podium: Number(agg.podium ?? 0),
    eliminations: Number(agg.eliminations ?? 0),
  };
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? `${String(lastRow.event_date ?? "").slice(0, 10)}|${lastRow.id}` : null;
  return json({
    horse,
    summary,
    results: page,
    history_window: { limit: 200, total, has_more: total > 200 },
    history_page: { limit: historyLimit, returned: page.length, next_cursor: nextCursor, has_more: hasMore, total },
  });
}

export async function adminCreateCompetition(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = CompetitionInputSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_competition", "Competition data failed validation", parsed.error.flatten());
  const d = parsed.data;
  const [insert] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO competitions(name_native,name_latin,discipline,event_date,end_date,venue,city,organizer,tier,season,notes,provenance)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(d.name_native, d.name_latin ?? null, d.discipline, d.event_date, d.end_date ?? null, d.venue, d.city ?? null, d.organizer ?? null, d.tier, d.season, d.notes ?? null, d.provenance),
  ]);
  const id = Number(insert?.meta.last_row_id ?? 0);
  const competition = await env.DB.prepare(`SELECT ${COMPETITION_COLUMNS} FROM competitions c WHERE c.id=?`).bind(id).first();
  return json({ competition }, { status: 201 });
}

/**
 * R114-02: the legacy batch endpoint is CREATE-ONLY.
 *
 * - An exact natural-key + content replay is an idempotent no-op (reported
 *   under `existing`, no version bump, no audit, no receipt).
 * - A natural-key collision with DIFFERENT content is refused with 409
 *   result_conflict listing the current row id and row_version — the editor
 *   must compare and move to POST .../results/:resultId/version.
 * - Only rows that do not exist yet are inserted; a partially-colliding batch
 *   is refused atomically (nothing is applied).
 */
export async function adminAddResults(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, competitionId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = ResultsBatchSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_results", "Results failed validation", parsed.error.flatten());
  const competition = await env.DB.prepare("SELECT id FROM competitions WHERE id=?").bind(competitionId).first();
  if (!competition) throw new HttpError(404, "not_found", "Competition not found");
  const ids = [...new Set(parsed.data.results.map((r) => r.horse_id))];
  const horses = await env.DB.prepare(`SELECT id FROM horses WHERE deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: number }>();
  const knownIds = new Set((horses.results ?? []).map((h) => Number(h.id)));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length) throw new HttpError(400, "unknown_horse", "One or more horses do not exist", { horseIds: missing });

  // Pre-read every submitted natural key in one query (IFNULL identity —
  // null and empty class names collide exactly as the table's upsert did).
  const existingRows = await env.DB.prepare(`
    SELECT id,horse_id,class_name,rider_name,rider_club,placement,placement_text,score,is_eliminated,is_withdrawn,notes,row_version
    FROM competition_results
    WHERE competition_id=? AND horse_id IN (${ids.map(() => "?").join(",")})
  `).bind(competitionId, ...ids).all<ResultRow>();
  const existingByIdentity = new Map<string, ResultRow>();
  for (const row of existingRows.results ?? []) {
    existingByIdentity.set(`${Number(row.horse_id)}|${row.class_name === null ? "" : String(row.class_name)}`, row);
  }

  const conflicts: Array<{ horse_id: number; class_name: string | null; existing_id: number; existing_row_version: number }> = [];
  const toCreate: typeof parsed.data.results = [];
  let existingCount = 0;
  for (const r of parsed.data.results) {
    const key = `${r.horse_id}|${r.class_name ?? ""}`;
    const existing = existingByIdentity.get(key);
    if (!existing) { toCreate.push(r); continue; }
    const identical = (existing.class_name ?? null) === (r.class_name ?? null)
      && (existing.rider_name ?? null) === (r.rider_name ?? null)
      && (existing.rider_club ?? null) === (r.rider_club ?? null)
      && (existing.placement ?? null) === (r.placement ?? null)
      && (existing.placement_text ?? null) === (r.placement_text ?? null)
      && (existing.score ?? null) === (r.score ?? null)
      && Number(existing.is_eliminated) === (r.is_eliminated ? 1 : 0)
      && Number(existing.is_withdrawn) === (r.is_withdrawn ? 1 : 0)
      && (existing.notes ?? null) === (r.notes ?? null);
    if (identical) { existingCount += 1; continue; }
    conflicts.push({ horse_id: r.horse_id, class_name: r.class_name ?? null, existing_id: Number(existing.id), existing_row_version: Number(existing.row_version) });
  }
  if (conflicts.length) {
    throw new HttpError(409, "result_conflict",
      "One or more results already exist with different content. This endpoint no longer overwrites; use the versioned update route POST /api/admin/competitions/:id/results/:resultId/version with the current row_version.",
      { conflicts, competition_id: competitionId });
  }

  const statements: D1PreparedStatement[] = [];
  for (const r of toCreate) {
    statements.push(env.DB.prepare(`
      INSERT INTO competition_results(competition_id,horse_id,rider_name,rider_club,class_name,placement,placement_text,score,is_eliminated,is_withdrawn,notes,provenance)
      VALUES(?,?,?,?,?,?,?,?,?,?,?, 'user')
    `).bind(competitionId, r.horse_id, r.rider_name ?? null, r.rider_club ?? null, r.class_name ?? null, r.placement ?? null, r.placement_text ?? null, r.score ?? null, r.is_eliminated ? 1 : 0, r.is_withdrawn ? 1 : 0, r.notes ?? null));
  }
  let created: Array<Record<string, unknown>> = [];
  if (statements.length) {
    try {
      await env.DB.batch(statements);
    } catch (cause) {
      // A concurrent writer inserted a colliding natural key between the
      // pre-read and this batch. The batch is atomic (nothing applied):
      // re-classify against the now-committed rows instead of surfacing a
      // raw constraint error.
      const message = String((cause as { message?: string })?.message ?? "");
      if (!/UNIQUE constraint failed|duplicate key/i.test(message)) throw cause;
      const raced = await env.DB.prepare(`
        SELECT id,horse_id,class_name,rider_name,rider_club,placement,placement_text,score,is_eliminated,is_withdrawn,notes,row_version
        FROM competition_results
        WHERE competition_id=? AND horse_id IN (${ids.map(() => "?").join(",")})
      `).bind(competitionId, ...ids).all<ResultRow>();
      const racedByIdentity = new Map<string, ResultRow>();
      for (const row of raced.results ?? []) {
        racedByIdentity.set(`${Number(row.horse_id)}|${row.class_name === null ? "" : String(row.class_name)}`, row);
      }
      const raceConflicts: Array<{ horse_id: number; class_name: string | null; existing_id: number; existing_row_version: number }> = [];
      for (const r of toCreate) {
        const existing = racedByIdentity.get(`${r.horse_id}|${r.class_name ?? ""}`);
        if (!existing) continue;
        const identical = (existing.class_name ?? null) === (r.class_name ?? null)
          && (existing.rider_name ?? null) === (r.rider_name ?? null)
          && (existing.rider_club ?? null) === (r.rider_club ?? null)
          && (existing.placement ?? null) === (r.placement ?? null)
          && (existing.placement_text ?? null) === (r.placement_text ?? null)
          && (existing.score ?? null) === (r.score ?? null)
          && Number(existing.is_eliminated) === (r.is_eliminated ? 1 : 0)
          && Number(existing.is_withdrawn) === (r.is_withdrawn ? 1 : 0)
          && (existing.notes ?? null) === (r.notes ?? null);
        if (!identical) {
          raceConflicts.push({ horse_id: r.horse_id, class_name: r.class_name ?? null, existing_id: Number(existing.id), existing_row_version: Number(existing.row_version) });
        }
      }
      if (raceConflicts.length) {
        throw new HttpError(409, "result_conflict",
          "One or more results were created concurrently with different content. This endpoint never overwrites; use the versioned update route with the current row_version.",
          { conflicts: raceConflicts, competition_id: competitionId });
      }
      throw new HttpError(409, "result_conflict",
        "A concurrent writer committed these natural keys first with identical content. Nothing was applied by this request; retrying is safe.",
        { competition_id: competitionId });
    }
    const fresh = await env.DB.prepare(`
      SELECT ${RESULT_COLUMNS} FROM competition_results r WHERE r.competition_id=? ORDER BY r.id DESC LIMIT ?
    `).bind(competitionId, statements.length).all();
    created = (fresh.results ?? []) as Array<Record<string, unknown>>;
  }
  return json({
    applied: created.length,
    existing: existingCount,
    results: created.map(resultProjection),
    note: existingCount
      ? "Created new results; identical natural-key replays were idempotent no-ops (no overwrite, no version change). Different content under an existing key must go through the versioned update route."
      : "Created new results.",
  }, { status: created.length > 0 ? 201 : 200 });
}

/**
 * R114-02: versioned single-result create with a caller operation key.
 * One result, one immutable receipt, one audit — an exact same-key retry
 * replays the stored response; a reused key with different content refuses;
 * an identical natural-key + content create with a NEW key reports the
 * existing row (created:false) without a second audit.
 */
export async function adminCreateResultVersioned(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, competitionId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = VersionedResultCreateSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_result_command", "The versioned create command failed validation", parsed.error.flatten());
  const { result, operation_id: operationId } = parsed.data;
  const digest = await sha256Hex(canonicalJson({ command: "result.create", competitionId, result }));
  const replay = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "result.create", competitionId, resultId: null, digest });
  if (replay) return json(replay.body, { status: replay.statusCode });

  const competition = await env.DB.prepare("SELECT id FROM competitions WHERE id=?").bind(competitionId).first();
  if (!competition) throw new HttpError(404, "not_found", "Competition not found");
  const horse = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(result.horse_id).first();
  if (!horse) throw new HttpError(400, "unknown_horse", "The horse does not exist or is archived");
  const existing = await env.DB.prepare(RESULT_IDENTITY_SQL).bind(competitionId, result.horse_id, result.class_name ?? null).first<ResultRow>();

  if (existing) {
    const contentEqualRow = await env.DB.prepare(`
      SELECT ${RESULT_COLUMNS} FROM competition_results r
      WHERE r.id=? AND r.competition_id=? AND ${RESULT_CONTENT_EQUAL_SQL}
    `).bind(existing.id, competitionId, ...resultContentBinds(result)).first<Record<string, unknown>>();
    if (!contentEqualRow) {
      throw new HttpError(409, "result_conflict",
        "A result already exists for this horse/class with different content. Use the versioned update route POST /api/admin/competitions/:id/results/:resultId/version with the current row_version.",
        { existing_id: Number(existing.id), existing_row_version: Number(existing.row_version), horse_id: result.horse_id, class_name: result.class_name ?? null });
    }
    // Identical content under a NEW key: durable no-op receipt (status 200),
    // no audit, no data change. The gate repeats authority and the exact
    // current content so a demoted editor cannot register even a no-op.
    const responseJson = JSON.stringify({
      created: false,
      existing_result: resultProjection(contentEqualRow),
      row_version: Number(existing.row_version),
      note: "An identical result already exists under this natural key; this command changed nothing and wrote no second audit. Use the versioned update route to edit it.",
    });
    let noopResults;
    try {
      noopResults = await env.DB.batch([
        env.DB.prepare(EDITOR_LOCK_SQL).bind(auth.user.id),
        env.DB.prepare(`
          INSERT INTO competition_command_receipts(id,actor_user_id,command,competition_id,result_id,request_digest,status_code,response_json,created_at)
          SELECT ?,?,'result.create',?,?,?,200,?,CURRENT_TIMESTAMP
          WHERE ${EDITOR_AUTHORITY_SQL}
            AND EXISTS(SELECT 1 FROM competition_results WHERE id=? AND competition_id=? AND row_version=? AND ${RESULT_CONTENT_EQUAL_SQL})
        `).bind(operationId, auth.user.id, competitionId, existing.id, digest, responseJson,
          auth.user.id, existing.id, competitionId, Number(existing.row_version), ...resultContentBinds(result)),
        env.DB.prepare(`SELECT ${RECEIPT_COLUMNS} FROM competition_command_receipts WHERE id=?`).bind(operationId),
      ]);
    } catch (cause) {
      if (isReceiptPrimaryKeyConflict(cause)) {
        const replayed = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "result.create", competitionId, resultId: null, digest });
        if (replayed) return json(replayed.body, { status: replayed.statusCode });
      }
      throw cause;
    }
    const noopReceipt = noopResults[2]?.results?.[0] as CompetitionReceiptRow | undefined;
    if (!noopReceipt) {
      const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin')`).bind(auth.user.id).first();
      if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has competition editorial authority");
      throw new HttpError(409, "create_conflict", "The row changed between inspection and the no-op receipt; nothing was written. Reload and retry.");
    }
    return json({
      ...JSON.parse(noopReceipt.response_json) as Record<string, unknown>,
      replayed: false,
      receipt: receiptProjection(noopReceipt),
    }, { status: 200 });
  }

  // Fresh create: guarded insert + gated receipt + gated audit, one transaction.
  const receiptJson = JSON.stringify({ created: true, row_version: 1, row_version_after: 1 });
  const identitySql = "competition_id=? AND horse_id=? AND IFNULL(class_name,'')=IFNULL(?,'') AND last_operation_id=? AND row_version=1";
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(EDITOR_LOCK_SQL).bind(auth.user.id),
      env.DB.prepare(`
        INSERT INTO competition_results(competition_id,horse_id,rider_name,rider_club,class_name,placement,placement_text,score,is_eliminated,is_withdrawn,notes,provenance,row_version,last_operation_id)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,'user',1,?
        WHERE ${EDITOR_AUTHORITY_SQL}
          AND EXISTS(SELECT 1 FROM competitions WHERE id=?)
          AND EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM competition_results WHERE competition_id=? AND horse_id=? AND IFNULL(class_name,'')=IFNULL(?,''))
      `).bind(competitionId, result.horse_id, result.rider_name ?? null, result.rider_club ?? null, result.class_name ?? null, result.placement ?? null, result.placement_text ?? null, result.score ?? null, result.is_eliminated ? 1 : 0, result.is_withdrawn ? 1 : 0, result.notes ?? null, operationId,
        auth.user.id, competitionId, result.horse_id, competitionId, result.horse_id, result.class_name ?? null),
      env.DB.prepare(`
        INSERT INTO competition_command_receipts(id,actor_user_id,command,competition_id,result_id,request_digest,status_code,response_json,created_at)
        SELECT ?,?,'result.create',?,(SELECT id FROM competition_results WHERE ${identitySql}),?,201,?,CURRENT_TIMESTAMP
        WHERE EXISTS(SELECT 1 FROM competition_results WHERE ${identitySql})
      `).bind(operationId, auth.user.id, competitionId,
        competitionId, result.horse_id, result.class_name ?? null, operationId,
        digest, receiptJson,
        competitionId, result.horse_id, result.class_name ?? null, operationId),
      env.DB.prepare(`
        INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
        SELECT ?,'competition.result_created','competition_result',CAST(id AS TEXT),NULL,?,CURRENT_TIMESTAMP
        FROM competition_results WHERE ${identitySql}
      `).bind(auth.user.id, receiptJson, competitionId, result.horse_id, result.class_name ?? null, operationId),
      env.DB.prepare(`SELECT ${RECEIPT_COLUMNS} FROM competition_command_receipts WHERE id=?`).bind(operationId),
    ]);
  } catch (cause) {
    if (isReceiptPrimaryKeyConflict(cause)) {
      const replayed = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "result.create", competitionId, resultId: null, digest });
      if (replayed) return json(replayed.body, { status: replayed.statusCode });
    }
    throw cause;
  }
  const insertChanges = Number(results[1]?.meta.changes ?? 0);
  const receiptRow = results[4]?.results?.[0] as CompetitionReceiptRow | undefined;
  if (insertChanges !== 1 || !receiptRow) {
    // A race or a late demotion no-oped the guarded insert: classify honestly.
    const current = await env.DB.prepare(RESULT_IDENTITY_SQL).bind(competitionId, result.horse_id, result.class_name ?? null).first<ResultRow>();
    const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin')`).bind(auth.user.id).first();
    if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has competition editorial authority");
    if (current) {
      throw new HttpError(409, "result_conflict",
        "A concurrent writer created this natural key first. Reload the current row and use the versioned update route.",
        { existing_id: Number(current.id), existing_row_version: Number(current.row_version), horse_id: result.horse_id, class_name: result.class_name ?? null });
    }
    throw new HttpError(409, "create_conflict", "The result could not be created with current state; nothing was written and no receipt was claimed");
  }
  const fresh = await env.DB.prepare(`SELECT ${RESULT_COLUMNS} FROM competition_results r WHERE r.competition_id=? AND r.horse_id=? AND IFNULL(r.class_name,'')=IFNULL(?,'')`).bind(competitionId, result.horse_id, result.class_name ?? null).first();
  return json({
    created: true,
    replayed: false,
    result: resultProjection(fresh ?? {}),
    row_version: 1,
    receipt: receiptProjection(receiptRow),
    note: "Result created at row_version 1. The receipt is the durable proof of this exact command.",
  }, { status: 201 });
}

/**
 * R114-02: versioned single-result update. Requires the exact expected row
 * version; a stale version is a 409 that returns the CURRENT row so the editor
 * can compare and reload — never an automatic rebase. horse_id is immutable
 * (the natural key's horse identity never changes); class_name edits keep the
 * existing null/empty collision semantics and refuse a colliding rename.
 */
export async function adminUpdateResult(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, competitionId: number, resultId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = VersionedResultUpdateSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_result_command", "The versioned update command failed validation", parsed.error.flatten());
  const { expected_version: expectedVersion, changes, operation_id: operationId } = parsed.data;
  const digest = await sha256Hex(canonicalJson({ command: "result.update", competitionId, resultId, expectedVersion, changes }));
  const replay = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "result.update", competitionId, resultId, digest });
  if (replay) return json(replay.body, { status: replay.statusCode });

  const current = await env.DB.prepare(`SELECT ${RESULT_COLUMNS} FROM competition_results r WHERE r.id=? AND r.competition_id=?`).bind(resultId, competitionId).first<Record<string, unknown>>();
  if (!current) throw new HttpError(404, "not_found", "Result not found in this competition");
  const horse = await env.DB.prepare("SELECT id,deleted_at FROM horses WHERE id=?").bind(Number(current.horse_id)).first<{ id: number; deleted_at: string | null }>();
  if (!horse || horse.deleted_at) throw new HttpError(409, "horse_archived", "The horse behind this result is archived or missing; the result cannot be edited");

  // Merge onto current values and re-run the full R113 invariants on the
  // resulting row (identical validation object shape as create).
  const merged = {
    horse_id: Number(current.horse_id),
    rider_name: "rider_name" in changes ? changes.rider_name ?? null : (current.rider_name as string | null) ?? null,
    rider_club: "rider_club" in changes ? changes.rider_club ?? null : (current.rider_club as string | null) ?? null,
    class_name: "class_name" in changes ? changes.class_name ?? null : (current.class_name as string | null) ?? null,
    placement: "placement" in changes ? changes.placement ?? null : current.placement === null || current.placement === undefined ? null : Number(current.placement),
    placement_text: "placement_text" in changes ? changes.placement_text ?? null : (current.placement_text as string | null) ?? null,
    score: "score" in changes ? changes.score ?? null : (current.score as string | null) ?? null,
    is_eliminated: "is_eliminated" in changes ? Boolean(changes.is_eliminated) : Number(current.is_eliminated) === 1,
    is_withdrawn: "is_withdrawn" in changes ? Boolean(changes.is_withdrawn) : Number(current.is_withdrawn) === 1,
    notes: "notes" in changes ? changes.notes ?? null : (current.notes as string | null) ?? null,
  };
  const mergedCheck = ResultInputSchema.safeParse(merged);
  if (!mergedCheck.success) throw new HttpError(400, "invalid_result_command", "The merged result fails the R113 placement/elimination invariants", mergedCheck.error.flatten());

  const beforeJson = JSON.stringify(resultProjection(current));
  const afterJson = JSON.stringify({ ...resultProjection({ ...current, ...merged, row_version: expectedVersion + 1 }), last_operation_id: operationId });
  const receiptJson = JSON.stringify({ updated: true, row_version: expectedVersion + 1, row_version_after: expectedVersion + 1 });
  const nowIso = new Date().toISOString();

  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(EDITOR_LOCK_SQL).bind(auth.user.id),
      env.DB.prepare(`
        UPDATE competition_results
        SET rider_name=?,rider_club=?,class_name=?,placement=?,placement_text=?,score=?,is_eliminated=?,is_withdrawn=?,notes=?,
            row_version=row_version+1,updated_at=?,last_operation_id=?
        WHERE id=? AND competition_id=? AND row_version=?
          AND ${EDITOR_AUTHORITY_SQL}
          AND EXISTS(SELECT 1 FROM horses h WHERE h.id=competition_results.horse_id AND h.deleted_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM competition_results r2 WHERE r2.competition_id=? AND r2.horse_id=competition_results.horse_id AND r2.id<>competition_results.id AND IFNULL(r2.class_name,'')=IFNULL(?,''))
      `).bind(
        merged.rider_name ?? null, merged.rider_club ?? null, merged.class_name ?? null, merged.placement ?? null, merged.placement_text ?? null, merged.score ?? null,
        merged.is_eliminated ? 1 : 0, merged.is_withdrawn ? 1 : 0, merged.notes ?? null, nowIso, operationId,
        resultId, competitionId, expectedVersion, auth.user.id, competitionId, merged.class_name ?? null,
      ),
      env.DB.prepare(`
        INSERT INTO competition_command_receipts(id,actor_user_id,command,competition_id,result_id,request_digest,status_code,response_json,created_at)
        SELECT ?,?,'result.update',?,?,?,200,?,CURRENT_TIMESTAMP
        WHERE EXISTS(SELECT 1 FROM competition_results WHERE id=? AND row_version=? AND last_operation_id=?)
      `).bind(operationId, auth.user.id, competitionId, resultId, digest, receiptJson,
        resultId, expectedVersion + 1, operationId),
      env.DB.prepare(`
        INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
        SELECT ?,'competition.result_updated','competition_result',CAST(id AS TEXT),?,?,CURRENT_TIMESTAMP
        FROM competition_results WHERE id=? AND row_version=? AND last_operation_id=?
      `).bind(auth.user.id, beforeJson, afterJson, resultId, expectedVersion + 1, operationId),
      env.DB.prepare(`SELECT ${RECEIPT_COLUMNS} FROM competition_command_receipts WHERE id=?`).bind(operationId),
    ]);
  } catch (cause) {
    if (isReceiptPrimaryKeyConflict(cause)) {
      const replayed = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "result.update", competitionId, resultId, digest });
      if (replayed) return json(replayed.body, { status: replayed.statusCode });
    }
    throw cause;
  }
  const updateChanges = Number(results[1]?.meta.changes ?? 0);
  const receiptRow = results[4]?.results?.[0] as CompetitionReceiptRow | undefined;
  if (updateChanges !== 1 || !receiptRow) {
    const fresh = await env.DB.prepare(`SELECT ${RESULT_COLUMNS} FROM competition_results r WHERE r.id=? AND r.competition_id=?`).bind(resultId, competitionId).first<Record<string, unknown>>();
    const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin')`).bind(auth.user.id).first();
    if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has competition editorial authority");
    if (!fresh) throw new HttpError(404, "not_found", "Result not found in this competition");
    if (Number(fresh.row_version) !== expectedVersion) {
      throw new HttpError(409, "version_conflict",
        "Another editor saved a newer version of this result. The current row is returned for comparison; no automatic rebase is performed and your submitted draft stays yours.",
        { current: resultProjection(fresh), expected_version: expectedVersion });
    }
    const collision = await env.DB.prepare(`
      SELECT id FROM competition_results r2 WHERE r2.competition_id=? AND r2.horse_id=? AND r2.id<>? AND IFNULL(r2.class_name,'')=IFNULL(?,'')
    `).bind(competitionId, Number(fresh.horse_id), resultId, merged.class_name ?? null).first();
    if (collision) {
      throw new HttpError(409, "identity_conflict",
        "Another result for this horse already uses the requested class name; the natural key cannot be moved onto it.",
        { horse_id: Number(fresh.horse_id), class_name: merged.class_name ?? null, existing_id: Number(collision.id) });
    }
    throw new HttpError(409, "update_conflict", "The update could not commit with current authority and state; nothing changed and no receipt was claimed");
  }
  const fresh = await env.DB.prepare(`SELECT ${RESULT_COLUMNS} FROM competition_results r WHERE r.id=?`).bind(resultId).first();
  return json({
    updated: true,
    replayed: false,
    result: resultProjection(fresh ?? {}),
    row_version: expectedVersion + 1,
    receipt: receiptProjection(receiptRow),
    note: "Result updated; the row version advanced. Keep the new row_version for the next versioned command.",
  });
}

/**
 * R114-02: versioned competition EVENT update. The merged event must still
 * pass every R113 real-calendar/range invariant. Stale version => 409 with
 * the current event for comparison; no silent overwrite.
 */
export async function adminUpdateCompetition(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, competitionId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = VersionedEventUpdateSchema.safeParse(await readJson<unknown>(request, 64 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_event_command", "The versioned event update command failed validation", parsed.error.flatten());
  const { expected_version: expectedVersion, changes, operation_id: operationId } = parsed.data;
  const digest = await sha256Hex(canonicalJson({ command: "event.update", competitionId, expectedVersion, changes }));
  const replay = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "event.update", competitionId, resultId: null, digest });
  if (replay) return json(replay.body, { status: replay.statusCode });

  const current = await env.DB.prepare(`SELECT ${COMPETITION_COLUMNS} FROM competitions c WHERE c.id=?`).bind(competitionId).first<Record<string, unknown>>();
  if (!current) throw new HttpError(404, "not_found", "Competition not found");

  const merged = {
    name_native: changes.name_native ?? String(current.name_native),
    name_latin: "name_latin" in changes ? changes.name_latin ?? null : (current.name_latin as string | null) ?? null,
    discipline: changes.discipline ?? String(current.discipline),
    event_date: changes.event_date ?? String(current.event_date),
    end_date: "end_date" in changes ? changes.end_date ?? null : (current.end_date as string | null) ?? null,
    venue: changes.venue ?? String(current.venue),
    city: "city" in changes ? changes.city ?? null : (current.city as string | null) ?? null,
    organizer: "organizer" in changes ? changes.organizer ?? null : (current.organizer as string | null) ?? null,
    tier: changes.tier ?? String(current.tier),
    season: changes.season ?? Number(current.season),
    notes: "notes" in changes ? changes.notes ?? null : (current.notes as string | null) ?? null,
    provenance: String(current.provenance ?? "user"),
  };
  const mergedCheck = CompetitionInputSchema.safeParse(merged);
  if (!mergedCheck.success) throw new HttpError(400, "invalid_event_command", "The merged event fails the R113 real-calendar/range invariants", mergedCheck.error.flatten());

  const beforeJson = JSON.stringify({ ...current, row_version: expectedVersion });
  const afterJson = JSON.stringify({ ...merged, row_version: expectedVersion + 1 });
  const receiptJson = JSON.stringify({ updated: true, row_version: expectedVersion + 1, row_version_after: expectedVersion + 1 });
  const nowIso = new Date().toISOString();

  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(EDITOR_LOCK_SQL).bind(auth.user.id),
      env.DB.prepare(`
        UPDATE competitions
        SET name_native=?,name_latin=?,discipline=?,event_date=?,end_date=?,venue=?,city=?,organizer=?,tier=?,season=?,notes=?,
            row_version=row_version+1,last_operation_id=?
        WHERE id=? AND row_version=? AND ${EDITOR_AUTHORITY_SQL}
      `).bind(
        merged.name_native, merged.name_latin ?? null, merged.discipline, merged.event_date, merged.end_date ?? null,
        merged.venue, merged.city ?? null, merged.organizer ?? null, merged.tier, merged.season, merged.notes ?? null,
        operationId, competitionId, expectedVersion, auth.user.id,
      ),
      env.DB.prepare(`
        INSERT INTO competition_command_receipts(id,actor_user_id,command,competition_id,result_id,request_digest,status_code,response_json,created_at)
        SELECT ?,?,'event.update',?,NULL,?,200,?,CURRENT_TIMESTAMP
        WHERE EXISTS(SELECT 1 FROM competitions WHERE id=? AND row_version=? AND last_operation_id=?)
      `).bind(operationId, auth.user.id, competitionId, digest, receiptJson,
        competitionId, expectedVersion + 1, operationId),
      env.DB.prepare(`
        INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
        SELECT ?,'competition.event_updated','competition',CAST(id AS TEXT),?,?,CURRENT_TIMESTAMP
        FROM competitions WHERE id=? AND row_version=? AND last_operation_id=?
      `).bind(auth.user.id, beforeJson, afterJson, competitionId, expectedVersion + 1, operationId),
      env.DB.prepare(`SELECT ${RECEIPT_COLUMNS} FROM competition_command_receipts WHERE id=?`).bind(operationId),
    ]);
  } catch (cause) {
    if (isReceiptPrimaryKeyConflict(cause)) {
      const replayed = await resolveOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "event.update", competitionId, resultId: null, digest });
      if (replayed) return json(replayed.body, { status: replayed.statusCode });
    }
    throw cause;
  }
  const updateChanges = Number(results[1]?.meta.changes ?? 0);
  const receiptRow = results[4]?.results?.[0] as CompetitionReceiptRow | undefined;
  if (updateChanges !== 1 || !receiptRow) {
    const fresh = await env.DB.prepare(`SELECT ${COMPETITION_COLUMNS} FROM competitions c WHERE c.id=?`).bind(competitionId).first<Record<string, unknown>>();
    const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin')`).bind(auth.user.id).first();
    if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has competition editorial authority");
    if (!fresh) throw new HttpError(404, "not_found", "Competition not found");
    if (Number(fresh.row_version) !== expectedVersion) {
      throw new HttpError(409, "version_conflict",
        "Another editor saved a newer version of this event. The current event is returned for comparison; no automatic rebase is performed.",
        { current: fresh, expected_version: expectedVersion });
    }
    throw new HttpError(409, "update_conflict", "The event update could not commit with current authority and state; nothing changed and no receipt was claimed");
  }
  const fresh = await env.DB.prepare(`SELECT ${COMPETITION_COLUMNS} FROM competitions c WHERE c.id=?`).bind(competitionId).first();
  return json({
    updated: true,
    replayed: false,
    competition: fresh ?? {},
    row_version: expectedVersion + 1,
    receipt: receiptProjection(receiptRow),
    note: "Event updated; the row version advanced. Keep the new row_version for the next versioned command.",
  });
}
