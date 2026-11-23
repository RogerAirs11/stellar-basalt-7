import { HttpError } from "../api/http";
import type { HorseFieldValue } from "./validation";

/**
 * Master-Ai plan T08: enforce identifier integrity at commit time.
 *
 * Every canonical horse write that sets/clears register_no or microchip_no now
 * maintains a live identifier row in horse_identifiers inside the SAME
 * transaction. The partial unique index (kind, issuer_namespace,
 * normalized_value) WHERE status='live' turns the old TOCTOU race (two
 * concurrent creates both passing the application-level duplicate check)
 * into a hard, database-enforced "at most one accepted live identifier".
 *
 * Scope rules from the plan:
 *   - Registry numbers are issuer-scoped. New editorial writes use the
 *     platform's own namespace 'registry:platform'. The legacy import's
 *     numbers are backfilled under 'registry:legacy:unattributed' — the
 *     unknown legacy issuer is never guessed.
 *   - Microchips are globally scoped (single namespace 'microchip').
 *   - Leading zeros are preserved (values are never numerically coerced) and
 *     Persian/Arabic-Indic digits are normalized so ۱۲۳ and 123 unify.
 *   - Reassignment supersedes (never deletes) the previous live row, keeping
 *     identifier history. Legacy collisions are recorded, not erased, through
 *     the identifier_conflicts admin queue (see scripts/audit-identifier-conflicts.mjs).
 */

export const IDENTIFIER_KIND_NAMESPACES = {
  register_no: "registry:platform",
  microchip_no: "microchip",
  uel_no: "uel",
  life_number: "life",
  passport_no: "passport:legacy:unattributed",
  foreign_registration_no: "foreign:legacy:unattributed",
} as const;

export type IdentifierKind = keyof typeof IDENTIFIER_KIND_NAMESPACES;

const IDENTIFIER_FIELDS: Record<string, IdentifierKind> = {
  register_no: "register_no",
  microchip_no: "microchip_no",
  uel_no: "uel_no",
  life_number: "life_number",
  passport_no: "passport_no",
  foreign_registration_no: "foreign_registration_no",
};

export function identifierKindForField(field: string): IdentifierKind | null {
  return IDENTIFIER_FIELDS[field] ?? null;
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Type-aware identifier normalization: unicode digits -> ASCII, outer
 * whitespace trimmed, inner whitespace collapsed. Leading zeros and all other
 * separators are preserved exactly — "007" never becomes "7".
 */
export function normalizeIdentifierValue(value: string): string {
  let out = String(value).normalize("NFKC").trim();
  out = out.replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
  out = out.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
  out = out.replace(/\s+/g, " ");
  return out.trim();
}

export interface IdentifierChangePlan {
  kind: IdentifierKind;
  namespace: string;
  normalizedValue: string | null;
  rawValue: string | null;
}

/** Normalize the identity fields of a change set into identifier plans. */
export function identifierChangePlans(changes: Record<string, HorseFieldValue>): IdentifierChangePlan[] {
  const plans: IdentifierChangePlan[] = [];
  for (const [field, value] of Object.entries(changes)) {
    const kind = identifierKindForField(field);
    if (!kind) continue;
    const issuerField = kind === "passport_no" ? "passport_issuer" : kind === "foreign_registration_no" ? "foreign_registration_issuer" : null;
    const issuer = issuerField ? changes[issuerField] : null;
    const namespace = issuerField && typeof issuer === "string" && issuer.trim()
      ? `${kind === "passport_no" ? "passport" : "foreign"}:${normalizeIdentifierValue(issuer).toLowerCase()}` : IDENTIFIER_KIND_NAMESPACES[kind];
    if (value === null || value === undefined || String(value).trim() === "") {
      plans.push({ kind, namespace, normalizedValue: null, rawValue: null });
      continue;
    }
    const raw = String(value).trim();
    plans.push({ kind, namespace, normalizedValue: normalizeIdentifierValue(raw), rawValue: raw });
  }
  return plans;
}

export interface IdentifierStatementParams {
  horseId: number;
  mutationId: string;
  source: string;
  changes: Record<string, HorseFieldValue>;
  identifierTableReady: boolean;
}

/**
 * Statements that move the horse's live identifier rows to the new values,
 * CONDITIONED on the canonical horse write having landed in the same
 * transaction (horses.last_mutation_id = our mutation). Old rows are
 * superseded, never deleted, preserving identifier history.
 */
export function identifierStatementsForHorseChange(db: D1Database, params: IdentifierStatementParams): D1PreparedStatement[] {
  if (!params.identifierTableReady && identifierChangePlans(params.changes).length) throw identifierSchemaUnavailable();
  const statements: D1PreparedStatement[] = [];
  for (const plan of identifierChangePlans(params.changes)) {
    statements.push(
      db.prepare(`UPDATE horse_identifiers SET status='superseded',updated_at=CURRENT_TIMESTAMP
        WHERE horse_id=? AND kind=? AND status='live'
        AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)`)
        .bind(params.horseId, plan.kind, params.horseId, params.mutationId),
    );
    if (plan.normalizedValue === null || plan.normalizedValue === "") continue;
    statements.push(
      db.prepare(`INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id,created_at,updated_at)
        SELECT ?,?,?,?,?,'live',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        WHERE EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)`)
        .bind(plan.kind, plan.namespace, plan.normalizedValue, plan.rawValue, params.horseId, `${params.source}:${params.mutationId}`, params.horseId, params.mutationId),
    );
  }
  return statements;
}

/** Retire a horse's live identifiers together with the archive write. */
export const ARCHIVE_IDENTIFIER_STATEMENT_SQL = `UPDATE horse_identifiers SET status='archived',updated_at=CURRENT_TIMESTAMP
  WHERE horse_id=? AND status='live'
  AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=? AND deleted_at IS NOT NULL)`;

export function archiveIdentifierStatement(db: D1Database, horseId: number, mutationId: string, identifierTableReady: boolean): D1PreparedStatement | null {
  if (!identifierTableReady) throw identifierSchemaUnavailable();
  return db.prepare(ARCHIVE_IDENTIFIER_STATEMENT_SQL).bind(horseId, horseId, mutationId);
}

/** Identifiers join the newly inserted horse by its fresh operation identity.
 * Execute these statements in the SAME batch as INSERT, counters, and journal.
 * No follow-up commit, delete-as-compensation, or last-insert-id assumption. */
export function identifierStatementsForHorseCreate(
  db: D1Database,
  params: { mutationId: string; changes: Record<string, HorseFieldValue>; identifierTableReady: boolean },
): D1PreparedStatement[] {
  const plans = identifierChangePlans(params.changes);
  if (!params.identifierTableReady && plans.length) throw identifierSchemaUnavailable();
  return plans.filter(plan => plan.normalizedValue !== null && plan.normalizedValue !== "").map(plan =>
    db.prepare(`INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id,created_at,updated_at)
      SELECT ?,?,?,?,h.id,'live',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      FROM horses h WHERE h.last_mutation_id=? AND h.deleted_at IS NULL`)
      .bind(plan.kind,plan.namespace,plan.normalizedValue,plan.rawValue,`horse.create:${params.mutationId}`,params.mutationId));
}

function identifierSchemaUnavailable(): HttpError {
  return new HttpError(503,"identifier_schema_unavailable","Registry writes are unavailable until identifier integrity is restored. Contact the operator.");
}

/** Recognize "the horse_identifiers table does not exist yet" on both dialects. */
export function isMissingIdentifierTableError(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === "42P01") return true;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return message.includes("no such table: horse_identifiers") || message.includes('relation "horse_identifiers" does not exist');
}

/** Recognize "another live horse already owns this identifier" on both dialects. */
export function isDuplicateIdentifierError(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; message?: unknown; constraint?: unknown; table?: unknown; cause?: unknown };
    const message = String(e.message ?? "");
    const scoped = e.table === "horse_identifiers" || String(e.constraint ?? "").includes("horse_identifiers") || message.includes("horse_identifiers");
    if (scoped && (e.code === "23505" || message.includes("UNIQUE constraint failed") || message.includes("duplicate key value violates unique constraint"))) return true;
    current = e.cause;
  }
  return false;
}

export interface IdentifierHolderRow {
  id: number;
  name_latin: string;
  name_native: string | null;
}

/** Build the operator-safe 409 for a lost identifier race, with the live holder. */
export function duplicateIdentifierHttpError(
  claim: { kind: IdentifierKind; normalizedValue: string | null },
  holder: IdentifierHolderRow | null,
): HttpError {
  const label = claim.kind === "register_no" ? "register number" : claim.kind === "microchip_no" ? "microchip number" : claim.kind;
  return new HttpError(409, "duplicate_identifier", `Another live horse already holds this ${label}`, {
    kind: claim.kind,
    value: claim.normalizedValue,
    ...(holder ? { existing: { id: holder.id, name_latin: holder.name_latin, name_native: holder.name_native } } : {}),
  });
}

/** Look up the current live holder of the first identifier in a change set. */
export async function duplicateIdentifierFromDb(db: D1Database, changes: Record<string, HorseFieldValue>): Promise<HttpError> {
  for (const plan of identifierChangePlans(changes)) {
    if (!plan.normalizedValue) continue;
    const holder = await db.prepare(
      `SELECT h.id,h.name_latin,h.name_native FROM horse_identifiers i JOIN horses h ON h.id=i.horse_id
       WHERE i.kind=? AND i.issuer_namespace=? AND i.normalized_value=? AND i.status='live' AND h.deleted_at IS NULL LIMIT 1`,
    ).bind(plan.kind, plan.namespace, plan.normalizedValue).first<IdentifierHolderRow>();
    if (holder) return duplicateIdentifierHttpError({ kind: plan.kind, normalizedValue: plan.normalizedValue }, holder);
  }
  return duplicateIdentifierHttpError({ kind: "register_no", normalizedValue: null }, null);
}

/** Readiness is checked on this database, never cached across provider instances.
 * Application prechecks cannot replace a uniqueness constraint at commit time. */
export async function identifierTableReady(db: D1Database): Promise<boolean> {
  try {
    await db.prepare("SELECT 1 AS ok FROM horse_identifiers LIMIT 1").first();
    return true;
  } catch (cause) {
    if (isMissingIdentifierTableError(cause)) throw identifierSchemaUnavailable();
    throw cause;
  }
}
