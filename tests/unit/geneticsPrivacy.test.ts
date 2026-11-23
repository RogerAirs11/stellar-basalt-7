import { describe, expect, it } from "vitest";
import {
  canViewPrivateGeneticEvidence,
  projectBreedingRecord,
  projectGeneticTest,
  type PrivacyViewer,
} from "../../src/privacy/projections";

/**
 * Master-AI plan T03 (finding F01): the genetics/breedings GET endpoints
 * returned lab accession numbers, private notes and editorial interpretation
 * text to ANY anonymous caller. Projection must be allowlisted per viewer.
 */
const fullTestRow = {
  id: 7,
  horse_id: 41,
  test_type: "SCID",
  test_category: "disease",
  result: "N/SCID",
  result_status: "carrier" as const,
  result_interpretation: "Editorial note: owner advised",
  lab_name: "Lab Tejarat",
  lab_accession: "LAB-2026-000123",
  tested_at: "2026-01-15",
  verified: 1,
  provenance: "user",
  notes: "Private staff note",
};

const staffViewer: PrivacyViewer = { user: { id: "u1", role: "editor" } };
const adminViewer: PrivacyViewer = { user: { id: "u2", role: "super_admin" } };
const evidenceViewer: PrivacyViewer = { user: { id: "u5", role: "user" }, geneticScope: { horseId: 41, evidenceRead: true, verifiedHealthRead: false } };
const resultViewer: PrivacyViewer = { user: { id: "u6", role: "user" }, geneticScope: { horseId: 41, evidenceRead: false, verifiedHealthRead: true } };
const plainViewer: PrivacyViewer = { user: { id: "u3", role: "user" } };
const ownerViewer: PrivacyViewer = { user: { id: "u4", role: "owner" } };

describe("genetics privacy projection (T03 / F01)", () => {
  it("strips lab accession, notes and editorial interpretation from disclosed public DTOs", () => {
    // R140-A: disease rows need public_disclosed=1 to cross the public boundary.
    const projected = projectGeneticTest({ ...fullTestRow, public_disclosed: 1 }, null)!;
    expect(projected).toMatchObject({ id: 7, test_type: "SCID", result: "N/SCID", verified: 1, public_disclosed: 1 });
    expect("lab_accession" in projected && projected.lab_accession !== null).toBe(false);
    expect("notes" in projected && projected.notes !== null).toBe(false);
    expect("result_interpretation" in projected && projected.result_interpretation !== null).toBe(false);
  });

  it("keeps private evidence fields only for the resolved exact-horse evidence scope", () => {
    for (const viewer of [evidenceViewer]) {
      const projected = projectGeneticTest(fullTestRow, viewer)!;
      expect(projected.lab_accession).toBe("LAB-2026-000123");
      expect(projected.notes).toBe("Private staff note");
    }
  });

  it("hides unverified tests from anonymous and non-privileged viewers", () => {
    const unverified = { ...fullTestRow, verified: 0 };
    expect(projectGeneticTest(unverified, null)).toBeNull();
    expect(projectGeneticTest(unverified, plainViewer)).toBeNull();
    expect(projectGeneticTest(unverified, ownerViewer)).toBeNull();
    expect(projectGeneticTest(unverified, staffViewer)).toBeNull();
    expect(projectGeneticTest(unverified, adminViewer)).toBeNull();
    expect(projectGeneticTest(unverified, resultViewer)).toBeNull();
    expect(projectGeneticTest(unverified, evidenceViewer)).not.toBeNull();
  });

  it("keeps identity-adjacent categories on the verified=>public rule", () => {
    const coat = { ...fullTestRow, test_category: "coat_color", test_type: "extension_MC1R", result: "e/e" };
    const parentage = { ...fullTestRow, test_category: "parentage", test_type: "STR-panel", result: "16/17" };
    expect(projectGeneticTest(coat, null)).not.toBeNull();
    expect(projectGeneticTest(parentage, null)).not.toBeNull();
  });

  it("requires an exact resolved horse scope, never role or ownership", () => {
    for (const viewer of [null,plainViewer,ownerViewer,staffViewer,adminViewer]) {
      expect(canViewPrivateGeneticEvidence(viewer,41)).toBe(false);
    }
    expect(canViewPrivateGeneticEvidence(evidenceViewer,41)).toBe(true);
    expect(canViewPrivateGeneticEvidence(evidenceViewer,42)).toBe(false);
    expect(canViewPrivateGeneticEvidence(evidenceViewer)).toBe(false);
    expect(projectGeneticTest(fullTestRow,resultViewer)?.lab_accession).toBeNull();
    expect(projectGeneticTest({...fullTestRow,horse_id:42},evidenceViewer)).toBeNull();
  });
});

// Migration pin: the disclosure column must exist exactly where the projection
// expects it (same pattern as the T11 migration acceptance pins).
describe("genetics disclosure migration pin (R140-A)", () => {
  it("migration 0101 adds public_disclosed with a private-by-default zero default", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("migrations/0101_disease_result_disclosure.sql", "utf8");
    expect(sql).toContain("ALTER TABLE genetic_tests ADD COLUMN public_disclosed INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("idx_genetic_tests_disclosure");
  });
});

// R140-A (second Master-AI audit): verification is NOT publication permission.
// Verified disease/health results are private-by-default — visible to
// privileged staff always, and to everyone only after an explicit disclosure
// decision (public_disclosed=1). Unverified rows are never published.
describe("genetics health-data decoupling (R140-A)", () => {
  it("hides verified disease results from anonymous and non-privileged viewers", () => {
    expect(projectGeneticTest(fullTestRow, null)).toBeNull();
    expect(projectGeneticTest(fullTestRow, plainViewer)).toBeNull();
    expect(projectGeneticTest(fullTestRow, ownerViewer)).toBeNull();
  });

  it("shows verified disease results to the resolved scoped evidence viewer", () => {
    for (const viewer of [evidenceViewer]) {
      const projected = projectGeneticTest(fullTestRow, viewer)!;
      expect(projected.result).toBe("N/SCID");
      expect(projected.public_disclosed).toBe(0);
    }
  });

  it("publishes verified disease results to anonymous viewers only after disclosure", () => {
    const disclosed = { ...fullTestRow, public_disclosed: 1 };
    const projected = projectGeneticTest(disclosed, null)!;
    expect(projected.result).toBe("N/SCID");
    expect(projected.result_status).toBe("carrier");
    expect(projected.lab_accession).toBeNull();
    expect(projected.notes).toBeNull();
  });

  it("never publishes unverified disease results even when disclosed", () => {
    const unverifiedDisclosed = { ...fullTestRow, verified: 0, public_disclosed: 1 };
    expect(projectGeneticTest(unverifiedDisclosed, null)).toBeNull();
    expect(projectGeneticTest(unverifiedDisclosed, plainViewer)).toBeNull();
    expect(projectGeneticTest(unverifiedDisclosed, ownerViewer)).toBeNull();
  });

  it("reports public_disclosed=1 for non-health categories (published by rule)", () => {
    const coat = { ...fullTestRow, test_category: "coat_color", test_type: "gray_STX17", result: "G/g" };
    expect(projectGeneticTest(coat, null)!.public_disclosed).toBe(1);
  });

  it("drops hidden disease rows from summaries so public counts stay honest", async () => {
    const { projectGeneticTests } = await import("../../src/privacy/projections");
    const { summarizeGeneticTests } = await import("../../src/genetics/assayCatalog");
    const rows = [fullTestRow, { ...fullTestRow, id: 8, public_disclosed: 1 }];
    const publicView = projectGeneticTests(rows as never, null);
    expect(publicView).toHaveLength(1);
    const summary = summarizeGeneticTests(publicView);
    expect(summary.tested).toBe(1);
    expect(summary.carriers).toBe(1);
    const staffView = projectGeneticTests(rows as never, evidenceViewer);
    expect(staffView).toHaveLength(2);
  });
});

describe("breedings privacy projection (T03)", () => {
  const breedingRow = {
    id: 3,
    sire_id: 1,
    dam_id: 2,
    covering_date: "2025-04-10",
    season: 1404,
    method: "natural",
    outcome: "foaled",
    foal_id: 9,
    provenance: "derived",
    notes: "Private covering note",
    sire_name: "Sire",
    dam_name: "Dam",
    foal_name: "Foal",
  };

  it("strips private notes from anonymous breeding DTOs but keeps registry facts", () => {
    const projected = projectBreedingRecord(breedingRow, null);
    expect(projected.season).toBe(1404);
    expect(projected.foal_id).toBe(9);
    expect(projected.provenance).toBe("derived");
    expect("notes" in projected && projected.notes !== null).toBe(false);
  });

  it("keeps notes only for the resolved scope covering both parents", () => {
    expect(projectBreedingRecord(breedingRow,staffViewer)?.notes).toBeNull();
    expect(projectBreedingRecord(breedingRow,{user:plainViewer.user,breedingNotesScope:{sireId:1,damId:2}})?.notes).toBe("Private covering note");
    expect(projectBreedingRecord(breedingRow,{user:plainViewer.user,breedingNotesScope:{sireId:1,damId:99}})?.notes).toBeNull();
  });
});
