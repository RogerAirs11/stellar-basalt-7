import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R144-D01 + D02 (Master-AI plan) — REAL database journey tests:
 *  D01: a horse-scoped professional grant (`private_health_read`) is the only
 *       non-staff path to private health results; expiry + revocation take
 *       effect on the next request; staff-private evidence fields never leak.
 *  D02: disclosure changes are versioned publication decisions; a stale
 *       expected_version cannot overwrite a newer withdrawal; the explainable
 *       history reads back; the legacy boolean stays materialized for the
 *       SQL boundaries (pairing projection, attestation listing, dossiers).
 */

const limiter = { limit: async () => ({ success: true }) };
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, method?: string) {
  return (workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> }).fetch(
    authedRequest(path, body, { session, method }),
    {
      APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", DB: db, SESSION_COOKIE_NAME: "hr_session",
      ASSETS: { fetch: async () => new Response("unused") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
      EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
    },
  );
}

async function world() {
  const db = await openRealDatabase();
  await seedUser(db, "r144-editor", "editor");
  await seedUser(db, "r144-admin", "admin");
  await seedUser(db, "r144-vet", "user");
  await seedUser(db, "r144-vet-b", "user");
  await db.exec(`INSERT INTO horses(id,name_latin,sex_desc) VALUES(14401,'R144 fictional mare','Mare')`);
  await db.prepare(
    "INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,lab_accession,notes,public_disclosed) VALUES(144001,14401,'SCID','disease','N/SCID',1,'demo','PRIVATE-ACCESSION-144','PRIVATE-NOTE-144',0)",
  ).run();
  // R148 publication is an explicit assignment, never an editor-role fallback.
  await db.prepare(`INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,professional_kind,permissions,authority_ref,assignment_ref,basis,granted_by_user_id,valid_from)
    VALUES('r144-publisher',14401,'r144-editor','federation_official','genetic_publish','SYNTHETIC-AUTHORITY','SYNTHETIC-PUBLICATION','admin_grant','r144-admin','2020-01-01')`).run();
  return {
    db,
    editor: await makeSession(db, "r144-editor"),
    admin: await makeSession(db, "r144-admin"),
    vet: await makeSession(db, "r144-vet"),
    vetB: await makeSession(db, "r144-vet-b"),
  };
}

const grantBody = (extra: Record<string, unknown> = {}) => ({
  horse_id: 14401,
  grantee_user_id: "r144-vet",
  professional_kind: "veterinarian",
  permissions: ["private_health_read"],
  authority_ref: "VET-LICENSE-144",
  assignment_ref: "OWNER-REQUEST-144",
  basis: "owner_consent",
  basis_ref: "CONSENT-144",
  ...extra,
});

async function diseaseRowVisible(db: D1Database, session?: AuthedSession): Promise<{ visible: boolean; accession: string | null; note: string | null }> {
  const response = await call(db, "/api/horses/14401/genetics", undefined, session);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tests: Array<{ test_type: string; lab_accession: string | null; notes: string | null }> };
  const row = body.tests.find((test) => test.test_type === "SCID");
  return { visible: Boolean(row), accession: row?.lab_accession ?? null, note: row?.notes ?? null };
}

describe("R144-D01 professional grants: real HTTP + database", () => {
  it("an undisclosed health result stays private for anonymous, ordinary and ungranted viewers", async () => {
    const { db, vetB } = await world();
    expect((await diseaseRowVisible(db)).visible).toBe(false);
    expect((await diseaseRowVisible(db, vetB)).visible).toBe(false);
  });

  it("a granted veterinarian reads the health RESULT but never the staff-private evidence fields", async () => {
    const { db, admin, vet } = await world();
    const created = await call(db, "/api/admin/professional-grants", grantBody(), admin);
    expect(created.status).toBe(201);
    const view = await diseaseRowVisible(db, vet);
    expect(view.visible).toBe(true);
    // D01 doctrine: the professional path never unlocks accession/notes.
    expect(view.accession).toBeNull();
    expect(view.note).toBeNull();
  });

  it("expiry and revocation take effect on the very next request", async () => {
    const { db, admin, vet } = await world();
    const created = (await (await call(db, "/api/admin/professional-grants", grantBody(), admin)).json()) as { grant: { id: string } };
    expect((await diseaseRowVisible(db, vet)).visible).toBe(true);
    // Revoke → the next request sees nothing.
    const revoked = await call(db, `/api/admin/professional-grants/${created.grant.id}/revoke`, { reason: "Assignment completed; access no longer needed" }, admin);
    expect(revoked.status).toBe(200);
    expect((await diseaseRowVisible(db, vet)).visible).toBe(false);
    // Double revoke is a clean 409.
    expect((await call(db, `/api/admin/professional-grants/${created.grant.id}/revoke`, { reason: "A second revoke attempt" }, admin)).status).toBe(409);
    // Expired grants contribute nothing even before revocation.
    await call(db, "/api/admin/professional-grants", grantBody({ valid_until: "2026-01-02T00:00:00Z" }), admin);
    expect((await diseaseRowVisible(db, vet)).visible).toBe(false);
    expect(await countRows(db, "audit_events", "action='professional.grant.revoke'")).toBe(1);
  });

  it("rejects invalid grants: unknown vet kind, missing grantee, bad validity, unknown grantee", async () => {
    const { db, admin, vet } = await world();
    expect((await call(db, "/api/admin/professional-grants", grantBody({ professional_kind: "wizard" }), admin)).status).toBe(400);
    expect((await call(db, "/api/admin/professional-grants", grantBody({ grantee_user_id: null }), admin)).status).toBe(400);
    expect((await call(db, "/api/admin/professional-grants", grantBody({ grantee_user_id: "r144-vet", permissions: ["horse.edit"] }), admin)).status).toBe(400);
    expect((await call(db, "/api/admin/professional-grants", grantBody({ valid_from: "2026-06-01T00:00:00Z", valid_until: "2026-01-01T00:00:00Z" }), admin)).status).toBe(422);
    expect((await call(db, "/api/admin/professional-grants", grantBody({ grantee_user_id: "ghost-user" }), admin)).status).toBe(404);
    // An ordinary account cannot mint grants.
    expect((await call(db, "/api/admin/professional-grants", grantBody(), vet)).status).toBe(403);
  });
});

describe("R144-D02 publication decisions: real HTTP + database", () => {
  it("publish → withdraw with versioned decisions; the legacy boolean stays materialized", async () => {
    const { db, editor, vet } = await world();
    const publish = await call(db, "/api/admin/genetic-tests/144001/disclosure", { expected_decision_version: 0, public_disclosed: true, basis: "owner_consent", reason: "Owner signed the publication consent for this result", purpose: "breeding-advice", evidence_ref: "CONSENT-144" }, editor);
    expect(publish.status).toBe(200);
    const publishBody = (await publish.json()) as { changed: boolean; decision: { decision_version: number; decision: string } | null; decision_version: number };
    expect(publishBody.changed).toBe(true);
    expect(publishBody.decision?.decision_version).toBe(1);
    expect(publishBody.decision?.decision).toBe("publish");
    // Anonymous viewers now see the disclosed row.
    expect((await diseaseRowVisible(db)).visible).toBe(true);
    // Withdraw at the CURRENT version.
    const withdraw = await call(db, "/api/admin/genetic-tests/144001/disclosure", { public_disclosed: false, expected_decision_version: 1, basis: "staff_publication", reason: "Owner withdrew the consent; publication must stop" }, editor);
    expect(withdraw.status).toBe(200);
    const withdrawBody = (await withdraw.json()) as { decision: { decision_version: number; decision: string } | null };
    expect(withdrawBody.decision?.decision_version).toBe(2);
    expect(withdrawBody.decision?.decision).toBe("withdraw");
    // The materialized boolean feeds the SQL boundaries: the public read hides the row again immediately.
    expect((await diseaseRowVisible(db)).visible).toBe(false);
    // A granted professional also loses the (now withdrawn-and-republished?) row:
    // disclosure only matters for anonymous; the vet path needs the grant — none was created in this test.
    expect((await diseaseRowVisible(db, vet)).visible).toBe(false);
    // The materialized column reflects the withdrawal for the SQL-boundary readers.
    const stored = await db.prepare("SELECT public_disclosed FROM genetic_tests WHERE id=144001").first<{ public_disclosed: number }>();
    expect(Number(stored?.public_disclosed ?? 0)).toBe(0);
  });

  it("a stale expected_decision_version is rejected 409 and never overwrites a newer withdrawal", async () => {
    const { db, editor } = await world();
    await call(db, "/api/admin/genetic-tests/144001/disclosure", { expected_decision_version: 0, public_disclosed: true, evidence_ref: "CONSENT-144", purpose: "breeding-advice", basis: "owner_consent", reason: "First publication consent" }, editor);
    await call(db, "/api/admin/genetic-tests/144001/disclosure", { public_disclosed: false, expected_decision_version: 1, basis: "staff_publication", reason: "Withdrawal lands first" }, editor);
    const stale = await call(db, "/api/admin/genetic-tests/144001/disclosure", { public_disclosed: true, evidence_ref: "CONSENT-144", purpose: "breeding-advice", expected_decision_version: 1, basis: "owner_consent", reason: "Stale client trying to republish over the withdrawal" }, editor);
    expect(stale.status).toBe(409);
    const stored = await db.prepare("SELECT public_disclosed FROM genetic_tests WHERE id=144001").first<{ public_disclosed: number }>();
    expect(Number(stored?.public_disclosed ?? 0)).toBe(0);
    expect(await countRows(db, "publication_decisions")).toBe(2);
    // No decision row was appended by the losing writer.
    expect(await countRows(db, "publication_decisions", "decision='publish'")).toBe(1);
  });

  it("repeats are clean no-ops that append nothing (idempotent replays)", async () => {
    const { db, editor } = await world();
    const first = (await (await call(db, "/api/admin/genetic-tests/144001/disclosure", { expected_decision_version: 0, public_disclosed: true, evidence_ref: "CONSENT-144", purpose: "breeding-advice", basis: "owner_consent", reason: "Publication consent" }, editor)).json()) as { changed: boolean };
    expect(first.changed).toBe(true);
    const repeat = (await (await call(db, "/api/admin/genetic-tests/144001/disclosure", { expected_decision_version: 1, public_disclosed: true, evidence_ref: "CONSENT-144", purpose: "breeding-advice", basis: "owner_consent", reason: "Exact replay of the same publication consent" }, editor)).json()) as { changed: boolean; note?: string };
    expect(repeat.changed).toBe(false);
    expect(repeat.note).toBe("Disclosure state already set");
    expect(await countRows(db, "publication_decisions")).toBe(1);
    // A short reason is rejected before anything is written.
    expect((await call(db, "/api/admin/genetic-tests/144001/disclosure", { expected_decision_version: 0, public_disclosed: false, basis: "staff_publication", reason: "no" }, editor)).status).toBe(400);
  });

  it("the decision history is explainable: who, which basis, which version", async () => {
    const { db, editor } = await world();
    await call(db, "/api/admin/genetic-tests/144001/disclosure", { expected_decision_version: 0, public_disclosed: true, basis: "owner_consent", purpose: "breeding-advice", evidence_ref: "CONSENT-144A", reason: "Publication consent" }, editor);
    await call(db, "/api/admin/genetic-tests/144001/disclosure", { public_disclosed: false, expected_decision_version: 1, basis: "staff_publication", reason: "Consent withdrawn" }, editor);
    const historyResponse = await call(db, "/api/admin/genetic-tests/144001/disclosure", undefined, editor);
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      effective: { disclosed: boolean; source: string; latest_version: number | null; materialized_matches: boolean };
      decisions: Array<{ decision: string; decision_version: number; basis: string; actor_user_id: string; purpose: string | null }>;
    };
    expect(history.effective).toMatchObject({ disclosed: false, source: "decision_log", latest_version: 2, materialized_matches: true });
    expect(history.decisions).toHaveLength(2);
    expect(history.decisions[0]).toMatchObject({ decision: "publish", decision_version: 1, basis: "owner_consent", actor_user_id: "r144-editor", purpose: "breeding-advice" });
    expect(history.decisions[1]).toMatchObject({ decision: "withdraw", decision_version: 2 });
  });

  it("legacy rows without decision history keep the compatibility reader behavior", async () => {
    const { db, editor } = await world();
    // A row published BEFORE 0106 carries only the legacy boolean.
    await db.prepare(
      "INSERT INTO genetic_tests(id,horse_id,test_type,test_category,result,verified,provenance,public_disclosed) VALUES(144002,14401,'CA','disease','N/CA',1,'demo',1)",
    ).run();
    const historyResponse = await call(db, "/api/admin/genetic-tests/144002/disclosure", undefined, editor);
    const history = (await historyResponse.json()) as { effective: { disclosed: boolean; source: string; latest_version: number | null } };
    expect(history.effective).toMatchObject({ disclosed: true, source: "legacy_boolean", latest_version: null });
    // The next decision starts at version 1 and takes precedence from then on.
    const withdraw = await call(db, "/api/admin/genetic-tests/144002/disclosure", { expected_decision_version: 0, public_disclosed: false, basis: "staff_publication", reason: "Legacy row withdrawn under the versioned path" }, editor);
    expect(withdraw.status).toBe(200);
    const after = (await (await call(db, "/api/admin/genetic-tests/144002/disclosure", undefined, editor)).json()) as { effective: { disclosed: boolean; source: string; latest_version: number | null } };
    expect(after.effective).toMatchObject({ disclosed: false, source: "decision_log", latest_version: 1 });
  });
});
