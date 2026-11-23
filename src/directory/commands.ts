/** Directory mutations are atomic batches. Only a fresh winning operation may
 * produce grants or audit records. Callers cannot supply an operation receipt.
 * These predicates close stale preflight paths; cross-row revocation races on
 * PostgreSQL still require the actual adapter/transaction release tests. */
import type { D1Database } from "@cloudflare/workers-types";
import { PROVINCE_CODE_SCHEME } from "./vocabulary";
const EDITOR = "u.is_active=1 AND u.role IN ('editor','admin','super_admin')";
const REVIEWER = "u.is_active=1 AND u.role IN ('admin','super_admin')";
const REPRESENTS = "EXISTS(SELECT 1 FROM user_person_links l WHERE l.user_id=u.id AND l.person_id=p.id AND l.status='verified')";
export async function reviewClaim(db: D1Database, input: {
    actorId: string;
    claimId: number;
    expectedVersion: number;
    decision: "approved" | "rejected";
    note: string;
}): Promise<boolean> {
    const op = crypto.randomUUID();
    const { actorId, claimId, expectedVersion, decision, note } = input;
    if (!["approved", "rejected"].includes(decision))
        throw new Error("Unsupported claim decision");
    const [result] = await db.batch([
        db.prepare(`UPDATE directory_claims SET status=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,
      review_note=?,row_version=row_version+1,last_operation_id=?
      WHERE id=? AND status='pending' AND row_version=? AND user_id<>?
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND ${REVIEWER})
      AND EXISTS(SELECT 1 FROM users target WHERE target.id=directory_claims.user_id AND target.is_active=1)
      AND ((claim_type='person' AND organization_id IS NULL AND EXISTS(SELECT 1 FROM people p WHERE p.id=directory_claims.person_id AND p.deleted_at IS NULL))
        OR (claim_type='organization' AND person_id IS NULL AND EXISTS(SELECT 1 FROM organizations o WHERE o.id=directory_claims.organization_id AND o.status='active')))`)
            .bind(decision, actorId, note, op, claimId, expectedVersion, actorId, actorId),
        db.prepare(`INSERT INTO user_person_links(user_id,person_id,status,verification_method,verified_by_user_id,verified_at)
      SELECT user_id,person_id,'verified','directory_claim_review',reviewed_by_user_id,CURRENT_TIMESTAMP
      FROM directory_claims WHERE id=? AND last_operation_id=? AND status='approved' AND claim_type='person'
      ON CONFLICT(user_id,person_id) DO UPDATE SET status='verified',verification_method='directory_claim_review',
        verified_by_user_id=excluded.verified_by_user_id,verified_at=excluded.verified_at`)
            .bind(claimId, op),
        db.prepare(`INSERT INTO organization_memberships(organization_id,user_id,role,status,valid_from)
      SELECT organization_id,user_id,'manager','active',CURRENT_TIMESTAMP FROM directory_claims
      WHERE id=? AND last_operation_id=? AND status='approved' AND claim_type='organization'
      ON CONFLICT(organization_id,user_id) DO UPDATE SET
        role=CASE WHEN organization_memberships.role='owner' THEN 'owner' ELSE 'manager' END,
        status='active',valid_from=excluded.valid_from,valid_until=NULL,
        revoked_at=NULL,revoked_by_user_id=NULL,revoke_reason=NULL`)
            .bind(claimId, op),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT reviewed_by_user_id,?,'directory_claim',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM directory_claims WHERE id=? AND last_operation_id=?`)
            .bind(`directory.claim.${decision}`, JSON.stringify({ decision, review_note: note, operation_id: op }), claimId, op),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}
export interface ProfileWrite {
    actorId: string;
    personId: number;
    expectedVersion: number;
    categories: string[];
    province: string | null;
    city: string | null;
    contactPreference: "platform_message" | "phone" | "email";
    contactValue: string | null;
    languages: string | null;
    availability: string | null;
    consent: boolean;
}
export async function writeProfile(db: D1Database, input: ProfileWrite): Promise<boolean> {
    const op = crypto.randomUUID();
    const d = input;
    const consent = d.consent ? 1 : 0;
    const [result] = await db.batch([
        db.prepare(`INSERT INTO directory_profiles(person_id,service_categories,province_code,city,contact_preference,
      contact_value,languages,availability_text,publication_consent,published_at,created_by_user_id,
      province_code_scheme,row_version,last_operation_id)
      SELECT p.id,?,?,?,CASE WHEN ${REPRESENTS} THEN ? ELSE COALESCE((SELECT old.contact_preference FROM directory_profiles old WHERE old.person_id=p.id),'platform_message') END,CASE WHEN ${REPRESENTS} THEN ? ELSE (SELECT old.contact_value FROM directory_profiles old WHERE old.person_id=p.id) END,?,?, ?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,u.id,?,1,?
      FROM people p JOIN users u ON u.id=? WHERE p.id=? AND p.deleted_at IS NULL AND u.is_active=1
      AND (${REPRESENTS} OR (${EDITOR}))
      AND (?=0 OR ${REPRESENTS} OR EXISTS(SELECT 1 FROM directory_profiles old WHERE old.person_id=p.id AND old.publication_consent=1))
      AND COALESCE((SELECT old.row_version FROM directory_profiles old WHERE old.person_id=p.id),0)=?
      ON CONFLICT(person_id) DO UPDATE SET service_categories=excluded.service_categories,
        province_code=excluded.province_code,province_code_scheme=excluded.province_code_scheme,city=excluded.city,
        contact_preference=excluded.contact_preference,contact_value=excluded.contact_value,languages=excluded.languages,
        availability_text=excluded.availability_text,publication_consent=excluded.publication_consent,
        published_at=CASE WHEN excluded.publication_consent=0 THEN NULL
          WHEN directory_profiles.publication_consent=1 THEN directory_profiles.published_at ELSE excluded.published_at END,
        updated_at=CURRENT_TIMESTAMP,row_version=directory_profiles.row_version+1,last_operation_id=excluded.last_operation_id
      WHERE directory_profiles.row_version=?`)
            .bind(JSON.stringify([...new Set(d.categories)]), d.province, d.city, d.contactPreference, d.contactValue, d.languages, d.availability, consent, consent, PROVINCE_CODE_SCHEME, op, d.actorId, d.personId, consent, d.expectedVersion, d.expectedVersion),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'directory.profile.updated','directory_profile',CAST(person_id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM directory_profiles WHERE person_id=? AND last_operation_id=?`)
            .bind(d.actorId, JSON.stringify({ publication_consent: d.consent, categories: d.categories, operation_id: op }), d.personId, op),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}
export async function reviewCredential(db: D1Database, input: {
    actorId: string;
    credentialId: number;
    expectedVersion: number;
    decision: "platform_reviewed" | "revoked";
    note: string;
}): Promise<boolean> {
    const op = crypto.randomUUID();
    if (!["platform_reviewed", "revoked"].includes(input.decision))
        throw new Error("Issuer attestation requires a separate issuer-bound workflow");
    const revoke = input.decision === "revoked" ? 1 : 0;
    const [result] = await db.batch([
        db.prepare(`UPDATE person_credentials SET
      verification_state=CASE WHEN ?=1 THEN verification_state ELSE 'platform_reviewed' END,
      verified_by_user_id=CASE WHEN ?=1 THEN verified_by_user_id ELSE ? END,
      verified_at=CASE WHEN ?=1 THEN verified_at ELSE CURRENT_TIMESTAMP END,
      revoked_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE revoked_at END,
      revoked_by_user_id=CASE WHEN ?=1 THEN ? ELSE revoked_by_user_id END,
      revoke_reason=CASE WHEN ?=1 THEN ? ELSE revoke_reason END,
      row_version=row_version+1,last_operation_id=?
      WHERE id=? AND row_version=? AND revoked_at IS NULL
      AND (?=1 OR created_by_user_id IS NULL OR created_by_user_id<>?)
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND ${REVIEWER})
      AND EXISTS(SELECT 1 FROM people p WHERE p.id=person_credentials.person_id AND p.deleted_at IS NULL)`)
            .bind(revoke, revoke, input.actorId, revoke, revoke, revoke, input.actorId, revoke, input.note, op, input.credentialId, input.expectedVersion, revoke, input.actorId, input.actorId),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,?,'person_credential',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM person_credentials WHERE id=? AND last_operation_id=?`)
            .bind(input.actorId, `directory.credential.${input.decision}`, JSON.stringify({ decision: input.decision, note: input.note, operation_id: op }), input.credentialId, op),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
}
export async function createCredential(db: D1Database, input: {
    actorId: string;
    personId: number;
    role: string;
    issuerName: string;
    identifier: string;
    issuedAt: string | null;
    expiresAt: string | null;
    evidenceId: string | null;
}): Promise<number | null> {
    const op = crypto.randomUUID();
    const [result] = await db.batch([
        db.prepare(`INSERT INTO person_credentials(person_id,role,issuer_name,identifier,issued_at,expires_at,evidence_media_id,verification_state,created_by_user_id,last_operation_id)
      SELECT p.id,?,?,?,?,?,?,'unverified',u.id,? FROM people p JOIN users u ON u.id=?
      WHERE p.id=? AND p.deleted_at IS NULL AND u.is_active=1 AND (${REPRESENTS} OR (${EDITOR}))
      AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM horse_media e WHERE e.id=? AND e.uploaded_by_user_id=u.id
        AND e.media_type='document' AND e.quarantined_at IS NULL))
      AND NOT EXISTS(SELECT 1 FROM person_credentials prior WHERE prior.person_id=p.id AND prior.role=? AND prior.identifier=?)`)
            .bind(input.role, input.issuerName, input.identifier, input.issuedAt, input.expiresAt, input.evidenceId, op, input.actorId, input.personId, input.evidenceId, input.evidenceId, input.role, input.identifier),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT created_by_user_id,'directory.credential.self_declared','person_credential',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM person_credentials WHERE last_operation_id=?`)
            .bind(JSON.stringify({ role: input.role, verification_state: "unverified", operation_id: op }), op),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1)
        return null;
    const row = await db.prepare("SELECT id FROM person_credentials WHERE last_operation_id=?").bind(op).first<{
        id: number;
    }>();
    return row?.id ?? null;
}
export async function createClaim(db: D1Database, input: {
    actorId: string;
    kind: "person" | "organization";
    personId: number | null;
    organizationId: number | null;
    evidenceNote: string;
    evidenceId: string | null;
    appealId: number | null;
}): Promise<number | null> {
    if ((input.kind === "person" && (input.personId === null || input.organizationId !== null))
        || (input.kind === "organization" && (input.organizationId === null || input.personId !== null))
        || !["person", "organization"].includes(input.kind))
        throw new Error("Claim needs exactly one target");
    const op = crypto.randomUUID();
    const results = await db.batch([
        db.prepare("UPDATE users SET updated_at=updated_at WHERE id=? AND is_active=1").bind(input.actorId),
        db.prepare(`INSERT INTO directory_claims(user_id,claim_type,person_id,organization_id,evidence_note,evidence_media_id,appeal_for_claim_id,last_operation_id)
      SELECT u.id,?,?,?,?,?,?,? FROM users u WHERE u.id=? AND u.is_active=1
      AND ((?='person' AND EXISTS(SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL))
        OR (?='organization' AND EXISTS(SELECT 1 FROM organizations o WHERE o.id=? AND o.status='active')))
      AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM horse_media e WHERE e.id=? AND e.uploaded_by_user_id=u.id
        AND e.media_type='document' AND e.quarantined_at IS NULL))
      AND (CAST(? AS BIGINT) IS NULL OR EXISTS(SELECT 1 FROM directory_claims prior WHERE prior.id=? AND prior.user_id=u.id
        AND prior.status='rejected' AND prior.claim_type=? AND COALESCE(prior.person_id,0)=? AND COALESCE(prior.organization_id,0)=?))
      AND (SELECT COUNT(*) FROM directory_claims pending WHERE pending.user_id=u.id AND pending.status='pending')<5
      AND NOT EXISTS(SELECT 1 FROM directory_claims pending WHERE pending.user_id=u.id AND pending.status='pending'
        AND pending.claim_type=? AND COALESCE(pending.person_id,0)=? AND COALESCE(pending.organization_id,0)=?)`)
            .bind(input.kind, input.personId, input.organizationId, input.evidenceNote, input.evidenceId, input.appealId, op, input.actorId, input.kind, input.personId, input.kind, input.organizationId, input.evidenceId, input.evidenceId, input.appealId, input.appealId, input.kind, input.personId ?? 0, input.organizationId ?? 0, input.kind, input.personId ?? 0, input.organizationId ?? 0),
        db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT user_id,'directory.claim.created','directory_claim',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM directory_claims WHERE last_operation_id=?`)
            .bind(JSON.stringify({ claim_type: input.kind, operation_id: op }), op),
    ]);
    if (Number(results[1]?.meta.changes ?? 0) !== 1)
        return null;
    const row = await db.prepare("SELECT id FROM directory_claims WHERE last_operation_id=?").bind(op).first<{
        id: number;
    }>();
    return row?.id ?? null;
}
