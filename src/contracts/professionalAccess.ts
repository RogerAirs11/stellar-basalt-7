/** Shared server/UI vocabulary. Every permission requires an explicit,
 * current horse-scoped professional grant; a registry role implies none. */
export const GENETIC_GRANT_PERMISSIONS = [
  "genetic_evidence_read", "genetic_intake", "genetic_review", "genetic_publish",
] as const;
export type GeneticGrantPermission = (typeof GENETIC_GRANT_PERMISSIONS)[number];

export const PROFESSIONAL_GRANT_PERMISSIONS = [
  "private_health_read", "clinical_write", "sample_submit", "evidence_review",
  "official_attestation", "private_file_export", ...GENETIC_GRANT_PERMISSIONS,
] as const;
export type ProfessionalGrantPermission = (typeof PROFESSIONAL_GRANT_PERMISSIONS)[number];

export const PROFESSIONAL_KINDS = [
  "veterinarian", "laboratory", "farrier", "physiotherapist", "dentist",
  "nutritionist", "federation_official",
] as const;
export type ProfessionalKind = (typeof PROFESSIONAL_KINDS)[number];

/** A grant narrows a profession's powers. Review and publication never imply
 * evidence reading: reviewers additionally need genetic_evidence_read. */
export const PROFESSIONAL_KIND_PERMISSIONS: Record<ProfessionalKind, readonly ProfessionalGrantPermission[]> = {
  veterinarian: ["private_health_read", "clinical_write", "sample_submit", "evidence_review", "private_file_export", ...GENETIC_GRANT_PERMISSIONS],
  laboratory: ["private_health_read", "sample_submit", "evidence_review", "private_file_export", ...GENETIC_GRANT_PERMISSIONS],
  farrier: ["private_health_read", "clinical_write", "private_file_export"],
  physiotherapist: ["private_health_read", "clinical_write", "private_file_export"],
  dentist: ["private_health_read", "clinical_write", "private_file_export"],
  nutritionist: ["private_health_read", "clinical_write", "private_file_export"],
  federation_official: ["private_health_read", "evidence_review", "official_attestation", "private_file_export", ...GENETIC_GRANT_PERMISSIONS],
};

export const PROFESSIONAL_GRANT_BASES = ["admin_grant", "owner_consent", "institution_assignment"] as const;
export type ProfessionalGrantBasis = (typeof PROFESSIONAL_GRANT_BASES)[number];

export const GENETIC_ACCESS_POLICY_VERSION = "r148.horse-scoped-genetics.1";
export interface GeneticAccessResponse {
  horse_id: number;
  policy_version: typeof GENETIC_ACCESS_POLICY_VERSION;
  permissions: Array<GeneticGrantPermission | "private_health_read">;
  can_view_private_evidence: boolean;
  can_view_verified_health_results: boolean;
  can_intake: boolean;
  can_review: boolean;
  can_publish: boolean;
}
