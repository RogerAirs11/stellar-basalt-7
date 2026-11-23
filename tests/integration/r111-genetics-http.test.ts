import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";
import { projectArabianPairing } from "../../src/genetics/pairingProjection";

const limiter = { limit: async () => ({ success: true }) };
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession) {
  return (workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> }).fetch(authedRequest(path, body, { session }), {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", DB: db, SESSION_COOKIE_NAME: "hr_session",
    ASSETS: { fetch: async () => new Response("unused") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  });
}
async function world() {
  const db = await openRealDatabase();
  await seedUser(db, "r111-editor-a", "editor"); await seedUser(db, "r111-editor-b", "editor"); await seedUser(db, "r111-owner", "owner");
  await db.exec(`INSERT INTO horses(id,name_latin,sex_desc) VALUES(9101,'Fictional sire','Stallion'),(9102,'Fictional dam','Mare');
    INSERT INTO breeding_records(id,sire_id,dam_id,covering_date,season,provenance) VALUES(9501,9101,9102,'2026-04-15',1405,'demo');`);
  // R148: reviewers are explicitly assigned on each parent; editorial role
  // alone no longer unlocks genetic evidence or review commands.
  for (const user of ["r111-editor-a","r111-editor-b"]) for (const horseId of [9101,9102]) {
    await db.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
      VALUES(?,?,?,'veterinarian','genetic_evidence_read,genetic_review','SYNTHETIC-AUTHORITY','SYNTHETIC-REVIEW','admin_grant','r111-editor-a','2020-01-01')`)
      .bind(crypto.randomUUID(),horseId,user).run();
  }
  return { db, a: await makeSession(db, "r111-editor-a"), b: await makeSession(db, "r111-editor-b"), owner: await makeSession(db, "r111-owner") };
}
const correction = (extra: Record<string, unknown> = {}) => ({ expected_version: 1, operation_id: crypto.randomUUID(), covering_date: "2026-04-16", season: 1405, reason: "Corrected against the fictional covering record", ...extra });
const route = "/api/admin/breeding/9501/correct";

describe("R111 breeding correction: actual HTTP, database, versions and receipts", () => {
  it("requires a version and refuses unprivileged writes without an audit", async () => {
    const { db, a, owner } = await world();
    expect((await call(db, route, correction({ expected_version: undefined }), a)).status).toBe(428);
    expect((await call(db, route, correction(), owner)).status).toBe(403);
    expect(await countRows(db, "breeding_record_corrections")).toBe(0);
    expect(await countRows(db, "audit_events", "action='breeding.record.corrected'")).toBe(0);
  });
  it("two editors from one version have exactly one winner and one success audit", async () => {
    const { db, a, b } = await world();
    const responses = await Promise.all([call(db, route, correction(), a), call(db, route, correction({ covering_date: "2026-04-17" }), b)]);
    expect(responses.map(r => r.status).sort()).toEqual([200,409]);
    expect(await countRows(db, "breeding_record_corrections")).toBe(1);
    expect(await countRows(db, "audit_events", "action='breeding.record.corrected'")).toBe(1);
    const saved = await db.prepare("SELECT sire_id,dam_id,row_version FROM breeding_records WHERE id=9501").first();
    expect(saved).toMatchObject({ sire_id: 9101, dam_id: 9102, row_version: 2 });
  });
  it("same-intent retries reuse one receipt; key reuse cannot change actor or payload", async () => {
    const { db, a, b } = await world(); const intent = correction();
    expect((await call(db, route, intent, a)).status).toBe(200);
    const retry = await call(db, route, intent, a);
    expect(retry.status).toBe(200); expect((await retry.json() as { replayed: boolean }).replayed).toBe(true);
    expect((await call(db, route, { ...intent, reason: "A different purported correction reason" }, a)).status).toBe(409);
    expect((await call(db, route, intent, b)).status).toBe(409);
    expect(await countRows(db, "audit_events", "action='breeding.record.corrected'")).toBe(1);
  });
  it("the in-write authority check refuses an editor deactivated after their initial read", async () => {
    const { db, a } = await world();
    const raced = Object.create(db) as D1Database;
    raced.batch = async (statements: Parameters<D1Database["batch"]>[0]) => {
      await db.prepare("UPDATE users SET is_active=0 WHERE id=?").bind(a.userId).run();
      return db.batch(statements);
    };
    expect((await call(raced, route, correction(), a)).status).toBe(403); // Current-session guard now rejects the deactivated actor first.
    expect(await countRows(db, "breeding_record_corrections")).toBe(0);
    expect(await countRows(db, "audit_events", "action='breeding.record.corrected'")).toBe(0);
  });
  it("one operation reference cannot race onto two different records", async () => {
    const { db, a } = await world();
    await db.exec("INSERT INTO breeding_records(id,sire_id,dam_id,season,provenance) VALUES(9502,9101,9102,1405,'demo')");
    const intent = correction();
    const responses = await Promise.all([call(db, route, intent, a), call(db, "/api/admin/breeding/9502/correct", intent, a)]);
    expect(responses.map(response => response.status).sort()).toEqual([200,409]);
    expect(await countRows(db, "breeding_record_corrections")).toBe(1);
    expect(await countRows(db, "audit_events", "action='breeding.record.corrected'")).toBe(1);
    const rows = await db.prepare("SELECT row_version FROM breeding_records ORDER BY id").all<{ row_version: number }>();
    expect(rows.results.map(row => Number(row.row_version)).sort()).toEqual([1,2]);
  });
  it("preserves a deliberately unknown covering day and derives a season only from a real day", async () => {
    const { db, a } = await world();
    const partial = await call(db, route, correction({ covering_date: null }), a);
    expect(partial.status).toBe(200);
    expect((await partial.json() as { record: unknown }).record).toMatchObject({ covering_date: null, season: 1405, row_version: 2 });
    const derived = await call(db, route, correction({ expected_version: 2, season: null }), a);
    expect(derived.status).toBe(200);
    expect((await derived.json() as { record: unknown }).record).toMatchObject({ covering_date: "2026-04-16", season: 1405, row_version: 3 });
    expect((await call(db, route, correction({ expected_version: 3, covering_date: null, season: null }), a)).status).toBe(400);
    expect(await countRows(db, "audit_events", "action='breeding.record.corrected'")).toBe(2);
  });
});

async function testRecord(db: D1Database, id: number, horseId: number, result: string, verified = 1, testType = "CA") {
  // R142-B01: pairing now honors the R140 publication gate, so fixtures that
  // exercise the pairing math must record the explicit disclosure decision.
  await db.prepare("INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,lab_accession,notes,public_disclosed) VALUES(?,?,?,'disease',?,?,'demo','PRIVATE-ACCESSION','PRIVATE-NOTE',1)")
    .bind(id, horseId, testType, result, verified).run();
}
function review(result: string, extra: Record<string, unknown> = {}) {
  return { operation_id: crypto.randomUUID(), expected_test_version: 1, legacy_origin_acknowledged: true, assay_key: "CA", expected_version: 0, expected_test_type: "CA", expected_result: result,
    state: "accepted", reason: "Reviewed fictional genotype for a synthetic demonstration", ...extra };
}
describe("R111 explicit Arabian evidence: actual HTTP and persisted review state", () => {
  it("refuses an over-limit evidence set instead of hiding possible conflicting records", async () => {
    const { db } = await world();
    await db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<501)
      INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,public_disclosed)
      SELECT 99000+x,9101,'CA','disease','N/N',1,'demo',1 FROM n`);
    const response = await call(db, "/api/breeding/pairing-evidence?sire=9101&dam=9102");
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("pairing_evidence_limit");
  });
  it("canonical-looking free text alone is not automatically mapped or scored", async () => {
    const { db } = await world(); await testRecord(db, 9601, 9101, "N/CA"); await testRecord(db, 9602, 9102, "N/CA");
    const report = await projectArabianPairing(db, 9101, 9102);
    expect(report.calculableVariants).toBe(0); expect(report.excludedEvidence.parentA.unmapped).toBe(1);
    expect(report.variants.every(v => v.probabilities === null)).toBe(true);
  });
  it("approved carrier mappings yield 25/50/25, and withdrawing one immediately removes probabilities", async () => {
    const { db, a } = await world(); await testRecord(db, 9601, 9101, "N/CA"); await testRecord(db, 9602, 9102, "N/CA");
    for (const id of [9601,9602]) expect((await call(db, `/api/admin/genetic-tests/${id}/pairing-review`, review("N/CA"), a)).status).toBe(200);
    const response = await call(db, "/api/breeding/pairing-evidence?sire=9101&dam=9102");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json() as Awaited<ReturnType<typeof projectArabianPairing>>;
    expect(body.variants.find(v => v.variant === "CA")?.probabilities).toEqual({ zeroVariantCopies: .25, oneVariantCopy: .5, twoVariantCopies: .25 });
    expect(body.syntheticEvidence).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE-ACCESSION|PRIVATE-NOTE/);
    expect((await call(db, "/api/admin/genetic-tests/9601/pairing-review", review("N/CA", { expected_version: 1, state: "withdrawn" }), a)).status).toBe(200);
    expect((await projectArabianPairing(db,9101,9102)).calculableVariants).toBe(0);
  });
  it("unverified rows and their counts remain private; owners cannot approve mappings", async () => {
    const { db, a, owner } = await world(); await testRecord(db,9601,9101,"N/CA",0);
    expect((await call(db,"/api/admin/genetic-tests/9601/pairing-review",review("N/CA"),owner)).status).toBe(403);
    expect((await call(db,"/api/admin/genetic-tests/9601/pairing-review",review("N/CA"),a)).status).toBe(409);
    const publicReport = await projectArabianPairing(db,9101,9102);
    expect(publicReport.excludedEvidence.parentA).toEqual({unmapped:0,expired:0,withdrawn:0,changed:0,unverified:0});
  });
  it("conflicting retests, expired reviews and edited raw evidence never produce reassuring probabilities", async () => {
    const {db,a}=await world();
    for(const [id,horse,result] of [[9601,9101,"N/CA"],[9602,9102,"N/CA"],[9603,9101,"N/N"]] as const){
      await testRecord(db,id,horse,result);
      expect((await call(db,`/api/admin/genetic-tests/${id}/pairing-review`,review(result),a)).status).toBe(200);
    }
    expect((await projectArabianPairing(db,9101,9102)).variants.find(v=>v.variant==="CA")?.parentA.status).toBe("conflict");
    await db.prepare("UPDATE genetic_pairing_reviews SET expires_at='2020-01-01T00:00:00Z' WHERE test_id=9602").run();
    await db.prepare("UPDATE genetic_tests SET result='N/N' WHERE id=9601").run();
    const report=await projectArabianPairing(db,9101,9102);
    expect(report.calculableVariants).toBe(0);expect(report.excludedEvidence.parentA.changed).toBe(1);expect(report.excludedEvidence.parentB.expired).toBe(1);
  });
  it("same-version competing reviews produce one audit and stale 409, and reject a deleted parent", async () => {
    const {db,a,b}=await world(); await testRecord(db,9601,9101,"N/CA");
    const responses=await Promise.all([call(db,"/api/admin/genetic-tests/9601/pairing-review",review("N/CA"),a),call(db,"/api/admin/genetic-tests/9601/pairing-review",review("N/CA"),b)]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    expect(await countRows(db,"audit_events","action='genetic.pairing_review.accepted'")).toBe(1);
    await db.prepare("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=9102").run();
    expect((await call(db,"/api/breeding/pairing-evidence?sire=9101&dam=9102")).status).toBe(404);
  });
});
