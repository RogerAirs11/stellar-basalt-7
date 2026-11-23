import { describe, expect, it } from "vitest";
import { recordGeneticInterpretation } from "../../src/api/modules/genetics";
import { ASSAY_CATALOG_VERSION } from "../../src/genetics/assayCatalog";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";

/** R148 upgrades the old SQL-recording mock to a fully migrated database:
 * source preservation, private append-only history and rollback are observed
 * as persisted behavior, with actual scoped grants and session/CSRF checks. */
async function fixture() {
  const db=await openRealDatabase();
  await seedUser(db,"reviewer-1","user");await seedUser(db,"ungranted-admin","admin");
  await db.exec(`INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic review horse');
    INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,notes,verified)
      VALUES(77,1,'SCID','disease','N/SCID','lab text','synthetic lab','PRIVATE-ACCESSION','PRIVATE-SOURCE-NOTE',1);
    INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
      VALUES('reviewer-grant',1,'reviewer-1','veterinarian','genetic_evidence_read,genetic_review','SYNTHETIC-AUTHORITY','SYNTHETIC-ASSIGNMENT','admin_grant','ungranted-admin','2020-01-01');`);
  return {db,reviewer:await makeSession(db,"reviewer-1"),admin:await makeSession(db,"ungranted-admin")};
}
const input=(extra:Record<string,unknown>={})=>({operation_id:crypto.randomUUID(),expected_version:1,result_status:"carrier",verification:"unchanged",reason:"Reviewed against unchanged synthetic report",note:"PRIVATE-REVIEW-NOTE",...extra});
const path="/api/admin/genetic-tests/77/interpretation";

describe("P06/R148 reviewed-interpretation provenance",()=>{
  it("records catalog provenance and an atomic receipt without touching raw laboratory facts",async()=>{
    const {db,reviewer}=await fixture();
    const response=await recordGeneticInterpretation(authedRequest(path,input(),{session:reviewer}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},77);
    expect(response.status).toBe(200);
    expect((await response.json() as {review:unknown}).review).toMatchObject({interpretation_version:ASSAY_CATALOG_VERSION,scope:"recorded_genotype_only",clinical_diagnosis:false,verified:1,row_version:2});
    expect(await db.prepare("SELECT result,result_interpretation,lab_name,lab_accession,notes,interpretation_version,catalog_reviewed_by FROM genetic_tests WHERE id=77").first())
      .toEqual({result:"N/SCID",result_interpretation:"lab text",lab_name:"synthetic lab",lab_accession:"PRIVATE-ACCESSION",notes:"PRIVATE-SOURCE-NOTE",interpretation_version:ASSAY_CATALOG_VERSION,catalog_reviewed_by:"reviewer-1"});
    expect(await countRows(db,"genetic_evidence_operations")).toBe(1);
    expect(await countRows(db,"audit_events","action='genetic.interpretation.recorded'")).toBe(1);
    expect(JSON.stringify((await db.prepare("SELECT * FROM audit_events").all()).results)).not.toMatch(/N\/SCID|PRIVATE-/);
  });
  it("preserves prior provenance in private append-only history on every re-review",async()=>{
    const {db,reviewer}=await fixture();
    await db.exec("UPDATE genetic_tests SET interpretation_version='legacy-catalog',interpreted_at='2026-01-01',catalog_reviewed_by='legacy-reviewer' WHERE id=77");
    for(const version of [1,2]) expect((await recordGeneticInterpretation(authedRequest(path,input({expected_version:version}),{session:reviewer}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},77)).status).toBe(200);
    const history=(await db.prepare("SELECT private_detail_json FROM genetic_evidence_operations ORDER BY created_at,operation_id").all<{private_detail_json:string}>()).results;
    expect(history).toHaveLength(2);
    expect(history.some(row=>row.private_detail_json.includes("legacy-catalog"))).toBe(true);
    expect(history.some(row=>row.private_detail_json.includes(ASSAY_CATALOG_VERSION))).toBe(true);
  });
  it("a forced audit failure rolls back interpretation and receipt together",async()=>{
    const {db,reviewer}=await fixture();
    await db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON audit_events WHEN NEW.action='genetic.interpretation.recorded' BEGIN SELECT RAISE(ABORT,'forced review audit failure'); END;");
    await expect(recordGeneticInterpretation(authedRequest(path,input(),{session:reviewer}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},77)).rejects.toThrow("forced review audit failure");
    expect(await countRows(db,"genetic_evidence_operations")).toBe(0);
    expect(await db.prepare("SELECT row_version,interpretation_version FROM genetic_tests WHERE id=77").first()).toEqual({row_version:1,interpretation_version:null});
  });
  it("denies unknown records and ungranted staff without disclosing their contents",async()=>{
    const {db,reviewer,admin}=await fixture();
    await expect(recordGeneticInterpretation(authedRequest(path,input(),{session:reviewer}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},999)).rejects.toMatchObject({status:403});
    await expect(recordGeneticInterpretation(authedRequest(path,input(),{session:admin}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},77)).rejects.toMatchObject({status:403});
  });
  it("requires the real session's CSRF token",async()=>{
    const {db,reviewer}=await fixture();
    const request=authedRequest(path,input(),{session:reviewer});request.headers.delete("x-csrf-token");
    await expect(recordGeneticInterpretation(request,{DB:db,SESSION_COOKIE_NAME:"hr_session"},77)).rejects.toMatchObject({status:403,code:"csrf_failed"});
  });
  it("rejects invalid or falsely reassuring interpretation statuses",async()=>{
    const {db,reviewer}=await fixture();
    await expect(recordGeneticInterpretation(authedRequest(path,input({result_status:"definitely-fine"}),{session:reviewer}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},77)).rejects.toMatchObject({status:400,code:"invalid_interpretation"});
    await expect(recordGeneticInterpretation(authedRequest(path,input({result_status:"clear"}),{session:reviewer}),{DB:db,SESSION_COOKIE_NAME:"hr_session"},77)).rejects.toMatchObject({status:422,code:"catalog_status_mismatch"});
  });
});
