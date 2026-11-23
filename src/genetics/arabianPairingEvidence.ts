import type { ArabianVariant, ArabianVariantEvidence, ResolvedVariantEvidence, ArabianVariantPairing, ArabianPairingEvidenceReport } from "../contracts/genetics";
import { resolveConservativeEvidence } from "./evidenceResolver";
export type { ArabianVariant, ArabianVariantEvidence, VariantEvidenceStatus, ResolvedVariantEvidence, ArabianVariantPairing, ArabianPairingEvidenceReport } from "../contracts/genetics";
/**
 * Pure, deterministic decision-support projection. NOT a clinical diagnosis,
 * breeding approval, live API, or a replacement for reviewed laboratory reports.
 * The caller must authorize and verify evidence before setting verified=true.
 * Free-text assay names are deliberately NOT auto-mapped into this catalogue.
 */
export const ARABIAN_PAIRING_MODEL_VERSION = "2026-10-21.r119.2";
export const ARABIAN_VARIANTS = ["SCID", "CA", "LFS", "OAAM1"] as const;

export const ARABIAN_VARIANT_SOURCES: Readonly<Record<ArabianVariant, string>> = Object.freeze({
  SCID: "https://vgl.ucdavis.edu/test/scid",
  CA: "https://vgl.ucdavis.edu/test/ca",
  LFS: "https://vgl.ucdavis.edu/test/lfs",
  OAAM1: "https://vgl.ucdavis.edu/test/oaam",
});
export const ARABIAN_PAIRING_LIMITS = Object.freeze({ maxEvidencePerHorse: 500, maxResultLength: 256 });
function validHorseId(id: number): boolean { return Number.isSafeInteger(id) && id > 0; }
function variantCopies(assay: ArabianVariant, raw: string): 0 | 1 | 2 | null {
  const parts = raw.trim().toUpperCase().split("/").map(value => value.trim());
  // The exact laboratory OAAM token is accepted only AFTER the caller has
  // explicitly mapped the assay to OAAM1. Generic OAAM prose is never mapped.
  const mutantTokens = assay === "OAAM1" ? ["OAAM", "OAAM1"] : [assay];
  if (parts.length !== 2 || parts.some(value => value !== "N" && !mutantTokens.includes(value))) return null;
  return parts.filter(value => mutantTokens.includes(value)).length as 0 | 1 | 2;
}
function validateEvidence(horseId: number, evidence: readonly ArabianVariantEvidence[]): void {
  if (!Array.isArray(evidence) || evidence.length > ARABIAN_PAIRING_LIMITS.maxEvidencePerHorse) throw new RangeError("Evidence must be a bounded array");
  const seen = new Set<string>();
  for (const row of evidence) {
    if (!row || row.horseId !== horseId || typeof row.evidenceId !== "string" || !row.evidenceId.trim() || row.evidenceId.length > 128
        || seen.has(row.evidenceId) || !(ARABIAN_VARIANTS as readonly string[]).includes(row.assayKey)
        || typeof row.result !== "string" || row.result.length > ARABIAN_PAIRING_LIMITS.maxResultLength || typeof row.verified !== "boolean") {
      throw new TypeError("Evidence must have a unique ID, exact horse/variant mapping, bounded result and explicit verification state");
    }
    seen.add(row.evidenceId);
  }
}
function resolve(variant: ArabianVariant, evidence: readonly ArabianVariantEvidence[]): ResolvedVariantEvidence {
  const relevant = evidence.filter(row => row.assayKey === variant);
  const resolution = resolveConservativeEvidence(
    relevant.map((row) => ({ id: row.evidenceId, result: row.result, verified: row.verified })),
    (result) => {
      const copies = variantCopies(variant, result);
      return copies === null ? null : { identity: String(copies), value: copies };
    },
  );
  return {
    status: resolution.status,
    variantCopies: resolution.value,
    consideredEvidenceIds: resolution.consideredEvidenceIds,
    unverifiedEvidenceIds: resolution.unverifiedEvidenceIds,
  };
}
export function analyzeArabianPairingEvidence(parentA: number, parentB: number,
  evidenceA: readonly ArabianVariantEvidence[], evidenceB: readonly ArabianVariantEvidence[]): ArabianPairingEvidenceReport {
  if (!validHorseId(parentA) || !validHorseId(parentB) || parentA === parentB) throw new RangeError("Pairing requires two distinct positive safe horse IDs");
  validateEvidence(parentA, evidenceA); validateEvidence(parentB, evidenceB);
  const variants = ARABIAN_VARIANTS.map((variant): ArabianVariantPairing => {
    const a = resolve(variant, evidenceA), b = resolve(variant, evidenceB);
    const calculable = a.status === "resolved" && b.status === "resolved";
    const p = (a.variantCopies ?? 0) / 2, q = (b.variantCopies ?? 0) / 2;
    return { variant, source: ARABIAN_VARIANT_SOURCES[variant], scope: "specified_variant_only", parentA: a, parentB: b,
      status: calculable ? "calculable" : "insufficient_evidence",
      probabilities: calculable ? { zeroVariantCopies: (1-p)*(1-q), oneVariantCopy: p*(1-q)+(1-p)*q, twoVariantCopies: p*q } : null };
  });
  return { modelVersion: ARABIAN_PAIRING_MODEL_VERSION, parentIds: [parentA, parentB], variants,
    calculableVariants: variants.filter(row => row.status === "calculable").length, totalVariants: ARABIAN_VARIANTS.length,
    limitationCodes: ["not_a_diagnosis", "not_breeding_approval", "not_a_genomic_score", "not_parentage_verification",
      "no_combined_health_probability", "oaam1_does_not_exclude_other_oaam_forms", "caller_must_authorize_and_verify_evidence"] };
}
