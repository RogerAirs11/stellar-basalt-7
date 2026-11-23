import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { projectGeneticTests, type GeneticTestRow } from "../privacy/projections";

/**
 * R95-N13 — transactionally consistent dossier snapshots.
 *
 * The entire snapshot (identity + every included section + the source
 * version marker) is read by ONE SQL statement. A single statement sees one
 * engine-level snapshot on EVERY provider — D1 batch semantics, PostgreSQL
 * READ COMMITTED, everything in between — so a concurrent source update can
 * never produce a mixed-version dossier (the pre-N13 builder ran several
 * awaited queries; on PostgreSQL each statement gets a fresh snapshot and a
 * mid-build correction could tear the sections).
 *
 * The JSON aggregation diverges BY DESIGN between engines (SQLite json_object
 * preserves insertion order, Postgres jsonb sorts keys), so the aggregates are
 * only a transport: TypeScript re-parses/normalizes (string or parsed object,
 * empty/NULL -> []) and assembles the final object. The stored
 * snapshot_json/sections_meta_json bytes come from TypeScript, never from the
 * database — engine key order can never leak into the frozen document.
 */

export const DOSSIER_SCHEMA_VERSION = 2;

/** Section provenance: every evidence section names its source + review state. */
export function sectionMeta(source: string, reviewState: string, generatedAt: string) {
  return { source, review_state: reviewState, generated_at: generatedAt };
}

/** Cross-engine section transport: SQLite returns a JSON string, Postgres a
 * parsed jsonb value, empty sets arrive as NULL (Postgres) or "[]" — one
 * normalizer, always an array. */
function parseSectionRows(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseSectionObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/**
 * The single-statement snapshot read. {{pedigree}}/{{results}}/{{genetics}}/
 * {{contact}} are replaced by their scalar subqueries only when the section
 * is included — excluded sections are never read at all (not "read then
 * redacted"). Exported so the parity suite replays the exact production SQL.
 */
export const DOSSIER_SNAPSHOT_SELECT_SQL = `SELECT h.id AS horse_id, h.name_latin, h.name_native, h.sex_desc AS sex, h.birth_year, h.color_desc AS color, h.breed_desc AS breed, h.updated_at AS source_updated_at
{{pedigree}}
{{results}}
{{genetics}}
{{contact}}
  FROM horses h WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1`;

const PEDIGREE_SUBQUERY = `,(SELECT json_group_array(json_object('sire_id',sire.id,'sire_name',sire.name_latin,'dam_id',dam.id,'dam_name',dam.name_latin))
      FROM horses h2
      LEFT JOIN horses sire ON sire.id=h2.father_id AND sire.deleted_at IS NULL AND sire.is_active=1
      LEFT JOIN horses dam ON dam.id=h2.mother_id AND dam.deleted_at IS NULL AND dam.is_active=1
      WHERE h2.id=h.id) AS pedigree_rows`;

const RESULTS_SUBQUERY = `,(SELECT json_group_array(json_object('id',t.id,'placement',t.placement,'placement_text',t.placement_text,'score',t.score,'is_eliminated',t.is_eliminated,'is_withdrawn',t.is_withdrawn,'provenance',t.provenance,'competition',t.competition,'event_date',t.event_date,'discipline',t.discipline))
      FROM (SELECT cr.id, cr.placement, cr.placement_text, cr.score, cr.is_eliminated, cr.is_withdrawn, cr.provenance,
                   c.name_native AS competition, c.event_date, c.discipline
            FROM competition_results cr JOIN competitions c ON c.id=cr.competition_id
            WHERE cr.horse_id=h.id ORDER BY c.event_date DESC, cr.id DESC LIMIT 20) t) AS results_rows
  ,(SELECT COUNT(*) FROM competition_results WHERE horse_id=h.id) AS results_total`;

const GENETICS_SUBQUERY = `,(SELECT json_group_array(json_object('id',t.id,'test_type',t.test_type,'test_category',t.test_category,'result',t.result,'result_interpretation',t.result_interpretation,'lab_name',t.lab_name,'lab_accession',t.lab_accession,'tested_at',t.tested_at,'verified',t.verified,'provenance',t.provenance,'notes',t.notes,'public_disclosed',t.public_disclosed))
      FROM (SELECT id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,provenance,notes,public_disclosed
            FROM genetic_tests WHERE horse_id=h.id AND verified=1 AND (test_category <> 'disease' OR public_disclosed = 1) ORDER BY tested_at DESC, id DESC LIMIT 30) t) AS genetics_rows`;

const CONTACT_SUBQUERY = `,(SELECT json_object('display_name',u.display_name,'email',u.email) FROM users u WHERE u.id=?) AS contact_row`;

export interface DossierSnapshotOptions {
  includePedigree: boolean;
  includeResults: boolean;
  includeGenetics: boolean;
  includeContact: boolean;
  creatorUserId: string;
}

export interface DossierSnapshotResult {
  snapshot: Record<string, unknown>;
  sectionsMeta: Record<string, ReturnType<typeof sectionMeta>>;
}

/** Build the frozen snapshot: public identity + explicitly included sections,
 * ALL from one consistent statement (see module doc). */
export async function buildDossierSnapshot(
  db: D1Database,
  horseId: number,
  options: DossierSnapshotOptions,
): Promise<DossierSnapshotResult> {
  const sql = DOSSIER_SNAPSHOT_SELECT_SQL
    .replace("{{pedigree}}", options.includePedigree ? PEDIGREE_SUBQUERY : "")
    .replace("{{results}}", options.includeResults ? RESULTS_SUBQUERY : "")
    .replace("{{genetics}}", options.includeGenetics ? GENETICS_SUBQUERY : "")
    .replace("{{contact}}", options.includeContact ? CONTACT_SUBQUERY : "");
  // Placeholder order follows SQL text: the contact subquery lives in the
  // SELECT list (before the WHERE clause), so its bind comes FIRST.
  const binds: unknown[] = options.includeContact ? [options.creatorUserId, horseId] : [horseId];
  const horse = await db.prepare(sql).bind(...binds).first<Record<string, unknown>>();
  if (!horse) throw new HttpError(404, "horse_not_found", "Horse not found in the registry");

  const generatedAt = new Date().toISOString();
  const sectionsMeta: Record<string, ReturnType<typeof sectionMeta>> = {};
  const snapshot: Record<string, unknown> = {
    horse_id: horse.horse_id,
    identity: {
      name_latin: horse.name_latin,
      name_native: horse.name_native,
      sex: horse.sex,
      birth_year: horse.birth_year,
      color: horse.color,
      breed: horse.breed,
    },
    // Source version marker: the horse row's own updated_at, captured in the
    // SAME statement as every section — a later correction changes it and the
    // staleness comparison reports the difference (never a silent rewrite).
    source: { schema_version: DOSSIER_SCHEMA_VERSION, horses_updated_at: horse.source_updated_at ?? null },
  };
  sectionsMeta.identity = sectionMeta("registry:horses", "recorded_not_independently_attested", generatedAt);
  sectionsMeta.source = sectionMeta("registry:horses(updated_at)", "recorded_not_independently_attested", generatedAt);

  if (options.includePedigree) {
    const rows = parseSectionRows(horse.pedigree_rows);
    const first = (rows[0] ?? {}) as { sire_id?: number; sire_name?: string; dam_id?: number; dam_name?: string };
    snapshot.pedigree = { sire_id: first.sire_id ?? null, dam_id: first.dam_id ?? null, sire_name: first.sire_name ?? null, dam_name: first.dam_name ?? null };
    sectionsMeta.pedigree = sectionMeta("registry:horses(parents)", "recorded_not_independently_attested", generatedAt);
  } else {
    snapshot.pedigree = { not_shared: true };
    sectionsMeta.pedigree = sectionMeta("seller:redacted", "not_shared", generatedAt);
  }

  if (options.includeResults) {
    const rows = parseSectionRows(horse.results_rows);
    snapshot.results = rows;
    snapshot.results_summary = { total_records: Number(horse.results_total ?? 0), displayed_records: rows.length, limit: 20 };
    sectionsMeta.results = sectionMeta("registry:competition_results", "recorded_not_independently_attested", generatedAt);
  } else {
    snapshot.results = { not_shared: true };
    sectionsMeta.results = sectionMeta("seller:redacted", "not_shared", generatedAt);
  }

  // Genetics and contact are private by default: their absence is listed as
  // not_shared — never rendered as a clean/verified state.
  if (options.includeGenetics) {
    const rows = parseSectionRows(horse.genetics_rows);
    snapshot.genetics = projectGeneticTests(rows as unknown as GeneticTestRow[], null);
    sectionsMeta.genetics = sectionMeta("registry:genetic_tests(public projection only)", "recorded_not_independently_attested", generatedAt);
  } else {
    snapshot.genetics = { not_shared: true };
    sectionsMeta.genetics = sectionMeta("seller:redacted", "not_shared", generatedAt);
  }

  if (options.includeContact) {
    // The contact section is the SELLER's own contact (the dossier creator
    // who chose to share it) — never another party's data.
    const owner = parseSectionObject(horse.contact_row);
    snapshot.contact = owner ?? { not_shared: true };
    sectionsMeta.contact = sectionMeta("users(seller)", "shared_by_consent", generatedAt);
  } else {
    snapshot.contact = { not_shared: true };
    sectionsMeta.contact = sectionMeta("seller:redacted", "not_shared", generatedAt);
  }

  return { snapshot, sectionsMeta };
}

// ---------------------------------------------------------------------------
// Issued digest + controlled legacy payload validation.
// ---------------------------------------------------------------------------

/** The immutable digest binds the EXACT stored content bytes. */
export async function dossierContentDigest(snapshotJson: string, sectionsMetaJson: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${snapshotJson}\n${sectionsMetaJson}`));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type LegacyDossierPayload =
  | { ok: true; snapshot: Record<string, unknown>; sectionsMeta: Record<string, unknown> }
  | { ok: false; reason: "snapshot_unreadable" | "meta_unreadable" | "structure_invalid" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate a HISTORICAL dossier payload into a controlled result — never a
 * 500 that leaks stack data. Structural expectations are deliberately narrow:
 * a known schema version shape with each known section either an array, a
 * plain object or an explicit not_shared marker. Anything else is operator
 * review (the frozen bytes are kept, not deleted).
 */
export function parseLegacyDossierPayload(snapshotJson: string | null | undefined, sectionsMetaJson: string | null | undefined): LegacyDossierPayload {
  let snapshot: unknown;
  try { snapshot = JSON.parse(String(snapshotJson ?? "")); }
  catch { return { ok: false, reason: "snapshot_unreadable" }; }
  if (!isPlainObject(snapshot)) return { ok: false, reason: "snapshot_unreadable" };
  let sectionsMeta: unknown;
  try { sectionsMeta = JSON.parse(String(sectionsMetaJson ?? "")); }
  catch { return { ok: false, reason: "meta_unreadable" }; }
  if (!isPlainObject(sectionsMeta)) return { ok: false, reason: "meta_unreadable" };
  const source = snapshot.source;
  const sourceVersion = isPlainObject(source) ? Number(source.schema_version) : NaN;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > DOSSIER_SCHEMA_VERSION) {
    return { ok: false, reason: "structure_invalid" };
  }
  if (!Number.isInteger(snapshot.horse_id) || !isPlainObject(snapshot.identity)) {
    return { ok: false, reason: "structure_invalid" };
  }
  for (const section of ["pedigree", "results", "genetics", "contact"] as const) {
    const value = snapshot[section];
    if (value === undefined) continue; // a section may be absent in v1 payloads
    const isMarker = isPlainObject(value) && value.not_shared === true;
    if (!Array.isArray(value) && !isMarker && !isPlainObject(value)) return { ok: false, reason: "structure_invalid" };
  }
  return { ok: true, snapshot, sectionsMeta };
}

/** Detect any change in the included evidence, not just horses.updated_at. */
export function dossierSnapshotsEqual(frozen: Record<string, unknown>, current: Record<string, unknown>): boolean {
  return JSON.stringify(frozen) === JSON.stringify(current);
}
/** A later withdrawal of a genetic result must also disable older public shares. */
export function frozenGeneticsStillPublic(frozen: Record<string, unknown>, current: Record<string, unknown>): boolean {
  if (!Array.isArray(frozen.genetics) || frozen.genetics.length === 0) return true;
  const allowed = new Set(Array.isArray(current.genetics) ? current.genetics.map((test: { id?: number }) => test.id) : []);
  return frozen.genetics.every((test: { id?: number }) => Number.isSafeInteger(test.id) && allowed.has(test.id));
}
