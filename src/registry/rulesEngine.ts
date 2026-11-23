import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { classifyBreedingSex } from "../pedigree/breeding";
import { normalizeIdentifierValue } from "./identifiers";
import { dateBounds } from "./registrationDetails";
import { parseRegistryDate } from "./dates";
import { newRegistryPolicyContext, policyRowMatches, capturePolicySource, registrationEvidenceCounts, REGISTRY_EVIDENCE_MEDIA_PREDICATE, HORSE_MEDIA_POLICY_TOKEN_SQL, type RegistryPolicyContext, type PolicyBinding } from "./ruleCommit";

/**
 * R146-D04 (Master-AI plan) — the bounded, versioned rules service.
 *
 * Administrators activate the bounded business rules. An empty set adds no
 * eligibility restriction, but its revision is still pinned and receipted
 * so a first activation cannot race acceptance. This evaluator serves manual
 * entry (create/update), the reviewed apply path (change requests +
 * submission approvals) and the import apply path — the same inputs are
 * evaluated consistently everywhere.
 *
 * Hard-invariant doctrine (never rule-driven, never overridable):
 * authorization (requirePermission/requireCsrf), identity integrity
 * (identifier live-duplicate guards) and pedigree acyclicity (ancestry
 * guard + graph lock) remain hard-coded invariants of the write paths.
 * Rules may ADD registry policy on top; they can never relax those three.
 *
 * No executable policy: a spec is DATA validated against per-rule-type
 * zod schemas below. There is no code path that compiles or evaluates
 * administrator-supplied SQL/JavaScript — the worst a spec can do is
 * compare strings, numbers and dates with the bounded interpretations
 * implemented here. Unknown dates stay uncertain: chronology and
 * life-status rules SKIP a comparison whenever either side is unknown,
 * never fail it.
 */

export const REGISTRY_RULE_TYPES = [
  "registration_numbering",
  "studbook_admission",
  "identifier_conflict",
  "required_evidence",
  "chronology",
  "life_status",
] as const;
export type RegistryRuleType = (typeof REGISTRY_RULE_TYPES)[number];

export const REGISTRY_RULE_SEVERITIES = ["info", "warning", "error", "blocker"] as const;
export type RegistryRuleSeverity = (typeof REGISTRY_RULE_SEVERITIES)[number];

export const REGISTRY_RULE_STATES = ["draft", "report_only", "active", "retired"] as const;
export type RegistryRuleState = (typeof REGISTRY_RULE_STATES)[number];

/** Ordered transitions; retired is terminal. */
const STATE_TRANSITIONS: Record<RegistryRuleState, RegistryRuleState[]> = {
  draft: ["report_only"],
  report_only: ["active"],
  active: ["retired"],
  retired: [],
};

/** Severity 'blocker' fails a write with no override path. */
export const OVERRIDE_BLOCKED_SEVERITIES: readonly RegistryRuleSeverity[] = ["blocker"];

// ---------------------------------------------------------------------------
// Bounded spec schemas — the whole policy vocabulary the service supports.
// ---------------------------------------------------------------------------

/** A bounded regex SOURCE (validated: length-capped, anchored compile, evaluated
 *  against length-capped inputs). A regex is data, not code — no eval. */
/** Whole-value numbering grammar: literal/class atoms and at most one
 * variable repetition. Groups, alternation, lookarounds and backreferences
 * are deliberately unsupported, so a policy cannot create exponential work. */
export function isSafeRegistrationPattern(value: string): boolean {
  if (!value.startsWith("^") || !value.endsWith("$")) return false;
  let body = value.slice(1, -1), variableRepetitions = 0;
  const atom = /^(?:\\[dDwWsS]|\\[\\^$.*+?()[\]{}|/\-]|\[(?:\\.|[^\]\\])+\]|[^\\^$.*+?()[\]{}|])(?:\{(\d{1,3})(?:,(\d{1,3}))?\}|([+*?]))?/u;
  while (body) {
    const token = atom.exec(body);
    if (!token) return false;
    if (token[1] && (Number(token[1]) > 120 || (token[2] && (Number(token[2]) > 120 || Number(token[2]) < Number(token[1]))))) return false;
    if (token[3] || (token[2] && token[1] !== token[2])) variableRepetitions += 1;
    if (variableRepetitions > 1) return false;
    body = body.slice(token[0].length);
  }
  try { new RegExp(value); return true; } catch { return false; }
}

const BoundedPattern = z.string().trim().min(1).max(160).refine(
  (value) => {
    try {
      return isSafeRegistrationPattern(value);
    } catch {
      return false;
    }
  },
  { message: "Use an anchored whole-value pattern with literals, character classes and at most one variable repetition" },
);

export const RegistrationNumberingSpecSchema = z.object({
  prefix: z.string().trim().min(1).max(40),
  pattern: BoundedPattern,
  require_prefix_match: z.boolean().default(true),
  uniqueness_scope: z.enum(["global", "per_breed"]).default("global"),
  case_insensitive: z.boolean().default(true),
});
export type RegistrationNumberingSpec = z.infer<typeof RegistrationNumberingSpecSchema>;

/** Gate E — the bounded breed/studbook CARE policy dimensions a studbook
 *  admission rule may carry for private care intake (reproductive method,
 *  embryo transfer, genetic/recipient dam, twins/offspring count, evidence).
 *  Evaluated ONLY for care_* subjects; horse_* subjects ignore it entirely.
 *  There is deliberately NO universal 'twins forbidden' rule: max_offspring_
 *  per_episode=null leaves offspring count unpoliced, and any limit is an
 *  explicit, versioned, overridable operator decision per breed/studbook. */
export const CareReproductionPolicySpecSchema = z.object({
  allowed_methods: z.array(z.enum(["natural_cover", "artificial_insemination", "embryo_transfer", "icsi"])).max(4).default([]),
  allow_unknown_method: z.boolean().default(false),
  require_recipient_dam_methods: z.array(z.enum(["embryo_transfer", "icsi"])).max(2).default(["embryo_transfer", "icsi"]),
  forbid_recipient_dam_methods: z.array(z.enum(["natural_cover", "artificial_insemination"])).max(2).default([]),
  require_covering_on_methods: z.array(z.enum(["natural_cover", "artificial_insemination"]).or(z.literal("embryo_transfer")).or(z.literal("icsi"))).max(4).default([]),
  require_transfer_on_methods: z.array(z.enum(["embryo_transfer", "icsi"])).max(2).default([]),
  max_offspring_per_episode: z.number().int().min(1).max(8).nullable().default(null),
  require_evidence_media: z.boolean().default(false),
});
export type CareReproductionPolicySpec = z.infer<typeof CareReproductionPolicySpecSchema>;

export const StudbookAdmissionSpecSchema = z.object({
  breed: z.string().trim().min(1).max(120),
  require_both_parents: z.boolean().default(false),
  require_registration_number: z.boolean().default(false),
  require_microchip: z.boolean().default(false),
  require_birth_year: z.boolean().default(false),
  min_evidence_items: z.number().int().min(0).max(10).default(0),
  birth_year_from: z.number().int().min(1500).max(2200).nullable().default(null),
  birth_year_to: z.number().int().min(1500).max(2200).nullable().default(null),
  allowed_parent_breeds: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  care_reproduction: CareReproductionPolicySpecSchema.nullable().default(null),
}).refine(
  (spec) => spec.birth_year_from == null || spec.birth_year_to == null || spec.birth_year_from <= spec.birth_year_to,
  { message: "birth_year_from must not exceed birth_year_to" },
);
export type StudbookAdmissionSpec = z.infer<typeof StudbookAdmissionSpecSchema>;

export const IdentifierConflictSpecSchema = z.object({
  field: z.enum(["register_no", "microchip_no"]),
  forbid_duplicates: z.boolean().default(true),
});
export type IdentifierConflictSpec = z.infer<typeof IdentifierConflictSpecSchema>;

export const RequiredEvidenceSpecSchema = z.object({
  require_photo: z.boolean().default(false),
  require_document: z.boolean().default(false),
  min_documents: z.number().int().min(0).max(10).default(0),
  /** Gate E — care commands that must carry private evidence_media_id.
   *  Evaluated ONLY for care_* subjects. */
  care_commands: z.array(z.enum([
    "clinical.create", "clinical.amend", "reproduction.create", "reproduction.amend",
    "sample.create", "custody.create", "report.create", "report.review",
  ])).max(8).default([]),
});
export type RequiredEvidenceSpec = z.infer<typeof RequiredEvidenceSpecSchema>;

export const ChronologySpecSchema = z.object({
  require_birth_before_death: z.boolean().default(true),
  forbid_future_birth: z.boolean().default(false),
  min_parent_age_gap_years: z.number().int().min(0).max(40).nullable().default(null),
});
export type ChronologySpec = z.infer<typeof ChronologySpecSchema>;

export const LifeStatusSpecSchema = z.object({
  require_death_date_when_dead: z.boolean().default(true),
  max_posthumous_years: z.number().int().min(0).max(60).nullable().default(null),
});
export type LifeStatusSpec = z.infer<typeof LifeStatusSpecSchema>;

/** Applicability — a rule only evaluates records it applies to.
 *  effective_from/effective_until bound the rule's ACTIVE evaluation window
 *  (inclusive, UTC days); versioning still records every definition change
 *  through registry_rule_versions. */
export const REGISTRY_RULE_SUBJECT_TYPES = [
  "horse_create", "horse_update", "submission_review", "import",
  "care_clinical", "care_reproduction", "care_sample", "care_report",
] as const;
export type RegistryRuleSubjectType = (typeof REGISTRY_RULE_SUBJECT_TYPES)[number];
const DayShape = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an exact YYYY-MM-DD Gregorian day");
export const RuleApplicabilitySchema = z.object({
  breeds: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  sexes: z.array(z.enum(["male", "female", "gelding", "unknown"])).max(4).default([]),
  import_only: z.boolean().default(false),
  subject_types: z.array(z.enum(REGISTRY_RULE_SUBJECT_TYPES)).max(8).default([]),
  effective_from: DayShape.nullable().default(null),
  effective_until: DayShape.nullable().default(null),
}).refine(
  (applicability) => applicability.effective_from == null || applicability.effective_until == null || applicability.effective_from <= applicability.effective_until,
  { message: "effective_from must not exceed effective_until" },
);
export type RuleApplicability = z.infer<typeof RuleApplicabilitySchema>;

const SPEC_SCHEMAS: Record<RegistryRuleType, z.ZodTypeAny> = {
  registration_numbering: RegistrationNumberingSpecSchema,
  studbook_admission: StudbookAdmissionSpecSchema,
  identifier_conflict: IdentifierConflictSpecSchema,
  required_evidence: RequiredEvidenceSpecSchema,
  chronology: ChronologySpecSchema,
  life_status: LifeStatusSpecSchema,
};

export function parseRuleSpec(ruleType: RegistryRuleType, spec: unknown): { ok: true; spec: unknown } | { ok: false; issues: unknown } {
  const schema = SPEC_SCHEMAS[ruleType];
  if (!schema) return { ok: false, issues: [`unknown rule_type '${ruleType}'`] };
  const parsed = schema.safeParse(spec ?? {});
  return parsed.success ? { ok: true, spec: parsed.data } : { ok: false, issues: parsed.error.flatten() };
}

export function parseRuleApplicability(applicability: unknown): { ok: true; applicability: RuleApplicability } | { ok: false; issues: unknown } {
  const parsed = RuleApplicabilitySchema.safeParse(applicability ?? {});
  return parsed.success ? { ok: true, applicability: parsed.data } : { ok: false, issues: parsed.error.flatten() };
}

// ---------------------------------------------------------------------------
// Evaluation subject — the shared shape every write path maps onto.
// ---------------------------------------------------------------------------

export interface RuleSubjectRecord {
  name_latin?: string | null;
  breed_desc?: string | null;
  sex_desc?: string | null;
  register_no?: string | null;
  microchip_no?: string | null;
  birth_year?: number | null;
  birth_date_value?: string | null;
  birth_date_precision?: string | null;
  birth_date_calendar?: string | null;
  death_date_value?: string | null;
  death_date_precision?: string | null;
  death_date_calendar?: string | null;
  birth_year_from_date?: number | null;
  death_year_from_date?: number | null;
  is_dead?: number | boolean | null;
  father_id?: number | null;
  mother_id?: number | null;
  father_birth_year?: number | null;
  mother_birth_year?: number | null;
  father_death_year?: number | null;
  mother_death_year?: number | null;
  father_sex?: string | null;
  mother_sex?: string | null;
  father_breed_desc?: string | null;
  mother_breed_desc?: string | null;
  evidence_photo_count?: number;
  evidence_document_count?: number;
  horse_id?: number | null;
  // Care intake facts (server-built, never accepted from an HTTP record).
  care_command?: string | null;
  care_method?: string | null;
  care_offspring_count?: number | null;
  care_recipient_dam_id?: number | null;
  care_sire_id?: number | null;
  care_evidence_present?: number | boolean | null;
  care_covering_on?: string | null;
  care_transfer_on?: string | null;
}

export interface RuleEvaluationSubject {
  subjectType: RegistryRuleSubjectType;
  subjectRef?: string | number | null;
  record: RuleSubjectRecord;
  viaImport?: boolean;
  /** Server-only read context, checked again inside the canonical batch. */
  policyContext?: RegistryPolicyContext;
}

export interface RuleEvaluationResult {
  rule_id: string;
  rule_version: number;
  rule_type: RegistryRuleType;
  severity: RegistryRuleSeverity;
  rule_state?: RegistryRuleState;
  outcome: "pass" | "fail";
  requirement: string;
  detail?: string;
}

export interface RuleEvaluationOutcome {
  results: RuleEvaluationResult[];
  failures: RuleEvaluationResult[];
  /** Failures of severity 'blocker' — can never be overridden. */
  blocked: RuleEvaluationResult[];
  /** Failures that MAY be overridden with a reason (warning/error). */
  overridable: RuleEvaluationResult[];
  informational: RuleEvaluationResult[];
  evaluatedRules: Array<{ rule_id: string; version: number }>;
  policyRevision: number;
  /** Entire enforcement set, including rules that did not apply. */
  policyRules: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

export interface RegistryRuleRow {
  id: string;
  rule_type: RegistryRuleType;
  title: string;
  severity: RegistryRuleSeverity;
  applicability_json: string;
  spec_json: string;
  state: RegistryRuleState;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Care subjects are a separate policy surface: a rule reaches a care command
 *  ONLY when its applicability explicitly names that care subject type. An
 *  empty subject_types list keeps meaning "every registration subject" — it
 *  must never silently start blocking private care intake after an upgrade. */
export function isCareSubjectType(subjectType: RegistryRuleSubjectType): boolean {
  return subjectType.startsWith("care_");
}

function recordMatchesApplicability(applicability: RuleApplicability, subject: RuleEvaluationSubject): boolean {
  if (isCareSubjectType(subject.subjectType)) {
    if (!applicability.subject_types.includes(subject.subjectType)) return false;
  } else if (applicability.subject_types.length && !applicability.subject_types.includes(subject.subjectType)) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (applicability.effective_from != null && today < applicability.effective_from) return false;
  if (applicability.effective_until != null && today > applicability.effective_until) return false;
  if (applicability.import_only && !subject.viaImport) return false;
  const breeds = applicability.breeds;
  if (breeds.length) {
    const breed = String(subject.record.breed_desc ?? "").trim().toLowerCase();
    if (!breed || !breeds.some((candidate) => candidate.toLowerCase() === breed)) return false;
  }
  const sexes = applicability.sexes;
  if (sexes.length) {
    const sexClass = classifyBreedingSex(subject.record.sex_desc ?? null);
    if (!sexes.includes(sexClass as "male" | "female" | "gelding" | "unknown")) return false;
  }
  return true;
}

async function loadRulesInStates(db: D1Database, states: RegistryRuleState[]): Promise<RegistryRuleRow[]> {
  if (!states.length) return [];
  const placeholders = states.map(() => "?").join(",");
  const rows = (await db
    .prepare(`SELECT id,rule_type,title,severity,applicability_json,spec_json,state,version,created_by,updated_by,created_at,updated_at
              FROM registry_rules WHERE state IN (${placeholders}) ORDER BY id`)
    .bind(...states)
    .all()).results as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    rule_type: String(row.rule_type) as RegistryRuleType,
    title: String(row.title),
    severity: String(row.severity) as RegistryRuleSeverity,
    applicability_json: String(row.applicability_json ?? "{}"),
    spec_json: String(row.spec_json ?? "{}"),
    state: String(row.state) as RegistryRuleState,
    version: Number(row.version),
    created_by: row.created_by == null ? null : String(row.created_by),
    updated_by: row.updated_by == null ? null : String(row.updated_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

function ruleDateBounds(record: RuleSubjectRecord, field: "birth" | "death"): { min: number; max: number } | null {
  const value = record[`${field}_date_value`];
  if (value) {
    const precision = record[`${field}_date_precision`], calendar = record[`${field}_date_calendar`];
    // Historical text without its calendar/precision is unknown. Never
    // silently reinterpret Solar Hijri YYYY as a Gregorian year.
    if (!precision || !calendar) return null;
    try {
      const parsed = parseRegistryDate({ value, precision, calendar }, 9999);
      return parsed.ok ? dateBounds(parsed.date) : null;
    } catch { return null; }
  }
  const year = field === "birth" ? record.birth_year ?? record.birth_year_from_date : record.death_year_from_date;
  return year != null && Number.isSafeInteger(year) && year >= 1500
    ? { min: Date.UTC(year, 0, 1), max: Date.UTC(year, 11, 31) } : null;
}

function ruleYear(record: RuleSubjectRecord, field: "birth" | "death"): number | null {
  const bounds = ruleDateBounds(record, field);
  if (!bounds) return null;
  const first = new Date(bounds.min).getUTCFullYear(), last = new Date(bounds.max).getUTCFullYear();
  return first === last ? first : null;
}

function normIdentifier(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = normalizeIdentifierValue(String(value));
  return normalized === "" ? null : normalized;
}

function futureYearGuard(record: RuleSubjectRecord): number | null {
  const birth = ruleDateBounds(record, "birth");
  if (!birth) return null;
  const now = new Date(), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return birth.min > today ? new Date(birth.min).getUTCFullYear() : null;
}

// ---------------------------------------------------------------------------
// The evaluator — bounded interpretations, one per rule type.
// ---------------------------------------------------------------------------

async function evaluateRule(
  db: D1Database,
  rule: RegistryRuleRow,
  subject: RuleEvaluationSubject,
): Promise<RuleEvaluationResult[]> {
  const record = subject.record;
  const version = rule.version;
  const results: RuleEvaluationResult[] = [];
  const push = (outcome: "pass" | "fail", requirement: string, detail?: string) =>
    results.push({ rule_id: rule.id, rule_version: version, rule_type: rule.rule_type, severity: rule.severity, rule_state: rule.state, outcome, requirement, detail });

  const specResult = parseRuleSpec(rule.rule_type, safeJsonParse<unknown>(rule.spec_json, {}));
  if (!specResult.ok) {
    // A stored spec that no longer parses is REPORTED, never crashed on.
    push("fail", "spec_parses", "Stored rule spec failed to parse against its typed schema; treat the rule as failing closed and fix or retire it");
    return results;
  }
  const spec = specResult.spec as Record<string, unknown>;

  switch (rule.rule_type) {
    case "registration_numbering": {
      const numberingSpec = spec as unknown as RegistrationNumberingSpec;
      const value = normIdentifier(record.register_no);
      if (value == null) {
        // Numbering policy governs numbers that exist; absence is other rules' domain.
        push("pass", "register_no_present", "No register_no supplied — numbering policy not applicable");
        break;
      }
      if (value.length > 120) { push("fail", "register_no_length", "Registration number exceeds the bounded policy input"); break; }
      const input = numberingSpec.case_insensitive ? value.toLowerCase() : value;
      if (numberingSpec.require_prefix_match) {
        const prefix = numberingSpec.case_insensitive ? numberingSpec.prefix.toLowerCase() : numberingSpec.prefix;
        if (!input.startsWith(prefix)) {
          push("fail", `register_no_starts_with_prefix:${numberingSpec.prefix}`, `register_no '${value}' does not carry the required '${numberingSpec.prefix}' prefix`);
          break;
        }
      }
      const patternMatch = new RegExp(numberingSpec.pattern, numberingSpec.case_insensitive ? "i" : "").test(
        numberingSpec.case_insensitive ? value.toLowerCase() : value,
      );
      if (!patternMatch) {
        push("fail", "register_no_matches_pattern", `register_no '${value}' does not match the numbering pattern`);
        break;
      }
      if (numberingSpec.uniqueness_scope === "global" || numberingSpec.uniqueness_scope === "per_breed") {
        const breedScope = numberingSpec.uniqueness_scope === "per_breed";
        const clash = await policyConflictRead(db, subject,
          `SELECT id FROM horses WHERE deleted_at IS NULL AND id<>COALESCE(?,-1) AND ${numberingSpec.case_insensitive ? "LOWER(TRIM(register_no))" : "TRIM(register_no)"}=? ${breedScope ? "AND LOWER(TRIM(COALESCE(breed_desc,'')))=?" : ""} ORDER BY id LIMIT 1`,
          [record.horse_id ?? null, numberingSpec.case_insensitive ? value.toLowerCase() : value, ...(breedScope ? [String(record.breed_desc ?? "").trim().toLowerCase()] : [])]);
        if (clash) {
          push("fail", breedScope ? "register_no_unique_in_breed" : "register_no_globally_unique", `register_no '${value}' is already used by horse #${Number(clash.id)}`);
          break;
        }
      }
      push("pass", "registration_numbering", `register_no '${value}' satisfies the numbering policy`);
      break;
    }
    case "studbook_admission": {
      const admissionSpec = spec as unknown as StudbookAdmissionSpec;
      // Gate E: for care subjects the rule carries ONLY its breed/studbook
      // care policy; the admission document checks are registration-domain
      // and never reinterpret a private care command.
      if (isCareSubjectType(subject.subjectType)) {
        const care = admissionSpec.care_reproduction;
        if (!care) { push("pass", "care_policy_empty", "This rule carries no care reproduction policy"); break; }
        if (subject.subjectType !== "care_reproduction") {
          push("pass", "care_policy_subject", "Care reproduction policy does not govern this care command");
          break;
        }
        const missing: string[] = [];
        const method = record.care_method ?? null;
        if (method == null || method === "unknown") {
          if (!care.allow_unknown_method) missing.push("a known reproductive method");
        } else {
          if (care.allowed_methods.length && !care.allowed_methods.includes(method as "natural_cover" | "artificial_insemination" | "embryo_transfer" | "icsi")) {
            missing.push(`method '${method}' inside the studbook's approved list (${care.allowed_methods.join(", ")})`);
          }
          if (care.require_recipient_dam_methods.includes(method as "embryo_transfer" | "icsi") && record.care_recipient_dam_id == null) {
            missing.push(`a recipient dam recorded for ${method}`);
          }
          if (care.forbid_recipient_dam_methods.includes(method as "natural_cover" | "artificial_insemination") && record.care_recipient_dam_id != null) {
            missing.push(`no recipient dam for ${method} (genetic dam carries the episode)`);
          }
          if (care.require_covering_on_methods.includes(method as "natural_cover" | "artificial_insemination") && !record.care_covering_on) {
            missing.push(`a covering/insemination date for ${method}`);
          }
          if (care.require_transfer_on_methods.includes(method as "embryo_transfer" | "icsi") && !record.care_transfer_on) {
            missing.push(`a transfer date for ${method}`);
          }
        }
        if (care.max_offspring_per_episode != null && (record.care_offspring_count ?? 0) > care.max_offspring_per_episode) {
          missing.push(`at most ${care.max_offspring_per_episode} offspring per episode (got ${record.care_offspring_count ?? 0})`);
        }
        if (care.require_evidence_media && !record.care_evidence_present) missing.push("private evidence attached to the episode");
        if (missing.length) push("fail", `care_studbook_policy:${admissionSpec.breed}`, `Outside the ${admissionSpec.breed} care policy: ${missing.join("; ")}`);
        else push("pass", `care_studbook_policy:${admissionSpec.breed}`, "Within the studbook care policy");
        break;
      }
      const missing: string[] = [];
      if (admissionSpec.require_both_parents && (record.father_id == null || record.mother_id == null)) missing.push("both parents recorded");
      if (admissionSpec.require_registration_number && normIdentifier(record.register_no) == null) missing.push("registration number");
      if (admissionSpec.require_microchip && normIdentifier(record.microchip_no) == null) missing.push("microchip");
      if (admissionSpec.require_birth_year && record.birth_year == null && record.birth_year_from_date == null) missing.push("birth year");
      const birthYear = ruleYear(record, "birth");
      if (admissionSpec.birth_year_from != null && (birthYear == null || birthYear < admissionSpec.birth_year_from)) {
        missing.push(`birth year ${admissionSpec.birth_year_from} or later (got ${birthYear ?? "unknown"})`);
      }
      if (admissionSpec.birth_year_to != null && (birthYear == null || birthYear > admissionSpec.birth_year_to)) {
        missing.push(`birth year ${admissionSpec.birth_year_to} or earlier (got ${birthYear ?? "unknown"})`);
      }
      if (admissionSpec.min_evidence_items > 0 && (record.evidence_photo_count ?? 0) + (record.evidence_document_count ?? 0) < admissionSpec.min_evidence_items) {
        missing.push(`at least ${admissionSpec.min_evidence_items} evidence item(s) (got ${(record.evidence_photo_count ?? 0) + (record.evidence_document_count ?? 0)})`);
      }
      if (admissionSpec.allowed_parent_breeds.length) {
        const allowed = new Set(admissionSpec.allowed_parent_breeds.map((b) => b.toLowerCase()));
        const unknownParentBreeds = (record.father_id == null && record.mother_id == null);
        // Parent breeds are only evaluable when parent records resolved them.
        if (!unknownParentBreeds) {
          for (const [label, breed] of [["sire", record.father_breed_desc], ["dam", record.mother_breed_desc]] as const) {
            if (breed == null) continue; // unknown stays uncertain
            if (!allowed.has(String(breed).trim().toLowerCase())) missing.push(`${label} breed '${breed}' outside admitted list`);
          }
        }
      }
      if (missing.length) push("fail", `studbook_admission:${admissionSpec.breed}`, `Not admissible to the ${admissionSpec.breed} studbook: ${missing.join("; ")}`);
      else push("pass", `studbook_admission:${admissionSpec.breed}`, "Meets the studbook admission policy");
      break;
    }
    case "identifier_conflict": {
      const conflictSpec = spec as unknown as IdentifierConflictSpec;
      if (!conflictSpec.forbid_duplicates) {
        push("pass", "identifier_conflict", "Duplicate check disabled by policy");
        break;
      }
      const value = normIdentifier(conflictSpec.field === "register_no" ? record.register_no : record.microchip_no);
      if (value == null) {
        push("pass", "identifier_conflict", "No value supplied");
        break;
      }
      const column = conflictSpec.field === "register_no" ? "register_no" : "microchip_no";
      const clash = await policyConflictRead(db, subject,
        `SELECT id FROM horses WHERE deleted_at IS NULL AND id<>COALESCE(?,-1) AND TRIM(${column})=? ORDER BY id LIMIT 1`,
        [record.horse_id ?? null, String((conflictSpec.field === "register_no" ? record.register_no : record.microchip_no) ?? "").trim()]);
      if (clash) push("fail", `${column}_unique`, `${column} '${value}' is already used by horse #${Number(clash.id)}`);
      else push("pass", `${column}_unique`, "No live duplicate");
      break;
    }
    case "required_evidence": {
      const evidenceSpec = spec as unknown as RequiredEvidenceSpec;
      if (isCareSubjectType(subject.subjectType)) {
        // Gate E: care evidence minimums apply only to the care commands the
        // rule names. Evidence PRESENCE is the command's own private media
        // binding; file authenticity stays a human review question.
        if (evidenceSpec.care_commands.length && (evidenceSpec.care_commands as readonly string[]).includes(String(record.care_command ?? "")) && !record.care_evidence_present) {
          push("fail", "care_required_evidence", `Command '${record.care_command}' requires private evidence attached to the record`);
        } else {
          push("pass", "care_required_evidence", evidenceSpec.care_commands.length ? "Care evidence minimum met (or not demanded for this command)" : "No care commands named by this rule");
        }
        break;
      }
      const missing: string[] = [];
      if (evidenceSpec.require_photo && (record.evidence_photo_count ?? 0) < 1) missing.push("a photo");
      if (evidenceSpec.require_document && (record.evidence_document_count ?? 0) < 1) missing.push("a document");
      if (evidenceSpec.min_documents > 0 && (record.evidence_document_count ?? 0) < evidenceSpec.min_documents) {
        missing.push(`at least ${evidenceSpec.min_documents} document(s)`);
      }
      if (missing.length) push("fail", "required_evidence", `Evidence intake minimum not met: missing ${missing.join(", ")}`);
      else push("pass", "required_evidence", "Evidence intake minimum met");
      break;
    }
    case "chronology": {
      const chronologySpec = spec as unknown as ChronologySpec;
      if (chronologySpec.require_birth_before_death) {
        const birth = ruleDateBounds(record, "birth"), death = ruleDateBounds(record, "death");
        // Unknown dates remain uncertain — the rule SKIPS, never fails.
        if (birth && death) {
          if (death.max < birth.min) push("fail", "death_not_before_birth", "The entire death-date interval precedes the birth-date interval");
          else if (death.min >= birth.max) push("pass", "death_not_before_birth", "Death is not before birth");
          else push("pass", "death_not_before_birth", "Skipped: date periods overlap; chronological order is uncertain");
        } else {
          push("pass", "death_not_before_birth", "Skipped: birth or death date unknown (uncertainty preserved)");
        }
      }
      if (chronologySpec.forbid_future_birth) {
        const future = futureYearGuard(record);
        if (future != null) push("fail", "birth_not_in_future", `birth year ${future} is in the future`);
        else push("pass", "birth_not_in_future", "Birth is not in the future (or unknown)");
      }
      if (chronologySpec.min_parent_age_gap_years != null) {
        const childYear = ruleYear(record, "birth");
        const gap = chronologySpec.min_parent_age_gap_years;
        const checked: string[] = [];
        for (const [label, parentYear] of [["sire", record.father_birth_year], ["dam", record.mother_birth_year]] as const) {
          if (childYear == null || parentYear == null) continue; // unknown stays uncertain
          checked.push(label);
          if (childYear - parentYear < gap) {
            push("fail", `parent_age_gap>=${gap}`, `${label} born ${parentYear}, child born ${childYear} — gap ${childYear - parentYear} is below the ${gap}-year policy`);
          }
        }
        if (!checked.length) push("pass", `parent_age_gap>=${gap}`, "Skipped: child or parent birth year unknown (uncertainty preserved)");
        else if (!results.some((r) => r.rule_id === rule.id && r.outcome === "fail")) {
          push("pass", `parent_age_gap>=${gap}`, "Parent age gaps meet the policy");
        }
      }
      break;
    }
    case "life_status": {
      const statusSpec = spec as unknown as LifeStatusSpec;
      if (statusSpec.require_death_date_when_dead) {
        const dead = record.is_dead === 1 || record.is_dead === true;
        const hasDeathDate = Boolean(record.death_date_value && String(record.death_date_value).trim());
        if (dead && !hasDeathDate) push("fail", "death_date_when_dead", "Recorded dead without a death date");
        else push("pass", "death_date_when_dead", dead ? "Death date present" : "Not recorded dead");
      }
      if (statusSpec.max_posthumous_years != null) {
        const limit = statusSpec.max_posthumous_years;
        let checked = 0;
        let failed = false;
        const childYear = ruleYear(record, "birth");
        for (const [label, parentDeathYear] of [["sire", record.father_death_year], ["dam", record.mother_death_year]] as const) {
          if (childYear == null || parentDeathYear == null) continue; // unknown stays uncertain
          checked += 1;
          if (childYear - parentDeathYear > limit) {
            push("fail", `posthumous_years<=${limit}`, `${label} died ${parentDeathYear} but this foal was born ${childYear} — more than ${limit} years later`);
            failed = true;
          }
        }
        if (!checked) push("pass", `posthumous_years<=${limit}`, "Skipped: parent death year or child birth year unknown (uncertainty preserved)");
        else if (!failed) push("pass", `posthumous_years<=${limit}`, "Posthumous windows within policy");
      }
      break;
    }
  }
  if (!results.length) push("pass", rule.rule_type, "Rule produced no checks");
  return results;
}

/** Evaluate the rules in the given states (write paths use active/report_only;
 *  preview uses draft/report_only too). Bounded: a handful of DB reads per
 *  DB-bound rule, everything else is in-memory comparison. */
export async function evaluateRegistryRules(
  db: D1Database,
  subject: RuleEvaluationSubject,
  options?: { states?: RegistryRuleState[]; ruleIds?: string[] },
): Promise<RuleEvaluationOutcome> {
  subject.policyContext ??= await newRegistryPolicyContext(db);
  const states = options?.states ?? ["active"];
  const rules = await loadRulesInStates(db, states);
  const selected = options?.ruleIds?.length ? rules.filter((rule) => options.ruleIds!.includes(rule.id)) : rules;
  const results: RuleEvaluationResult[] = [];
  const evaluatedRules: Array<{ rule_id: string; version: number }> = [];
  for (const rule of selected) {
    let applicability: RuleApplicability = { breeds: [], sexes: [], import_only: false, subject_types: [], effective_from: null, effective_until: null };
    const parsedApplicability = parseRuleApplicability(safeJsonParse<unknown>(rule.applicability_json, {}));
    if (parsedApplicability.ok) applicability = parsedApplicability.applicability;
    if (!recordMatchesApplicability(applicability, subject)) continue;
    evaluatedRules.push({ rule_id: rule.id, version: rule.version });
    const ruleResults = await evaluateRule(db, rule, subject);
    results.push(...ruleResults);
  }
  const failures = results.filter((result) => result.outcome === "fail");
  const blocked = failures.filter((result) => result.rule_state !== "report_only" && OVERRIDE_BLOCKED_SEVERITIES.includes(result.severity));
  const overridable = failures.filter((result) => result.rule_state !== "report_only" && (result.severity === "warning" || result.severity === "error"));
  return { results, failures, blocked, overridable, informational: results.filter((r) => r.severity === "info" || r.rule_state === "report_only"), evaluatedRules,
    policyRevision: subject.policyContext.revision, policyRules: rules.map((rule) => ({ ...rule })) };
}

async function policyConflictRead(db: D1Database, subject: RuleEvaluationSubject, sql: string, bindings: PolicyBinding[]): Promise<{ id: number } | null> {
  const row = await db.prepare(sql).bind(...bindings).first<{ id: number }>();
  subject.policyContext?.checks.push({ sql: `COALESCE((${sql}),-1)=?`, bindings: [...bindings, row?.id ?? -1] });
  return row;
}

// ---------------------------------------------------------------------------
// Subject builder — resolves parent context + evidence counts so every write
// path can construct the SAME evaluation subject from a record.
// ---------------------------------------------------------------------------

/** Bounded parent-context resolution (one query per side, only when a parent
 *  id is present) + evidence counts. Unknown context stays undefined — the
 *  engine treats it as "uncertain", never as a failure. */
export async function buildRuleSubject(
  db: D1Database,
  base: {
    subjectType: RuleEvaluationSubject["subjectType"];
    subjectRef?: string | number | null;
    record: RuleSubjectRecord;
    viaImport?: boolean;
    includeEvidenceCounts?: boolean;
    requestEvidenceId?: string;
    requestContent?: { id: string; revision: number; status: string };
    importSourceId?: number;
  },
): Promise<RuleEvaluationSubject> {
  // Capture the revision BEFORE any related read, including the empty rule
  // set. A first activation between these reads and commit must be retried.
  const policyContext = await newRegistryPolicyContext(db);
  const record: RuleSubjectRecord = { ...base.record };
  const parentIds = [...new Set([record.father_id, record.mother_id].filter((id): id is number => id != null))].sort((a,b) => a-b);
  // Consistent sorted participant order also avoids a reciprocal lock wait
  // with care operations. Uploads lock the subject before adding evidence.
  const participantIds = [...new Set([...parentIds, ...(record.horse_id != null ? [record.horse_id] : [])])].sort((a,b) => a-b);
  for (const id of participantIds) policyContext.locks.push({ sql: "UPDATE horses SET row_version=row_version WHERE id=?", bindings: [id] });
  if (parentIds.length) {
    const placeholders = parentIds.map(() => "?").join(",");
    const parents = (await db
      .prepare(`SELECT id,row_version,sex_desc,breed_desc,birth_year,birth_date_value,birth_date_precision,birth_date_calendar,death_date_value,death_date_precision,death_date_calendar,is_dead,deleted_at FROM horses WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
      .bind(...parentIds)
      .all()).results as Array<Record<string, unknown>>;
    for (const id of parentIds) {
      const parent = parents.find((candidate) => Number(candidate.id) === id);
      policyContext.checks.push(parent ? policyRowMatches("horses", parent, Object.keys(parent))
        : { sql: "NOT EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL)", bindings: [id] });
    }
    policyContext.facts.parents = parents;
    for (const parent of parents) {
      const id = Number(parent.id);
      const birthYear = ruleYear(parent as RuleSubjectRecord, "birth");
      const deathYear = ruleYear(parent as RuleSubjectRecord, "death");
      if (record.father_id === id) {
        record.father_birth_year = birthYear;
        record.father_death_year = deathYear;
        record.father_sex = parent.sex_desc == null ? null : String(parent.sex_desc);
        record.father_breed_desc = parent.breed_desc == null ? null : String(parent.breed_desc);
      }
      if (record.mother_id === id) {
        record.mother_birth_year = birthYear;
        record.mother_death_year = deathYear;
        record.mother_sex = parent.sex_desc == null ? null : String(parent.sex_desc);
        record.mother_breed_desc = parent.breed_desc == null ? null : String(parent.breed_desc);
      }
    }
  }
  if (base.includeEvidenceCounts && record.horse_id != null) {
    const mediaToken = String(await db.prepare(HORSE_MEDIA_POLICY_TOKEN_SQL).bind(record.horse_id).first<string>("token") ?? "");
    record.evidence_photo_count = 0;
    record.evidence_document_count = 0;
    const media = await db
      .prepare(`SELECT m.media_type, COUNT(*) AS count FROM horse_media m WHERE m.horse_id=? AND ${REGISTRY_EVIDENCE_MEDIA_PREDICATE} GROUP BY m.media_type`)
      .bind(record.horse_id)
      .all();
    for (const row of media.results as Array<Record<string, unknown>>) {
      if (String(row.media_type) === "photo") record.evidence_photo_count = Number(row.count);
      if (String(row.media_type) === "document") record.evidence_document_count = Number(row.count);
    }
    // Existing evidence cannot be removed/rejected/quarantined between the
    // checked snapshot and canonical acceptance. Care commands hold the same
    // subject lock before binding evidence. A changed eligibility set retries.
    policyContext.locks.push({ sql: `UPDATE horse_media SET verification=verification WHERE horse_id=? AND id IN
      (SELECT m.id FROM horse_media m WHERE m.horse_id=? AND ${REGISTRY_EVIDENCE_MEDIA_PREDICATE})`, bindings: [record.horse_id, record.horse_id] });
    policyContext.checks.push({ sql: `(${HORSE_MEDIA_POLICY_TOKEN_SQL})=?`, bindings: [record.horse_id, mediaToken] });
    policyContext.facts.media_versions = mediaToken;
    for (const type of ["photo", "document"] as const) {
      policyContext.checks.push({ sql: `(SELECT COUNT(*) FROM horse_media m WHERE m.horse_id=? AND m.media_type=? AND ${REGISTRY_EVIDENCE_MEDIA_PREDICATE})=?`,
        bindings: [record.horse_id, type, record[type === "photo" ? "evidence_photo_count" : "evidence_document_count"] ?? 0] });
    }
  }
  if (base.requestEvidenceId) {
    const requestId = base.requestEvidenceId;
    const request = await db.prepare("SELECT id,status,submission_json,evidence_file_count,evidence_total_bytes,last_evidence_operation FROM change_requests WHERE id=?").bind(requestId).first<Record<string, unknown>>();
    policyContext.locks.push({ sql: "UPDATE change_requests SET evidence_file_count=evidence_file_count WHERE id=?", bindings: [requestId] });
    if (request) policyContext.checks.push(policyRowMatches("change_requests", request, Object.keys(request)));
    else policyContext.checks.push({ sql: "1=0", bindings: [] });
    Object.assign(record, await registrationEvidenceCounts(db, requestId));
    // The parent lock is shared with evidence upload/delete. Check complete
    // bytes as well so corrupt/missing blob rows never count as evidence.
    const eligible = `FROM request_evidence e WHERE e.request_id=? AND e.deleted_at IS NULL
      AND e.size_bytes=(SELECT COALESCE(SUM(length(b.data)),0) FROM request_evidence_blobs b WHERE b.evidence_id=e.id)`;
    policyContext.checks.push({ sql: `(SELECT COUNT(*) ${eligible} AND e.role='identity_photo' AND e.mime_type IN ('image/jpeg','image/png','image/webp'))=?`, bindings: [requestId, record.evidence_photo_count ?? 0] });
    policyContext.checks.push({ sql: `(SELECT COUNT(*) ${eligible} AND e.role IN ('passport','registration') AND e.mime_type IN ('application/pdf','image/jpeg','image/png','image/webp'))=?`, bindings: [requestId, record.evidence_document_count ?? 0] });
    policyContext.facts.request_evidence = { request_id: requestId, operation: request?.last_evidence_operation ?? null };
  }
  if (base.requestContent) {
    const request = base.requestContent;
    policyContext.locks.push({ sql: "UPDATE change_requests SET content_revision=content_revision WHERE id=?", bindings: [request.id] });
    policyContext.checks.push({ sql: "EXISTS(SELECT 1 FROM change_requests WHERE id=? AND content_revision=? AND status=?)", bindings: [request.id, request.revision, request.status] });
    policyContext.facts.request_content = request;
  }
  if (base.importSourceId != null) await capturePolicySource(db, policyContext, base.importSourceId);
  return { subjectType: base.subjectType, subjectRef: base.subjectRef, record, viaImport: base.viaImport, policyContext };
}

/** The canonical error shape for a rules-blocked write. */
export function rulesViolationError(outcome: RuleEvaluationOutcome): {
  code: string;
  message: string;
  details: unknown;
} {
  return {
    code: "registry_rule_violation",
    message: "This change is blocked by an active registry rule",
    details: {
      blocked: outcome.blocked.map((result) => ({ rule_id: result.rule_id, requirement: result.requirement, detail: result.detail ?? null })),
      overridable: outcome.overridable.map((result) => ({ rule_id: result.rule_id, requirement: result.requirement, detail: result.detail ?? null })),
      informational: outcome.informational.filter((result) => result.outcome === "fail").map((result) => ({ rule_id: result.rule_id, requirement: result.requirement })),
    },
  };
}

/** Parse + validate the override list supplied by a write payload. */
export function parseRuleOverrides(input: unknown): Array<{ rule_id: string; reason: string }> | { error: string } {
  if (input == null) return [];
  if (!Array.isArray(input)) return { error: "rule_overrides must be an array" };
  const parsed = z.array(z.object({ rule_id: z.string().trim().min(1).max(200), reason: z.string().trim().min(3).max(2000) })).safeParse(input);
  if (!parsed.success) return { error: "each override needs rule_id and a reason (3-2000 chars)" };
  return parsed.data;
}


