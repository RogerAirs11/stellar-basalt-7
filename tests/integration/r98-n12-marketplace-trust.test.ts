import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  createListing, createInquiry, listingDetail, inquiryConversation, replyToInquiry, buyerCloseInquiry,
  myWatchlist, watchlistAdd, watchlistRemove, myBlocks, blockCreate, blockRemove, attachListingDossier,
  MARKETPLACE_INTRODUCTION_DISCLOSURE,
} from "../../src/api/modules/marketplace";
import { decideCase, reportCase, appealCase, decideAppeal, assignCase } from "../../src/api/modules/moderation";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";

/**
 * R98-N12 evidence — trusted horse sale and inquiry operations on a REAL
 * database with every migration applied (including 0078).
 *
 * Acceptance pins:
 *  A. A seller publishes and closes one valid listing; another account cannot
 *     sell through broad editorial permission — the dossier link requires the
 *     SELLER's own active dossier for the SAME horse under a CURRENT mandate;
 *     editorial staff never carry that branch.
 *  B. Expired/withdrawn listings cannot accept misleading fresh inquiries; old
 *     conversations stay permission-protected (participant reads forever;
 *     staff read only while triaging a dispute about THAT inquiry; a closed
 *     conversation refuses new replies but keeps its history).
 *  C. Buyer save/watch, neutral participant blocks (bidirectional, never
 *     discoverable by the blocked side), buyer-side closure, and the honest
 *     seller-mandate badge (live-computed; an expired mandate is NEVER
 *     verified ownership and closes new inquiries).
 *  D. Moderation disputes keep independent case histories: reinstating ONE
 *     overturned case never overrides a separate active suspension.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

const LISTING_A = "aaaaaaaa-1111-4111-8111-111111111111";
const LISTING_B = "bbbbbbbb-2222-4222-8222-222222222222";

interface World {
  db: D1Database; env: Env;
  seller: AuthedSession; buyer: AuthedSession; stranger: AuthedSession; editor: AuthedSession; admin: AuthedSession;
}

async function world(): Promise<World> {
  const db = await openRealDatabase();
  await seedUser(db, "n12-seller", "user");
  await seedUser(db, "n12-buyer", "user");
  await seedUser(db, "n12-stranger", "user");
  await seedUser(db, "n12-editor", "editor");
  await seedUser(db, "n12-admin", "admin");
  await db.exec(`
    INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (91,'N12 STAR',1,NULL),(92,'N12 COMET',1,NULL);
    -- A CURRENT seller mandate for horse 91 (seller) and horse 92 (stranger's horse).
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
    VALUES ('g-n12-a',91,'n12-seller','owner','create_listing,manage_inquiries','admin_grant','2026-01-01T00:00:00.000Z'),
           ('g-n12-b',92,'n12-stranger','owner','create_listing,manage_inquiries','admin_grant','2026-01-01T00:00:00.000Z');
    INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,listed_at,updated_at,row_version)
    VALUES ('${LISTING_A}',91,'n12-seller','N12 Seller','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1);
  `);
  return {
    db, env: envOf(db),
    seller: await makeSession(db, "n12-seller"),
    buyer: await makeSession(db, "n12-buyer"),
    stranger: await makeSession(db, "n12-stranger"),
    editor: await makeSession(db, "n12-editor"),
    admin: await makeSession(db, "n12-admin"),
  };
}

async function makeInquiry(w: World, listingId: string, buyer: AuthedSession, key = `inq-${Math.random().toString(36).slice(2)}`): Promise<string> {
  const response = await createInquiry(authedRequest(`/api/market/listings/${listingId}/inquiries`, {
    buyer_name: "N12 Buyer", buyer_contact: "+98 900 000 0000", message: "Still available?",
  }, { session: buyer, headers: { "idempotency-key": key } }), w.env, listingId);
  expect(response.status).toBe(201);
  const body = await response.json() as { inquiry: { id: string } };
  return body.inquiry.id;
}

describe("N12 A. the dossier link is the seller's own, under a current mandate", () => {
  it("the seller attaches their own active dossier for the SAME horse", async () => {
    const w = await world();
    await w.db.exec(`INSERT INTO dossier_snapshots(id,horse_id,created_by_user_id,version,snapshot_json,sections_meta_json)
      VALUES (501,91,'n12-seller',1,'{}','{}')`);
    const response = await attachListingDossier(authedRequest(`/api/market/listings/${LISTING_A}/dossier`, { dossier_id: 501, expected_version: 1 }, { session: w.seller }), w.env, LISTING_A);
    expect(response.status).toBe(200);
    const body = await response.json() as { dossier_id: number; row_version: number };
    expect(body.dossier_id).toBe(501);
    expect(body.row_version).toBe(2);
  });

  it("another account's dossier for the same horse is refused", async () => {
    const w = await world();
    await w.db.exec(`INSERT INTO dossier_snapshots(id,horse_id,created_by_user_id,version,snapshot_json,sections_meta_json)
      VALUES (502,91,'n12-buyer',1,'{}','{}')`);
    await expect(attachListingDossier(authedRequest(`/api/market/listings/${LISTING_A}/dossier`, { dossier_id: 502, expected_version: 1 }, { session: w.seller }), w.env, LISTING_A))
      .rejects.toMatchObject({ status: 403, code: "dossier_not_allowed" });
  });

  it("a dossier for a DIFFERENT horse is refused honestly", async () => {
    const w = await world();
    await w.db.exec(`INSERT INTO dossier_snapshots(id,horse_id,created_by_user_id,version,snapshot_json,sections_meta_json)
      VALUES (503,92,'n12-seller',1,'{}','{}')`);
    await expect(attachListingDossier(authedRequest(`/api/market/listings/${LISTING_A}/dossier`, { dossier_id: 503, expected_version: 1 }, { session: w.seller }), w.env, LISTING_A))
      .rejects.toMatchObject({ status: 404, code: "dossier_mismatch" });
  });

  it("an EXPIRED seller mandate can never attach — and the public detail reports it honestly", async () => {
    const w = await world();
    // Expire the mandate from under the listing.
    await w.db.exec(`UPDATE horse_access_grants SET valid_until='2026-01-02T00:00:00.000Z' WHERE id='g-n12-a'`);
    await w.db.exec(`INSERT INTO dossier_snapshots(id,horse_id,created_by_user_id,version,snapshot_json,sections_meta_json)
      VALUES (504,91,'n12-seller',1,'{}','{}')`);
    await expect(attachListingDossier(authedRequest(`/api/market/listings/${LISTING_A}/dossier`, { dossier_id: 504, expected_version: 1 }, { session: w.seller }), w.env, LISTING_A))
      .rejects.toMatchObject({ status: 403, code: "horse_access_required" });
    // The public detail carries the LIVE-computed badge: expired is reported
    // as expired — never rendered as verified ownership.
    const detail = await listingDetail(w.db, LISTING_A, new URL("https://registry.example/api/market/listings/x"), null);
    const body = await detail.json() as { listing: { seller_mandate_current: boolean | null }; disclosure: { role: string } };
    expect(body.listing.seller_mandate_current).toBe(false);
    expect(body.disclosure.role).toBe("introduction_only");
  });
});

describe("N12 B. fresh inquiries vs old conversations", () => {
  it("an expired listing refuses a fresh inquiry with 404 (not a misleading success)", async () => {
    const w = await world();
    await w.db.exec(`UPDATE sales_listings SET expires_at=datetime('now','-1 day') WHERE id='${LISTING_A}'`);
    const response = await createInquiry(authedRequest(`/api/market/listings/${LISTING_A}/inquiries`, {
      buyer_name: "Late Buyer", buyer_contact: "+98 900 111 2233",
    }, { session: w.buyer }), w.env, LISTING_A).catch((error) => error);
    expect(response).toMatchObject({ status: 404, code: "not_found" });
  });

  it("the old conversation stays readable for BOTH participants after the listing is withdrawn — and stays invisible to everyone else", async () => {
    const w = await world();
    const inquiryId = await makeInquiry(w, LISTING_A, w.buyer);
    // The seller withdraws the listing.
    await w.db.exec(`UPDATE sales_listings SET status='withdrawn' WHERE id='${LISTING_A}'`);
    // Participant reads survive.
    const buyerView = await inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.buyer }), w.env, inquiryId);
    expect(buyerView.status).toBe(200);
    const buyerBody = await buyerView.json() as { listing_status: string; viewer_side: string; disclosure: { role: string } };
    expect(buyerBody.listing_status).toBe("withdrawn");
    expect(buyerBody.viewer_side).toBe("buyer");
    expect(buyerBody.disclosure.role).toBe("introduction_only");
    const sellerView = await inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.seller }), w.env, inquiryId);
    expect((await sellerView.json() as { viewer_side: string }).viewer_side).toBe("seller");
    // A third account gets an honest 404 — the conversation never leaks.
    await expect(inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.stranger }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 404 });
    // Staff can read ONLY while a dispute case targets THIS inquiry (and the
    // buyer's contact string stays out of the staff view).
    await expect(inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.admin }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.editor }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    const report = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_inquiries", target_id: inquiryId, reason: "fraud_suspected", details: "Suspicious payment request" }, { session: w.buyer }), w.env);
    expect(report.status).toBe(201);
    const caseId = ((await report.json()) as { case_id: number }).case_id;
    // A case existing is not enough: ordinary staff must be the current
    // assignee of an ACTIVE case before private message evidence is readable.
    await expect(inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.admin }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await assignCase(authedRequest(`/api/admin/moderation/cases/${caseId}/assign`, { operator_user_id: "n12-admin" }, { session: w.admin }), w.env, caseId);
    const staffView = await inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.admin }), w.env, inquiryId);
    expect(staffView.status).toBe(200);
    const staffBody = await staffView.json() as { viewer_side: string; inquiry: { buyer_contact: string | null } };
    expect(staffBody.viewer_side).toBe("staff");
    expect(staffBody.inquiry.buyer_contact).toBeNull();
    expect((await w.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='moderation.evidence_read' AND actor_user_id='n12-admin' AND entity_id=?").bind(inquiryId).first<{n:number}>())?.n).toBe(1);
    // Closing/dismissing the case revokes evidence access on the next request;
    // historical relationship to a case is never a standing permission.
    await decideCase(authedRequest(`/api/admin/moderation/cases/${caseId}/decide`, { decision: "dismiss", note: "Reviewed the inquiry evidence and closed the dispute." }, { session: w.admin }), w.env, caseId);
    await expect(inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.admin }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("the reply thread works for participants; a closed conversation refuses new replies but keeps history", async () => {
    const w = await world();
    const inquiryId = await makeInquiry(w, LISTING_A, w.buyer);
    // Seller replies; buyer replies back.
    const sellerReply = await replyToInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/replies`, { body: "Yes, available for inspection at the stable." }, { session: w.seller }), w.env, inquiryId);
    expect(sellerReply.status).toBe(201);
    const buyerReply = await replyToInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/replies`, { body: "I will call you this week." }, { session: w.buyer }), w.env, inquiryId);
    expect(buyerReply.status).toBe(201);
    // A non-participant can NEVER reply.
    await expect(replyToInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/replies`, { body: "hi" }, { session: w.stranger }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 403, code: "inquiry_participant_required" });
    // The buyer closes their own inquiry (status closure for buyers).
    const close = await buyerCloseInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/close`, { expected_version: 1 }, { session: w.buyer }), w.env, inquiryId);
    expect(close.status).toBe(200);
    // New replies are refused after closure; the thread history stays.
    await expect(replyToInquiry(authedRequest(`/api/market/inquiries/${inquiryId}/replies`, { body: "one more thing" }, { session: w.seller }), w.env, inquiryId))
      .rejects.toMatchObject({ status: 409, code: "inquiry_closed" });
    const thread = await inquiryConversation(authedRequest(`/api/market/inquiries/${inquiryId}`, {}, { session: w.buyer }), w.env, inquiryId);
    const threadBody = await thread.json() as { replies: unknown[]; inquiry: { status: string } };
    expect(threadBody.inquiry.status).toBe("closed");
    expect(threadBody.replies).toHaveLength(2);
  });
});

describe("N12 C. watchlist and neutral participant blocks", () => {
  it("the buyer saves and unsaves listings; the watchlist is private research data", async () => {
    const w = await world();
    const add = await watchlistAdd(authedRequest(`/api/market/watchlist/${LISTING_A}`, {}, { session: w.buyer }), w.env, LISTING_A);
    expect(await add.json()).toMatchObject({ added: true });
    // Idempotent second save.
    const again = await watchlistAdd(authedRequest(`/api/market/watchlist/${LISTING_A}`, {}, { session: w.buyer }), w.env, LISTING_A);
    expect(await again.json()).toMatchObject({ added: false });
    const list = await myWatchlist(authedRequest("/api/market/watchlist", {}, { session: w.buyer }), w.env);
    const listBody = await list.json() as { rows: Array<{ listing_id: string }> };
    expect(listBody.rows.map((row) => row.listing_id)).toContain(LISTING_A);
    // A stranger's watchlist never shows the buyer's rows.
    const strangerList = await myWatchlist(authedRequest("/api/market/watchlist", {}, { session: w.stranger }), w.env);
    expect(((await strangerList.json()) as { rows: unknown[] }).rows).toHaveLength(0);
    const remove = await watchlistRemove(authedRequest(`/api/market/watchlist/${LISTING_A}`, {}, { session: w.buyer, method: "DELETE" }), w.env, LISTING_A);
    expect(await remove.json()).toMatchObject({ removed: true });
  });

  it("a seller-blocked buyer gets a NEUTRAL refusal that never mentions the block — in both directions", async () => {
    const w = await world();
    // The seller blocks the buyer (private reason, both-direction refusal).
    const block = await blockCreate(authedRequest("/api/market/blocks", { blocked_user_id: "n12-buyer", reason_private: "harassment" }, { session: w.seller }), w.env);
    expect(await block.json()).toMatchObject({ blocked: true });
    const refusal = await createInquiry(authedRequest(`/api/market/listings/${LISTING_A}/inquiries`, {
      buyer_name: "Blocked Buyer", buyer_contact: "+98 900 111 2233",
    }, { session: w.buyer }), w.env, LISTING_A).catch((error) => error);
    // The refusal is neutral: no block is implied, nothing to discover.
    expect(refusal).toMatchObject({ status: 403, code: "inquiry_refused" });
    expect(String((refusal as { message?: string }).message)).not.toContain("block");
    // The reverse direction (blocked buyer tries to block the seller back) is
    // still their own management action; and the seller's own block list shows it.
    const mine = await myBlocks(authedRequest("/api/market/blocks", {}, { session: w.seller }), w.env);
    const mineBody = await mine.json() as { rows: Array<{ blocked_user_id: string }> };
    expect(mineBody.rows.map((row) => row.blocked_user_id)).toContain("n12-buyer");
    // The BLOCKED side's management view never reveals the block's existence.
    const buyerView = await myBlocks(authedRequest("/api/market/blocks", {}, { session: w.buyer }), w.env);
    expect(((await buyerView.json()) as { rows: unknown[] }).rows).toHaveLength(0);
    // Removing the block reopens contact.
    const unblock = await blockRemove(authedRequest("/api/market/blocks/n12-buyer", {}, { session: w.seller, method: "DELETE" }), w.env, "n12-buyer");
    expect(await unblock.json()).toMatchObject({ removed: true });
    await expect(makeInquiry(w, LISTING_A, w.buyer, `inq-unblocked-${Math.random().toString(36).slice(2)}`)).resolves.toBeTruthy();
  });
});

describe("N12 D. moderation disputes keep independent case histories", () => {
  it("reinstating ONE overturned case never overrides a separate active suspension", async () => {
    const w = await world();
    // A second listing to keep cases independent of the first suspension.
    await w.db.exec(`INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,listed_at,updated_at,row_version)
      VALUES ('${LISTING_B}',92,'n12-stranger','N12 Stranger','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)`);
    // Case 1 (by the buyer) and case 2 (by the stranger) on LISTING_A.
    const first = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: LISTING_A, reason: "fraud_suspected", details: "Case one" }, { session: w.buyer }), w.env);
    const second = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: LISTING_A, reason: "spam", details: "Case two" }, { session: w.stranger }), w.env);
    const caseOne = ((await first.json()) as { case_id: number }).case_id;
    const caseTwo = ((await second.json()) as { case_id: number }).case_id;
    // An admin hides through BOTH cases (two independent suspensions).
    await assignCase(authedRequest(`/api/admin/moderation/cases/${caseOne}/assign`, { operator_user_id: "n12-admin" }, { session: w.admin }), w.env, caseOne);
    await assignCase(authedRequest(`/api/admin/moderation/cases/${caseTwo}/assign`, { operator_user_id: "n12-admin" }, { session: w.admin }), w.env, caseTwo);
    await decideCase(authedRequest(`/api/admin/moderation/cases/${caseOne}/decide`, { decision: "hide", note: "Hiding through case one" }, { session: w.admin }), w.env, caseOne);
    await decideCase(authedRequest(`/api/admin/moderation/cases/${caseTwo}/decide`, { decision: "hide", note: "Hiding through case two" }, { session: w.admin }), w.env, caseTwo);
    // The seller appeals case one; the appeal OVERTURNS it.
    const appeal = await appealCase(authedRequest(`/api/moderation/cases/${caseOne}/appeal`, { statement: "The price evidence attached to this appeal shows the listing was accurate at its original publication time." }, { session: w.seller }), w.env, caseOne);
    expect(appeal.status).toBe(201);
    const appealId = ((await appeal.json()) as { appeal_id: number }).appeal_id;
    const overturned = await decideAppeal(authedRequest(`/api/admin/moderation/appeals/${appealId}/decide`, { outcome: "overturned", note: "Evidence accepted" }, { session: w.admin }), w.env, appealId);
    expect(overturned.status).toBe(200);
    // Case one's suspension is gone; case two's suspension STILL hides the
    // listing — an overturned case never resurrects the listing on its own.
    const suspensions = await w.db.prepare("SELECT id, reinstated_at, case_id FROM listing_suspensions WHERE listing_id=? ORDER BY id").bind(LISTING_A).all<{ id: number; reinstated_at: string | null; case_id: number | null }>();
    const rows = suspensions.results ?? [];
    expect(rows).toHaveLength(2);
    const byCase = new Map(rows.map((row) => [row.case_id, row]));
    expect(byCase.get(caseOne)?.reinstated_at).not.toBeNull();
    expect(byCase.get(caseTwo)?.reinstated_at).toBeNull();
    const active = await w.db.prepare("SELECT COUNT(*) AS n FROM listing_suspensions WHERE listing_id=? AND reinstated_at IS NULL").bind(LISTING_A).first<{ n: number }>();
    expect(Number(active?.n ?? 0)).toBe(1);
    // Public search stays hidden; only the seller/staff still reach the detail.
    const publicDetail = await listingDetail(w.db, LISTING_A, new URL("https://registry.example/api/market/listings/x"), null).catch((error) => error);
    expect(publicDetail).toMatchObject({ status: 404 });
    const sellerDetail = await listingDetail(w.db, LISTING_A, new URL("https://registry.example/api/market/listings/x"), { user: { id: "n12-seller", role: "user" } });
    const sellerBody = await sellerDetail.json() as { listing: { suspended: boolean } };
    expect(sellerBody.listing.suspended).toBe(true);
  });
});

describe("N12 disclosure honesty", () => {
  it("the introduction-only disclosure is carried on the listing detail (EN + FA)", async () => {
    const w = await world();
    const detail = await listingDetail(w.db, LISTING_A, new URL("https://registry.example/api/market/listings/x"), null);
    const body = await detail.json() as { disclosure: typeof MARKETPLACE_INTRODUCTION_DISCLOSURE };
    expect(body.disclosure.role).toBe("introduction_only");
    expect(body.disclosure.en).toContain("does not escrow");
    expect(body.disclosure.fa).toContain("معرفی");
  });
});
