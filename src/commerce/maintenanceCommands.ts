import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
export function repriceStatements(db: D1Database, input: {
  sku:string; version:number; nameEn:string; nameFa:string; description:string|null;
  amountMinor:number; periodDays:number|null; actorUserId:string;
}): D1PreparedStatement[] {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor<0 || !Number.isSafeInteger(input.version) || input.version<1
      || (input.periodDays!==null && (!Number.isInteger(input.periodDays) || input.periodDays<1))) throw new RangeError("Invalid price version");
  // Uniqueness plus batch rollback ensures a racing version loses without
  // superseding the winner. This helper must only run as a transaction/batch.
  return [
    db.prepare("UPDATE billing_prices SET superseded_at=CURRENT_TIMESTAMP WHERE sku=? AND active=1 AND superseded_at IS NULL").bind(input.sku),
    db.prepare(`INSERT INTO billing_prices(sku,version,name_en,name_fa,description,price_minor,currency,period_days,active,created_by_user_id)
      VALUES(?,?,?,?,?,?,'IRR',?,1,?)`).bind(input.sku,input.version,input.nameEn,input.nameFa,input.description,input.amountMinor,input.periodDays,input.actorUserId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      VALUES(?,'billing.price_created','billing_prices',?,'null',?,CURRENT_TIMESTAMP)`)
      .bind(input.actorUserId,input.sku,JSON.stringify({sku:input.sku,version:input.version,price_minor:input.amountMinor,currency:'IRR',period_days:input.periodDays})),
  ];
}
/** Age is a queueing signal, not evidence that payment failed. */
export function queueStalePaymentStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(`INSERT INTO billing_review_cases(payment_attempt_id,reason,details_json)
    SELECT id,'stale_unverified',? FROM payment_attempts
    WHERE state IN ('created','redirected','expired') AND datetime(created_at)<datetime('now','-1 day')
    ON CONFLICT(payment_attempt_id,reason) DO NOTHING`)
    .bind(JSON.stringify({reason:'Age alone does not prove non-payment; provider inquiry required'}));
}
