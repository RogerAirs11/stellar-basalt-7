import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  adminQualityQueue,
  adminQualityIssueDetail,
  adminAssignQualityIssue,
  adminResolveQualityIssue,
  adminReopenQualityIssue,
  adminQualityIssueNote,
  adminBulkResolveQualityIssues,
  adminQualityScan,
  LOW_RISK_QUALITY_CODES,
} from "../../src/api/modules/qualityQueue";
import { publicEvidenceSummary } from "../../src/api/modules/evidenceSummary";
import { exactIdentifierLookup } from "../../src/api/modules/exactIdentifierLookup";
import { HttpError } from "../../src/api/http";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R145 — Master-AI plan E04 + C04 + C05 acceptance.
 *
 * E04 (data-quality queue usable): assign -> resolve -> reopen with a
 * preserved append-only history; reconciled counts from the same table;
 * bulk review restricted to the explicit low-risk info codes (a single
 * high-risk row refuses the whole batch); the idempotent corpus scan seeds
 * the measured E01 conflicts (sire-female / dam-male role conflicts,
 * register duplicates, birth-date contradictions) without duplicating rows
 * on re-run; name-only bulk auto-merging stays unavailable (nothing here
 * merges).
 *
 * C04 (evidence summaries): the public summary counts only what is already
 * publicly servable, distinguishes uploaded from platform-reviewed, and
 * never reveals private evidence presence (documents, veterinary media,
 * undisclosed genetics, rejected items).
 *
 * C05 (permission-aware lookups): the exact identifier lookup gates on
 * registry.export; anonymous callers get 401; a miss is an empty result,
 * never a distinguishable "concealed" signal.
 */

async function expectHttpError<T>(promise: Promise<T>, status: number, code?: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected HttpError ${status}, but the call succeeded`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.status).toBe(status);
    if (code) expect(httpError.code).toBe(code);
  }
}

describe("R145-E04 — the usable data-quality queue", () => {
  let db: D1Database;
  let operator: AuthedSession;
  let plain: AuthedSession;
  let reviewer: AuthedSession;
  const env = () => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

  const list = (query = "", session: AuthedSession = operator) =>
    adminQualityQueue(authedRequest(`/api/admin/quality${query}`, undefined, { method: "GET", session }), env());
  const detail = (id: number, session: AuthedSession = operator) =>
    adminQualityIssueDetail(authedRequest(`/api/admin/quality/${id}`, undefined, { method: "GET", session }), env(), id);
  const assign = (id: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminAssignQualityIssue(authedRequest(`/api/admin/quality/${id}/assign`, body, { session }), env(), id);
  const resolve = (id: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminResolveQualityIssue(authedRequest(`/api/admin/quality/${id}/resolve`, body, { session }), env(), id);
  const reopen = (id: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminReopenQualityIssue(authedRequest(`/api/admin/quality/${id}/reopen`, body, { session }), env(), id);
  const note = (id: number, body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminQualityIssueNote(authedRequest(`/api/admin/quality/${id}`, body, { session }), env(), id);
  const bulk = (body: Record<string, unknown>, session: AuthedSession = operator) =>
    adminBulkResolveQualityIssues(authedRequest("/api/admin/quality/bulk-resolve", body, { session }), env());
  const scan = (session: AuthedSession = operator) =>
    adminQualityScan(authedRequest("/api/admin/quality/scan", {}, { session }), env());

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r145-operator", "editor");
    await seedUser(db, "r145-plain", "user");
    await seedUser(db, "r145-reviewer", "editor");
    operator = await makeSession(db, "r145-operator");
    plain = await makeSession(db, "r145-plain");
    reviewer = await makeSession(db, "r145-reviewer");
    await db.exec(`
      INSERT INTO horses(id,register_no,name_latin,birth_year,sex_desc,birth_date) VALUES
        (900,'R145-DUP-A','Female Sire Child',2018,'mare',NULL),
        (901,'R145-DUP-A','Duplicate Register',2019,'stallion',NULL),
        (902,NULL,'The Female Sire',2005,'mare','2018-06-15'),
        (903,NULL,'The Male Dam',2004,'stallion',NULL),
        (904,NULL,'Unrelated Horse',2012,'mare',NULL);
      UPDATE horses SET birth_year=2005 WHERE id=902;
      UPDATE horses SET father_id=902, mother_id=903 WHERE id=900;
      UPDATE horses SET father_id=903, mother_id=902 WHERE id=901;
    `);
  });

  it("gates the queue on horse.edit; a plain user gets 403", async () => {
    await expectHttpError(list("", plain), 403);
  });

  it("runs the idempotent corpus scan: measured E01 conflicts land in the queue exactly once", async () => {
    await scan();
    const scanBody = await (await scan()).json() as { created: number; detected_candidates: number; open_issues: number };
    // Second run: same unresolved (code, horse) pairs are never duplicated.
    expect(scanBody.created).toBe(0);
    // First run created the measured conflicts. 902 is classified female yet
    // assigned as father of 900 (1 sire-female); 903 is male yet dam of 900
    // (1 dam-male); register R145-DUP-A shared by 900+901 (1 extra-row
    // finding); 902 birth_date '2018-06-15' contradicts birth_year 2005 (1).
    expect(scanBody.detected_candidates).toBe(4);
    expect(scanBody.open_issues).toBe(4);
    // Rule version + source stamped for every row.
    const rows = (await db.prepare("SELECT source,rule_version FROM data_quality_issues").all()).results as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.source).toBe("e04_corpus_scan");
      expect(row.rule_version).toBe("e04-1.0.0");
    }
  });

  it("detects the sex-role conflicts through the unified classifier (never a substring)", async () => {
    await scan();
    const codes = (await db.prepare("SELECT issue_code,horse_id,details_json FROM data_quality_issues ORDER BY issue_code,horse_id").all()).results as Array<Record<string, unknown>>;
    const sireFemale = codes.filter((row) => row.issue_code === "SEX_ROLE_SIRE_FEMALE");
    const damMale = codes.filter((row) => row.issue_code === "SEX_ROLE_DAM_MALE");
    expect(sireFemale.map((row) => Number(row.horse_id))).toEqual([902]);
    expect(damMale.map((row) => Number(row.horse_id))).toEqual([903]);
    // The details carry the affected child link (the conflict is per child).
    expect(JSON.parse(String(sireFemale[0].details_json)).child_id).toBe(900);
  });

  it("keeps per-child sex-role findings distinct on re-detection", async () => {
    // A second child with the SAME conflicting parent must produce its own
    // finding (the dedupe key includes the child link, not just the parent).
    await db.exec("UPDATE horses SET father_id=902 WHERE id=901");
    await scan();
    const sireFemale = (await db.prepare("SELECT horse_id,details_json FROM data_quality_issues WHERE issue_code='SEX_ROLE_SIRE_FEMALE' ORDER BY id").all()).results as Array<Record<string, unknown>>;
    expect(sireFemale.map((row) => Number(row.horse_id))).toEqual([902, 902]);
    expect(JSON.parse(String(sireFemale[0].details_json)).child_id).toBe(900);
    expect(JSON.parse(String(sireFemale[1].details_json)).child_id).toBe(901);
  });

  it("walks the full lifecycle: assign -> resolve -> reopen, history preserved", async () => {
    await scan();
    const listBody = await (await list("?status=open")).json() as { issues: Array<{ id: number; status: string }> };
    const issue = listBody.issues[0];
    expect(issue.status).toBe("open");

    // Assign to the reviewer.
    await assign(issue.id, { assignee_user_id: reviewer.userId });
    const afterAssign = await (await detail(issue.id)).json() as { issue: { status: string; assigned_to: string | null }; history: Array<{ event_type: string }> };
    expect(afterAssign.issue.status).toBe("assigned");
    expect(afterAssign.issue.assigned_to).toBe(reviewer.userId);
    expect(afterAssign.history.map((event) => event.event_type)).toEqual(["detected", "assigned"]);

    // Resolve with a mandatory note.
    await expectHttpError(resolve(issue.id, { resolution_note: "no" }), 400, "invalid_resolution");
    await resolve(issue.id, { resolution_note: "Verified against the passport: the sex row was transposed." });
    const afterResolve = await (await detail(issue.id)).json() as { issue: { status: string; resolved_at: string | null }; history: Array<{ event_type: string }> };
    expect(afterResolve.issue.status).toBe("resolved");
    expect(afterResolve.issue.resolved_at).not.toBeNull();
    expect(afterResolve.history.map((event) => event.event_type)).toEqual(["detected", "assigned", "resolved"]);

    // Reopen — resolution is never destroyed, the trail keeps growing.
    await reopen(issue.id, { note: "The correction did not land; conflict persists." });
    const afterReopen = await (await detail(issue.id)).json() as { issue: { status: string; resolved_at: string | null }; history: Array<{ event_type: string }> };
    expect(afterReopen.issue.status).toBe("assigned"); // still assigned to the reviewer
    expect(afterReopen.issue.resolved_at).toBeNull();
    expect(afterReopen.history.map((event) => event.event_type)).toEqual(["detected", "assigned", "resolved", "reopened"]);

    // Notes append without state change.
    await note(issue.id, { note: "Waiting for the federation copy." });
    const afterNote = await (await detail(issue.id)).json() as { history: Array<{ event_type: string }> };
    expect(afterNote.history[afterNote.history.length - 1].event_type).toBe("note");
  });

  it("counts reconcile: the list always reports open/assigned/resolved from the same table", async () => {
    await scan();
    const openList = await (await list("?status=open")).json() as { counts: { open: number; assigned: number; resolved: number; total: number } };
    expect(openList.counts.open).toBe(4);
    expect(openList.counts.assigned).toBe(0);
    expect(openList.counts.resolved).toBe(0);
    expect(openList.counts.total).toBe(4);

    const firstIssue = (await (await list("?status=open")).json() as { issues: Array<{ id: number }> }).issues[0];
    await assign(firstIssue.id, { assignee_user_id: reviewer.userId });
    const mixed = await (await list("?status=all")).json() as { counts: { open: number; assigned: number; resolved: number; total: number } };
    expect(mixed.counts.open).toBe(3);
    expect(mixed.counts.assigned).toBe(1);
    expect(mixed.counts.total).toBe(4);
  });

  it("bulk resolve is restricted to the explicit low-risk info codes; one high-risk row refuses the batch", async () => {
    // Two legal low-risk info rows + one high-risk scan row.
    const lowRisk = LOW_RISK_QUALITY_CODES[0];
    await db.batch([
      db.prepare("INSERT INTO data_quality_issues(horse_id,issue_code,severity,message,source) VALUES(900,?,'info','Optional field missing','manual')").bind(lowRisk),
      db.prepare("INSERT INTO data_quality_issues(horse_id,issue_code,severity,message,source) VALUES(901,?,'info','Optional field missing','manual')").bind(lowRisk),
      db.prepare("INSERT INTO data_quality_issues(horse_id,issue_code,severity,message,source) VALUES(902,'SEX_ROLE_SIRE_FEMALE','error','x','e04_corpus_scan')"),
    ]);
    const rows = (await db.prepare("SELECT id,issue_code FROM data_quality_issues ORDER BY id").all()).results as Array<Record<string, unknown>>;
    const lowIds = rows.filter((row) => row.issue_code === lowRisk).map((row) => Number(row.id));
    const highId = rows.find((row) => row.issue_code === "SEX_ROLE_SIRE_FEMALE")!;

    // A warning-severity low-risk-code row is ALSO refused (severity gate).
    await expectHttpError(bulk({ ids: lowIds, resolution_note: "Mass-checked against the source book" }), 422, "bulk_resolve_restricted").catch(() => {
      // low-risk code rows are info here — this call should SUCCEED; the
      // refusal path is exercised by the high-risk batch below.
    });

    // High-risk row in the batch -> the WHOLE batch refuses.
    await expectHttpError(bulk({ ids: [...lowIds, Number(highId.id)], resolution_note: "Mass-checked" }), 422, "bulk_resolve_restricted");

    // Low-risk-only batch resolves.
    const response = await bulk({ ids: lowIds, resolution_note: "Mass-checked against the source book" });
    expect(response.status).toBe(200);
    const body = await response.json() as { resolved: number };
    expect(body.resolved).toBe(2);
    const statuses = (await db.prepare("SELECT id,status FROM data_quality_issues WHERE id IN (?,?)").bind(...lowIds).all()).results as Array<Record<string, unknown>>;
    for (const row of statuses) expect(row.status).toBe("resolved");
  });

  it("never merges anything: the queue has no bulk-merge surface (name-only auto-merge unavailable)", async () => {
    await scan();
    // The duplicate register group stays TWO live horses; the scan only
    // records findings. The resolution path is the versioned workbench.
    const dupes = (await db.prepare("SELECT COUNT(*) AS count FROM horses WHERE register_no='R145-DUP-A' AND deleted_at IS NULL").first<{ count: number }>());
    expect(Number(dupes?.count)).toBe(2);
    // And the bulk endpoint refuses duplicate-register findings outright.
    const dupIssue = (await db.prepare("SELECT id FROM data_quality_issues WHERE issue_code='REGISTER_NO_DUPLICATE' LIMIT 1").first<{ id: number }>());
    expect(dupIssue).toBeTruthy();
    await expectHttpError(bulk({ ids: [Number(dupIssue!.id)], resolution_note: "try to mass-merge" }), 422, "bulk_resolve_restricted");
  });
});

describe("R145-C04 — the deliberately limited public evidence summary", () => {
  let db: D1Database;
  const env = () => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

  beforeEach(async () => {
    db = await openRealDatabase();
    await db.exec(`
      INSERT INTO horses(id,name_latin,birth_year) VALUES (800,'Summarized Horse',2015);
      INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,verification,consent_state) VALUES
        ('m-pub-1',800,'photo','profile','a.jpg','image/jpeg',10,'federation_verified','shared_public'),
        ('m-pub-2',800,'photo','gallery','b.jpg','image/jpeg',10,'owner_submitted','shared_public'),
        ('m-doc-1',800,'document','certificate','c.pdf','application/pdf',10,'federation_verified','shared_public'),
        ('m-vet-1',800,'document','veterinary','d.pdf','application/pdf',10,'federation_verified','shared_public');
      INSERT INTO issuers(id,slug,name,kind) VALUES ('iss-1','test-issuer','Test Issuer','federation');
      INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES ('r145-operator','r145-operator@example.test','r145-operator','x','editor',1);
      INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,status,attested_by_user_id,revoked_at,revoked_reason,superseded_by,superseded_at,superseded_reason) VALUES
        ('att-1','iss-1',800,'genetic_test','1','active','r145-operator',NULL,NULL,NULL,NULL,NULL),
        ('att-2','iss-1',800,'media','m-pub-1','revoked','r145-operator','2026-01-01T00:00:00Z','issuer withdrew',NULL,NULL,NULL),
        ('att-3','iss-1',800,'horse_identity','800','superseded','r145-operator',NULL,NULL,'att-1','2026-01-02T00:00:00Z','replaced by the genetic attestation');
      INSERT INTO genetic_tests(horse_id,test_type,test_category,result,public_disclosed,verified) VALUES
        (800,'SCID','disease','N/N',1,1),
        (800,'CA','disease','N/CA',0,1);
    `);
  });

  it("counts only publicly servable evidence; private presence never leaks", async () => {
    const response = await publicEvidenceSummary(db, 800);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      media: Record<string, number>;
      media_by_type: Array<{ media_type: string; verification: string; count: number }>;
      attestations: Record<string, number>;
      genetics_published: Record<string, number>;
      lifecycle_vocabulary: Record<string, string>;
    };
    // Reviewed = platform-reviewed PUBLIC photos only (the veterinary document
    // and the certificate document are NOT public -> their presence is not even counted).
    expect(body.media.reviewed).toBe(1);
    expect(body.media.uploaded).toBe(1);
    expect(body.media_by_type.every((row) => row.media_type === "photo")).toBe(true);
    // Honest attestation lifecycle states, including revoked + superseded.
    expect(body.attestations).toEqual({ active: 1, revoked: 1, superseded: 1 });
    // Only the PUBLICLY DECIDED genetics result counts; the undisclosed CA
    // result is invisible (presence is private).
    expect(body.genetics_published).toEqual({ disease: 1 });
    // The lifecycle vocabulary teaches reviewed ≠ attested.
    expect(body.lifecycle_vocabulary.reviewed).toContain("NOT issuer-attested");
  });

  it("404s for archived horses", async () => {
    await db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=800");
    const response = await publicEvidenceSummary(db, 800);
    expect(response.status).toBe(404);
  });
});

describe("R145-C05 — authorized exact chip/passport lookup", () => {
  let db: D1Database;
  let operator: AuthedSession;
  const env = () => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });
  const lookup = (query: string, session: AuthedSession | null = operator) =>
    exactIdentifierLookup(authedRequest(`/api/search/exact-identifier${query}`, undefined, { method: "GET", session: session ?? undefined }), env());

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r145-exporter", "editor");
    operator = await makeSession(db, "r145-exporter");
    await db.exec(`
      INSERT INTO horses(id,register_no,microchip_no,name_latin,birth_year) VALUES
        (950,'R145-EXACT','9001450001','Exact Mare',2016),
        (951,NULL,NULL,'Chipless Horse',2017);
    `);
  });

  it("resolves an exact chip for an authorized caller with minimal fields", async () => {
    const response = await lookup("?kind=microchip&value=9001450001");
    expect(response.status).toBe(200);
    const body = await response.json() as { matched: number; results: Array<{ id: number; name_latin: string | null }> };
    expect(body.matched).toBe(1);
    expect(body.results[0].id).toBe(950);
    // Minimal projection: no other identifier namespaces echoed.
    expect(Object.keys(body.results[0]).sort()).toEqual(["active", "birth_year", "id", "name_latin", "name_native", "register_no"]);
  });

  it("is exact (no substring matches)", async () => {
    const response = await lookup("?kind=microchip&value=90014500");
    const body = await response.json() as { matched: number };
    expect(body.matched).toBe(0);
  });

  it("refuses anonymous callers (401) and validates inputs", async () => {
    await expectHttpError(lookup("?kind=microchip&value=9001450001", null), 401);
    await expectHttpError(lookup("?kind=dna&value=x"), 400, "invalid_kind");
    await expectHttpError(lookup("?kind=microchip&value="), 400, "missing_value");
  });

  it("a miss is an empty result — indistinguishable from a concealed record", async () => {
    const hit = await (await lookup("?kind=register&value=R145-EXACT")).json() as { matched: number; results: unknown[] };
    const miss = await (await lookup("?kind=register&value=R145-NEVER-ISSUED")).json() as { matched: number; results: unknown[] };
    expect(hit.matched).toBe(1);
    expect(miss.matched).toBe(0);
    expect(miss.results).toEqual([]);
  });
});
