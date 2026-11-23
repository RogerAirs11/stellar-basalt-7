/**
 * R95-N14 — the moderation standing lifecycle (service_abuse_standing).
 *
 * Migration 0060 created service_abuse_standing as the RECORDED state and
 * promised: "Standing is set through the moderation workflow (N14) — this
 * table is the recorded state, not a blanket staff-access grant." This module
 * is that writer. Doctrine (from the reviewed plan + 0060):
 *
 *  - Standing is an EXPLICIT operator action recorded against a RESOLVED
 *    case. It is never an automatic side effect of a decision: hiding a
 *    listing suspends the listing; it does not silently restrict an account.
 *    An operator who wants both does both, and both actions are provenance.
 *  - The case that a standing action is recorded on supplies the provenance:
 *    the action appends an append-only `standing` event to that case
 *    (moderation_case_events, event type added by migration 0061) and the
 *    row's `reason` is the operator's own words. A merged case
 *    (resolved_merged) never sets standing: its evidence moved to the
 *    surviving case — act on that one.
 *  - The AFFECTED account is the OWNER of the reported artifact (the account
 *    that controls the reported row). Deterministic per target table; see
 *    STANDING_AFFECTED_OWNERS. For directory_profiles the honest answer is
 *    that no reviewed profile-owner mandate exists yet, so standing is
 *    refused for that target rather than guessed.
 *  - An appeal overturn restores the listing suspension overlay for ITS case
 *    only. Standing never auto-reverts: de-restriction is an explicit,
 *    reviewed operator decision recorded the same way.
 *  - The account owner can always see their OWN standing (transparency,
 *    participant lifecycle); nobody else's.
 */

import type { D1Database } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// The standing vocabulary.
// ---------------------------------------------------------------------------

export const ABUSE_STANDINGS = ["normal", "restricted", "suspended"] as const;
export type AbuseStanding = (typeof ABUSE_STANDINGS)[number];

/** Absent row === 'normal' (0060's doctrine; the table only records deltas). */
export const DEFAULT_ABUSE_STANDING: AbuseStanding = "normal";

export function isAbuseStanding(value: string): value is AbuseStanding {
  return (ABUSE_STANDINGS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The ONE transition matrix. Every from x to cell is explicit — no surface
// may keep its own copy of these facts (route metadata AND the command
// predicate derive from this table, the N11 pattern).
//
//  - Self-transitions are REFUSED: a standing action that changes nothing is
//    an operator error, answered honestly (409 standing_unchanged), not a
//    silent write that muddies the audit trail.
//  - Escalations and de-escalations are both allowed: restriction is a
//    reviewed decision either way, and the provenance event records who,
//    when, on which case, and why.
// ---------------------------------------------------------------------------
export const STANDING_TRANSITIONS: Readonly<Record<AbuseStanding, Readonly<Record<AbuseStanding, "allowed" | "refused">>>> = {
  normal:     { normal: "refused", restricted: "allowed", suspended: "allowed" },
  restricted: { normal: "allowed", restricted: "refused", suspended: "allowed" },
  suspended:  { normal: "allowed", restricted: "allowed", suspended: "refused" },
};

/** The ONE permission decision used by both the route and the command. */
export function standingTransitionAllowed(from: AbuseStanding, to: AbuseStanding): boolean {
  return STANDING_TRANSITIONS[from][to] === "allowed";
}

/** Honest refusal reason for a refused cell (never a silent no-op write). */
export function standingRefusalReason(from: AbuseStanding, to: AbuseStanding): string {
  if (from === to) return `The account is already ${from}; a standing action must change it`;
  return `The ${from} -> ${to} standing change is not an offered transition`;
}

// ---------------------------------------------------------------------------
// The affected-account rule: the OWNER of the reported artifact.
// ---------------------------------------------------------------------------

export const STANDING_AFFECTED_OWNERS: Readonly<Record<string, string | null>> = {
  // The listing belongs to its seller.
  sales_listings: "seller_user_id",
  // The inquiry was sent by the buyer.
  sales_inquiries: "buyer_user_id",
  // The lead is the requester's (states/notes are the requester's content).
  service_requests: "requester_user_id",
  // No reviewed profile-owner mandate exists yet; honest refusal, never a guess.
  directory_profiles: null,
};

/** Resolve the affected account for a case target, or null (unsupported). */
export async function standingAffectedAccount(
  db: D1Database,
  targetTable: string,
  targetId: string,
): Promise<string | null> {
  const ownerColumn = STANDING_AFFECTED_OWNERS[targetTable];
  if (!ownerColumn) return null;
  if (targetTable === "sales_listings") {
    const row = await db.prepare("SELECT seller_user_id AS owner FROM sales_listings WHERE id=?").bind(targetId).first<{ owner: string | null }>();
    return row?.owner ?? null;
  }
  if (targetTable === "sales_inquiries") {
    const row = await db.prepare("SELECT buyer_user_id AS owner FROM sales_inquiries WHERE id=?").bind(targetId).first<{ owner: string | null }>();
    return row?.owner ?? null;
  }
  const row = await db.prepare("SELECT requester_user_id AS owner FROM service_requests WHERE id=?").bind(Number(targetId)).first<{ owner: string | null }>();
  return row?.owner ?? null;
}

/** The standing a case must be in before an operator may record standing on it. */
export function standingCasePreconditionSatisfied(status: string): boolean {
  // Resolved, but NOT a merged shadow (its evidence moved to the survivor).
  return status.startsWith("resolved") && status !== "resolved_merged";
}
