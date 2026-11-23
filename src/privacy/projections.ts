/**
 * Allowlisted public DTO projections (Master-Ai plan T03, finding F01;
 * R140-A health-data decoupling from the second Master-AI audit).
 *
 * Private by default: lab accession numbers, editorial interpretation text,
 * notes, and unverified tests. For an authorized or explicitly public report,
 * only the listed fields enter its DTO. The same projection is used by
 * profiles and marketplace; SQL resolves current horse-specific grants and
 * masks private columns before this second boundary. Never SELECT * here.
 *
 * R140-A: verification is NOT publication permission. Disease/health-category
 * results are private-by-default — a verified SCID/HYPP result is health data
 * about a living animal and requires a current scoped read grant until an
 * explicit disclosure decision exists (`public_disclosed = 1`, decided by
 * an authorized publisher). Coat color, parentage, diversity and
 * other identity-adjacent categories keep the verified=>public rule.
 */
import { interpretAssayResult, legacyLocusMapping, ASSAY_CATALOG_VERSION } from "../genetics/assayCatalog";
import type { AssayResultStatus } from "../genetics/assayCatalog";
import { canViewPrivateGeneticEvidence, canViewVerifiedHealthResults, type PrivacyViewer } from "./policy";

export { canViewPrivateGeneticEvidence };
export type { PrivacyViewer };

export interface GeneticTestRow {
  id: number;
  horse_id?: number;
  test_type: string;
  test_category: string;
  result: string;
  result_interpretation: string | null;
  lab_name: string | null;
  lab_accession: string | null;
  tested_at: string | null;
  verified: number;
  provenance: string;
  notes: string | null;
  /** R140-A: explicit publication permission for health-sensitive rows. */
  public_disclosed?: number | null;
  result_status?: AssayResultStatus;
  /** P06 append-only reviewed-interpretation provenance (nullable = catalog-only). */
  interpretation_version?: string | null;
  interpreted_at?: string | null;
  catalog_reviewed_by?: string | null;
  row_version?: number;
  created_by_user_id?: string | null;
  pairing_review_version?: number | null;
  pairing_review_assay?: "SCID" | "CA" | "LFS" | "OAAM1" | null;
  pairing_review_state?: "accepted" | "withdrawn" | null;
  pairing_review_expires_at?: string | null;
}

/** Public genetic test DTO: no accession, no notes, no editorial interpretation. */
export interface PublicGeneticTest {
  id: number;
  test_type: string;
  test_category: string;
  result: string;
  /** Catalog-validated status; `recorded_uninterpreted` keeps the lab text authoritative. */
  result_status: AssayResultStatus;
  interpretation_scope: "recorded_genotype_only";
  clinical_diagnosis: false;
  assay_catalog_version: string;
  locus_quarantine?: NonNullable<ReturnType<typeof legacyLocusMapping>>;
  lab_name: string | null;
  tested_at: string | null;
  verified: number;
  provenance: string;
  /** R140-A: present on disease rows — did an explicit publication decision exist? */
  public_disclosed: number;
  result_interpretation: string | null;
  lab_accession: string | null;
  notes: string | null;
  /** Private reviewed-interpretation provenance, requiring evidence read. */
  reviewed_interpretation?: { version: string; at: string | null; by: string | null };
  /** Private workflow metadata is returned only with evidence-read authority. */
  row_version?: number;
  review_eligibility?: { own_submission: boolean; legacy_origin_unknown: boolean };
  pairing_review?: { row_version: number; assay_key: "SCID" | "CA" | "LFS" | "OAAM1"; review_state: "accepted" | "withdrawn"; expires_at: string | null } | null;
}

/**
 * Project one genetic-test row for a viewer. Unverified tests are
 * unpublished: available only through exact-horse evidence-read authority.
 * Verified disease results additionally require a health-result/evidence
 * grant or explicit disclosure. Accession, notes and review metadata require
 * evidence-read authority independently of every editorial role. Returns
 * null when the row must not be visible at all.
 */
export function projectGeneticTest(row: GeneticTestRow, viewer?: PrivacyViewer | null): PublicGeneticTest | null {
  const evidenceRead = canViewPrivateGeneticEvidence(viewer, row.horse_id);
  // R144-D01: an active `private_health_read` professional grant on THIS
  // horse lets a granted veterinarian/laboratory see granted health RESULTS.
  // A result-read grant does not imply evidence-read authority for accession,
  // private notes, interpretation or workflow metadata.
  const professionalHealthRead = canViewVerifiedHealthResults(viewer, row.horse_id);
  if (Number(row.verified) !== 1 && !evidenceRead) return null;
  if (row.test_category === "disease" && !evidenceRead && !professionalHealthRead && Number(row.public_disclosed ?? 0) !== 1) {
    return null;
  }
  const quarantine = row.test_category === "coat_color" ? legacyLocusMapping(row.test_type) : null;
  return {
    id: row.id,
    test_type: row.test_type,
    test_category: row.test_category,
    result: row.result,
    result_status: row.test_category === "disease" ? interpretAssayResult(row.test_type, row.result).status : "recorded_uninterpreted",
    interpretation_scope: "recorded_genotype_only",
    clinical_diagnosis: false,
    assay_catalog_version: ASSAY_CATALOG_VERSION,
    ...(quarantine ? { locus_quarantine: quarantine } : {}),
    lab_name: row.lab_name,
    tested_at: row.tested_at,
    verified: Number(row.verified) === 1 ? 1 : 0,
    provenance: row.provenance,
    public_disclosed: row.test_category === "disease" ? (Number(row.public_disclosed ?? 0) === 1 ? 1 : 0) : 1,
    result_interpretation: evidenceRead ? row.result_interpretation : null,
    lab_accession: evidenceRead ? row.lab_accession : null,
    notes: evidenceRead ? row.notes : null,
    // Reviewed provenance identifies accounts and timing and remains private.
    ...(evidenceRead && row.interpretation_version
      ? { reviewed_interpretation: { version: row.interpretation_version, at: row.interpreted_at ?? null, by: row.catalog_reviewed_by ?? null } }
      : {}),
    ...(evidenceRead ? { row_version: Number(row.row_version ?? 1),
      review_eligibility: { own_submission: row.created_by_user_id === viewer?.user.id, legacy_origin_unknown: !row.created_by_user_id },
      pairing_review: row.pairing_review_assay && row.pairing_review_state ? {
        row_version: Number(row.pairing_review_version), assay_key: row.pairing_review_assay,
        review_state: row.pairing_review_state, expires_at: row.pairing_review_expires_at ?? null,
      } : null } : {}),
  };
}

export interface BreedingRecordRowLike {
  [key: string]: unknown;
  notes?: string | null;
}

/**
 * Project one breeding-record row for a viewer. Registry facts (season,
 * outcome, method, foal, provenance, visible parent names) stay public.
 * Private notes require SQL-resolved result-read authority on both parents.
 */
export function projectBreedingRecord<T extends BreedingRecordRowLike>(row: T, viewer?: PrivacyViewer | null): T {
  if (viewer?.breedingNotesScope && viewer.breedingNotesScope.sireId === row.sire_id && viewer.breedingNotesScope.damId === row.dam_id) return row;
  const copy: Record<string, unknown> = { ...row };
  copy.notes = null;
  return copy as T;
}

/** One projection for every surface, including marketplace detail and future exports. */
export function projectGeneticTests(
  rows: Array<Omit<GeneticTestRow, "result_status">>,
  viewer?: PrivacyViewer | null,
): PublicGeneticTest[] {
  return rows.flatMap((row) => {
    const projected = projectGeneticTest(row, viewer);
    return projected ? [projected] : [];
  });
}
