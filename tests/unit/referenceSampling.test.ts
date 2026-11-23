import { describe, expect, it } from "vitest";
import {
  REFERENCE_SAMPLING_HIGH_MAX_HALF_WIDTH_PERCENT,
  REFERENCE_SAMPLING_MEDIUM_MAX_HALF_WIDTH_PERCENT,
  classifyReferenceSamplingPrecision,
} from "../../src/pedigree/referenceSampling";

describe("reference sampling precision", () => {
  it("keeps estimator precision separate from pedigree confidence", () => {
    expect(classifyReferenceSamplingPrecision(null).grade).toBe("unavailable");
    expect(classifyReferenceSamplingPrecision(0.1)).toMatchObject({ grade: "high", approximate95HalfWidthPercent: 0.196 });
    expect(classifyReferenceSamplingPrecision(REFERENCE_SAMPLING_HIGH_MAX_HALF_WIDTH_PERCENT / 1.96 + 0.001).grade).toBe("medium");
    expect(classifyReferenceSamplingPrecision(REFERENCE_SAMPLING_MEDIUM_MAX_HALF_WIDTH_PERCENT / 1.96 + 0.001).grade).toBe("low");
  });
});
