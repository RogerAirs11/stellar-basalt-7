import type { RegistryPolicyCommit } from '../registry/ruleCommit';
import { newRegistryPolicyContext, policyRowMatches } from '../registry/ruleCommit';
import { isCareSubjectType, type RegistryRuleSubjectType, type RuleEvaluationSubject } from '../registry/rulesEngine';
import { checkRegistryRules } from '../api/modules/registryRules';
import type { CareContext } from './access';
import { HttpError } from '../api/http';

/**
 * R149 Gate E — the care intake surface of the versioned registry-rule
 * service. Every care mutation captures the policy epoch, locks its
 * participants in the SAME deterministic sorted order the canonical
 * admission paths use, evaluates the activated breed/studbook care policy
 * and then commits mutation + private history + policy decision + operation
 * receipt in ONE transaction (see commitCareCommand).
 *
 * Care subjects are a separate policy surface: a rule only reaches a care
 * command when its applicability explicitly names that care subject type
 * (rulesEngine.recordMatchesApplicability). Physical chronology, sex-role
 * and parentage checks stay hard invariants in the care services — they are
 * never configurable policy and never overridable.
 */

export interface CarePolicyFacts {
  command: string;
  method?: string | null;
  covering_on?: string | null;
  transfer_on?: string | null;
  offspring_count?: number | null;
  recipient_dam_id?: number | null;
  sire_id?: number | null;
  evidence_present?: boolean;
}

export interface CarePolicyCommit {
  commit: RegistryPolicyCommit;
  evaluated: number;
}

export function careSubjectType(command: string): RegistryRuleSubjectType {
  if (command.startsWith('clinical.')) return 'care_clinical';
  if (command.startsWith('reproduction.')) return 'care_reproduction';
  if (command.startsWith('sample.') || command.startsWith('custody.')) return 'care_sample';
  if (command.startsWith('report.')) return 'care_report';
  throw new HttpError(400, 'invalid_care_command', 'Unknown care command family');
}

/** Capture the policy epoch, pin every participant with the same sorted row
 *  locks the care batch itself would take, and evaluate the activated rules.
 *  A rule activated between this read and the acceptance batch re-fails the
 *  batch's context guard (409 registry_policy_context_changed) — including
 *  the FIRST care rule activating against an empty policy set. */
export async function prepareCarePolicy(context: CareContext, facts: CarePolicyFacts, lockHorseIds: number[], ruleOverrides: unknown, operationId: string): Promise<CarePolicyCommit> {
  const subjectType = careSubjectType(facts.command);
  const policyContext = await newRegistryPolicyContext(context.db);
  const participantIds = [...new Set([context.horseId, ...lockHorseIds.filter((id) => Number.isSafeInteger(id) && id > 0)])].sort((a, b) => a - b);
  for (const id of participantIds) policyContext.locks.push({ sql: 'UPDATE horses SET row_version=row_version WHERE id=?', bindings: [id] });
  // The subject horse's breed/sex decide applicability. The row is re-checked
  // AFTER the locks inside the batch: a canonical parent/date correction or
  // breed edit that wins the lock first forces this command to retry.
  const horse = await context.db.prepare('SELECT id,breed_desc,sex_desc,row_version,deleted_at FROM horses WHERE id=?').bind(context.horseId).first<Record<string, unknown>>();
  if (!horse || horse.deleted_at != null) throw new HttpError(404, 'not_found', 'Horse not found');
  policyContext.checks.push(policyRowMatches('horses', horse, ['id', 'breed_desc', 'sex_desc', 'row_version']));
  const record: RuleEvaluationSubject['record'] = {
    horse_id: context.horseId,
    breed_desc: horse.breed_desc == null ? null : String(horse.breed_desc),
    sex_desc: horse.sex_desc == null ? null : String(horse.sex_desc),
    care_command: facts.command,
    care_method: facts.method ?? null,
    care_covering_on: facts.covering_on ?? null,
    care_transfer_on: facts.transfer_on ?? null,
    care_offspring_count: facts.offspring_count ?? null,
    care_recipient_dam_id: facts.recipient_dam_id ?? null,
    care_sire_id: facts.sire_id ?? null,
    care_evidence_present: facts.evidence_present ? 1 : 0,
  };
  const subject: RuleEvaluationSubject = { subjectType, subjectRef: context.horseId, record, policyContext };
  if (!isCareSubjectType(subject.subjectType)) throw new HttpError(500, 'care_policy_subject', 'Care policy subject construction failed');
  const checked = await checkRegistryRules(context.db, subject, ruleOverrides);
  // Same refusal semantics as enforceRegistryRules on the canonical paths:
  // blocker failures refuse outright; warning/error failures need a per-rule
  // reason and otherwise refuse before any statement is batched.
  if (checked.violation) throw new HttpError(422, checked.violation.code, checked.violation.message, checked.violation.details);
  return { commit: { subject, outcome: checked.outcome, overrides: checked.overrides, operationId, actorUserId: context.auth.user.id }, evaluated: checked.outcome.evaluatedRules.length };
}
