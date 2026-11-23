import type { D1Database } from "@cloudflare/workers-types";
import { geneticActionPredicate } from "../access/geneticAccess";
import type { PrivacyViewer } from "./policy";
import { projectGeneticTest, type GeneticTestRow, type PublicGeneticTest } from "./projections";

type GeneticReadRow = GeneticTestRow & {
  subject_id: number; subject_name_latin: string | null; subject_name_native: string | null;
  subject_breed_desc: string | null; can_evidence: number; can_health: number;
};

/** Profile and marketplace use this same SQL boundary. Authorization and
 * report selection share a database snapshot; revoked grants cannot survive
 * a preflight lookup. Private columns are masked before leaving the DB. */
export async function readHorseGenetics(db: D1Database, horseId: number, viewer?: PrivacyViewer | null, limit?: number): Promise<{
  horse: { id: number; name_latin: string | null; name_native: string | null; breed_desc: string | null } | null;
  tests: PublicGeneticTest[];
}> {
  const evidence = geneticActionPredicate(viewer, { column: "h.id" }, ["genetic_evidence_read"]);
  const health = geneticActionPredicate(viewer, { column: "h.id" }, ["private_health_read"]);
  const boundedLimit = limit == null ? null : Math.max(1, Math.min(1000, Math.floor(limit)));
  const rows = (await db.prepare(`WITH subject AS (
      SELECT h.id,h.name_latin,h.name_native,h.breed_desc,h.is_active,
        CASE WHEN ${evidence.sql} THEN 1 ELSE 0 END AS can_evidence,
        CASE WHEN ${health.sql} THEN 1 ELSE 0 END AS can_health
      FROM horses h WHERE h.id=? AND h.deleted_at IS NULL
    )
    SELECT s.id AS subject_id,s.name_latin AS subject_name_latin,s.name_native AS subject_name_native,
      s.breed_desc AS subject_breed_desc,s.can_evidence,s.can_health,
      g.id,g.horse_id,g.test_type,g.test_category,g.result,g.lab_name,g.tested_at,g.verified,g.provenance,g.public_disclosed,
      CASE WHEN s.can_evidence=1 THEN g.result_interpretation ELSE NULL END AS result_interpretation,
      CASE WHEN s.can_evidence=1 THEN g.lab_accession ELSE NULL END AS lab_accession,
      CASE WHEN s.can_evidence=1 THEN g.notes ELSE NULL END AS notes,
      CASE WHEN s.can_evidence=1 THEN g.interpretation_version ELSE NULL END AS interpretation_version,
      CASE WHEN s.can_evidence=1 THEN g.interpreted_at ELSE NULL END AS interpreted_at,
      CASE WHEN s.can_evidence=1 THEN g.catalog_reviewed_by ELSE NULL END AS catalog_reviewed_by,
      CASE WHEN s.can_evidence=1 THEN g.row_version ELSE NULL END AS row_version,
      CASE WHEN s.can_evidence=1 THEN g.created_by_user_id ELSE NULL END AS created_by_user_id,
      r.row_version AS pairing_review_version,r.assay_key AS pairing_review_assay,
      r.review_state AS pairing_review_state,r.expires_at AS pairing_review_expires_at
    FROM subject s
    LEFT JOIN genetic_tests g ON g.horse_id=s.id AND (
      s.can_evidence=1 OR (g.verified=1 AND (g.test_category<>'disease' OR COALESCE(g.public_disclosed,0)=1 OR s.can_health=1))
    )
    LEFT JOIN genetic_pairing_reviews r ON r.test_id=g.id AND s.can_evidence=1
    WHERE s.is_active=1 OR s.can_evidence=1 OR s.can_health=1
    ORDER BY g.test_category,g.test_type,g.tested_at DESC,g.id DESC ${boundedLimit ? "LIMIT ?" : ""}`)
    .bind(...evidence.bindings, ...health.bindings, horseId, ...(boundedLimit ? [boundedLimit] : []))
    .all<GeneticReadRow>()).results ?? [];
  const first = rows[0];
  if (!first) return { horse: null, tests: [] };
  const tests = rows.flatMap(row => {
    if (row.id == null) return [];
    const resolved: PrivacyViewer | null = viewer ? { user: viewer.user, sessionId: viewer.sessionId,
      geneticScope: { horseId, evidenceRead: Number(row.can_evidence) === 1, verifiedHealthRead: Number(row.can_health) === 1 } } : null;
    const projected = projectGeneticTest(row, resolved);
    return projected ? [projected] : [];
  });
  return { horse: { id: Number(first.subject_id), name_latin: first.subject_name_latin,
    name_native: first.subject_name_native, breed_desc: first.subject_breed_desc }, tests };
}
