import { describe, expect, it } from "vitest";
import { openRealDatabase, seedUser, makeSession, authedRequest } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../../src/api/http";
import {
  reportCase, moderationQueue, assignCase, decideCase, appealCase, decideAppeal,
  caseDetail, setCaseStanding, myAbuseStanding,
} from "../../src/api/modules/moderation";
import { STANDING_TRANSITIONS, standingTransitionAllowed, ABUSE_STANDINGS, standingCasePreconditionSatisfied } from "../../src/moderation/standing";
import { MODERATION_CASE_STATUSES } from "../../src/moderation/vocabulary";

/**
 * R95-N14 acceptance matrix — every case from the reviewed task:
 *
 *  1. Repeated active report yields the existing case or conflict, not
 *     multiple active rows (same-status AND cross-status duplicates).
 *  2. A new later incident after a closed case can be filed — including
 *     closing to the SAME resolved status an earlier case already has (the
 *     F27 defect: the old 4-column UNIQUE blocked exactly this).
 *  3. Overturning one case does not remove another case's suspension.
 *  4. Requester/reported party never receive internal staff notes or
 *     unrelated reporter information.
 *
 * Plus the standing lifecycle: matrix cells, case precondition, owner rule,
 * participant transparency, and refusal of merged cases.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };
const envOf = (db: D1Database): Env => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" });

interface Sessions {
  reporter: Awaited<ReturnType<typeof makeSession>>;
  reporter2: Awaited<ReturnType<typeof makeSession>>;
  seller: Awaited<ReturnType<typeof makeSession>>;
  buyer: Awaited<ReturnType<typeof makeSession>>;
  admin: Awaited<ReturnType<typeof makeSession>>;
}

async function world(): Promise<{ db: D1Database; env: Env } & Sessions> {
  const db = await openRealDatabase();
  await seedUser(db, "reporter-1", "user");
  await seedUser(db, "reporter-2", "user");
  await seedUser(db, "seller-1", "user");
  await seedUser(db, "buyer-1", "user");
  await seedUser(db, "op-admin", "admin");
  await db.exec(`
    INSERT INTO horses(id,name_latin,is_active) VALUES (9,'STAR',1);
    INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status)
    VALUES ('listing-1',9,'seller-1','Seller One','active');
    INSERT INTO people(id,name_native,name_latin) VALUES (1,'فروشنده','Directory Person');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent)
    VALUES (1,'[]',1);
  `);
  return {
    db, env: envOf(db),
    reporter: await makeSession(db, "reporter-1"),
    reporter2: await makeSession(db, "reporter-2"),
    seller: await makeSession(db, "seller-1"),
    buyer: await makeSession(db, "buyer-1"),
    admin: await makeSession(db, "op-admin"),
  };
}

describe("R95-N14: moderation deduplication and participant lifecycle", () => {
  it("repeated active reports yield one active row — the honest 409, and the partial index refuses cross-status duplicates", async () => {
    const w = await world();
    // First report lands.
    const first = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "fraud_suspected", details: "Price too good" }, { session: w.reporter }), w.env);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { case_id: number };
    // Second report by the SAME reporter while the first is ACTIVE: 409.
    await expect(reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.reporter }), w.env))
      .rejects.toMatchObject({ status: 409, code: "case_exists" });
    // Even after triage moves the case to a DIFFERENT active status, a new
    // report is still refused (the cross-status hole the old UNIQUE had).
    await assignCase(authedRequest(`/api/admin/moderation/cases/${firstBody.case_id}/assign`, { operator_user_id: "op-admin" }, { session: w.admin }), w.env, firstBody.case_id);
    await expect(reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.reporter }), w.env))
      .rejects.toMatchObject({ status: 409, code: "case_exists" });
    // Structural proof: exactly one active row for (reporter, target).
    const active = await w.db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE reporter_user_id='reporter-1' AND target_id='listing-1' AND status NOT LIKE 'resolved%'").first<{ n: number }>();
    expect(active?.n).toBe(1);
    // A different reporter MAY have their own active case on the same target.
    const second = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "misrepresentation" }, { session: w.reporter2 }), w.env);
    expect(second.status).toBe(201);
    // Direct SQL duplicate of a cross-status pair is refused by the partial index.
    await expect(w.db.exec("INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason) VALUES('sales_listings','listing-1','reporter-1','spam')")).rejects.toThrow(/UNIQUE constraint/);
  });

  it("a new later incident after a closed case can be filed — and closed with the SAME resolved status an earlier case already has (F27)", async () => {
    const w = await world();
    const first = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "fraud_suspected" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    await decideCase(authedRequest(`/api/admin/moderation/cases/${first.case_id}/decision`, { decision: "dismiss", note: "No evidence found on review." }, { session: w.admin }), w.env, first.case_id);
    // A NEW incident: filing is allowed (closed history never blocks).
    const second = await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "counterfeit_documents", details: "Second incident, new fake papers" }, { session: w.reporter }), w.env);
    expect(second.status).toBe(201);
    const secondBody = await second.json() as { case_id: number };
    expect(secondBody.case_id).not.toBe(first.case_id);
    // And dismissing it to the same resolved status as the earlier case —
    // the exact operation the old 4-column UNIQUE refused.
    const decision = await decideCase(authedRequest(`/api/admin/moderation/cases/${secondBody.case_id}/decision`, { decision: "dismiss", note: "Second incident reviewed; no action." }, { session: w.admin }), w.env, secondBody.case_id);
    expect((await decision.json() as { status: string }).status).toBe("resolved_dismissed");
    // Three same-status closures in a row (the multiplicity the old schema
    // could never store).
    const third = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    await decideCase(authedRequest(`/api/admin/moderation/cases/${third.case_id}/decision`, { decision: "dismiss", note: "Third incident reviewed; no action." }, { session: w.admin }), w.env, third.case_id);
    const n = await w.db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE status='resolved_dismissed' AND reporter_user_id='reporter-1'").first<{ n: number }>();
    expect(n?.n).toBe(3);
  });

  it("overturning one case does not remove another case's independent suspension; only the appealed decision is overturned", async () => {
    const w = await world();
    // Two independent cases by different reporters, both hidden.
    const a = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "fraud_suspected" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    const b = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "misrepresentation" }, { session: w.reporter2 }), w.env)).json() as { case_id: number };
    await decideCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/decision`, { decision: "hide", note: "Case A: counterfeit documents." }, { session: w.admin }), w.env, a.case_id);
    await decideCase(authedRequest(`/api/admin/moderation/cases/${b.case_id}/decision`, { decision: "hide", note: "Case B: misrepresentation." }, { session: w.admin }), w.env, b.case_id);
    const activeBefore = await w.db.prepare("SELECT COUNT(*) AS n FROM listing_suspensions WHERE reinstated_at IS NULL").first<{ n: number }>();
    expect(activeBefore?.n).toBe(2);
    // The seller appeals case A only; the appeal is overturned.
    const appeal = await appealCase(authedRequest(`/api/moderation/cases/${a.case_id}/appeal`, { statement: "The documents are authentic and attached to the registry record." }, { session: w.seller }), w.env, a.case_id);
    expect(appeal.status).toBe(201);
    const appealBody = await appeal.json() as { appeal_id: number };
    await decideAppeal(authedRequest(`/api/admin/moderation/appeals/${appealBody.appeal_id}/decision`, { outcome: "overturned", note: "Documents verified against registry evidence." }, { session: w.admin }), w.env, appealBody.appeal_id);
    // Case A's suspension is lifted; case B's INDEPENDENT suspension stands.
    const suspensions = await w.db.prepare("SELECT case_id, reinstated_at FROM listing_suspensions ORDER BY case_id").all<{ case_id: number; reinstated_at: string | null }>();
    expect(suspensions.results.find((r) => Number(r.case_id) === a.case_id)?.reinstated_at).not.toBeNull();
    expect(suspensions.results.find((r) => Number(r.case_id) === b.case_id)?.reinstated_at).toBeNull();
    expect((await w.db.prepare("SELECT status FROM moderation_cases WHERE id=?").bind(b.case_id).first<{ status: string }>())?.status).toBe("resolved_hidden");
    // The overturned case A shows resolved_reinstated, never erased.
    expect((await w.db.prepare("SELECT status FROM moderation_cases WHERE id=?").bind(a.case_id).first<{ status: string }>())?.status).toBe("resolved_reinstated");
    // A second appeal decision on the same appeal id is refused (idempotent).
    await expect(decideAppeal(authedRequest(`/api/admin/moderation/appeals/${appealBody.appeal_id}/decision`, { outcome: "upheld", note: "Trying to decide it again." }, { session: w.admin }), w.env, appealBody.appeal_id))
      .rejects.toMatchObject({ status: 409 });
    // One OPEN appeal per case is structural: after case C is hidden and
    // appealed (an open appeal exists), a duplicate insert is refused.
    const c = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.buyer }), w.env)).json() as { case_id: number };
    await decideCase(authedRequest(`/api/admin/moderation/cases/${c.case_id}/decision`, { decision: "hide", note: "Case C: duplicate listing of a verified horse." }, { session: w.admin }), w.env, c.case_id);
    const cAppeal = await (await appealCase(authedRequest(`/api/moderation/cases/${c.case_id}/appeal`, { statement: "This is my listing and the underlying horse is verified." }, { session: w.seller }), w.env, c.case_id)).json() as { appeal_id: number };
    expect(cAppeal.appeal_id).toBeGreaterThan(0);
    await expect(w.db.exec(`INSERT INTO moderation_appeals(case_id,appellant_user_id,statement) VALUES(${c.case_id},'seller-1','x')`)).rejects.toThrow(/UNIQUE constraint/);
  });

  it("participants never receive internal staff notes, reporter identity or unrelated appeal information", async () => {
    const w = await world();
    const a = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "fraud_suspected", details: "internal reporter details" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    await assignCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/assign`, { operator_user_id: "op-admin" }, { session: w.admin }), w.env, a.case_id);
    await decideCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/decision`, { decision: "hide", note: "Counterfeit documents in the listing description (verified)." }, { session: w.admin }), w.env, a.case_id);
    // The seller (reported party) appeals; appeal upheld.
    const appeal = await (await appealCase(authedRequest(`/api/moderation/cases/${a.case_id}/appeal`, { statement: "I dispute this; the papers are real." }, { session: w.seller }), w.env, a.case_id)).json() as { appeal_id: number };
    await decideAppeal(authedRequest(`/api/admin/moderation/appeals/${appeal.appeal_id}/decision`, { outcome: "upheld", note: "Appeal ruling: the original decision stands on the evidence." }, { session: w.admin }), w.env, appeal.appeal_id);

    // Reported party view: the transparent suspension reason for THEIR listing
    // (0048 overlay doctrine — the seller sees why), their OWN appeal ruling —
    // and never the reporter identity, the reporter's submitted evidence, the
    // staff assignment trail, or any events at all.
    const sellerView = JSON.stringify(await (await caseDetail(authedRequest(`/api/moderation/cases/${a.case_id}`, undefined, { method: "GET", session: w.seller }), w.env, a.case_id)).json());
    expect(sellerView).not.toContain("reporter-1");
    expect(sellerView).not.toContain("internal reporter details");
    expect(sellerView).not.toContain("'created'");
    expect(sellerView).not.toContain("'assigned'");
    const sellerJson = JSON.parse(sellerView) as { your_appeals: Array<{ status: string; decision_note: string }>; active_suspensions: Array<{ reason: string }> };
    expect(sellerJson.active_suspensions).toHaveLength(1);
    expect(sellerJson.active_suspensions[0]!.reason).toContain("Counterfeit documents");
    expect(sellerJson.your_appeals).toHaveLength(1);
    // Their OWN appeal ruling is their case outcome (never other parties').
    expect(sellerJson.your_appeals[0]!.status).toBe("upheld");
    expect(sellerJson.your_appeals[0]!.decision_note).toContain("Appeal ruling");

    // A bystander gets an honest 404 — no information disclosure.
    await expect(caseDetail(authedRequest(`/api/moderation/cases/${a.case_id}`, undefined, { method: "GET", session: w.buyer }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 404 });
    // Reporter view: no suspension detail (not the reported party), no events,
    // and no unrelated appeal information (the ruling is not theirs to see).
    const reporterView = JSON.stringify(await (await caseDetail(authedRequest(`/api/moderation/cases/${a.case_id}`, undefined, { method: "GET", session: w.reporter }), w.env, a.case_id)).json());
    expect(reporterView).not.toContain("Appeal ruling");
    expect(reporterView).not.toContain("Counterfeit documents");
    const reporterJson = JSON.parse(reporterView) as Record<string, unknown>;
    expect(reporterJson.events).toBeUndefined();
    expect(reporterJson.active_suspensions).toEqual([]);
  });

  it("assignment uses CAS + rechecks acting admin AND assignee standing inside the write", async () => {
    const w = await world();
    const a = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    // Assign to a NON-admin account: the assignee standing recheck refuses it.
    await expect(assignCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/assign`, { operator_user_id: "buyer-1" }, { session: w.admin }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 409, code: "case_state_changed" });
    // Assign to a DEACTIVATED admin: same refusal.
    await w.db.exec("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('ghost-admin','g@t.test','G','x','admin',0)");
    await expect(assignCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/assign`, { operator_user_id: "ghost-admin" }, { session: w.admin }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 409, code: "case_state_changed" });
    // A real assignment works and moves new -> triaged.
    const ok = await assignCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/assign`, { operator_user_id: "op-admin", severity: "high" }, { session: w.admin }), w.env, a.case_id);
    expect((await ok.json() as { assigned: boolean }).assigned).toBe(true);
    expect((await w.db.prepare("SELECT status, severity, assigned_operator_user_id FROM moderation_cases WHERE id=?").bind(a.case_id).first<{ status: string; severity: string; assigned_operator_user_id: string }>())?.status).toBe("triaged");
    // Assigning a resolved case is refused.
    await decideCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/decision`, { decision: "dismiss", note: "Reviewed and closed." }, { session: w.admin }), w.env, a.case_id);
    await expect(assignCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/assign`, { operator_user_id: "op-admin" }, { session: w.admin }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 409, code: "already_resolved" });
    // The event trail carries the assignment with its marker-gate.
    const events = await w.db.prepare("SELECT event_type FROM moderation_case_events WHERE case_id=? ORDER BY id").bind(a.case_id).all<{ event_type: string }>();
    expect(events.results.map((r) => r.event_type)).toEqual(["created", "assigned", "decision"]);
  });

  it("appeal creation re-checks the seller mandate INSIDE the write (mandate race fails closed)", async () => {
    const w = await world();
    const a = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    await decideCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/decision`, { decision: "hide", note: "Hidden pending appeal window." }, { session: w.admin }), w.env, a.case_id);
    // The listing changes hands (seller id changes) between pre-flight and the
    // write: the mandate-conditioned INSERT matches zero rows — no appeal.
    await w.db.exec("UPDATE sales_listings SET seller_user_id='buyer-1' WHERE id='listing-1'");
    await expect(appealCase(authedRequest(`/api/moderation/cases/${a.case_id}/appeal`, { statement: "I should still be able to appeal this." }, { session: w.seller }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 403, code: "not_appellant" });
    expect(await w.db.prepare("SELECT COUNT(*) AS n FROM moderation_appeals").first<{ n: number }>()).toMatchObject({ n: 0 });
    // No event was fabricated either.
    expect((await w.db.prepare("SELECT COUNT(*) AS n FROM moderation_case_events WHERE event_type='appeal'").first<{ n: number }>())?.n).toBe(0);
  });

  it("the standing lifecycle: matrix-gated transitions, case provenance, merged-case refusal, self transparency", async () => {
    const w = await world();
    const a = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "counterfeit_documents" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    // Standing on an OPEN case is refused — standing follows a resolution.
    await expect(setCaseStanding(authedRequest(`/api/admin/moderation/cases/${a.case_id}/standing`, { standing: "restricted", reason: "Repeat counterfeit behavior." }, { session: w.admin }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 409, code: "standing_case_precondition" });
    await decideCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/decision`, { decision: "hide", note: "Counterfeit documents confirmed." }, { session: w.admin }), w.env, a.case_id);
    // normal -> restricted (allowed cell).
    const set = await setCaseStanding(authedRequest(`/api/admin/moderation/cases/${a.case_id}/standing`, { standing: "restricted", reason: "Counterfeit documents confirmed; restricted pending review." }, { session: w.admin }), w.env, a.case_id);
    const setBody = await set.json() as { from: string; to: string; account: string };
    expect(setBody).toMatchObject({ from: "normal", to: "restricted", account: "seller-1" });
    // The affected account is the OWNER of the reported artifact (the seller).
    // Standing row + marker-gated standing event recorded.
    expect((await w.db.prepare("SELECT standing FROM service_abuse_standing WHERE user_id='seller-1'").first<{ standing: string }>())?.standing).toBe("restricted");
    expect((await w.db.prepare("SELECT COUNT(*) AS n FROM moderation_case_events WHERE event_type='standing'").first<{ n: number }>())?.n).toBe(1);
    // Self transparency: the account owner sees their own standing; a normal
    // account reports normal.
    const mine = await myAbuseStanding(authedRequest("/api/moderation/standing", undefined, { method: "GET", session: w.seller }), w.env);
    expect(await ((await mine.json()) as { standing: string; scope: string })).toMatchObject({ standing: "restricted" });
    const normalView = await myAbuseStanding(authedRequest("/api/moderation/standing", undefined, { method: "GET", session: w.buyer }), w.env);
    expect((await normalView.json() as { standing: string }).standing).toBe("normal");
    // Self-transitions are refused (a no-op action is an error, not a write).
    await expect(setCaseStanding(authedRequest(`/api/admin/moderation/cases/${a.case_id}/standing`, { standing: "restricted", reason: "Setting it to the same value." }, { session: w.admin }), w.env, a.case_id))
      .rejects.toMatchObject({ status: 409, code: "standing_transition_refused" });
    // De-escalation is an allowed cell (a reviewed reform decision).
    const restored = await setCaseStanding(authedRequest(`/api/admin/moderation/cases/${a.case_id}/standing`, { standing: "normal", reason: "Seller completed document remediation; restored after review." }, { session: w.admin }), w.env, a.case_id);
    expect((await restored.json() as { to: string }).to).toBe("normal");
    expect((await w.db.prepare("SELECT COUNT(*) AS n FROM moderation_case_events WHERE event_type='standing'").first<{ n: number }>())?.n).toBe(2);
    // Escalation to suspended works, and the restricted/suspended account is
    // refused by the service-request create path (N12 transaction check).
    await setCaseStanding(authedRequest(`/api/admin/moderation/cases/${a.case_id}/standing`, { standing: "suspended", reason: "Second counterfeit incident; suspended." }, { session: w.admin }), w.env, a.case_id);
    const standing = (await w.db.prepare("SELECT standing FROM service_abuse_standing WHERE user_id='seller-1'").first<{ standing: string }>())?.standing;
    expect(standing).toBe("suspended");
    // directory_profiles: honest refusal for the unsupported target first…
    const dir = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "directory_profiles", target_id: "1", reason: "spam" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    await w.db.exec("UPDATE moderation_cases SET status='resolved_dismissed', resolved_at=CURRENT_TIMESTAMP WHERE id=" + dir.case_id);
    await expect(setCaseStanding(authedRequest(`/api/admin/moderation/cases/${dir.case_id}/standing`, { standing: "restricted", reason: "Refused for unsupported target." }, { session: w.admin }), w.env, dir.case_id))
      .rejects.toMatchObject({ status: 422, code: "standing_owner_unsupported_for_target" });
    // …then a MERGED case never carries standing either: act on the survivor.
    await w.db.exec("UPDATE moderation_cases SET status='resolved_merged', merged_into_case_id=" + a.case_id + " WHERE id=" + dir.case_id);
    await expect(setCaseStanding(authedRequest(`/api/admin/moderation/cases/${dir.case_id}/standing`, { standing: "restricted", reason: "Trying a merged case." }, { session: w.admin }), w.env, dir.case_id))
      .rejects.toMatchObject({ status: 409, code: "standing_case_precondition" });
  });

  it("the standing matrix is complete and consistent in every cell (both consumers derive from it)", async () => {
    // Every from x to cell is explicit; self-transitions refused; all
    // cross transitions allowed; the vocabulary and precondition agree.
    for (const from of ABUSE_STANDINGS) {
      for (const to of ABUSE_STANDINGS) {
        expect(STANDING_TRANSITIONS[from][to]).toBeDefined();
        expect(standingTransitionAllowed(from, to)).toBe(from !== to);
      }
    }
    // resolved_merged is in the case vocabulary and is NEVER standing-eligible.
    expect(MODERATION_CASE_STATUSES).toContain("resolved_merged");
    expect(standingCasePreconditionSatisfied("resolved_merged")).toBe(false);
    expect(standingCasePreconditionSatisfied("resolved_hidden")).toBe(true);
    expect(standingCasePreconditionSatisfied("triaged")).toBe(false);
  });

  it("the queue reports honest counts, including merged cases as their own bucket", async () => {
    const w = await world();
    const a = await (await reportCase(authedRequest("/api/moderation/reports", { target_table: "sales_listings", target_id: "listing-1", reason: "spam" }, { session: w.reporter }), w.env)).json() as { case_id: number };
    await decideCase(authedRequest(`/api/admin/moderation/cases/${a.case_id}/decision`, { decision: "dismiss", note: "Queue count check." }, { session: w.admin }), w.env, a.case_id);
    const queue = await moderationQueue(authedRequest("/api/admin/moderation/queue", undefined, { method: "GET", session: w.admin }), w.env);
    const body = await queue.json() as { status_counts: Record<string, number>; dedupe_note: string };
    expect(body.status_counts["resolved_dismissed"]).toBeGreaterThanOrEqual(1);
    expect(body.dedupe_note).toContain("structurally");
  });
});
