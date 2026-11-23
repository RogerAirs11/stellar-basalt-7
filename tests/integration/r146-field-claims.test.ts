import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  recordFieldClaims,
  adminHorseFieldClaims,
  adminSelectFieldClaim,
  adminRejectFieldClaim,
  adminRevertFieldClaimDecision,
  adminFieldClaimQueue,
} from "../../src/api/modules/fieldClaims";
import workerDefault from "../../src/worker";
import { HttpError } from "../../src/api/http";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";


/**
 * R146-D05 (Master-AI plan) — field-level claims and conflict resolution.
 *
 * Acceptance under test:
 *   - Competing values are RETAINED with their sources (import provenance);
 *     a claim never mutates the canonical row by itself.
 *   - Canonical matches and same-source duplicates are NOT stored
 *     (idempotent external refreshes, no noise).
 *   - The reviewer sees the current canonical value + every competing claim
 *     + the decision history per field.
 *   - Selecting a claim applies the value through the SAME validated
 *     mutation path as every write (normalization, cycle guard, guarded
 *     batch), preserves the PREVIOUS canonical value in the decision row,
 *     and supersedes the other selected claims for the field.
 *   - A parent claim that would create a pedigree cycle is refused by the
 *     same cycle guard a direct edit faces (409).
 *   - Reversal restores the consistent prior state, marks the decision
 *     reverted, returns the claim to pending, and appends a revert decision.
 *   - External-refresh protection: the import fill-once path records
 *     competing values as claims — canonical facts are never silently
 *     replaced, and the competing value is no longer silently dropped.
 */

const worker = workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> };
const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only",
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  };
}

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

describe("R146-D05 — recordFieldClaims retention", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await openRealDatabase();
    await db.exec(`INSERT INTO horses(id,name_latin,name_native,birth_year,breed_desc,sex_desc) VALUES
      (14701,'Canonical Mare','مار کانونیک',2015,'Persian','Mare')`);
  });

  it("records a competing claim with its source and never touches the canonical row", async () => {
    const dispositions = await recordFieldClaims(db, 14701, [
      { field_name: "birth_year", claimed_value: 2013, source_type: "import", source_ref: "batch:1:row:1", created_by: "r146-reviewer" },
    ]);
    expect(dispositions[0].disposition).toBe("recorded");
    const row = await db.prepare("SELECT field_name,claimed_value,value_kind,source_type,source_ref,review_status FROM field_claims WHERE horse_id=14701").first<Record<string, unknown>>();
    expect(row?.field_name).toBe("birth_year");
    expect(row?.claimed_value).toBe("2013");
    expect(row?.value_kind).toBe("number");
    expect(row?.source_type).toBe("import");
    expect(row?.review_status).toBe("pending");
    const canonical = await db.prepare("SELECT birth_year FROM horses WHERE id=14701").first<{ birth_year: number }>();
    expect(canonical?.birth_year).toBe(2015); // untouched
  });

  it("skips canonical matches and duplicate open claims (idempotent refresh)", async () => {
    const first = await recordFieldClaims(db, 14701, [
      { field_name: "birth_year", claimed_value: 2013, source_type: "import", source_ref: "batch:1:row:1" },
      { field_name: "breed_desc", claimed_value: "Persian", source_type: "import", source_ref: "batch:1:row:1" }, // canonical match
      { field_name: "name_latin", claimed_value: "Canonical Mare", source_type: "import", source_ref: "batch:1:row:1" }, // canonical match
    ]);
    expect(first.map((d) => d.disposition)).toEqual(["recorded", "matches_canonical", "matches_canonical"]);
    // A refresh of the same source row is a duplicate, not a second claim.
    const refresh = await recordFieldClaims(db, 14701, [
      { field_name: "birth_year", claimed_value: 2013, source_type: "import", source_ref: "batch:1:row:1" },
    ]);
    expect(refresh[0].disposition).toBe("duplicate_open_claim");
    const count = await db.prepare("SELECT COUNT(*) AS n FROM field_claims WHERE horse_id=14701").first<{ n: number }>();
    expect(Number(count?.n ?? 0)).toBe(1);
  });

  it("allows the same competing value from a DIFFERENT source (independent evidence)", async () => {
    await recordFieldClaims(db, 14701, [{ field_name: "birth_year", claimed_value: 2013, source_type: "import", source_ref: "batch:1:row:1" }]);
    const other = await recordFieldClaims(db, 14701, [{ field_name: "birth_year", claimed_value: 2013, source_type: "external_scrape", source_ref: "kasilor:42" }]);
    expect(other[0].disposition).toBe("recorded");
  });

  it("refuses unsupported fields and unknown horses", async () => {
    const dispositions = await recordFieldClaims(db, 14701, [{ field_name: "precise_address", claimed_value: "secret", source_type: "import" }]);
    expect(dispositions[0].disposition).toBe("unsupported_field");
    await expectHttpError(recordFieldClaims(db, 99999, [{ field_name: "birth_year", claimed_value: 2000, source_type: "import" }]), 404, "not_found");
  });
});

describe("R146-D05 — the reviewer's case view + explicit decisions", () => {
  let db: D1Database;
  let editor: AuthedSession;
  let viewer: AuthedSession;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-editor", "editor");
    await seedUser(db, "r146-viewer", "user");
    editor = await makeSession(db, "r146-editor");
    viewer = await makeSession(db, "r146-viewer");
    await db.exec(`INSERT INTO horses(id,name_latin,birth_year,row_version) VALUES (14711,'Claimed Horse',2015,1)`);
    await db.exec(`INSERT INTO import_sources(id,name,issuer_namespace,scope_note,redistribution_allowed) VALUES(2,'Claim test agreement','claim-test','Synthetic fixture',1);
      INSERT INTO import_batches(id,source_id,file_name,file_sha256,mapping_version,created_by_user_id) VALUES(2,2,'claim.json','claim-fixture','v1','r146-editor');
      INSERT INTO import_staging_rows(id,batch_id,external_id,raw_json,normalized_json,row_checksum,row_action,horse_id) VALUES(9,2,'claim-row','{}','{}','claim-row','update',14711);`);
    await recordFieldClaims(db, 14711, [
      { field_name: "birth_year", claimed_value: 2012, source_type: "import", source_ref: "batch:2:row:9" },
    ]);
  });

  it("shows canonical + claims + decisions; gates on quality.read", async () => {
    const response = await adminHorseFieldClaims(authedRequest("/api/admin/horses/14711/field-claims", undefined, { session: editor }), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711);
    const body = await response.json() as { fields: Record<string, { canonical: string | null; claims: Array<{ id: number; claimed_value: string }> }>; decisions: unknown[] };
    expect(body.fields.birth_year.canonical).toBe("2015");
    expect(body.fields.birth_year.claims.length).toBe(1);
    expect(body.fields.birth_year.claims[0].claimed_value).toBe("2012");
    await expectHttpError(adminHorseFieldClaims(authedRequest("/api/admin/horses/14711/field-claims", undefined, { session: viewer }), { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711), 403);
  });

  it("selecting a claim applies the value, preserves the previous value, supersedes others", async () => {
    // A second pending claim for the same field from another source.
    const second = await recordFieldClaims(db, 14711, [{ field_name: "birth_year", claimed_value: 2014, source_type: "external_scrape", source_ref: "kasilor:7" }]);
    expect(second[0].disposition).toBe("recorded");
    const claimRow = await db.prepare("SELECT id FROM field_claims WHERE horse_id=14711 AND source_ref='batch:2:row:9'").first<{ id: number }>();
    const secondRow = await db.prepare("SELECT id FROM field_claims WHERE horse_id=14711 AND source_ref='kasilor:7'").first<{ id: number }>();
    const claimId = Number(claimRow?.id);
    // Select the first claim.
    const response = await adminSelectFieldClaim(
      authedRequest(`/api/admin/horses/14711/field-claims/${claimId}/select`, { reason: "Studbook certificate 2012 wins over the import spreadsheet" }, { session: editor }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711, claimId,
    );
    const body = await response.json() as { ok: boolean; previous_canonical: string | null };
    expect(body.ok).toBe(true);
    expect(body.previous_canonical).toBe("2015");
    const canonical = await db.prepare("SELECT birth_year FROM horses WHERE id=14711").first<{ birth_year: number }>();
    expect(canonical?.birth_year).toBe(2012); // applied through the shared path
    const statuses = await db.prepare("SELECT id,review_status FROM field_claims WHERE horse_id=14711 ORDER BY id").all();
    expect((statuses.results as Array<Record<string, unknown>>).map((row) => String(row.review_status))).toEqual(["selected", "pending"]);
    const decision = await db.prepare("SELECT decision,previous_canonical_json,applied_value,decided_by,reason FROM field_claim_decisions WHERE horse_id=14711 ORDER BY id DESC LIMIT 1").first<Record<string, unknown>>();
    expect(decision?.decision).toBe("select_claim");
    expect(JSON.parse(String(decision?.previous_canonical_json))).toEqual({ value: "2015" });
    expect(decision?.applied_value).toBe("2012");
    expect(decision?.decided_by).toBe("r146-editor");
    expect(String(decision?.reason)).toContain("Studbook");
    // Selecting the second claim supersedes the first.
    await adminSelectFieldClaim(
      authedRequest(`/api/admin/horses/14711/field-claims/${Number(secondRow?.id)}/select`, { reason: "Passport copy shows 2014" }, { session: editor }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711, Number(secondRow?.id),
    );
    const after = await db.prepare("SELECT review_status FROM field_claims WHERE id=?").bind(claimId).first<{ review_status: string }>();
    expect(after?.review_status).toBe("superseded");
    const canonicalAfter = await db.prepare("SELECT birth_year FROM horses WHERE id=14711").first<{ birth_year: number }>();
    expect(canonicalAfter?.birth_year).toBe(2014);
  });

  it("rejecting a claim keeps canonical and records the keep_canonical decision", async () => {
    await db.exec(`INSERT INTO horses(id,name_latin,birth_year) VALUES (14712,'Reject Horse',2010)`);
    await recordFieldClaims(db, 14712, [{ field_name: "birth_year", claimed_value: 2001, source_type: "owner_statement" }]);
    const claim = await db.prepare("SELECT id FROM field_claims WHERE horse_id=14712").first<{ id: number }>();
    const response = await adminRejectFieldClaim(
      authedRequest(`/api/admin/horses/14712/field-claims/${Number(claim?.id)}/reject`, { reason: "Owner statement contradicts the passport copy on file" }, { session: editor }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14712, Number(claim?.id),
    );
    const body = await response.json() as { ok: boolean; claim: { review_status: string } };
    expect(body.ok).toBe(true);
    expect(body.claim.review_status).toBe("rejected");
    const decision = await db.prepare("SELECT decision FROM field_claim_decisions WHERE horse_id=14712 ORDER BY id DESC LIMIT 1").first<{ decision: string }>();
    expect(decision?.decision).toBe("keep_canonical");
    const canonical = await db.prepare("SELECT birth_year FROM horses WHERE id=14712").first<{ birth_year: number }>();
    expect(canonical?.birth_year).toBe(2010);
  });

  it("a pedigree-cycle parent claim is refused by the SAME cycle guard as a direct edit", async () => {
    await db.exec(`INSERT INTO horses(id,name_latin,birth_year) VALUES (14713,'Cycle Child',2018)`);
    await db.exec(`INSERT INTO horses(id,name_latin,birth_year) VALUES (14714,'Cycle Grandchild',2019)`);
    await db.exec(`UPDATE horses SET father_id=14714 WHERE id=14713`);
    // Claim: 14714's father becomes 14713 — a 2-cycle (each is the other's
    // father). The same acyclicity invariant a direct edit faces refuses it.
    await recordFieldClaims(db, 14714, [{ field_name: "father_id", claimed_value: 14713, source_type: "review" }]);
    const claim = await db.prepare("SELECT id FROM field_claims WHERE horse_id=14714").first<{ id: number }>();
    expect(claim).toBeTruthy();
    // The worker dispatcher would render this as an error response; the module
    // handler surfaces the SAME refusal (same status + code) a direct edit
    // with the same cycle would receive.
    await expectHttpError(
      adminSelectFieldClaim(
        authedRequest(`/api/admin/horses/14714/field-claims/${Number(claim?.id)}/select`, { reason: "Someone filed this claim" }, { session: editor }),
        { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14714, Number(claim?.id),
      ),
      400,
      "pedigree_cycle",
    );
  });

  it("reversing a selection restores the prior canonical value and the full audit trail", async () => {
    const claimRow = await db.prepare("SELECT id FROM field_claims WHERE horse_id=14711 AND source_ref='batch:2:row:9'").first<{ id: number }>();
    const claimId = Number(claimRow?.id);
    await adminSelectFieldClaim(
      authedRequest(`/api/admin/horses/14711/field-claims/${claimId}/select`, { reason: "Select 2012 for the reversal test" }, { session: editor }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711, claimId,
    );
    let canonical = await db.prepare("SELECT birth_year FROM horses WHERE id=14711").first<{ birth_year: number }>();
    expect(canonical?.birth_year).toBe(2012);
    const decision = await db.prepare("SELECT id FROM field_claim_decisions WHERE horse_id=14711 AND decision='select_claim' ORDER BY id DESC LIMIT 1").first<{ id: number }>();
    const response = await adminRevertFieldClaimDecision(
      authedRequest(`/api/admin/horses/14711/field-claims/decisions/${Number(decision?.id)}/revert`, { reason: "The certificate copy turned out to be a different horse" }, { session: editor }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711, Number(decision?.id),
    );
    const body = await response.json() as { ok: boolean; restored_value: string | null };
    expect(body.ok).toBe(true);
    expect(body.restored_value).toBe("2015");
    canonical = await db.prepare("SELECT birth_year FROM horses WHERE id=14711").first<{ birth_year: number }>();
    expect(canonical?.birth_year).toBe(2015); // consistent prior state restored
    const claimAfter = await db.prepare("SELECT review_status FROM field_claims WHERE id=?").bind(claimId).first<{ review_status: string }>();
    expect(claimAfter?.review_status).toBe("pending"); // claim re-reviewable, not lost
    const trail = await db.prepare("SELECT id,decision,reverted_by_decision_id FROM field_claim_decisions WHERE horse_id=14711 ORDER BY id").all();
    const rows = trail.results as Array<Record<string, unknown>>;
    expect(rows[rows.length - 2].decision === "select_claim" || rows[rows.length - 2].decision === "revert").toBe(true);
    // The reverted decision and its revert twin are the LAST two rows.
    expect(String(rows[rows.length - 2].decision)).toBe("select_claim");
    expect(String(rows[rows.length - 1].decision)).toBe("revert");
    expect(Number(rows[rows.length - 2].reverted_by_decision_id)).toBe(Number(rows[rows.length - 1].id));
    // Double revert is refused.
    await expectHttpError(adminRevertFieldClaimDecision(
      authedRequest(`/api/admin/horses/14711/field-claims/decisions/${Number(decision?.id)}/revert`, { reason: "Trying to revert twice" }, { session: editor }),
      { DB: db, SESSION_COOKIE_NAME: "hr_session" }, 14711, Number(decision?.id),
    ), 409, "already_reverted");
  });

  it("the cross-registry queue lists claims with counts and gates on quality.read", async () => {
    const response = await adminFieldClaimQueue(authedRequest("/api/admin/field-claims", undefined, { session: editor }), { DB: db, SESSION_COOKIE_NAME: "hr_session" });
    const body = await response.json() as { claims: Array<{ horse_id: number; horse_name: string | null }>; counts: Record<string, number> };
    expect(body.claims.length).toBeGreaterThanOrEqual(1);
    expect(body.claims[0].horse_name).toBeTruthy();
    expect(body.counts.pending).toBeGreaterThanOrEqual(1);
    await expectHttpError(adminFieldClaimQueue(authedRequest("/api/admin/field-claims", undefined, { session: viewer }), { DB: db, SESSION_COOKIE_NAME: "hr_session" }), 403);
  });
});

describe("R146-D05 — external refresh protection on the import fill-once path", () => {
  let db: D1Database;
  let editor: AuthedSession;
  let sourceId: number;
  let batchId: number;

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r146-editor", "editor");
    editor = await makeSession(db, "r146-editor");
    await db.exec(`INSERT INTO horses(id,name_latin,name_native,birth_year,breed_desc,sex_desc,row_version) VALUES
      (14721,'Reviewed Horse','اسب بررسی‌شده',2015,'Persian','Mare',1)`);
    await db.exec(`INSERT INTO import_sources(name,issuer_namespace,scope_note,is_synthetic,redistribution_allowed) VALUES('R146 Claims Source','r146-claims','Refresh of an external studbook export',0,1)`);
    const source = await db.prepare("SELECT id FROM import_sources WHERE issuer_namespace='r146-claims'").first<{ id: number }>();
    sourceId = Number(source?.id);
    await db.exec(`INSERT INTO import_batches(source_id,file_name,file_sha256,mapping_version,status,rows_total,created_by_user_id) VALUES(${sourceId},'claims-batch.csv','sha256-r146-claims','v1','staged',1,'r146-editor')`);
    const batch = await db.prepare("SELECT id FROM import_batches WHERE file_name='claims-batch.csv'").first<{ id: number }>();
    batchId = Number(batch?.id);
    // A refresh of an external source carrying a DIFFERENT birth year + breed
    // for an existing horse: fill-once refuses the overwrite; D05 retains the
    // competing values as claims instead of silently dropping them.
    await db.prepare(
      `INSERT INTO import_staging_rows(batch_id,external_id,row_action,horse_id,raw_json,normalized_json,row_checksum)
       VALUES(?,?,?,?,?,?,?)`,
    ).bind(
      batchId, "ext-14721", "update", 14721,
      JSON.stringify({ external_id: "ext-14721", name_latin: "Reviewed Horse", birth_year: 2013, breed: "Part Bred" }),
      JSON.stringify({ external_id: "ext-14721", name_latin: "Reviewed Horse", birth_year: 2013, breed: "Part Bred" }),
      "checksum-14721",
    ).run();
  });

  it("a refreshed import records competing values as claims; canonical stays untouched", async () => {
    const response = await worker.fetch(
      authedRequest(`/api/admin/imports/batches/${batchId}/apply`, {}, { session: editor }),
      makeEnv(db),
    );
    expect(response.status).toBe(200);
    const canonical = await db.prepare("SELECT birth_year,breed_desc,name_latin FROM horses WHERE id=14721").first<{ birth_year: number; breed_desc: string | null; name_latin: string }>();
    expect(canonical?.birth_year).toBe(2015); // fill-once protection held
    expect(canonical?.breed_desc).toBe("Persian");
    const claims = await db.prepare("SELECT field_name,claimed_value,source_type,source_ref FROM field_claims WHERE horse_id=14721 ORDER BY field_name").all();
    const rows = claims.results as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2); // birth_year + breed_desc, NOT the matching name
    const byField = new Map(rows.map((row) => [String(row.field_name), row]));
    expect(byField.get("birth_year")?.claimed_value).toBe("2013");
    expect(byField.get("breed_desc")?.claimed_value).toBe("Part Bred");
    expect(byField.get("birth_year")?.source_type).toBe("import");
    expect(String(byField.get("birth_year")?.source_ref)).toContain(`batch:${batchId}`);
    // The staging row completed as an update (the fill of nothing is a no-op update).
    const staging = await db.prepare("SELECT outcome FROM import_staging_rows WHERE batch_id=?").bind(batchId).first<{ outcome: string }>();
    expect(staging?.outcome).toBe("applied_update");
  });
});
