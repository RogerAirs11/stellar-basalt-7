/**
 * R88 agent plan P19 — server-side entitlement checks for feature gating.
 *
 * Rules:
 *  - Entitlements gate CONVENIENCES only; resource authorization stays with
 *    the existing grant machinery. A paid plan never bypasses it (the
 *    acceptance test: a paid unrelated account still gets 403/404 on
 *    private resources — the authorize() paths never consult entitlements).
 *  - Checks are LIVE (expiry evaluated at read time), so an expired plan
 *    removes paid conveniences automatically without deleting anything.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { CURRENT_MEMBERSHIP_PREDICATE } from "../organizations/membershipPolicy";
import { grantScopeSqlLiteral, type AcceptedGrantScope } from "./entitlementScope";

export interface ActiveEntitlement {
  sku: string;
  expires_at: string | null;
}

/** Live active-entitlement lookup for a holder and sku. R95-N07: the org
 * membership check is the ONE centralized predicate (any current capability
 * — an ordinary member may use org conveniences; private management is a
 * separate capability enforced at write time elsewhere).
 * R120 (IMP-009 follow-on): scope-aware — defaults to production-only
 * (fail-closed); the isolated demo environment passes its own demo scope so
 * its paid conveniences work there while demo grants still never unlock
 * anything in production. */
export async function findActiveEntitlement(db: D1Database, userId: string, sku: string, organizationId: number | null = null, scope: AcceptedGrantScope = "production"): Promise<ActiveEntitlement | null> {
  const holderKey = organizationId == null ? `user:${userId}` : `org:${organizationId}`;
  if (organizationId != null) {
    const membership = await db.prepare(`SELECT m.id FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
      WHERE m.user_id=? AND m.organization_id=? AND ${CURRENT_MEMBERSHIP_PREDICATE}`)
      .bind(userId,organizationId).first();
    if (!membership) return null;
  }
  const row = await db.prepare(`
    SELECT sku, expires_at FROM entitlements
    WHERE holder_key=? AND sku=? AND grant_scope=${grantScopeSqlLiteral(scope)} AND active=1
      AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))
    ORDER BY expires_at DESC LIMIT 1
  `).bind(holderKey, sku).first<ActiveEntitlement>();
  if (!row) return null;
  // Defense-in-depth: the SQL clause already filters by expiry, but the
  // helper re-checks in JavaScript so an expired row can never count as
  // active even if a read path bypasses the WHERE clause.
  if (row.expires_at != null) {
    const time = Date.parse(row.expires_at.includes("T") ? row.expires_at : row.expires_at.replace(" ","T")+"Z");
    if (!Number.isFinite(time) || time<=Date.now()) return null;
  }
  return row;
}

/** Boolean form (for capability surfaces). */
export async function hasEntitlement(db: D1Database, userId: string, sku: string, organizationId: number | null = null, scope: AcceptedGrantScope = "production"): Promise<boolean> {
  return (await findActiveEntitlement(db, userId, sku, organizationId, scope)) !== null;
}

/**
 * Guard form: throws the honest 402 entitlement_required when the holder
 * lacks an active entitlement. The message names the free tier — a refusal
 * never reads as a punishment for non-payment, and records are never
 * touched by this check.
 */
export async function requireEntitlement(db: D1Database, userId: string, sku: string, freeTierNote: string): Promise<ActiveEntitlement> {
  const entitlement = await findActiveEntitlement(db, userId, sku);
  if (!entitlement) {
    throw new HttpError(402, "entitlement_required", `This convenience requires an active ${sku} plan. ${freeTierNote}`);
  }
  return entitlement;
}
