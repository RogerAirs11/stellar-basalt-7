import { json } from "../http";
import { publicMediaPredicate } from "./mediaPolicy";
import { publicHorseAttestations } from "../../trust/attestationStore";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R145-C04 (Master-AI plan) — the deliberately limited public evidence
 * summary, plus the honest evidence lifecycle vocabulary.
 *
 * Master-AI finding: a viewer could not see claims, contradictions, evidence
 * and prior decisions together, and the application blurred the distinct
 * lifecycle states (uploaded / reviewed / attested / disputed / revoked /
 * superseded). This endpoint returns the PUBLIC projection only —
 * deliberately limited:
 *
 *   - Platform-reviewed media counts as "reviewed", NEVER as attested and
 *     never as issuer-verified (a photo review is not a document review —
 *     the marketplace chip counts documents only, R145 fix).
 *   - Issuer attestations (credential stories) surface by their honest
 *     verification state (current/expired/revoked/superseded/source_changed).
 *   - Published genetic results surface by category; undisclosed and
 *     staff-private evidence is never even counted here (presence of a
 *     concealed record is itself private — counting it would leak).
 *   - Rejected/quarantined and private-role media never appear at all.
 */

export const EVIDENCE_LIFECYCLE_STATES = [
  "uploaded",
  "reviewed",
  "attested",
  "disputed",
  "revoked",
  "superseded",
] as const;

const REVIEWED_STATES = ["federation_verified"] as const;

export async function publicEvidenceSummary(db: D1Database, horseId: number): Promise<Response> {
  const horse = await db
    .prepare("SELECT id,name_latin,name_native FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1")
    .bind(horseId)
    .first<{ id: number; name_latin: string | null; name_native: string | null }>();
  if (!horse) return json({ error: "not_found" }, { status: 404 });

  // Public media by lifecycle state (platform review vocabulary). The public
  // predicate already excludes documents, private roles, non-consented and
  // quarantined items — so "presence" can never leak through this summary.
  const mediaRows = (await db
    .prepare(
      `SELECT verification,media_type,COUNT(*) AS count FROM horse_media m
       WHERE m.horse_id=? AND ${publicMediaPredicate("m")}
       GROUP BY verification,media_type`,
    )
    .bind(horseId)
    .all()).results as Array<Record<string, unknown>>;

  const mediaLifecycle: Record<string, number> = { uploaded: 0, reviewed: 0 };
  for (const row of mediaRows) {
    const verification = String(row.verification);
    const count = Number(row.count);
    if ((REVIEWED_STATES as readonly string[]).includes(verification)) {
      mediaLifecycle.reviewed += count;
    } else if (verification === "rejected") {
      // Quarantined evidence is not public knowledge — never surfaced.
      continue;
    } else {
      mediaLifecycle.uploaded += count;
    }
  }

  // Issuer attestations by their honest lifecycle state (0031 + R98-N04/N05:
  // active carries the snapshot verification status; revoked/superseded are
  // terminal and surfaced as exactly that).
  const publicAttestations = await publicHorseAttestations(db, horseId);
  const groupedAttestations = new Map<string, { status: string; record_kind: string; count: number }>();
  for (const row of publicAttestations.attestations) {
    const key = `${row.effective_status}:${row.record_kind}`;
    const item = groupedAttestations.get(key) ?? { status: row.effective_status, record_kind: row.record_kind, count: 0 };
    item.count += 1;
    groupedAttestations.set(key, item);
  }
  const attestationRows = [...groupedAttestations.values()];
  const attestations: Record<string, number> = {};
  for (const row of attestationRows) {
    attestations[String(row.status)] = (attestations[String(row.status)] ?? 0) + Number(row.count);
  }

  // Published genetic results by category. Only PUBLIC_DECIDED rows count —
  // presence of an undisclosed result is private.
  const geneticsRows = (await db
    .prepare(
      `SELECT test_category,COUNT(*) AS count FROM genetic_tests
       WHERE horse_id=? AND verified=1 AND (test_category<>'disease' OR COALESCE(public_disclosed,0)=1)
       GROUP BY test_category`,
    )
    .bind(horseId)
    .all()
    .catch(() => ({ results: [] as Array<Record<string, unknown>> }))).results as Array<Record<string, unknown>>;
  const genetics_published: Record<string, number> = {};
  for (const row of geneticsRows) {
    genetics_published[String(row.test_category)] = Number(row.count);
  }

  return json({
    horse_id: horse.id,
    name_latin: horse.name_latin,
    name_native: horse.name_native,
    lifecycle_vocabulary: {
      uploaded: "A file was uploaded; nobody has reviewed it.",
      reviewed: "Platform staff reviewed the item. Reviewed is NOT issuer-attested and never implies parentage, DNA or health verification.",
      attested: "A named issuer institution confirmed a specified fact within its approved scope.",
      disputed: "The evidence is disputed; it supports no official label while disputed.",
      revoked: "The evidence or permission was withdrawn; it stops supporting every derived label.",
      superseded: "A newer decision replaced this one; the history is preserved.",
    },
    media: mediaLifecycle,
    media_by_type: mediaRows.map((row) => ({ media_type: String(row.media_type), verification: String(row.verification), count: Number(row.count) })),
    attestations,
    attestations_truncated: publicAttestations.truncated,
    attestations_by_record_kind: attestationRows.map((row) => ({ record_kind: String(row.record_kind), status: String(row.status), count: Number(row.count) })),
    genetics_published,
    note:
      "Deliberately limited public summary: this lists nothing private, no staff-only evidence, no concealed identifiers, and no rejected items. Reviewed content is platform-reviewed at most — an official label requires the corresponding attestation.",
  });
}
