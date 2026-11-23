import { refundPolicyFromGrants } from "../../commerce/refundPolicy";
import { repriceStatements, queueStalePaymentStatement } from "../../commerce/maintenanceCommands";
import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import {
  INTERNAL_CURRENCY,
  money,
  tomanToIrr,
  formatToman,
  type Money,
} from "../../commerce/money";
import {
  atomicOrderStatements, normalizeOrderIntent, orderIntentDigest, validateFrozenLines,
  reservePaymentStatements, attachAuthorityStatements, verifiedOrderStatements,
  cancelOrderStatements, type FrozenOrderLine,
} from "../../commerce/paymentCommands";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P17 — billing catalog, orders and unambiguous money units.
 *
 * Boundary rules (each pinned by tests):
 *  - Every stored amount is integer minor IRR with currency='IRR' enforced by
 *    CHECK constraints; toman exists only at display boundaries. A
 *    1,900,000-toman plan is 19,000,000 IRR and can never charge as rial.
 *  - Prices are IMMUTABLE VERSIONS: repricing inserts a new version and
 *    supersedes the old; an order's price snapshot is frozen at creation, so
 *    a catalog change can never mutate an existing payable order.
 *  - Order totals are ALWAYS recomputed server-side from the catalog — a
 *    client-supplied total is ignored (not even read).
 *  - Duplicate submission with the same order_key creates ONE order (the
 *    UNIQUE(buyer, order_key) replays the stored response shape).
 *  - economics.ts stays a planning module; nothing here imports it.
 *  - Legal/tax/merchant policy is NOT encoded as constants — the catalog
 *    carries no invented tax rates; accountant review is owner-gated.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

interface PriceRow {
  id: number;
  sku: string;
  version: number;
  name_en: string;
  name_fa: string;
  description: string | null;
  price_minor: number;
  currency: string;
  period_days: number | null;
  active: number;
  superseded_at: string | null;
  created_at: string;
}

function projectPrice(row: PriceRow) {
  const display = formatToman(money(Number(row.price_minor)));
  return {
    id: row.id,
    sku: row.sku,
    version: row.version,
    name_en: row.name_en,
    name_fa: row.name_fa,
    description: row.description,
    price_minor: Number(row.price_minor),
    currency: row.currency,
    price_toman: display.toman,
    display: { en: display.en, fa: display.fa },
    period_days: row.period_days,
    active: row.active === 1 && row.superseded_at == null,
    created_at: row.created_at,
  };
}

/** Public catalog: live price versions only, with honest hypothesis labeling. */
export async function billingCatalog(request: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT * FROM billing_prices WHERE active=1 AND superseded_at IS NULL ORDER BY sku, version DESC"
  ).all<PriceRow>();
  return json({
    currency_internal: INTERNAL_CURRENCY,
    prices: (rows.results ?? []).map(projectPrice),
    note: "Prices are stored in integer rial (IRR) and displayed in toman (1 toman = 10 rial). Offer prices are pilot hypotheses, not verified market rates.",
  });
}

const CreatePriceSchema = z.object({
  sku: z.string().trim().regex(/^[a-z][a-z0-9_]{2,48}$/),
  name_en: z.string().trim().min(3).max(120),
  name_fa: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  /** Whole toman — converted to minor IRR at this boundary. */
  price_toman: z.number().int().min(0).max(1_000_000_000),
  period_days: z.number().int().min(1).max(3650).nullable().optional(),
});

/**
 * Admin: create or reprice. Repricing NEVER updates an existing row — it
 * inserts the next version and supersedes the previous one in the same batch.
 */
export async function adminCreatePrice(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = CreatePriceSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_price", "Price failed validation", parsed.error.flatten());
  const d = parsed.data;
  let amount: Money;
  try {
    amount = tomanToIrr(d.price_toman);
  } catch {
    throw new HttpError(400, "invalid_amount", "price_toman must be a whole-toman safe integer");
  }
  const current = await env.DB.prepare(
    "SELECT id, version FROM billing_prices WHERE sku=? AND active=1 AND superseded_at IS NULL ORDER BY version DESC LIMIT 1"
  ).bind(d.sku).first<{ id: number; version: number }>();
  const latest = await env.DB.prepare("SELECT MAX(version) AS version FROM billing_prices WHERE sku=?").bind(d.sku).first<{version: number | null}>();
  const nextVersion = Number(latest?.version ?? 0) + 1;
  const operations = await env.DB.batch(repriceStatements(env.DB, {sku:d.sku,version:nextVersion,nameEn:d.name_en,nameFa:d.name_fa,
    description:d.description ?? null,amountMinor:amount.minor,periodDays:d.period_days ?? null,actorUserId:auth.user.id}));
  const id = Number(operations[1]?.meta.last_row_id ?? 0);
  return json({
    created: true,
    price: { id, sku: d.sku, version: nextVersion, price_minor: amount.minor, currency: INTERNAL_CURRENCY, price_toman: d.price_toman, period_days: d.period_days ?? null },
    note: current
      ? `Version ${nextVersion} created; the previous version is superseded. Existing orders keep their frozen price snapshot.`
      : `Version ${nextVersion} created.`,
  }, { status: 201 });
}

const CreateOrderSchema = z.object({
  order_key: z.string().trim().min(8).max(64),
  items: z.array(z.object({
    sku: z.string().trim().min(3).max(64),
    quantity: z.number().int().min(1).max(100),
  })).min(1).max(10),
  payer_organization_id: z.number().int().positive().nullable().optional(),
});

/**
 * Create an order. The client sends skus + quantities + an order_key; the
 * TOTAL IS ALWAYS RECOMPUTED from the live catalog — any client-supplied
 * total is ignored by design (the schema does not even accept one).
 */
export async function createOrder(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = CreateOrderSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_order", "Order failed validation", parsed.error.flatten());
  const d = parsed.data;
  const organizationId = d.payer_organization_id ?? null;
  const intent = normalizeOrderIntent(d.items, organizationId);
  const digest = await orderIntentDigest(intent.items, organizationId);
  const existing = await env.DB.prepare("SELECT * FROM orders WHERE buyer_user_id=? AND order_key=?")
    .bind(auth.user.id,d.order_key).first<OrderRow & {request_digest: string | null}>();
  if (existing) return replayOrder(existing,digest);
  const lines: FrozenOrderLine[] = [];
  for (const item of intent.items) {
    const price = await env.DB.prepare("SELECT * FROM billing_prices WHERE sku=? AND active=1 AND superseded_at IS NULL ORDER BY version DESC LIMIT 1")
      .bind(item.sku).first<PriceRow>();
    if (!price) throw new HttpError(404,"sku_not_found",`No live price for '${item.sku}'`);
    lines.push({price_id:Number(price.id),sku:price.sku,version:Number(price.version),title_en:price.name_en,title_fa:price.name_fa,
      unit_minor:Number(price.price_minor),quantity:item.quantity,line_total_minor:Number(price.price_minor)*item.quantity,
      period_days:price.period_days == null ? null : Number(price.period_days)});
  }
  const totalMinor = lines.reduce((sum,line)=>sum+line.line_total_minor,0);
  validateFrozenLines(lines,totalMinor);
  const operationId = crypto.randomUUID();
  await env.DB.batch(atomicOrderStatements(env.DB,{operationId,orderKey:d.order_key,buyerUserId:auth.user.id,organizationId,digest,totalMinor,lines}));
  const stored = await env.DB.prepare("SELECT * FROM orders WHERE buyer_user_id=? AND order_key=?")
    .bind(auth.user.id,d.order_key).first<OrderRow & {request_digest: string | null; creation_operation_id: string | null}>();
  if (!stored) throw new HttpError(403,"not_org_manager","The organization is inactive or your management permission changed");
  if (stored.creation_operation_id !== operationId) return replayOrder(stored,digest);
  const display = formatToman(money(totalMinor));
  return json({created:true,order:{id:stored.id,order_key:d.order_key,status:"pending",total_minor:totalMinor,currency:INTERNAL_CURRENCY,
    total_toman:display.toman,display:{en:display.en,fa:display.fa},lines},
    payment_note:"Order recorded; no charge has occurred. New payments require an explicitly enabled, configured gateway."},{status:201});
}

async function replayOrder(order: OrderRow & {request_digest: string | null}, digest: string): Promise<Response> {
  let lines: FrozenOrderLine[];
  try { lines = JSON.parse(order.price_snapshot_json) as FrozenOrderLine[]; }
  catch { throw new HttpError(409,"invalid_order_snapshot","Stored order requires operator review"); }
  const storedDigest = order.request_digest ?? await orderIntentDigest(lines,order.payer_organization_id);
  if (storedDigest !== digest) throw new HttpError(409,"idempotency_conflict","This order_key was used with a different order");
  return json({created:true,idempotent_replay:true,order:{id:order.id,status:order.status,total_minor:Number(order.total_minor),currency:order.currency,lines},
    note:"Original frozen order returned; no new lines or charge were created."});
}

export async function myOrders(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(
    "SELECT id, order_key, status, total_minor, currency, created_at, updated_at FROM orders WHERE buyer_user_id=? ORDER BY id DESC LIMIT 100"
  ).bind(auth.user.id).all<Record<string, unknown>>();
  return json({
    orders: (rows.results ?? []).map((row) => ({ ...row, total_minor: Number(row.total_minor), total_toman: Number(row.total_minor) / 10 })),
    currency_note: `Internal amounts are integer rial (IRR); total_toman is a display conversion (1 toman = 10 rial).`,
  });
}

export async function orderDetail(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id)
    .first<Record<string, unknown>>();
  if (!order || (order.buyer_user_id !== auth.user.id && !["admin", "super_admin"].includes(auth.user.role))) {
    throw new HttpError(404, "not_found", "Order not found");
  }
  const lines = await env.DB.prepare("SELECT * FROM order_lines WHERE order_id=?").bind(id).all<Record<string, unknown>>();
  const attempts = await env.DB.prepare("SELECT id, provider, authority, amount_minor, currency, state, created_at, verified_at FROM payment_attempts WHERE order_id=?").bind(id).all<Record<string, unknown>>();
  return json({
    order: { ...order, total_minor: Number(order.total_minor), total_toman: Number(order.total_minor) / 10 },
    lines: (lines.results ?? []).map((line) => ({ ...line, unit_minor: Number(line.unit_minor), line_total_minor: Number(line.line_total_minor) })),
    payment_attempts: (attempts.results ?? []).map((attempt) => ({ ...attempt, amount_minor: Number(attempt.amount_minor) })),
    status_note: "pending = recorded, nothing charged. Payment attempts exist only after a provider flow starts (P18).",
  });
}

/** Cancel a not-yet-paid order. Financial rows are never deleted. */
export async function cancelOrder(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"user");
  requireCsrf(request,auth);
  const operationId=crypto.randomUUID();
  const result=await env.DB.batch(cancelOrderStatements(env.DB,{orderId:id,actorUserId:auth.user.id,operationId,staff:["admin","super_admin"].includes(auth.user.role)}));
  if (Number(result[2]?.meta.changes ?? 0)!==1) throw new HttpError(409,"not_cancellable","Order is unavailable, already closed, or has an unresolved payment attempt. Reconcile payment before cancellation.");
  return json({cancelled:true,note:"Order cancelled; financial records retained."});
}

// ---------------------------------------------------------------------------
// P18: verified payments, entitlements, reconciliation
// ---------------------------------------------------------------------------

import { getPaymentProvider, gatewayConfigurationStatus, zarinpalStartPayUrl } from "../../commerce/payments/zarinpal";
import { resolvePaymentProvider, demoStartPayUrl, DEMO_PAYMENTS_NOTE, configuredPaymentCallbackOrigin, isDemoPaymentsEnabled, isIsolatedDemoPaymentEnvironment } from "../../commerce/payments/demoGateway";
import { PILOT_OFFERS, OFFER_TRUST_NOTE } from "../../commerce/catalog";
import { gatewayScopeHash, configuredTerminalReleasePolicy } from "../../commerce/payments/terminalPolicy";
import { providerInquiryStatements, resolveReviewCaseStatements, reconciliationScan, REVIEW_RESOLUTION_OUTCOMES, parseResolutionEvidence, type ReviewResolutionEvidence, type ProviderInquiryOutcome } from "../../commerce/reconciliation";
import {
  requestRefundStatements, approveRefundStatements, recordProviderRefundOutcomeStatements,
  REFUND_STATUS_NOTE, type RefundEntitlementPolicy, type RefundKind, type RefundStatus,
} from "../../commerce/refunds";
import { proposeRefundAllocation, approveRefundAllocationStatements, resolveRefundAccessReviewStatements } from "../../commerce/refundAllocation";
import { myOrganizationContexts, MEMBERSHIP_POLICY_NOTE } from "../../organizations/membershipPolicy";

type BillingEnv = { DB: D1Database; SESSION_COOKIE_NAME: string; ZARINPAL_MERCHANT_ID?: string; ZARINPAL_BASE_URL?: string; ZARINPAL_APPROVED_ORIGINS?: string; PAYMENT_CALLBACK_BASE_URL?: string; BILLING_LIVE_PAYMENTS_ENABLED?: string; REFUND_PARTIAL_POLICY_ENABLED?: string; PAYMENT_TERMINAL_RELEASE_ENABLED?: string; PAYMENT_TERMINAL_RELEASE_APPROVAL_REF?: string; DEMO_PAYMENTS_ENABLED?: string; APP_ENV?: string; ISOLATED_DEMO_MODE?: string; REGISTRY_DATASET_KIND?: string };

interface OrderRow {
  id: number;
  order_key: string;
  buyer_user_id: string;
  payer_organization_id: number | null;
  status: string;
  total_minor: number;
  currency: string;
  price_snapshot_json: string;
}

interface AttemptRow {
  id: number;
  order_id: number;
  provider: string;
  authority: string | null;
  amount_minor: number;
  currency: string;
  state: string;
  verification_json?: string | null;
}

/**
 * Start a payment: creates the attempt with the TRUSTED server-side amount
 * (the stored order total — never a client figure) and asks the provider for
 * an authority. Fail-closed without owner merchant credentials.
 */
export async function startOrderPayment(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"user");
  requireCsrf(request,auth);
  const order=await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<OrderRow>();
  if (!order || order.buyer_user_id!==auth.user.id) throw new HttpError(404,"not_found","Order not found");
  if (!["pending","awaiting_payment"].includes(order.status)) throw new HttpError(409,"not_payable","Order is not payable");
  // R98-N10 demo gateway: when no real merchant is configured but the owner
  // has enabled DEMO_PAYMENTS_ENABLED, the demonstration provider serves the
  // SAME journey (provider='demo', simulated settlement, no real charge).
  // The live-payment release gate below applies ONLY to the real provider —
  // the demo gateway is its own explicitly labeled, owner-enabled mode.
  const resolved=resolvePaymentProvider(env,getPaymentProvider);
  if (!resolved) {
    if (isDemoPaymentsEnabled(env) && !getPaymentProvider(env) && !isIsolatedDemoPaymentEnvironment(env)) {
      throw new HttpError(503,"demo_gateway_isolation_required","Demonstration payments are refused outside the isolated local synthetic-data environment. Configure a real merchant for this deployment or use the dedicated local demo.");
    }
    const status=gatewayConfigurationStatus(env);
    throw new HttpError(503,"payment_provider_unconfigured",
      `Payment provider is not usable (problems: ${status.problems.join(", ") || "unknown"}; approved gateway origins: ${status.approvedOrigins.join(", ")}). No charge can occur.`);
  }
  if (resolved.mode==="live" && env.BILLING_LIVE_PAYMENTS_ENABLED!=="true") throw new HttpError(503,"payments_disabled","New payments are disabled until the release/payment acceptance gates are approved. Existing attempts may still be verified.");
  const provider=resolved.provider;
  const base = configuredPaymentCallbackOrigin(env, resolved.mode);
  if (!base) throw new HttpError(503,"payment_callback_unconfigured","Callback must be a fixed HTTPS origin; HTTP is available only to the isolated synthetic loopback demo");
  if (!Number.isSafeInteger(Number(order.total_minor)) || Number(order.total_minor)<=0 || order.currency!==INTERNAL_CURRENCY) throw new HttpError(409,"invalid_amount","Only positive integer-IRR orders can start gateway payments");
  const requestKey=crypto.randomUUID();
  const reserved=await env.DB.batch(reservePaymentStatements(env.DB,{orderId:id,buyerUserId:auth.user.id,requestKey,provider:provider.name}));
  if (Number(reserved[1]?.meta.changes ?? 0)!==1) {
    const open=await env.DB.prepare("SELECT id,authority,state FROM payment_attempts WHERE order_id=? AND state IN ('created','redirected') ORDER BY id DESC LIMIT 1").bind(id).first<AttemptRow>();
    if (!open) throw new HttpError(409,"order_changed","Order changed before payment could be reserved");
    const existingProvider=(await env.DB.prepare("SELECT provider FROM payment_attempts WHERE request_key=?").bind(requestKey).first<{provider:string}>())?.provider ?? provider.name;
    const existingStartPayUrl=open.authority
      ? (existingProvider==="demo" ? demoStartPayUrl(base.origin,open.authority) : zarinpalStartPayUrl({merchantId:env.ZARINPAL_MERCHANT_ID!,baseUrl:env.ZARINPAL_BASE_URL},open.authority))
      : null;
    return json({attempt_id:open.id,state:open.state,
      start_pay_url:existingStartPayUrl,
      demo:existingProvider==="demo",
      note:(open.authority ? "Existing payment attempt returned; no second gateway request was sent." : "Gateway request is pending or its outcome is unknown. Operator reconciliation is required before retrying a charge.")+(existingProvider==="demo"?" "+DEMO_PAYMENTS_NOTE:"")});
  }
  const attempt=await env.DB.prepare("SELECT id FROM payment_attempts WHERE request_key=?").bind(requestKey).first<{id:number}>();
  if (!attempt) throw new HttpError(500,"payment_reservation_missing","Payment reservation is unavailable");
  const result=await provider.requestPayment(Number(order.total_minor),`Order ${order.order_key}`,new URL("/api/billing/payments/callback",base.origin).href);
  if (!result.ok || !result.authority) {
    await env.DB.prepare(`INSERT INTO billing_review_cases(payment_attempt_id,reason,details_json)
      VALUES(?,'request_outcome_unknown',?) ON CONFLICT(payment_attempt_id,reason) DO NOTHING`)
      .bind(attempt.id,JSON.stringify({failure:result.failure ?? "invalid_response"})).run();
    return json({attempt_id:attempt.id,state:"created",review_required:true,
      note:"Gateway request did not complete reliably. The reservation is retained; no automatic second payment attempt will be created."},{status:202});
  }
  await env.DB.batch(attachAuthorityStatements(env.DB,{requestKey,authority:result.authority,provider:provider.name}));
  return json({attempt_id:attempt.id,authority:result.authority,start_pay_url:result.startPayUrl,amount_minor:Number(order.total_minor),currency:INTERNAL_CURRENCY,
    amount_toman:Number(order.total_minor)/10,demo:resolved.mode==="demo",
    note:"Payment remains unverified until server-side provider verification."+(resolved.mode==="demo"?" "+DEMO_PAYMENTS_NOTE:"")},{status:201});
}

/**
 * The gateway redirect landing: the query status is UNTRUSTED. This endpoint
 * only reports the STORED attempt state and tells the buyer that
 * verification is server-side; the actual verification runs from the
 * verifyPaymentAttempt flow (called by the buyer or by the operator sweep).
 */
export async function paymentCallback(request: Request, env: BillingEnv): Promise<Response> {
  const url = new URL(request.url);
  const authority = url.searchParams.get("Authority") ?? url.searchParams.get("authority") ?? "";
  const redirectStatus = url.searchParams.get("Status") ?? url.searchParams.get("status") ?? "";
  if (!/^[A-Za-z0-9\-]{8,64}$/.test(authority)) {
    return json({ state: "unknown", note: "No recognizable authority in the callback." });
  }
  const attempt = await env.DB.prepare("SELECT id, state, amount_minor, currency, provider FROM payment_attempts WHERE authority=? AND provider IN ('zarinpal','demo')").bind(authority)
    .first<AttemptRow>();
  if (!attempt) return json({ state: "unknown", note: "No payment attempt matches this authority." });
  void redirectStatus; // deliberately ignored: redirect status is never trusted
  return json({
    authority,
    state: attempt.state,
    amount_minor: Number(attempt.amount_minor),
    currency: attempt.currency,
    note: "The redirect's status parameter is never trusted. Verification happens server-side against the payment provider; press verify to confirm.",
  });
}

/**
 * Server-side verification: the STORED amount and authority are checked
 * against the provider's verify endpoint. Forged callbacks, wrong amounts,
 * wrong authorities and replays produce NO entitlement — the CAS + UNIQUE
 * guards make the second grant a no-op, and a failed verification leaves
 * the attempt PENDING (never guessed into paid/failed).
 */
export async function verifyPaymentAttempt(request: Request, env: BillingEnv): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"user");
  requireCsrf(request,auth);
  const parsed=z.object({attempt_id:z.number().int().positive()}).safeParse(await readJson<unknown>(request,4*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_verify","attempt_id is required");
  const attempt=await env.DB.prepare("SELECT * FROM payment_attempts WHERE id=?").bind(parsed.data.attempt_id).first<AttemptRow>();
  const order=attempt ? await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(attempt.order_id).first<OrderRow>() : null;
  if (!attempt || !order || order.buyer_user_id!==auth.user.id) throw new HttpError(404,"not_found","Payment attempt not found");
  const receipt=await env.DB.prepare("SELECT operation_id,payment_attempt_id FROM billing_command_receipts WHERE command_key=?").bind(`verify:order:${order.id}`).first<{operation_id:string;payment_attempt_id:number}>();
  if (receipt && Number(receipt.payment_attempt_id)===Number(attempt.id)) return verifiedResponse(env.DB,attempt.id,true);
  if (attempt.state==="verified") {
    await queuePaymentReview(env.DB,attempt.id,"legacy_paid_unreconciled",{reason:"Verified legacy payment has no R95 fulfillment receipt"});
    return json({verified:true,review_required:true,note:"Previously verified payment retained; no additional entitlement was granted. Legacy fulfillment requires reconciliation."});
  }
  if (!attempt.authority) throw new HttpError(409,"authority_pending","No provider authority is recorded; reconcile the gateway request first");
  if (Number(attempt.amount_minor)!==Number(order.total_minor) || attempt.currency!==order.currency || order.currency!==INTERNAL_CURRENCY) throw new HttpError(409,"amount_mismatch","Attempt and order amounts disagree; operator review required");
  const resolved=resolvePaymentProvider(env,getPaymentProvider);
  if (!resolved || resolved.provider.name!==attempt.provider) throw new HttpError(503,"payment_provider_unconfigured","Matching payment provider is not configured");
  const provider=resolved.provider;
  const result=await provider.verifyPayment(Number(attempt.amount_minor),attempt.authority);
  if (!result.ok || !result.providerReference) {
    await env.DB.prepare(`INSERT INTO payment_events(payment_attempt_id,actor,from_state,to_state,payload_json)
      VALUES(?,'provider',?,?,?)`).bind(attempt.id,attempt.state,attempt.state,JSON.stringify({verifyFailure:result.failure ?? "missing_reference"})).run();
    return json({verified:false,state:attempt.state,failure:result.failure ?? "missing_reference",note:"No entitlement granted. Payment status is unresolved until provider verification succeeds with a reference."});
  }
  let lines: FrozenOrderLine[];
  try {
    lines=JSON.parse(order.price_snapshot_json) as FrozenOrderLine[];
    // R94 snapshots omitted period_days. Resolve ONLY the exact frozen price
    // version, never the currently advertised version, and validate all amounts.
    for (const line of lines) if (line.period_days===undefined) {
      const price=await env.DB.prepare("SELECT period_days,version,price_minor FROM billing_prices WHERE id=?").bind(line.price_id).first<{period_days:number|null;version:number;price_minor:number}>();
      if (!price || Number(price.version)!==Number(line.version) || Number(price.price_minor)!==Number(line.unit_minor)) throw new Error("legacy price mismatch");
      line.period_days=price.period_days==null?null:Number(price.period_days);
    }
    validateFrozenLines(lines,Number(order.total_minor));
  } catch {
    await queuePaymentReview(env.DB,attempt.id,"verified_unfulfillable",{provider_reference:result.providerReference,reason:"invalid_order_snapshot"});
    return json({verified:true,fulfilled:false,review_required:true,note:"Provider verified payment, but the order snapshot is invalid. No entitlement was guessed."},{status:202});
  }
  const operationId=crypto.randomUUID();
  const results=await env.DB.batch(verifiedOrderStatements(env.DB,{operationId,attemptId:attempt.id,orderId:order.id,buyerUserId:order.buyer_user_id,
    organizationId:order.payer_organization_id,providerReference:result.providerReference,nowIso:new Date().toISOString(),totalMinor:Number(order.total_minor),lines}));
  if (Number(results[1]?.meta.changes ?? 0)===1) return verifiedResponse(env.DB,attempt.id,false);
  const winner=await env.DB.prepare("SELECT payment_attempt_id FROM billing_command_receipts WHERE command_key=?").bind(`verify:order:${order.id}`).first<{payment_attempt_id:number}>();
  if (winner && Number(winner.payment_attempt_id)===Number(attempt.id)) return verifiedResponse(env.DB,attempt.id,true);
  // R96-N06: a LATE settlement of a terminally released session can never
  // auto-fulfill — the money lands in explicit review with the honest reason.
  if (attempt.state==="failed") {
    await queuePaymentReview(env.DB,attempt.id,"verified_unfulfillable",{provider_reference:result.providerReference,reason:"released_attempt_late_settlement"});
    return json({verified:true,fulfilled:false,review_required:true,note:"Provider verified money for a session that was terminally released after provider-confirmed reversal evidence. The payment cannot fulfill automatically; operator reconciliation is required and the money is retained in explicit review."},{status:202});
  }
  await queuePaymentReview(env.DB,attempt.id,"verified_unfulfillable",{provider_reference:result.providerReference,reason:"order_changed_or_another_attempt_fulfilled"});
  return json({verified:true,fulfilled:false,review_required:true,note:"Provider verified money, but this order cannot be fulfilled automatically. Operator reconciliation is required; no duplicate entitlement was granted."},{status:202});
}

async function queuePaymentReview(db:D1Database,attemptId:number,reason:string,details:Record<string,unknown>) {
  await db.prepare(`INSERT INTO billing_review_cases(payment_attempt_id,reason,details_json)
    VALUES(?,?,?) ON CONFLICT(payment_attempt_id,reason) DO NOTHING`).bind(attemptId,reason,JSON.stringify(details)).run();
}

async function verifiedResponse(db:D1Database,attemptId:number,replay:boolean):Promise<Response> {
  const events=await db.prepare("SELECT sku,granted_days,activated_at,expires_at FROM entitlement_events WHERE payment_attempt_id=? AND kind IN ('grant','renewal') ORDER BY sku")
    .bind(attemptId).all<Record<string,unknown>>();
  return json({verified:true,fulfilled:true,idempotent_replay:replay,entitlements:events.results ?? [],
    note:"Stored fulfillment returned. Each frozen line and quantity is credited once; replay does not extend expiry."});
}

/** The caller's current paid capabilities — honest, resource-independent.
 * R95-N07: personal entitlements (holder user:<id>) are labeled with an
 * explicit holder type/id; organization-held entitlements appear ONLY for
 * CURRENT memberships, with the caller's role/capabilities — never a
 * buyer-as-owner label. Ordinary staff see products and expiries only,
 * never invoices or totals (money evidence stays on the buyer's own
 * orders). */
export async function myEntitlements(request: Request, env: BillingEnv): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(`
    SELECT e.sku, e.activated_at, e.expires_at,
           CASE WHEN e.active=1 AND (e.expires_at IS NULL OR datetime(e.expires_at)>datetime('now')) THEN 1 ELSE 0 END AS currently_active
    FROM entitlements e WHERE e.holder_key=? ORDER BY e.expires_at DESC LIMIT 100
  `).bind(`user:${auth.user.id}`).all<Record<string, unknown>>();
  const contexts = await myOrganizationContexts(env.DB, auth.user.id);
  const organization_entitlements: Array<Record<string, unknown>> = [];
  for (const context of contexts) {
    const orgRows = await env.DB.prepare(`
      SELECT e.sku, e.expires_at,
             CASE WHEN e.active=1 AND (e.expires_at IS NULL OR datetime(e.expires_at)>datetime('now')) THEN 1 ELSE 0 END AS currently_active
      FROM entitlements e WHERE e.holder_key=? ORDER BY e.expires_at DESC LIMIT 100
    `).bind(`org:${context.organization_id}`).all<Record<string, unknown>>();
    for (const row of orgRows.results ?? []) {
      organization_entitlements.push({
        ...row,
        holder_type: "organization",
        organization_id: context.organization_id,
        your_role: context.role,
        your_capabilities: context.capabilities,
      });
    }
  }
  return json({
    entitlements: (rows.results ?? []).map((row) => ({ ...row, holder_type: "user", holder_id: auth.user.id })),
    organization_entitlements,
    organization_contexts: contexts,
    membership_policy_note: MEMBERSHIP_POLICY_NOTE,
    boundary_note: "Entitlements unlock paid conveniences only. A paid plan never grants access to another owner's private resources, never confers official status, and never changes scientific or credential authenticity.",
  });
}

/**
 * Refunds are unavailable until provider confirmation and allocation exist.
 * This endpoint never changes money or entitlement state.
 */
export async function adminRefundOrder(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  void id;
  // R94 marked orders refunded without transferring money, and revoked every
  // active renewal for a sku. Fail closed until amount/reference allocation,
  // confirmed provider refunds and partial-refund policy are implemented.
  throw new HttpError(501,"refund_workflow_unavailable","Automated refunds are disabled. No money was returned and no entitlement was revoked. Use the documented operator/accountant process and retain the provider refund reference.");
}

/** Read-only inspection on GET; explicit POST queues stale cases without
 * expiring, settling, refunding, or otherwise guessing payment outcomes.
 * R95-N05: GET now also carries the read-only reconciliation scan. */
export async function adminReconciliation(request: Request, env: BillingEnv): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  if (request.method==="POST") {
    requireCsrf(request,auth);
    await queueStalePaymentStatement(env.DB).run();
  } else if (request.method!=="GET") throw new HttpError(405,"method_not_allowed","Use GET to inspect or POST to enqueue stale cases");
  const reviews=await env.DB.prepare("SELECT * FROM billing_review_cases WHERE status='open' ORDER BY id LIMIT 200").all();
  const legacy=await env.DB.prepare("SELECT * FROM reconciliation_cases WHERE status='open' ORDER BY id LIMIT 200").all();
  const attempts=await env.DB.prepare("SELECT state,COUNT(*) AS n FROM payment_attempts GROUP BY state").all<{state:string;n:number}>();
  const scan=await reconciliationScan(env.DB);
  return json({review_cases:reviews.results ?? [],legacy_cases:legacy.results ?? [],attempt_counts:Object.fromEntries((attempts.results ?? []).map(r=>[r.state,Number(r.n)])),scan,
    note:"GET is read-only. POST queues stale attempts once; it never guesses that unpaid, expired, settled, or refunded money exists. Provider reconciliation remains an operator workflow."});
}

/**
 * R95-N05: operator provider inquiry — re-check an UNCERTAIN attempt against
 * the provider's read-only inquiry endpoint using the STORED authority, and
 * RECORD the outcome as append-only evidence. The attempt state is never
 * changed here: an inquiry is evidence, not a fulfillment or a failure. A
 * verified attempt returns its stored evidence without another provider call.
 */
export async function adminAttemptInquiry(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const attempt=await env.DB.prepare("SELECT * FROM payment_attempts WHERE id=?").bind(id).first<AttemptRow>();
  if (!attempt) throw new HttpError(404,"not_found","Payment attempt not found");
  const order=await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(attempt.order_id).first<OrderRow>();
  if (!order) throw new HttpError(404,"not_found","Order for this attempt not found");
  const evidenceBase={attempt_id:attempt.id,order_id:order.id,order_key:order.order_key,
    amount_minor:Number(attempt.amount_minor),currency:attempt.currency,authority:attempt.authority};
  if (attempt.state==="verified") {
    return json({inquiry:"stored",attempt_state:"verified",evidence:{...evidenceBase,provider_reference:JSON.parse(attempt.verification_json ?? "{}").providerReference ?? null},
      note:"This attempt is already verified; stored evidence returned without contacting the provider again."});
  }
  if (!attempt.authority) throw new HttpError(409,"authority_pending","No provider authority is recorded for this attempt; the gateway request outcome itself is unresolved");
  const inquiryResolution=resolvePaymentProvider(env,getPaymentProvider);
  const provider=inquiryResolution?.provider ?? null;
  if (!provider || provider.name!==attempt.provider) {
    const status=gatewayConfigurationStatus(env);
    throw new HttpError(503,"payment_provider_unconfigured",
      `Matching payment provider is not usable (problems: ${status.problems.join(", ") || "unknown"}). The attempt stays exactly as it is.`);
  }
  const result=await provider.inquirePayment(attempt.authority);
  const statusMap:Record<string,ProviderInquiryOutcome>={VERIFIED:"verified",PAID:"paid_unverified",IN_BANK:"in_bank",FAILED:"failed_observed",REVERSED:"reversed"};
  const outcome:ProviderInquiryOutcome=result.ok ? statusMap[result.status ?? ""] ?? "unknown" : result.failure ?? "unknown";
  await env.DB.batch(providerInquiryStatements(env.DB,{attemptId:attempt.id,operatorUserId:auth.user.id,outcome,providerCode:result.providerCode ?? null,providerScopeHash:await gatewayScopeHash(env),observedAuthority:attempt.authority}));
  return json({inquiry:"recorded",attempt_state:attempt.state,outcome,provider_status:result.status ?? null,
    verified:false,provider_reference:null,provider_code:result.providerCode ?? null,
    evidence:{...evidenceBase,provider_reference:null},
    note:"Status observation only. The inquiry API does not verify a payment, fulfill an order, release a charge attempt, or establish settlement. Use the standard verification/reconciliation workflow."});
}

/**
 * R95-N05: close a review case ONLY against reconciled evidence. The operator
 * echoes the attempt/order linkage (authority, reference, amounts); the
 * statement batch re-verifies every value against the stored rows plus the
 * outcome's specific proof (recorded inquiry / verify receipt / verified
 * event). Any disagreement leaves the case OPEN with a 409.
 */
export async function adminResolveReviewCase(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const parsed=z.object({
    outcome:z.enum(REVIEW_RESOLUTION_OUTCOMES),
    resolution_note:z.string().min(3).max(2000),
    evidence:z.unknown(),
    // R96-N06: the explicitly confirmed new-attempt policy — required for the
    // terminal release (provider_not_paid_confirmed), absent for others.
    new_attempt_policy:z.string().optional(),
  }).safeParse(await readJson<unknown>(request,16*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_resolution","outcome, resolution_note and evidence are required");
  const evidence=parseResolutionEvidence(parsed.data.evidence);
  const existing=await env.DB.prepare("SELECT * FROM billing_review_cases WHERE id=?").bind(id).first<{id:number;payment_attempt_id:number;reason:string;status:string}>();
  if (!existing) throw new HttpError(404,"not_found","Review case not found");
  if (existing.status!=="open") throw new HttpError(409,"already_resolved",`Case ${id} is already resolved`);
  if (Number(existing.payment_attempt_id)!==evidence.attempt_id) throw new HttpError(409,"evidence_mismatch",`Case ${id} belongs to attempt ${existing.payment_attempt_id}, not ${evidence.attempt_id}`);
  const statements=resolveReviewCaseStatements(env.DB,{caseId:id,operatorUserId:auth.user.id,outcome:parsed.data.outcome,
    resolutionNote:parsed.data.resolution_note,evidence,newAttemptPolicy:parsed.data.new_attempt_policy,terminalPolicy:await configuredTerminalReleasePolicy(env)});
  const results=await env.DB.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0)!==1) {
    throw new HttpError(409,"evidence_mismatch",
      parsed.data.outcome==="provider_not_paid_confirmed"
        ? "The terminal-release proof did not reconcile: the attempt must be in a session state (redirected/failed/expired), its latest observation must be a fresh reversal from the currently approved merchant/gateway, and the additional local cooldown must have elapsed. The case stays open; nothing was released."
        : "The submitted evidence does not reconcile with the stored attempt/order rows, or the outcome's required proof is missing. The case stays open; nothing was changed.");
  }
  const resolved=await env.DB.prepare("SELECT * FROM billing_review_cases WHERE id=?").bind(id).first();
  return json({resolved:true,review_case:resolved,
    note:parsed.data.outcome==="provider_not_paid_confirmed"
      ? "Case resolved against provider-confirmed terminal evidence; the session was released (failed) so the buyer may start a NEW attempt — the reserve guard still allows only ONE payable attempt per order. A late settlement of the released session can never auto-fulfill; it lands in explicit review. All financial history is retained."
      : "Case resolved with reconciled evidence. Financial history is retained; no money state was guessed."});
}

// ---------------------------------------------------------------------------
// R95-N06: truthful provider-confirmed refunds (ledger + workflow). The
// instant-refund route above stays 501 — money is returned ONLY when an
// operator records the provider panel's confirmed outcome with a reference.
// ---------------------------------------------------------------------------

/** Read immutable grant intervals for this payment, not the aggregate balance. */
async function computeRefundPolicy(db: D1Database, order: OrderRow, attemptId: number): Promise<RefundEntitlementPolicy> {
  const grants=await db.prepare(`SELECT sku,granted_days,activated_at,expires_at FROM entitlement_events
    WHERE payment_attempt_id=? AND order_id=? AND kind IN ('grant','renewal') ORDER BY id`)
    .bind(attemptId,order.id).all<{sku:string;granted_days:number;activated_at:string|null;expires_at:string|null}>();
  return refundPolicyFromGrants(grants.results ?? [],new Date().toISOString());
}

/** Buyer-facing refund request: records the wish + policy; moves NO money. */
export async function requestOrderRefund(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"user");
  requireCsrf(request,auth);
  const parsed=z.object({reason:z.string().min(3).max(2000)}).safeParse(await readJson<unknown>(request,4*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_refund_request","A substantive reason is required");
  const order=await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<OrderRow>();
  if (!order || order.buyer_user_id!==auth.user.id) throw new HttpError(404,"not_found","Order not found");
  const attempt=await env.DB.prepare("SELECT id FROM payment_attempts WHERE order_id=? AND state='verified' ORDER BY id DESC LIMIT 1").bind(id).first<{id:number}>();
  if (!attempt) throw new HttpError(409,"no_verified_payment","Only provider-verified payments can be refunded");
  const active=await env.DB.prepare("SELECT id, status FROM refund_requests WHERE payment_attempt_id=? AND status IN ('requested','approved','provider_pending','confirmed') ORDER BY id DESC LIMIT 1")
    .bind(attempt.id).first<{id:number;status:string}>();
  if (active) {
    const existing=await env.DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(active.id).first();
    return json({refund_request:existing,status_note:REFUND_STATUS_NOTE[existing!.status as RefundStatus],
      note:"An active refund request already exists for this payment; a repeat request cannot return money twice."});
  }
  const policy=await computeRefundPolicy(env.DB,order,attempt.id);
  const generationRow=await env.DB.prepare("SELECT COUNT(*) AS n FROM refund_requests WHERE payment_attempt_id=?").bind(attempt.id).first<{n:number}>();
  const generation=Number(generationRow?.n ?? 0)+1;
  const results=await env.DB.batch(requestRefundStatements(env.DB,{orderId:id,attemptId:attempt.id,buyerUserId:auth.user.id,reason:parsed.data.reason,generation},policy));
  const row=results[0]?.meta.changes===1
    ? await env.DB.prepare("SELECT * FROM refund_requests WHERE payment_attempt_id=? ORDER BY id DESC LIMIT 1").bind(attempt.id).first()
    : await env.DB.prepare("SELECT * FROM refund_requests WHERE payment_attempt_id=? AND status IN ('requested','approved','provider_pending','confirmed') ORDER BY id DESC LIMIT 1").bind(attempt.id).first();
  if (!row) throw new HttpError(409,"refund_not_recorded","The payment, account or refund state changed. No refund request was recorded; reload before retrying.");
  return json({refund_request:row,status_note:REFUND_STATUS_NOTE[(row.status as RefundStatus) ?? "requested"],
    note:"Refund request recorded. No money has moved and no access has changed; money returns only when the provider confirms with a reference."},{status:201});
}

/** The buyer's refund receipt/status surface — honest states only. */
export async function myRefunds(request: Request, env: BillingEnv): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"user");
  const rows=await env.DB.prepare(`
    SELECT rr.*, o.order_key FROM refund_requests rr
    JOIN orders o ON o.id=rr.order_id
    WHERE o.buyer_user_id=? OR rr.requested_by_user_id=?
    ORDER BY rr.id DESC LIMIT 100
  `).bind(auth.user.id,auth.user.id).all();
  return json({
    refund_requests:(rows.results ?? []).map((row)=>({...row,status_note:REFUND_STATUS_NOTE[(row as {status:RefundStatus}).status] ?? "Unknown status."})),
    status_vocabulary:REFUND_STATUS_NOTE,
    note:"Confirmed means an operator recorded provider-confirmation evidence, not an automated provider verification. Access reconciliation is separate. provider_pending is an unknown outcome, never presented as success.",
  });
}

/** Operator approval of a refund request. R96-N05: partial_consumed fails
 * closed until an ALLOCATION is approved (the exact-amount ledger decision) —
 * a feature flag was never a proration policy. */
export async function adminApproveRefund(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const parsed=z.object({note:z.string().min(3).max(2000)}).safeParse(await readJson<unknown>(request,4*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_approval","An operator note is required");
  const existing=await env.DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first<{id:number;status:string;kind:RefundKind;allocation_status:string}>();
  if (!existing) throw new HttpError(404,"not_found","Refund request not found");
  if (existing.kind==="partial_consumed" && existing.allocation_status!=="approved") {
    throw new HttpError(409,"partial_allocation_required","Partially consumed refunds need an APPROVED allocation (propose then approve the exact amount) before approval. The request stays 'requested'; nothing changed.");
  }
  const results=await env.DB.batch(approveRefundStatements(env.DB,{refundId:id,operatorUserId:auth.user.id,note:parsed.data.note}));
  if (Number(results[0]?.meta.changes ?? 0)!==1) {
    throw new HttpError(409,"not_approvable","Refund request is not in 'requested' state (or its amount no longer reconciles). No money moved.");
  }
  const row=await env.DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first();
  return json({refund_request:row,status_note:REFUND_STATUS_NOTE[row!.status as RefundStatus],
    note:"Approved. The provider has NOT yet returned money — record the provider panel outcome next."});
}

/** Operator records the provider panel's outcome. 'confirmed' requires the
 * provider reference and applies the recorded access reversal atomically. */
export async function adminRecordRefundOutcome(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const schema=z.object({
    outcome:z.enum(["confirmed","failed","pending"]),
    provider_reference:z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
    provider_code:z.number().int().optional(),
  }).refine((v)=>v.outcome!=="confirmed"||typeof v.provider_reference==="string",{message:"confirmed requires provider_reference"});
  const parsed=schema.safeParse(await readJson<unknown>(request,4*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_provider_outcome","outcome (confirmed with provider_reference / failed / pending) is required");
  const existing=await env.DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first<{id:number;status:string;kind:RefundKind}>();
  if (!existing) throw new HttpError(404,"not_found","Refund request not found");
  if (!["approved","provider_pending"].includes(existing.status)) {
    throw new HttpError(409,"not_awaiting_provider",`Refund request is '${existing.status}'; only approved/provider_pending requests can receive a provider outcome.`);
  }
  const result=parsed.data.outcome==="confirmed"
    ? {outcome:"confirmed" as const,providerReference:parsed.data.provider_reference!}
    : parsed.data.outcome==="failed"
      ? {outcome:"failed" as const,providerCode:parsed.data.provider_code}
      : {outcome:"pending" as const};
  const results=await env.DB.batch(recordProviderRefundOutcomeStatements(env.DB,{refundId:id,operatorUserId:auth.user.id,kind:existing.kind,result}));
  if (Number(results[0]?.meta.changes ?? 0)!==1) {
    throw new HttpError(409,"outcome_not_recorded","The provider outcome was not recorded — the request state changed underneath. Re-read the request and retry.");
  }
  const row=await env.DB.prepare("SELECT * FROM refund_requests WHERE id=?").bind(id).first();
  return json({refund_request:row,status_note:REFUND_STATUS_NOTE[row!.status as RefundStatus],
    note:parsed.data.outcome==="confirmed"
      ? "An operator recorded provider-confirmation evidence. Inspect access_reconciliation_status: directly attributable access is reconciled; mixed or legacy balances remain active pending allocation review."
      : parsed.data.outcome==="failed"
        ? "Provider reported the refund did not happen. No money was returned and no access changed."
        : "Provider outcome unknown; the request stays under operator review. This is never presented as a successful refund."});
}

// R96-N05: the refund/access allocation ledger — propose, approve, resolve.
// ---------------------------------------------------------------------------

/** Operator: compute + record a versioned allocation proposal against the
 * immutable grant-interval ledger. An override (explicit amount +
 * justification) is the manual-review path for unknown legacy intervals. */
export async function adminProposeRefundAllocation(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const schema=z.object({
    override_amount_minor:z.number().int().positive().optional(),
    override_justification:z.string().trim().min(10).max(2000).optional(),
  }).refine((v)=>(v.override_amount_minor===undefined)===(v.override_justification===undefined),{message:"an override requires both amount and justification"});
  const parsed=schema.safeParse(await readJson<unknown>(request,4*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_allocation_proposal","Provide nothing (compute) or BOTH override_amount_minor and override_justification",parsed.error.flatten());
  const existing=await env.DB.prepare("SELECT id,status FROM refund_requests WHERE id=?").bind(id).first<{id:number;status:string}>();
  if (!existing) throw new HttpError(404,"not_found","Refund request not found");
  if (existing.status!=="requested") throw new HttpError(409,"not_proposable","Allocations are proposed while the request is 'requested' — the money decision precedes approval.");
  const outcome=await proposeRefundAllocation(env.DB,{
    refundId:id,operatorUserId:auth.user.id,nowIso:new Date().toISOString(),
    override:parsed.data.override_amount_minor!==undefined?{amount_minor:parsed.data.override_amount_minor,justification:parsed.data.override_justification!}:undefined,
  });
  return json({allocation:outcome,refund_request_id:id,
    note:outcome.result==="manual_review"
      ?"The grant-interval ledger has unknown or legacy intervals; no amount was invented. Record an operator override proposal (amount + justification) or add the missing evidence."
      :outcome.result==="not_applicable"
        ?"This attempt is already fully refunded; there is nothing left to allocate."
        :"Proposal recorded against the immutable grant ledger. Approve the EXACT proposed amount next — a partial refund never silently equals the full charge."});
}

/** Operator: approve the EXACT proposed amount (currency must match). The
 * refund request's recorded amount becomes the approved allocation. */
export async function adminApproveRefundAllocation(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const parsed=z.object({proposal_operation_id:z.string().uuid(),amount_minor:z.number().int().positive(),currency:z.string().trim().length(3),note:z.string().min(3).max(2000)})
    .safeParse(await readJson<unknown>(request,4*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_allocation_approval","amount_minor, currency (3 letters) and a note are required");
  const results=await env.DB.batch(approveRefundAllocationStatements(env.DB,{refundId:id,operatorUserId:auth.user.id,amountMinor:parsed.data.amount_minor,currency:parsed.data.currency.toUpperCase(),note:parsed.data.note,expectedProposalOperationId:parsed.data.proposal_operation_id}));
  if (Number(results[0]?.meta.changes ?? 0)!==1) {
    throw new HttpError(409,"allocation_not_approved","The exact proposed amount/currency did not match, the request changed state, or the receipt total would be exceeded. Re-read the proposal and re-state the exact amount.");
  }
  const row=await env.DB.prepare("SELECT id,amount_minor,currency,allocation_status FROM refund_requests WHERE id=?").bind(id).first();
  return json({refund_request:row,
    note:"Allocation approved: the refund request now carries the allocated amount. The refund can be approved and the provider outcome recorded against this exact amount."});
}

/** Operator: the open review with its grant intervals and decision history —
 * every unresolved allocation stays visible and actionable. */
export async function adminRefundReviewDetail(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  const review=await env.DB.prepare("SELECT * FROM refund_access_reviews WHERE refund_request_id=?").bind(id).first();
  if (!review) throw new HttpError(404,"not_found","No allocation review exists for this refund request");
  const grants=await env.DB.prepare(`
    SELECT ge.id AS grant_event_id, ge.sku, ge.granted_days, ge.activated_at, ge.expires_at, ge.kind,
      (SELECT COUNT(*) FROM entitlements e WHERE e.source_event_id=ge.id AND e.active=1) AS live_entitlements
    FROM entitlement_events ge
    WHERE ge.payment_attempt_id=(SELECT payment_attempt_id FROM refund_requests WHERE id=?) AND ge.kind IN ('grant','renewal')
    ORDER BY ge.id`).bind(id).all();
  const decisions=await env.DB.prepare(`
    SELECT grant_event_id, decision_version, decision, decided_by_user_id, note, created_at
    FROM refund_access_review_decisions WHERE refund_request_id=? ORDER BY grant_event_id, decision_version`).bind(id).all();
  const allocations=await env.DB.prepare(`
    SELECT id, policy_version, proposal_operation_id, charge_amount_minor, proposed_amount_minor, currency, status, proposed_by_user_id,
      approved_by_user_id, approved_at, approval_note, created_at
    FROM refund_allocations WHERE refund_request_id=? ORDER BY id DESC`).bind(id).all();
  return json({review,grants:grants.results ?? [],decisions:decisions.results ?? [],allocations:allocations.results ?? [],
    decision_vocabulary:{cancel_interval:"cancel this grant's exact interval (later renewals are never touched)",retain:"keep the access; document why",credit_review:"escalate to the owner/accountant"},
    note:"Decisions are grant-specific and versioned; a re-resolution appends a new version and never rewrites history."});
}

/** Operator: resolve an OPEN allocation review with grant-specific decisions. */
export async function adminResolveRefundReview(request: Request, env: BillingEnv, id: number): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"admin");
  requireCsrf(request,auth);
  const schema=z.object({
    resolution_note:z.string().min(3).max(2000),
    decisions:z.array(z.object({
      grant_event_id:z.number().int().positive(),
      decision:z.enum(["cancel_interval","retain","credit_review"]),
      note:z.string().min(3).max(2000),
    })).min(1).max(100),
  });
  const parsed=schema.safeParse(await readJson<unknown>(request,16*1024));
  if (!parsed.success) throw new HttpError(400,"invalid_resolution","resolution_note and at least one grant-specific decision are required",parsed.error.flatten());
  const review=await env.DB.prepare("SELECT status FROM refund_access_reviews WHERE refund_request_id=?").bind(id).first<{status:string}>();
  if (!review) throw new HttpError(404,"not_found","No allocation review exists for this refund request");
  if (review.status!=="open") throw new HttpError(409,"already_resolved","This review is already resolved; a new resolution appends versioned decisions — re-open is an owner action.");
  const results=await env.DB.batch(resolveRefundAccessReviewStatements(env.DB,{refundId:id,operatorUserId:auth.user.id,decisions:parsed.data.decisions.map((d)=>({grantEventId:d.grant_event_id,decision:d.decision,note:d.note})),resolutionNote:parsed.data.resolution_note}));
  const claim=Number(results[0]?.meta.changes ?? 0);
  if (claim!==1) throw new HttpError(409,"not_resolvable","The confirmed refund, open review, complete grant set or exact cancellation interval no longer matches; nothing changed.");
  const row=await env.DB.prepare("SELECT status,resolved_at,resolved_by_user_id,resolution_note FROM refund_access_reviews WHERE refund_request_id=?").bind(id).first<{status:string}>();
  return json({review:row,resolved:row?.status==="resolved",
    note:row?.status==="resolved" ? "Review resolved with complete, versioned grant-specific decisions." : "Decisions recorded; the review remains open for credit or interval reconciliation. No uncertain cancellation is reported as successful."});
}

/**
 * R88 agent plan P19: the public pilot-offer surface. Three offers only,
 * each with its free-tier boundary stated in both languages, plus the
 * standing trust note (what payment never buys).
 */
export async function publicOffers(request: Request, env: BillingEnv): Promise<Response> {
  void request;
  const payment = resolvePaymentProvider(env, getPaymentProvider);
  const demo = payment?.mode === "demo";
  const purchasable = Boolean(payment && configuredPaymentCallbackOrigin(env, payment.mode)
    && (demo || env.BILLING_LIVE_PAYMENTS_ENABLED === "true"));
  const prices = await (env.DB as D1Database).prepare(
    "SELECT sku, version, name_en, name_fa, price_minor, period_days FROM billing_prices WHERE active=1 AND superseded_at IS NULL"
  ).all<{ sku: string; name_en: string; name_fa: string; price_minor: number; period_days: number | null }>();
  const bySku = new Map<string, { sku: string; name_en: string; name_fa: string; price_minor: number; period_days: number | null }>((prices.results ?? []).map((row) => [row.sku, row]));
  return json({
    offers: PILOT_OFFERS.map((offer) => ({
      ...offer,
      price: bySku.has(offer.sku)
        ? { price_minor: Number(bySku.get(offer.sku)!.price_minor), price_toman: Number(bySku.get(offer.sku)!.price_minor) / 10, currency: INTERNAL_CURRENCY, period_days: bySku.get(offer.sku)!.period_days, purchasable, demo }
        : null,
    })),
    free_forever: [
      { en: "Basic horse identity, pedigree and results", fa: "مشخصات پایه اسب، تبارنامه و نتایج" },
      { en: "Correction submission", fa: "ارسال اصلاحیه" },
      { en: "Published safety and provenance information", fa: "اطلاعات ایمنی و اصالت منتشرشده" },
    ],
    trust_note: OFFER_TRUST_NOTE,
    demo,
    note: demo ? DEMO_PAYMENTS_NOTE : "Offer prices are pilot hypotheses persisted in the billing catalog; nothing is charged until verified payments are enabled by the owner.",
  });
}
