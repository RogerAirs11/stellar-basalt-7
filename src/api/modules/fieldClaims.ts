import { z } from "zod";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError, json, readJson } from "../http";
import { requirePermission, requireCsrf } from "../../auth/guards";
import type { HorseRow } from "../../db/types";
import { MutationPlanError, planHorseMutation, runGuardedHorseBatch, buildCanonicalHorseUpdateStatements } from "../../registry/mutations";
import { assertValidParentAssignment, assertNoLiveHorseDuplicates, settleCanonicalHorseMutation } from "./registryShared";
import { canonicalMutationIntentStatement, abortCanonicalMutation } from "../../audit/mutationJournal";
import { identifierTableReady } from "../../registry/identifiers";
import { requestId } from "../http";
import { isTypedDateChange, TYPED_DATE_COLUMNS, type TypedDateField } from "../../registry/typedDateValue";
import { buildRuleSubject, type RuleSubjectRecord } from "../../registry/rulesEngine";
import { enforceRegistryRules } from "./registryRules";

/**
 * R146-D05 (Master-AI plan) — field-level claims and conflict resolution.
 *
 * The reviewable case for a conflicting date, identifier or parent link:
 * every competing value is RETAINED with its source, an explicit human
 * decision selects the canonical value (through the SAME validated mutation
 * path every other write uses), the previous value + reason + actor are
 * preserved, and a reversal restores the consistent prior state with a full
 * audit trail.
 *
 * Doctrine:
 *   - A claim NEVER mutates the canonical row by itself.
 *   - A claim whose (normalized) value equals the current canonical value is
 *     not stored — no noise. A claim identical to an already-open claim from
 *     the same source is not duplicated — idempotent external refreshes.
 *   - Selecting a claim stores the previous canonical value in the decision
 *     row and supersedes any other selected claim for the same field.
 *   - Reverting restores the previous canonical value through the same
 *     guarded batch, marks the original decision reverted, and appends a
 *     'revert' decision — the audit history can always reconstruct the
 *     consistent prior state.
 */

export const FIELD_CLAIM_FIELDS: Record<string, "text" | "number" | "date" | "horse_ref"> = {
  name_latin: "text",
  name_native: "text",
  register_no: "text",
  microchip_no: "text",
  birth_year: "number",
  birth_date: "date",
  death_date: "date",
  birth_place_desc: "text",
  birth_city: "text",
  birth_province: "text",
  breed_desc: "text",
  sex_desc: "text",
  color_desc: "text",
  main_strain_desc: "text",
  sub_strain_desc: "text",
  father_id: "horse_ref",
  mother_id: "horse_ref",
};

const CLAIM_SOURCES = ["import", "external_scrape", "owner_statement", "professional", "review", "prior_canonical"] as const;

type EnvLike = { DB: D1Database; SESSION_COOKIE_NAME: string };

export interface FieldClaimInput {
  field_name: string;
  claimed_value: unknown;
  source_type: (typeof CLAIM_SOURCES)[number];
  source_ref?: string | null;
  evidence?: unknown;
  observed_at?: string | null;
  created_by?: string | null;
}

/** Canonical scalar for a field from the live row — normalized the same way
 *  the claim comparison normalizes (trim; parents/years as plain strings). */
function canonicalScalar(row: HorseRow | Record<string, unknown>, field: string): string | null {
  if (FIELD_CLAIM_FIELDS[field] === "date") {
    const columns = TYPED_DATE_COLUMNS[field as TypedDateField];
    const record = row as Record<string, unknown>;
    if (!columns || record[columns.value] == null) return null;
    return JSON.stringify({ value: record[columns.value], precision: record[columns.precision], calendar: record[columns.calendar] });
  }
  const raw = (row as Record<string, unknown>)[field];
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

function claimScalar(field: string, kind: "text" | "number" | "date" | "horse_ref", value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (kind === "number") {
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : null;
  }
  if (kind === "horse_ref") {
    const num = Number(value);
    return Number.isSafeInteger(num) && num > 0 ? String(num) : null;
  }
  if (kind === "date") {
    const typed = typeof value === "object" && value !== null ? value : {
      value: String(value), precision: datePrecisionFromValue(String(value)), calendar: "gregorian",
    };
    return JSON.stringify(typed);
  }
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** Record competing field claims for one horse. Idempotent: canonical matches
 *  and same-source duplicates are skipped. Returns the per-field disposition. */
export async function recordFieldClaims(
  db: D1Database,
  horseId: number,
  claims: FieldClaimInput[],
): Promise<Array<{ field_name: string; disposition: "recorded" | "matches_canonical" | "duplicate_open_claim" | "unsupported_field"; claim_id?: number }>> {
  if (!claims.length) return [];
  const row = await db.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first<HorseRow>();
  if (!row) throw new HttpError(404, "not_found", "Horse not found");
  const openClaims = (await db
    .prepare(`SELECT id,field_name,claimed_value,value_kind,source_type,source_ref FROM field_claims
              WHERE horse_id=? AND review_status='pending'`)
    .bind(horseId)
    .all()).results as Array<Record<string, unknown>>;
  const openByKey = new Set(openClaims.map((claim) => JSON.stringify([claim.field_name, claim.claimed_value == null ? "" : String(claim.claimed_value), claim.source_type, claim.source_ref ?? ""])));
  const dispositions: Array<{ field_name: string; disposition: string; claim_id?: number }> = [];
  for (const claim of claims) {
    const kind = FIELD_CLAIM_FIELDS[claim.field_name];
    if (!kind) {
      dispositions.push({ field_name: claim.field_name, disposition: "unsupported_field" });
      continue;
    }
    const scalar = claimScalar(claim.field_name, kind, claim.claimed_value);
    const canonical = canonicalScalar(row, claim.field_name);
    if (scalar == null || scalar === canonical) {
      dispositions.push({ field_name: claim.field_name, disposition: "matches_canonical" });
      continue;
    }
    const sourceRef = claim.source_ref ?? null;
    const key = JSON.stringify([claim.field_name, scalar, claim.source_type, sourceRef ?? ""]);
    if (openByKey.has(key)) {
      dispositions.push({ field_name: claim.field_name, disposition: "duplicate_open_claim" });
      continue;
    }
    openByKey.add(key);
    const evidence = claim.evidence == null ? null : JSON.stringify(claim.evidence);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([horseId, key])));
    const dedupeKey = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    const result = await db
      .prepare(`INSERT OR IGNORE INTO field_claims(horse_id,field_name,claimed_value,value_kind,source_type,source_ref,evidence_json,observed_at,created_by,dedupe_key)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(horseId, claim.field_name, scalar, kind, claim.source_type, sourceRef, evidence, claim.observed_at ?? null, claim.created_by ?? null, dedupeKey)
      .run();
    const receipt = await db.prepare("SELECT id FROM field_claims WHERE dedupe_key=? AND review_status='pending'").bind(dedupeKey).first<{ id: number }>();
    if (!receipt) throw new HttpError(409, "claim_intake_conflict", "The source assertion changed while it was being recorded; reload before retrying");
    dispositions.push({ field_name: claim.field_name, disposition: Number(result.meta.changes) === 1 ? "recorded" : "duplicate_open_claim", claim_id: Number(receipt.id) });
  }
  return dispositions as Array<{ field_name: string; disposition: "recorded" | "matches_canonical" | "duplicate_open_claim" | "unsupported_field"; claim_id?: number }>;
}

// ---------------------------------------------------------------------------
// Admin HTTP handlers
// ---------------------------------------------------------------------------

const SelectSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

const RejectSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

const RevertSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

function claimView(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    horse_id: Number(row.horse_id),
    field_name: String(row.field_name),
    claimed_value: row.claimed_value == null ? null : String(row.claimed_value),
    value_kind: String(row.value_kind),
    source_type: String(row.source_type),
    source_ref: row.source_ref == null ? null : String(row.source_ref),
    evidence: row.evidence_json == null ? null : safeParse(row.evidence_json as string),
    observed_at: row.observed_at == null ? null : String(row.observed_at),
    review_status: String(row.review_status),
    created_at: String(row.created_at),
  };
}

function decisionView(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    horse_id: Number(row.horse_id),
    field_name: String(row.field_name),
    decision: String(row.decision),
    claim_id: row.claim_id == null ? null : Number(row.claim_id),
    previous_canonical: row.previous_canonical_json == null ? null : safeParse(row.previous_canonical_json as string),
    applied_value: row.applied_value == null ? null : String(row.applied_value),
    decided_by: String(row.decided_by),
    reason: String(row.reason),
    reverted_by_decision_id: row.reverted_by_decision_id == null ? null : Number(row.reverted_by_decision_id),
    created_at: String(row.created_at),
  };
}

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _unparsed: text };
  }
}

/** The reviewer's case view: current canonical per claimed field + every
 *  claim (supporting and contradictory) + the decision history. */
export async function adminHorseFieldClaims(request: Request, env: EnvLike, horseId: number): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "quality.read");
  const horse = await env.DB.prepare("SELECT id,name_latin,row_version,deleted_at FROM horses WHERE id=?").bind(horseId).first<Record<string, unknown>>();
  if (!horse || Number(horse.deleted_at != null ? 1 : 0) === 1) throw new HttpError(404, "not_found", "Horse not found");
  const claims = (await env.DB
    .prepare("SELECT id,horse_id,field_name,claimed_value,value_kind,source_type,source_ref,evidence_json,observed_at,review_status,created_at FROM field_claims WHERE horse_id=? ORDER BY field_name,id")
    .bind(horseId)
    .all()).results as Array<Record<string, unknown>>;
  const decisions = (await env.DB
    .prepare("SELECT id,horse_id,field_name,decision,claim_id,previous_canonical_json,applied_value,decided_by,reason,reverted_by_decision_id,created_at FROM field_claim_decisions WHERE horse_id=? ORDER BY id DESC LIMIT 200")
    .bind(horseId)
    .all()).results as Array<Record<string, unknown>>;
  const current = await env.DB.prepare("SELECT * FROM horses WHERE id=?").bind(horseId).first<Record<string, unknown>>();
  const fields: Record<string, { canonical: string | null; claims: ReturnType<typeof claimView>[] }> = {};
  for (const claim of claims) {
    const fieldName = String(claim.field_name);
    if (!fields[fieldName]) {
      const raw = current ? (current as Record<string, unknown>)[fieldName] : null;
      fields[fieldName] = { canonical: canonicalScalar((current ?? {}) as unknown as HorseRow, fieldName) ?? (raw == null ? null : String(raw)), claims: [] };
    }
    fields[fieldName].claims.push(claimView(claim));
  }
  return json({
    horse_id: horseId,
    name_latin: horse.name_latin == null ? null : String(horse.name_latin),
    row_version: Number(horse.row_version),
    fields,
    decisions: decisions.map(decisionView),
  });
}

async function loadClaim(db: D1Database, horseId: number, claimId: number): Promise<Record<string, unknown>> {
  const claim = await db.prepare("SELECT * FROM field_claims WHERE id=? AND horse_id=?").bind(claimId, horseId).first<Record<string, unknown>>();
  if (!claim) throw new HttpError(404, "claim_not_found", "Field claim not found for this horse");
  return claim;
}

/** Apply a raw change set through the SHARED mutation path (validation,
 *  normalization, cycle guard, guarded batch, revision bump, reindex). */
function fieldRawValue(field: string, value: unknown): unknown {
  if (value == null) return null;
  const kind = FIELD_CLAIM_FIELDS[field];
  if (!kind) throw new HttpError(422, "unsupported_claim_field", "This claim field is not supported");
  if (kind === "date") {
    if (typeof value === "object") return value;
    if (String(value).startsWith("{")) return safeParse(String(value));
    return { value: String(value), precision: datePrecisionFromValue(String(value)), calendar: "gregorian" };
  }
  if (kind === "horse_ref" || kind === "number") return Number(value);
  return String(value);
}

const CLAIM_ACTOR_SQL = "EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))";
const landed = "EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)";

async function applyCanonicalFieldChange(
  db: D1Database,
  request: Request,
  horseId: number,
  rawChanges: Record<string, unknown>,
  actorUserId: string,
  action: string,
  before: HorseRow,
  mutationMeta: Record<string, unknown>,
  guard: { sql: string; bindings: Array<string | number | null> },
  decisions: (mutationId: string, plan: ReturnType<typeof planHorseMutation>) => D1PreparedStatement[],
  policySourceId?: number,
): Promise<string> {
  let plan;
  try { plan = planHorseMutation(before, rawChanges, { allowLifecycleCorrection: action === "field_claim.revert" }); }
  catch (cause) {
    if (cause instanceof MutationPlanError) throw new HttpError(cause.code === "unsupported_field" ? 400 : 422, cause.code, cause.message);
    throw cause;
  }
  if (!Object.keys(plan.normalizedChanges).length) throw new HttpError(422, "claim_no_effect", "The claimed value already matches the canonical record");
  await assertNoLiveHorseDuplicates(db, horseId, plan.normalizedChanges);
  if (plan.parentageChanged) await assertValidParentAssignment(db, horseId, plan.nextFather, plan.nextMother);
  const merged: Record<string, unknown> = { ...before, ...plan.normalizedChanges, horse_id: horseId };
  for (const [field, value] of Object.entries(plan.normalizedChanges)) {
    if (!isTypedDateChange(value)) continue;
    const columns = TYPED_DATE_COLUMNS[field as TypedDateField];
    merged[columns.value] = value.date?.value ?? null;
    merged[columns.precision] = value.date?.precision ?? null;
    merged[columns.calendar] = value.date?.calendar ?? null;
    if (field === "birth_date" && plan.normalizedChanges.birth_year === undefined) merged.birth_year = value.gregorianYear;
  }
  const ruleSubject = await buildRuleSubject(db, { subjectType: "horse_update", subjectRef: horseId, record: merged as RuleSubjectRecord, includeEvidenceCounts: true, importSourceId: policySourceId });
  const rules = await enforceRegistryRules(db, ruleSubject, []);
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const { updateStatement, afterUpdateStatements } = buildCanonicalHorseUpdateStatements(db, {
    plan, horseId, expectedRowVersion: before.row_version, mutationId,
    identifierTableReady: await identifierTableReady(db),
    additionalGuard: { sql: `${CLAIM_ACTOR_SQL} AND (${guard.sql})`, bindings: [actorUserId, ...guard.bindings] },
  });
  const results = await runGuardedHorseBatch(db, [
    canonicalMutationIntentStatement(db, { id: mutationId, actorUserId, action, entityType: "horse", entityId: String(horseId),
      before, requested: { ...rawChanges, ...mutationMeta }, requestId: reqId, searchStatus: "pending" }),
    updateStatement, ...afterUpdateStatements, ...decisions(mutationId, plan),
  ], plan.effectiveIdentifierChanges, { graphLock: plan.parentageChanged,
    policy: { subject: ruleSubject, ...rules, operationId: mutationId, actorUserId } });
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(db, mutationId, "field-claim decision lost the concurrency race"); } catch {}
    throw new HttpError(409, "edit_conflict", "The record or claim changed. Reload before making another decision.");
  }
  const after = await db.prepare("SELECT * FROM horses WHERE id=?").bind(horseId).first();
  await settleCanonicalHorseMutation(db, mutationId, horseId, actorUserId, action, before, after, reqId);
  return mutationId;
}

/** Infer the typed-date precision from an ISO-shaped claim value. */
function datePrecisionFromValue(value: string): "day" | "month" | "year" {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "day";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  return "year";
}

export async function adminSelectFieldClaim(request: Request, env: EnvLike, horseId: number, claimId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = SelectSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_select", "Claim selection failed validation", parsed.error.flatten());
  const claim = await loadClaim(env.DB, horseId, claimId);
  if (claim.review_status !== "pending") throw new HttpError(409, "claim_not_pending", "Only a pending claim can be selected");
  const before = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first<HorseRow>();
  if (!before) throw new HttpError(404, "not_found", "Horse not found");
  let sourceGuard = { sql: "1=1", bindings: [] as Array<string | number> };
  let policySourceId: number | undefined;
  if (claim.source_type === "import") {
    const provenance = /^batch:(\d+):row:(\d+)$/.exec(String(claim.source_ref ?? ""));
    if (!provenance) throw new HttpError(422, "import_publication_authority_required", "An imported claim requires traceable staging provenance and a current redistribution agreement");
    sourceGuard = {
      sql: "EXISTS(SELECT 1 FROM import_staging_rows r JOIN import_batches b ON b.id=r.batch_id JOIN import_sources s ON s.id=b.source_id WHERE r.batch_id=? AND r.id=? AND r.horse_id=? AND s.is_synthetic=0 AND s.redistribution_allowed=1)",
      bindings: [Number(provenance[1]), Number(provenance[2]), horseId],
    };
    const allowedSource = await env.DB.prepare(`SELECT s.id FROM import_sources s JOIN import_batches b ON b.source_id=s.id
      JOIN import_staging_rows r ON r.batch_id=b.id WHERE r.batch_id=? AND r.id=? AND r.horse_id=? AND s.is_synthetic=0 AND s.redistribution_allowed=1`)
      .bind(...sourceGuard.bindings).first<{ id: number }>();
    if (!allowedSource) {
      throw new HttpError(422, "import_publication_authority_required", "Restricted source evidence must remain staged until its redistribution authority is reviewed");
    }
    policySourceId = Number(allowedSource.id);
  }
  const fieldName = String(claim.field_name);
  const rawValue = fieldRawValue(fieldName, claim.claimed_value);
  const previousCanonical = canonicalScalar(before, fieldName);
  const priorRelated = fieldName === "birth_date" ? { birth_year: before.birth_year }
    : fieldName === "death_date" ? { is_dead: before.is_dead, life_status: (before as unknown as Record<string, unknown>).life_status ?? null } : {};
  await applyCanonicalFieldChange(env.DB, request, horseId, { [fieldName]: rawValue }, auth.user.id, "field_claim.select", before, { field_claim_id: claimId },
    { sql: `EXISTS(SELECT 1 FROM field_claims WHERE id=? AND horse_id=? AND review_status='pending') AND (${sourceGuard.sql})`, bindings: [claimId, horseId, ...sourceGuard.bindings] },
    (mutationId, plan) => {
      const applied = plan.normalizedChanges[fieldName];
      const appliedValue = isTypedDateChange(applied) ? (applied.date ? JSON.stringify(applied.date) : null) : applied == null ? null : String(applied);
      return [
        env.DB.prepare(`UPDATE field_claims SET review_status='superseded' WHERE horse_id=? AND field_name=? AND review_status='selected' AND id<>? AND ${landed}`).bind(horseId, fieldName, claimId, horseId, mutationId),
        env.DB.prepare(`UPDATE field_claims SET review_status='selected' WHERE id=? AND horse_id=? AND review_status='pending' AND ${landed}`).bind(claimId, horseId, horseId, mutationId),
        env.DB.prepare(`INSERT INTO field_claim_decisions(horse_id,field_name,decision,claim_id,previous_canonical_json,applied_value,decided_by,reason,mutation_id)
          SELECT ?,?,'select_claim',?,?,?,?,?,? WHERE ${landed}`)
          .bind(horseId, fieldName, claimId, JSON.stringify({ value: previousCanonical, ...(Object.keys(priorRelated).length ? { related: priorRelated } : {}) }), appliedValue, auth.user.id, parsed.data.reason, mutationId, horseId, mutationId),
      ];
    }, policySourceId);
  return json({ ok: true, claim: claimView(await loadClaim(env.DB, horseId, claimId)), applied_value: canonicalScalar((await env.DB.prepare("SELECT * FROM horses WHERE id=?").bind(horseId).first<HorseRow>())!, fieldName), previous_canonical: previousCanonical });
}

export async function adminRejectFieldClaim(request: Request, env: EnvLike, horseId: number, claimId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = RejectSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reject", "Claim rejection failed validation", parsed.error.flatten());
  const claim = await loadClaim(env.DB, horseId, claimId);
  if (claim.review_status !== "pending") throw new HttpError(409, "claim_not_pending", "Only a pending claim can be rejected");
  const horse = await env.DB.prepare("SELECT row_version FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first<{ row_version: number }>();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  const mutationId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE horses SET row_version=row_version+1,last_mutation_id=? WHERE id=? AND row_version=? AND deleted_at IS NULL
      AND ${CLAIM_ACTOR_SQL} AND EXISTS(SELECT 1 FROM field_claims WHERE id=? AND horse_id=? AND review_status='pending')`)
      .bind(mutationId, horseId, horse.row_version, auth.user.id, claimId, horseId),
    env.DB.prepare(`UPDATE field_claims SET review_status='rejected' WHERE id=? AND horse_id=? AND review_status='pending' AND ${landed}`).bind(claimId, horseId, horseId, mutationId),
    env.DB.prepare(`INSERT INTO field_claim_decisions(horse_id,field_name,decision,claim_id,previous_canonical_json,applied_value,decided_by,reason,mutation_id)
      SELECT ?,?,'keep_canonical',?,NULL,NULL,?,?,? WHERE ${landed}`)
      .bind(horseId, String(claim.field_name), claimId, auth.user.id, parsed.data.reason, mutationId, horseId, mutationId),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) throw new HttpError(409, "claim_not_pending", "The horse or claim changed; no rejection was accepted");
  return json({ ok: true, claim: claimView(await loadClaim(env.DB, horseId, claimId)) });
}

/** Reverse only the still-current selection. A later edit or selection is a
 * conflict requiring review, never permission to overwrite current evidence. */
export async function adminRevertFieldClaimDecision(request: Request, env: EnvLike, horseId: number, decisionId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = RevertSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_revert", "Decision revert failed validation", parsed.error.flatten());
  const decision = await env.DB.prepare("SELECT * FROM field_claim_decisions WHERE id=? AND horse_id=?").bind(decisionId, horseId).first<Record<string, unknown>>();
  if (!decision) throw new HttpError(404, "decision_not_found", "Decision not found for this horse");
  if (decision.decision !== "select_claim") throw new HttpError(422, "not_revertible", "Only a select_claim decision can be reverted");
  if (decision.reverted_by_decision_id != null) throw new HttpError(409, "already_reverted", "This decision has already been reverted");
  const before = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first<HorseRow>();
  if (!before) throw new HttpError(404, "not_found", "Horse not found");
  const fieldName = String(decision.field_name);
  const currentCanonical = canonicalScalar(before, fieldName);
  const claim = await loadClaim(env.DB, horseId, Number(decision.claim_id));
  if (claim.review_status !== "selected" || currentCanonical !== decision.applied_value || (before as unknown as Record<string, unknown>).last_mutation_id !== decision.mutation_id) {
    throw new HttpError(409, "field_claim_revert_conflict", "The selection is no longer the current accepted record; review subsequent changes before reverting");
  }
  const previous = safeParse(String(decision.previous_canonical_json ?? "null")) as { value?: unknown; related?: Record<string, unknown> } | null;
  const restoreValue = previous?.value ?? null;
  const changes: Record<string, unknown> = { [fieldName]: fieldRawValue(fieldName, restoreValue) };
  for (const key of fieldName === "birth_date" ? ["birth_year"] : fieldName === "death_date" ? ["is_dead", "life_status"] : []) {
    if (previous?.related && previous.related[key] !== undefined && (key !== "life_status" || previous.related[key] != null)) changes[key] = previous.related[key];
  }
  await applyCanonicalFieldChange(env.DB, request, horseId, changes, auth.user.id, "field_claim.revert", before, { revert_of_decision_id: decisionId },
    { sql: "EXISTS(SELECT 1 FROM field_claim_decisions WHERE id=? AND horse_id=? AND reverted_by_decision_id IS NULL) AND EXISTS(SELECT 1 FROM field_claims WHERE id=? AND review_status='selected')", bindings: [decisionId, horseId, Number(decision.claim_id)] },
    mutationId => [
      env.DB.prepare(`INSERT INTO field_claim_decisions(horse_id,field_name,decision,claim_id,previous_canonical_json,applied_value,decided_by,reason,mutation_id)
        SELECT ?,?,'revert',?,?,?,?,?,? WHERE ${landed}`)
        .bind(horseId, fieldName, Number(decision.claim_id), JSON.stringify({ value: currentCanonical }), restoreValue, auth.user.id, parsed.data.reason, mutationId, horseId, mutationId),
      env.DB.prepare(`UPDATE field_claim_decisions SET reverted_by_decision_id=(SELECT id FROM field_claim_decisions WHERE mutation_id=? AND decision='revert') WHERE id=? AND reverted_by_decision_id IS NULL AND ${landed}`).bind(mutationId, decisionId, horseId, mutationId),
      env.DB.prepare(`UPDATE field_claims SET review_status='pending' WHERE id=? AND review_status='selected' AND ${landed}`).bind(Number(decision.claim_id), horseId, mutationId),
    ]);
  return json({ ok: true, reverted_decision_id: decisionId, restored_value: restoreValue });
}

/** List open claims across the registry (the reviewer's worklist). */
export async function adminFieldClaimQueue(request: Request, env: EnvLike): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "quality.read");
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  if (!["pending", "selected", "rejected", "superseded", "all"].includes(status)) throw new HttpError(400, "invalid_status", "Unknown claim status filter");
  const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) throw new HttpError(400, "invalid_limit", "limit must be an integer from 1 to 500");
  const limit = requestedLimit;
  const where = status === "all" ? "" : "WHERE review_status=?";
  const binds = status === "all" ? [] : [status];
  const rows = (await env.DB
    .prepare(`SELECT c.id,c.horse_id,c.field_name,c.claimed_value,c.value_kind,c.source_type,c.source_ref,c.evidence_json,c.observed_at,c.review_status,c.created_at,
                     h.name_latin AS horse_name
              FROM field_claims c JOIN horses h ON h.id=c.horse_id
              ${where} ORDER BY c.id DESC LIMIT ${limit}`)
    .bind(...binds)
    .all()).results as Array<Record<string, unknown>>;
  const counts = await env.DB.prepare("SELECT review_status, COUNT(*) AS count FROM field_claims GROUP BY review_status").all();
  return json({
    claims: rows.map((row) => ({ ...claimView(row), horse_name: row.horse_name == null ? null : String(row.horse_name) })),
    counts: Object.fromEntries((counts.results as Array<Record<string, unknown>>).map((row) => [String(row.review_status), Number(row.count)])),
    limit,
  });
}
