import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { currentAllocationProposalId } from "../helpers/refundProposal";
import {
  openRealDatabase, seedUser, makeSession, seedBillingPrices, createOrder, reserveAttempt, verifyOrder, countRows, authedRequest, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";
import { MAX_ACTIVE_STAFF_PER_COLLECTION } from "../../src/workspaces/mutationCommands";

/**
 * R97-N01: the repaired registry and business commands exercised through the
 * REAL Worker router over a REAL database (every migration applied, foreign
 * keys enforced). No SQL collector stands in for the database: every assertion
 * reads persisted rows — canonical columns, identifier rows, row versions,
 * counters, search-invalidation queue and audit facts after success AND after
 * refusal.
 *
 * The recurring R97 failure pattern this suite pins shut:
 *   a preliminary permission or state check fails, but later statements still
 *   performed work — or old evidence authorized a new action.
 * For every refusal here we assert the ABSENCE of secondary rows, counter
 * deltas, queued notices and audits claiming success.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only", // R102: these tests exercise the D1 test binding explicitly; implicit default is now supabase_full
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

async function call(db: D1Database, request: Request): Promise<Response> {
  return worker.fetch(request, makeEnv(db));
}

async function read<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function registratorWorld(db: D1Database) {
  await seedUser(db, "editor-1", "editor");
  await seedUser(db, "admin-1", "admin");
  await seedUser(db, "intruder", "user");
  const editor = await makeSession(db, "editor-1");
  const admin = await makeSession(db, "admin-1");
  const intruder = await makeSession(db, "intruder");
  return { editor, admin, intruder };
}

/** A canonical horse created through the real HTTP route (auto id). */
async function createHorseViaHttp(db: D1Database, session: AuthedSession, body: Record<string, unknown>): Promise<Response> {
  return call(db, authedRequest("/api/horses", body, { session }));
}

// ---------------------------------------------------------------------------
// A. Auto-ID create: horse + identifiers + counters + revision, atomically
// ---------------------------------------------------------------------------

describe("R97-N01 A. auto-ID horse create through real HTTP", () => {
  it("success: the horse, its LIVE identifiers, counters, revision and journal all land together", async () => {
    const db = await openRealDatabase();
    const { editor } = await registratorWorld(db);
    const countersBefore = await db.prepare("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").first<{ active_horse_count: number }>();
    const revisionBefore = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();

    const response = await createHorseViaHttp(db, editor, {
      name_latin: "R97 Atom One", register_no: "R97-A-001", microchip_no: "985141001122337",
      sex_desc: "stallion", birth_date: { value: "2020-04-15", precision: "day", calendar: "gregorian" }, breed_desc: "Arabian",
    });
    expect(response.status).toBe(201);
    const body = await read<{ horse: { id: number; name_latin: string } }>(response);
    const horseId = Number(body.horse.id);
    expect(horseId).toBeGreaterThan(0);

    // Exact canonical columns: the typed birth date expanded into value/precision/calendar
    // and synced the legacy birth_year bucket used by search/filters.
    const horse = await db.prepare(
      "SELECT name_latin, register_no, microchip_no, birth_date_value, birth_date_precision, birth_date_calendar, birth_year, row_version, last_mutation_id, is_dead FROM horses WHERE id=? AND deleted_at IS NULL",
    ).bind(horseId).first<Record<string, unknown>>();
    expect(horse?.name_latin).toBe("R97 Atom One");
    expect(horse?.birth_date_value).toBe("2020-04-15");
    expect(horse?.birth_date_precision).toBe("day");
    expect(horse?.birth_year).toBe(2020);
    expect(horse?.is_dead).toBe(0);
    expect(Number(horse?.row_version)).toBe(1);
    expect(String(horse?.last_mutation_id)).toMatch(/^[0-9a-f-]{36}$/);

    // The identifiers joined the SAME batch — attached by the operation identity,
    // never a last-insert-id assumption or a follow-up commit.
    const identifiers = await db.prepare(
      "SELECT kind, normalized_value, status, source_id FROM horse_identifiers WHERE horse_id=? ORDER BY kind",
    ).bind(horseId).all<{ kind: string; normalized_value: string; status: string; source_id: string }>();
    const kinds = (identifiers.results ?? []).map((r) => r.kind).sort();
    expect(kinds).toEqual(["microchip_no", "register_no"]);
    for (const row of identifiers.results ?? []) {
      expect(row.status).toBe("live");
      expect(row.source_id).toBe(`horse.create:${horse?.last_mutation_id}`);
    }

    // Counters and revision moved exactly once.
    const countersAfter = await db.prepare("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").first<{ active_horse_count: number }>();
    const revisionAfter = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();
    expect(Number(countersAfter?.active_horse_count)).toBe(Number(countersBefore?.active_horse_count) + 1);
    expect(Number(revisionAfter?.canonical_revision)).toBe(Number(revisionBefore?.canonical_revision) + 1);

    // The canonical mutation journal settled: committed, audit complete, search
    // complete — and the search invalidation was SERVICED (the queue drained by
    // the synchronous refresh, not left stale).
    const journal = await db.prepare(
      "SELECT status, audit_status, search_status FROM canonical_mutation_log WHERE entity_type='horse' AND entity_id=? ORDER BY created_at",
    ).bind(String(horseId)).all<{ status: string; audit_status: string; search_status: string }>();
    expect(journal.results).toHaveLength(1);
    expect(journal.results[0]?.status).toBe("committed");
    expect(journal.results[0]?.audit_status).toBe("complete");
    expect(journal.results[0]?.search_status).toBe("complete");
    expect(await countRows(db, "horse_search_reindex_queue", `horse_id=${horseId}`)).toBe(0);
  });

  it("duplicate auto-ID create: 409, and NO horse, identifier, counter delta, journal or audit survives", async () => {
    const db = await openRealDatabase();
    const { editor } = await registratorWorld(db);
    const first = await createHorseViaHttp(db, editor, { name_latin: "R97 Atom First", register_no: "R97-DUP-9", microchip_no: "985141001122338" });
    expect(first.status).toBe(201);

    const horsesBefore = await countRows(db, "horses");
    const identifiersBefore = await countRows(db, "horse_identifiers");
    const countersBefore = await db.prepare("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").first<{ active_horse_count: number }>();
    const revisionBefore = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();
    const journalBefore = await countRows(db, "canonical_mutation_log");
    const auditBefore = await countRows(db, "audit_events");

    // A second horse claiming the SAME live register number (auto id, same batch).
    // The preflight duplicate check answers duplicate_horse_identity; a race that
    // slips past it surfaces as duplicate_identifier from the guarded batch — both
    // are the honest 409 duplicate family, and NEITHER leaves partial state.
    const second = await createHorseViaHttp(db, editor, { name_latin: "R97 Atom Second", register_no: "R97-DUP-9" });
    expect(second.status).toBe(409);
    const body = await read<{ error: { code: string } }>(second);
    expect(body.error.code).toMatch(/^duplicate_(horse_identity|identifier)$/);

    // All-or-nothing: no partial horse, no identifier, no counter/revision movement,
    // no journal row and no audit claiming a success that did not happen.
    expect(await countRows(db, "horses")).toBe(horsesBefore);
    expect(await countRows(db, "horse_identifiers")).toBe(identifiersBefore);
    const countersAfter = await db.prepare("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").first<{ active_horse_count: number }>();
    const revisionAfter = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();
    expect(Number(countersAfter?.active_horse_count)).toBe(Number(countersBefore?.active_horse_count));
    expect(Number(revisionAfter?.canonical_revision)).toBe(Number(revisionBefore?.canonical_revision));
    expect(await countRows(db, "canonical_mutation_log")).toBe(journalBefore);
    expect(await countRows(db, "audit_events")).toBe(auditBefore);
  });

  it("an unauthorized role (plain user) cannot create: 403 with zero writes", async () => {
    const db = await openRealDatabase();
    const { intruder } = await registratorWorld(db);
    const horsesBefore = await countRows(db, "horses");
    const response = await createHorseViaHttp(db, intruder, { name_latin: "R97 Atom Forbidden", register_no: "R97-F-001" });
    expect(response.status).toBe(403);
    expect(await countRows(db, "horses")).toBe(horsesBefore);
    expect(await countRows(db, "horse_identifiers")).toBe(0);
    expect(await countRows(db, "audit_events")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Direct edit: version guard, cycle guard, search invalidation, audit
// ---------------------------------------------------------------------------

describe("R97-N01 B. direct horse edit through real HTTP", () => {
  async function worldWithHorse(db: D1Database) {
    const { editor, intruder } = await registratorWorld(db);
    const created = await createHorseViaHttp(db, editor, { name_latin: "R97 Edit Target", register_no: "R97-E-001", color_desc: "bay" });
    expect(created.status).toBe(201);
    const horse = await read<{ horse: { id: number } }>(created);
    return { editor, intruder, horseId: Number(horse.horse.id) };
  }

  it("success: value change bumps version, bumps revision, queues self reindex and writes an audit fact", async () => {
    const db = await openRealDatabase();
    const { editor, horseId } = await worldWithHorse(db);
    const revisionBefore = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();

    const response = await call(db, authedRequest(`/api/horses/${horseId}`, {
      expected_row_version: 1, changes: { color_desc: "grey" },
    }, { session: editor, method: "PUT" }));
    expect(response.status).toBe(200);

    const row = await db.prepare("SELECT color_desc, row_version FROM horses WHERE id=?").bind(horseId).first<{ color_desc: string; row_version: number }>();
    expect(row?.color_desc).toBe("grey");
    expect(Number(row?.row_version)).toBe(2);
    const revisionAfter = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();
    expect(Number(revisionAfter?.canonical_revision)).toBe(Number(revisionBefore?.canonical_revision) + 1);
    // The settled journal for THIS mutation: committed, audited, search serviced.
    const journal = await db.prepare(
      "SELECT status, audit_status, search_status FROM canonical_mutation_log WHERE entity_type='horse' AND entity_id=? ORDER BY created_at",
    ).bind(String(horseId)).all<{ status: string; audit_status: string; search_status: string }>();
    expect(journal.results).toHaveLength(2);
    expect(journal.results[1]?.status).toBe("committed");
    expect(journal.results[1]?.audit_status).toBe("complete");
    expect(journal.results[1]?.search_status).toBe("complete");
    expect(await countRows(db, "horse_search_reindex_queue", `horse_id=${horseId}`)).toBe(0);
  });

  it("stale expected_row_version: 409 edit_conflict, and the row, revision and queue are untouched", async () => {
    const db = await openRealDatabase();
    const { editor, horseId } = await worldWithHorse(db);
    // A concurrent edit moves the version to 2 first.
    const concurrent = await call(db, authedRequest(`/api/horses/${horseId}`, {
      expected_row_version: 1, changes: { color_desc: "black" },
    }, { session: editor, method: "PUT" }));
    expect(concurrent.status).toBe(200);
    const revisionBefore = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();

    // The stale writer still believes version 1.
    const stale = await call(db, authedRequest(`/api/horses/${horseId}`, {
      expected_row_version: 1, changes: { color_desc: "chestnut" },
    }, { session: editor, method: "PUT" }));
    expect(stale.status).toBe(409);
    const body = await read<{ error: { code: string } }>(stale);
    expect(body.error.code).toBe("edit_conflict");

    const row = await db.prepare("SELECT color_desc, row_version FROM horses WHERE id=?").bind(horseId).first<{ color_desc: string; row_version: number }>();
    expect(row?.color_desc).toBe("black");
    expect(Number(row?.row_version)).toBe(2);
    const revisionAfter = await db.prepare("SELECT canonical_revision FROM registry_state WHERE id=1").first<{ canonical_revision: number }>();
    expect(Number(revisionAfter?.canonical_revision)).toBe(Number(revisionBefore?.canonical_revision));
  });

  it("parentage cycle: refused BEFORE any write; the pedigree is unchanged", async () => {
    const db = await openRealDatabase();
    const { editor } = await registratorWorld(db);
    // father -> child chain; making the FATHER a child of his own child is a cycle.
    const father = await read<{ horse: { id: number } }>(await createHorseViaHttp(db, editor, { name_latin: "R97 Father", register_no: "R97-P-001" }));
    const mother = await read<{ horse: { id: number } }>(await createHorseViaHttp(db, editor, { name_latin: "R97 Mother", register_no: "R97-P-002" }));
    const child = await read<{ horse: { id: number } }>(await createHorseViaHttp(db, editor, {
      name_latin: "R97 Child", register_no: "R97-P-003", father_id: Number(father.horse.id), mother_id: Number(mother.horse.id),
    }));
    const fatherId = Number(father.horse.id);

    const response = await call(db, authedRequest(`/api/horses/${fatherId}`, {
      expected_row_version: 1, changes: { father_id: Number(child.horse.id) },
    }, { session: editor, method: "PUT" }));
    expect([400, 422, 409]).toContain(response.status);

    const row = await db.prepare("SELECT father_id, row_version FROM horses WHERE id=?").bind(fatherId).first<{ father_id: number | null; row_version: number }>();
    expect(row?.father_id).toBeNull();
    expect(Number(row?.row_version)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C. Reviewed edit: the same builder applies an approved change request
// ---------------------------------------------------------------------------

describe("R97-N01 C. reviewed edit (change request approval) through real HTTP", () => {
  it("an approved update_horse request applies through the shared guarded builder and queues the children on a parent rename", async () => {
    const db = await openRealDatabase();
    const { editor, admin } = await registratorWorld(db);
    // A parent with an existing child: a parent rename must queue the child too (T09).
    const parent = await read<{ horse: { id: number } }>(await createHorseViaHttp(db, editor, { name_latin: "R97 Renamed Parent", register_no: "R97-R-001" }));
    const child = await read<{ horse: { id: number } }>(await createHorseViaHttp(db, editor, {
      name_latin: "R97 Child Of Renamed", register_no: "R97-R-002", father_id: Number(parent.horse.id),
    }));
    const parentId = Number(parent.horse.id);
    const childId = Number(child.horse.id);

    // An editor proposes a rename through the reviewed path (owner/editor roles may propose).
    // submit:false keeps it a draft first — the full draft -> pending -> approved walk.
    const propose = await call(db, authedRequest("/api/change-requests", {
      horse_id: parentId, request_type: "update_horse", summary: "Correct the recorded name",
      items: [{ field_name: "name_latin", old_value: "R97 Renamed Parent", proposed_value: "R97 Parent Corrected" }],
      submit: false,
    }, { session: editor }));
    expect(propose.status).toBe(201);
    const proposal = await read<{ request: { id: string; status: string } }>(propose);
    expect(proposal.request.status).toBe("draft");

    // Submit for review, then approve as admin.
    const submit = await call(db, authedRequest(`/api/change-requests/${proposal.request.id}/submit`, {}, { session: editor }));
    expect(submit.status).toBe(200);
    const approve = await call(db, authedRequest(`/api/admin/change-requests/${proposal.request.id}/review`, {
      decision: "approved", note: "Evidence verified",
    }, { session: admin }));
    expect(approve.status).toBe(200);

    // The canonical row carries the approved rename and a bumped version.
    const row = await db.prepare("SELECT name_latin, row_version FROM horses WHERE id=?").bind(parentId).first<{ name_latin: string; row_version: number }>();
    expect(row?.name_latin).toBe("R97 Parent Corrected");
    expect(Number(row?.row_version)).toBe(2);
    // The reviewed apply used the SAME builder: the change request is decided,
    // the parent is queued AND the child is queued for search reindex (T09).
    const decided = await db.prepare("SELECT status FROM change_requests WHERE id=?").bind(proposal.request.id).first<{ status: string }>();
    expect(decided?.status).toBe("approved");
    expect(await countRows(db, "horse_search_reindex_queue", `horse_id=${parentId}`)).toBe(1);
    expect(await countRows(db, "horse_search_reindex_queue", `horse_id=${childId} AND reason='parent_name_changed'`)).toBe(1);
  });

  it("a MISSING review cannot authorize anything: approving an already-decided request is a 409, and a second apply never happens", async () => {
    const db = await openRealDatabase();
    const { editor, admin } = await registratorWorld(db);
    const horse = await read<{ horse: { id: number } }>(await createHorseViaHttp(db, editor, { name_latin: "R97 Once Only", register_no: "R97-O-001" }));
    const horseId = Number(horse.horse.id);

    const propose = await call(db, authedRequest("/api/change-requests", {
      horse_id: horseId, request_type: "update_horse", summary: "First proposal",
      items: [{ field_name: "color_desc", proposed_value: "grey" }],
    }, { session: editor }));
    const proposal = await read<{ request: { id: string } }>(propose);
    await call(db, authedRequest(`/api/change-requests/${proposal.request.id}/submit`, {}, { session: editor }));
    const approve = await call(db, authedRequest(`/api/admin/change-requests/${proposal.request.id}/review`, {
      decision: "approved", note: "ok",
    }, { session: admin }));
    expect(approve.status).toBe(200);

    // A SECOND approval of the decided request must not re-apply anything.
    const replay = await call(db, authedRequest(`/api/admin/change-requests/${proposal.request.id}/review`, {
      decision: "approved", note: "double approve",
    }, { session: admin }));
    expect(replay.status).toBe(409);
    const row = await db.prepare("SELECT color_desc, row_version FROM horses WHERE id=?").bind(horseId).first<{ color_desc: string; row_version: number }>();
    expect(row?.color_desc).toBe("grey");
    expect(Number(row?.row_version)).toBe(2); // exactly one apply
  });
});

// ---------------------------------------------------------------------------
// D. Refund allocation: the EXACT proposal identity authorizes the approval
// ---------------------------------------------------------------------------

describe("R97-N01 D. refund proposal/approval through real HTTP", () => {
  const env = (db: D1Database) => makeEnv(db);
  void env;

  async function paidRefundWorld(db: D1Database) {
    await seedUser(db, "buyer-1", "user");
    await seedUser(db, "owner-1", "admin");
    await seedBillingPrices(db);
    const order = (await createOrder(db, { buyer: "buyer-1", key: `r97-http-${crypto.randomUUID().slice(0, 8)}` }))!;
    const { attemptId } = await reserveAttempt(db, order.id, "buyer-1");
    await verifyOrder(db, order, attemptId as number, crypto.randomUUID(), new Date().toISOString());
    const buyer = await makeSession(db, "buyer-1");
    const operator = await makeSession(db, "owner-1");
    // The buyer requests the refund through the real route.
    const request = await call(db, authedRequest(`/api/billing/orders/${order.id}/refund-request`, { reason: "R97 HTTP integration: service did not meet expectations" }, { session: buyer }));
    expect(request.status).toBe(201);
    const body = await read<{ refund_request: { id: number } }>(request);
    return { refundId: Number(body.refund_request.id), buyer, operator };
  }

  it("propose -> approve the EXACT proposal -> the refund request carries the allocated amount; repeat and stale approvals refuse", async () => {
    const db = await openRealDatabase();
    const { refundId, operator } = await paidRefundWorld(db);

    // Operator computes the proposal (no override): a full unused interval proposes the full charge.
    const propose = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/propose`, {}, { session: operator }));
    expect(propose.status).toBe(200);
    const proposalBody = await read<{ allocation: { result: string; proposal: { proposed_amount_minor: number } | null; proposal_operation_id: string | null } }>(propose);
    expect(proposalBody.allocation.result).toBe("proposed");
    expect(proposalBody.allocation.proposal_operation_id).toBeTruthy();
    const exactAmount = Number(proposalBody.allocation.proposal?.proposed_amount_minor);
    expect(exactAmount).toBeGreaterThan(0);

    // The persisted proposal identity — read from the DATABASE, never manufactured.
    const persistedProposalId = await currentAllocationProposalId(db, refundId);
    expect(persistedProposalId).toBe(proposalBody.allocation.proposal_operation_id);

    // Approving with a WRONG (not persisted) proposal identity is refused.
    const wrongIdentity = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {
      proposal_operation_id: crypto.randomUUID(), amount_minor: exactAmount, currency: "IRR", note: "stale identity must not approve",
    }, { session: operator }));
    expect(wrongIdentity.status).toBe(409);
    // Nothing moved: the request is still only 'proposed'.
    expect((await db.prepare("SELECT allocation_status FROM refund_requests WHERE id=?").bind(refundId).first<{ allocation_status: string }>())?.allocation_status).toBe("proposed");

    // Approving the EXACT persisted proposal + amount succeeds.
    const approve = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {
      proposal_operation_id: persistedProposalId, amount_minor: exactAmount, currency: "IRR", note: "Approved against the immutable grant ledger",
    }, { session: operator }));
    expect(approve.status).toBe(200);
    const approved = await db.prepare("SELECT allocation_status, amount_minor FROM refund_requests WHERE id=?").bind(refundId).first<{ allocation_status: string; amount_minor: number }>();
    expect(approved?.allocation_status).toBe("approved");
    expect(Number(approved?.amount_minor)).toBe(exactAmount);

    // A REPEATED approval of the same (now consumed) proposal cannot double-approve.
    const replay = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {
      proposal_operation_id: persistedProposalId, amount_minor: exactAmount, currency: "IRR", note: "replay must refuse",
    }, { session: operator }));
    expect(replay.status).toBe(409);
    expect(Number((await db.prepare("SELECT amount_minor FROM refund_requests WHERE id=?").bind(refundId).first<{ amount_minor: number }>())?.amount_minor)).toBe(exactAmount);
  });

  it("a STALE same-amount proposal cannot be approved once a newer proposal replaced it", async () => {
    const db = await openRealDatabase();
    const { refundId, operator } = await paidRefundWorld(db);

    // First proposal (computed).
    const first = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/propose`, {}, { session: operator }));
    const firstBody = await read<{ allocation: { proposal: { proposed_amount_minor: number } | null; proposal_operation_id: string | null } }>(first);
    const staleProposalId = String(firstBody.allocation.proposal_operation_id);
    const amount = Number(firstBody.allocation.proposal?.proposed_amount_minor);

    // A SECOND proposal replaces the first (same amount, NEW proposal identity).
    const second = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/propose`, {}, { session: operator }));
    expect(second.status).toBe(200);
    const secondBody = await read<{ allocation: { proposal_operation_id: string | null } }>(second);
    expect(secondBody.allocation.proposal_operation_id).not.toBe(staleProposalId);

    // Approving the STALE proposal (same amount!) must refuse: the approval
    // must not silently transfer to a different proposal's evidence.
    const staleApproval = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {
      proposal_operation_id: staleProposalId, amount_minor: amount, currency: "IRR", note: "stale same-amount proposal",
    }, { session: operator }));
    expect(staleApproval.status).toBe(409);
    expect((await db.prepare("SELECT allocation_status FROM refund_requests WHERE id=?").bind(refundId).first<{ allocation_status: string }>())?.allocation_status).toBe("proposed");

    // The CURRENT proposal still approves cleanly.
    const currentId = await currentAllocationProposalId(db, refundId);
    const approve = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {
      proposal_operation_id: currentId, amount_minor: amount, currency: "IRR", note: "current proposal approves",
    }, { session: operator }));
    expect(approve.status).toBe(200);
  });

  it("a non-admin cannot propose or approve: 401/403 with no allocation rows", async () => {
    const db = await openRealDatabase();
    const { refundId, buyer } = await paidRefundWorld(db);
    const propose = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/propose`, {}, { session: buyer }));
    expect([401, 403]).toContain(propose.status);
    const approve = await call(db, authedRequest(`/api/admin/billing/refund-requests/${refundId}/allocation/approve`, {
      proposal_operation_id: crypto.randomUUID(), amount_minor: 1, currency: "IRR", note: "not an operator",
    }, { session: buyer }));
    expect([401, 403]).toContain(approve.status);
    expect(await countRows(db, "refund_allocations")).toBe(0);
    expect((await db.prepare("SELECT allocation_status FROM refund_requests WHERE id=?").bind(refundId).first<{ allocation_status: string }>())?.allocation_status).not.toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// E. Workspace commands: task lifecycle, staff seats, live authority
// ---------------------------------------------------------------------------

describe("R97-N01 E. workspace commands through real HTTP", () => {
  async function workspaceWorld(db: D1Database) {
    await seedUser(db, "ws-owner", "user");
    await seedUser(db, "ws-staff", "user");
    const owner = await makeSession(db, "ws-owner");
    const staff = await makeSession(db, "ws-staff");
    const created = await call(db, authedRequest("/api/workspaces", { name: "R97 HTTP Herd" }, { session: owner }));
    expect(created.status).toBe(201);
    const body = await read<{ workspace: { id: number } }>(created);
    return { owner, staff, workspaceId: Number(body.workspace.id) };
  }

  it("task create + complete over real HTTP: idempotent replay, next occurrence, honest audit", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await workspaceWorld(db);

    const create = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Farrier visit", category: "farrier", due_date: "2026-11-01", due_timezone: "Asia/Tehran",
      recurrence: "custom_days", recurrence_interval_days: 30,
    }, { session: owner }));
    expect(create.status).toBe(201);

    // The identical intent replays honestly (no duplicate; replay reports 200).
    const replay = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Farrier visit", category: "farrier", due_date: "2026-11-01", due_timezone: "Asia/Tehran",
      recurrence: "custom_days", recurrence_interval_days: 30,
    }, { session: owner }));
    expect(replay.status).toBe(200);
    const replayBody = await read<{ idempotent_replay: boolean }>(replay);
    expect(replayBody.idempotent_replay).toBe(true);
    expect(await countRows(db, "workspace_tasks")).toBe(1);

    const taskRow = await db.prepare("SELECT id, row_version, status, occurrence_key FROM workspace_tasks WHERE collection_id=?").bind(workspaceId).first<{ id: number; row_version: number; status: string; occurrence_key: string }>();
    expect(taskRow?.status).toBe("open");
    expect(String(taskRow?.occurrence_key)).toMatch(/^task:initial:[0-9a-f]{64}$/); // the R97 full-intent identity

    // Completing a recurring task materializes the next occurrence in the same batch.
    const complete = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/${taskRow?.id}/complete`, {
      expected_version: 1,
    }, { session: owner }));
    expect(complete.status).toBe(200);
    expect(await countRows(db, "workspace_tasks", "collection_id=" + workspaceId)).toBe(2);
    const next = await db.prepare("SELECT due_date, parent_task_id FROM workspace_tasks WHERE collection_id=? AND status='open'").bind(workspaceId).first<{ due_date: string; parent_task_id: number }>();
    expect(next?.parent_task_id).toBe(Number(taskRow?.id));
  });

  it("staff reactivation at full capacity is refused; the seat count never exceeds the cap", async () => {
    const db = await openRealDatabase();
    const { owner, staff, workspaceId } = await workspaceWorld(db);
    // The target staff was once assigned, then revoked: reactivation is a NEW seat.
    const firstAssign = await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "ws-staff", actions: "view" }, { session: owner }));
    expect(firstAssign.status).toBe(201);
    const revoke = await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff/ws-staff/revoke`, {}, { session: owner }));
    expect(revoke.status).toBe(200);

    // Fill EVERY seat (the revoked assignment holds none). Each assign comes
    // from a distinct actor address — the write-rate D1 window (30/min per
    // actor) is a real safeguard this suite does not intend to trip.
    for (let i = 0; i < MAX_ACTIVE_STAFF_PER_COLLECTION; i++) {
      await seedUser(db, `seat-${i}`, "user");
      const assign = await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: `seat-${i}`, actions: "view" }, { session: owner, headers: { "cf-connecting-ip": `203.0.113.${10 + i}` } }));
      expect(assign.status).toBe(201);
    }
    expect(await countRows(db, "workspace_staff_assignments", `collection_id=${workspaceId} AND status='active'`)).toBe(MAX_ACTIVE_STAFF_PER_COLLECTION);

    // Reactivating the revoked staff at capacity: refused, no seat leak.
    const reactivation = await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "ws-staff", actions: "view" }, { session: owner }));
    expect(reactivation.status).toBe(409);
    const body = await read<{ error: { code: string } }>(reactivation);
    expect(body.error.code).toBe("staff_capacity_reached");
    expect(await countRows(db, "workspace_staff_assignments", `collection_id=${workspaceId} AND status='active'`)).toBe(MAX_ACTIVE_STAFF_PER_COLLECTION);
    // The revoked assignment stays revoked (no silent resurrection).
    expect((await db.prepare("SELECT status FROM workspace_staff_assignments WHERE collection_id=? AND user_id='ws-staff' ORDER BY id DESC LIMIT 1").bind(workspaceId).first<{ status: string }>())?.status).toBe("revoked");
    void staff;
  });

  it("a deactivated owner loses write access live: task create refuses with NO partial task or notice", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await workspaceWorld(db);
    // The workspace exists and the owner created a task successfully before deactivation.
    const before = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "Before deactivation", category: "other", due_date: "2026-11-01",
    }, { session: owner }));
    expect(before.status).toBe(201);

    // Deactivate the ACCOUNT (current-state authority, not a cached role flag).
    await db.exec("UPDATE users SET is_active=0 WHERE id='ws-owner'");
    const refused = await call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks`, {
      title: "After deactivation", category: "other", due_date: "2026-11-01",
    }, { session: owner }));
    expect([401, 403, 404]).toContain(refused.status);
    // Exactly the one task from before; no notice was queued for the refused write.
    expect(await countRows(db, "workspace_tasks", `collection_id=${workspaceId}`)).toBe(1);
    expect(await countRows(db, "notification_outbox")).toBe(0);
  });
});
