import type { RefundEntitlementPolicy } from "./refunds";
import { parseUtcTimestamp } from "../shared/utcTimestamp";
export interface RefundGrantInterval {
  sku:string; granted_days:number; activated_at:string|null; expires_at:string|null;
}
/** Estimate the booked days of THIS payment, never the holder's entire balance.
 * A whole-day estimate is not evidence that the customer used no service.
 * Missing/invalid intervals require manual policy review. */
export function refundPolicyFromGrants(grants:readonly RefundGrantInterval[],nowIso:string):RefundEntitlementPolicy {
  const now=parseUtcTimestamp(nowIso);
  if(now===null)throw new RangeError("Refund policy requires a valid UTC timestamp");
  if(!grants.length)return {kind:"full_unused",sku:null,granted_days:null,consumed_days:null,remaining_days:null,
    access_action:"none",history_note:"No time-based grants are recorded for this payment; no time balance is inferred."};
  let granted=0,remaining=0,unknown=false;
  for(const row of grants) {
    if(!Number.isSafeInteger(row.granted_days)||row.granted_days<1)throw new RangeError("Invalid recorded grant duration");
    granted+=row.granted_days;
    const start=parseUtcTimestamp(row.activated_at),end=parseUtcTimestamp(row.expires_at);
    if(start===null||end===null||end<=start){unknown=true;continue;}
    remaining+=Math.min(row.granted_days,Math.max(0,Math.ceil((end-Math.max(start,now))/86_400_000)));
  }
  const consumed=Math.max(0,granted-remaining);
  const kind=unknown||consumed>0?"partial_consumed":"full_unused";
  return {kind,sku:grants.length===1?grants[0]!.sku:null,granted_days:granted,
    consumed_days:unknown?null:consumed,remaining_days:unknown?null:remaining,
    access_action:unknown?"none":kind==="full_unused"?"cancel_full_period":"end_at_confirmation",
    history_note:unknown
      ?"At least one original grant interval is unavailable. Manual allocation review is required; no usage or remaining credit was invented."
      :"Whole-day estimate from this payment's recorded grant intervals only, not measured service usage. Operator approval and separate access reconciliation are required; unrelated renewals are never cancelled."};
}
