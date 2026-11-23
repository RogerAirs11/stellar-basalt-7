import { describe, expect, it } from "vitest";
import {
  createDossier,
  createDossierLink,
  viewDossierByToken,
} from "../../src/api/modules/dossiers";
import { buildDossierSnapshot, DOSSIER_SNAPSHOT_SELECT_SQL } from "../../src/dossiers/snapshot";
import { createDossierStatements, createDossierLinkStatements } from "../../src/dossiers/commands";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N13 acceptance — dossier creation and sharing transactionally
 * consistent. Real SQLite with every migration applied; the command-level
 * cases bypass route preflight ON PURPOSE to prove the transaction is the
 * enforcement layer.
 *
 *  1. A mandate revoked between preflight and mint produces NO share token.
 *  2. A concurrent source update can never create a mixed-version dossier:
 *     the whole snapshot (identity + sections + source version marker) is
 *     ONE statement, so every engine sees one consistent snapshot.
 *  3. A malformed legacy dossier payload returns a controlled review
 *     response — never a 500, never stack data or private leakage.
 *  4. The issued digest binds the exact content; tampered bytes are refused.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function seedWorld(db: D1Database) {
  await seedUser(db, "seller-1", "user");
  await seedUser(db, "stranger-1", "user");
  await db.exec(`
    INSERT INTO horses(id,name_latin,name_native,sex_desc,birth_year,color_desc,breed_desc,is_active)
    VALUES (1,'SIRE','پدر','stallion',2010,'bay','Arabian',1),
           (2,'DAM','مادر','mare',2012,'grey','Arabian',1),
           (9,'STAR','ستاره','stallion',2018,'bay','Arabian',1);
    UPDATE horses SET father_id=1, mother_id=2 WHERE id=9;
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
    VALUES ('g1',9,'seller-1','owner','manage_profile,upload_media,create_listing,manage_inquiries','claim_approval','2026-01-01 00:00:00');
    INSERT INTO competitions(id,name_native,event_date,discipline,venue,season) VALUES (5,'تهران جام','2026-06-01','show_jumping','Tehran',2026);
    INSERT INTO competition_results(competition_id,horse_id,placement,provenance) VALUES (5,9,1,'federation');
  `);
}

describe("N13 mandate revoked between preflight and mint", () => {
  it("a late-revoked grant produces NO share token (transaction enforcement)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    // The route preflight PASSED at some earlier moment (grant g1 was live);
    // it is revoked before the batch runs — only the transaction can refuse.
    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    const [insert] = await db.batch(createDossierLinkStatements(db, {
      operationId: crypto.randomUUID(), actorUserId: "seller-1", actorRole: "user",
      dossierId: 1, tokenHash: "a".repeat(64), expiresAt: "2026-12-01T00:00:00.000Z", recipientUserId: null,
    }));
    expect(Number(insert?.meta.changes ?? 0)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM dossier_share_links").first<{ n: number }>())?.n)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='dossier.link_created'").first<{ n: number }>())?.n)).toBe(0);
  });

  it("a late-revoked grant produces NO snapshot either", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    await db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'");
    const [insert] = await db.batch(createDossierStatements(db, {
      operationId: crypto.randomUUID(), actorUserId: "seller-1", actorRole: "user",
      horseId: 9, version: 2, snapshotJson: "{}", sectionsMetaJson: "{}", issuedDigest: "d".repeat(64),
    }));
    expect(Number(insert?.meta.changes ?? 0)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM dossier_snapshots").first<{ n: number }>())?.n)).toBe(0);
  });

  it("a late-deleted horse prevents minting (no token)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    await db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=9");
    const [insert] = await db.batch(createDossierLinkStatements(db, {
      operationId: crypto.randomUUID(), actorUserId: "seller-1", actorRole: "user",
      dossierId: 1, tokenHash: "b".repeat(64), expiresAt: "2026-12-01T00:00:00.000Z", recipientUserId: null,
    }));
    expect(Number(insert?.meta.changes ?? 0)).toBe(0);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM dossier_share_links").first<{ n: number }>())?.n)).toBe(0);
  });

  it("a live grant DOES mint: the conditional is not a blanket refusal", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const [dossierInsert] = await db.batch(createDossierStatements(db, {
      operationId: crypto.randomUUID(), actorUserId: "seller-1", actorRole: "user",
      horseId: 9, version: 2, snapshotJson: "{\"horse_id\":9}", sectionsMetaJson: "{}", issuedDigest: "c".repeat(64),
    }));
    expect(Number(dossierInsert?.meta.changes ?? 0)).toBe(1);
    const [linkInsert] = await db.batch(createDossierLinkStatements(db, {
      operationId: crypto.randomUUID(), actorUserId: "seller-1", actorRole: "user",
      dossierId: 1, tokenHash: "e".repeat(64), expiresAt: "2026-12-01T00:00:00.000Z", recipientUserId: null,
    }));
    expect(Number(linkInsert?.meta.changes ?? 0)).toBe(1);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('dossier.created','dossier.link_created')").first<{ n: number }>())?.n)).toBe(2);
  });
});

describe("N13 concurrent source update cannot create a mixed-version dossier", () => {
  it("the snapshot is ONE statement: identity, sections and the source version marker come from a single engine snapshot", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    // Mechanism pin: the builder must issue EXACTLY ONE query. Multiple
    // awaited reads would tear on PostgreSQL READ COMMITTED (per-statement
    // snapshots); one statement is consistent on every provider.
    const prepared: string[] = [];
    const recordingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            prepared.push(sql);
            return (target as unknown as { prepare: (sql: string) => unknown }).prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as D1Database;
    const built = await buildDossierSnapshot(recordingDb, 9, {
      includePedigree: true, includeResults: true, includeGenetics: false, includeContact: true, creatorUserId: "seller-1",
    });
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toContain("FROM horses h WHERE h.id=? AND h.deleted_at IS NULL");
    // The assembled snapshot is internally consistent by construction: the
    // source marker and the identity/sections all derive from that one row.
    expect((built.snapshot.source as { schema_version: number }).schema_version).toBe(2);
    expect((built.snapshot.source as { horses_updated_at: string | null }).horses_updated_at).toEqual(expect.any(String));
    expect((built.snapshot.identity as { name_latin: string }).name_latin).toBe("STAR");
    expect(Array.isArray(built.snapshot.results)).toBe(true);
    expect((built.snapshot.results as unknown[]).length).toBe(1);
    expect((built.snapshot.contact as { display_name: string }).display_name).toBe("seller-1");
  });

  it("sections excluded by the seller are never read at all (not read-then-redacted)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    await db.exec(`INSERT INTO genetic_tests(horse_id,test_type,test_category,result,lab_name,verified,tested_at)
      VALUES (9,'panel','coat_color','Ee','Lab A',0,'2026-01-01')`);
    const prepared: string[] = [];
    const recordingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            prepared.push(sql);
            return (target as unknown as { prepare: (sql: string) => unknown }).prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as D1Database;
    const built = await buildDossierSnapshot(recordingDb, 9, {
      includePedigree: false, includeResults: false, includeGenetics: false, includeContact: false, creatorUserId: "seller-1",
    });
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).not.toContain("genetic_tests");
    expect(prepared[0]).not.toContain("competition_results");
    expect((built.snapshot.genetics as { not_shared: boolean }).not_shared).toBe(true);
  });

  it("each build reflects one point in time: a correction between two builds never mixes into either", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const before = await buildDossierSnapshot(db, 9, { includePedigree: true, includeResults: true, includeGenetics: false, includeContact: false, creatorUserId: "seller-1" });
    // A results-only correction lands BETWEEN the two builds.
    await db.exec("UPDATE competition_results SET placement=2 WHERE horse_id=9");
    const after = await buildDossierSnapshot(db, 9, { includePedigree: true, includeResults: true, includeGenetics: false, includeContact: false, creatorUserId: "seller-1" });
    const beforePlacement = ((before.snapshot.results as Array<{ placement: number }>)[0])?.placement;
    const afterPlacement = ((after.snapshot.results as Array<{ placement: number }>)[0])?.placement;
    // Each snapshot is internally uniform: before saw 1, after saw 2 —
    // neither contains a mixture of both source states.
    expect(beforePlacement).toBe(1);
    expect(afterPlacement).toBe(2);
    // The source marker tracks the HORSE row; a results-only correction
    // leaves it untouched (scope is documented)...
    expect(before.snapshot.source).toEqual(after.snapshot.source);
    // ...and a horse-row correction DOES move it (staleness signal).
    await db.exec("UPDATE horses SET name_latin='STAR II', updated_at='2027-01-01 00:00:00' WHERE id=9");
    const corrected = await buildDossierSnapshot(db, 9, { includePedigree: true, includeResults: true, includeGenetics: false, includeContact: false, creatorUserId: "seller-1" });
    expect(corrected.snapshot.source).not.toEqual(after.snapshot.source);
    expect((corrected.snapshot.identity as { name_latin: string }).name_latin).toBe("STAR II");
  });

  it("the single-statement SQL shape is exported and stable (parity extraction contract)", () => {
    expect(DOSSIER_SNAPSHOT_SELECT_SQL).toContain("{{pedigree}}");
    expect(DOSSIER_SNAPSHOT_SELECT_SQL).toContain("{{results}}");
    expect(DOSSIER_SNAPSHOT_SELECT_SQL).toContain("{{genetics}}");
    expect(DOSSIER_SNAPSHOT_SELECT_SQL).toContain("{{contact}}");
    expect(DOSSIER_SNAPSHOT_SELECT_SQL).toContain("h.updated_at AS source_updated_at");
  });
});

describe("N13 malformed legacy payloads + issued digest", () => {
  async function mintValid(db: D1Database, session: AuthedSession) {
    const response = await createDossier(authedRequest("/api/dossiers", {
      horse_id: 9, include_pedigree: true, include_results: true, include_genetics: false, include_contact: false,
    }, { session }), env(db));
    expect(response.status).toBe(201);
    const body = await response.json() as { dossier: { id: number; issued_digest: string } };
    const linkResponse = await createDossierLink(authedRequest(`/api/dossiers/${body.dossier.id}/links`, { expires_in_days: 14 }, { session }), env(db), body.dossier.id);
    expect(linkResponse.status).toBe(201);
    const linkBody = await linkResponse.json() as { share_url: string };
    return { dossierId: body.dossier.id, digest: body.dossier.issued_digest, token: linkBody.share_url.split("/").pop()! };
  }

  it("a malformed snapshot_json returns a controlled 410 — never a 500, never internals", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token } = await mintValid(db, session);
    await db.exec("UPDATE dossier_snapshots SET snapshot_json='{\"broken'");
    const response = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(response.status).toBe(410);
    const body = await response.json() as { error: string; message: string };
    expect(body.error).toBe("dossier_unavailable");
    expect(body.message).not.toMatch(/at \w+|TypeError|JSON\.parse|stack/i);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("a malformed sections_meta_json returns the same controlled 410", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token } = await mintValid(db, session);
    await db.exec("UPDATE dossier_snapshots SET sections_meta_json='not-json-at-all'");
    const response = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(response.status).toBe(410);
    expect((await response.json() as { error: string }).error).toBe("dossier_unavailable");
  });

  it("a structurally invalid payload (unknown schema version) is a controlled 410", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token, dossierId } = await mintValid(db, session);
    const row = await db.prepare("SELECT snapshot_json FROM dossier_snapshots WHERE id=?").bind(dossierId).first<{ snapshot_json: string }>();
    const snapshot = JSON.parse(row!.snapshot_json) as Record<string, unknown>;
    (snapshot.source as Record<string, unknown>).schema_version = 99;
    await db.prepare("UPDATE dossier_snapshots SET snapshot_json=? WHERE id=?").bind(JSON.stringify(snapshot), dossierId).run();
    const response = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(response.status).toBe(410);
  });

  it("the issued digest binds the exact content: tampered stored bytes are refused", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token, digest, dossierId } = await mintValid(db, session);
    expect(digest).toHaveLength(64);

    // Untampered view: digest_verified true, no tamper response.
    const okResponse = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(okResponse.status).toBe(200);
    const okBody = await okResponse.json() as { dossier: { digest_verified: boolean | null; issued_digest: string | null; digest_note: string } };
    expect(okBody.dossier.digest_verified).toBe(true);
    expect(okBody.dossier.issued_digest).toBe(digest);
    expect(okBody.dossier.digest_note).toContain("not");

    // Tamper: one character of the stored snapshot changes -> 410.
    await db.exec(`UPDATE dossier_snapshots SET snapshot_json=REPLACE(snapshot_json,'STAR','STARR') WHERE id=${dossierId}`);
    const tampered = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(tampered.status).toBe(410);
    expect((await tampered.json() as { message: string }).message).toContain("issued digest");
  });

  it("a legacy pre-digest dossier still views with digest_verified null (honest, never blocked)", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token, dossierId } = await mintValid(db, session);
    await db.exec(`UPDATE dossier_snapshots SET issued_digest=NULL WHERE id=${dossierId}`);
    const response = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(response.status).toBe(200);
    const body = await response.json() as { dossier: { digest_verified: boolean | null } };
    expect(body.dossier.digest_verified).toBeNull();
  });

  it("genetic publication withdrawal still blocks the older shared genetic content", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    await db.exec(`INSERT INTO genetic_tests(horse_id,test_type,test_category,result,lab_name,verified,tested_at)
      VALUES (9,'panel','coat_color','Ee','Lab A',1,'2026-01-01')`);
    const session = await makeSession(db, "seller-1");
    const response = await createDossier(authedRequest("/api/dossiers", {
      horse_id: 9, include_pedigree: true, include_results: true, include_genetics: true, include_contact: false,
    }, { session }), env(db));
    expect(response.status).toBe(201);
    const dossierId = ((await response.json()) as { dossier: { id: number } }).dossier.id;
    const linkResponse = await createDossierLink(authedRequest(`/api/dossiers/${dossierId}/links`, { expires_in_days: 14 }, { session }), env(db), dossierId);
    const token = ((await linkResponse.json()) as { share_url: string }).share_url.split("/").pop()!;

    const before = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(before.status).toBe(200);

    // Publication withdrawal: the test leaves the public projection.
    await db.exec("UPDATE genetic_tests SET verified=0 WHERE horse_id=9");
    const after = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
    expect(after.status).toBe(410);
    expect((await after.json() as { message: string }).message).toContain("Evidence sharing permissions");
  });

  it("access logging stays BOUNDED: only the counter and last-access timestamp change", async () => {
    const db = await openRealDatabase();
    await seedWorld(db);
    const session = await makeSession(db, "seller-1");
    const { token } = await mintValid(db, session);
    for (let index = 0; index < 3; index += 1) {
      const response = await viewDossierByToken(authedRequest(`/api/dossiers/view/${token}`, undefined, { method: "GET" }), env(db), token);
      expect(response.status).toBe(200);
    }
    const link = await db.prepare("SELECT access_count, last_accessed_at, revoked_at, token_hash FROM dossier_share_links WHERE token_hash=(SELECT token_hash FROM dossier_share_links LIMIT 1)").first<Record<string, unknown>>();
    expect(Number(link?.access_count)).toBe(3);
    expect(link?.last_accessed_at).toBeTruthy();
    // The bounded log keeps exactly the fields it started with — the full
    // column set is pinned so no viewer-identity column can be added quietly.
    const columns = (await db.prepare("SELECT name FROM pragma_table_info('dossier_share_links')").all<{ name: string }>()).results.map((row) => row.name);
    expect(new Set(columns)).toEqual(new Set([
      "id", "dossier_id", "token_hash", "expires_at", "recipient_user_id", "created_by_user_id",
      "created_at", "revoked_at", "revoked_by_user_id", "access_count", "last_accessed_at", "last_operation_id",
    ]));
  });
});
