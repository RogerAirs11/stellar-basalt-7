import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { HttpError, json, readJson } from "../http";
import { requirePermission, requireCsrf } from "../../auth/guards";
import {
  REGISTRY_RULE_STATES,
  REGISTRY_RULE_TYPES,
  parseRuleApplicability,
  parseRuleOverrides,
  parseRuleSpec,
  rulesViolationError,
  buildRuleSubject,
  type RegistryRuleState,
  type RegistryRuleType,
  type RuleEvaluationOutcome,
  type RuleEvaluationSubject,
  type RuleSubjectRecord,
} from "../../registry/rulesEngine";
import type { Permission as PlatformPermission } from "../../auth/capabilities";
import { policyStateLockStatement, policyRevisionBumpStatement } from "../../registry/ruleCommit";

/**
 * R146-D04 (Master-AI plan) — admin HTTP surface of the versioned rules
 * service. Everything here gates on `maintenance.run` (admin+). The store
 * never executes administrator-supplied anything: a spec is validated
 * against its typed schema BEFORE it is stored, and re-validated on every
 * read.
 */

type EnvLike = { DB: D1Database; SESSION_COOKIE_NAME: string };

const RuleIdSchema = z.string().trim().min(3).max(120).regex(/^[a-z0-9][a-z0-9_.-]*$/, "rule id must be a lowercase slug (a-z 0-9 _ . -)");

const RuleCreateSchema = z.object({
  id: RuleIdSchema,
  rule_type: z.enum(REGISTRY_RULE_TYPES),
  title: z.string().trim().min(3).max(300),
  severity: z.enum(["info", "warning", "error", "blocker"]),
  applicability: z.record(z.string(), z.unknown()).optional(),
  spec: z.unknown(),
});

const RulePatchSchema = z.object({
  expected_version: z.number().int().positive(),
  title: z.string().trim().min(3).max(300).optional(),
  severity: z.enum(["info", "warning", "error", "blocker"]).optional(),
  applicability: z.record(z.string(), z.unknown()).optional(),
  spec: z.unknown().optional(),
  change_note: z.string().trim().max(2000).nullable().optional(),
});

const RuleStateSchema = z.object({
  expected_version: z.number().int().positive(),
  state: z.enum(REGISTRY_RULE_STATES),
  change_note: z.string().trim().max(2000).nullable().optional(),
});

const RulePreviewSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});

function ruleRowView(row: Record<string, unknown>) {
  const applicability = safeParse(row.applicability_json);
  const spec = safeParse(row.spec_json);
  return {
    id: String(row.id),
    rule_type: String(row.rule_type),
    title: String(row.title),
    severity: String(row.severity),
    applicability,
    spec,
    state: String(row.state),
    version: Number(row.version),
    created_by: row.created_by == null ? null : String(row.created_by),
    updated_by: row.updated_by == null ? null : String(row.updated_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function safeParse(text: unknown): unknown {
  if (typeof text !== "string" || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _unparsed: text };
  }
}

async function loadRule(db: D1Database, id: string): Promise<Record<string, unknown>> {
  const row = await db
    .prepare("SELECT id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by,created_at,updated_at FROM registry_rules WHERE id=?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, "rule_not_found", "Registry rule not found");
  return row;
}

function appendVersionStatement(db: D1Database, row: Record<string, unknown>, changedBy: string, changeNote: string | null, operationId: string) {
  return db
    .prepare(`INSERT INTO registry_rule_versions(rule_id,version,state,title,severity,applicability_json,spec_json,changed_by,change_note)
      SELECT id,version,state,title,severity,applicability_json,spec_json,?,? FROM registry_rules
      WHERE id=? AND version=? AND last_policy_operation_id=? AND NOT EXISTS(SELECT 1 FROM registry_rule_versions rv WHERE rv.rule_id=registry_rules.id AND rv.version=registry_rules.version)`)
    .bind(changedBy, changeNote, String(row.id), Number(row.version), operationId);
}

export async function adminListRegistryRules(request: Request, env: EnvLike): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run" as PlatformPermission);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const ruleType = url.searchParams.get("rule_type");
  if (state && !REGISTRY_RULE_STATES.includes(state as RegistryRuleState)) throw new HttpError(400, "invalid_state", "Unknown rule state filter");
  if (ruleType && !REGISTRY_RULE_TYPES.includes(ruleType as RegistryRuleType)) throw new HttpError(400, "invalid_rule_type", "Unknown rule type filter");
  const clauses: string[] = [];
  const binds: string[] = [];
  if (state) {
    clauses.push("state=?");
    binds.push(state);
  }
  if (ruleType) {
    clauses.push("rule_type=?");
    binds.push(ruleType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await env.DB.prepare(`SELECT id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by,created_at,updated_at FROM registry_rules ${where} ORDER BY id LIMIT 500`).bind(...binds).all()).results as Array<Record<string, unknown>>;
  const openOutcomes = await env.DB.prepare("SELECT rule_id, COUNT(*) AS count FROM registry_rule_outcomes WHERE outcome='fail' AND created_at > datetime('now','-30 days') GROUP BY rule_id").all();
  const failCounts = new Map<string, number>((openOutcomes.results as Array<Record<string, unknown>>).map((row) => [String(row.rule_id), Number(row.count)]));
  return json({
    rules: rows.map(ruleRowView),
    recent_fail_counts_30d: Object.fromEntries(failCounts),
    total: rows.length,
  });
}

export async function adminCreateRegistryRule(request: Request, env: EnvLike): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run" as PlatformPermission);
  requireCsrf(request, auth);
  const parsed = RuleCreateSchema.safeParse(await readJson<unknown>(request, 128 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_rule", "Rule data failed validation", parsed.error.flatten());
  const specCheck = parseRuleSpec(parsed.data.rule_type, parsed.data.spec);
  if (!specCheck.ok) throw new HttpError(422, "invalid_rule_spec", "The rule spec does not satisfy its typed schema (executable policy is not possible)", specCheck.issues);
  const applicabilityCheck = parseRuleApplicability(parsed.data.applicability);
  if (!applicabilityCheck.ok) throw new HttpError(422, "invalid_rule_applicability", "The rule applicability does not satisfy its schema", applicabilityCheck.issues);
  const existing = await env.DB.prepare("SELECT id FROM registry_rules WHERE id=?").bind(parsed.data.id).first();
  if (existing) throw new HttpError(409, "rule_exists", "A rule with this id already exists");
  const operationId = crypto.randomUUID();
  const [, update] = await env.DB.batch([
    policyStateLockStatement(env.DB),
    env.DB
      .prepare("INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by,last_policy_operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(parsed.data.id, parsed.data.rule_type, parsed.data.title, parsed.data.severity, JSON.stringify(applicabilityCheck.applicability), JSON.stringify(specCheck.spec), "draft", 1, auth.user.id, auth.user.id, operationId),
    env.DB
      .prepare("INSERT INTO registry_rule_versions(rule_id,version,state,title,severity,applicability_json,spec_json,changed_by,change_note) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(parsed.data.id, 1, "draft", parsed.data.title, parsed.data.severity, JSON.stringify(applicabilityCheck.applicability), JSON.stringify(specCheck.spec), auth.user.id, "created"),
    policyRevisionBumpStatement(env.DB, parsed.data.id, operationId),
  ]);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "rule_version_conflict", "The rule changed while it was being created");
  const row = await loadRule(env.DB, parsed.data.id);
  return json({ rule: ruleRowView(row) }, { status: 201 });
}

export async function adminRegistryRuleDetail(request: Request, env: EnvLike, id: string): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run" as PlatformPermission);
  const row = await loadRule(env.DB, id);
  const versions = (await env.DB.prepare("SELECT id,version,state,title,severity,applicability_json,spec_json,changed_by,change_note,created_at FROM registry_rule_versions WHERE rule_id=? ORDER BY version DESC LIMIT 100").bind(id).all()).results as Array<Record<string, unknown>>;
  const outcomes = (await env.DB.prepare("SELECT id,rule_version,subject_type,subject_ref,outcome,detail_json,override_by,override_reason,operation_id,policy_revision,created_at FROM registry_rule_outcomes WHERE rule_id=? ORDER BY id DESC LIMIT 100").bind(id).all()).results as Array<Record<string, unknown>>;
  return json({
    rule: ruleRowView(row),
    versions: versions.map((version) => ({ ...version, applicability: safeParse(version.applicability_json), spec: safeParse(version.spec_json), applicability_json: undefined, spec_json: undefined })),
    outcomes: outcomes.map((outcome) => ({ ...outcome, detail: safeParse(outcome.detail_json), detail_json: undefined })),
  });
}

export async function adminPatchRegistryRule(request: Request, env: EnvLike, id: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run" as PlatformPermission);
  requireCsrf(request, auth);
  const parsed = RulePatchSchema.safeParse(await readJson<unknown>(request, 128 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_rule_patch", "Rule patch failed validation", parsed.error.flatten());
  const before = await loadRule(env.DB, id);
  const state = String(before.state) as RegistryRuleState;
  if (state === "active" || state === "retired") {
    throw new HttpError(409, "rule_immutable", `A ${state} rule cannot be edited; retire it and create a new version if the policy must change`);
  }
  if (Number(before.version) !== parsed.data.expected_version) {
    throw new HttpError(409, "rule_version_conflict", "The rule changed since it was read", { current_version: Number(before.version) });
  }
  const title = parsed.data.title ?? String(before.title);
  const severity = parsed.data.severity ?? String(before.severity);
  const applicability = parsed.data.applicability !== undefined ? parsed.data.applicability : safeParse(before.applicability_json);
  const spec = parsed.data.spec !== undefined ? parsed.data.spec : safeParse(before.spec_json);
  const ruleType = String(before.rule_type) as RegistryRuleType;
  const specCheck = parseRuleSpec(ruleType, spec);
  if (!specCheck.ok) throw new HttpError(422, "invalid_rule_spec", "The rule spec does not satisfy its typed schema (executable policy is not possible)", specCheck.issues);
  const applicabilityCheck = parseRuleApplicability(applicability);
  if (!applicabilityCheck.ok) throw new HttpError(422, "invalid_rule_applicability", "The rule applicability does not satisfy its schema", applicabilityCheck.issues);
  const nextVersion = Number(before.version) + 1;
  const operationId = crypto.randomUUID();
  const [, update] = await env.DB.batch([
    policyStateLockStatement(env.DB),
    env.DB
      .prepare("UPDATE registry_rules SET title=?,severity=?,applicability_json=?,spec_json=?,version=?,updated_by=?,last_policy_operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? AND state IN ('draft','report_only')")
      .bind(title, severity, JSON.stringify(applicabilityCheck.applicability), JSON.stringify(specCheck.spec), nextVersion, auth.user.id, operationId, id, Number(before.version)),
    appendVersionStatement(env.DB, { ...before, version: nextVersion, title, severity, applicability_json: JSON.stringify(applicabilityCheck.applicability), spec_json: JSON.stringify(specCheck.spec) }, auth.user.id, parsed.data.change_note ?? "edited", operationId),
    policyRevisionBumpStatement(env.DB, id, operationId),
  ]);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "rule_version_conflict", "The rule changed while it was being edited");
  const after = await loadRule(env.DB, id);
  return json({ rule: ruleRowView(after) });
}

const STATE_TRANSITIONS: Record<RegistryRuleState, RegistryRuleState[]> = {
  draft: ["report_only"],
  report_only: ["active"],
  active: ["retired"],
  retired: [],
};

export async function adminTransitionRegistryRule(request: Request, env: EnvLike, id: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run" as PlatformPermission);
  requireCsrf(request, auth);
  const parsed = RuleStateSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_rule_state", "Rule state transition failed validation", parsed.error.flatten());
  const before = await loadRule(env.DB, id);
  const currentState = String(before.state) as RegistryRuleState;
  const nextState = parsed.data.state;
  if (Number(before.version) !== parsed.data.expected_version) {
    throw new HttpError(409, "rule_version_conflict", "The rule changed since it was read", { current_version: Number(before.version) });
  }
  if (!STATE_TRANSITIONS[currentState].includes(nextState)) {
    throw new HttpError(422, "invalid_rule_transition", `A ${currentState} rule cannot transition to ${nextState} (the ordered path is draft -> report_only -> active -> retired)`);
  }
  const nextVersion = Number(before.version) + 1;
  const operationId = crypto.randomUUID();
  const [, update] = await env.DB.batch([
    policyStateLockStatement(env.DB),
    env.DB
      .prepare("UPDATE registry_rules SET state=?,version=?,updated_by=?,last_policy_operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? AND state=?")
      .bind(nextState, nextVersion, auth.user.id, operationId, id, Number(before.version), currentState),
    appendVersionStatement(env.DB, { ...before, version: nextVersion, state: nextState }, auth.user.id, parsed.data.change_note ?? `state -> ${nextState}`, operationId),
    policyRevisionBumpStatement(env.DB, id, operationId),
  ]);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "rule_version_conflict", "The rule changed while its state was being changed");
  const after = await loadRule(env.DB, id);
  return json({ rule: ruleRowView(after) });
}

/** Preview a draft/report_only/active rule against a bounded sample of live
 *  horses BEFORE activation — the plan's "preview changes against existing
 *  records". Read-only: records NO outcomes. */
export async function adminPreviewRegistryRule(request: Request, env: EnvLike, id: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run" as PlatformPermission);
  requireCsrf(request, auth);
  const parsed = RulePreviewSchema.safeParse(await readJson<unknown>(request, 16 * 1024).catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "invalid_preview", "Preview request failed validation", parsed.error.flatten());
  const row = await loadRule(env.DB, id);
  const ruleType = String(row.rule_type) as RegistryRuleType;
  const specCheck = parseRuleSpec(ruleType, safeParse(row.spec_json));
  if (!specCheck.ok) throw new HttpError(422, "invalid_rule_spec", "The stored spec no longer parses; fix or retire the rule", specCheck.issues);
  const limit = parsed.data.limit;
  const horses = (await env.DB
    .prepare(`SELECT id,name_latin,breed_desc,sex_desc,register_no,microchip_no,birth_year,birth_date_value,birth_date_precision,birth_date_calendar,death_date_value,death_date_precision,death_date_calendar,is_dead,father_id,mother_id FROM horses WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ${limit}`)
    .all()).results as Array<Record<string, unknown>>;
  const { evaluateRegistryRules } = await import("../../registry/rulesEngine");
  const matching = { pass: 0, fail: 0 };
  const sample: Array<Record<string, unknown>> = [];
  for (const horse of horses) {
    const record: RuleSubjectRecord = {
      horse_id: Number(horse.id),
      name_latin: horse.name_latin == null ? null : String(horse.name_latin),
      breed_desc: horse.breed_desc == null ? null : String(horse.breed_desc),
      sex_desc: horse.sex_desc == null ? null : String(horse.sex_desc),
      register_no: horse.register_no == null ? null : String(horse.register_no),
      microchip_no: horse.microchip_no == null ? null : String(horse.microchip_no),
      birth_year: horse.birth_year == null ? null : Number(horse.birth_year),
      birth_date_value: horse.birth_date_value == null ? null : String(horse.birth_date_value),
      birth_date_precision: horse.birth_date_precision == null ? null : String(horse.birth_date_precision),
      birth_date_calendar: horse.birth_date_calendar == null ? null : String(horse.birth_date_calendar),
      death_date_value: horse.death_date_value == null ? null : String(horse.death_date_value),
      death_date_precision: horse.death_date_precision == null ? null : String(horse.death_date_precision),
      death_date_calendar: horse.death_date_calendar == null ? null : String(horse.death_date_calendar),
      is_dead: horse.is_dead == null ? null : Number(horse.is_dead),
      father_id: horse.father_id == null ? null : Number(horse.father_id),
      mother_id: horse.mother_id == null ? null : Number(horse.mother_id),
    };
    const subject = await buildRuleSubject(env.DB, { subjectType: "horse_update", subjectRef: Number(horse.id), record, includeEvidenceCounts: true });
    const outcome = await evaluateRegistryRules(env.DB, subject, { states: ["draft", "report_only", "active"], ruleIds: [id] });
    const failed = outcome.failures.length > 0;
    if (failed) matching.fail += 1;
    else matching.pass += 1;
    if (failed && sample.length < 20) {
      sample.push({ horse_id: Number(horse.id), name_latin: record.name_latin, failures: outcome.failures.map((failure) => ({ requirement: failure.requirement, detail: failure.detail ?? null })) });
    }
  }
  return json({
    rule_id: id,
    previewed: horses.length,
    pass: matching.pass,
    fail: matching.fail,
    sample,
    note: "Read-only preview over the most recent live horses; nothing is recorded. Activate report_only first and watch the outcome trail before relying on a rule.",
  });
}

/** Shared write-path guard: evaluate + refuse or carry overrides. Used by
 *  createHorse / updateHorse / change-review / import apply so manual entry,
 *  review and import evaluate the SAME inputs consistently. Returns the
 *  outcome the caller must pass to runRegistryPolicyBatch (or the policy
 *  option of runGuardedHorseBatch), in the SAME canonical transaction. */
export async function enforceRegistryRules(
  db: D1Database,
  subject: RuleEvaluationSubject,
  rawOverrides: unknown,
): Promise<{ outcome: RuleEvaluationOutcome; overrides: Array<{ rule_id: string; reason: string }> }> {
  const checked = await checkRegistryRules(db, subject, rawOverrides);
  if (checked.violation) {
    const shaped = checked.violation;
    throw new HttpError(422, shaped.code, shaped.message, shaped.details);
  }
  return { outcome: checked.outcome, overrides: checked.overrides };
}

/** Imports retain a rejected staged-row receipt; use the SAME evaluation
 * once, so its explanation cannot come from a second, changed policy read. */
export async function checkRegistryRules(db: D1Database, subject: RuleEvaluationSubject, rawOverrides: unknown): Promise<{
  outcome: RuleEvaluationOutcome; overrides: Array<{ rule_id: string; reason: string }>; violation: ReturnType<typeof rulesViolationError> | null;
}> {
  const parsedOverrides = parseRuleOverrides(rawOverrides);
  if (!Array.isArray(parsedOverrides)) {
    throw new HttpError(400, "invalid_rule_overrides", parsedOverrides.error);
  }
  const overrides = parsedOverrides;
  const { evaluateRegistryRules } = await import("../../registry/rulesEngine");
  const outcome = await evaluateRegistryRules(db, subject, { states: ["active", "report_only"] });
  const refused = outcome.blocked.length > 0 || (outcome.overridable.length > 0 && !outcome.overridable.every((failure) => overrides.some((override) => override.rule_id === failure.rule_id)));
  return { outcome, overrides, violation: refused ? rulesViolationError(outcome) : null };
}
