/** Transactional commerce commands. No gateway IO is allowed inside these
 * functions. Run the same statements on SQLite/D1 and PostgreSQL.
 *
 * A random operation receipt gates EVERY effect. The deterministic command
 * key makes a replay a no-op; it is never used as a success marker by itself.
 * Existing order/entitlement rows provide transaction locks on PostgreSQL.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { CURRENT_MEMBERSHIP_PREDICATE } from "../organizations/membershipPolicy";

export interface FrozenOrderLine {
  sku: string;
  price_id: number;
  version: number;
  title_en: string;
  title_fa: string;
  unit_minor: number;
  quantity: number;
  line_total_minor: number;
  period_days: number | null;
}

export function entitlementHolderKey(buyerUserId: string, organizationId: number | null): string {
  if (organizationId != null) {
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) throw new RangeError("Invalid organization id");
    return `org:${organizationId}`;
  }
  if (!buyerUserId) throw new RangeError("Buyer is required");
  return `user:${buyerUserId}`;
}

export function normalizeOrderIntent(items: ReadonlyArray<{sku: string; quantity: number}>, organizationId: number | null) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!/^[a-z][a-z0-9_]{2,48}$/.test(item.sku) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new HttpError(400, "invalid_order", "Invalid sku or quantity");
    }
    const quantity = (quantities.get(item.sku) ?? 0) + item.quantity;
    if (quantity > 100) throw new HttpError(400, "invalid_order", "Maximum combined quantity per sku is 100");
    quantities.set(item.sku, quantity);
  }
  if (quantities.size < 1 || quantities.size > 10) throw new HttpError(400, "invalid_order", "Between 1 and 10 distinct items are required");
  return { payer_organization_id: organizationId, items: [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => ({sku, quantity})) };
}

export async function orderIntentDigest(items: ReadonlyArray<{sku: string; quantity: number}>, organizationId: number | null): Promise<string> {
  const intent = normalizeOrderIntent(items, organizationId);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(intent)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export function validateFrozenLines(lines: readonly FrozenOrderLine[], totalMinor: number): void {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 10) throw new HttpError(409, "invalid_order_snapshot", "Order snapshot requires operator review");
  const seen = new Set<string>();
  let total = 0;
  for (const line of lines) {
    if (!line || typeof line.sku !== "string" || seen.has(line.sku)
      || !Number.isSafeInteger(line.price_id) || line.price_id <= 0
      || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100
      || !Number.isSafeInteger(line.unit_minor) || line.unit_minor < 0
      || line.line_total_minor !== line.unit_minor * line.quantity
      || (line.period_days !== null && (!Number.isSafeInteger(line.period_days) || line.period_days < 1 || line.period_days > 3650))) {
      throw new HttpError(409, "invalid_order_snapshot", "Order snapshot requires operator review");
    }
    seen.add(line.sku);
    total += line.line_total_minor;
  }
  if (!Number.isSafeInteger(total) || total !== totalMinor) throw new HttpError(409, "invalid_order_snapshot", "Frozen lines do not match the stored total");
}

export function atomicOrderStatements(db: D1Database, input: {
  operationId: string; orderKey: string; buyerUserId: string; organizationId: number | null;
  digest: string; totalMinor: number; lines: FrozenOrderLine[];
}): D1PreparedStatement[] {
  validateFrozenLines(input.lines, input.totalMinor);
  const statements = [db.prepare(`
    INSERT INTO orders(order_key,buyer_user_id,payer_organization_id,status,total_minor,currency,price_snapshot_json,request_digest,creation_operation_id)
    SELECT ?,?,?,'pending',?,'IRR',?,?,?
    WHERE CAST(? AS BIGINT) IS NULL OR EXISTS(
      SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
      WHERE m.user_id=? AND m.organization_id=? AND m.role IN ('owner','manager')
        AND ${CURRENT_MEMBERSHIP_PREDICATE}
    )
    ON CONFLICT(buyer_user_id,order_key) DO NOTHING
  `).bind(input.orderKey,input.buyerUserId,input.organizationId,input.totalMinor,JSON.stringify(input.lines),input.digest,input.operationId,
    input.organizationId,input.buyerUserId,input.organizationId)];
  for (const line of input.lines) statements.push(db.prepare(`
    INSERT INTO order_lines(order_id,price_id,sku,title_en,title_fa,unit_minor,quantity,line_total_minor)
    SELECT id,?,?,?,?,?,?,? FROM orders WHERE creation_operation_id=?
  `).bind(line.price_id,line.sku,line.title_en,line.title_fa,line.unit_minor,line.quantity,line.line_total_minor,input.operationId));
  statements.push(db.prepare(`
    INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
    SELECT ?,'billing.order_created','orders',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
    FROM orders WHERE creation_operation_id=?
  `).bind(input.buyerUserId,JSON.stringify({total_minor: input.totalMinor,currency:"IRR"}),input.operationId));
  return statements;
}

/** Reserve BEFORE the external gateway request. A timeout keeps this attempt
 * reserved for reconciliation; it must not lead to an automatic second charge. */
export function reservePaymentStatements(db: D1Database, input: {orderId: number; buyerUserId: string; requestKey: string; provider: string}): D1PreparedStatement[] {
  return [
    // Lock the order. Cancellation uses the same row lock and rechecks attempts.
    db.prepare("UPDATE orders SET row_version=row_version WHERE id=? AND buyer_user_id=? AND status IN ('pending','awaiting_payment')").bind(input.orderId,input.buyerUserId),
    db.prepare(`
      INSERT INTO payment_attempts(order_id,provider,amount_minor,currency,state,request_key)
      SELECT id,?,total_minor,currency,'created',? FROM orders
      WHERE id=? AND buyer_user_id=? AND status IN ('pending','awaiting_payment') AND total_minor>0
        AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.order_id=orders.id AND p.state IN ('created','redirected'))
      ON CONFLICT DO NOTHING
    `).bind(input.provider,input.requestKey,input.orderId,input.buyerUserId),
    db.prepare(`
      INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json)
      SELECT id,'system',NULL,'created',? FROM payment_attempts WHERE request_key=?
        AND NOT EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_attempt_id=payment_attempts.id AND e.to_state='created')
    `).bind(JSON.stringify({reason:"gateway_request_reserved"}),input.requestKey),
    db.prepare(`
      UPDATE orders SET status='awaiting_payment',row_version=row_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM payment_attempts WHERE request_key=?)
    `).bind(input.orderId,input.requestKey),
  ];
}

export function attachAuthorityStatements(db: D1Database, input: {requestKey: string; authority: string; provider: string}): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE payment_attempts SET authority=?,state='redirected' WHERE request_key=? AND provider=? AND state='created' AND authority IS NULL")
      .bind(input.authority,input.requestKey,input.provider),
    db.prepare(`
      INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json)
      SELECT id,'system','created','redirected',? FROM payment_attempts
      WHERE request_key=? AND authority=? AND state='redirected'
        AND NOT EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_attempt_id=payment_attempts.id AND e.to_state='redirected')
    `).bind(JSON.stringify({authority:input.authority}),input.requestKey,input.authority),
  ];
}

export interface VerifiedCommandInput {
  operationId: string; attemptId: number; orderId: number; buyerUserId: string;
  organizationId: number | null; providerReference: string; nowIso: string;
  totalMinor: number; lines: FrozenOrderLine[];
}

export function verifiedOrderStatements(db: D1Database, input: VerifiedCommandInput): D1PreparedStatement[] {
  validateFrozenLines(input.lines,input.totalMinor);
  if (!input.providerReference || !Number.isFinite(Date.parse(input.nowIso))) throw new RangeError("Verified reference and valid timestamp required");
  const holder = entitlementHolderKey(input.buyerUserId,input.organizationId);
  const gate = "EXISTS(SELECT 1 FROM billing_command_receipts WHERE operation_id=?)";
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE orders SET row_version=row_version WHERE id=?").bind(input.orderId),
    db.prepare(`
      INSERT INTO billing_command_receipts(operation_id,command_key,kind,order_id,payment_attempt_id,actor_user_id)
      SELECT ?,?,'verify',o.id,p.id,? FROM orders o JOIN payment_attempts p ON p.order_id=o.id
      WHERE o.id=? AND p.id=? AND o.status IN ('pending','awaiting_payment')
        AND p.state IN ('created','redirected','expired') AND p.authority IS NOT NULL
        AND p.amount_minor=o.total_minor AND p.currency=o.currency AND o.currency='IRR'
        AND o.total_minor=? AND o.buyer_user_id=?
        AND ((o.payer_organization_id IS NULL AND CAST(? AS BIGINT) IS NULL) OR o.payer_organization_id=?)
      ON CONFLICT(command_key) DO NOTHING
    `).bind(input.operationId,`verify:order:${input.orderId}`,input.buyerUserId,input.orderId,input.attemptId,input.totalMinor,
      input.buyerUserId,input.organizationId,input.organizationId),
    db.prepare(`UPDATE payment_attempts SET state='verified',verified_at=CURRENT_TIMESTAMP,verification_json=? WHERE id=? AND ${gate}`)
      .bind(JSON.stringify({providerReference:input.providerReference,verifiedAt:input.nowIso}),input.attemptId,input.operationId),
    db.prepare(`UPDATE orders SET status='paid',updated_at=CURRENT_TIMESTAMP,row_version=row_version+1 WHERE id=? AND ${gate}`)
      .bind(input.orderId,input.operationId),
  ];
  // Sort to acquire shared-holder locks consistently across multi-line orders.
  for (const line of [...input.lines].sort((a,b)=>a.sku.localeCompare(b.sku))) {
    if (line.period_days == null) continue;
    const days = line.period_days * line.quantity;
    const eventKey = `payment:${input.attemptId}:sku:${line.sku}`;
    statements.push(db.prepare(`
      INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at,grant_scope,grant_source,provider_name,provider_event_ref)
      SELECT ?,?,?,?,?,?,'grant',?,datetime(?),NULL,
        CASE WHEN p.provider='demo' THEN 'demo' WHEN p.provider='zarinpal' THEN 'production' ELSE 'legacy_unclassified' END,
        'verified_payment',p.provider,?
      FROM payment_attempts p WHERE p.id=? AND ${gate}
    `).bind(eventKey,input.orderId,input.attemptId,input.buyerUserId,input.organizationId,line.sku,days,input.nowIso,input.providerReference,input.attemptId,input.operationId));
    statements.push(db.prepare(`
      INSERT INTO entitlements(buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at,holder_key,grant_scope)
      SELECT ?,?,?,e.id,1,datetime(?),datetime(?,?),?,e.grant_scope FROM entitlement_events e
      WHERE e.event_key=? AND ${gate}
      ON CONFLICT(holder_key,sku,grant_scope) WHERE active=1 DO UPDATE SET
        expires_at=datetime(CASE WHEN datetime(entitlements.expires_at)>datetime(?) THEN entitlements.expires_at ELSE excluded.activated_at END,?),
        source_event_id=excluded.source_event_id,updated_at=CURRENT_TIMESTAMP
    `).bind(input.buyerUserId,input.organizationId,line.sku,input.nowIso,input.nowIso,`+${days} days`,holder,eventKey,input.operationId,input.nowIso,`+${days} days`));
    // Expiry is computed from the locked CURRENT row INSIDE the same statement
    // (never from a value read before gateway IO; distinct renewals accumulate).
    // R96 race fix: the insert+extend pair is now ONE atomic upsert. The old
    // three-statement form let a concurrent refund's exact-interval CAS
    // deactivate the shared (holder,sku) row between the conflict-nothing
    // INSERT and the extension UPDATE — the follow-up event normalization
    // then read no row, wrote NULLs into NOT NULL columns and aborted the
    // WHOLE renewal (a paid order lost its grant). The upsert cannot lose:
    // an active row extends atomically; no active row means a fresh row for
    // exactly this grant's interval (the refund's own CAS already refuses to
    // touch a row a renewal changed, so both invariants hold in every order).
    statements.push(db.prepare(`
      UPDATE entitlement_events SET
        activated_at=COALESCE((SELECT datetime(e2.expires_at,?) FROM entitlements e2 WHERE e2.holder_key=? AND e2.sku=? AND e2.grant_scope=(SELECT grant_scope FROM entitlement_events WHERE event_key=?) AND e2.active=1),datetime(?)),
        expires_at=COALESCE((SELECT e2.expires_at FROM entitlements e2 WHERE e2.holder_key=? AND e2.sku=? AND e2.grant_scope=(SELECT grant_scope FROM entitlement_events WHERE event_key=?) AND e2.active=1),datetime(?,?))
      WHERE event_key=? AND ${gate}
    `).bind(`-${days} days`,holder,line.sku,eventKey,input.nowIso,holder,line.sku,eventKey,input.nowIso,`+${days} days`,eventKey,input.operationId));
  }
  statements.push(db.prepare(`
    INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json)
    SELECT ?,'provider','redirected','verified',? WHERE ${gate}
  `).bind(input.attemptId,JSON.stringify({providerReference:input.providerReference}),input.operationId));
  return statements;
}

export function cancelOrderStatements(db: D1Database, input: {orderId: number; actorUserId: string; operationId: string; staff: boolean}): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE orders SET row_version=row_version WHERE id=?").bind(input.orderId),
    db.prepare(`
      INSERT INTO billing_command_receipts(operation_id,command_key,kind,order_id,actor_user_id)
      SELECT ?,?,'cancel',id,? FROM orders WHERE id=? AND (buyer_user_id=? OR ?=1)
        AND status IN ('pending','awaiting_payment')
        AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.order_id=orders.id AND p.state IN ('created','redirected','verified','expired'))
      ON CONFLICT(command_key) DO NOTHING
    `).bind(input.operationId,`cancel:order:${input.orderId}`,input.actorUserId,input.orderId,input.actorUserId,input.staff?1:0),
    db.prepare(`UPDATE orders SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,row_version=row_version+1
      WHERE id=? AND EXISTS(SELECT 1 FROM billing_command_receipts WHERE operation_id=?)`).bind(input.orderId,input.operationId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'billing.order_cancelled','orders',?,'null',?,CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM billing_command_receipts WHERE operation_id=?)`)
      .bind(input.actorUserId,String(input.orderId),JSON.stringify({status:"cancelled"}),input.operationId),
  ];
}
