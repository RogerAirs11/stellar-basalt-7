/**
 * R88 agent plan P16 — moderation vocabulary and transition rules.
 *
 * Content moderation is SEPARATE from registry factual correction: a case
 * targets a marketplace/directory surface (listing, inquiry, service
 * request, profile), never a horse record. Hiding a listing suspends the
 * LISTING; the horse profile is untouched.
 */

/** The reviewed report-reason vocabulary (closed set). */
export const MODERATION_REASONS: readonly string[] = [
  "fraud_suspected",
  "misrepresentation",
  "offensive_content",
  "spam",
  "counterfeit_documents",
  "animal_welfare",
  "other",
];

export const MODERATION_SEVERITIES: readonly string[] = ["low", "medium", "high", "urgent"];

export const MODERATION_CASE_STATUSES: readonly string[] = [
  "new",
  "triaged",
  "action_pending",
  "resolved_dismissed",
  "resolved_hidden",
  "resolved_reinstated",
  // R95-N14 (migration 0061): the deterministic merge outcome for duplicate
  // ACTIVE reports (same reporter, same target) found at upgrade time or
  // merged by the migration. Resolved-history semantics: LIKE 'resolved%'
  // everywhere, never active again, never decidable, never appealable — the
  // surviving case carries the active investigation.
  "resolved_merged",
];

/**
 * The ACTIVE statuses — the partial-unique-index key domain (0061). Exactly
 * one case per reporter per target may sit in ANY of these statuses; every
 * resolved_* status (resolved_merged included) is outside the key, so closed
 * history never blocks a later report.
 */
export const MODERATION_ACTIVE_STATUSES: readonly string[] = ["new", "triaged", "action_pending"];

export function isModerationActiveStatus(status: string): boolean {
  return (MODERATION_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isModerationResolvedStatus(status: string): boolean {
  return status.startsWith("resolved");
}

/** The reportable target surfaces (a horse record is deliberately absent). */
export const MODERATION_TARGET_TABLES: readonly string[] = [
  "sales_listings",
  "sales_inquiries",
  "service_requests",
  "directory_profiles",
];

export function isModerationReason(reason: string): boolean {
  return (MODERATION_REASONS as readonly string[]).includes(reason);
}

export function isModerationTargetTable(table: string): boolean {
  return (MODERATION_TARGET_TABLES as readonly string[]).includes(table);
}

/**
 * Operator queue ordering: severity rank first (urgent desc), then age
 * (oldest first). A bounded, honest triage view — never a promise of 24/7.
 */
export const SEVERITY_RANK: Record<string, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? -1;
}

/** Support-hours honesty: this is the standing note on every queue surface. */
export const SUPPORT_HOURS_NOTE =
  "Cases are triaged in priority order during staffed hours. This service does not advertise 24/7 moderation staffing.";

/**
 * The decision vocabulary for an operator acting on a case. `hide` suspends
 * the target listing (overlay only — never a horse change); `dismiss`
 * closes without action; `reinstate` reverses a prior hide and records the
 * full reversal trail.
 */
export const MODERATION_DECISIONS: ReadonlySet<string> = new Set(["hide", "dismiss", "reinstate"]);
