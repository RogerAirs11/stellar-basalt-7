import { describe, expect, it } from "vitest";
import { JSON_COMPLEXITY_LIMITS, assertJsonEvidenceComplexity } from "../../src/security/jsonComplexity";
import { HttpError } from "../../src/api/http";

/** Build a container with `entries` entries, each entry value distinct. */
function wideArray(entries: number): unknown[] {
  return Array.from({ length: entries }, (_, index) => index);
}
function wideObject(entries: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: entries }, (_, index) => [`k${index}`, index]));
}
/** Build a nested chain `levels` deep iteratively (no recursive construction). */
function deepChain(levels: number): unknown {
  let node: unknown = "leaf";
  for (let depth = 0; depth < levels; depth += 1) node = { child: node };
  return node;
}

describe("D11 JSON structural-complexity guard", () => {
  it("accepts ordinary workflow evidence", () => {
    const evidence = {
      registration_contract: "Contract #A-1102",
      transfer_date: "2026-01-15",
      witnesses: [{ name: "W1", contact: "w1@example.test" }, { name: "W2", contact: "w2@example.test" }],
      nested: { a: { b: { c: [1, 2, 3, { deep: "value" }] } } },
    };
    expect(() => assertJsonEvidenceComplexity(evidence)).not.toThrow();
  });

  it("accepts a 128-entry container and rejects a 129-entry container (array and object)", () => {
    expect(() => assertJsonEvidenceComplexity(wideArray(128))).not.toThrow();
    expect(() => assertJsonEvidenceComplexity(wideObject(128))).not.toThrow();
    try {
      assertJsonEvidenceComplexity(wideArray(129));
      expect.unreachable("129-entry array must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(HttpError);
      expect(cause).toMatchObject({ status: 400, code: "evidence_too_complex", details: { limit: "container_entries" } });
    }
    try {
      assertJsonEvidenceComplexity(wideObject(129));
      expect.unreachable("129-entry object must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(HttpError);
      expect(cause).toMatchObject({ status: 400, code: "evidence_too_complex", details: { limit: "container_entries" } });
    }
  });

  it("accepts a 16 KiB string and rejects a 17 KiB string", () => {
    expect(() => assertJsonEvidenceComplexity("x".repeat(JSON_COMPLEXITY_LIMITS.maxStringBytes))).not.toThrow();
    try {
      assertJsonEvidenceComplexity({ note: "y".repeat(17 * 1024) });
      expect.unreachable("17 KiB string must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(HttpError);
      expect(cause).toMatchObject({ status: 400, code: "evidence_too_complex", details: { limit: "string_bytes" } });
    }
  });

  it("accepts depth up to maxDepth and rejects over-depth input", () => {
    // deepChain(n) produces n wrapper objects + 1 leaf = n + 1 levels.
    expect(() => assertJsonEvidenceComplexity(deepChain(JSON_COMPLEXITY_LIMITS.maxDepth - 1))).not.toThrow();
    try {
      assertJsonEvidenceComplexity(deepChain(JSON_COMPLEXITY_LIMITS.maxDepth));
      expect.unreachable("over-depth value must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(HttpError);
      expect(cause).toMatchObject({ status: 400, code: "evidence_too_complex", details: { limit: "depth" } });
    }
  });

  it("rejects excessive total-node input with the named limit", () => {
    // 1 root + 100 containers + 100 x 20 entries = 2101 nodes; every container stays legal.
    const tree = Array.from({ length: 100 }, (_, container) =>
      Array.from({ length: 20 }, (__, entry) => container * 100 + entry));
    try {
      assertJsonEvidenceComplexity(tree);
      expect.unreachable("excessive total-node value must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(HttpError);
      expect(cause).toMatchObject({ status: 400, code: "evidence_too_complex", details: { limit: "total_nodes" } });
    }
  });

  it("rejects over-long object keys", () => {
    const longKey = "k".repeat(JSON_COMPLEXITY_LIMITS.maxKeyLength + 1);
    try {
      assertJsonEvidenceComplexity({ [longKey]: 1 });
      expect.unreachable("over-long key must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(HttpError);
      expect(cause).toMatchObject({ status: 400, code: "evidence_too_complex", details: { limit: "key_length" } });
    }
  });

  it("is stack-safe: a pathologically deep value fails with a controlled 400, never a crash", () => {
    // 100,000 levels; iterative guard must return a controlled error instead of overflowing.
    expect(() => assertJsonEvidenceComplexity(deepChain(100_000))).toThrow(HttpError);
  });
});
