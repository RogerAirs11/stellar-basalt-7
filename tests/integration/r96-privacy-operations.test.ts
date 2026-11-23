import { describe, expect, it } from "vitest";
import {
  reportServiceRequest, providerResponseStats, adminPlaceServiceRequestHold,
  adminReleaseServiceRequestHold, fileBlockComplaint, adminBlockComplaintQueue, adminResolveBlockComplaint,
} from "../../src/api/modules/serviceRequests";
import { serviceRetentionSweep } from "../../src/services/privacy";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * R96-N08 acceptance — privacy/report/abuse operations and bounded metrics.
 *
 *  A. Reports: one per (request, reporter) — retries append nothing; a daily
 *     rate bound refuses floods; only active participants can report and the
 *     target derives from the stored record, never submitted claims.
 *  B. Dispute/legal holds: a held request is NEVER retention-minimized;
 *     release is a separate authorized action; the operator's reason is
 *     audited and the private note text never enters any log.
 *  C. Bounded metrics: the aggregation reads ONLY an indexed SQL window —
 *     a request outside the window is not scanned; the scan cap and every
 *     exclusion are disclosed; response speed is never satisfaction.
 *  D. The block-complaint support queue: one complaint per pair, the private
 *     block reason never reaches the complainant, resolutions are audited.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** The R96-N02-style service world: a published provider, a verified manager,
 * a consented lead from an active requester. */
async function serviceWorld(db: D1Database, key = "n08-lead-1", requester = "req-1") {
  await seedUser(db, requester, "user");
  await seedUser(db, "provider-user", "user");
  await seedUser(db, "admin-1", "admin");
  await seedUser(db, "stranger", "user");
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'N08 Provider');
    INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('provider-user',1,'verified');
    INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,province_code,city,note,share_contact,status,created_at,updated_at)
    VALUES(500,'${requester}',1,'trainer','IR-23','N08 city','N08 private note ${key}',1,'new','2026-01-01 00:00:00','2026-01-01 00:00:00');
  `);
  return {
    requester: await makeSession(db, requester),
    provider: await makeSession(db, "provider-user"),
    admin: await makeSession(db, "admin-1"),
    stranger: await makeSession(db, "stranger"),
  };
}

describe("N08 A. report dedup, rate bounds and participant authority", () => {
  it("a retry cannot append a second report — the unique pair refuses honestly", async () => {
    const db = await openRealDatabase();
    const world = await serviceWorld(db);
    const first = await reportServiceRequest(authedRequest("/api/service-requests/500/report", { reason: "Suspicious request content." }, { session: world.requester }), env(db), 500);
    expect(first.status).toBe(201);
    await expect(reportServiceRequest(authedRequest("/api/service-requests/500/report", { reason: "Reporting again through retry." }, { session: world.requester }), env(db), 500))
      .rejects.toMatchObject({ status: 409, code: "duplicate_report" });
    expect(await countRows(db, "service_request_reports")).toBe(1);
  });

  it("one account cannot flood the report queue: the daily bound refuses", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "admin-1", "admin");
    await seedUser(db, "flood", "user");
    await seedUser(db, "provider-user", "user");
    await db.exec(`
      INSERT INTO people(id,name_latin) VALUES(1,'Flood Provider');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent) VALUES(1,'["trainer"]',1);
      INSERT INTO user_person_links(user_id,person_id,status) VALUES('provider-user',1,'verified');
    `);
    const flood = await makeSession(db, "flood");
    // 20 requests each reported once = the daily bound.
    for (let i = 1; i <= 20; i += 1) {
      await db.exec(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,created_at,updated_at)
        VALUES(${500 + i},'flood',1,'trainer','lead ${i}',1,'new','2026-01-01 00:00:00','2026-01-01 00:00:00')`);
      const response = await reportServiceRequest(authedRequest(`/api/service-requests/${500 + i}/report`, { reason: `Report number ${i} of the flood.` }, { session: flood }), env(db), 500 + i);
      expect(response.status).toBe(201);
    }
    await db.exec(`INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,created_at,updated_at)
      VALUES(600,'flood',1,'trainer','one more',1,'new','2026-01-01 00:00:00','2026-01-01 00:00:00')`);
    await expect(reportServiceRequest(authedRequest("/api/service-requests/600/report", { reason: "Report 21 should refuse." }, { session: flood }), env(db), 600))
      .rejects.toMatchObject({ status: 429, code: "report_rate_limited" });
    expect(await countRows(db, "service_request_reports")).toBe(20);
  });

  it("an unrelated participant cannot report (targets derive from the stored record)", async () => {
    const db = await openRealDatabase();
    const world = await serviceWorld(db);
    await expect(reportServiceRequest(authedRequest("/api/service-requests/500/report", { reason: "Not my request at all." }, { session: world.stranger }), env(db), 500))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await countRows(db, "service_request_reports")).toBe(0);
  });
});

describe("N08 B. dispute/legal holds block irreversible minimization", () => {
  async function agedTerminalLead(db: D1Database) {
    const world = await serviceWorld(db, "n08-hold-1");
    await db.exec(`
      UPDATE service_requests SET status='closed', closed_at=datetime('now','-400 days'), updated_at=datetime('now','-400 days') WHERE id=500;
    `);
    return world;
  }

  it("a held request is NEVER minimized; release resumes the normal schedule", async () => {
    const db = await openRealDatabase();
    const world = await agedTerminalLead(db);
    const hold = await adminPlaceServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold", {
      hold_kind: "legal_hold", reason: "Court order 1404/123 preserves this lead's content pending litigation.",
    }, { method: "POST", session: world.admin }), env(db), 500);
    expect(hold.status).toBe(201);

    const swept = await serviceRetentionSweep(db, new Date().toISOString());
    expect(swept.minimized_requests).toBe(0); // the hold blocked it
    expect((await db.prepare("SELECT note FROM service_requests WHERE id=500").first<{ note: string }>())?.note).toContain("N08 private note");

    // Release (a separate authorized action with its own reason) — then the
    // sweep minimizes on its normal schedule.
    const release = await adminReleaseServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold/release", {
      release_reason: "Litigation concluded; the preservation order is lifted.",
    }, { method: "POST", session: world.admin }), env(db), 500);
    expect(release.status).toBe(200);
    const after = await serviceRetentionSweep(db, new Date().toISOString());
    expect(after.minimized_requests).toBe(1);
    const row = await db.prepare("SELECT note, note_digest, retention_minimized_at FROM service_requests WHERE id=500").first<{ note: string; note_digest: string | null; retention_minimized_at: string | null }>();
    expect(row?.note).not.toContain("N08 private note"); // minimized away
    expect(row?.note_digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("holds are admin-only and one ACTIVE hold exists per request; the audit never contains the private note text", async () => {
    const db = await openRealDatabase();
    const world = await agedTerminalLead(db);
    // A non-admin (the provider manager) cannot place a hold.
    await expect(adminPlaceServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold", {
      hold_kind: "dispute", reason: "Provider trying to hold the lead themselves.",
    }, { method: "POST", session: world.provider }), env(db), 500)).rejects.toMatchObject({ status: 403 });
    // Admin places one...
    const hold = await adminPlaceServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold", {
      hold_kind: "dispute", reason: "Requester disputes the provider's conduct; evidence preserved.",
    }, { method: "POST", session: world.admin }), env(db), 500);
    expect(hold.status).toBe(201);
    // ...and a SECOND active hold is refused.
    await expect(adminPlaceServiceRequestHold(authedRequest("/api/admin/service-requests/500/hold", {
      hold_kind: "legal_hold", reason: "Trying to place a second active hold.",
    }, { method: "POST", session: world.admin }), env(db), 500)).rejects.toMatchObject({ status: 409, code: "hold_exists" });
    expect(await countRows(db, "service_request_holds")).toBe(1);
    // The audit trail carries the operator's reason, never the note text.
    const audits = await db.prepare("SELECT after_json FROM audit_events WHERE action='service_request.hold_placed'").all<{ after_json: string }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results[0]!.after_json).not.toContain("N08 private note");
  });
});

describe("N08 C. bounded provider-response aggregation", () => {
  it("the SQL itself is window-bounded: a request outside the window is never scanned", async () => {
    const source = readFileSync(join(ROOT, "src/api/modules/serviceRequests.ts"), "utf8");
    // Source pin: the aggregation query carries the window predicate and the
    // scan cap — the bound lives at SQL level, not in post-hoc JS filtering.
    expect(source).toContain("WHERE provider_person_id=? AND datetime(created_at)>=datetime('now','-${METRICS_WINDOW_DAYS} days')");
    expect(source).toContain(`ORDER BY created_at LIMIT ${"${METRICS_MAX_ROWS_SCAN + 1}"}`.replace(/"/g, ""));
  });

  it("old requests are excluded and every bound is disclosed; speed is never satisfaction", async () => {
    const db = await openRealDatabase();
    const world = await serviceWorld(db, "n08-metrics-1");
    // Two in-window acknowledged requests + one 200-day-old request.
    await db.exec(`
      INSERT INTO service_requests(id,requester_user_id,provider_person_id,category,note,share_contact,status,created_at,updated_at,first_response_at)
      VALUES(501,'req-1',1,'trainer','fresh lead 1',1,'acknowledged',datetime('now','-5 days'),datetime('now','-5 days'),datetime('now','-4 days')),
             (502,'req-1',1,'trainer','fresh lead 2',1,'acknowledged',datetime('now','-6 days'),datetime('now','-6 days'),datetime('now','-5 days')),
             (503,'req-1',1,'trainer','ancient lead',1,'acknowledged',datetime('now','-200 days'),datetime('now','-200 days'),datetime('now','-199 days'));
    `);
    const response = await providerResponseStats(db, 1);
    const body = await response.json() as {
      requests_in_window: number; scan_cap: number; scan_cap_applied: boolean;
      unacknowledged_requests: number; response_time_hours: { sample_size: number; median_hours: number } | null;
      aggregation_note: string; exclusions: Record<string, number>;
    };
    expect(body.requests_in_window).toBe(2); // the 200-day-old lead is outside the SQL window
    expect(body.scan_cap).toBe(5000);
    expect(body.scan_cap_applied).toBe(false);
    expect(body.unacknowledged_requests).toBe(0);
    expect(body.aggregation_note).toContain("SQL level");
    expect(body.aggregation_note).toContain("never satisfaction");
    // Response speed only — no rating FIELDS exist (the honest disclaimers
    // may say "no review stars exist"; a rating VALUE must not).
    const text = JSON.stringify(body);
    expect(text).not.toContain('"rating"');
    expect(text).not.toContain('"stars"');
    expect(text).not.toContain('"score"');
    expect(body.response_time_hours).toBeNull(); // below the minimum cohort — no metric at all
    void world;
  });
});

describe("N08 D. the block-complaint support queue", () => {
  it("one complaint per pair; retries append nothing; the private block reason never reaches the complainant", async () => {
    const db = await openRealDatabase();
    const world = await serviceWorld(db, "n08-complaint-1");
    // The provider blocks the requester (the reason is PRIVATE).
    await db.exec(`INSERT INTO service_provider_blocks(provider_person_id,blocked_requester_user_id,reason,created_at)
      VALUES(1,'req-1','Private reason the requester must never see',CURRENT_TIMESTAMP)`);
    const filed = await fileBlockComplaint(authedRequest("/api/service-requests/block-complaints", {
      provider_person_id: 1, complaint: "I believe I was blocked by mistake; I never contacted this provider before.",
    }, { method: "POST", session: world.requester }), env(db));
    expect(filed.status).toBe(201);
    const filedBody = await filed.json() as Record<string, unknown>;
    expect(JSON.stringify(filedBody)).not.toContain("Private reason");
    // Retry appends nothing.
    const retry = await fileBlockComplaint(authedRequest("/api/service-requests/block-complaints", {
      provider_person_id: 1, complaint: "Filing the same complaint again through a retry.",
    }, { method: "POST", session: world.requester }), env(db));
    const retryBody = await retry.json() as { complaint: string };
    expect(retryBody.complaint).toBe("existing");
    expect(await countRows(db, "provider_block_complaints")).toBe(1);
    // The operator queue shows it; the resolution is audited.
    const queue = await adminBlockComplaintQueue(authedRequest("/api/admin/service-requests/block-complaints", undefined, { method: "GET", session: world.admin }), env(db));
    const queueBody = await queue.json() as { complaints: Array<{ id: number; status: string }>; open_count: number };
    expect(queueBody.open_count).toBe(1);
    const resolve = await adminResolveBlockComplaint(authedRequest("/api/admin/service-requests/block-complaints/1/resolve", {
      resolution_note: "Reviewed: the block was mistaken; the provider was advised to lift it.",
    }, { method: "POST", session: world.admin }), env(db), 1);
    expect(resolve.status).toBe(200);
    expect(await countRows(db, "provider_block_complaints", "status='resolved'")).toBe(1);
    // The PRIVATE block reason still never left the operator surface.
    expect(JSON.stringify(queueBody)).not.toContain("Private reason");
  });
});
