import { describe, expect, it } from "vitest";
import { PILOT_OFFERS, FREE_WORKSPACE_LIMIT, SPONSORED_LABELS, OFFER_TRUST_NOTE } from "../../src/commerce/catalog";
import { findActiveEntitlement, hasEntitlement, requireEntitlement } from "../../src/commerce/entitlementGates";
import { createWorkspace, assignWorkspaceStaff } from "../../src/api/modules/workspaces";
import { adminSponsorListing, listListings } from "../../src/api/modules/marketplace";
import { publicOffers } from "../../src/api/modules/billing";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession, seedBillingPrices, createOrder, reserveAttempt, verifyOrder } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P19 — the first paid offers, public trust protected.
 *
 * Acceptance pinned:
 *  - an EXPIRED plan removes paid conveniences without deleting customer
 *    records (the workspace gate refuses; existing rows untouched);
 *  - a paid unrelated account still gets 403/404 on private resources
 *    (entitlement checks NEVER participate in resource authorization);
 *  - sponsored results are visibly labeled in BOTH languages;
 *  - the free floor is stated and never for sale.
 */

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  entitlement?: Record<string, unknown> | null;
  ownedCount?: { n: number };
  listing?: Record<string, unknown> | null;
  priceRows?: Array<Record<string, unknown>>;
  updateChanges?: number;
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string, args: unknown[]): unknown => {
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    // This offer fixture models optional MFA with no enrolled factor. Real
    // factor/session enforcement is covered by the migrated-database suite.
    if (sql.startsWith("SELECT 1 AS allowed WHERE") && sql.includes("auth_mfa_session_assurance")) {
      expect(args[0]).toBe("optional");
      expect(args[1]).toBe(script.session?.id);
      return script.session ? { allowed: 1 } : null;
    }
    if (sql.includes("FROM entitlements") && sql.includes("ORDER BY expires_at DESC LIMIT 1")) return script.entitlement ?? null;
    if (sql.includes("COUNT(*) AS n FROM workspace_collections")) return script.ownedCount ?? { n: 0 };
    if (sql.includes("FROM sales_listings WHERE id=?")) return script.listing ?? null;
    if (sql.includes("FROM workspace_collections WHERE id=? AND deleted_at IS NULL")) return { id: 7, owner_user_id: "owner-1", organization_id: null };
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("FROM billing_prices WHERE active=1")) return { results: script.priceRows ?? [] };
    return { results: [] };
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => answerFirst(sql, args),
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: script.updateChanges ?? 1 } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      return statements.map((statement) => ({
        results: [], success: true,
        meta: { changes: /UPDATE/i.test(statement.sql) ? (script.updateChanges ?? 1) : 1, last_row_id: 900 },
      }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const userSession = {
  session_id: "s-1", csrf_token: "csrf-1", expires_at: new Date(Date.now() + 3600_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "user-1", email: "user@example.com", display_name: "User", role: "user", is_active: 1,
};
const adminSession = { ...userSession, id: "admin-1", role: "admin" };
const ORIGIN = "https://registry.example";
const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };

function request(body: unknown, path: string, method = "POST", session = userSession): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

describe("P19 catalog honesty", () => {
  it("is exactly THREE pilot offers with skus matching the billing catalog", () => {
    expect(PILOT_OFFERS.map((offer) => offer.sku)).toEqual([
      "farm_workspace_monthly",
      "professional_tools_monthly",
      "sponsored_visibility_monthly",
    ]);
    for (const offer of PILOT_OFFERS) {
      expect(offer.free_tier_en).toBeTruthy();
      expect(offer.free_tier_fa).toBeTruthy();
      expect(offer.paid_en).toBeTruthy();
      expect(offer.paid_fa).toBeTruthy();
    }
  });

  it("the free floor is one workspace, and the trust note forbids the unsellable", () => {
    expect(FREE_WORKSPACE_LIMIT).toBe(1);
    expect(OFFER_TRUST_NOTE).toContain("never confers official status");
    expect(OFFER_TRUST_NOTE).toContain("never grants access to another owner");
    expect(OFFER_TRUST_NOTE).toContain("stay free");
  });

  it("sponsored labels exist in both languages", () => {
    expect(SPONSORED_LABELS).toEqual({ en: "Sponsored", fa: "تبلیغ" });
  });

  it("the public offers route carries prices, free-forever floor and the trust note", async () => {
    const db = makeDb({ priceRows: [{ sku: "farm_workspace_monthly", version: 1, name_en: "Farm workspace", name_fa: "فضا", price_minor: 19_000_000, period_days: 30 }] });
    const response = await publicOffers(request({}, "/api/commerce/offers", "GET"), { ...env, DB: db });
    const body = await response.json() as {
      offers: Array<{ sku: string; price: { price_toman: number; currency: string } | null }>;
      free_forever: Array<{ en: string; fa: string }>;
      trust_note: string;
    };
    expect(body.offers).toHaveLength(3);
    const farm = body.offers.find((offer) => offer.sku === "farm_workspace_monthly");
    expect(farm?.price?.price_toman).toBe(1_900_000);
    expect(farm?.price?.currency).toBe("IRR");
    expect(body.offers.find((offer) => offer.sku === "professional_tools_monthly")?.price).toBeNull(); // not in catalog yet = not purchasable, honest null
    expect(body.free_forever.length).toBeGreaterThanOrEqual(3);
    expect(body.trust_note).toBe(OFFER_TRUST_NOTE);
  });
});

describe("P19 entitlement gates (real database — R95-N08 atomic capacity)", () => {
  // R95-N08 moved the free/paid capacity decision INSIDE the atomic insert,
  // so these acceptance proofs run on a real database with every migration
  // applied (same doctrine as the R95-N01 mock-to-real rewrite).
  const env = (db: D1Database) => ({ SESSION_COOKIE_NAME: "hr_session", DB: db }) as never;
  const request = (body: unknown, path: string, session: { cookie: string; csrfToken: string }) =>
    new Request(`https://registry.example${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie, "x-csrf-token": session.csrfToken, origin: "https://registry.example" }, body: JSON.stringify(body) });

  async function buyerWithFirstWorkspace(db: D1Database) {
    await seedUser(db, "user-1", "user");
    const session = await makeSession(db, "user-1");
    const first = await createWorkspace(request({ name: "First farm" }, "/api/workspaces", session), env(db));
    expect(first.status).toBe(201);
    return session;
  }

  it("an EXPIRED entitlement is inactive — the convenience is refused, records untouched", async () => {
    const db = await openRealDatabase();
    const session = await buyerWithFirstWorkspace(db);
    // A REAL paid plan through the real command path, then expired.
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "user-1", key: "expired-plan-order" });
    const { attemptId } = await reserveAttempt(db, order!.id, "user-1");
    await verifyOrder(db, order!, attemptId!);
    await db.exec("UPDATE entitlements SET expires_at=datetime('now','-1 day') WHERE holder_key='user:user-1'");
    await expect(createWorkspace(request({ name: "Second farm" }, "/api/workspaces", session), env(db)))
      .rejects.toMatchObject({ status: 402, code: "entitlement_required" });
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM workspace_collections WHERE deleted_at IS NULL").first<{ n: number }>();
    expect(Number(rows?.n)).toBe(1); // the free first workspace is untouched
  });

  it("an ACTIVE entitlement allows the second workspace; the free first one always works", async () => {
    const db = await openRealDatabase();
    const session = await buyerWithFirstWorkspace(db);
    await seedBillingPrices(db);
    const order = await createOrder(db, { buyer: "user-1", key: "active-plan-order" });
    const { attemptId } = await reserveAttempt(db, order!.id, "user-1");
    await verifyOrder(db, order!, attemptId!);
    const second = await createWorkspace(request({ name: "Second farm" }, "/api/workspaces", session), env(db));
    expect(second.status).toBe(201);
  });

  it("the refusal message names the free tier (never a punishment for non-payment)", async () => {
    const db = await openRealDatabase();
    const session = await buyerWithFirstWorkspace(db);
    let cause: HttpError | undefined;
    try {
      await createWorkspace(request({ name: "Second farm" }, "/api/workspaces", session), env(db));
    } catch (error) {
      cause = error as HttpError;
    }
    expect(cause).toBeInstanceOf(HttpError);
    expect(cause?.message).toContain("free tier");
    expect(cause?.message).toContain("untouched");
  });
});

describe("P19 entitlement gate boundaries (mocked route paths)", () => {
  it("a PAID unrelated account still gets 404 on another user's private workspace (entitlements never authorize resources)", async () => {
    // user-1 holds an active farm plan but is NOT the owner of workspace 7
    // (owned by owner-1) and has no staff grant — authorization must fail.
    const db = makeDb({ session: userSession, entitlement: { sku: "farm_workspace_monthly", expires_at: "2027-01-01T00:00:00Z" } });
    await expect(assignWorkspaceStaff(request({ user_id: "user-2", actions: "view" }, "/api/workspaces/7/staff"), { ...env, DB: db }, 7 as never))
      .rejects.toMatchObject({ status: 404 });
    expect(db.__writes).toHaveLength(0); // zero writes on the refused path
  });

  it("requireEntitlement throws the honest 402; hasEntitlement is live", async () => {
    const db = makeDb({ entitlement: null });
    expect(await hasEntitlement(db, "user-1", "farm_workspace_monthly")).toBe(false);
    await expect(requireEntitlement(db, "user-1", "farm_workspace_monthly", "One workspace is free forever."))
      .rejects.toMatchObject({ status: 402 });
    const paid = makeDb({ entitlement: { sku: "farm_workspace_monthly", expires_at: "2027-01-01T00:00:00Z" } });
    expect(await hasEntitlement(paid, "user-1", "farm_workspace_monthly")).toBe(true);
    expect((await requireEntitlement(paid, "user-1", "farm_workspace_monthly", "free tier note")).sku).toBe("farm_workspace_monthly");
  });
});

describe("P19 sponsored placement", () => {
  it("requires the listing seller's ACTIVE sponsored entitlement — never granted free", async () => {
    const noEntitlement = makeDb({ session: adminSession, listing: { id: "listing-1", horse_id: 9, seller_user_id: "seller-1", status: "active" }, entitlement: null });
    await expect(adminSponsorListing(request({ days: 30 }, "/api/admin/market/listings/listing-1/sponsor", "POST", adminSession), { ...env, DB: noEntitlement }, "listing-1"))
      .rejects.toMatchObject({ status: 409, code: "sponsor_entitlement_required" });

    const paid = makeDb({ session: adminSession, listing: { id: "listing-1", horse_id: 9, seller_user_id: "seller-1", status: "active" }, entitlement: { sku: "sponsored_visibility_monthly", expires_at: "2027-01-01T00:00:00Z" } });
    const response = await adminSponsorListing(request({ days: 30 }, "/api/admin/market/listings/listing-1/sponsor", "POST", adminSession), { ...env, DB: paid }, "listing-1");
    const body = await response.json() as { sponsored: boolean; labels: { en: string; fa: string } };
    expect(body.sponsored).toBe(true);
    expect(body.labels).toEqual(SPONSORED_LABELS);
    expect(paid.__writes.some((w) => w.sql.includes("SET sponsored_until=?"))).toBe(true);
    expect(paid.__writes.some((w) => w.args.includes("listing.sponsored"))).toBe(true); // audited
  });

  it("only an ACTIVE listing can be sponsored", async () => {
    const db = makeDb({ session: adminSession, listing: { id: "listing-1", horse_id: 9, seller_user_id: "seller-1", status: "sold" }, entitlement: { sku: "sponsored_visibility_monthly", expires_at: "2027-01-01T00:00:00Z" } });
    await expect(adminSponsorListing(request({ days: 30 }, "/api/admin/market/listings/listing-1/sponsor", "POST", adminSession), { ...env, DB: db }, "listing-1"))
      .rejects.toMatchObject({ status: 409, code: "not_sponsorable" });
  });

  it("the public list labels sponsored rows bilingually and states the scientific exclusion", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().replace("T", " ").slice(0, 19);
    const db = makeDb({
      priceRows: [], // unused here
    });
    // listListings reads via db.batch -> returns rows; simulate through answerAll in a fresh db
    const dbWithRows = makeDb({});
    (dbWithRows as unknown as { __writes: Recorded[] }).__writes = [];
    const listDb = Object.assign(dbWithRows, {
      batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
        for (const statement of statements) statements.forEach(() => undefined);
        return [
          // R111 computes this flag in the SELECT so sorting and labeling
          // share one strict timestamp/clock. SQL parity is exercised by
          // sponsoredR111.test.ts and the disposable PostgreSQL rehearsal.
          { results: [{ id: "listing-s", sponsored_until: future, sponsored_active: 1 }, { id: "listing-n", sponsored_until: null, sponsored_active: 0 }], success: true, meta: {} },
          { results: [{ n: 2 }], success: true, meta: {} },
        ];
      },
    });
    const response = await listListings(listDb as unknown as D1Database, new URL("https://registry.example/api/market/listings"));
    const body = await response.json() as { rows: Array<{ id: string; sponsored: boolean; sponsored_label: { en: string; fa: string } | null }>; sponsored_note: string };
    expect(body.rows[0]).toMatchObject({ id: "listing-s", sponsored: true });
    expect(body.rows[0]?.sponsored_label).toEqual({ en: "Sponsored", fa: "تبلیغ" });
    expect(body.rows[1]).toMatchObject({ id: "listing-n", sponsored: false });
    expect(body.rows[1]?.sponsored_label).toBeNull();
    expect(body.sponsored_note).toContain("never part of scientific breeding rankings");
  });
});
