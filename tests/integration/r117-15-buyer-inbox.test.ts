import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  sentInquiries, myListings, createInquiry, updateInquiryStatus, buyerCloseInquiry,
  replyToInquiry, inquiryConversation, updateListingStatus,
} from "../../src/api/modules/marketplace";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";

/**
 * R117-15 evidence (Master AI R117 handoff D19) — the scoped BUYER inquiry
 * inbox on a REAL database with every migration applied.
 *
 * Acceptance pins (per the reviewed ticket):
 *  1. No inquiry/contact data crosses principals: the buyer-owned query is a
 *     separate bounded paginated query (never the seller's inbox); buyer A
 *     sees exactly A's sent inquiries, buyer B exactly B's, a stranger none.
 *  2. A buyer sees only their requests and can close only their own: a
 *     stranger's close on A's inquiry is refused 403 participant_required;
 *     A's own close is versioned and persists.
 *  3. Unreadable records produce the existing neutral permission response:
 *     an expired seller mandate drops the inquiry from the SELLER's
 *     myListings view while the BUYER's own sent row survives; a soft-deleted
 *     horse keeps the buyer's row with the horse names absent, not fabricated.
 *  4. Real status/history persists after reload: seller responses, replies
 *     (count + last activity) and listing lifecycle (sold says sold) are all
 *     reported honestly in the buyer's rows; the conversation stays readable.
 *  5. Lost responses reconcile idempotently (one key, one close) and stale
 *     versions refuse 409 with the current version.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

const LISTING_A = "aaaaaaaa-1111-4111-8111-111111111111";
const LISTING_B = "bbbbbbbb-2222-4222-8222-222222222222";

interface World {
  db: D1Database; env: Env;
  seller: AuthedSession; buyerA: AuthedSession; buyerB: AuthedSession; stranger: AuthedSession;
}

async function world(): Promise<World> {
  const db = await openRealDatabase();
  await seedUser(db, "r15-seller", "user");
  await seedUser(db, "r15-buyer-a", "user");
  await seedUser(db, "r15-buyer-b", "user");
  await seedUser(db, "r15-stranger", "user");
  await db.exec(`
    INSERT INTO horses(id,name_latin,name_native,is_active,deleted_at) VALUES
      (91,'R15 STAR','رستم',1,NULL),(92,'R15 COMET',NULL,1,NULL);
    -- A CURRENT seller mandate over both horses (create_listing + manage_inquiries).
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
    VALUES ('g-r15-a',91,'r15-seller','owner','create_listing,manage_inquiries','admin_grant','2026-01-01T00:00:00.000Z'),
           ('g-r15-b',92,'r15-seller','owner','create_listing,manage_inquiries','admin_grant','2026-01-01T00:00:00.000Z');
    INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,listed_at,updated_at,row_version,title)
    VALUES ('${LISTING_A}',91,'r15-seller','R15 Seller','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1,'R15 first listing'),
           ('${LISTING_B}',92,'r15-seller','R15 Seller','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1,'R15 second listing');
  `);
  return {
    db, env: envOf(db),
    seller: await makeSession(db, "r15-seller"),
    buyerA: await makeSession(db, "r15-buyer-a"),
    buyerB: await makeSession(db, "r15-buyer-b"),
    stranger: await makeSession(db, "r15-stranger"),
  };
}

async function inquire(w: World, listingId: string, buyer: AuthedSession, name: string, key = `inq-${Math.random().toString(36).slice(2)}`): Promise<string> {
  const response = await createInquiry(authedRequest(`/api/market/listings/${listingId}/inquiries`, {
    buyer_name: name, buyer_contact: "+98 900 000 0000", message: `Still available? — ${name}`,
  }, { session: buyer, headers: { "idempotency-key": key } }), w.env, listingId);
  expect(response.status).toBe(201);
  const body = await response.json() as { inquiry: { id: string } };
  return body.inquiry.id;
}

async function sentRows(w: World, buyer: AuthedSession, query = ""): Promise<{ status: number; rows: Array<Record<string, unknown>>; pagination: { limit: number; offset: number; total: number } }> {
  const response = await sentInquiries(authedRequest(`/api/market/inquiries/sent${query}`, undefined, { session: buyer }), w.env);
  const body = await response.json() as { rows: Array<Record<string, unknown>>; pagination: { limit: number; offset: number; total: number } };
  return { status: response.status, rows: body.rows ?? [], pagination: body.pagination };
}

describe("R117-15 1. the buyer-owned query never crosses principals", () => {
  it("buyer A sees exactly A's sent inquiries; buyer B exactly B's; a stranger none", async () => {
    const w = await world();
    const a1 = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    const a2 = await inquire(w, LISTING_B, w.buyerA, "Buyer A");
    const b1 = await inquire(w, LISTING_A, w.buyerB, "Buyer B");
    const a = await sentRows(w, w.buyerA);
    expect(a.status).toBe(200);
    expect(a.rows.map((row) => row.id).sort()).toEqual([a1, a2].sort());
    expect(a.pagination).toEqual({ limit: 50, offset: 0, total: 2 });
    const b = await sentRows(w, w.buyerB);
    expect(b.rows.map((row) => row.id)).toEqual([b1]);
    expect(b.pagination.total).toBe(1);
    const stranger = await sentRows(w, w.stranger);
    expect(stranger.rows).toEqual([]);
    expect(stranger.pagination.total).toBe(0);
  });

  it("the sent rows carry no seller contact fields and no other buyer's data", async () => {
    const w = await world();
    await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    await inquire(w, LISTING_A, w.buyerB, "Buyer B");
    const a = await sentRows(w, w.buyerA);
    expect(a.rows).toHaveLength(1);
    for (const forbidden of ["seller_contact_name", "seller_contact_phone", "seller_contact_email", "buyer_name", "buyer_contact"]) {
      expect(a.rows[0]).not.toHaveProperty(forbidden);
    }
    // The row names WHAT was inquired about (listing title / horse), never a buyer identity.
    expect(String(a.rows[0].listing_title)).toBe("R15 first listing");
    expect(String(a.rows[0].name_latin)).toBe("R15 STAR");
  });

  it("a stranger cannot read or close another buyer's inquiry", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    await expect(inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, undefined, { session: w.stranger }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(buyerCloseInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/close`, { expected_version: 1 }, { session: w.stranger }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 403, code: "inquiry_participant_required" });
    // The refusal changed nothing: the inquiry is still open.
    const a = await sentRows(w, w.buyerA);
    expect(String(a.rows[0].status)).toBe("new");
  });

  it("an unauthenticated caller is refused honestly", async () => {
    const w = await world();
    await expect(sentInquiries(authedRequest("/api/market/inquiries/sent", undefined, {}), w.env))
      .rejects.toMatchObject({ status: 401 });
  });
});

describe("R117-15 2. honest status and history persist in the buyer's rows", () => {
  it("the seller's versioned response and replies surface in the buyer's sent row", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    const statusResponse = await updateInquiryStatus(authedRequest(`/api/market/inquiries/${inquiryId}/status`, { status: "contacted", expected_version: 1 }, { session: w.seller }), w.env, inquiryId);
    expect(statusResponse.status).toBe(200);
    const replyResponse = await replyToInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/replies`, { body: "Yes, still available — the horse is sound." }, { session: w.seller }), w.env, inquiryId);
    expect(replyResponse.status).toBe(201);
    const a = await sentRows(w, w.buyerA);
    expect(String(a.rows[0].status)).toBe("contacted");
    expect(Number(a.rows[0].row_version)).toBe(2);
    expect(Number(a.rows[0].reply_count)).toBe(1);
    expect(a.rows[0].last_reply_at).toBeTruthy();
  });

  it("a SOLD listing says sold in the buyer's row while the conversation stays readable", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    const sold = await updateListingStatus(authedRequest(`/api/market/listings/${LISTING_A}/status`, { status: "sold", expected_version: 1 }, { session: w.seller }), w.env, LISTING_A);
    expect(sold.status).toBe(200);
    const a = await sentRows(w, w.buyerA);
    expect(String(a.rows[0].listing_status)).toBe("sold");
    // History stays reachable for the participant even after the sale.
    const conversation = await inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, undefined, { session: w.buyerA }), w.env, inquiryId);
    const body = await conversation.json() as { listing_status: string; viewer_side: string };
    expect(body.listing_status).toBe("sold");
    expect(body.viewer_side).toBe("buyer");
  });

  it("a soft-deleted horse keeps the buyer's own row with the name absent, not fabricated", async () => {
    const w = await world();
    await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    await w.db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=91");
    const a = await sentRows(w, w.buyerA);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].name_latin).toBeNull();
    expect(a.rows[0].name_native).toBeNull();
    // The listing title still identifies what was inquired about.
    expect(String(a.rows[0].listing_title)).toBe("R15 first listing");
  });
});

describe("R117-15 3. permission loss is neutral and the buyer's own record survives", () => {
  it("an expired seller mandate drops the inquiry from the SELLER's view; the buyer's sent row survives", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    // The seller sees the inquiry while the mandate is current.
    const before = await myListings(authedRequest("/api/market/mine", undefined, { session: w.seller }), w.env);
    const beforeBody = await before.json() as { inquiries: Array<{ id: string }> };
    expect(beforeBody.inquiries.map((row) => row.id)).toContain(inquiryId);
    // Expire the mandate from under the listing.
    await w.db.exec("UPDATE horse_access_grants SET valid_until='2026-01-02T00:00:00.000Z' WHERE id='g-r15-a'");
    const after = await myListings(authedRequest("/api/market/mine", undefined, { session: w.seller }), w.env);
    const afterBody = await after.json() as { inquiries: Array<{ id: string }> };
    expect(afterBody.inquiries.map((row) => row.id)).not.toContain(inquiryId);
    // The buyer's OWN sent row is untouched by the seller's permission loss.
    const a = await sentRows(w, w.buyerA);
    expect(a.rows.map((row) => row.id)).toEqual([inquiryId]);
    expect(String(a.rows[0].listing_status)).toBe("active");
  });
});

describe("R117-15 4. versioned close-own, stale refusal, lost-response replay", () => {
  it("the buyer closes their own inquiry and the effect persists", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    const close = await buyerCloseInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/close`, { expected_version: 1 }, { session: w.buyerA }), w.env, inquiryId);
    expect(close.status).toBe(200);
    const a = await sentRows(w, w.buyerA);
    expect(String(a.rows[0].status)).toBe("closed");
    expect(Number(a.rows[0].row_version)).toBe(2);
  });

  it("a stale close refuses 409 carrying the current version", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    // A concurrent write advances the version first.
    await updateInquiryStatus(authedRequest(`/api/market/inquiries/${inquiryId}/status`, { status: "contacted", expected_version: 1 }, { session: w.seller }), w.env, inquiryId);
    await expect(buyerCloseInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/close`, { expected_version: 1 }, { session: w.buyerA }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 409, code: "inquiry_version_conflict", details: { current_version: 2 } });
  });

  it("a lost response reconciles idempotently: one key, one close, exactly-once effect", async () => {
    const w = await world();
    const inquiryId = await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    const key = `lost-${Math.random().toString(36).slice(2)}`;
    // The first submit "loses its response" — the write landed, the buyer never saw it.
    const first = await buyerCloseInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/close`, { expected_version: 1 }, { session: w.buyerA, headers: { "idempotency-key": key } }), w.env, inquiryId);
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotency-replayed")).toBeNull();
    // The buyer retries the SAME intent (same key, same body) — the recorded
    // outcome is replayed, not a second close.
    const replay = await buyerCloseInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/close`, { expected_version: 1 }, { session: w.buyerA, headers: { "idempotency-key": key } }), w.env, inquiryId);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const replayBody = await replay.json() as { inquiry: { status: string; row_version: number } };
    expect(replayBody.inquiry.status).toBe("closed");
    expect(replayBody.inquiry.row_version).toBe(2);
    // Exactly-once: the stored version advanced exactly one step.
    const row = await w.db.prepare("SELECT status,row_version FROM sales_inquiries WHERE id=?").bind(inquiryId).first<{ status: string; row_version: number }>();
    expect(row?.status).toBe("closed");
    expect(Number(row?.row_version)).toBe(2);
  });
});

describe("R117-15 5. the bounded paginated query", () => {
  it("limit/offset page the buyer's own rows and report the total honestly", async () => {
    const w = await world();
    await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    await inquire(w, LISTING_B, w.buyerA, "Buyer A");
    await inquire(w, LISTING_A, w.buyerB, "Buyer B");
    const page1 = await sentRows(w, w.buyerA, "?limit=1&offset=0");
    expect(page1.rows).toHaveLength(1);
    expect(page1.pagination).toEqual({ limit: 1, offset: 0, total: 2 });
    const page2 = await sentRows(w, w.buyerA, "?limit=1&offset=1");
    expect(page2.rows).toHaveLength(1);
    expect(page2.pagination.total).toBe(2);
    // Newest first: the two pages never overlap.
    expect(page1.rows[0].id).not.toBe(page2.rows[0].id);
    // Buyer B's total is independent.
    const b = await sentRows(w, w.buyerB, "?limit=1&offset=0");
    expect(b.pagination.total).toBe(1);
  });

  it("out-of-range pagination parameters are refused 400, never silently clamped", async () => {
    const w = await world();
    await inquire(w, LISTING_A, w.buyerA, "Buyer A");
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?offset=-1", "?offset=abc"]) {
      await expect(sentInquiries(authedRequest(`/api/market/inquiries/sent${query}`, undefined, { session: w.buyerA }), w.env))
        .rejects.toMatchObject({ status: 400, code: "invalid_query_parameter" });
    }
  });
});
