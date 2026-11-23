/** Public genetic evidence contract. Genotype probabilities do not diagnose health. */
export type ArabianVariant = "SCID" | "CA" | "LFS" | "OAAM1";
export interface ArabianVariantEvidence {
  evidenceId: string;
  horseId: number;
  /** Reviewed, exact variant mapping. OAAM1 means the identified HOX deletion only. */
  assayKey: ArabianVariant;
  result: string;
  verified: boolean;
}
export type VariantEvidenceStatus = "missing" | "unverified" | "uninterpreted" | "conflict" | "resolved";
export interface ResolvedVariantEvidence {
  status: VariantEvidenceStatus;
  variantCopies: 0 | 1 | 2 | null;
  consideredEvidenceIds: string[];
  unverifiedEvidenceIds: string[];
}
export interface ArabianVariantPairing {
  variant: ArabianVariant;
  source: string;
  scope: "specified_variant_only";
  parentA: ResolvedVariantEvidence;
  parentB: ResolvedVariantEvidence;
  status: "calculable" | "insufficient_evidence";
  /** Mendelian genotype probabilities per conception, not clinical penetrance. */
  probabilities: { zeroVariantCopies: number; oneVariantCopy: number; twoVariantCopies: number } | null;
}
export interface ArabianPairingEvidenceReport {
  modelVersion: string;
  parentIds: readonly [number, number];
  variants: ArabianVariantPairing[];
  calculableVariants: number;
  totalVariants: number;
  limitationCodes: readonly string[];
}

export type PairingEvidenceExclusions = { unmapped: number; expired: number; withdrawn: number; changed: number; unverified: number };
export interface ArabianPairingEvidenceResponse extends ArabianPairingEvidenceReport {
  policyVersion: string;
  syntheticEvidence: boolean;
  verificationBasis: "reviewed_record_not_issuer_attestation";
  excludedEvidence: { parentA: PairingEvidenceExclusions; parentB: PairingEvidenceExclusions };
}
export interface PairingReviewInput {
  operation_id: string;
  assay_key: ArabianVariant;
  expected_version: number;
  expected_test_version: number;
  expected_test_type: string;
  expected_result: string;
  legacy_origin_acknowledged?: boolean;
  state: "accepted" | "withdrawn";
  expires_at?: string | null;
  reason: string;
}
export interface PairingReviewRecord {
  test_id: number; assay_key: ArabianVariant; review_state: "accepted" | "withdrawn";
  row_version: number; expires_at: string | null; reviewed_at: string;
}

export interface GeneticIntakeInput {
  operation_id: string;
  test_type: string;
  test_category: "disease" | "coat_color" | "parentage" | "diversity" | "other";
  result: string;
  result_interpretation?: string | null;
  lab_name?: string | null;
  lab_accession?: string | null;
  tested_at?: string | null;
  notes?: string | null;
}
/** A write-only intake receipt deliberately contains no report payload. */
export interface GeneticIntakeResponse {
  test: { id: number; horse_id: number; verified: 0; public_disclosed: 0; row_version: number };
  operation_id: string;
  replayed: boolean;
}
export interface GeneticInterpretationInput {
  operation_id: string;
  expected_version: number;
  result_status: "clear" | "carrier" | "affected" | "recorded_uninterpreted";
  verification: "unchanged" | "confirm_record" | "withdraw";
  evidence_ref?: string | null;
  legacy_origin_acknowledged?: boolean;
  reason: string;
  note?: string | null;
}
export interface GeneticInterpretationReceipt {
  operation_id: string;
  test_id: number;
  horse_id: number;
  row_version: number;
  verified: number;
  result_status: GeneticInterpretationInput["result_status"];
  interpretation_version: string;
  verification_scope: "record_review_not_issuer_attestation";
  scope: "recorded_genotype_only";
  clinical_diagnosis: false;
  publication_withdrawn: boolean;
}
export interface GeneticInterpretationResponse {
  review: GeneticInterpretationReceipt;
  operation_id: string;
  replayed: boolean;
}
export interface GeneticReviewHistoryResponse {
  test: { id: number; horse_id: number; row_version: number; verified: number };
  decisions: Array<{
    operation_id: string; action: "interpretation" | "pairing_review"; actor_user_id: string;
    decision_json: string; created_at: string;
  }>;
  limit: number;
  truncated: boolean;
}
export interface BreedingCorrectionInput {
  expected_version: number;
  operation_id?: string;
  covering_date?: string | null;
  season?: number | null;
  reason: string;
}
export interface BreedingCorrectionResponse {
  record: { id: number; sire_id: number; dam_id: number; covering_date: string | null; season: number; row_version: number };
  replayed: boolean;
  operation_id: string;
  correction: { old: { covering_date: string | null; season: number | null; row_version: number };
    new: { covering_date: string | null; season: number; row_version: number }; reason: string; corrected_by: string };
}
