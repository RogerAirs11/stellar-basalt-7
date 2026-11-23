import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { pedigreeGraphLockStatement } from "./mutationStatements";
import type { RuleEvaluationOutcome, RuleEvaluationSubject, RuleSubjectRecord } from "./rulesEngine";

export type PolicyBinding = string | number | null;
/** Internal SQL only. Nothing in this shape is accepted from an HTTP payload. */
export interface PolicySql { sql: string; bindings: PolicyBinding[] }
export interface RegistryPolicyContext {
  revision: number;
  locks: PolicySql[];
  checks: PolicySql[];
  facts: Record<string, unknown>;
}
export interface RegistryPolicyCommit {
  subject: RuleEvaluationSubject;
  outcome: RuleEvaluationOutcome;
  overrides: Array<{ rule_id: string; reason: string }>;
  operationId: string;
  actorUserId: string | null;
  /** Only the command that actually won may emit receipts. */
  landed?: PolicySql;
  decision?: "accepted" | "rejected";
}

const POLICY_INPUT_FIELDS = ["horse_id", "name_latin", "breed_desc", "sex_desc", "register_no", "microchip_no", "birth_year",
  "birth_date_value", "birth_date_precision", "birth_date_calendar", "death_date_value", "death_date_precision", "death_date_calendar",
  "birth_year_from_date", "death_year_from_date", "is_dead", "father_id", "mother_id", "father_birth_year", "mother_birth_year",
  "father_death_year", "mother_death_year", "father_sex", "mother_sex", "father_breed_desc", "mother_breed_desc", "evidence_photo_count", "evidence_document_count",
  // R149 Gate E — server-built care facts (never accepted from an HTTP record).
  "care_command", "care_method", "care_offspring_count", "care_recipient_dam_id", "care_sire_id", "care_evidence_present", "care_covering_on", "care_transfer_on",
] as const satisfies readonly (keyof RuleSubjectRecord)[];

/** File presence, not authenticity. Laboratory/other attachments do not
 * satisfy passport/registration policy and incomplete blobs never count. */
export async function registrationEvidenceCounts(db: D1Database, requestId: string): Promise<{ evidence_photo_count: number; evidence_document_count: number }> {
  const row = await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN e.role='identity_photo' AND e.mime_type IN ('image/jpeg','image/png','image/webp') THEN 1 ELSE 0 END),0) AS photos,
    COALESCE(SUM(CASE WHEN e.role IN ('passport','registration') AND e.mime_type IN ('application/pdf','image/jpeg','image/png','image/webp') THEN 1 ELSE 0 END),0) AS documents
    FROM request_evidence e WHERE e.request_id=? AND e.deleted_at IS NULL
      AND e.size_bytes=(SELECT COALESCE(SUM(length(b.data)),0) FROM request_evidence_blobs b WHERE b.evidence_id=e.id)`)
    .bind(requestId).first<{ photos: number; documents: number }>();
  return { evidence_photo_count: Number(row?.photos ?? 0), evidence_document_count: Number(row?.documents ?? 0) };
}

export async function newRegistryPolicyContext(db: D1Database): Promise<RegistryPolicyContext> {
  const row = await db.prepare("SELECT revision FROM registry_policy_state WHERE id=1").first<{ revision: number }>();
  // A missing migration/state row is an operational failure, never permission
  // to accept an unevaluated write.
  if (!row || !Number.isSafeInteger(Number(row.revision))) throw new HttpError(503, "registry_policy_unavailable", "Registry policy state is unavailable; no change was accepted");
  return { revision: Number(row.revision), locks: [], checks: [], facts: {} };
}

/** Null-safe comparisons with explicit null parameter typing on PostgreSQL. */
export function policyRowMatches(table: string, row: Record<string, unknown>, columns: readonly string[]): PolicySql {
  const bindings: PolicyBinding[] = [];
  const comparisons = columns.map((column) => {
    const value = row[column] == null ? null : typeof row[column] === "number" ? row[column] as number : String(row[column]);
    bindings.push(value, value);
    return `(${column}=? OR (${column} IS NULL AND CAST(? AS TEXT) IS NULL))`;
  });
  return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${comparisons.join(" AND ")})`, bindings };
}

export const POLICY_RULE_COLUMNS = ["id", "rule_type", "title", "severity", "applicability_json", "spec_json", "state", "version"] as const;
export const POLICY_SOURCE_COLUMNS = ["id", "issuer_namespace", "is_synthetic", "redistribution_allowed", "scope_note", "retention_note", "license_note"] as const;

// Ordinary registration policy must not depend on the existence of private
// medical/genetic records. Legacy files may carry a generic role despite a
// sensitive binding, so exclude both the role and every clinical binding.
// A voided/rejected report remains private history; its file is still excluded.
// `m` is always an internal horse_media alias, never supplied by a caller.
export const REGISTRY_EVIDENCE_MEDIA_PREDICATE = `m.role<>'veterinary'
  AND m.verification<>'rejected' AND m.quarantined_at IS NULL AND m.quarantine_reason IS NULL
  AND NOT EXISTS(SELECT 1 FROM genetic_tests policy_genetic WHERE policy_genetic.certificate_media_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM equine_clinical_events policy_clinical WHERE policy_clinical.evidence_media_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM equine_reproductive_episodes policy_reproduction WHERE policy_reproduction.evidence_media_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM equine_samples policy_sample WHERE policy_sample.evidence_media_id=m.id)
  AND NOT EXISTS(SELECT 1 FROM equine_lab_reports policy_report WHERE policy_report.evidence_media_id=m.id)`;

// The sorted, length-delimited ID/version sequence distinguishes same-count
// evidence replacement. Only eligible, nonclinical files enter the receipt.
export const HORSE_MEDIA_POLICY_TOKEN_SQL = `SELECT COALESCE(GROUP_CONCAT(token,'|'),'') AS token FROM
  (SELECT length(m.id)||':'||m.id||':'||m.row_version AS token FROM horse_media m
    WHERE m.horse_id=? AND ${REGISTRY_EVIDENCE_MEDIA_PREDICATE} ORDER BY m.id) AS policy_media`;

export async function capturePolicySource(db: D1Database, context: RegistryPolicyContext, sourceId: number): Promise<void> {
  const row = await db.prepare(`SELECT ${POLICY_SOURCE_COLUMNS.join(",")} FROM import_sources WHERE id=?`).bind(sourceId).first<Record<string, unknown>>();
  if (!row) throw new HttpError(409, "registry_policy_context_changed", "The source agreement changed; reload and review it before retrying");
  context.locks.push({ sql: "UPDATE import_sources SET is_synthetic=is_synthetic WHERE id=?", bindings: [sourceId] });
  context.checks.push(policyRowMatches("import_sources", row, POLICY_SOURCE_COLUMNS));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(row)));
  // Keep the exact agreement snapshot privately: changing the source record
  // later must not reinterpret the authority used for an earlier acceptance.
  context.facts.source_agreement = { snapshot: row, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("") };
}

export function policyStateLockStatement(db: D1Database): D1PreparedStatement {
  return db.prepare("UPDATE registry_policy_state SET revision=revision WHERE id=1");
}

export function policyRevisionBumpStatement(db: D1Database, ruleId: string, operationId: string): D1PreparedStatement {
  return db.prepare(`UPDATE registry_policy_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=1 AND EXISTS(SELECT 1 FROM registry_rules WHERE id=? AND last_policy_operation_id=?)`).bind(ruleId, operationId);
}

export function isRegistryPolicyContextError(cause: unknown): boolean {
  const detail = cause as { constraint?: unknown; message?: unknown; cause?: unknown } | null;
  return /registry_policy_context_current/.test(String(detail?.constraint ?? ""))
    || /registry_policy_context_current/.test(String(detail?.message ?? cause ?? ""))
    || (detail?.cause != null && detail.cause !== cause && isRegistryPolicyContextError(detail.cause));
}

function outcomeStatements(db: D1Database, commit: RegistryPolicyCommit, landed: PolicySql, subjectRef: string | null): D1PreparedStatement[] {
  const reasons = new Map(commit.overrides.map((override) => [override.rule_id, override.reason]));
  const entries = commit.outcome.failures.map((failure) => {
    const reason = reasons.get(failure.rule_id);
    const overridden = reason != null && failure.rule_state !== "report_only" && (failure.severity === "warning" || failure.severity === "error");
    return { id: failure.rule_id, version: failure.rule_version, overridden, reason: overridden ? reason! : null,
      detail: { requirement: failure.requirement, detail: failure.detail ?? null, severity: failure.severity } as Record<string, unknown> };
  });
  for (const override of commit.overrides) {
    if (commit.outcome.failures.some((failure) => failure.rule_id === override.rule_id)) continue;
    const rule = commit.outcome.evaluatedRules.find((candidate) => candidate.rule_id === override.rule_id);
    if (rule) entries.push({ id: rule.rule_id, version: rule.version, overridden: true, reason: override.reason, detail: { note: "override supplied; rule did not fail" } });
  }
  return entries.map((entry) => db.prepare(`INSERT INTO registry_rule_outcomes
    (rule_id,rule_version,subject_type,subject_ref,outcome,detail_json,override_by,override_reason,operation_id,policy_revision)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (${landed.sql})`)
    .bind(entry.id, entry.version, commit.subject.subjectType, subjectRef, entry.overridden ? "override" : "fail", JSON.stringify(entry.detail),
      entry.overridden ? commit.actorUserId : null, entry.reason, commit.operationId, commit.outcome.policyRevision, ...landed.bindings));
}

/**
 * A canonical admission, its context proof and all rule receipts are ONE
 * transaction. The graph lock also serializes merge/unmerge/parent changes;
 * the policy row serializes admissions against rule activation/retirement.
 * Resource locks precede a separate CHECK statement: PostgreSQL READ COMMITTED
 * must evaluate after a lock wait, not reuse the locking statement's snapshot.
 *
 * Receipt statements are last. A receipt storage error rolls everything back.
 * Returned indexes always refer to the caller's original statements.
 */
export async function runRegistryPolicyBatch(
  db: D1Database, statements: D1PreparedStatement[], commit: RegistryPolicyCommit,
): Promise<D1Result[]> {
  const context = commit.subject.policyContext;
  if (!context || context.revision !== commit.outcome.policyRevision) throw new HttpError(409, "registry_policy_context_changed", "Registry policy context changed; reload and retry");
  const policyRules = commit.outcome.policyRules;
  const checks: PolicySql[] = [
    { sql: "revision=?", bindings: [context.revision] },
    { sql: "(SELECT COUNT(*) FROM registry_rules WHERE state IN ('active','report_only'))=?", bindings: [policyRules.length] },
    ...policyRules.map((rule) => policyRowMatches("registry_rules", rule, POLICY_RULE_COLUMNS)),
    ...context.checks,
  ];
  const prefix = [pedigreeGraphLockStatement(db), policyStateLockStatement(db),
    // A singleton removed after preflight must fail closed too.
    db.prepare("INSERT INTO registry_policy_state(id,revision,commit_guard) SELECT 1,0,0 WHERE NOT EXISTS(SELECT 1 FROM registry_policy_state WHERE id=1)"),
    ...context.locks.map((lock) => db.prepare(lock.sql).bind(...lock.bindings)),
    ...checks.map((check) => db.prepare(`UPDATE registry_policy_state SET commit_guard=CASE WHEN (${check.sql}) THEN 1 ELSE 0 END WHERE id=1`).bind(...check.bindings)),
  ];
  const landed = commit.landed ?? { sql: "EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)", bindings: [commit.operationId] };
  const subjectRef = commit.subject.subjectRef == null ? `mutation:${commit.operationId}` : String(commit.subject.subjectRef);
  // Callers often spread a HorseRow into the in-memory subject. Persist only
  // facts the evaluator reads, never unrelated addresses or private notes.
  const record = Object.fromEntries(POLICY_INPUT_FIELDS.filter(field => commit.subject.record[field] !== undefined).map(field => [field, commit.subject.record[field]]));
  const receipts = [db.prepare(`INSERT INTO registry_policy_receipts(operation_id,policy_revision,subject_type,subject_ref,decision,evaluated_rules_json,context_json,actor_user_id)
    SELECT ?,?,?,?,?,?,?,? WHERE (${landed.sql})`)
    .bind(commit.operationId, context.revision, commit.subject.subjectType, subjectRef, commit.decision ?? "accepted", JSON.stringify(commit.outcome.evaluatedRules),
      JSON.stringify({ record, via_import: !!commit.subject.viaImport, ...context.facts }), commit.actorUserId, ...landed.bindings),
    ...outcomeStatements(db, commit, landed, subjectRef),
  ];
  try {
    const results = await db.batch([...prefix, ...statements, ...receipts]);
    return results.slice(prefix.length, prefix.length + statements.length);
  } catch (cause) {
    if (isRegistryPolicyContextError(cause)) throw new HttpError(409, "registry_policy_context_changed", "The registry policy, parents, evidence or source agreement changed while saving. No change was accepted; reload and review before retrying.");
    const code = (cause as { code?: string } | null)?.code;
    if (code === "55P03" || code === "55P02" || /lock_timeout|canceling statement due to lock timeout/i.test(cause instanceof Error ? cause.message : String(cause))) {
      throw new HttpError(409, "registry_policy_busy", "Another registry decision is being saved. No change was accepted; reload and retry in a moment.");
    }
    throw cause;
  }
}
