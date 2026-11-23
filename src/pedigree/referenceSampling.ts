export const REFERENCE_SAMPLING_PRECISION_METHOD = "normal-half-width-calibration-v1" as const;
export const REFERENCE_SAMPLING_HIGH_MAX_HALF_WIDTH_PERCENT = 0.5;
export const REFERENCE_SAMPLING_MEDIUM_MAX_HALF_WIDTH_PERCENT = 1.0;

export type ReferenceSamplingPrecisionGrade = "high" | "medium" | "low" | "unavailable";

export interface ReferenceSamplingPrecision {
  grade: ReferenceSamplingPrecisionGrade;
  approximate95HalfWidthPercent: number | null;
  interpretation: string;
}

/**
 * Classify the numerical precision of a sampled pedigree mean-kinship estimate.
 *
 * This is deliberately separate from pedigree-completeness confidence. The
 * standard error describes how precisely the deterministic reference sample
 * estimates the reference-population mean; it does not describe pedigree data
 * quality, genomic certainty, or biological/genetic merit.
 */
export function classifyReferenceSamplingPrecision(standardErrorPercent: number | null): ReferenceSamplingPrecision {
  if (standardErrorPercent === null || !Number.isFinite(standardErrorPercent) || standardErrorPercent < 0) {
    return {
      grade: "unavailable",
      approximate95HalfWidthPercent: null,
      interpretation: "Sampling precision is unavailable because a valid sampled mean-kinship standard error is not available for this record.",
    };
  }
  const halfWidth = round(1.96 * standardErrorPercent, 4);
  const grade: ReferenceSamplingPrecisionGrade = halfWidth <= REFERENCE_SAMPLING_HIGH_MAX_HALF_WIDTH_PERCENT
    ? "high"
    : halfWidth <= REFERENCE_SAMPLING_MEDIUM_MAX_HALF_WIDTH_PERCENT
      ? "medium"
      : "low";
  return {
    grade,
    approximate95HalfWidthPercent: halfWidth,
    interpretation: `Sampling precision is graded from the normal-theory nominal 95% half-width (${halfWidth} percentage points) of the deterministic reference sample. The interval is a precision diagnostic, not a guarantee of 95% empirical coverage; pedigree structure can make sampling error non-normal. It is separate from pedigree completeness and is not genomic certainty.`,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
