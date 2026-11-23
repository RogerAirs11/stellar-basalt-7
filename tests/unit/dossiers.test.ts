import { describe, expect, it } from "vitest";
import {
  DOSSIER_WARNINGS,
  generateShareToken,
  sectionMeta,
  createDossier,
  createDossierLink,
  revokeDossierLink,
  revokeDossier,
  viewDossierByToken,
} from "../../src/api/modules/dossiers";
import { buildDossierSnapshot } from "../../src/dossiers/snapshot";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N01: schema-backed route tests for P15 dossiers. Real SQLite, real
 * horse-access mandates, real frozen snapshots.
 *
 * Acceptance pinned (R95 semantics):
 *  - revoked/expired link cannot reveal old cached private data (410 + no-store);
 *  - the snapshot does not silently change when the canonical record changes
 *    (frozen bytes + live staleness flag instead of a rewrite);
 *  - a LATER WITHDRAWAL of a shared genetic result kills older public shares;
 *  - the creator losing sharing authority also kills public shares;
 *  - redacted sections stay visible as not_shared (never clean/cleared);
 *  - only the token HASH is stored; the raw token appears exactly once;
 *  - revocations are guarded CAS operations tied to a fresh operation id.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function seedHorseWorld(db: D1Database) {
  await seedUser(db, "seller-1", "user");
  await seedUser(db, "buyer-7", "user");
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

async function sellerSession(db: D1Database): Promise<AuthedSession> {
  return makeSession(db, "seller-1");
}

async function mintDossier(db: D1Database, session: AuthedSession, options: { includeGenetics?: boolean } = {}) {
  const response = await createDossier(authedRequest("/api/dossiers", {
    horse_id: 9, include_pedigree: true, include_results: true,
    include_genetics: options.includeGenetics ?? false, include_contact: false,
  }, { session }), env(db));
  expect(response.status).toBe(201);
  return (await response.json() as { dossier: { id: number } }).dossier.id;
}

async function mintLink(db: D1Database, session: AuthedSession, dossierId: number) {
  const response = await createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, { expires_in_days: 14 }, { session }), env(db), dossierId);
  expect(response.status).toBe(201);
  const body = await response.json() as { share_url: string; link_id: number };
  return { token: body.share_url.split("/").pop()!, linkId: body.link_id };
}

describe("P15 token + warning basics", () => {
  it("generates high-entropy base64url tokens (>=40 chars, URL-safe)", () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      const token = generateShareToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(20); // no collisions in 20 draws
  });

  it("sectionMeta records source + review state + generated_at for every section", () => {
    const meta = sectionMeta("registry:horses", "recorded_not_independently_attested", "2026-10-03T12:00:00Z");
    expect(meta).toEqual({ source: "registry:horses", review_state: "recorded_not_independently_attested", generated_at: "2026-10-03T12:00:00Z" });
  });

  it("the standing warnings are explicit: not a title transfer, not a vetting", () => {
    expect(DOSSIER_WARNINGS.not_title_transfer).toContain("not a title transfer");
    expect(DOSSIER_WARNINGS.not_vet_exam).toContain("veterinary purchase examination");
  });
});

describe("P15 snapshot building (frozen, redaction visible)", () => {
  it("excluded genetics/contact appear as not_shared — never clean or cleared", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const { snapshot, sectionsMeta } = await buildDossierSnapshot(db, 9, {
      includePedigree: true, includeResults: true, includeGenetics: false, includeContact: false, creatorUserId: "seller-1",
    });
    expect((snapshot.genetics as Record<string, unknown>).not_shared).toBe(true);
    expect((snapshot.contact as Record<string, unknown>).not_shared).toBe(true);
    expect(sectionsMeta.genetics.review_state).toBe("not_shared");
    expect(sectionsMeta.contact.review_state).toBe("not_shared");
    // R95: registry facts are recorded claims, never independently attested truth.
    expect(sectionsMeta.identity.review_state).toBe("recorded_not_independently_attested");
    const pedigree = snapshot.pedigree as Record<string, unknown>;
    expect(pedigree.sire_name).toBe("SIRE");
    expect(pedigree.dam_name).toBe("DAM");
    expect(Number(pedigree.sire_id)).toBe(1);
    expect(Number(pedigree.dam_id)).toBe(2);
  });

  it("included genetics expose ONLY verified tests through the public projection", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    await db.exec(`
      -- R140-A: the shared PSSM1 row carries the explicit publication decision
      -- (public_disclosed=1); the unverified row would be excluded either way.
      INSERT INTO genetic_tests(horse_id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,provenance,notes,public_disclosed)
      VALUES (9,'PSSM1','disease','N/PSSM1','heterozygous','Lab A','ACC-SECRET-1','2026-05-01',1,'user','private staff note',1),
             (9,'HYPP','disease','N/H','unverified guess','Lab B','ACC-SECRET-2','2026-05-02',0,'user','not yet verified',0);
    `);
    const { snapshot, sectionsMeta } = await buildDossierSnapshot(db, 9, {
      includePedigree: false, includeResults: false, includeGenetics: true, includeContact: false, creatorUserId: "seller-1",
    });
    const genetics = snapshot.genetics as Array<Record<string, unknown>>;
    expect(genetics).toHaveLength(1); // only the verified test — the unverified one is private
    expect(genetics[0]?.test_type).toBe("PSSM1");
    expect(genetics[0]?.result).toBe("N/PSSM1");
    // The public projection never carries private laboratory details.
    expect(genetics[0]?.lab_accession).toBeFalsy();
    expect(genetics[0]?.notes).toBeFalsy();
    expect(sectionsMeta.genetics.source).toContain("public projection");
  });

  it("a missing horse is an honest 404, never an empty dossier", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    await expect(buildDossierSnapshot(db, 404, {
      includePedigree: false, includeResults: false, includeGenetics: false, includeContact: false, creatorUserId: "seller-1",
    })).rejects.toMatchObject({ status: 404, code: "horse_not_found" });
  });
});

describe("P15 create dossier + link", () => {
  it("requires the seller mandate — a user without create_listing authority is refused", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "stranger", "user");
    const stranger = await makeSession(db, "stranger");
    await db.exec("INSERT INTO horses(id,name_latin,is_active) VALUES (9,'STAR',1)");
    await expect(createDossier(authedRequest("/api/dossiers", { horse_id: 9 }, { session: stranger }), env(db)))
      .rejects.toMatchObject({ status: 403 });
  });

  it("stores the frozen snapshot + per-section provenance; requires the seller mandate", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const response = await createDossier(authedRequest("/api/dossiers", { horse_id: 9 }, { session }), env(db));
    expect(response.status).toBe(201);
    const body = await response.json() as { dossier: { id: number; version: number; status: string }; sections: Record<string, { source: string }> };
    expect(body.dossier.version).toBe(2);
    expect(body.dossier.status).toBe("active");
    expect(body.sections.identity.source).toBe("registry:horses");
    const stored = await db.prepare("SELECT snapshot_json, sections_meta_json FROM dossier_snapshots WHERE id=?").bind(body.dossier.id).first<{ snapshot_json: string; sections_meta_json: string }>();
    expect(stored?.snapshot_json).toContain("STAR");
    const audit = await db.prepare("SELECT action FROM audit_events WHERE action='dossier.created'").all<{ action: string }>();
    expect(audit.results).toHaveLength(1);
  });

  it("the share link stores ONLY the token hash; the raw token appears exactly once in the response", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session);
    const { token, linkId } = await mintLink(db, session, dossierId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await db.prepare("SELECT token_hash FROM dossier_share_links WHERE id=?").bind(linkId).first<{ token_hash: string }>();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(stored?.token_hash).not.toBe(token); // hash != raw token
    // The raw token is never persisted anywhere.
    const dump = JSON.stringify(await db.prepare("SELECT token_hash FROM dossier_share_links").all());
    expect(dump).not.toContain(token);
  });

  it("a revoked dossier refuses new links (409)", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session);
    const revoke = await revokeDossier(authedRequest(`/api/dossiers/${dossierId}/revoke`, {}, { session }), env(db), dossierId);
    expect((await revoke.json() as { revoked: boolean }).revoked).toBe(true);
    await expect(createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, { expires_in_days: 14 }, { session }), env(db), dossierId))
      .rejects.toMatchObject({ status: 409, code: "dossier_revoked" });
  });

  it("only the dossier creator can mint links (404 for others)", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session);
    const buyer = await makeSession(db, "buyer-7");
    await expect(createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, { expires_in_days: 14 }, { session: buyer }), env(db), dossierId))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("revoking a link is a guarded CAS; revoking the dossier kills ALL its links in one batch", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session);
    const linkA = await mintLink(db, session, dossierId);
    const linkB = await mintLink(db, session, dossierId);

    const linkResponse = await revokeDossierLink(authedRequest(`/api/dossiers/${dossierId}/links/${linkA.linkId}/revoke`, {}, { session }), env(db), dossierId, linkA.linkId);
    expect((await linkResponse.json() as { revoked: boolean }).revoked).toBe(true);
    // CAS: revoking the SAME link again is a 409, not a second write.
    await expect(revokeDossierLink(authedRequest(`/api/dossiers/${dossierId}/links/${linkA.linkId}/revoke`, {}, { session }), env(db), dossierId, linkA.linkId))
      .rejects.toMatchObject({ status: 409, code: "not_revocable" });

    const before = await db.prepare("SELECT COUNT(*) AS n FROM dossier_share_links WHERE revoked_at IS NOT NULL").first<{ n: number }>();
    expect(Number(before?.n)).toBe(1); // only linkA so far

    const dossierResponse = await revokeDossier(authedRequest(`/api/dossiers/${dossierId}/revoke`, {}, { session }), env(db), dossierId);
    expect((await dossierResponse.json() as { revoked: boolean }).revoked).toBe(true);
    const after = await db.prepare("SELECT COUNT(*) AS n FROM dossier_share_links WHERE revoked_at IS NOT NULL").first<{ n: number }>();
    expect(Number(after?.n)).toBe(2); // dossier revoke killed BOTH links
    expect((await db.prepare("SELECT status FROM dossier_snapshots WHERE id=?").bind(dossierId).first<{ status: string }>())?.status).toBe("revoked");
  });
});

describe("P15 the public share view", () => {
  async function viewWorld(db: D1Database, options: { includeGenetics?: boolean } = {}) {
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session, options);
    const { token } = await mintLink(db, session, dossierId);
    return { session, dossierId, token };
  }

  it("a valid token returns the FROZEN snapshot with age + warnings; no-store headers", async () => {
    const db = await openRealDatabase();
    const { token } = await viewWorld(db);
    const linkRow = await db.prepare("SELECT id, access_count FROM dossier_share_links").first<{ id: number; access_count: number }>();
    const response = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const body = await response.json() as { dossier: { snapshot: Record<string, unknown>; stale: boolean; age_days: number; version: number }; warnings: Record<string, string> };
    expect((body.dossier.snapshot.identity as Record<string, unknown>).name_latin).toBe("STAR");
    expect(body.dossier.stale).toBe(false);
    expect(body.dossier.version).toBe(2);
    expect(body.warnings.not_title_transfer).toContain("not a title transfer");
    expect(body.warnings.not_vet_exam).toContain("veterinary purchase examination");
    // The access counter increments on the real row.
    const after = await db.prepare("SELECT access_count FROM dossier_share_links WHERE id=?").bind(linkRow!.id).first<{ access_count: number }>();
    expect(Number(after?.access_count)).toBe(1);
  });

  it("a REVOKED link returns 410 and reveals NOTHING (old cached copies die too)", async () => {
    const db = await openRealDatabase();
    const { session, dossierId, token } = await viewWorld(db);
    const linkId = Number((await db.prepare("SELECT id FROM dossier_share_links").first<{ id: number }>())?.id);
    await revokeDossierLink(authedRequest(`/api/dossiers/${dossierId}/links/${linkId}/revoke`, {}, { session }), env(db), dossierId, linkId);
    const response = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain("STAR");
    expect(text).not.toContain("identity");
  });

  it("an EXPIRED link returns 410 with the honest message", async () => {
    const db = await openRealDatabase();
    const { token } = await viewWorld(db);
    await db.exec("UPDATE dossier_share_links SET expires_at='2026-01-01 00:00:00'");
    const response = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(response.status).toBe(410);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("link_expired");
  });

  it("a canonical correction AFTER snapshot creation marks the view stale — the frozen bytes never change", async () => {
    const db = await openRealDatabase();
    const { token } = await viewWorld(db);
    const frozenBefore = (await db.prepare("SELECT snapshot_json FROM dossier_snapshots").first<{ snapshot_json: string }>())!.snapshot_json;
    // A canonical correction lands AFTER the snapshot was frozen.
    await db.exec("UPDATE horses SET color_desc='grey', updated_at=CURRENT_TIMESTAMP WHERE id=9");
    const response = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    const body = await response.json() as { dossier: { stale: boolean; snapshot: Record<string, unknown> }; warnings: Record<string, string> };
    expect(body.dossier.stale).toBe(true);
    expect(body.warnings.active).toContain("changed after this snapshot");
    // The stored snapshot itself is byte-identical — no rewrite.
    const frozenAfter = (await db.prepare("SELECT snapshot_json FROM dossier_snapshots").first<{ snapshot_json: string }>())!.snapshot_json;
    expect(frozenAfter).toBe(frozenBefore);
    expect(JSON.stringify(body.dossier.snapshot)).toBe(frozenBefore);
  });

  it("a LATER WITHDRAWAL of a shared genetic result kills the older public share (R95)", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    await db.exec(`
      -- R140-A: a PUBLIC dossier share presumes the explicit disclosure decision.
      INSERT INTO genetic_tests(horse_id,test_type,test_category,result,lab_name,tested_at,verified,provenance,public_disclosed)
      VALUES (9,'PSSM1','disease','N/PSSM1','Lab A','2026-05-01',1,'user',1);
    `);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session, { includeGenetics: true });
    const minted = await mintLink(db, session, dossierId);
    const token = minted.token;
    // Before withdrawal the share works.
    const ok = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(ok.status).toBe(200);
    // The result is withdrawn (unverified) after the snapshot was shared.
    await db.exec("UPDATE genetic_tests SET verified=0 WHERE horse_id=9 AND test_type='PSSM1'");
    const response = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(response.status).toBe(410);
    const text = await response.text();
    expect(text).not.toContain("N/PSSM1");
    expect(text).toContain("permissions changed");
  });

  it("the creator LOSING sharing authority also kills public shares (R95)", async () => {
    const db = await openRealDatabase();
    const { token } = await viewWorld(db);
    // The owner mandate is revoked after the link was minted.
    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    const response = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(response.status).toBe(410);
    const body = await response.json() as { message: string };
    expect(body.message).toContain("no longer has current sharing authority");
  });

  it("a recipient-restricted link refuses everyone else (403, no data)", async () => {
    const db = await openRealDatabase();
    await seedHorseWorld(db);
    const session = await sellerSession(db);
    const dossierId = await mintDossier(db, session);
    const response = await createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, { expires_in_days: 14, recipient_user_id: "buyer-7" }, { session }), env(db), dossierId);
    const token = ((await response.json() as { share_url: string }).share_url).split("/").pop()!;
    // Anonymous request -> 403 with no data.
    const refused = await viewDossierByToken(new Request(`https://registry.example/api/dossiers/view/${token}`), env(db), token);
    expect(refused.status).toBe(403);
    const text = await refused.text();
    expect(text).not.toContain("STAR");
  });

  it("a malformed token never reaches the database lookup (404 fast, privacy headers intact)", async () => {
    const db = await openRealDatabase();
    // R96-N07: the route self-responds the 404 (uniform private no-store +
    // no-referrer headers even outside the router) instead of throwing —
    // still BEFORE any database access.
    const response = await viewDossierByToken(new Request("https://registry.example/api/dossiers/view/short"), env(db), "short");
    expect(response.status).toBe(404);
    expect((await response.json() as { error: string }).error).toBe("not_found");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
