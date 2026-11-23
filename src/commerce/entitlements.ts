/** Compatibility utilities only. Production fulfillment lives in
 * paymentCommands.ts. Legacy single-SKU/refund builders fail closed. */

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export function entitlementEventKey(paymentAttemptId: number | string): string {
  return `payment:${paymentAttemptId}:entitlement`;
}

export function addDaysIso(baseIso: string, days: number): string {
  const date = new Date(baseIso);
  if (Number.isNaN(date.getTime()) || !Number.isSafeInteger(days) || days < 0) {
    throw new RangeError("valid base date and non-negative days required");
  }
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}

/** Renewal anchor: extend from the later of now and the current expiry. */
export function renewalAnchor(nowIso: string, currentExpiresAt: string | null): string {
  if (!currentExpiresAt) return nowIso;
  return new Date(currentExpiresAt).getTime() > new Date(nowIso).getTime() ? currentExpiresAt : nowIso;
}

/** @deprecated R94 single-line builders were unsafe under concurrent callbacks.
 * Call paymentCommands.verifiedOrderStatements with the complete frozen order.
 * Kept as an explicit fail-closed compatibility error, not a silent fallback. */
export function verifiedPaymentStatements(_db: D1Database, _input: {
  attemptId:number; orderId:number; buyerUserId:string; payerOrganizationId:number|null;
  sku:string; periodDays:number|null; providerReference:string|null; nowIso:string; currentExpiryIso:string|null;
}): {statements:D1PreparedStatement[]; eventKey:string; expiresAt:string|null} {
  throw new Error("Legacy payment builder disabled; use verifiedOrderStatements with all frozen order lines");
}

/** @deprecated A bookkeeping row is not a completed refund. */
export function refundStatements(_db:D1Database,_input:{attemptId:number;orderId:number;buyerUserId:string;sku:string;operatorUserId:string;partial:boolean}):D1PreparedStatement[] {
  throw new Error("Refund allocation/confirmation is not implemented; no financial or entitlement state was changed");
}
