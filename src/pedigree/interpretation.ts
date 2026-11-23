/**
 * Evidence-aware pedigree interpretation (Master-Ai plan T26, finding F20).
 *
 * The coefficient engine (coefficients.ts) is preserved: its finite-pedigree
 * matrix math, cycle/truncation suppression and founder assumptions stay
 * untouched. What changes is the INTERPRETATION layer: a comparative label
 * such as "outcross" claims the parents are unrelated — that claim is only
 * meaningful when enough ancestry is actually recorded. Two founder-only
 * horses yield COI = 0 over ZERO observed ancestors, which is absence of
 * evidence, not evidence of unrelatedness.
 *
 * Policy thresholds below are a documented, versioned POLICY CHOICE for this
 * registry. They are not presented as scientific consensus; the policy
 * version is exposed with every verdict so labels can be re-audited when
 * the thresholds are reviewed.
 */
import type { BreedingMatingVerdict, RelationshipResponse } from "../contracts/platform";
import type { RelationshipCoefficientMetrics } from "./coefficients";
import { calculatePedigreeCoverage, type LoadedAncestorGraph } from "./engine";

export const ANCESTRY_QUALITY_POLICY_VERSION = "2026-10-03.1";

/**
 * Minimum observed ancestor positions per parent graph (2 = both parents of
 * the parent recorded) required before comparative labels are allowed.
 */
export const MIN_KNOWN_ANCESTOR_POSITIONS_PER_PARENT = 2;

/**
 * Minimum pedigree completeness (percent of expected ancestor positions at
 * the analyzed depth) on EACH parent before comparative labels are allowed.
 */
export const MIN_PARENT_PEDIGREE_COMPLETENESS_PERCENT = 25;

export interface AncestryQuality {
  /** Known ancestor positions in the sire's graph at the analyzed depth. */
  sireKnownAncestorPositions: number;
  /** Known ancestor positions in the dam's graph at the analyzed depth. */
  damKnownAncestorPositions: number;
  /** Combined known ancestor positions across both graphs. */
  observedAncestorPositions: number;
  /** Completeness percent of the less-complete parent graph (null when unknown). */
  minParentPedigreeCompletenessPercent: number | null;
  /** True when the policy threshold allows comparative labels. */
  sufficientForComparativeLabels: boolean;
  /** Version of the threshold policy applied to this verdict. */
  policyVersion: string;
  /** Human-readable statement that this is a policy choice, not consensus. */
  policyNote: string;
}

export function buildAncestryQuality(
  sireGraph: LoadedAncestorGraph,
  damGraph: LoadedAncestorGraph,
  depth: number,
): AncestryQuality {
  const sireCoverage = calculatePedigreeCoverage(sireGraph, depth);
  const damCoverage = calculatePedigreeCoverage(damGraph, depth);
  const sireKnown = sireCoverage.knownAncestorPositions;
  const damKnown = damCoverage.knownAncestorPositions;
  const minCompleteness = Math.min(sireCoverage.completenessPercent, damCoverage.completenessPercent);
  const sufficient =
    sireKnown >= MIN_KNOWN_ANCESTOR_POSITIONS_PER_PARENT &&
    damKnown >= MIN_KNOWN_ANCESTOR_POSITIONS_PER_PARENT &&
    minCompleteness >= MIN_PARENT_PEDIGREE_COMPLETENESS_PERCENT;
  return {
    sireKnownAncestorPositions: sireKnown,
    damKnownAncestorPositions: damKnown,
    observedAncestorPositions: sireKnown + damKnown,
    minParentPedigreeCompletenessPercent: Number.isFinite(minCompleteness) ? minCompleteness : null,
    sufficientForComparativeLabels: sufficient,
    policyVersion: ANCESTRY_QUALITY_POLICY_VERSION,
    policyNote:
      "Comparative pedigree labels require a minimum of recorded ancestry defined by this registry's documented policy; the threshold is a policy choice, not a scientific consensus.",
  };
}

export type MatingBandClassification =
  | "outcross"
  | "mild_linebreeding"
  | "linebreeding"
  | "close_inbreeding"
  | "insufficient_ancestry"
  | "unknown";

/**
 * Band classification gated by ancestry quality. When evidence is
 * insufficient the classification is `insufficient_ancestry` — never a
 * positive "outcross" claim built on unobserved ancestry.
 */
export function classifyMatingBand(coiPercent: number | null, sufficientAncestry: boolean): MatingBandClassification {
  if (coiPercent == null || !Number.isFinite(coiPercent) || coiPercent < 0 || coiPercent > 100) return "unknown";
  if (!sufficientAncestry) return "insufficient_ancestry";
  if (coiPercent < 1) return "outcross";
  if (coiPercent < 6.25) return "mild_linebreeding";
  if (coiPercent < 12.5) return "linebreeding";
  return "close_inbreeding";
}

export const MATING_BAND_LABELS: Record<MatingBandClassification, string> = {
  outcross: "Outcross — projected offspring COI below 1%",
  mild_linebreeding: "Mild linebreeding — projected COI 1–6.25%",
  linebreeding: "Linebreeding — projected COI 6.25–12.5%",
  close_inbreeding: "Close inbreeding — projected COI 12.5% or higher",
  insufficient_ancestry:
    "Insufficient ancestry — too few recorded ancestors behind this pairing for a comparative label; the COI estimate over unobserved ancestry is not evidence of unrelatedness",
  unknown: "Unknown — insufficient pedigree for classification",
};

/**
 * Verdict builder (moved here from breeding.ts — this IS the interpretation
 * layer). Band classification is gated by ancestry quality: sparse-ancestry
 * pairings get `insufficient_ancestry`, never a positive outcross label.
 * The close-mating warning is independent of ancestry quality: a recorded
 * full-sib/half-sib/parent-offspring pairing is flagged even when the
 * deeper ancestry is sparse.
 */
export function buildBreedingMatingVerdict(
  coefficients: RelationshipCoefficientMetrics,
  relationship: RelationshipResponse,
  ancestryQuality?: AncestryQuality,
): BreedingMatingVerdict {
  const coi = coefficients.kinshipPercent;
  const sufficient = ancestryQuality ? ancestryQuality.sufficientForComparativeLabels : false;
  const classification = classifyMatingBand(coi, sufficient);
  const classificationLabel = MATING_BAND_LABELS[classification];
  const relationshipKind = relationship.summary?.kind ?? null;
  const close = relationshipKind === "full_sibling" || relationshipKind === "half_sibling" || relationshipKind === "direct_ancestor" || relationshipKind === "direct_descendant" || relationshipKind === "same_horse";
  const closestCommonAncestorGeneration = relationship.commonAncestors.length
    ? Math.min(...relationship.commonAncestors.map((a) => a.fromDepth + a.toDepth))
    : null;
  return {
    classification,
    classificationLabel,
    relationshipKind,
    closeMatingWarning: close,
    closeMatingWarningText: close
      ? "The recorded pairing includes the same horse, siblings, or a direct ancestral relationship. Review the recorded relationship and genetic evidence with a qualified breeding specialist; this is not a mating recommendation."
      : null,
    closestCommonAncestorGeneration,
    ...(ancestryQuality ? { ancestryQuality } : {}),
  };
}
