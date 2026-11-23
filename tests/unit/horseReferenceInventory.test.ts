import { describe, expect, it } from "vitest";
import {
  HORSE_REFERENCE_INVENTORY,
  HORSE_REFERENCE_INVENTORY_VERSION,
  MERGE_ARCHIVE_PAIRS,
  MERGE_MOVE_PAIRS,
  type HorseReferenceDisposition,
} from "../../src/registry/horseReferenceInventory";

/**
 * R117-19: the horse-reference inventory is the single source of truth for the
 * merge/unmerge commands. These invariants pin its structural integrity; the
 * schema cross-check against the real migration chain runs in
 * tools/validate-horse-reference-inventory.mjs (wired into `npm run check`).
 */

const VALID_DISPOSITIONS: ReadonlySet<HorseReferenceDisposition> = new Set([
  "moves", "archives", "stays_with_merged_subject", "requires_companion_operation", "immutable_history", "derived_data",
]);

describe("R117-19 horse-reference inventory — policy invariants", () => {
  it("carries a dated version and exactly one classified entry per (table, column)", () => {
    expect(HORSE_REFERENCE_INVENTORY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    const seen = new Set<string>();
    for (const entry of HORSE_REFERENCE_INVENTORY) {
      const key = `${entry.table}.${entry.column}`;
      expect(seen.has(key), `duplicate inventory entry ${key}`).toBe(false);
      seen.add(key);
      expect(VALID_DISPOSITIONS.has(entry.disposition), `${key} has an unknown disposition`).toBe(true);
      expect(entry.note.length, `${key} must explain its disposition`).toBeGreaterThan(20);
    }
    // The complete migration chain currently yields classified references
    // through R154 (private genetic receipts, typed policy history, and the
    // horse_racing_stats derived crosswalk pair).
    expect(HORSE_REFERENCE_INVENTORY).toHaveLength(69);
  });

  it("derives the move set (16 pairs) and the archive set (horse_identifiers) from the policy, not a hand list", () => {
    expect(MERGE_MOVE_PAIRS).toHaveLength(16);
    expect(MERGE_MOVE_PAIRS.map((pair) => `${pair.table}.${pair.column}`).sort()).toEqual([
      "attestations.horse_id", "breeding_records.dam_id", "breeding_records.foal_id", "breeding_records.sire_id",
      "competition_results.horse_id", "genetic_tests.horse_id", "horse_access_grants.horse_id", "horse_lifecycle_events.horse_id",
      "horse_media.horse_id", "horse_ownership_periods.horse_id", "horse_people.horse_id", "horses.father_id",
      "horses.mother_id", "professional_access_grants.horse_id", "publication_decisions.horse_id", "sales_listings.horse_id",
    ].sort());
    expect(MERGE_ARCHIVE_PAIRS).toEqual([{ table: "horse_identifiers", column: "horse_id" }]);
  });

  it("declares the composite row key for horse_people (the table with no id column) and id keys elsewhere", () => {
    const horsePeople = HORSE_REFERENCE_INVENTORY.find((entry) => entry.table === "horse_people" && entry.column === "horse_id");
    expect(horsePeople?.primaryKey).toBe("person_id+role");
    expect(horsePeople?.disposition).toBe("moves");
    for (const pair of MERGE_MOVE_PAIRS) {
      if (pair.table === "horse_people") expect(pair.key).toBe("person_id+role");
      else expect(pair.key, `${pair.table}.${pair.column} defaults to the id key`).toBe("id");
    }
  });

  it("keeps the approved import-row identity and the audit trail in immutable history", () => {
    const stagingRow = HORSE_REFERENCE_INVENTORY.find((entry) => entry.table === "import_staging_rows" && entry.column === "horse_id");
    expect(stagingRow?.disposition).toBe("immutable_history");
    const audits = HORSE_REFERENCE_INVENTORY.find((entry) => entry.table === "audit_events" && entry.column === "entity_id");
    expect(audits?.disposition).toBe("immutable_history");
    expect(audits?.virtual).toBe(true);
    for(const table of ["registry_rule_outcomes","registry_policy_receipts"]) {
      const policy=HORSE_REFERENCE_INVENTORY.find(entry=>entry.table===table && entry.column==="subject_ref");
      expect(policy,`${table} keeps its historical evaluated subject`).toMatchObject({disposition:"immutable_history",virtual:true});
      expect(MERGE_MOVE_PAIRS.some(pair=>pair.table===table)).toBe(false);
      expect(MERGE_ARCHIVE_PAIRS.some(pair=>pair.table===table)).toBe(false);
    }
  });

  it("preserves genetic operation receipts under their original horse scope across merge", () => {
    const receipt=HORSE_REFERENCE_INVENTORY.find(entry=>entry.table==="genetic_evidence_operations" && entry.column==="horse_id");
    expect(receipt).toMatchObject({kind:"fk",disposition:"stays_with_merged_subject"});
    expect(receipt?.note).toMatch(/original.*horse scope/);
    expect(MERGE_MOVE_PAIRS.some(pair=>pair.table==="genetic_evidence_operations")).toBe(false);
    expect(MERGE_ARCHIVE_PAIRS.some(pair=>pair.table==="genetic_evidence_operations")).toBe(false);
  });

  it("routes workspace content to reviewed companion operations, never to silent moves", () => {
    for (const table of ["workspace_collection_members", "workspace_tasks", "workspace_documents"]) {
      const entry = HORSE_REFERENCE_INVENTORY.find((candidate) => candidate.table === table && candidate.column === "horse_id");
      expect(entry?.disposition, `${table} must require a companion operation`).toBe("requires_companion_operation");
    }
  });

  it("keeps claims, requests, certificates, extracts and snapshots with the merged subject", () => {
    for (const table of ["horse_claims", "change_requests", "service_requests", "registry_certificates", "registry_extracts", "dossier_snapshots", "attestation_snapshots", "data_quality_issues", "horse_aliases", "horse_reference_intelligence"]) {
      const entry = HORSE_REFERENCE_INVENTORY.find((candidate) => candidate.table === table && candidate.column === "horse_id");
      expect(entry?.disposition, `${table} stays with its original subject`).toBe("stays_with_merged_subject");
    }
  });
});
