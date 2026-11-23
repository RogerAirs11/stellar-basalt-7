import { HorseRow } from "../db/types";
import { HttpError } from "../api/http";
import { horseMutationImpact, type HorseMutationImpact } from "./impact";
import { identifierChangePlans, isDuplicateIdentifierError, duplicateIdentifierFromDb, normalizeIdentifierValue } from "./identifiers";
import { HORSE_FIELD_SCHEMAS, isTypedDateField, parseHorseFieldValue, type HorseFieldValue } from "./validation";
import { isTypedDateChange } from "./typedDateValue";
import { pedigreeGraphLockStatement } from "./mutationStatements";
import { registrationAliases, validateRegistrationDetails } from "./registrationDetails";
import { runRegistryPolicyBatch, type RegistryPolicyCommit } from "./ruleCommit";

/**
 * Master-Ai plan T07: the typed mutation service behind every canonical horse
 * write. Direct edits, reviewed update_horse applies and creates all plan
 * their changes here first, so:
 *
 *   - only NORMALIZED parsed values are ever stored (Zod transforms applied —
 *     the reviewed path previously bound the RAW proposed_value, so
 *     "  Name  " passed validation but stored with its whitespace);
 *   - parentage changes are detected once for the cycle guard;
 *   - identifier fields are detected once for the T08 live-identifier work;
 *   - name changes are detected once for the T09 child-search invalidation.
 */

export interface HorseMutationPlan {
  normalizedChanges: Record<string, HorseFieldValue>;
  appliedFields: string[];
  parentageChanged: boolean;
  nextFather: number | null;
  nextMother: number | null;
  touchesName: boolean;
  touchesIdentifiers: boolean;
  /** Only identifier fields whose normalized value actually differs from the row. */
  effectiveIdentifierChanges: Record<string, HorseFieldValue>;
  impact: HorseMutationImpact;
  registrationAliases?: string[];
}

function currentText(before: HorseRow, field: string): string | null {
  const value = (before as unknown as Record<string, unknown>)[field];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Validate + normalize a raw change set against the shared field schemas.
 * Throws on invalid values or unsupported fields — the caller returns a 4xx;
 * nothing is ever silently dropped.
 */
export function planHorseMutation(before: HorseRow, rawChanges: Record<string, unknown>, options: { allowLifecycleCorrection?: boolean } = {}): HorseMutationPlan {
  // Trusted command option, never a request-body field. Only a current,
  // version-guarded field-decision reversal enables lifecycle correction.
  validateRegistrationDetails(rawChanges, before as unknown as Record<string, unknown>, options);
  const normalizedChanges: Record<string, HorseFieldValue> = {};
  const appliedFields: string[] = [];
  const knownFields = HORSE_FIELD_SCHEMAS as Record<string, unknown>;
  for (const [field, raw] of Object.entries(rawChanges)) {
    if (raw === undefined) continue;
    if (options.allowLifecycleCorrection && field === "is_dead" && (raw === 0 || raw === 1)) {
      normalizedChanges.is_dead = raw;
      appliedFields.push(field);
      continue;
    }
    const parsed = parseHorseFieldValue(field, raw);
    if (!parsed.ok) {
      throw new MutationPlanError(
        knownFields[field] ? "invalid_value" : "unsupported_field",
        knownFields[field]
          ? `Invalid value for '${field}'`
          : `Unsupported field '${field}' cannot be applied to this horse`,
      );
    }
    normalizedChanges[field === "previous_names" ? "previous_names_json" : field] = parsed.value;
    appliedFields.push(field);
  }
  if (rawChanges.name_latin !== undefined && (normalizedChanges.name_latin === null || normalizedChanges.name_latin === "")) {
    throw new MutationPlanError("invalid_value", "Field 'name_latin' cannot be empty");
  }
  // T12: setting a death date states the horse died; clearing the typed date
  // never resurrects it (is_dead may be a legacy fact without a date).
  if (isTypedDateChange(normalizedChanges.death_date) && normalizedChanges.death_date.date) {
    normalizedChanges.is_dead = 1;
    normalizedChanges.life_status = "dead";
    appliedFields.push("is_dead");
  }
  if (normalizedChanges.life_status === "dead") normalizedChanges.is_dead = 1;

  const nextFather = normalizedChanges.father_id === undefined ? before.father_id : (normalizedChanges.father_id as number | null);
  const nextMother = normalizedChanges.mother_id === undefined ? before.mother_id : (normalizedChanges.mother_id as number | null);
  const parentageChanged = nextFather !== before.father_id || nextMother !== before.mother_id;

  const effectiveIdentifierChanges: Record<string, HorseFieldValue> = {};
  const identifierInput = { ...normalizedChanges };
  for (const [number, issuer] of [["passport_no", "passport_issuer"], ["foreign_registration_no", "foreign_registration_issuer"]]) {
    if (normalizedChanges[number!] !== undefined || normalizedChanges[issuer!] !== undefined) {
      identifierInput[number!] = normalizedChanges[number!] === undefined ? currentText(before, number!) : normalizedChanges[number!]!;
      identifierInput[issuer!] = normalizedChanges[issuer!] === undefined ? currentText(before, issuer!) : normalizedChanges[issuer!]!;
    }
  }
  for (const plan of identifierChangePlans(identifierInput)) {
    const field = plan.kind;
    const currentRaw = currentText(before, field);
    const currentNormalized = currentRaw === null ? null : normalizeIdentifierValue(currentRaw);
    const nextNormalized = plan.normalizedValue === "" ? null : plan.normalizedValue;
    const issuerField = field === "passport_no" ? "passport_issuer" : field === "foreign_registration_no" ? "foreign_registration_issuer" : null;
    const namespaceChanged = issuerField && normalizedChanges[issuerField] !== undefined
      && normalizeIdentifierValue(String(identifierInput[issuerField] ?? "")).toLowerCase() !== normalizeIdentifierValue(currentText(before, issuerField) ?? "").toLowerCase();
    if (currentNormalized === nextNormalized && !namespaceChanged) continue;
    effectiveIdentifierChanges[field] = identifierInput[field] ?? null;
    if (issuerField) effectiveIdentifierChanges[issuerField] = identifierInput[issuerField] ?? null;
  }

  const touchesName = normalizedChanges.name_latin !== undefined || normalizedChanges.name_native !== undefined;
  const touchesIdentifiers = Object.keys(effectiveIdentifierChanges).length > 0;

  return {
    normalizedChanges,
    appliedFields,
    parentageChanged,
    nextFather,
    nextMother,
    touchesName,
    touchesIdentifiers,
    effectiveIdentifierChanges,
    impact: horseMutationImpact(normalizedChanges),
    ...((rawChanges.birth_name !== undefined || rawChanges.previous_names !== undefined)
      ? { registrationAliases: registrationAliases({ ...before, ...normalizedChanges }) } : {}),
  };
}

export class MutationPlanError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MutationPlanError";
    this.code = code;
  }
}

export interface StaleFieldDiff {
  field: string;
  submitted_old_value: unknown;
  current_value: unknown;
}

/**
 * T07: compare the submitter's claimed base values against the current row.
 * Only SAFE information is returned (field + old vs current) — never the
 * proposed values — so a 409 response can show the reviewer exactly what
 * drifted without leaking the pending proposal to a stale session.
 */
export function staleBaseFieldDifferences(
  items: Array<{ field_name: string; old_value?: unknown; proposed_value?: unknown }>,
  currentRow: Record<string, unknown>,
): StaleFieldDiff[] {
  const diffs: StaleFieldDiff[] = [];
  for (const item of items) {
    if (item.old_value === undefined) continue;
    const current = currentRow[item.field_name];
    const oldText = item.old_value === null ? "" : String(item.old_value ?? "");
    const currentText = current === null || current === undefined ? "" : String(current);
    if (oldText.trim() !== currentText.trim()) {
      diffs.push({ field: item.field_name, submitted_old_value: item.old_value, current_value: current ?? null });
    }
  }
  return diffs;
}

export interface CanonicalHorseUpdateParams {
  plan: HorseMutationPlan;
  horseId: number;
  expectedRowVersion: number;
  mutationId: string;
  /** Set when the write comes from approving a reviewed change request. */
  viaChangeRequestId?: string | null;
  /** Trusted internal SQL only: related decision state and live authority
   * must still hold at the same boundary as the horse version CAS. */
  additionalGuard?: { sql: string; bindings: Array<string | number | null> };
  identifierTableReady: boolean;
}

export interface CanonicalHorseUpdateStatements {
  /** The version-guarded UPDATE — always index 0 of the returned pre-decision group. */
  updateStatement: D1PreparedStatement;
  /** Identifier maintenance + revision bump + reindex queueing, all conditioned. */
  afterUpdateStatements: D1PreparedStatement[];
}

export {
  buildCanonicalHorseUpdateStatements, HORSE_UPDATE_SQL_TEMPLATE, HORSE_UPDATE_CHANGE_REQUEST_GUARD_SQL,
  HORSE_UPDATE_PARENTAGE_GUARD_SQL, REGISTRY_REVISION_BUMP_SQL, REINDEX_SELF_SQL, REINDEX_CHILDREN_ON_NAME_SQL,
  pedigreeGraphLockStatement, PEDIGREE_GRAPH_LOCK_SQL, PEDIGREE_GRAPH_LOCK_NAMESPACE,
} from "./mutationStatements";

/** PostgreSQL SQLSTATE for a statement cancelled by lock_timeout — a bounded
 * graph-lock wait that expired. Surfaces to the operator as a RECOVERABLE
 * conflict, never as data loss or a partial write. */
export function isGraphLockTimeoutError(cause: unknown): boolean {
  const code = (cause as { code?: string } | null)?.code;
  if (code === "55P03" || code === "55P02") return true;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /lock_timeout|lock not available|canceling statement due to lock timeout/i.test(message);
}

/**
 * Execute a horse mutation batch, translating database identifier-constraint
 * failures into operator-safe 409 duplicate_identifier responses. On the D1
 * and Supabase-full providers a batch is a single transaction, so a failed
 * duplicate insert rolls the whole mutation back — no partial write.
 *
 * R120 / IMP-012: with `graphLock: true` the batch is prefixed with the
 * pedigree graph advisory-lock statement (a no-op SELECT on SQLite/D1;
 * pg_advisory_xact_lock with a bounded wait on PostgreSQL). The lock is
 * acquired in a SEPARATE statement before any guard read, so the cycle guard
 * inside the UPDATE re-validates against a post-lock snapshot. The returned
 * results array is sliced back to the caller's original statement indexing —
 * callers never see the lock statement.
 */
export async function runGuardedHorseBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  changesForLookup: Record<string, HorseFieldValue>,
  options: { graphLock?: boolean; policy?: RegistryPolicyCommit } = {},
): Promise<D1Result[]> {
  const batch = options.graphLock && !options.policy
    ? [pedigreeGraphLockStatement(db), ...statements]
    : statements;
  let results: D1Result[];
  try {
    results = options.policy ? await runRegistryPolicyBatch(db, statements, options.policy) : await db.batch(batch);
  } catch (cause) {
    if (isGraphLockTimeoutError(cause)) {
      throw new HttpError(409, "pedigree_edit_busy",
        "Another pedigree change is being saved right now. Nothing was written — reload and retry in a moment.");
    }
    if (isDuplicateIdentifierError(cause)) {
      throw await duplicateIdentifierFromDb(db, changesForLookup);
    }
    throw cause;
  }
  return options.graphLock && !options.policy ? results.slice(1) : results;
}
