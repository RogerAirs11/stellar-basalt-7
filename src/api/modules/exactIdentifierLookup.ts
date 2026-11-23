import { HttpError, json } from "../http";
import { requirePermission } from "../../auth/guards";
import type { D1Database } from "@cloudflare/workers-types";
import { normalizeIdentifierValue } from "../../registry/identifiers";

/**
 * R145-C05 (Master-AI plan) — authorized exact chip/passport lookup.
 *
 * Master-AI finding: the public search cannot do an EXACT microchip or
 * passport lookup (substring matching only, and full identifier equality is
 * deliberately NOT public), while staff had no exact tooling either — the
 * duplicate workbench mines candidates but cannot resolve "which horse owns
 * chip 985...?" deterministically.
 *
 * Policy (the plan's privacy constraint, enforced):
 *   - AUTHORIZED callers only: staff capability `quality.read` (editors and
 *     above — the same gate as the quality queue). Anonymous and plain users
 *     get 401/403 — a public probe must never be able to enumerate
 *     chips/passports, and a MISS must be indistinguishable from a concealed
 *     record.
 *   - Bounded: one exact value per call, trimmed, length-capped; results are
 *     minimal (id, name, register, birth year) — never the other stored
 *     identifiers, so one authorized lookup cannot harvest more namespaces.
 *   - Every call is answered identically whether the value exists, is
 *     deleted, or was never issued (empty result), so response shapes cannot
 *     reveal concealed identifiers.
 */

const IDENTIFIER_COLUMNS: Record<string, string> = {
  microchip: "microchip_no",
  passport: "passport_no",
  life_number: "life_number",
  uel: "uel_no",
  register: "register_no",
};

export async function exactIdentifierLookup(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "quality.read");
  const url = new URL(request.url);
  const kindParam = (url.searchParams.get("kind") ?? "").trim();
  const rawValue = (url.searchParams.get("value") ?? "").trim();
  if (rawValue.length > 120) throw new HttpError(400, "invalid_value", "Identifier values must be at most 120 characters");
  const valueParam = normalizeIdentifierValue(rawValue);
  if (!kindParam || !Object.hasOwn(IDENTIFIER_COLUMNS, kindParam)) {
    throw new HttpError(400, "invalid_kind", "kind must be one of microchip, passport, life_number, uel, register");
  }
  if (!valueParam) throw new HttpError(400, "missing_value", "Provide the exact identifier value to resolve");
  const column = IDENTIFIER_COLUMNS[kindParam];

  const rows = (await env.DB.prepare(
    `SELECT h.id,h.name_latin,h.name_native,h.register_no,h.birth_year,h.is_active,h.is_dead
     FROM horses h WHERE h.deleted_at IS NULL AND (TRIM(h.${column})=? OR EXISTS(
       SELECT 1 FROM horse_identifiers i WHERE i.horse_id=h.id AND i.kind=? AND i.status='live' AND i.normalized_value=?
     )) ORDER BY h.id LIMIT 10`,
  )
    .bind(valueParam, column, valueParam)
    .all()).results as Array<Record<string, unknown>>;

  void auth;
  return json({
    kind: kindParam,
    matched: rows.length,
    results: rows.map((row) => ({
      id: Number(row.id),
      name_latin: row.name_latin ?? null,
      name_native: row.name_native ?? null,
      register_no: row.register_no ?? null,
      birth_year: row.birth_year == null ? null : Number(row.birth_year),
      active: Number(row.is_active) === 1 && Number(row.is_dead) === 0,
    })),
    note: "Authorized exact lookup. Minimal fields only: further identifier namespaces are never echoed, and an empty result is indistinguishable from a concealed record.",
  });
}
