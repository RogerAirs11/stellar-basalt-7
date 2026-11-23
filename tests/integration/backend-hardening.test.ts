import { describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";
import { professionalActionPredicate, authorizeProfessionalAction } from "../../src/access/professionalAccess";
import { recordPublicationDecision } from "../../src/privacy/publicationDecisions";
import { recordFieldClaims, adminSelectFieldClaim, adminRejectFieldClaim, adminRevertFieldClaimDecision } from "../../src/api/modules/fieldClaims";
import { adminPatchRegistryRule } from "../../src/api/modules/registryRules";
import { refreshHorseSearch } from "../../src/search/refresh";
import { searchHorses } from "../../src/search/service";
import { isSafeRegistrationPattern } from "../../src/registry/rulesEngine";
import { mediaFixture } from "../helpers/mediaFixtures";
import type { BreedingRecordRow, HorseBreedingsResponse } from "../../src/contracts/platform";

const pdfText = "%PDF-1.4\nFictional synthetic test evidence\n%%EOF";
const upload = (extra: Record<string, unknown> = {}) => ({ media_type: "document", role: "veterinary", file_name: "fictional.pdf", mime_type: "application/pdf", data_base64: btoa(pdfText), ...extra });
async function clinicalRow(db: D1Database, horseId: number, mediaId: string | null = null) {
  await db.prepare("INSERT INTO equine_clinical_events(id,horse_id,event_type,body_json,evidence_media_id,created_by_user_id,last_operation_id) VALUES(?,?,'examination','{}',?,'vet','fixture-operation')")
    .bind(crypto.randomUUID(), horseId, mediaId).run();
}
async function metadataRow(db: D1Database, horseId: number) {
  await db.exec(`INSERT OR IGNORE INTO registry_metadata_fields(field_key,value_type,visibility,last_operation_id,created_by_user_id) VALUES('fixture_field','text','staff','fixture-op','admin');
    INSERT OR IGNORE INTO registry_metadata_versions(field_key,version,definition_json,created_by_user_id,reason) VALUES('fixture_field',1,'{}','admin','Fictional definition');`);
  await db.prepare("INSERT INTO registry_metadata_values(horse_id,field_key,definition_version,version,value_json,source_ref,updated_by_user_id,last_operation_id) VALUES(?,'fixture_field',1,1,'\"private value\"','fixture','admin','fixture-value')").bind(horseId).run();
}
async function stage(db: D1Database, session: AuthedSession, rows: Record<string, unknown>[], allowed = 0) {
  const source = await db.prepare("INSERT INTO import_sources(name,issuer_namespace,scope_note,redistribution_allowed) VALUES(?,'synthetic-regression','Local synthetic fixture',?)").bind(crypto.randomUUID(), allowed).run();
  const response = await call(db, "/api/admin/imports/stage", { source_id: Number(source.meta.last_row_id), file_name: "fixture.json", mapping_version: "v1", rows }, session);
  expect(response.status).toBe(201);
  return (await response.json() as { batch: { id: number; source_id: number } }).batch;
}

const limiter = { limit: async () => ({ success: true }) };
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, method?: string) {
  return (worker as unknown as { fetch(req: Request, env: unknown): Promise<Response> }).fetch(authedRequest(path, body, { session, method }), {
    DB: db, APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", SESSION_COOKIE_NAME: "hr_session", ASSETS: { fetch: async () => new Response("unused") },
    PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter, EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  });
}
async function world(withGeneticAuthority = false) {
  const db = await openRealDatabase();
  for (const [id, role] of [["admin", "admin"], ["editor", "editor"], ["vet", "user"], ["member", "user"]]) await seedUser(db, id!, role!);
  await db.exec(`INSERT INTO horses(id,name_latin,birth_year,sex_desc) VALUES(7001,'Public Mare',2010,'Mare'),(7002,'Public Stallion',2008,'Stallion');
    INSERT INTO horses(id,name_latin,is_active) VALUES(7003,'Restricted Source Secret',0);
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,public_disclosed) VALUES(7101,7001,'SCID','disease','N/SCID',1,'user',0);`);
  if (withGeneticAuthority) await db.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
    VALUES('hardening-genetics',7001,'editor','veterinarian','genetic_publish,genetic_intake','SYNTHETIC-AUTHORITY','SYNTHETIC-ASSIGNMENT','admin_grant','admin','2020-01-01')`).run();
  const publicationSession = await makeSession(db,"editor");
  const actorSession = await db.prepare("SELECT id,token_hash FROM sessions WHERE user_id='editor' ORDER BY created_at DESC LIMIT 1").first<{id:string;token_hash:string}>();
  const publicationActor = {user:{id:"editor",role:"editor"},sessionId:actorSession!.id,sessionTokenHash:actorSession!.token_hash};
  return { db, publicationActor, admin: await makeSession(db, "admin"), editor: publicationSession, vet: await makeSession(db, "vet"), member: await makeSession(db, "member") };
}
function beforeBatch(db: D1Database, action: () => Promise<unknown>): D1Database {
  let done = false;
  return { ...db, async batch(statements: Parameters<D1Database["batch"]>[0]) {
    if (!done) { done = true; await action(); }
    return db.batch(statements);
  } } as D1Database;
}
const grant = (extra: Record<string, unknown> = {}) => ({ horse_id: 7001, grantee_user_id: "vet", professional_kind: "veterinarian", permissions: ["private_health_read"], authority_ref: "LICENSE-TEST", assignment_ref: "CASE-TEST", basis: "admin_grant", ...extra });
const publication = (actor: {user:{id:string;role:string};sessionId:string;sessionTokenHash:string}, expectedVersion: number, desired: "publish" | "withdraw" = "publish") => ({ testId: 7101, horseId: 7001, desired, basis: "owner_consent" as const, purpose: "Explicit breeding disclosure", evidenceRef: "CONSENT-TEST", reason: "Reviewed specific publication decision", actorUserId: "editor", actorSessionId: actor.sessionId, actor, expectedVersion });
const fieldReq = (session: AuthedSession) => authedRequest("/api/admin/field-claims", { reason: "Reviewed source evidence for this field" }, { session });
async function claim(db: D1Database, field: string, value: unknown) {
  const rows = await recordFieldClaims(db, 7001, [{ field_name: field, claimed_value: value, source_type: "owner_statement", source_ref: "REVIEW-TEST" }]);
  return rows[0]!.claim_id!;
}

describe("Professional grant containment on real database routes", () => {
  it("editors cannot mint or revoke professional authority; administrators can", async () => {
    const { db, admin, editor } = await world();
    expect((await call(db, "/api/admin/professional-grants", grant(), editor)).status).toBe(403);
    const created = await call(db, "/api/admin/professional-grants", grant(), admin);
    expect(created.status).toBe(201);
    const body = await created.json() as { grant: { id: string } };
    expect((await call(db, `/api/admin/professional-grants/${body.grant.id}/revoke`, { reason: "Assignment complete" }, editor)).status).toBe(403);
    expect((await authorizeProfessionalAction(db, "vet", 7001, "private_health_read")).ok).toBe(true);
  });
  it("refuses ambiguous grantees, incompatible professions, missing consent references and invalid windows", async () => {
    const { db, admin } = await world();
    await db.exec("INSERT INTO organizations(id,slug,name_latin,kind) VALUES(77,'test-lab','Test lab','service')");
    expect((await call(db, "/api/admin/professional-grants", grant({ grantee_organization_id: 77 }), admin)).status).toBe(400);
    expect((await call(db, "/api/admin/professional-grants", grant({ professional_kind: "farrier", permissions: ["official_attestation"] }), admin)).status).toBe(422);
    expect((await call(db, "/api/admin/professional-grants", grant({ basis: "owner_consent" }), admin)).status).toBe(422);
    expect((await call(db, "/api/admin/professional-grants", grant({ valid_from: "2026-99-99T12:00:00Z" }), admin)).status).toBe(400);
    expect((await call(db, "/api/admin/professional-grants", grant({ valid_until: "2001-01-01T00:00:00Z" }), admin)).status).toBe(422);
    expect(await countRows(db, "professional_access_grants")).toBe(0);
  });
  it("institution grants exclude ordinary members and stop on role changes or institution suspension", async () => {
    const { db, admin } = await world();
    await db.exec(`INSERT INTO organizations(id,slug,name_latin,kind) VALUES(77,'test-lab','Test lab','service');
      INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(77,'member','member'),(77,'vet','manager');`);
    expect((await call(db, "/api/admin/professional-grants", grant({ grantee_user_id: null, grantee_organization_id: 77, professional_kind: "laboratory", basis: "institution_assignment", basis_ref: "ACCREDITED-ASSIGNMENT" }), admin)).status).toBe(201);
    expect((await authorizeProfessionalAction(db, "member", 7001, "private_health_read")).ok).toBe(false);
    expect((await authorizeProfessionalAction(db, "vet", 7001, "private_health_read")).ok).toBe(true);
    const g = professionalActionPredicate({ viewerUserId: "vet", horseId: 7001, permission: "private_health_read" });
    expect(await db.prepare(`SELECT 1 AS ok WHERE ${g.sql}`).bind(...g.bindings).first()).not.toBeNull();
    await db.exec("UPDATE organization_memberships SET role='member' WHERE user_id='vet'");
    expect((await authorizeProfessionalAction(db, "vet", 7001, "private_health_read")).ok).toBe(false);
    await db.exec("UPDATE organization_memberships SET role='manager' WHERE user_id='vet'; UPDATE organizations SET status='suspended' WHERE id=77");
    expect(await db.prepare(`SELECT 1 AS ok WHERE ${g.sql}`).bind(...g.bindings).first()).toBeNull();
  });
  it("a grantee deactivated after preflight cannot receive a grant or creation audit", async () => {
    const { db, admin } = await world();
    const raced = beforeBatch(db, () => db.exec("UPDATE users SET is_active=0 WHERE id='vet'"));
    expect((await call(raced, "/api/admin/professional-grants", grant(), admin)).status).toBe(409);
    expect(await countRows(db, "professional_access_grants")).toBe(0);
    expect(await countRows(db, "audit_events", "action='professional.grant.create'")).toBe(0);
  });
});

describe("Publication decisions are versioned, evidenced and atomic", () => {
  it("requires expected version and publication purpose/evidence; create cannot pre-disclose", async () => {
    const { db, editor } = await world(true);
    const path = "/api/admin/genetic-tests/7101/disclosure";
    expect((await call(db, path, { public_disclosed: true, reason: "Unconditional stale update" }, editor)).status).toBe(400);
    expect((await call(db, path, { public_disclosed: true, expected_decision_version: 0, reason: "No purpose supplied" }, editor)).status).toBe(422);
    expect((await call(db, path, { public_disclosed: true, expected_decision_version: 0, basis: "owner_consent", purpose: "Breeding advice", reason: "No consent reference" }, editor)).status).toBe(422);
    expect((await call(db, "/api/horses/7001/genetics", { operation_id: crypto.randomUUID(), test_type: "CA", test_category: "disease", result: "N/N", public_disclosed: true }, editor)).status).toBe(400);
    expect(await countRows(db, "publication_decisions")).toBe(0);
  });
  it("two competing writers at one version produce one decision, one audit and a clean409", async () => {
    const { db, publicationActor } = await world(true);
    const results = await Promise.allSettled([recordPublicationDecision(db, publication(publicationActor,0)), recordPublicationDecision(db, publication(publicationActor,0))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "publication_decision_conflict" });
    expect(await countRows(db, "publication_decisions")).toBe(1);
    expect(await countRows(db, "audit_events", "action='genetic.disclosure.updated'")).toBe(1);
  });
  it("an apparent replay cannot report success after a newer withdrawal wins", async () => {
    const { db, publicationActor } = await world(true);
    await recordPublicationDecision(db, publication(publicationActor,0));
    const raced = beforeBatch(db, () => recordPublicationDecision(db, publication(publicationActor,1, "withdraw")));
    await expect(recordPublicationDecision(raced, publication(publicationActor,1))).rejects.toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT public_disclosed FROM genetic_tests WHERE id=7101").first("public_disclosed")).toBe(0);
    expect(await countRows(db, "publication_decisions")).toBe(2);
  });
  it("audit insertion failure rolls back both the decision and materialized permission", async () => {
    const { db, publicationActor } = await world(true);
    await db.exec("CREATE TRIGGER refuse_disclosure_audit BEFORE INSERT ON audit_events WHEN NEW.action='genetic.disclosure.updated' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;");
    await expect(recordPublicationDecision(db, publication(publicationActor,0))).rejects.toThrow("forced audit failure");
    expect(await countRows(db, "publication_decisions")).toBe(0);
    expect(await db.prepare("SELECT public_disclosed FROM genetic_tests WHERE id=7101").first("public_disclosed")).toBe(0);
  });
});

describe("Field decisions have one acceptance boundary", () => {
  it("active blocker rules apply to field-claim selections", async () => {
    const { db, editor } = await world();
    const id = await claim(db, "name_latin", "Proposed Mare");
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES('evidence.must','required_evidence','Evidence required','blocker','{}','{"require_photo":true}','active',1)`);
    await expect(adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id)).rejects.toMatchObject({ status: 422, code: "registry_rule_violation" });
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=7001").first("name_latin")).toBe("Public Mare");
    expect(await countRows(db, "field_claim_decisions")).toBe(0);
  });
  it("decision insertion failure rolls back canonical data and claim status", async () => {
    const { db, editor } = await world();
    const id = await claim(db, "name_latin", "Proposed Mare");
    await db.exec("CREATE TRIGGER refuse_claim_decision BEFORE INSERT ON field_claim_decisions BEGIN SELECT RAISE(ABORT,'forced decision failure'); END;");
    await expect(adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id)).rejects.toThrow("forced decision failure");
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=7001").first("name_latin")).toBe("Public Mare");
    expect(await db.prepare("SELECT review_status FROM field_claims WHERE id=?").bind(id).first("review_status")).toBe("pending");
    expect(await countRows(db, "field_claim_decisions")).toBe(0);
  });
  it("a rejection that wins before select prevents every losing select side effect", async () => {
    const { db, editor } = await world();
    const id = await claim(db, "name_latin", "Proposed Mare");
    const raced = beforeBatch(db, () => adminRejectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id));
    await expect(adminSelectFieldClaim(fieldReq(editor), { DB: raced, SESSION_COOKIE_NAME: "hr_session" }, 7001, id)).rejects.toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=7001").first("name_latin")).toBe("Public Mare");
    expect(await db.prepare("SELECT review_status FROM field_claims WHERE id=?").bind(id).first("review_status")).toBe("rejected");
    expect(await countRows(db, "field_claim_decisions")).toBe(1);
  });
  it("reversal refuses to overwrite any newer accepted edit", async () => {
    const { db, editor } = await world();
    const id = await claim(db, "name_latin", "Proposed Mare");
    await adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id);
    const decision = await db.prepare("SELECT id FROM field_claim_decisions WHERE claim_id=?").bind(id).first<{ id: number }>();
    await db.exec("UPDATE horses SET name_latin='Later Accepted Name',row_version=row_version+1,last_mutation_id='later-edit' WHERE id=7001");
    await expect(adminRevertFieldClaimDecision(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, decision!.id)).rejects.toMatchObject({ status: 409, code: "field_claim_revert_conflict" });
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=7001").first("name_latin")).toBe("Later Accepted Name");
    expect(await countRows(db, "field_claim_decisions")).toBe(1);
  });
  it("date reversal preserves the original calendar, precision and legacy birth-year bucket", async () => {
    const { db, editor } = await world();
    await db.exec("UPDATE horses SET birth_date_value='1390-03',birth_date_precision='month',birth_date_calendar='solar_hijri',birth_year=2011 WHERE id=7001");
    const id = await claim(db, "birth_date", "2014");
    await adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id);
    const decision = await db.prepare("SELECT id FROM field_claim_decisions WHERE claim_id=?").bind(id).first<{ id: number }>();
    await adminRevertFieldClaimDecision(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, decision!.id);
    expect(await db.prepare("SELECT birth_date_value,birth_date_precision,birth_date_calendar,birth_year FROM horses WHERE id=7001").first()).toMatchObject({ birth_date_value: "1390-03", birth_date_precision: "month", birth_date_calendar: "solar_hijri", birth_year: 2011 });
  });
  it("concurrent intake retains exactly one pending copy of the same source assertion", async () => {
    const { db } = await world();
    await Promise.all([claim(db, "birth_year", 2009), claim(db, "birth_year", 2009)]);
    expect(await countRows(db, "field_claims")).toBe(1);
  });
});

describe("Public views do not expose private presence", () => {
  it("restricted horses are absent from profile, lifecycle, ownership, genetics, breedings, summary, list and search", async () => {
    const { db } = await world();
    await refreshHorseSearch(db, 7003);
    for (const suffix of ["", "/lifecycle", "/ownership", "/genetics", "/breedings", "/evidence-summary", "/media"]) {
      expect((await call(db, `/api/horses/7003${suffix}`)).status, suffix).toBe(404);
    }
    const list = await (await call(db, "/api/horses")).json() as { rows: Array<{ id: number }>; total: number };
    expect(list.rows.map(r => r.id)).not.toContain(7003);
    expect(list.total).toBe(2);
    expect(await searchHorses(db, "id:7003")).toEqual([]);
  });
  it("an old edge cache entry cannot bypass a new visibility restriction", async () => {
    const { db } = await world();
    const match = vi.fn(async () => new Response(JSON.stringify({ secret: "OLD-CACHE" }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("caches", { default: { match } });
    try {
      expect((await call(db, "/api/horses/7003")).status).toBe(404);
      for (const path of ["/api/horses/7003/genetics", "/api/horses", "/api/search?q=Restricted", "/api/registry/facets", "/api/analytics/registry", "/api/directory/persons", "/api/platform/meta", "/api/competitions"]) {
        const response = await call(db, path);
        expect(response.status, path).toBeLessThan(500);
        expect(response.headers.get("cache-control"), path).toContain("no-store");
        expect(await response.text(), path).not.toContain("OLD-CACHE");
      }
      expect(match).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("search syntax metadata is literal-only and its static cache excludes authenticated requests", async () => {
    const { db, admin } = await world();
    const before = await call(db, "/api/search/meta");
    expect(before.status).toBe(200);
    expect(before.headers.get("cache-control")).toBe("private, no-store");
    const syntax = await before.json();
    await db.exec("UPDATE horses SET name_latin='Changed Secret',is_active=0");
    expect(await (await call(db, "/api/search/meta")).json()).toEqual(syntax);
    const match = vi.fn(async () => new Response(JSON.stringify(syntax), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("caches", { default: { match } });
    try {
      const cached = await call(db, "/api/search/meta");
      expect(cached.headers.get("cache-control")).toBe("private, max-age=120");
      expect(await cached.json()).toEqual(syntax);
      expect(match).toHaveBeenCalledTimes(1);
      match.mockClear();
      const authenticated = await call(db, "/api/search/meta", undefined, admin);
      expect(authenticated.headers.get("cache-control")).toBe("private, no-store");
      expect(await authenticated.json()).toEqual(syntax);
      expect(match).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("summary counts honor verification and the same target visibility as public attestations", async () => {
    const { db } = await world();
    await db.exec(`INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,public_disclosed) VALUES
      (7102,7001,'CA','disease','N/N',0,'user',1),(7103,7001,'extension_MC1R','coat_color','E/e',1,'user',0);
      INSERT INTO issuers(id,slug,name,kind) VALUES('issuer','test-issuer','Test Issuer','federation');
      INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,status,attested_by_user_id) VALUES
      ('private-attestation','issuer',7001,'genetic_test','7101','active','admin'),('public-attestation','issuer',7001,'horse_identity','7001','active','admin');`);
    const summary = await (await call(db, "/api/horses/7001/evidence-summary")).json() as { attestations: Record<string, number>; genetics_published: Record<string, number> };
    expect(Object.values(summary.attestations).reduce((a, b) => a + b, 0)).toBe(1);
    expect(summary.genetics_published).toEqual({ coat_color: 1 });
  });
  it("private parent identity is not projected in a public child's profile or search result", async () => {
    const { db } = await world();
    await db.exec("UPDATE horses SET father_id=7003 WHERE id=7001");
    await refreshHorseSearch(db, 7001);
    const profile = await (await call(db, "/api/horses/7001")).json() as { horse: { father_id: number | null; father_name: string | null } };
    expect(profile.horse.father_id).toBeNull();
    expect(profile.horse.father_name).toBeNull();
    expect(await searchHorses(db, "father:Restricted")).toEqual([]);
  });
});

describe("Legacy breeding views retain only public linked identities", () => {
  async function breedingWorld() {
    const context = await world();
    await context.db.exec(`
      UPDATE horses SET name_native='Public Mare Native' WHERE id=7001;
      UPDATE horses SET name_native='Public Stallion Native' WHERE id=7002;
      INSERT INTO horses(id,name_latin,name_native) VALUES(7004,'Public Foal','Public Foal Native');
      INSERT INTO breeding_records(id,sire_id,dam_id,foal_id,season,outcome,notes,provenance)
      VALUES(7201,7002,7001,7004,1405,'foaled','Private covering notes','user');
    `);
    return context;
  }

  it("withheld and archived subjects return404 to anonymous and legacy staff viewers", async () => {
    const { db, editor } = await breedingWorld();
    for (const [active, archivedAt] of [[0, null], [1, "2026-01-01 00:00:00"]] as const) {
      await db.prepare("UPDATE horses SET is_active=?,deleted_at=? WHERE id IN (7001,7002,7004)").bind(active, archivedAt).run();
      for (const id of [7001, 7002, 7004]) {
        for (const session of [undefined, editor]) {
          const response = await call(db, `/api/horses/${id}/breedings`, undefined, session);
          expect(response.status).toBe(404);
          expect(response.headers.get("cache-control")).toContain("no-store");
          expect(await response.text()).not.toContain("Private covering notes");
        }
      }
    }
  });

  const views = [
    { subjectId: 7002, view: "as_sire", links: [
      { id: 7001, idKey: "dam_id", nameKey: "dam_name", nativeKey: "dam_name_native", name: "Public Mare" },
      { id: 7004, idKey: "foal_id", nameKey: "foal_name", nativeKey: null, name: "Public Foal" },
    ] },
    { subjectId: 7001, view: "as_dam", links: [
      { id: 7002, idKey: "sire_id", nameKey: "sire_name", nativeKey: "sire_name_native", name: "Public Stallion" },
      { id: 7004, idKey: "foal_id", nameKey: "foal_name", nativeKey: null, name: "Public Foal" },
    ] },
    { subjectId: 7004, view: "birth_record", links: [
      { id: 7002, idKey: "sire_id", nameKey: "sire_name", nativeKey: "sire_name_native", name: "Public Stallion" },
      { id: 7001, idKey: "dam_id", nameKey: "dam_name", nativeKey: "dam_name_native", name: "Public Mare" },
    ] },
  ] as const;

  it.each(views)("$view masks withheld/archived links without changing stored pointers or note permissions", async ({ subjectId, view, links }) => {
    const { db, editor, member } = await breedingWorld();
    const read = async (session?: AuthedSession) => {
      const response = await call(db, `/api/horses/${subjectId}/breedings`, undefined, session);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = await response.json() as HorseBreedingsResponse;
      expect(body.horse.id).toBe(subjectId);
      const row = (view === "birth_record" ? body.birth_record : body[view][0]) as BreedingRecordRow & { notes?: string | null };
      expect(row.id).toBe(7201);
      expect(row.outcome).toBe("foaled");
      return row;
    };
    const visible = await read();
    for (const link of links) {
      expect(visible[link.idKey]).toBe(link.id);
      expect(visible[link.nameKey]).toBe(link.name);
      if (link.nativeKey) expect(visible[link.nativeKey]).toBe(`${link.name} Native`);
    }
    expect(visible.notes).toBeNull();
    expect((await read(member)).notes).toBeNull();
    if (view !== "birth_record") expect((await read(editor)).notes).toBeNull(); // R148: editing a registry does not grant private notes.

    for (const [active, archivedAt] of [[0, null], [1, "2026-01-01 00:00:00"]] as const) {
      await db.prepare("UPDATE horses SET is_active=?,deleted_at=? WHERE id IN (?,?)").bind(active, archivedAt, links[0].id, links[1].id).run();
      for (const session of [undefined, member, editor]) {
        const projected = await read(session);
        for (const link of links) {
          expect(projected[link.idKey]).toBeNull();
          expect(projected[link.nameKey]).toBeNull();
          if (link.nativeKey) expect(projected[link.nativeKey]).toBeNull();
          expect(JSON.stringify(projected)).not.toContain(link.name);
        }
        if (session !== editor) expect(projected.notes).toBeNull();
        else if (view !== "birth_record") expect(projected.notes).toBeNull(); // No scoped health grants for either parent.
      }
    }
    expect(await db.prepare("SELECT sire_id,dam_id,foal_id,notes FROM breeding_records WHERE id=7201").first())
      .toEqual({ sire_id: 7002, dam_id: 7001, foal_id: 7004, notes: "Private covering notes" });
  });
});

describe("Transactional event acceptance and bounded rules", () => {
  it("a competing lifecycle write cannot commit a second contradictory event", async () => {
    const { db, editor } = await world();
    const body = { event_type: "death", date: { value: "2020", precision: "year", calendar: "gregorian" } };
    const raced = beforeBatch(db, () => db.exec("UPDATE horses SET row_version=row_version+1 WHERE id=7001"));
    expect((await call(raced, "/api/admin/horses/7001/lifecycle-events", body, editor)).status).toBe(409);
    expect(await countRows(db, "horse_lifecycle_events")).toBe(0);
    expect(await db.prepare("SELECT is_dead FROM horses WHERE id=7001").first("is_dead")).toBe(0);
    expect((await call(db, "/api/admin/horses/7001/lifecycle-events", body, editor)).status).toBe(201);
    expect(await countRows(db, "horse_lifecycle_events")).toBe(1);
    expect(await db.prepare("SELECT is_dead,life_status FROM horses WHERE id=7001").first()).toMatchObject({ is_dead: 1, life_status: "dead" });
  });
  it("two overlapping ownership proposals cannot both be accepted", async () => {
    const { db, editor } = await world();
    await db.exec("INSERT INTO people(id,name_latin) VALUES(7001,'Owner One')");
    const body = { owner_person_id: 7001, start: { value: "2020-01-01", precision: "day", calendar: "gregorian" } };
    let winner: Response | undefined;
    const raced = beforeBatch(db, async () => { winner = await call(db, "/api/admin/horses/7001/ownership-periods", body, editor); });
    expect((await call(raced, "/api/admin/horses/7001/ownership-periods", body, editor)).status).toBe(409);
    expect(winner!.status).toBe(201);
    expect(await countRows(db, "horse_ownership_periods")).toBe(1);
    const receipt = await winner!.json() as { period: { id: number } };
    expect(receipt.period.id).toBe(await db.prepare("SELECT id FROM horse_ownership_periods").first("id"));
  });
  it("a losing rule edit returns409 and does not append the loser's version history", async () => {
    const { db, admin } = await world();
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES('test.rules','required_evidence','Original rule','warning','{}','{}','draft',1);
      INSERT INTO registry_rule_versions(rule_id,version,state,title,severity,applicability_json,spec_json,changed_by) VALUES('test.rules',1,'draft','Original rule','warning','{}','{}','admin')`);
    const make = (title: string) => authedRequest("/api/admin/registry-rules/test.rules", { expected_version: 1, title }, { session: admin, method: "PATCH" });
    const raced = beforeBatch(db, () => adminPatchRegistryRule(make("Winner rule"), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, "test.rules"));
    await expect(adminPatchRegistryRule(make("Losing rule"), { DB: raced, SESSION_COOKIE_NAME: "hr_session" }, "test.rules")).rejects.toMatchObject({ status: 409, code: "rule_version_conflict" });
    expect(await countRows(db, "registry_rule_versions")).toBe(2);
    expect(await db.prepare("SELECT title FROM registry_rules WHERE id='test.rules'").first("title")).toBe("Winner rule");
  });
  it("numbering patterns cannot introduce catastrophic backtracking", () => {
    expect(isSafeRegistrationPattern("^IR[0-9]{4,8}$")).toBe(true);
    expect(isSafeRegistrationPattern("^(a+)+$ ".trim())).toBe(false);
    expect(isSafeRegistrationPattern("^a*a*a*a*a*a*Z$")).toBe(false);
    expect(isSafeRegistrationPattern("^(a|aa)+$ ".trim())).toBe(false);
    expect(isSafeRegistrationPattern("[0-9]+")).toBe(false);
  });
});

describe("Private veterinary upload and retained evidence", () => {
  it("permits only the scoped private document and returns the digest of stored bytes", async () => {
    const { db, admin, vet } = await world();
    expect((await call(db, "/api/admin/professional-grants", grant({ permissions: ["sample_submit"] }), admin)).status).toBe(201);
    expect((await call(db, "/api/horses/7001/media", upload({ role: "passport" }), vet)).status).toBe(403);
    const original = mediaFixture("metadata.png");
    const response = await call(db, "/api/horses/7001/media", upload({ file_name: "fictional.png", mime_type: "image/png", data_base64: Buffer.from(original).toString("base64") }), vet);
    expect(response.status).toBe(201);
    const { media } = await response.json() as { media: { id: string; sha256: string } };
    const bytes = (await db.prepare("SELECT data FROM horse_media_blobs WHERE media_id=?").bind(media.id).first<{ data: Uint8Array }>())!.data;
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(n => n.toString(16).padStart(2, "0")).join("");
    expect(media.sha256).toBe(digest);
    const originalDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(original)))].map(n => n.toString(16).padStart(2, "0")).join("");
    expect(media.sha256).not.toBe(originalDigest);
    expect(await db.prepare("SELECT consent_state,verification FROM horse_media WHERE id=?").bind(media.id).first()).toEqual({ consent_state: "private", verification: "pending" });
    expect((await (await call(db, "/api/horses/7001/media")).json() as { media: unknown[] }).media).toHaveLength(0);
  });
  it("a grant revoked after upload preflight leaves neither metadata nor bytes", async () => {
    const { db, admin, vet } = await world();
    await call(db, "/api/admin/professional-grants", grant({ permissions: ["clinical_write"] }), admin);
    const raced = beforeBatch(db, () => db.exec("UPDATE professional_access_grants SET revoked_at=CURRENT_TIMESTAMP"));
    expect((await call(raced, "/api/horses/7001/media", upload(), vet)).status).toBe(409); // The session remains live; the scoped grant changed at the business boundary.
    expect(await countRows(db, "horse_media")).toBe(0);
    expect(await countRows(db, "horse_media_blobs")).toBe(0);
  });
  it("deletion of attached care evidence refuses cleanly and retains bytes", async () => {
    const { db, editor } = await world();
    const response = await call(db, "/api/horses/7001/media", upload(), editor);
    const { media } = await response.json() as { media: { id: string } };
    await clinicalRow(db, 7001, media.id);
    const denied = await call(db, `/api/media/${media.id}`, undefined, editor, "DELETE");
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "retained_evidence" } });
    expect(await countRows(db, "horse_media_blobs")).toBe(1);
    expect(await countRows(db, "horse_media")).toBe(1);
  });
});

describe("Restricted import and policy boundaries", () => {
  it("restricted source data never fills an existing public horse", async () => {
    const { db, editor } = await world();
    await db.exec("UPDATE horses SET microchip_no='0007001',birth_year=NULL WHERE id=7001; INSERT INTO horse_identifiers(horse_id,kind,issuer_namespace,normalized_value,raw_value,status) VALUES(7001,'microchip_no','microchip','0007001','0007001','live')");
    const batch = await stage(db, editor, [{ external_id: "external-one", microchip_no: "0007001", name_latin: "Public Mare", birth_year: 2012 }]);
    expect(await db.prepare("SELECT row_action FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first("row_action")).toBe("update");
    const response = await call(db, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor);
    expect(response.status).toBe(200);
    expect(await db.prepare("SELECT birth_year FROM horses WHERE id=7001").first("birth_year")).toBeNull();
    expect(await db.prepare("SELECT outcome,outcome_detail FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first()).toMatchObject({ outcome: "conflict", outcome_detail: expect.stringContaining("restricted_source_public_update") });
    expect(await countRows(db, "audit_events", "action='import.horse.updated'")).toBe(0);
  });
  it("withdrawal before creation rejects stale policy, then a fresh retry creates private without raising the public counter", async () => {
    const { db, editor } = await world();
    const batch = await stage(db, editor, [{ external_id: "new-one", name_latin: "Restricted New", register_no: "R7004" }], 1);
    const prior = await db.prepare("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").first("active_horse_count");
    const raced = beforeBatch(db, () => db.exec("UPDATE import_sources SET redistribution_allowed=0"));
    const stale = await call(raced, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "registry_policy_context_changed" } });
    expect(await countRows(db, "horses", "register_no='R7004'")).toBe(0);
    expect(await db.prepare("SELECT outcome FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first("outcome")).toBe("pending");
    expect(await countRows(db, "audit_events", "action='import.horse.created'")).toBe(0);
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor)).status).toBe(200);
    expect(await db.prepare("SELECT is_active FROM horses WHERE register_no='R7004'").first("is_active")).toBe(0);
    expect(await db.prepare("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").first("active_horse_count")).toBe(prior);
    const audit = await db.prepare("SELECT after_json FROM audit_events WHERE action='import.horse.created'").first<string>("after_json");
    expect(JSON.parse(audit!)).toMatchObject({ published: false });
  });
  it("selecting an imported field cannot bypass its redistribution agreement", async () => {
    const { db, editor } = await world();
    await db.exec("UPDATE horses SET microchip_no='0007001' WHERE id=7001; INSERT INTO horse_identifiers(horse_id,kind,issuer_namespace,normalized_value,raw_value,status) VALUES(7001,'microchip_no','microchip','0007001','0007001','live')");
    const batch = await stage(db, editor, [{ external_id: "claim-one", microchip_no: "0007001", name_latin: "Public Mare", birth_year: 2012 }]);
    const row = await db.prepare("SELECT id FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first<{ id: number }>();
    const retained = await recordFieldClaims(db, 7001, [{ field_name: "birth_year", claimed_value: 2012, source_type: "import", source_ref: `batch:${batch.id}:row:${row!.id}` }]);
    await expect(adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, retained[0]!.claim_id!)).rejects.toMatchObject({ status: 422, code: "import_publication_authority_required" });
    expect(await countRows(db, "field_claim_decisions")).toBe(0);
    expect(await db.prepare("SELECT birth_year FROM horses WHERE id=7001").first("birth_year")).toBe(2010);
  });
  it("an import blocked by an active rule records a conflict without a binding failure", async () => {
    const { db, editor } = await world();
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES('required.name','required_evidence','Require photograph','blocker','{}','{"require_photo":true}','active',1)`);
    const batch = await stage(db, editor, [{ external_id: "blocked-one", name_latin: "Blocked New", register_no: "BLOCKED7004" }], 1);
    expect((await call(db, `/api/admin/imports/batches/${batch.id}/apply`, {}, editor)).status).toBe(200);
    expect(await countRows(db, "horses", "register_no='BLOCKED7004'")).toBe(0);
    expect(await db.prepare("SELECT outcome_detail FROM import_staging_rows WHERE batch_id=?").bind(batch.id).first<string>("outcome_detail")).toContain("blocked_by_registry_rule");
  });
});

describe("Protected identity operations", () => {
  it("archive refuses retained care and supplementary values", async () => {
    const { db, admin } = await world();
    await clinicalRow(db, 7001);
    await metadataRow(db, 7002);
    for (const id of [7001, 7002]) {
      expect((await call(db, `/api/horses/${id}`, undefined, admin, "DELETE")).status).toBe(409);
      expect(await db.prepare("SELECT deleted_at FROM horses WHERE id=?").bind(id).first("deleted_at")).toBeNull();
    }
  });
  it("care added after archive preflight prevents every archive side effect", async () => {
    const { db, admin } = await world();
    const raced = beforeBatch(db, () => clinicalRow(db, 7001));
    expect((await call(raced, "/api/horses/7001", undefined, admin, "DELETE")).status).toBe(409);
    expect(await db.prepare("SELECT deleted_at,row_version FROM horses WHERE id=7001").first()).toMatchObject({ deleted_at: null, row_version: 1 });
    expect(await countRows(db, "audit_events", "action='horse.archive'")).toBe(0);
  });
  it("a medical record added after merge preflight rolls back the complete merge", async () => {
    const { db, editor } = await world();
    const preview = await (await call(db, "/api/admin/horses/7001/merge-preview?merge_horse_id=7002", undefined, editor)).json() as { manifest_digest: string };
    const raced = beforeBatch(db, () => clinicalRow(db, 7002));
    const response = await call(raced, "/api/admin/horses/7001/merge", { merge_horse_id: 7002, reason: "Reviewed fictional identity duplicate", operation_id: crypto.randomUUID(), expected_manifest_digest: preview.manifest_digest }, editor);
    expect(response.status).toBe(409);
    expect(await db.prepare("SELECT deleted_at FROM horses WHERE id=7002").first("deleted_at")).toBeNull();
    expect(await countRows(db, "horse_redirect_aliases")).toBe(0);
    expect(await countRows(db, "horse_merges")).toBe(0);
  });
});

describe("Public search and counts use current evidence visibility", () => {
  it("stale indexes cannot reveal a private parent or a private full identifier", async () => {
    const { db } = await world();
    await db.exec("UPDATE horses SET is_active=1 WHERE id=7003; UPDATE horses SET father_id=7003,uel_no='PRIVATE-UEL-7001' WHERE id=7001");
    await refreshHorseSearch(db, 7001);
    await db.exec("UPDATE horse_search_source SET all_text=all_text || ' private uel 7001' WHERE horse_id=7001; UPDATE horses SET is_active=0 WHERE id=7003");
    for (const filter of ["father:Restricted", "Restricted", "PRIVATE-UEL-7001"]) {
      const response = await call(db, `/api/horses?filter=${encodeURIComponent(filter)}`);
      expect(response.status).toBe(200);
      expect((await response.json() as { total: number }).total, filter).toBe(0);
    }
    expect(await searchHorses(db, "father:Restricted")).toEqual([]);
  });
  it("private documents and private parents cannot affect public presence filters", async () => {
    const { db } = await world();
    await db.exec("UPDATE horses SET father_id=7003 WHERE id=7001; INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,verification,consent_state) VALUES('private-document',7001,'document','veterinary','private.pdf','application/pdf',12,'federation_verified','private')");
    for (const filter of ["hasVerifiedDoc=1", "hasSire=1", "parentageKnown=1"]) {
      const response = await call(db, `/api/horses?${filter}`);
      expect((await response.json() as { total: number }).total, filter).toBe(0);
    }
  });
  it("filters breeders before pagination and reports an exact final page", async () => {
    const {db}=await world();
    await db.exec("INSERT INTO people(id,name_latin) VALUES(7901,'Tie'),(7902,'Tie'),(7903,'Other'),(7904,'Restricted'); INSERT INTO horse_people(horse_id,person_id,role) VALUES(7001,7901,'breeder'),(7001,7902,'breeder'),(7002,7903,'owner'),(7003,7904,'breeder')");
    const read=async(offset:number)=>await(await call(db,`/api/people?role=breeder&limit=1&offset=${offset}`)).json() as {people:{id:number}[],nextOffset:number|null};
    const a=await read(0),b=await read(1);expect(a.people.map(p=>p.id)).toEqual([7901]);expect(a.nextOffset).toBe(1);expect(b.people.map(p=>p.id)).toEqual([7902]);expect(b.nextOffset).toBeNull();
  });
  it("person horse lists and health counts exclude restricted imported horses", async () => {
    const { db } = await world();
    await db.exec("INSERT INTO people(id,name_latin) VALUES(7901,'Fictional owner'); INSERT INTO horse_people(horse_id,person_id,role) VALUES(7001,7901,'owner'),(7003,7901,'owner')");
    const profile = await (await call(db, "/api/people/7901")).json() as { person: { horse_count: number }; horses: { id: number }[] };
    expect(profile.person.horse_count).toBe(1);
    expect(profile.horses.map(h => h.id)).toEqual([7001]);
    const health = await (await call(db, "/api/health")).json() as { horses: number };
    expect(health.horses).toBe(2);
  });
});

describe("Public credential verification and extracts", () => {
  it("a known private attestation id does not bypass target visibility", async () => {
    const { db } = await world();
    await db.exec(`INSERT INTO issuers(id,slug,name,kind) VALUES('verify-issuer','verify-issuer','Fictional Issuer','federation');
      INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,status,attested_by_user_id) VALUES
      ('11111111-1111-4111-a111-111111111111','verify-issuer',7001,'genetic_test','7101','active','admin'),
      ('22222222-2222-4222-a222-222222222222','verify-issuer',7001,'horse_identity','7001','active','admin');`);
    expect((await call(db, "/api/attestations/11111111-1111-4111-a111-111111111111/verify")).status).toBe(404);
    expect((await call(db, "/api/attestations/22222222-2222-4222-a222-222222222222/verify")).status).toBe(200);
    await db.exec("UPDATE horses SET is_active=0 WHERE id=7001");
    expect((await call(db, "/api/attestations/22222222-2222-4222-a222-222222222222/verify")).status).toBe(404);
  });
  it("extracts use the actual public dam, hide private scope and withdraw after parent restriction", async () => {
    const { db, editor } = await world();
    await db.exec("UPDATE horses SET father_id=7003,mother_id=7002,uel_no='PRIVATE-UELN' WHERE id=7001");
    const issued = await call(db, "/api/horses/7001/certificate?lang=en", {}, editor);
    expect(issued.status).toBe(201);
    const receipt = await issued.json() as { extract: { extract_code: string } };
    const verifyUrl = `/api/extract/verify?code=${receipt.extract.extract_code}`;
    const verified = await (await call(db, verifyUrl)).json() as { valid: boolean; extract: { pedigree: { sire: unknown; dam: { id: number } }; facts: Record<string, unknown> } };
    expect(verified.valid).toBe(true);
    expect(verified.extract.pedigree).toMatchObject({ sire: null, dam: { id: 7002 } });
    expect(JSON.stringify(verified)).not.toContain("PRIVATE-UELN");
    await db.exec("UPDATE horses SET is_active=0 WHERE id=7002");
    expect(await (await call(db, verifyUrl)).json()).toMatchObject({ valid: false, reason: "visibility_changed" });
  });
});

describe("Registry rules preserve typed date meaning", () => {
  it("mixed-calendar chronology rejects a definite same-year death-before-birth", async () => {
    const { db, editor } = await world();
    await db.exec(`UPDATE horses SET death_date_value='2020-03-19',death_date_precision='day',death_date_calendar='gregorian',is_dead=1,life_status='dead' WHERE id=7001;
      INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES('mixed.chronology','chronology','Birth precedes death','blocker','{}','{"require_birth_before_death":true}','active',1)`);
    const id = await claim(db, "birth_date", { value: "1399-01-01", precision: "day", calendar: "solar_hijri" });
    await expect(adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id)).rejects.toMatchObject({ status: 422, code: "registry_rule_violation" });
    expect(await db.prepare("SELECT birth_date_value FROM horses WHERE id=7001").first("birth_date_value")).toBeNull();
  });
  it("calendarless historical date text remains uncertain rather than becoming a false blocker", async () => {
    const { db, editor } = await world();
    await db.exec(`UPDATE horses SET death_date_value='1400',death_date_precision=NULL,death_date_calendar=NULL WHERE id=7001;
      INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES('unknown.chronology','chronology','Birth precedes death','blocker','{}','{"require_birth_before_death":true}','active',1)`);
    const id = await claim(db, "birth_year", 2012);
    expect((await adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id)).status).toBe(200);
  });
});

describe("Reviewed registration policy uses the actual submitted and existing records", () => {
  it("draft attachment presence satisfies intake policy and retains the review outcome receipt", async () => {
    const { db, vet, admin } = await world();
    await db.exec(`INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES
      ('submission.document','required_evidence','Require registration document','blocker','{}','{"require_document":true}','active',1),
      ('submission.photo','required_evidence','Request identity photograph','warning','{}','{"require_photo":true}','active',1)`);
    const draft = await call(db, "/api/change-requests", { request_type: "create_horse", submit: false, submission: { name_latin: "Fictional submitted mare", birth_year: 2015 } }, vet);
    expect(draft.status).toBe(201);
    const { request } = await draft.json() as { request: { id: string } };
    const attachment = await call(db, `/api/change-requests/${request.id}/evidence`, { role: "passport", file_name: "synthetic.pdf", mime_type: "application/pdf", data_base64: btoa(pdfText), operation_id: crypto.randomUUID() }, vet);
    expect(attachment.status).toBe(201);
    expect((await call(db, `/api/change-requests/${request.id}/submit`, {}, vet)).status).toBe(200);
    const approved = await call(db, `/api/admin/change-requests/${request.id}/review`, { decision: "approved", note: "Reviewed fictional registration", rule_overrides: [{ rule_id: "submission.photo", reason: "Documented identity photograph exception for this fixture" }] }, admin);
    expect(approved.status, await approved.text()).toBe(200);
    expect(await countRows(db, "registry_rule_outcomes", "rule_id='submission.photo' AND subject_type='submission_review' AND outcome='override'")).toBe(1);
    expect(await countRows(db, "registry_rule_outcomes", "rule_id='submission.document' AND outcome='fail'")).toBe(0);
  });
  it("reviewing an unrelated field cannot bypass rules over existing lifecycle facts", async () => {
    const { db, editor, admin } = await world();
    await db.exec(`UPDATE horses SET is_dead=1,life_status='dead' WHERE id=7001;
      INSERT INTO registry_rules(id,rule_type,title,severity,applicability_json,spec_json,state,version) VALUES('lifecycle.date','life_status','Death date required','blocker','{}','{"require_death_date_when_dead":true}','active',1)`);
    const draft = await call(db, "/api/change-requests", { horse_id: 7001, request_type: "update_horse", summary: "Documented name correction", submit: true, items: [{ field_name: "name_latin", old_value: "Public Mare", proposed_value: "New Name" }] }, editor);
    expect(draft.status).toBe(201);
    const { request } = await draft.json() as { request: { id: string } };
    const reviewed = await call(db, `/api/admin/change-requests/${request.id}/review`, { decision: "approved", note: "Reviewed fictional correction" }, admin);
    expect(reviewed.status).toBe(422);
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=7001").first("name_latin")).toBe("Public Mare");
    expect(await db.prepare("SELECT status FROM change_requests WHERE id=?").bind(request.id).first("status")).toBe("pending");
  });
  it("a revoked session cannot complete a private upload even while its professional grant remains valid", async () => {
    const { db, admin, vet } = await world();
    await call(db, "/api/admin/professional-grants", grant({ permissions: ["sample_submit"] }), admin);
    const raced = beforeBatch(db, () => db.exec("DELETE FROM sessions WHERE user_id='vet'"));
    expect((await call(raced, "/api/horses/7001/media", upload(), vet)).status).toBe(403); // Central current-session guard rejects before business mutation.
    expect(await countRows(db, "horse_media")).toBe(0);
    expect(await countRows(db, "horse_media_blobs")).toBe(0);
  });
});

describe("Reviewed lifecycle reversal is distinct from a public field update", () => {
  it("restores an erroneous current death claim while ordinary API edits cannot erase a recorded death", async () => {
    const { db, editor } = await world();
    await db.exec("UPDATE horses SET life_status='alive' WHERE id=7001");
    const id = await claim(db, "death_date", { value: "2021", precision: "year", calendar: "gregorian" });
    await adminSelectFieldClaim(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, id);
    const version = await db.prepare("SELECT row_version FROM horses WHERE id=7001").first<number>("row_version");
    expect((await call(db, "/api/horses/7001", { expected_row_version: version, changes: { is_dead: 0 } }, editor, "PATCH")).status).toBe(400);
    expect((await call(db, "/api/horses/7001", { expected_row_version: version, changes: { life_status: "alive" } }, editor, "PATCH")).status).toBe(422);
    const decision = await db.prepare("SELECT id FROM field_claim_decisions WHERE claim_id=? AND decision='select_claim'").bind(id).first<{ id: number }>();
    expect((await adminRevertFieldClaimDecision(fieldReq(editor), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 7001, decision!.id)).status).toBe(200);
    expect(await db.prepare("SELECT death_date_value,death_date_precision,death_date_calendar,is_dead,life_status FROM horses WHERE id=7001").first()).toEqual({ death_date_value: null, death_date_precision: null, death_date_calendar: null, is_dead: 0, life_status: "alive" });
    expect(await countRows(db, "field_claim_decisions")).toBe(2);
  });
});
