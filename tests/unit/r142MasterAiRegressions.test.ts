import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { batchDigest, normalizeImportRow } from "../../src/registry/importStaging";
import { validateParentAssignment } from "../../src/pedigree/integrity";
import { PAIRING_EVIDENCE_POLICY_VERSION } from "../../src/genetics/pairingProjection";
import { BREEDING_OPTIMIZER_ALGORITHM_VERSION } from "../../src/pedigree/breeding";

/**
 * R142 — regressions for the five defect conditions Master AI reproduced in
 * the R141 audit (pairing disclosure leak, cache refresh without writes,
 * lifecycle non-atomicity, ownership receipt identity, per-parent optimizer
 * eligibility) plus the import digest/publication/mapping corrections.
 * Route-level behavior is exercised by the integration suite; these tests pin
 * the SQL/boundary contracts the fixes live in (same pattern as
 * breedingOptimizerGuard.test.ts).
 */

function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            all: async () => ({ results: rows }),
            first: async () => rows[0] ?? null,
          };
        },
      };
    },
  } as unknown as Parameters<typeof validateParentAssignment>[0];
}

describe("R142-B01 pairing projection disclosure gate", () => {
  it("filters undisclosed disease evidence at the SQL boundary, before any calculation", () => {
    const source = readFileSync("src/genetics/pairingProjection.ts", "utf8");
    expect(source).toContain("COALESCE(g.public_disclosed,0)=1");
    // R148 resolves each horse separately inside the evidence SELECT. The
    // old single role boolean must never unlock both parents or their counts.
    expect(source).toContain('geneticActionPredicate(viewer, { column: "h.id" }, ["genetic_evidence_read"])');
    expect(source).toContain('geneticActionPredicate(viewer, { column: "h.id" }, ["private_health_read"])');
    expect(source).toContain("LEFT JOIN genetic_tests g ON g.horse_id=s.id");
    expect(source).toContain("g.verified=1 AND (COALESCE(g.public_disclosed,0)=1 OR s.can_health=1)");
    expect(source).not.toContain("canViewPrivateGeneticEvidence(viewer)");
    expect(PAIRING_EVIDENCE_POLICY_VERSION).toBe("r148.horse-scoped-genetics.1");
  });

  it("applies the same gate to the public attestation listing", () => {
    const source = readFileSync("src/trust/attestationStore.ts", "utf8");
    expect(source).toContain("g.test_category<>'disease' OR COALESCE(g.public_disclosed,0)=1");
  });
});

describe("R142-B02 edge cache refresh writes + stale containment", () => {
  it("makes storeEdgeCopies an awaited operation used by the revalidation path", () => {
    const worker = readFileSync("src/worker.ts", "utf8");
    expect(worker).toContain("async function storeEdgeCopies(");
    expect(worker).toContain("await storeEdgeCopies(request, cache, secured.clone(), cacheTtl);");
    // the request path must still schedule it inside waitUntil (non-blocking)
    expect(worker).toContain("ctx?.waitUntil(storeEdgeCopies(");
  });

  it("limits stale retrieval and storage to the current fresh-cache allowlist", () => {
    const worker = readFileSync("src/worker.ts", "utf8");
    expect(worker).toContain("function staleEligible(");
    expect(worker).toContain("return edgeCacheTtl(pathname) !== null;");
    expect(worker).toContain("...(staleOk ? [cache.put(edgeStaleKey(request), forStale).catch(() => undefined)] : []),");
  });

  it("purges the horse's edge copies when a disclosure is withdrawn", () => {
    const genetics = readFileSync("src/api/modules/genetics.ts", "utf8");
    expect(genetics).toContain("__edge_stale=1");
    expect(genetics).toContain("`/api/horses/${test.horse_id}/genetics`");
  });
});

// Lifecycle CAS and ownership receipt/overlap are exercised against real
// sessions and migrated database transactions in backend-hardening.test.ts.
// Source-string tests for the former insert-first/compensation design were
// removed because they required the unsafe implementation order to remain.

describe("R142-B05 per-parent optimizer eligibility", () => {
  it("excludes on the weaker parent's coverage and reports both sides", () => {
    const source = readFileSync("src/pedigree/breeding.ts", "utf8");
    expect(source).toContain("const weakestParentCoverage = Math.min(sireCoverage ?? 0, damCoverage ?? 0);");
    expect(source).toContain("insufficientAncestryMessage(weakestParentCoverage)");
    expect(BREEDING_OPTIMIZER_ALGORITHM_VERSION).toBe("1.3.0");
  });
});

describe("R142-B07 import digest separation", () => {
  const base = {
    external_id: "EXT-1",
    register_no: "IR-001",
    name_latin: "Kohar",
    birth_year: 2020,
  };

  it("keeps the identity fingerprint stable while nonidentity evidence changes the content digest", async () => {
    const a = await normalizeImportRow({ ...base });
    const b = await normalizeImportRow({ ...base, sex: "Mare", breed: "Persian Arabian" });
    const c = await normalizeImportRow({ ...base, external_id: "EXT-2" });
    // identity fingerprint ignores nonidentity fields
    expect(b.checksum).toBe(a.checksum);
    // content digest covers ALL evidence — sex/breed and external ids included
    expect(b.contentChecksum).not.toBe(a.contentChecksum);
    expect(c.contentChecksum).not.toBe(a.contentChecksum);
    expect(c.checksum).toBe(a.checksum);
  });

  it("is insensitive to JSON key ordering", async () => {
    const a = await normalizeImportRow({ ...base, sex: "Mare" });
    const b = await normalizeImportRow({ sex: "Mare", birth_year: 2020, name_latin: "Kohar", register_no: "IR-001", external_id: "EXT-1" });
    expect(b.contentChecksum).toBe(a.contentChecksum);
  });

  it("binds the batch replay digest to complete content, not identity only", async () => {
    const d1 = await batchDigest([{ ...base }], "v1");
    const d2 = await batchDigest([{ ...base, sex: "Mare" }], "v1");
    const d3 = await batchDigest([{ ...base }], "v2");
    expect(d2).not.toBe(d1);
    expect(d3).not.toBe(d1);
  });
});

describe("R142-B09 shared sex-role vocabulary", () => {
  it("rejects a recorded 'Female' sire — the label the local lists missed", async () => {
    const db = fakeDb([{ id: 11, sex_desc: "Female" }]);
    const result = await validateParentAssignment(db, null, 11, null);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "parent_sex_role")).toBe(true);
  });

  it("allows a historical sire subsequently gelded, but rejects male-role dams", async () => {
    const geldingSire = await validateParentAssignment(fakeDb([{ id: 12, sex_desc: "Gelding" }]), null, 12, null);
    expect(geldingSire.valid).toBe(true);
    const maleDam = await validateParentAssignment(fakeDb([{ id: 13, sex_desc: "Stallion" }]), null, null, 13);
    expect(maleDam.valid).toBe(false);
  });

  it("still accepts correctly sexed parents and unknown historical values", async () => {
    const ok = await validateParentAssignment(fakeDb([{ id: 14, sex_desc: "Stallion" }, { id: 15, sex_desc: "مادیان" }]), null, 14, 15);
    expect(ok.valid).toBe(true);
    const unknown = await validateParentAssignment(fakeDb([{ id: 16, sex_desc: null }]), null, 16, null);
    expect(unknown.valid).toBe(true);
  });
});

describe("R142-B06/B08 import publication gating + field coverage", () => {
  it("separates private ingest from publication for non-redistributable sources", () => {
    const source = readFileSync("src/api/modules/imports.ts", "utf8");
    expect(source).toContain("const publicationAllowed = Number(source.redistribution_allowed) === 1;");
    expect(source).toContain("data_origin,is_active,last_mutation_id");
  });

  it("applies breed and sex on create and fill-once on update", () => {
    const source = readFileSync("src/api/modules/imports.ts", "utf8");
    expect(source).toContain("INSERT INTO horses(register_no,microchip_no,name_latin,name_native,birth_year,breed_desc,sex_desc,data_origin,is_active,last_mutation_id)");
    expect(source).toContain("breed_desc = CASE WHEN breed_desc IS NULL AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE breed_desc END");
    expect(source).toContain("sex_desc = CASE WHEN sex_desc IS NULL AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE sex_desc END");
  });
});
