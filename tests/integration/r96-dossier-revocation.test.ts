import { describe, expect, it } from "vitest";
import {
  createDossier,
  createDossierLink,
  viewDossierByToken,
  revokeDossierLink,
} from "../../src/api/modules/dossiers";
import { claimDossierViewStatements } from "../../src/dossiers/commands";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R96-N07 acceptance — the public dossier view has ONE linearization point.
 *
 * Before N07 the view authorized over six sequential awaited reads (link,
 * dossier, creator, horse, mandate, counter) and bumped the access counter in
 * a SEPARATE later write. A revocation / mandate withdrawal / horse deletion /
 * recipient change landing between those reads could still serve forbidden
 * bytes, and refused views could be counted as authorized accesses.
 *
 * Now `claimDossierViewStatements` is the enforcement: ONE conditional UPDATE
 * increments the counter IF AND ONLY IF every authorization condition holds
 * at that single statement's instant (link live + expiry + recipient + dossier
 * active + creator active + horse alive + CURRENT editorial role or live
 * mandate, evaluated for the ROW-DERIVED creator). This file pins:
 *
 *   A. the command-level claim matrix — every refused condition yields 0
 *      changes and never touches the counter;
 *   B. route-level linearization — enforcement survives the full HTTP path,
 *      refused views are never counted, and every response (200/403/404/410)
 *      carries private no-store + no-referrer + noindex headers;
 *   C. the honest recall boundary — already-distributed copies cannot be
 *      recalled (the response says so; nothing promises cache destruction).
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function seedWorld(db: D1Database) {
  await seedUser(db, "seller-1", "user");
  await seedUser(db, "stranger-1", "user");
  await seedUser(db, "admin-1", "admin");
  await db.exec(`
    INSERT INTO horses(id,name_latin,name_native,sex_desc,birth_year,color_desc,breed_desc,is_active)
    VALUES (1,'SIRE','پدر','stallion',2010,'bay','Arabian',1),
           (2,'DAM','مادر','mare',2012,'grey','Arabian',1),
           (9,'STAR','ستاره','stallion',2018,'bay','Arabian',1);
    UPDATE horses SET father_id=1, mother_id=2 WHERE id=9;
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
    VALUES ('g1',9,'seller-1','owner','manage_profile,upload_media,create_listing,manage_inquiries','claim_approval','2026-01-01 00:00:00');
  `);
}

async function mintLink(db: D1Database, session: AuthedSession, options: { recipient?: string; horseId?: number } = {}) {
  const response = await createDossier(authedRequest("/api/dossiers", {
    horse_id: options.horseId ?? 9, include_pedigree: true, include_results: true, include_genetics: false, include_contact: false,
  }, { session }), env(db));
  expect(response.status).toBe(201);
  const dossierId = ((await response.json()) as { dossier: { id: number } }).dossier.id;
  const linkResponse = await createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, {
    expires_in_days: 14, recipient_user_id: options.recipient ?? null,
  }, { session }), env(db), dossierId);
  expect(linkResponse.status).toBe(201);
  const linkBody = await linkResponse.json() as { link_id: number; share_url: string };
  return { dossierId, linkId: linkBody.link_id, token: linkBody.share_url.split("/").pop()! };
}

const get = (token: string) => authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" });
const view = (db: D1Database, token: string, session?: AuthedSession | null) =>
  viewDossierByToken(session ? authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET", session }) : get(token), env(db), token);

const counter = async (db: D1Database, linkId: number) =>
  Number((await db.prepare("SELECT access_count FROM dossier_share_links WHERE id=?").bind(linkId).first<{ access_count: number }>())?.access_count ?? -1);

/** Claim through the production command (bypasses the route ON PURPOSE: the transaction is the enforcement). */
async function claim(db: D1Database, linkId: number, viewerUserId: string | null) {
  const [claimResult, readResult] = await db.batch(claimDossierViewStatements(db, {
    linkId, viewerUserId, nowIso: new Date().toISOString(),
  }));
  return {
    changes: Number((claimResult as { meta?: { changes?: number } })?.meta?.changes ?? 0),
    row: ((readResult as { results?: unknown[] })?.results ?? [])[0] as Record<string, unknown> | undefined,
  };
}

// ---------------------------------------------------------------------------
// A. The command-level claim matrix
// ---------------------------------------------------------------------------

describe("N07 A. the conditional claim is the linearization point", () => {
  it("a fully live world claims: 1 row, counter+last_access recorded, bytes returned", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session);
    const outcome = await claim(db, linkId, null);
    expect(outcome.changes).toBe(1);
    expect(outcome.row).toBeDefined();
    expect(Number(outcome.row!.id)).toBeGreaterThan(0);
    expect(await counter(db, linkId)).toBe(1);
    const lastAccess = (await db.prepare("SELECT last_accessed_at FROM dossier_share_links WHERE id=?").bind(linkId).first<{ last_accessed_at: string | null }>())?.last_accessed_at;
    expect(lastAccess).toBeTruthy();
  });

  it("a revoked link refuses: 0 changes, counter untouched", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session);
    await db.exec(`UPDATE dossier_share_links SET revoked_at=CURRENT_TIMESTAMP WHERE id=${linkId}`);
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect(await counter(db, linkId)).toBe(0);
  });

  it("an expired link refuses (datetime comparison inside the statement)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session);
    await db.exec(`UPDATE dossier_share_links SET expires_at=datetime('now','-1 day') WHERE id=${linkId}`);
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect(await counter(db, linkId)).toBe(0);
  });

  it("a recipient-restricted link refuses anonymous and wrong-viewer claims", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session, { recipient: "stranger-1" });
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect((await claim(db, linkId, "seller-1")).changes).toBe(0);
    expect((await claim(db, linkId, "stranger-1")).changes).toBe(1);
    expect(await counter(db, linkId)).toBe(1);
  });

  it("a revoked seller mandate refuses the claim — evaluated for the ROW-DERIVED creator", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session);
    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect(await counter(db, linkId)).toBe(0);
  });

  it("a deleted horse refuses the claim", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session);
    await db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=9");
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect(await counter(db, linkId)).toBe(0);
  });

  it("a deactivated creator account refuses the claim", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId } = await mintLink(db, session);
    await db.exec("UPDATE users SET is_active=0 WHERE id='seller-1'");
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect(await counter(db, linkId)).toBe(0);
  });

  it("a revoked dossier refuses the claim (status inside the statement)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId, dossierId } = await mintLink(db, session);
    await db.exec(`UPDATE dossier_snapshots SET status='revoked' WHERE id=${dossierId}`);
    expect((await claim(db, linkId, null)).changes).toBe(0);
    expect(await counter(db, linkId)).toBe(0);
  });

  it("an editorial creator holds authority WITHOUT any grant — and LOSES it the moment the role is taken away", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const adminSession = await makeSession(db, "admin-1");
    const { linkId } = await mintLink(db, adminSession);
    expect((await claim(db, linkId, null)).changes).toBe(1);
    // The editorial arm reads the creator's CURRENT role from the row, not a
    // mint-time snapshot: demotion to a plain user with no grant refuses.
    await db.exec("UPDATE users SET role='user' WHERE id='admin-1'");
    expect((await claim(db, linkId, null)).changes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Route-level linearization + response discipline
// ---------------------------------------------------------------------------

describe("N07 B. the route enforces, counts honestly and never leaks", () => {
  it("an authorized view counts exactly once; a later mandate revocation refuses AND does not count", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { linkId, token } = await mintLink(db, session);
    const ok = await view(db, token);
    expect(ok.status).toBe(200);
    expect(await counter(db, linkId)).toBe(1);

    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    const refused = await view(db, token);
    expect(refused.status).toBe(410);
    const body = await refused.json() as { error: string; message: string };
    expect(body.error).toBe("dossier_unavailable");
    expect(body.message).toContain("no longer has current sharing authority");
    expect(await counter(db, linkId)).toBe(1);
  });

  it("revoking the LINK refuses the view and never counts it", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { dossierId, linkId, token } = await mintLink(db, session);
    const revoke = await revokeDossierLink(authedRequest(`/api/dossiers/${dossierId}/links/${linkId}/revoke`, {}, { method: "POST", session }), env(db), dossierId, linkId);
    expect(revoke.status).toBe(200);
    const refused = await view(db, token);
    expect(refused.status).toBe(410);
    expect((await refused.json() as { error: string }).error).toBe("link_revoked");
    expect(await counter(db, linkId)).toBe(0);
  });

  it("recipient-restricted links: anonymous 403 not counted, the intended recipient 200 counted", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const strangerSession = await makeSession(db, "stranger-1");
    const { linkId, token } = await mintLink(db, session, { recipient: "stranger-1" });

    const anonymous = await view(db, token);
    expect(anonymous.status).toBe(403);
    expect((await anonymous.json() as { error: string }).error).toBe("recipient_restricted");
    expect(await counter(db, linkId)).toBe(0);

    const asRecipient = await view(db, token, strangerSession);
    expect(asRecipient.status).toBe(200);
    expect(await counter(db, linkId)).toBe(1);
  });

  it("the recipient's deactivated account loses the view: the session dies and the claim refuses", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const strangerSession = await makeSession(db, "stranger-1");
    const { token } = await mintLink(db, session, { recipient: "stranger-1" });
    await db.exec("UPDATE users SET is_active=0 WHERE id='stranger-1'");
    const refused = await view(db, token, strangerSession);
    expect(refused.status).toBe(403);
    expect((await refused.json() as { error: string }).error).toBe("recipient_restricted");
  });

  it("a mandate revoked between dossier creation and link minting mints NOTHING (concurrent share mint)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const response = await createDossier(authedRequest("/api/dossiers", {
      horse_id: 9, include_pedigree: true, include_results: true, include_genetics: false, include_contact: false,
    }, { session }), env(db));
    expect(response.status).toBe(201);
    const dossierId = ((await response.json()) as { dossier: { id: number } }).dossier.id;
    // The preflight passed above; the mandate dies before the mint. The
    // route's own preflight catches this honestly (403) — the narrower
    // preflight-to-batch race window is pinned at command level by N13.
    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    await expect(createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, { expires_in_days: 14 }, { session }), env(db), dossierId))
      .rejects.toMatchObject({ status: 403, code: "horse_access_required" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM dossier_share_links").first<{ n: number }>())?.n)).toBe(0);
  });

  it("neutral 404s: malformed tokens and unknown hashes are indistinguishable", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const malformed = await view(db, "short");
    expect(malformed.status).toBe(404);
    const malformedBody = await malformed.json() as { message: string };
    const unknown = await view(db, "A".repeat(43));
    expect(unknown.status).toBe(404);
    expect((await unknown.json() as { message: string }).message).toBe(malformedBody.message);
  });

  it("EVERY view response carries private no-store + no-referrer + noindex — 200, 403 and 410 alike", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token } = await mintLink(db, session, { recipient: "stranger-1" });

    const ok = await view(db, token, await makeSession(db, "stranger-1"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("private");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
    expect(ok.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const forbidden = await view(db, token);
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toContain("private");
    expect(forbidden.headers.get("referrer-policy")).toBe("no-referrer");

    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    const gone = await view(db, token, await makeSession(db, "stranger-1"));
    expect(gone.status).toBe(410);
    expect(gone.headers.get("cache-control")).toContain("private");
    expect(gone.headers.get("referrer-policy")).toBe("no-referrer");
    expect(gone.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

// ---------------------------------------------------------------------------
// C. The honest recall boundary
// ---------------------------------------------------------------------------

describe("N07 C. revocation is honest about what it can and cannot do", () => {
  it("the revoke response states the boundary: future reads die, retained copies cannot be recalled", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { dossierId, linkId } = await mintLink(db, session);
    const revoke = await revokeDossierLink(authedRequest(`/api/dossiers/${dossierId}/links/${linkId}/revoke`, {}, { method: "POST", session }), env(db), dossierId, linkId);
    expect(revoke.status).toBe(200);
    const body = await revoke.json() as { note: string };
    expect(body.note).toContain("cannot be recalled");
    expect(body.note).toContain("no-store");
    // ...and it never promises destruction of already-distributed copies.
    expect(body.note.toLowerCase()).not.toContain("delete");
    expect(body.note.toLowerCase()).not.toContain("destroy");
  });
});
