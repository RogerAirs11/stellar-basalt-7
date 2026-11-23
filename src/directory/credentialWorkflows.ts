/**
 * R98-N08 — the ONE credential evidence and expiry workflow layer.
 *
 * Pinned behaviors (from the reviewed N08 ticket):
 *  - Absence of dates is NEVER evidence that a credential is current: the
 *    R98 validity vocabulary (credentialPeriod) is the single source, and an
 *    expired, undated (dates_not_recorded), revoked or invalid record can
 *    never satisfy a current-qualification filter.
 *  - The platform evidence-review queue lists unverified credentials and
 *    pending renewals; a claimant can never review their own evidence
 *    (write-time guard, not just UI hiding).
 *  - Renewal evidence is submitted BY THE HOLDER and applied by a REVIEWER:
 *    approval writes new dates + evidence pointer with a version bump and an
 *    audit record; rejection leaves the OLD dates intact (a rejected renewal
 *    never silently extends anything).
 *  - Reminders go to the holder BEFORE expiry (deduplicated per credential
 *    per window). A reminder is a notification, never a qualification change.
 *  - Every badge states WHAT was checked, BY WHOM, against WHICH evidence and
 *    AT WHAT TIME — and an issuer_attested state can never be produced by a
 *    platform reviewer (the issuer-bound N04/N05 workflow owns that state).
 */
import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import { credentialDay, credentialPeriod, type CredentialPeriod } from "./credentialPolicy";

export const EXPIRY_REMINDER_WINDOWS = [30, 7, 1] as const;

export type CredentialSubject = "person" | "organization";

export interface QueuedCredential {
    subject_type: CredentialSubject;
    credential_id: number;
    role: string;
    issuer_name: string;
    identifier: string;
    issued_at: string | null;
    expires_at: string | null;
    verification_state: string;
    period: CredentialPeriod;
    created_by_user_id: string | null;
    created_at: string;
    renewal_submission_id: number | null;
}

/** The platform evidence-review queue: unverified credentials and pending
 * renewals, oldest first. The claimant's own submissions are EXCLUDED from
 * their own queue view (they cannot review their own evidence). */
export async function credentialReviewQueue(db: D1Database, actorId: string, limit = 50): Promise<QueuedCredential[]> {
    const rows = await db.prepare(`
    SELECT * FROM (
      SELECT 'person' AS subject_type, c.id AS credential_id, c.role, c.issuer_name, c.identifier,
        c.issued_at, c.expires_at, c.verification_state, c.created_by_user_id, c.created_at AS queued_at,
        (SELECT r.id FROM credential_renewal_submissions r WHERE r.person_credential_id=c.id AND r.status='pending' ORDER BY r.id LIMIT 1) AS renewal_submission_id
      FROM person_credentials c JOIN people p ON p.id=c.person_id
      WHERE c.verification_state='unverified' AND c.revoked_at IS NULL AND p.deleted_at IS NULL
        AND COALESCE(c.created_by_user_id,'') <> ?
      UNION ALL
      SELECT 'organization' AS subject_type, c.id AS credential_id, c.role, c.issuer_name, c.identifier,
        c.issued_at, c.expires_at, c.verification_state, c.created_by_user_id, c.created_at AS queued_at,
        (SELECT r.id FROM credential_renewal_submissions r WHERE r.organization_credential_id=c.id AND r.status='pending' ORDER BY r.id LIMIT 1) AS renewal_submission_id
      FROM organization_credentials c JOIN organizations o ON o.id=c.organization_id
      WHERE c.verification_state='unverified' AND c.revoked_at IS NULL AND o.status='active'
        AND COALESCE(c.created_by_user_id,'') <> ?
    ) ORDER BY queued_at ASC LIMIT ?`)
        .bind(actorId, actorId, Math.min(Math.max(limit, 1), 200)).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
        subject_type: String(row.subject_type) as CredentialSubject,
        credential_id: Number(row.credential_id),
        role: String(row.role),
        issuer_name: String(row.issuer_name),
        identifier: String(row.identifier),
        issued_at: (row.issued_at as string | null) ?? null,
        expires_at: (row.expires_at as string | null) ?? null,
        verification_state: String(row.verification_state),
        period: credentialPeriod({ issued_at: row.issued_at, expires_at: row.expires_at, revoked_at: null }),
        created_by_user_id: (row.created_by_user_id as string | null) ?? null,
        created_at: String(row.queued_at),
        renewal_submission_id: row.renewal_submission_id == null ? null : Number(row.renewal_submission_id),
    }));
}

function validDateOnly(value: string | null): boolean {
    return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** The holder submits renewal evidence for their own credential. The
 * credential must exist, be unrevoked, and belong to a person the caller
 * represents (or an organization where the caller is current staff). */
export async function submitCredentialRenewal(db: D1Database, input: {
    actorId: string; subject: CredentialSubject; credentialId: number;
    evidenceNote: string; evidenceId: string | null; proposedIssuedAt: string | null; proposedExpiresAt: string | null;
}): Promise<number | null> {
    if (!validDateOnly(input.proposedIssuedAt) || !validDateOnly(input.proposedExpiresAt))
        throw new HttpError(422, "invalid_date", "Renewal dates must be YYYY-MM-DD or null");
    if (input.proposedIssuedAt && input.proposedExpiresAt && input.proposedExpiresAt < input.proposedIssuedAt)
        throw new HttpError(422, "invalid_date", "Renewal expiry precedes its issue date");
    const op = crypto.randomUUID();
    const personAuthority = `EXISTS(SELECT 1 FROM people p WHERE p.id=c.person_id AND p.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM user_person_links l WHERE l.person_id=p.id AND l.user_id=u.id AND l.status='verified'))`;
    const orgAuthority = `EXISTS(SELECT 1 FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id JOIN organizations mo ON mo.id=m.organization_id
        WHERE o.id=c.organization_id AND m.user_id=u.id AND m.status='active' AND m.revoked_at IS NULL AND mo.status='active'
        AND datetime(m.valid_from)<=datetime('now') AND (m.valid_until IS NULL OR datetime(m.valid_until)>datetime('now')))`;
    const insertSql = input.subject === "person"
        ? `INSERT INTO credential_renewal_submissions(subject_type,subject_key,person_credential_id,organization_credential_id,
      submitted_by_user_id,evidence_media_id,evidence_note,proposed_issued_at,proposed_expires_at,last_operation_id)
      SELECT 'person', 'person:' || CAST(c.id AS TEXT), c.id, NULL, u.id, ?, ?, ?, ?, ?
      FROM person_credentials c JOIN people p ON p.id=c.person_id JOIN users u ON u.id=?
      WHERE c.id=? AND c.revoked_at IS NULL AND p.deleted_at IS NULL AND u.is_active=1 AND (${personAuthority})
        AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM horse_media e WHERE e.id=? AND e.uploaded_by_user_id=u.id
          AND e.media_type='document' AND e.quarantined_at IS NULL))
        AND NOT EXISTS(SELECT 1 FROM credential_renewal_submissions prior WHERE prior.subject_key='person:' || CAST(c.id AS TEXT) AND prior.status='pending')`
        : `INSERT INTO credential_renewal_submissions(subject_type,subject_key,person_credential_id,organization_credential_id,
      submitted_by_user_id,evidence_media_id,evidence_note,proposed_issued_at,proposed_expires_at,last_operation_id)
      SELECT 'organization', 'organization:' || CAST(c.id AS TEXT), NULL, c.id, u.id, ?, ?, ?, ?, ?
      FROM organization_credentials c JOIN organizations o ON o.id=c.organization_id JOIN users u ON u.id=?
      WHERE c.id=? AND c.revoked_at IS NULL AND o.status='active' AND u.is_active=1 AND (${orgAuthority})
        AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM horse_media e WHERE e.id=? AND e.uploaded_by_user_id=u.id
          AND e.media_type='document' AND e.quarantined_at IS NULL))
        AND NOT EXISTS(SELECT 1 FROM credential_renewal_submissions prior WHERE prior.subject_key='organization:' || CAST(c.id AS TEXT) AND prior.status='pending')`;
    const binds = input.subject === "person"
        ? [input.evidenceId, input.evidenceNote, input.proposedIssuedAt, input.proposedExpiresAt, op, input.actorId, input.credentialId, input.evidenceId, input.evidenceId]
        : [input.evidenceId, input.evidenceNote, input.proposedIssuedAt, input.proposedExpiresAt, op, input.actorId, input.credentialId, input.evidenceId, input.evidenceId];
    const [result] = await db.batch([
        db.prepare(insertSql).bind(...binds),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT submitted_by_user_id,'directory.credential.renewal_submitted','credential_renewal_submission',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM credential_renewal_submissions WHERE last_operation_id=?`)
            .bind(JSON.stringify({ subject: input.subject, credential_id: input.credentialId, operation_id: op }), op),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1) return null;
    const row = await db.prepare("SELECT id FROM credential_renewal_submissions WHERE last_operation_id=?").bind(op).first<{ id: number }>();
    return row?.id ?? null;
}

/** A reviewer applies or rejects a renewal. Approval writes the new dates and
 * evidence pointer onto the credential with a version bump; rejection keeps
 * the OLD dates. The SUBMITTER can never review their own renewal, and an
 * issuer_attested outcome is structurally unavailable here. */
export async function reviewCredentialRenewal(db: D1Database, input: {
    actorId: string; renewalId: number; expectedVersion: number;
    decision: "approved" | "rejected"; note: string;
}): Promise<{ applied: boolean }> {
    const op = crypto.randomUUID();
    const renewal = await db.prepare(`SELECT id,subject_type,subject_key,person_credential_id,organization_credential_id,
    submitted_by_user_id,proposed_issued_at,proposed_expires_at,evidence_media_id,status,row_version
    FROM credential_renewal_submissions WHERE id=?`).bind(input.renewalId)
        .first<{ id: number; subject_type: CredentialSubject; subject_key: string; person_credential_id: number | null; organization_credential_id: number | null; submitted_by_user_id: string; proposed_issued_at: string | null; proposed_expires_at: string | null; evidence_media_id: string | null; status: string; row_version: number }>();
    if (!renewal) throw new HttpError(404, "not_found", "Renewal submission not found");
    if (renewal.status !== "pending") throw new HttpError(409, "already_reviewed", "This renewal was already reviewed");
    if (renewal.submitted_by_user_id === input.actorId)
        throw new HttpError(403, "self_review_forbidden", "A claimant cannot review their own evidence");
    const approve = input.decision === "approved" ? 1 : 0;
    const credentialTable = renewal.subject_type === "person" ? "person_credentials" : "organization_credentials";
    const results = await db.batch([
        db.prepare(`UPDATE credential_renewal_submissions SET status=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,
      review_note=?,row_version=row_version+1,last_operation_id=?
      WHERE id=? AND status='pending' AND row_version=?`)
            .bind(input.decision, input.actorId, input.note, op, input.renewalId, input.expectedVersion),
        // Approval copies the PROPOSED dates + evidence pointer onto the
        // credential (version bump, audited); a rejection changes nothing on
        // the credential — the old dates stand, however stale.
        renewal.subject_type === "person"
            ? db.prepare(`UPDATE person_credentials SET issued_at=CASE WHEN ?=1 THEN ? ELSE issued_at END,
            expires_at=CASE WHEN ?=1 THEN ? ELSE expires_at END,
            evidence_media_id=CASE WHEN ?=1 THEN COALESCE(?,evidence_media_id) ELSE evidence_media_id END,
            row_version=row_version+1,last_operation_id=?
          WHERE id=?`)
                .bind(approve, renewal.proposed_issued_at, approve, renewal.proposed_expires_at, approve, renewal.evidence_media_id, op, renewal.person_credential_id)
            : db.prepare(`UPDATE organization_credentials SET issued_at=CASE WHEN ?=1 THEN ? ELSE issued_at END,
            expires_at=CASE WHEN ?=1 THEN ? ELSE expires_at END,
            evidence_media_id=CASE WHEN ?=1 THEN COALESCE(?,evidence_media_id) ELSE evidence_media_id END,
            row_version=row_version+1,last_operation_id=?
          WHERE id=?`)
                .bind(approve, renewal.proposed_issued_at, approve, renewal.proposed_expires_at, approve, renewal.evidence_media_id, op, renewal.organization_credential_id),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'directory.credential.renewal_' || ?,?,'${credentialTable}:renewal=' || CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM credential_renewal_submissions WHERE id=? AND last_operation_id=?`)
            .bind(input.actorId, input.decision, renewal.subject_type === "person" ? "person_credential" : "organization_credential",
                JSON.stringify({ decision: input.decision, note: input.note, renewal_id: input.renewalId, operation_id: op }), input.renewalId, op),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return { applied: false };
    return { applied: true };
}

/** Scan credentials approaching expiry and record REMINDERS for their
 * holders, deduplicated per credential per window. Revoked credentials and
 * credentials without a recorded expiry are never reminded (there is nothing
 * to remind about — and no date is ever invented). Returns the fresh
 * reminders (the notification layer delivers them). */
export async function scanExpiryReminders(db: D1Database, windows: readonly number[] = EXPIRY_REMINDER_WINDOWS): Promise<Array<{ subject: CredentialSubject; credentialId: number; holderUserId: string; daysBeforeExpiry: number }>> {
    const fresh: Array<{ subject: CredentialSubject; credentialId: number; holderUserId: string; daysBeforeExpiry: number }> = [];
    for (const days of windows) {
        const personRows = await db.prepare(`
      INSERT INTO credential_expiry_reminders(subject_type,subject_key,person_credential_id,organization_credential_id,holder_user_id,days_before_expiry)
      SELECT 'person', 'person:' || CAST(c.id AS TEXT), c.id, NULL,
        COALESCE((SELECT l.user_id FROM user_person_links l WHERE l.person_id=c.person_id AND l.status='verified' ORDER BY l.id LIMIT 1),
                 c.created_by_user_id), ?
      FROM person_credentials c JOIN people p ON p.id=c.person_id
      WHERE p.deleted_at IS NULL AND c.revoked_at IS NULL AND c.expires_at IS NOT NULL
        AND date(c.expires_at)=date('now','+${Number(days)} days')
        AND COALESCE((SELECT l.user_id FROM user_person_links l WHERE l.person_id=c.person_id AND l.status='verified' ORDER BY l.id LIMIT 1),
                 c.created_by_user_id) IS NOT NULL
      ON CONFLICT(subject_key,days_before_expiry) DO NOTHING`)
            .bind(days).run();
        const orgRows = await db.prepare(`
      INSERT INTO credential_expiry_reminders(subject_type,subject_key,person_credential_id,organization_credential_id,holder_user_id,days_before_expiry)
      SELECT 'organization', 'organization:' || CAST(c.id AS TEXT), NULL, c.id, c.created_by_user_id, ?
      FROM organization_credentials c JOIN organizations o ON o.id=c.organization_id
      WHERE o.status='active' AND c.revoked_at IS NULL AND c.expires_at IS NOT NULL
        AND date(c.expires_at)=date('now','+${Number(days)} days')
        AND c.created_by_user_id IS NOT NULL
      ON CONFLICT(subject_key,days_before_expiry) DO NOTHING`)
            .bind(days).run();
        if (Number(personRows.meta.changes ?? 0) > 0 || Number(orgRows.meta.changes ?? 0) > 0) {
            const seeded = await db.prepare(`SELECT subject_type,person_credential_id,organization_credential_id,holder_user_id,days_before_expiry
        FROM credential_expiry_reminders WHERE days_before_expiry=? AND reminded_at=datetime('now')`)
                .bind(days).all<{ subject_type: CredentialSubject; person_credential_id: number | null; organization_credential_id: number | null; holder_user_id: string; days_before_expiry: number }>();
            for (const row of seeded.results ?? []) {
                fresh.push({
                    subject: row.subject_type,
                    credentialId: Number(row.person_credential_id ?? row.organization_credential_id ?? 0),
                    holderUserId: row.holder_user_id,
                    daysBeforeExpiry: row.days_before_expiry,
                });
            }
        }
    }
    return fresh;
}

/** The honest badge: WHAT was checked, BY WHOM, against WHICH evidence, AT
 * WHAT TIME — plus the live validity period. Never invents an issuer. */
export async function credentialBadge(db: D1Database, subject: CredentialSubject, credentialId: number): Promise<Record<string, unknown> | null> {
    const table = subject === "person" ? "person_credentials" : "organization_credentials";
    const row = await db.prepare(`SELECT c.*, u.email AS reviewer_email FROM ${table} c
    LEFT JOIN users u ON u.id=c.verified_by_user_id WHERE c.id=?`).bind(credentialId)
        .first<Record<string, unknown>>();
    if (!row) return null;
    const period = credentialPeriod({ issued_at: row.issued_at, expires_at: row.expires_at, revoked_at: row.revoked_at });
    return {
        badge: {
            subject_type: subject,
            credential_id: credentialId,
            role: row.role,
            issuer_name: row.issuer_name,
            identifier: row.identifier,
            what_was_checked: subject === "person" ? "Recorded credential evidence for a directory person" : "Recorded credential evidence for an organization",
            checked_by: row.verification_state === "unverified" ? null : {
                kind: row.verification_state,
                platform_reviewer: row.verification_state === "platform_reviewed" ? (row.reviewer_email ?? row.verified_by_user_id) : null,
            },
            evidence: {
                media_id: row.evidence_media_id ?? null,
                // Evidence content is never exposed publicly; its presence is.
                present: row.evidence_media_id != null,
            },
            checked_at: row.verified_at ?? null,
            recorded_period: period,
            revoked: row.revoked_at != null ? { at: row.revoked_at, reason: row.revoke_reason } : null,
            note: "A reminder or a platform review never extends validity. Issuer attestation is a separate issuer-bound workflow and cannot be produced by platform review.",
        },
    };
}

/** The current-qualification filter: ONLY within_recorded_dates counts.
 * This single predicate is reused by every filter surface. */
export function isCurrentlyQualified(period: CredentialPeriod): boolean {
    return period === "within_recorded_dates";
}

export const CREDENTIAL_WORKFLOW_POLICY_NOTE = "Absence of dates is never evidence of currency. Only within_recorded_dates satisfies a current-qualification filter; dates_not_recorded, expired, revoked and invalid_dates never do. Renewal evidence is holder-submitted and reviewer-applied; rejection keeps the old dates. Reminders are notifications, never qualification changes. No platform reviewer can create issuer_attested.";
