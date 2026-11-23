import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AttestableRecordKind, IssueAttestationInput } from "./attestations";
import { CURRENT_ISSUER_MEMBER_SQL, MANAGE_ISSUER_SQL, normalizeTrustExpiry, currentIssuerMembershipProof } from "./membershipCommands";
import { ACTIVE_ISSUER_SCOPE_SQL } from "./scopes";
import {
    SNAPSHOT_KIND_SPECS, MEDIA_SNAPSHOT_COLUMNS, readSnapshotRow, readMediaSnapshotRow,
    buildAttestationSnapshot, columnGuardSql, columnGuardBinds,
} from "./snapshotSerializer";
import { timestampMillis } from "../security/timestamps";
import { publicMediaPredicate } from "../api/modules/mediaPolicy";
const TARGETS = {
    genetic_test: { table: "genetic_tests", horse: "r.horse_id" },
    media: { table: "horse_media", horse: "r.horse_id" },
    competition_result: { table: "competition_results", horse: "r.horse_id" },
    horse_identity: { table: "horses", horse: "r.id" },
} as const;

export interface IssuanceScopeProof {
    scopeId: string;
    scopeVersion: number;
    actions: string[];
}

/** Metadata-only read of the scope that will authorize this issuance. The
 * snapshot records WHICH scope version authorized the document; the SQL
 * predicate below is what actually enforces it at commit time. */
export async function currentIssuerScopeProof(db: D1Database, issuerId: string, recordKind: AttestableRecordKind, action: "attest" | "supersede"): Promise<IssuanceScopeProof | null> {
    const rows = await db.prepare(`SELECT s.id, s.scope_version, sa.action FROM issuer_scopes s
    JOIN issuer_scope_actions sa ON sa.scope_id=s.id
    WHERE s.issuer_id=? AND s.record_kind=? AND s.status='approved' AND sa.action=?
      AND s.valid_from IS NOT NULL AND datetime(s.valid_from)<=datetime('now')
      AND (s.valid_until IS NULL OR (datetime(s.valid_until)>datetime('now') AND datetime(s.valid_until)>datetime(s.valid_from)))
    ORDER BY s.scope_version DESC LIMIT 1`).bind(issuerId, recordKind, action)
        .all<{ id: string; scope_version: number; action: string }>();
    const row = rows.results[0];
    return row ? { scopeId: row.id, scopeVersion: row.scope_version, actions: [row.action] } : null;
}

export async function issueStoredAttestation(db: D1Database, actorId: string, issuerId: string, input: IssueAttestationInput, supersedes?: {
    id: string;
    expectedVersion: number;
    reason: string;
}): Promise<string | null> {
    const target = TARGETS[input.record_kind];
    if (!target)
        throw new Error("Unsupported attestation target");
    if (input.record_kind !== "media" && (!/^[1-9]\d*$/.test(input.record_id) || !Number.isSafeInteger(Number(input.record_id))))
        throw new Error("Invalid numeric record identifier");
    const action: "attest" | "supersede" = supersedes ? "supersede" : "attest";
    const id = crypto.randomUUID(), op = crypto.randomUUID(), snapshotId = crypto.randomUUID();
    const expiry = normalizeTrustExpiry(input.expires_at);
    const proof = await currentIssuerMembershipProof(db, issuerId, actorId);
    if (!proof[0]) return null; // no current authority: refuse before reading sources
    // R98-N05: read the ACTUAL source rows through the allowlist and derive
    // the snapshot server-side. A caller-supplied source_version/hash never
    // participates; the stored marker is derived from the canonical bytes.
    const spec = SNAPSHOT_KIND_SPECS[input.record_kind];
    const targetRow = await readSnapshotRow(db, input.record_kind, input.record_id);
    if (!targetRow) return null;
    const evidenceRow = input.evidence_media_id ? await readMediaSnapshotRow(db, input.evidence_media_id) : null;
    if (input.evidence_media_id && !evidenceRow) return null;
    const horseColumn = input.record_kind === "horse_identity" ? "id" : "horse_id";
    const horseIdRow = await db.prepare(`SELECT id FROM horses WHERE id=(SELECT ${horseColumn} FROM ${target.table} WHERE id=?) AND deleted_at IS NULL`)
        .bind(input.record_id).first<{ id: number }>();
    if (!horseIdRow) return null;
    const scopeProof = await currentIssuerScopeProof(db, issuerId, input.record_kind, action);
    if (!scopeProof) return null;
    const snapshot = await buildAttestationSnapshot({
        recordKind: input.record_kind, recordId: input.record_id, horseId: horseIdRow.id,
        targetRow, evidenceRow,
    });
    const scopeSnapshot = JSON.stringify({
        membership: { id: proof[0], valid_from: proof[1], valid_until: proof[2] || null },
        scope: { id: scopeProof.scopeId, version: scopeProof.scopeVersion, action },
        record_kind: input.record_kind,
    });
    // Commit-time source guards: every allowlisted column of the target row
    // (and of the referenced evidence row) must still equal the observed
    // value, or the issuance writes zero rows — never a mixed certificate.
    const targetGuardSql = columnGuardSql("r", spec.columns);
    const targetGuardBinds = columnGuardBinds(targetRow, spec.columns);
    const evidenceGuardSql = input.evidence_media_id ? columnGuardSql("evidence", MEDIA_SNAPSHOT_COLUMNS) : "";
    const evidenceGuardBinds = input.evidence_media_id ? columnGuardBinds(evidenceRow as Record<string, unknown>, MEDIA_SNAPSHOT_COLUMNS) : [];
    const statements: D1PreparedStatement[] = [
        db.prepare("UPDATE issuers SET status=status WHERE id=?").bind(issuerId),
        db.prepare(`INSERT INTO attestations(id,issuer_id,horse_id,record_kind,record_id,field_scope,statement,evidence_media_id,source_version,expires_at,status,attested_by_user_id,last_operation_id)
      SELECT ?,i.id,h.id,?,?,?,?,?,?,?,'active',u.id,? FROM ${target.table} r
      JOIN horses h ON h.id=${target.horse} JOIN issuers i ON i.id=? JOIN users u ON u.id=?
      WHERE CAST(r.id AS TEXT)=? AND h.deleted_at IS NULL AND i.status='active' AND u.is_active=1
      AND EXISTS(SELECT 1 FROM issuer_memberships m WHERE m.issuer_id=i.id AND m.user_id=u.id
        AND m.role IN ('owner','attester') AND ${CURRENT_ISSUER_MEMBER_SQL})
      AND ${ACTIVE_ISSUER_SCOPE_SQL}
      AND (CAST(? AS BIGINT) IS NULL OR h.id=?)
      ${input.record_kind === "media" ? "AND (r.uploaded_by_user_id IS NULL OR r.uploaded_by_user_id<>u.id) AND r.quarantined_at IS NULL" : ""}
      ${input.record_kind === "genetic_test" ? "AND (r.created_by_user_id IS NULL OR r.created_by_user_id<>u.id)" : ""}
      ${input.evidence_media_id ? `AND EXISTS(SELECT 1 FROM horse_media evidence WHERE evidence.id=? AND evidence.horse_id=h.id
        AND (evidence.uploaded_by_user_id IS NULL OR evidence.uploaded_by_user_id<>u.id) AND evidence.quarantined_at IS NULL
        ${evidenceGuardSql})` : ""}
      AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM attestations old WHERE old.id=? AND old.issuer_id=i.id
        AND old.status='active' AND old.row_version=? AND old.record_kind=? AND old.record_id=? AND ${MANAGE_ISSUER_SQL}))
      ${targetGuardSql}`)
            .bind(id, input.record_kind, input.record_id, input.field_scope?.length ? JSON.stringify(input.field_scope) : null, input.statement ?? null, input.evidence_media_id ?? null, snapshot.serverVersionMarker, expiry, op, issuerId, actorId, input.record_id, ...proof, input.record_kind, action, input.horse_id ?? null, input.horse_id ?? null, ...(input.evidence_media_id ? [input.evidence_media_id, ...evidenceGuardBinds] : []), supersedes?.id ?? null, supersedes?.id ?? null, supersedes?.expectedVersion ?? 0, input.record_kind, input.record_id, ...proof, ...targetGuardBinds),
        // R98-N05: the immutable snapshot lands in the SAME consistency
        // boundary, conditioned on the attestation row it belongs to. The
        // bytes stay private; verification exposes only digest + markers.
        db.prepare(`INSERT INTO attestation_snapshots(id,attestation_id,schema_version,record_kind,record_id,horse_id,canonical_json,content_digest,source_row_versions,issuer_scope_snapshot,operation_id,is_private)
      SELECT ?,a.id,?,?,?,?,?,?,?,?,?,1 FROM attestations a WHERE a.id=? AND a.last_operation_id=?`)
            .bind(snapshotId, 1, input.record_kind, input.record_id, horseIdRow.id, snapshot.canonicalJson, snapshot.contentDigest, snapshot.sourceRowVersions, scopeSnapshot, op, id, op),
        db.prepare(`INSERT INTO attestation_events(id,attestation_id,event,actor_user_id,reason)
      SELECT ?,id,'issued',attested_by_user_id,NULL FROM attestations WHERE id=? AND last_operation_id=?`)
            .bind(crypto.randomUUID(), id, op),
    ];
    if (supersedes) {
        const oldOp = crypto.randomUUID();
        statements.push(db.prepare(`UPDATE attestations SET status='superseded',superseded_by=?,superseded_at=CURRENT_TIMESTAMP,
        superseded_reason=?,row_version=row_version+1,last_operation_id=?
        WHERE id=? AND status='active' AND row_version=? AND EXISTS(SELECT 1 FROM attestations replacement WHERE replacement.id=? AND replacement.last_operation_id=?)`)
            .bind(id, supersedes.reason, oldOp, supersedes.id, supersedes.expectedVersion, id, op), db.prepare(`INSERT INTO attestation_events(id,attestation_id,event,actor_user_id,reason)
        SELECT ?,id,'superseded',?,? FROM attestations WHERE id=? AND last_operation_id=? AND superseded_by=?`)
            .bind(crypto.randomUUID(), actorId, supersedes.reason, supersedes.id, oldOp, id));
    }
    const results = await db.batch(statements);
    return Number(results[1]?.meta.changes ?? 0) === 1 ? id : null;
}
export async function revokeStoredAttestation(db: D1Database, input: {
    actorId: string;
    id: string;
    expectedVersion: number;
    reason: string;
}): Promise<boolean> {
    const target = await db.prepare("SELECT issuer_id FROM attestations WHERE id=?").bind(input.id).first<{
        issuer_id: string;
    }>();
    if (!target)
        return false;
    const proof = await currentIssuerMembershipProof(db, target.issuer_id, input.actorId);
    const op = crypto.randomUUID();
    const results = await db.batch([
        db.prepare("UPDATE issuers SET status=status WHERE id=(SELECT issuer_id FROM attestations WHERE id=?)").bind(input.id),
        db.prepare(`UPDATE attestations SET status='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason=?,row_version=row_version+1,last_operation_id=?
      WHERE id=? AND status='active' AND row_version=? AND EXISTS(SELECT 1 FROM issuers i JOIN users u ON u.id=?
        WHERE i.id=attestations.issuer_id AND u.is_active=1 AND ${MANAGE_ISSUER_SQL})`)
            .bind(input.reason, op, input.id, input.expectedVersion, input.actorId, ...proof),
        db.prepare(`INSERT INTO attestation_events(id,attestation_id,event,actor_user_id,reason)
      SELECT ?,id,'revoked',?,? FROM attestations WHERE id=? AND last_operation_id=?`)
            .bind(crypto.randomUUID(), input.actorId, input.reason, input.id, op),
    ]);
    return Number(results[1]?.meta.changes ?? 0) === 1;
}
export function effectiveAttestationStatus(row: {
    status: string;
    issuer_status: string;
    issued_at: string;
    expires_at: string | null;
}, now = Date.now()): string {
    if (row.status !== "active")
        return row.status;
    // R98-N04: the public effective-status projection names the specific
    // issuer state instead of a generic "inactive" — suspension is visible
    // without deleting any history.
    if (row.issuer_status === "suspended") return "issuer_suspended";
    if (row.issuer_status === "retired") return "issuer_retired";
    if (row.issuer_status !== "active") return "issuer_inactive";
    const start = timestampMillis(row.issued_at), end = row.expires_at === null ? null : timestampMillis(row.expires_at);
    if (!Number.isFinite(now) || start === null || (row.expires_at !== null && end === null) || (end !== null && end <= start))
        return "invalid_dates";
    if (start > now)
        return "not_yet_valid";
    if (end !== null && end <= now)
        return "expired";
    return "active";
}
/** Same target visibility boundaries as public genetics/media, with deleted
 * horses excluded. Private free text, evidence IDs and scope text never leave. */
/** Shared by listing, aggregate counts, public verification and extracts. */
export const PUBLIC_ATTESTATION_TARGET_SQL = `h.deleted_at IS NULL AND h.is_active=1 AND (
      (a.record_kind='horse_identity' AND a.record_id=CAST(h.id AS TEXT)) OR
      (a.record_kind='genetic_test' AND EXISTS(SELECT 1 FROM genetic_tests g WHERE CAST(g.id AS TEXT)=a.record_id AND g.horse_id=h.id AND g.verified=1 AND (g.test_category<>'disease' OR COALESCE(g.public_disclosed,0)=1))) OR
      (a.record_kind='media' AND EXISTS(SELECT 1 FROM horse_media m WHERE m.id=a.record_id AND m.horse_id=h.id AND ${publicMediaPredicate('m')})) OR
      (a.record_kind='competition_result' AND EXISTS(SELECT 1 FROM competition_results r WHERE CAST(r.id AS TEXT)=a.record_id AND r.horse_id=h.id)))`;

export async function publicHorseAttestations(db: D1Database, horseId: number) {
    const rows = await db.prepare(`SELECT a.id,a.record_kind,a.record_id,a.horse_id,a.issued_at,a.expires_at,a.status,
    i.slug AS issuer_slug,i.name AS issuer_name,i.name_native AS issuer_name_native,i.kind AS issuer_kind,i.status AS issuer_status
    FROM attestations a JOIN issuers i ON i.id=a.issuer_id JOIN horses h ON h.id=a.horse_id
    WHERE a.horse_id=? AND ${PUBLIC_ATTESTATION_TARGET_SQL}
    ORDER BY a.issued_at DESC,a.id LIMIT 201`).bind(horseId).all<{
        id: string;
        record_kind: string;
        record_id: string;
        horse_id: number;
        issued_at: string;
        expires_at: string | null;
        status: string;
        issuer_slug: string;
        issuer_name: string;
        issuer_name_native: string | null;
        issuer_kind: string;
        issuer_status: string;
    }>();
    return { truncated: rows.results.length > 200, attestations: rows.results.slice(0, 200).map((row) => ({
            id: row.id, issuer: { slug: row.issuer_slug, name: row.issuer_name, name_native: row.issuer_name_native, kind: row.issuer_kind, status: row.issuer_status },
            record_kind: row.record_kind, record_id: row.record_id, horse_id: row.horse_id, issued_at: row.issued_at, expires_at: row.expires_at,
            status: row.status, effective_status: effectiveAttestationStatus(row), statement: null, field_scope: null,
            scope_redacted: true, scope_note: "Public metadata only. Scope and evidence require an authorized review; no whole-record guarantee is implied.",
        })) };
}
export async function activeAttestationCount(db: D1Database, recordKind: AttestableRecordKind, recordId: string): Promise<number> {
    const rows = await db.prepare(`SELECT a.status,a.issued_at,a.expires_at,i.status AS issuer_status FROM attestations a
    JOIN issuers i ON i.id=a.issuer_id JOIN horses h ON h.id=a.horse_id
    WHERE a.record_kind=? AND a.record_id=? AND a.status='active' AND i.status='active' AND h.deleted_at IS NULL`)
        .bind(recordKind, recordId).all<{
        status: string;
        issuer_status: string;
        issued_at: string;
        expires_at: string | null;
    }>();
    return rows.results.filter((row) => effectiveAttestationStatus(row) === "active").length;
}
