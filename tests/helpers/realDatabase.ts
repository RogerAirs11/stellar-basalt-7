import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openLocalSqlite } from "../../src/db/localSqlite";
import { createSession } from "../../src/auth/session";
import * as paymentCommands from "../../src/commerce/paymentCommands";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N01 shared fixture: a REAL SQLite database with every numbered migration
 * applied and foreign keys enforced — never a SQL-recording mock.
 *
 * Handlers under test run their actual SQL. Only external network IO (the
 * payment provider gateway) is faked by callers swapping globalThis.fetch.
 */

const MIGRATIONS_DIR = join(__dirname, "../../migrations");

export async function openRealDatabase(): Promise<D1Database> {
  const db = openLocalSqlite(":memory:");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export interface SeededUser {
  id: string;
  role: string;
  email: string;
}

export async function seedUser(db: D1Database, id: string, role: SeededUser["role"] = "user", email?: string): Promise<SeededUser> {
  await db.prepare("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES(?,?,?,?,?,1)")
    .bind(id, email ?? `${id}@example.test`, id, "not-a-real-hash", role).run();
  return { id, role, email: email ?? `${id}@example.test` };
}

export interface AuthedSession {
  userId: string;
  role: string;
  cookie: string;
  csrfToken: string;
}

/** Creates a REAL session through the production createSession path. */
export async function makeSession(db: D1Database, userId: string, cookieName = "hr_session"): Promise<AuthedSession> {
  const seeded = await db.prepare("SELECT id FROM users WHERE id=?").bind(userId).first<{ id: string }>();
  if (!seeded) throw new Error(`makeSession: user ${userId} does not exist — seed it first`);
  const request = new Request("https://registry.example/api/session", { headers: { "user-agent": "vitest" } });
  const { token, csrfToken } = await createSession(db, userId, request);
  return { userId, role: "", cookie: `${cookieName}=${token}`, csrfToken };
}

export interface RequestOptions {
  method?: string;
  session?: AuthedSession | null;
  origin?: string;
  headers?: Record<string, string>;
}

/** Builds a Request with real session cookie + CSRF headers. */
export function authedRequest(path: string, body: unknown, options: RequestOptions = {}): Request {
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { "content-type": "application/json", origin: options.origin ?? "https://registry.example", ...(options.headers ?? {}) };
  if (options.session) {
    headers.cookie = options.session.cookie;
    headers["x-csrf-token"] = options.session.csrfToken;
  }
  return new Request(`https://registry.example${path}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" || body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Billing fixtures — real command modules, real rows.
// ---------------------------------------------------------------------------

export interface SeedableLine {
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

export function planLine(overrides: Partial<SeedableLine> = {}): SeedableLine {
  const unit_minor = overrides.unit_minor ?? 19_000_000;
  const quantity = overrides.quantity ?? 1;
  return {
    sku: "farm_workspace_monthly",
    price_id: 1,
    version: 1,
    title_en: "Farm workspace monthly",
    title_fa: "Farm workspace monthly (FA)",
    unit_minor,
    quantity,
    line_total_minor: unit_minor * quantity,
    period_days: 30,
    ...overrides,
  };
}

export async function seedBillingPrices(db: D1Database): Promise<void> {
  await db.exec(`
    INSERT INTO billing_prices(id,sku,version,name_en,name_fa,price_minor,period_days,created_by_user_id)
    VALUES (1,'farm_workspace_monthly',1,'Farm','Farm',19000000,30,'owner'),
           (2,'provider_pro_monthly',1,'Provider','Provider',4900000,30,'owner');
  `);
}

export interface OrderSeed {
  key?: string;
  lines?: SeedableLine[];
  buyer?: string;
  organizationId?: number | null;
  operationId?: string;
}

/** Creates an order through the REAL atomicOrderStatements command. */
export async function createOrder(db: D1Database, seed: OrderSeed = {}) {
  const lines = seed.lines ?? [planLine()];
  const total = lines.reduce((sum, l) => sum + l.line_total_minor, 0);
  const digest = await paymentCommands.orderIntentDigest(
    lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
    seed.organizationId ?? null,
  );
  await db.batch(paymentCommands.atomicOrderStatements(db, {
    operationId: seed.operationId ?? crypto.randomUUID(),
    orderKey: seed.key ?? `order-${crypto.randomUUID().slice(0, 8)}`,
    buyerUserId: seed.buyer ?? "buyer",
    organizationId: seed.organizationId ?? null,
    digest,
    totalMinor: total,
    lines,
  }));
  return db.prepare("SELECT * FROM orders WHERE buyer_user_id=? ORDER BY id DESC LIMIT 1").bind(seed.buyer ?? "buyer").first<{
    id: number; order_key: string; buyer_user_id: string; payer_organization_id: number | null;
    status: string; total_minor: number; currency: string; price_snapshot_json: string;
  }>();
}

export interface ReserveResult {
  attemptId: number | null;
  requestKey: string;
}

/** Reserves a payment attempt through the REAL reservePaymentStatements command. */
export async function reserveAttempt(db: D1Database, orderId: number, buyerUserId: string, requestKey = crypto.randomUUID()): Promise<ReserveResult> {
  await db.batch(paymentCommands.reservePaymentStatements(db, { orderId, buyerUserId, requestKey, provider: "zarinpal" }));
  const attempt = await db.prepare("SELECT id FROM payment_attempts WHERE request_key=?").bind(requestKey).first<{ id: number }>();
  if (attempt) {
    await db.batch(paymentCommands.attachAuthorityStatements(db, { requestKey, authority: `AUTH-${requestKey.slice(0, 12)}`, provider: "zarinpal" }));
  }
  return { attemptId: attempt?.id ?? null, requestKey };
}

/** Fulfills an order through the REAL verifiedOrderStatements command. */
export async function verifyOrder(db: D1Database, order: { id: number; buyer_user_id: string; payer_organization_id: number | null; total_minor: number; price_snapshot_json: string }, attemptId: number, operationId = crypto.randomUUID(), nowIso = "2026-10-03T00:00:00.000Z") {
  const lines = JSON.parse(order.price_snapshot_json) as SeedableLine[];
  return db.batch(paymentCommands.verifiedOrderStatements(db, {
    operationId,
    attemptId,
    orderId: order.id,
    buyerUserId: order.buyer_user_id,
    organizationId: order.payer_organization_id,
    providerReference: `ref-${attemptId}`,
    nowIso,
    totalMinor: order.total_minor,
    lines,
  }));
}

export async function countRows(db: D1Database, table: string, where = ""): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export function withFakedFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return responder(url, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

export const zarinpalIssued = (authority = "A000000000001"): Response =>
  new Response(JSON.stringify({ data: { code: 100, authority, ref_id: 999001 } }), { status: 200 });

export const zarinpalVerified = (refId = 999001, code = 100): Response =>
  new Response(JSON.stringify({ data: { code, ref_id: refId } }), { status: 200 });
