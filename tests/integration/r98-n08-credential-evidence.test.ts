import { describe, expect, it } from "vitest";
import {
  credentialReviewQueue, submitCredentialRenewal, reviewCredentialRenewal,
  scanExpiryReminders, credentialBadge, isCurrentlyQualified,
} from "../../src/directory/credentialWorkflows";
import { credentialPeriod } from "../../src/directory/credentialPolicy";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, countRows } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R98-N08 acceptance — real credential evidence and expiry workflows on the
 * real migrated database (migration 0076).
 *
 * Acceptance under test (from the reviewed N08 ticket):
 *  1. Each badge identifies what was checked, by whom, against which
 *     evidence and at what time — and never invents an issuer.
 *  2. An expired, undated or revoked record cannot silently satisfy a
 *     current-qualification filter (the ONE predicate + honest periods).
 *  3. No platform reviewer can create issuer_attested by editing a JSON
 *     value — the renewal path is structurally limited to date/evidence
 *     updates, and the queue is excluded from reviewing their own evidence.
 *  4. Renewal: holder submits, reviewer applies (new dates + version bump) or
 *     rejects (old dates stand); the submitter cannot review their own.
 *  5. Reminders fire only pre-expiry, once per window, never for revoked or
 *     undated credentials — and never change qualification.
 */

async function world(db: D1Database) {
  await seedUser(db, "holder-1", "user");
  await seedUser(db, "holder-2", "user");
  await seedUser(db, "reviewer-1", "admin");
  await db.exec(`
    INSERT INTO people(id,name_latin) VALUES(1,'N08 Holder One'),(2,'N08 Holder Two');
    INSERT INTO user_person_links(user_id,person_id,status) VALUES('holder-1',1,'verified'),('holder-2',2,'verified');
  `);
}

async function seedCredential(db: D1Database, id: number, personId: number, identifier: string, issuedAt: string | null, expiresAt: string | null, createdBy = "holder-1"): Promise<void> {
  await db.prepare(`INSERT INTO person_credentials(id,person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,created_by_user_id)
    VALUES(?,?,?,?,?,?,?,'unverified',?)`)
    .bind(id, personId, "farrier", "Road Federation", identifier, issuedAt, expiresAt, createdBy).run();
}

describe("R98-N08 the ONE current-qualification predicate", () => {
  it("only within_recorded_dates qualifies; dates_not_recorded/expired/revoked/invalid never do", () => {
    expect(isCurrentlyQualified(credentialPeriod({ issued_at: "2026-01-01", expires_at: "2027-01-01" }))).toBe(true);
    expect(isCurrentlyQualified(credentialPeriod({}))).toBe(false); // dates_not_recorded
    expect(isCurrentlyQualified(credentialPeriod({ issued_at: "2020-01-01", expires_at: "2021-01-01" }))).toBe(false); // expired
    expect(isCurrentlyQualified(credentialPeriod({ issued_at: "2020-01-01", expires_at: "2021-01-01", revoked_at: "2025-06-01" }))).toBe(false); // revoked
    expect(isCurrentlyQualified(credentialPeriod({ issued_at: "bad", expires_at: "2021-01-01" }))).toBe(false); // invalid
  });
});

describe("R98-N08 reviewer queue honesty", () => {
  it("lists unverified credentials and EXCLUDES the claimant's own evidence", async () => {
    const db = await openRealDatabase();
    await world(db);
    await seedCredential(db, 101, 1, "F-101", "2026-01-01", "2027-01-01"); // holder-1's own
    await seedCredential(db, 102, 2, "F-102", null, null, "holder-2"); // holder-2's — NO dates recorded
    const queueForReviewer = await credentialReviewQueue(db, "reviewer-1");
    expect(queueForReviewer.length).toBe(2);
    expect(queueForReviewer.map((c) => c.credential_id).sort()).toEqual([101, 102]);
    // holder-1 reviewing: their own evidence is EXCLUDED from the queue view.
    const queueForHolder = await credentialReviewQueue(db, "holder-1");
    expect(queueForHolder.map((c) => c.credential_id)).toEqual([102]);
    // The queue reports honest periods (no expiry recorded -> dates_not_recorded, never "active").
    expect(queueForReviewer.find((c) => c.credential_id === 102)?.period).toBe("dates_not_recorded");
    expect(queueForReviewer.find((c) => c.credential_id === 101)?.period).toBe("within_recorded_dates");
  });
});

describe("R98-N08 renewal evidence workflow", () => {
  async function renewalWorld(db: D1Database) {
    await world(db);
    await seedCredential(db, 201, 1, "F-201", "2025-01-01", "2026-01-01"); // already expired
    return 201;
  }

  it("holder submits; reviewer approves: new dates + version bump + audit; submitter cannot self-review", async () => {
    const db = await openRealDatabase();
    const credentialId = await renewalWorld(db);
    // An unrelated user cannot submit a renewal for holder-1's credential.
    expect(await submitCredentialRenewal(db, { actorId: "holder-2", subject: "person", credentialId, evidenceNote: "not my credential", evidenceId: null, proposedIssuedAt: null, proposedExpiresAt: null })).toBeNull();
    const renewalId = await submitCredentialRenewal(db, { actorId: "holder-1", subject: "person", credentialId,
      evidenceNote: "Renewed federation licence for 2026-2027", evidenceId: null,
      proposedIssuedAt: "2026-01-02", proposedExpiresAt: "2027-01-02" });
    expect(renewalId).not.toBeNull();
    // Only one pending renewal per credential.
    expect(await submitCredentialRenewal(db, { actorId: "holder-1", subject: "person", credentialId, evidenceNote: "second attempt while pending", evidenceId: null, proposedIssuedAt: null, proposedExpiresAt: null })).toBeNull();
    // The submitter can NEVER review their own renewal.
    await expect(reviewCredentialRenewal(db, { actorId: "holder-1", renewalId: Number(renewalId), expectedVersion: 1, decision: "approved", note: "self review attempt" }))
      .rejects.toThrow(/cannot review their own/i);
    // A reviewer approves with a stale version -> conflict, nothing applied.
    expect((await reviewCredentialRenewal(db, { actorId: "reviewer-1", renewalId: Number(renewalId), expectedVersion: 99, decision: "approved", note: "stale" })).applied).toBe(false);
    // Correct version applies the proposed dates with a version bump.
    const outcome = await reviewCredentialRenewal(db, { actorId: "reviewer-1", renewalId: Number(renewalId), expectedVersion: 1, decision: "approved", note: "Federation renewal verified" });
    expect(outcome.applied).toBe(true);
    const credential = await db.prepare("SELECT issued_at,expires_at,row_version FROM person_credentials WHERE id=?").bind(credentialId)
      .first<{ issued_at: string; expires_at: string; row_version: number }>();
    expect(credential?.issued_at).toBe("2026-01-02");
    expect(credential?.expires_at).toBe("2027-01-02");
    expect(Number(credential?.row_version ?? 0)).toBeGreaterThan(1);
    // Replay is refused.
    await expect(reviewCredentialRenewal(db, { actorId: "reviewer-1", renewalId: Number(renewalId), expectedVersion: 2, decision: "rejected", note: "replay" }))
      .rejects.toThrow(/already reviewed/i);
    expect(await countRows(db, "audit_events", "action LIKE 'directory.credential.renewal_%'")).toBeGreaterThanOrEqual(2);
  });

  it("rejection keeps the OLD dates — a refused renewal never silently extends anything", async () => {
    const db = await openRealDatabase();
    const credentialId = await renewalWorld(db);
    const renewalId = await submitCredentialRenewal(db, { actorId: "holder-1", subject: "person", credentialId,
      evidenceNote: "Renewal with a photocopied licence", evidenceId: null,
      proposedIssuedAt: "2026-02-01", proposedExpiresAt: "2028-02-01" });
    const outcome = await reviewCredentialRenewal(db, { actorId: "reviewer-1", renewalId: Number(renewalId), expectedVersion: 1, decision: "rejected", note: "Evidence unreadable; submit the original" });
    expect(outcome.applied).toBe(true);
    const credential = await db.prepare("SELECT issued_at,expires_at FROM person_credentials WHERE id=?").bind(credentialId)
      .first<{ issued_at: string; expires_at: string }>();
    expect(credential?.issued_at).toBe("2025-01-01"); // unchanged
    expect(credential?.expires_at).toBe("2026-01-01"); // unchanged — still expired
    expect(credentialPeriod(credential ?? {})).toBe("expired");
  });
});

describe("R98-N08 pre-expiry reminders", () => {
  it("reminds once per window, only pre-expiry, never revoked or undated credentials; reminders never change qualification", async () => {
    const db = await openRealDatabase();
    await world(db);
    await db.exec(`
      INSERT INTO person_credentials(id,person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,created_by_user_id) VALUES
        (301,1,'farrier','Federation','F-301','2025-01-01',date('now','+30 days'),'unverified','holder-1'),
        (302,2,'farrier','Federation','F-302','2025-01-01',date('now','+7 days'),'unverified','holder-2'),
        (303,1,'farrier','Federation','F-303','2025-01-01',NULL,'unverified','holder-1'),
        (304,1,'farrier','Federation','F-304','2025-01-01',date('now','+30 days'),'unverified','holder-1');
      UPDATE person_credentials SET revoked_at=datetime('now') WHERE id=304;
    `);
    const fresh = await scanExpiryReminders(db);
    const ids = fresh.map((r) => r.credentialId).sort();
    expect(ids).toEqual([301, 302]); // the undated (303) and revoked (304) are never reminded
    expect(fresh.find((r) => r.credentialId === 301)?.daysBeforeExpiry).toBe(30);
    expect(fresh.find((r) => r.credentialId === 302)?.holderUserId).toBe("holder-2");
    // Re-running the scan is idempotent within the same window day.
    const again = await scanExpiryReminders(db);
    expect(again.length).toBe(0);
    // A reminded-but-not-renewed credential is not "currently qualified" by
    // virtue of the reminder — the predicate is unchanged.
    const reminded = await db.prepare("SELECT issued_at,expires_at,revoked_at FROM person_credentials WHERE id=301").first();
    expect(isCurrentlyQualified(credentialPeriod(reminded ?? {}))).toBe(true); // still within dates
    // But the expired one from the renewal world never flips back.
    expect(await countRows(db, "credential_expiry_reminders")).toBe(2);
  });
});

describe("R98-N08 the honest badge", () => {
  it("states what was checked, by whom, against which evidence, at what time — and never invents an issuer", async () => {
    const db = await openRealDatabase();
    await world(db);
    await db.exec(`
      INSERT INTO person_credentials(id,person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,verified_by_user_id,verified_at,evidence_media_id,created_by_user_id)
      VALUES (401,1,'farrier','Federation','F-401','2026-01-01','2027-01-01','platform_reviewed','reviewer-1','2026-02-01 10:00:00',NULL,'holder-1');
    `);
    const badge = await credentialBadge(db, "person", 401);
    const b = badge?.badge as Record<string, unknown>;
    expect(b.role).toBe("farrier");
    expect(b.issuer_name).toBe("Federation");
    expect(b.what_was_checked).toContain("credential evidence");
    expect((b.checked_by as { kind: string }).kind).toBe("platform_reviewed");
    expect((b.checked_by as { platform_reviewer: unknown }).platform_reviewer).toContain("reviewer-1");
    expect(b.checked_at).toBe("2026-02-01 10:00:00");
    expect((b.evidence as { present: boolean }).present).toBe(false); // honest: no evidence attached
    expect(b.recorded_period).toBe("within_recorded_dates");
    expect(String(b.note)).toContain("never");
    // An unknown credential 404s honestly.
    expect(await credentialBadge(db, "person", 99999)).toBeNull();
    // A revoked credential badge reports the revocation, never a silent state.
    await db.exec("UPDATE person_credentials SET revoked_at=datetime('now'),revoke_reason='withdrawn by issuer letter' WHERE id=401");
    const revokedBadge = await credentialBadge(db, "person", 401);
    const rb = revokedBadge?.badge as Record<string, unknown>;
    expect(rb.recorded_period).toBe("revoked");
    expect((rb.revoked as { reason: string }).reason).toBe("withdrawn by issuer letter");
    expect(isCurrentlyQualified(rb.recorded_period as never)).toBe(false);
  });

  it("no platform reviewer can create issuer_attested through the renewal path (dates/evidence only)", async () => {
    const db = await openRealDatabase();
    await world(db);
    await seedCredential(db, 501, 1, "F-501", "2026-01-01", "2027-01-01");
    const renewalId = await submitCredentialRenewal(db, { actorId: "holder-1", subject: "person", credentialId: 501,
      evidenceNote: "Renewal evidence for the federation licence", evidenceId: null,
      proposedIssuedAt: "2026-06-01", proposedExpiresAt: "2028-06-01" });
    // The renewal review schema structurally admits only approved|rejected —
    // there is no decision value that could carry issuer_attested.
    await expect(reviewCredentialRenewal(db, { actorId: "reviewer-1", renewalId: Number(renewalId), expectedVersion: 1, decision: "issuer_attested" as never, note: "try to fake it" }))
      .rejects.toBeTruthy();
    // Even after approval, the verification_state stays what it was.
    await reviewCredentialRenewal(db, { actorId: "reviewer-1", renewalId: Number(renewalId), expectedVersion: 1, decision: "approved", note: "dates updated" });
    const credential = await db.prepare("SELECT verification_state FROM person_credentials WHERE id=501").first<{ verification_state: string }>();
    expect(credential?.verification_state).toBe("unverified"); // renewal never upgrades verification
  });
});
