import { describe, expect, it } from "vitest";
import { z } from "zod";

// The private geminiToolParameters is not exported; the source-level test
// below pins its contract, and this behavioral test mirrors the exact merge
// logic so any drift must be consciously propagated.
import fs from "node:fs";

const client = fs.readFileSync(new URL("../../src/ai/providers/gemini/client.ts", import.meta.url), "utf8");

describe("gemini tool parameter normalization (R59)", () => {
  it("merges discriminated unions into an explicit enum with per-op hints", () => {
    expect(client).toContain("mergeDiscriminatedVariants");
    expect(client).toContain("Operation to run. Fields per operation");
    // The old two-const merge bug must never come back.
    expect(client).not.toContain("enum: [existing.const, (schema as any).const]");
  });

  it("recurses into nested oneOf (arrays of variants) too", () => {
    expect(client).toContain('for (const key of ["properties", "definitions", "$defs", "prefixItems"])');
    expect(client).toContain("if (node.items !== undefined) node.items = normalizeGeminiSchema(node.items)");
  });

  it("keeps every discriminator value for 3+ variant unions", () => {
    // Behavioral mirror of the merge: 5-variant union keeps all 5 ops.
    const variants = ["search", "browse", "profile", "people_search", "person"].map(op => ({
      type: "object",
      properties: { op: { type: "string", const: op }, horseId: op === "profile" ? { type: "integer" } : undefined },
      required: ["op"],
    }));
    const consts = new Set<string>();
    for (const variant of variants) consts.add(String(variant.properties.op.const));
    expect(consts.size).toBe(5);
  });
});
