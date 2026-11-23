import { describe, expect, it } from "vitest";
import {
  adminPlaceServiceRequestHold, adminReleaseServiceRequestHold, adminApproveRetentionPolicy,
  adminListRetentionPolicies, fileSubjectRedactionRequest, adminRedactionRequestQueue,
  adminDecideRedactionRequest,
} from "../../src/api/modules/serviceRequests";
import { serviceRetentionSweep, RETENTION_DAYS } from "../../src/services/privacy";
import { getEffectiveRetentionPolicy } from "../../src/services/privacyPolicy";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

/**
 * R98-N09 acceptance — operator-approved privacy/holds/retention operation.
 *
 * Acceptance under test (from the reviewed N09 ticket):
 *  1. A hold committed BEFORE the mutation prevents erasure even when the
 *     record was selected earlier; release replay produces no second success
 *     audit (operation receipts, unique release_operation_id).
 *  2. Already-redacted legacy rows do not retain prohibited contact/location
 *     data indefinitely; missing legacy digests are NEVER fabricated.
 *  3. An interrupted job resumes without fabricating a digest, losing hold
 *     history or sending a withdrawn inquiry (bounded chunks, per-record
 *     compare-and-set atomicity).
 *  4. The operator approves retention intervals by data category; inherited
 *     numeric defaults are reported as assumptions until approved.
 *  5. A direct subject redaction request against an active hold is recorded
 *     and DEFERRED (never silently executed, never dropped); a grant never
 *     bypasses a hold — the hold must be released through its own audited
 *     path first.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function world(db: D1Database, requester = "req-n09") {
  await seedUser(db, requester, "user");
  await seedUser(db, "provider-user", "user");
  await seedUser(db, "admin-1", "admin");
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'N09 Provider');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('provider-user',1,'verified');
  `);
  return {
    requester: await makeSession(db, requester),
    provider: await makeSession(db, "provider-user"),
    admin: await makeSession(db, "admin-1"),
  };
}

async function agedTerminalLead(db: D1Database, id: number, daysOld = 400, requester = "req-n09") {
  await db.exec(`
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,created_at,updated_at,closed_at)
    VALUES(${id},'${requester}',1,'trainer','IR-23','N09 city','N09 private note ${id}',1,'closed',
      datetime('now','-${daysOld} days'),datetime('now','-${daysOld} days'),datetime('now','-${daysOld} days'));
  `);
}

async function sha256Hex(text: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("R98-N09 acceptance 4 — operator-approved retention intervals", () => {
  it("the inherited default is reported as an assumption until an operator approval exists", async () => {
    const db = await openRealDatabase();
    const effective = await getEffectiveRetentionPolicy(db, "service_request_terminal", RETENTION_DAYS);
    expect(effective.source).toBe("inherited_default");
    expect(effective.retention_days).toBe(365);
    expect(effective.policy_version).toBeNull();
  });

  it("an approval replaces the inherited default, is versioned, and governs the sweep", async () => {
    const db = await openRealDatabase();
    const w = await world(db);
    // A lead 100 days old: NOT eligible under the 365-day inherited default,
    // eligible under a 30-day approved policy.
    await agedTerminalLead(db, 500, 100);
    const inherited = await serviceRetentionSweep(db, new Date().toISOString());
    expect(inherited.policy_source).toBe("inherited_default");
    expect(inherited.minimized_requests).toBe(0);

    const approve = await adminApproveRetentionPolicy(authedRequest("/api/admin/privacy/retention-policies", {
      data_category: "service_request_terminal", retention_days: 30,
      consent_withdrawal_behavior: "Withdrawal stops all future disclosure immediately; pending optional notices are suppressed.",
      hold_authority: "Only active platform administrators may place or release dispute/legal holds, always with an audited reason.",
      release_requirements: "Release requires a substantive operator reason; the release receipt is unique and audited.",
    }, { session: w.admin }), env(db));
    expect(approve.status).toBe(201);
    const approved = await serviceRetentionSweep(db, new Date().toISOString());
    expect(approved.policy_source).toBe("operator_approved");
    expect(approved.policy_version).toBe(1);
    expect(approved.retention_days).toBe(30);
    expect(approved.minimized_requests).toBe(1);

    // A second approval RETIRES v1 (history preserved) and installs v2.
    const reapprove = await adminApproveRetentionPolicy(authedRequest("/api/admin/privacy/retention-policies", {
      data_category: "service_request_terminal", retention_days: 60,
      consent_withdrawal_behavior: "Withdrawal remains immediate and one-way for future disclosure.",
      hold_authority: "Active platform administrators only; audited reasons required as before.",
      release_requirements: "Release requires a substantive reason and produces a unique audited receipt.",
    }, { session: w.admin }), env(db));
    expect(reapprove.status).toBe(201);
    const list = await (await adminListRetentionPolicies(authedRequest("/api/admin/privacy/retention-policies", undefined, { session: w.admin }), env(db))).json() as { policies: { status: string; policy_version: number }[]; effective_service_request_terminal: { retention_days: number; source: string } };
    expect(list.policies).toHaveLength(2);
    expect(list.policies.map((p) => p.status).sort()).toEqual(["approved", "retired"]);
    expect(list.effective_service_request_terminal).toMatchObject({ retention_days: 60, source: "operator_approved" });
    expect(await countRows(db, "privacy_retention_policies", "data_category='service_request_terminal' AND status='approved'")).toBe(1);
  });

  it("policy approval is admin-only and validated", async () => {
    const db = await openRealDatabase();
    const w = await world(db);
    await expect(adminApproveRetentionPolicy(authedRequest("/api/admin/privacy/retention-policies", {
      data_category: "service_request_terminal", retention_days: 30,
      consent_withdrawal_behavior: "Withdrawal stops future disclosure immediately.",
      hold_authority: "Active platform administrators only, audited.",
      release_requirements: "Release needs a substantive audited reason.",
    }, { session: w.provider }), env(db))).rejects.toMatchObject({ status: 403 });
    await expect(adminApproveRetentionPolicy(authedRequest("/api/admin/privacy/retention-policies", {
      data_category: "service_request_terminal", retention_days: 0,
      consent_withdrawal_behavior: "Withdrawal stops future disclosure immediately.",
      hold_authority: "Active platform administrators only, audited.",
      release_requirements: "Release needs a substantive audited reason.",
    }, { session: w.admin }), env(db))).rejects.toMatchObject({ status: 400 });
  });
});

describe("R98-N09 acceptance 1 — the hold race and the release receipt", () => {
  it("a hold committed between selection and mutation prevents erasure; the sweep reports it", async () => {
    const db = await openRealDatabase();
    const w = await world(db);
    await agedTerminalLead(db, 500);
    await agedTerminalLead(db, 501);
    // Interpose: when the sweep issues its FIRST mutation batch, the hold on
    // request 500 has ALREADY been committed (the real interleaving — the
    // candidate was selected earlier without the hold).
    let firstBatch = true;
    const realBatch = db.batch.bind(db);
    const holdStatements: D1PreparedStatement[] = [];
    // Build the hold statements through the same audited production path.
    const { placeServiceRequestHoldStatements } = await import("../../src/services/privacy");
    holdStatements.push(...placeServiceRequestHoldStatements(db, {
      requestId: 500, operatorUserId: "admin-1", holdKind: "legal_hold",
      reason: "Court order 1404/77 preserves this lead pending litigation.",
    }));
    const raced = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (firstBatch) {
              firstBatch = false;
              await realBatch(holdStatements); // the hold wins the race, for real
            }
            return realBatch(statements);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as D1Database;
    const summary = await serviceRetentionSweep(raced, new Date().toISOString());
    expect(summary.minimized_requests).toBe(1); // 501 minimized
    expect(summary.held_deferred).toBe(1); // 500 rechecked and skipped
    const row = await db.prepare("SELECT note, retention_minimized_at FROM service_requests WHERE id=500").first<{ note: string; retention_minimized_at: string | null }>();
    expect(row?.note).toContain("N09 private note 500");
    expect(row?.retention_minimized_at).toBeNull();
  });

  it("release replay produces no second success audit (unique operation receipt)", async () => {
    const db = await openRealDatabase();
    const w = await world(db);
    await agedTerminalLead(db, 500);
    const hold = await adminPlaceServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold", {
      hold_kind: "dispute", reason: "Requester disputes provider conduct; evidence preserved.",
    }, { session: w.admin }), env(db), 500);
    expect(hold.status).toBe(201);
    const release = await adminReleaseServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold/release", {
      release_reason: "Dispute resolved through the support queue; preservation lifted.",
    }, { session: w.admin }), env(db), 500);
    expect(release.status).toBe(200);
    // The REPLAY must refuse honestly and append nothing.
    await expect(adminReleaseServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold/release", {
      release_reason: "Replaying the same release must not produce a second audit.",
    }, { session: w.admin }), env(db), 500)).rejects.toMatchObject({ status: 409, code: "no_active_hold" });
    expect(await countRows(db, "audit_events", "action='service_request.hold_released'")).toBe(1);
    expect(await countRows(db, "service_request_holds", "released_at IS NOT NULL")).toBe(1);
  });
});

describe("R98-N09 acceptance 2 — legacy rows lose prohibited contact/location; no fabricated digests", () => {
  it("an already-redacted legacy row is minimized (contact/location cleared) and a missing digest is marked unavailable", async () => {
    const db = await openRealDatabase();
    await world(db);
    await agedTerminalLead(db, 500);
    // Legacy shape: note already redacted by the requester, digest absent
    // (not a 64-hex string), contact/location still present.
    await db.exec(`
      UPDATE service_requests SET note='[redacted by requester]', note_redacted_at=datetime('now','-10 days'),
        note_digest='legacy-placeholder', note_digest_status=NULL WHERE id=500;
    `);
    const summary = await serviceRetentionSweep(db, new Date().toISOString());
    expect(summary.minimized_requests).toBe(1);
    expect(summary.already_redacted).toBe(1);
    expect(summary.unavailable_evidence).toBe(1);
    const row = await db.prepare("SELECT note, note_digest, note_digest_status, province_code, city, share_contact FROM service_requests WHERE id=500")
      .first<{ note: string; note_digest: string | null; note_digest_status: string | null; province_code: string | null; city: string | null; share_contact: number }>();
    expect(row?.note).toBe("[retention: note minimized]");
    expect(row?.note_digest).toBeNull(); // NEVER fabricated
    expect(row?.note_digest_status).toBe("unavailable");
    expect(row?.province_code).toBeNull();
    expect(row?.city).toBeNull();
    expect(row?.share_contact).toBe(0);
  });
});

describe("R98-N09 acceptance 3 — an interrupted sweep resumes safely (bounded chunks)", () => {
  it("a mid-sweep interruption keeps committed chunks, and the resume completes without duplicate audits or fabricated digests", async () => {
    const db = await openRealDatabase();
    await world(db);
    // 12 candidates -> 2 chunks of 10 and 2 (RETENTION_SWEEP_CHUNK_CANDIDATES=10).
    const notes: string[] = [];
    for (let id = 500; id < 512; id += 1) {
      await agedTerminalLead(db, id);
      notes.push(`N09 private note ${id}`);
    }
    const realBatch = db.batch.bind(db);
    let batchCalls = 0;
    const interrupted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]> => {
            batchCalls += 1;
            if (batchCalls === 2) throw new Error("simulated adapter interruption between chunks");
            return realBatch(statements);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as D1Database;
    await expect(serviceRetentionSweep(interrupted, new Date().toISOString(), { limit: 12 })).rejects.toThrow("simulated adapter interruption");
    // Chunk 1 committed 10 minimizations before the interruption.
    expect(await countRows(db, "service_requests", "retention_minimized_at IS NOT NULL")).toBe(10);

    // The RESUME completes the remaining 2 — same real digests, exactly one
    // audit per request, no hold history touched, nothing re-sent.
    const resumed = await serviceRetentionSweep(db, new Date().toISOString(), { limit: 12 });
    expect(resumed.minimized_requests).toBe(2);
    expect(resumed.chunks).toBe(1);
    expect(await countRows(db, "service_requests", "retention_minimized_at IS NOT NULL")).toBe(12);
    expect(await countRows(db, "audit_events", "action='service_request.retention_minimized'")).toBe(12);
    for (let index = 0; index < 12; index += 1) {
      const row = await db.prepare("SELECT note_digest FROM service_requests WHERE id=?").bind(500 + index)
        .first<{ note_digest: string | null }>();
      expect(row?.note_digest).toBe(await sha256Hex(notes[index]!));
    }
  });

  it("statement splitting is bounded: every chunk stays inside the documented limit", async () => {
    const db = await openRealDatabase();
    await world(db);
    for (let id = 500; id < 509; id += 1) await agedTerminalLead(db, id);
    const realBatch = db.batch.bind(db);
    const seenSizes: number[] = [];
    const observed = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            seenSizes.push(statements.length);
            return realBatch(statements);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as D1Database;
    const summary = await serviceRetentionSweep(observed, new Date().toISOString(), { limit: 9 });
    expect(summary.chunks).toBe(1);
    expect(seenSizes).toEqual([36]); // 9 candidates x 4 statements, ONE atomic call
    const { RETENTION_SWEEP_CHUNK_CANDIDATES } = await import("../../src/services/privacy");
    expect(RETENTION_SWEEP_CHUNK_CANDIDATES * 4).toBeLessThanOrEqual(100); // real D1 batch headroom
  });
});

describe("R98-N09 acceptance 5 — subject redaction requests interact honestly with holds", () => {
  async function heldWorld(db: D1Database) {
    const w = await world(db);
    await agedTerminalLead(db, 500, 10); // recent: the sweep will NOT touch it
    const hold = await adminPlaceServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold", {
      hold_kind: "legal_hold", reason: "Court order 1404/9 preserves this lead's content pending litigation.",
    }, { session: w.admin }), env(db), 500);
    expect(hold.status).toBe(201);
    return w;
  }

  it("a redaction request against a held request is DEFERRED, not executed and not dropped", async () => {
    const db = await openRealDatabase();
    const w = await heldWorld(db);
    const filed = await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
      data_category: "service_request_notes",
      service_request_id: 500,
      request_note: "Please erase my lead's note content; the matter is concluded.",
    }, { session: w.requester }), env(db));
    expect(filed.status).toBe(201);
    const filedBody = await filed.json() as { status: string; note: string };
    expect(filedBody.status).toBe("deferred_active_hold");
    expect(filedBody.note).toContain("DEFERRED");
    // The data is intact under the hold — nothing was silently executed.
    const row = await db.prepare("SELECT note FROM service_requests WHERE id=500").first<{ note: string }>();
    expect(row?.note).toContain("N09 private note 500");
  });

  it("only the data subject (the requester) may reference a request; grants never bypass a hold", async () => {
    const db = await openRealDatabase();
    const w = await heldWorld(db);
    await expect(fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
      data_category: "service_request_notes", service_request_id: 500,
      request_note: "Trying to file a redaction request against someone else's lead.",
    }, { session: w.provider }), env(db))).rejects.toMatchObject({ status: 403, code: "not_data_subject" });

    await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
      data_category: "service_request_notes", service_request_id: 500,
      request_note: "Please erase my lead's note content; the matter is concluded.",
    }, { session: w.requester }), env(db));

    // Operator queue shows the deferral with the active-hold flag.
    const queue = await (await adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.admin }), env(db))).json() as {
      requests: { id: number; status: string; request_under_active_hold: boolean }[]; counts: { deferred_active_hold: number };
    };
    expect(queue.counts.deferred_active_hold).toBe(1);
    expect(queue.requests[0]!.status).toBe("deferred_active_hold");
    // R117-18 re-pin: the queue contract now carries a real boolean hold flag
    // (was SQLite's raw 0/1) — semantics unchanged.
    expect(queue.requests[0]!.request_under_active_hold).toBe(true);

    // A grant while the hold is ACTIVE is refused — release first.
    await expect(adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${queue.requests[0]!.id}/decide`, {
      decision: "grant", decision_note: "Granting erasure of the note content.",
    }, { session: w.admin }), env(db), queue.requests[0]!.id)).rejects.toMatchObject({ status: 409, code: "grant_blocked_by_hold" });

    // The audited release path, then the grant succeeds.
    const release = await adminReleaseServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold/release", {
      release_reason: "Litigation concluded; the preservation order is lifted.",
    }, { session: w.admin }), env(db), 500);
    expect(release.status).toBe(200);
    const granted = await adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${queue.requests[0]!.id}/decide`, {
      decision: "grant", decision_note: "Granting erasure of the note content after the hold release.",
    }, { session: w.admin }), env(db), queue.requests[0]!.id);
    expect(granted.status).toBe(200);
    const decided = await db.prepare("SELECT status FROM subject_redaction_requests WHERE id=?").bind(queue.requests[0]!.id).first<{ status: string }>();
    expect(decided?.status).toBe("granted");
    // The deferral + decision are both audited.
    expect(await countRows(db, "audit_events", "action='privacy.subject_redaction_requested'")).toBe(1);
    expect(await countRows(db, "audit_events", "action='privacy.subject_redaction_decided'")).toBe(1);
  });

  it("a redaction request without an active hold is received normally, and refusals carry a recorded reason", async () => {
    const db = await openRealDatabase();
    const w = await world(db);
    await agedTerminalLead(db, 500, 10);
    const filed = await fileSubjectRedactionRequest(authedRequest("/api/privacy/redaction-requests", {
      data_category: "service_request_contact_location",
      request_note: "Please erase the location data attached to my lead.",
    }, { session: w.requester }), env(db));
    expect(filed.status).toBe(201);
    const queue = await (await adminRedactionRequestQueue(authedRequest("/api/admin/privacy/redaction-requests", undefined, { session: w.admin }), env(db))).json() as {
      requests: { id: number; status: string; request_under_active_hold: boolean }[];
    };
    expect(queue.requests[0]!.status).toBe("received");
    expect(queue.requests[0]!.request_under_active_hold).toBe(false);
    const refused = await adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${queue.requests[0]!.id}/decide`, {
      decision: "refuse", decision_note: "Location context is required for the open dispute window; refused with reasons recorded.",
    }, { session: w.admin }), env(db), queue.requests[0]!.id);
    expect(refused.status).toBe(200);
    // A decided request is not decidable again.
    await expect(adminDecideRedactionRequest(authedRequest(`/api/admin/privacy/redaction-requests/${queue.requests[0]!.id}/decide`, {
      decision: "refuse", decision_note: "Trying to decide an already-decided request.",
    }, { session: w.admin }), env(db), queue.requests[0]!.id)).rejects.toMatchObject({ status: 409, code: "not_decidable" });
  });
});
