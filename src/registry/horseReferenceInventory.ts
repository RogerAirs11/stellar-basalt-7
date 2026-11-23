/**
 * R117-19 (Master AI R117 handoff, D31 / NEXT_BACKEND.md D31-B): the complete,
 * machine-readable inventory of EVERY foreign-key and non-FK horse reference in
 * the canonical schema, with the explicit merge/unmerge disposition for each
 * one. This file is the single source of truth for the merge command — the
 * move set is DERIVED from it, never re-listed by hand.
 *
 * Doctrine (NEXT_BACKEND.md D31-B):
 *  - "A newly discovered reference is not automatically safe to move:
 *     ownership, publication consent and access-grant semantics must be
 *     preserved. Decide whether each reference moves, stays with its original
 *     subject, blocks the merge or requires a reviewed companion operation."
 *  - "Stop a real reversal if the reference inventory is incomplete or any
 *     target has unexplained newer writes."
 *
 * The inventory is enforced by tools/validate-horse-reference-inventory.mjs:
 * every horse-referencing column derived from migrations/*.sql MUST be
 * classified here, and every classified column MUST exist in the schema. A
 * future migration that adds a horse reference without a disposition breaks
 * the gate — merges and unmerges stop until the policy is extended.
 *
 * Dispositions:
 *  - moves: the FK row is re-pointed at the kept horse on merge and restored
 *    by the recorded manifest entry on unmerge (per-entry value-guarded).
 *  - archives: horse_identifiers live rows on the merged horse are archived
 *    (never deleted); unmerge restores them live on their original horse.
 *  - stays_with_merged_subject: the reference keeps pointing at the
 *    soft-deleted merged horse. It stays inspectable there; re-pointing it is
 *    a separate reviewed decision, never a merge side effect.
 *  - requires_companion_operation: the reference belongs to another
 *    principal's workflow surface (workspaces). The merge preview reports
 *    these counts as companion items; moving them would silently transfer
 *    content between subjects.
 *  - immutable_history: append-only or decision records that must never be
 *    rewritten by merge/unmerge (audits, review receipts, the approved import
 *    row identity, merge machinery itself).
 *  - derived_data: rebuilt by reindex/precompute jobs; never rewritten by the
 *    merge command (the reindex fan-out covers freshness).
 */

export const HORSE_REFERENCE_INVENTORY_VERSION = "2026-10-28.3";

export type HorseReferenceDisposition =
  | "moves"
  | "archives"
  | "stays_with_merged_subject"
  | "requires_companion_operation"
  | "immutable_history"
  | "derived_data";

export interface HorseReferenceEntry {
  table: string;
  column: string;
  kind: "fk" | "non_fk";
  /** `true` marks references that are not derivable from a column declaration
   * alone (e.g. audit_events.entity_id resolved through entity_type). */
  virtual?: boolean;
  /** Row identity for moves/archives entries: "id" (single integer/text PK) or
   * a composite declaration when the table has no id column (horse_people's
   * PK is (horse_id, person_id, role) — the pre-R117-19 merge crashed on
   * `SELECT id FROM horse_people`, a latent defect this inventory pins). */
  primaryKey?: "id" | "person_id+role";
  disposition: HorseReferenceDisposition;
  note: string;
}

export const HORSE_REFERENCE_INVENTORY: readonly HorseReferenceEntry[] = [
  // ---- moves: records about the animal itself -----------------------------
  { table: "horses", column: "father_id", kind: "fk", disposition: "moves", note: "Children's structural parent link: the parent IS the same animal after the merge; unmerge restores the manifest entry." },
  { table: "horses", column: "mother_id", kind: "fk", disposition: "moves", note: "Children's structural parent link: the parent IS the same animal after the merge; unmerge restores the manifest entry." },
  { table: "breeding_records", column: "sire_id", kind: "fk", disposition: "moves", note: "Breeding record subject (sire) — moves with the animal." },
  { table: "breeding_records", column: "dam_id", kind: "fk", disposition: "moves", note: "Breeding record subject (dam) — moves with the animal." },
  { table: "breeding_records", column: "foal_id", kind: "fk", disposition: "moves", note: "Breeding record subject (foal, nullable) — moves with the animal." },
  { table: "horse_people", column: "horse_id", kind: "fk", primaryKey: "person_id+role", disposition: "moves", note: "Horse-person role links move with the animal. Composite PK (horse_id, person_id, role) — the manifest entry carries person_id as row_id plus the role; the pre-R117-19 merge crashed on 'SELECT id FROM horse_people' (latent defect pinned by the inventory validator)." },
  { table: "genetic_tests", column: "horse_id", kind: "fk", disposition: "moves", note: "Genetic test results belong to the animal." },
  { table: "competition_results", column: "horse_id", kind: "fk", disposition: "moves", note: "Competition results belong to the animal." },
  { table: "horse_media", column: "horse_id", kind: "fk", disposition: "moves", note: "Media assets move with the animal; publication consent flags move with the row unchanged." },
  { table: "sales_listings", column: "horse_id", kind: "fk", disposition: "moves", note: "Listings stay attached to the (now canonical) animal; seller and status are untouched." },
  { table: "horse_access_grants", column: "horse_id", kind: "fk", disposition: "moves", note: "Access grants keep the grantee's access to the same animal through the kept record; grant semantics move with the row, never widened." },
  { table: "professional_access_grants", column: "horse_id", kind: "fk", disposition: "moves", note: "R144-D01: professional access grants (vet/lab/official authorities) belong to the animal — they move with the row, never widened." },
  { table: "publication_decisions", column: "horse_id", kind: "fk", disposition: "moves", note: "R144-D02: publication decision history belongs to the animal — moves with the row; the append-only trail is preserved verbatim." },
  { table: "horse_ownership_periods", column: "horse_id", kind: "fk", disposition: "moves", note: "Ownership history moves with the animal; period boundaries are untouched." },
  { table: "horse_lifecycle_events", column: "horse_id", kind: "fk", disposition: "moves", note: "Lifecycle events move with the animal." },
  { table: "attestations", column: "horse_id", kind: "fk", disposition: "moves", note: "Attestations move with the animal; issuer and scope are untouched." },
  // ---- archives ------------------------------------------------------------
  { table: "horse_identifiers", column: "horse_id", kind: "fk", disposition: "archives", note: "Live typed identifiers on the merged horse are archived (never deleted); the kept horse keeps its own claims. Collisions were already routed to identifier_conflicts review. Unmerge restores them live on their original horse." },
  // ---- stays with the merged subject --------------------------------------
  { table: "genetic_evidence_operations", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "R148 private command receipts retain the original actor, test and horse scope; merge never rewrites the original request or decision." },
  { table: "horse_aliases", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Alias display on the kept horse is a presentation decision; aliases stay inspectable on the soft-deleted subject and URL resolution continues through the redirect alias." },
  { table: "data_quality_issues", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Quality findings were raised against this record; they stay with it and remain inspectable while it is soft-deleted." },
  { table: "field_claims", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "R146-D05: retained competing field claims were recorded against this record; they stay inspectable on the soft-deleted subject, never silently re-pointed." },
  { table: "field_claim_decisions", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "R146-D05: the append-only claim decision trail belongs to the record it was decided on; reversal history stays pinned to it." },
  { table: "change_requests", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "An open change request is adjudicated against the record it was submitted for; re-pointing it requires its own reviewed decision." },
  { table: "horse_claims", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Ownership claims are adjudicated workflow; a merge never transfers a claim between records." },
  { table: "horse_reference_intelligence", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Reference-derived intelligence stays pinned to the subject record it was computed for." },
  // ---- R140-G: imported federation racing data (asbdavani) ----------------
  { table: "racing_results", column: "registry_horse_id", kind: "non_fk", disposition: "stays_with_merged_subject", note: "Identity crosswalk to the federation racing system: the result stays pinned to the record it was crosswalked for. Re-pointing imported identity links is a reviewed data-operations decision, never a merge side effect; the row remains inspectable on the soft-deleted subject." },
  { table: "horse_racing_stats", column: "registry_horse_id", kind: "non_fk", disposition: "derived_data", note: "R154 parity DDL (0104 repair): the stats crosswalk is a re-matchable derived link to the canonical horse; the stats refresh job rebuilds it, so merge/unmerge never rewrites it." },
  { table: "horse_racing_stats", column: "asbdavani_horse_id", kind: "non_fk", disposition: "immutable_history", note: "ASBDAVANI SOURCE-system horse id (text) and the stats table PK. NOT a registry horses reference; import-owned fact, never rewritten by merge/unmerge." },
  { table: "racing_results", column: "horse_id", kind: "non_fk", disposition: "immutable_history", note: "ASBDAVANI SOURCE-system horse id (text), NOT a registry horses reference. Import-owned fact; merge/unmerge never rewrites source-system ids." },
  { table: "racing_results", column: "sire_id", kind: "non_fk", disposition: "immutable_history", note: "ASBDAVANI SOURCE-system id (text), NOT a registry horses reference. Import-owned fact; merge/unmerge never rewrites source-system ids." },
  { table: "racing_results", column: "dam_id", kind: "non_fk", disposition: "immutable_history", note: "ASBDAVANI SOURCE-system id (text), NOT a registry horses reference. Import-owned fact; merge/unmerge never rewrites source-system ids." },
  { table: "registry_certificates", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Issued certificates name the record they were issued for; re-issuing against the kept horse is a separate operation." },
  { table: "registry_extracts", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Issued extracts are documents about a specific record; they stay with it." },
  { table: "service_requests", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Service requests reference the horse the requester chose; the requester (or a reviewer) re-points them explicitly." },
  { table: "dossier_snapshots", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Snapshots are immutable point-in-time evidence about this record." },
  { table: "attestation_snapshots", column: "horse_id", kind: "fk", disposition: "stays_with_merged_subject", note: "Issuer snapshots are immutable evidence about this record." },
  // ---- requires a reviewed companion operation ----------------------------
  { table: "workspace_collection_members", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Workspace collection membership belongs to another principal's workspace; moving it would silently transfer content between subjects. The merge preview reports these as companion items." },
  { table: "workspace_tasks", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Workspace tasks (nullable subject) belong to the workspace owners; re-pointing is their reviewed decision, reported by the preview." },
  { table: "workspace_documents", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Workspace documents (nullable subject) belong to the workspace owners; re-pointing is their reviewed decision, reported by the preview." },
  { table: "equine_clinical_events", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Private clinical identity and grants require separate reviewed reconciliation; no automatic transfer by merge." },
  { table: "equine_reproductive_episodes", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Genetic dam in a private episode; keep identity, multi-subject access and history intact." },
  { table: "equine_reproductive_episodes", column: "sire_id", kind: "fk", disposition: "requires_companion_operation", note: "Reported genetic sire is sourced reproductive evidence and needs explicit reconciliation." },
  { table: "equine_reproductive_episodes", column: "recipient_dam_id", kind: "fk", disposition: "requires_companion_operation", note: "Recipient is a separate clinical subject; grants and gestational history never transfer implicitly." },
  { table: "equine_reproductive_offspring", column: "foal_horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Reported offspring identity is evidence, not an automatic canonical pedigree assignment." },
  { table: "equine_samples", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Physical-sample identity and custody must be reconciled explicitly before changing subject." },
  { table: "equine_lab_reports", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Immutable sourced laboratory facts and report review may not silently move between subjects." },
  { table: "registry_metadata_values", column: "horse_id", kind: "fk", disposition: "requires_companion_operation", note: "Supplementary metadata assertions remain scoped to their original subject until explicitly reviewed reconciliation." },
  // ---- immutable history ---------------------------------------------------
  { table: "equine_care_operations", column: "horse_id", kind: "fk", disposition: "immutable_history", note: "Care operation receipts are immutable evidence of original actor, subject and request digest." },
  { table: "equine_care_history", column: "horse_id", kind: "fk", disposition: "immutable_history", note: "Private care revision snapshots preserve their original subjects and are never rewritten by merge." },
  { table: "change_requests", column: "canonical_horse_id", kind: "fk", disposition: "immutable_history", note: "The canonical identity created by an approved registration is an immutable approval result; generic merge does not rewrite the original decision target." },
  { table: "registry_metadata_history", column: "horse_id", kind: "fk", disposition: "immutable_history", note: "Supplementary metadata history preserves the original subject and version and is never rewritten by merge." },
  { table: "registry_metadata_operations", column: "horse_id", kind: "fk", disposition: "immutable_history", note: "Supplementary metadata operation receipts are immutable evidence of original subject and request digest." },
  { table: "audit_events", column: "entity_id", kind: "non_fk", virtual: true, disposition: "immutable_history", note: "Append-only audit history (entity_type='horse' rows); merge/unmerge add audits, never rewrite them." },
  { table: "registry_rule_outcomes", column: "subject_ref", kind: "non_fk", virtual: true, disposition: "immutable_history", note: "Rule outcomes with subject_type='horse_update' name the historical horse; other subject types use separate namespaces. Merge never rewrites an evaluated decision." },
  { table: "registry_policy_receipts", column: "subject_ref", kind: "non_fk", virtual: true, disposition: "immutable_history", note: "Policy receipts with subject_type='horse_update' retain the historical horse identity and evaluated context; creation, review and import references are separate namespaces. Merge never rewrites a receipt." },
  { table: "import_staging_rows", column: "horse_id", kind: "non_fk", disposition: "immutable_history", note: "The APPROVED import-row identity: a reviewed row's target horse_id is never rewritten by merge, unmerge or any display-text-driven path (R117-19 acceptance)." },
  { table: "import_row_reviews", column: "prior_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Immutable decision history — prior target of a reviewed row." },
  { table: "import_row_reviews", column: "new_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Immutable decision history — decided target of a reviewed row." },
  { table: "identifier_conflicts", column: "kept_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Identifier adjudication history; the review queue record stays exactly as recorded." },
  { table: "identifier_conflicts", column: "conflicting_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Identifier adjudication history; the review queue record stays exactly as recorded." },
  { table: "horse_merges", column: "kept_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Merge machinery: the merge register itself (plus its manifest, digests and actors) is the provenance record." },
  { table: "horse_merges", column: "merged_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Merge machinery: the merge register itself (plus its manifest, digests and actors) is the provenance record." },
  { table: "horse_redirect_aliases", column: "alias_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Merge machinery: the redirect alias is written by merge and cleared by unmerge only." },
  { table: "horse_redirect_aliases", column: "kept_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Merge machinery: the redirect alias is written by merge and cleared by unmerge only." },
  { table: "merge_invariant_assertions", column: "kept_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Merge machinery: durable evidence of the transaction-aborting invariant assertion each command passed at commit time (R122/T01); never repointed by merge/unmerge." },
  { table: "merge_invariant_assertions", column: "merged_horse_id", kind: "non_fk", disposition: "immutable_history", note: "Merge machinery: durable evidence of the transaction-aborting invariant assertion each command passed at commit time (R122/T01); never repointed by merge/unmerge." },
  // ---- derived data ---------------------------------------------------------
  { table: "horse_search_source", column: "horse_id", kind: "fk", disposition: "derived_data", note: "Search index row rebuilt by the reindex worker; the merge fan-out enqueues reindex jobs instead of rewriting it." },
  { table: "horse_registry_people_summary", column: "horse_id", kind: "fk", disposition: "derived_data", note: "Precomputed registry summary; refreshed by its precompute job." },
  { table: "horse_search_reindex_queue", column: "horse_id", kind: "fk", disposition: "derived_data", note: "Job queue entries; consumed by the reindex worker." },
];

/** The FK pairs the merge command moves. `key` names each table's row
 * identity: "id" (single PK column) or a composite declaration. Every move is
 * recorded in the manifest with its exact row identity so the guarded unmerge
 * can verify and restore it. */
export type MergeRowKey = "id" | "person_id+role";
export const MERGE_MOVE_PAIRS: ReadonlyArray<{ table: string; column: string; key: MergeRowKey }> =
  HORSE_REFERENCE_INVENTORY.filter((entry) => entry.disposition === "moves")
    .map((entry) => ({ table: entry.table, column: entry.column, key: entry.primaryKey ?? "id" }));

/** The archive pair (horse_identifiers rows on the merged horse). */
export const MERGE_ARCHIVE_PAIRS: ReadonlyArray<{ table: string; column: string }> =
  HORSE_REFERENCE_INVENTORY.filter((entry) => entry.disposition === "archives")
    .map((entry) => ({ table: entry.table, column: entry.column }));

/** References counted in the preview but never written by merge/unmerge. */
export function mergePolicyEntries(): ReadonlyArray<HorseReferenceEntry> {
  return HORSE_REFERENCE_INVENTORY;
}
