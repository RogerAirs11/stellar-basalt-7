/** Private care intake contracts. Reviewed evidence is not an official registry,
 * laboratory accreditation, diagnosis, or an authorization to publish. */
export type CarePermission = 'private_health_read' | 'clinical_write' | 'sample_submit' | 'evidence_review' | 'private_file_export';
export interface CareCapabilities {
  enabled: boolean;
  mode: 'disabled' | 'local_review' | 'approved_production';
  horse_id: number | null;
  permissions: CarePermission[];
  official_certification: false;
  limitations: string[];
}
export interface CareCommand { operation_id: string; reason: string; rule_overrides?: CareRuleOverride[] }
/** Gate E — optional per-rule override reasons, same semantics as the
 * canonical write paths: blocker-severity failures can never be overridden. */
export interface CareRuleOverride { rule_id: string; reason: string }
export interface CareReceipt { id: string; resource: 'clinical' | 'reproduction' | 'sample' | 'custody' | 'report'; version: number; operation_id: string; policy?: { revision: number; evaluated_rules: number } }
export interface ClinicalLifecycleContext {
  kind: 'postmortem' | 'record_review';
  evidence_ref: string;
  justification: string;
}
export interface ClinicalEventInput extends CareCommand {
  event_type: 'examination' | 'vaccination' | 'diagnosis' | 'procedure' | 'medication' | 'allergy' | 'other';
  occurred_on?: string | null;
  title: string;
  findings: string;
  source_ref: string;
  evidence_media_id?: string | null;
  product_name?: string | null;
  batch_ref?: string | null;
  next_due_on?: string | null;
  /** Explicit source context; never overrides vaccination/medication timing. */
  lifecycle_context?: ClinicalLifecycleContext | null;
}
export interface ClinicalAmendInput extends ClinicalEventInput { expected_version: number; status: 'recorded' | 'voided' }
export interface ReproductiveOffspring {
  foal_horse_id?: number | null;
  outcome: 'live' | 'stillborn' | 'died_after_birth';
  sex_at_birth?: 'male' | 'female' | 'unknown' | null;
  notes?: string | null;
}
export interface StoredReproductiveMaterial {
  donor_horse_id: number;
  material: 'semen' | 'embryo' | 'oocyte';
  collected_on?: string | null;
  evidence_ref: string;
  justification: string;
}
/** horse_id in the URL is the GENETIC dam, never inferred from recipient. */
export interface ReproductiveEpisodeInput extends CareCommand {
  sire_id?: number | null;
  recipient_dam_id?: number | null;
  method: 'natural_cover' | 'artificial_insemination' | 'embryo_transfer' | 'icsi' | 'unknown';
  covering_on?: string | null;
  transfer_on?: string | null;
  outcome_on?: string | null;
  outcome: 'planned' | 'covered' | 'pregnant' | 'not_pregnant' | 'pregnancy_loss' | 'foaled' | 'cancelled';
  offspring: ReproductiveOffspring[];
  source_ref: string;
  notes?: string | null;
  evidence_media_id?: string | null;
  /** Sourced stored-material use, scoped to the named genetic donor and method. */
  stored_material?: StoredReproductiveMaterial[];
}
export interface ReproductiveAmendInput extends ReproductiveEpisodeInput { expected_version: number }
export interface SampleInput extends CareCommand {
  sample_ref: string;
  specimen: 'hair_root' | 'blood' | 'buccal' | 'semen' | 'tissue' | 'other';
  collected_on?: string | null;
  identity_check: 'microchip_matched' | 'document_checked' | 'not_checked';
  observed_microchip?: string | null;
  identity_evidence_ref: string;
  source_ref: string;
  notes?: string | null;
  evidence_media_id?: string | null;
}
export interface CustodyInput extends CareCommand {
  event_type: 'received' | 'transferred' | 'stored' | 'discarded' | 'correction';
  occurred_at: string;
  custodian_ref: string;
  source_ref: string;
  notes?: string | null;
}
export interface BaseColorCalls { MC1R: 'E/E' | 'E/e' | 'e/e'; ASIP: 'A/A' | 'A/a' | 'a/a' }
export interface StrCall { marker: string; alleles: [string, string]; quality: 'pass' | 'uncertain' | 'failed' }
export type LabCalls =
  | { kind: 'base_color'; calls: BaseColorCalls }
  | { kind: 'str_parentage'; nomenclature: string; calls: StrCall[] }
  | { kind: 'disease'; calls: Array<{ variant: string; assay: string; result: string }> }
  | { kind: 'other'; result_text: string };
export interface LabReportInput extends CareCommand {
  sample_id: string;
  laboratory_ref: string;
  accession_ref: string;
  report_revision?: string;
  issued_on: string;
  panel_version: string;
  method: string;
  evidence_media_id: string;
  /** SHA-256 of the bytes already held in private media, verified by the server. */
  evidence_sha256: string;
  result: LabCalls;
  supersedes_report_id?: string | null;
}
export interface LabReportReviewInput extends CareCommand {
  expected_version: number;
  decision: 'accepted' | 'rejected' | 'withdrawn';
  review_ref: string;
  identity_checked: boolean;
  report_authenticity_checked: boolean;
  scope_checked: boolean;
}
export interface CareRecord<T> {
  id: string;
  horse_id: number;
  version: number;
  status?: string;
  review_state?: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  body: T;
  created_at: string;
  updated_at?: string;
  created_by_user_id?: string;
  reviewed_by_user_id?: string | null;
}
export interface CareHistoryEntry { version: number; action: string; actor_user_id: string; reason: string; created_at: string; snapshot: unknown }
export interface BaseColorProjection {
  status: 'calculated';
  base_pigment_probabilities: { chestnut: number; black: number; bay: number };
  offspring_genotypes: Array<{ MC1R: BaseColorCalls['MC1R']; ASIP: BaseColorCalls['ASIP']; probability: number }>;
  method: 'mendelian-mc1r-asip-v1';
  limitations: string[];
}
export interface StrComparison {
  status: 'compatible_at_tested_markers' | 'incompatible_at_tested_markers' | 'insufficient_evidence';
  compared_markers: number;
  excluded_markers: string[];
  incompatible_markers: string[];
  panel_version: string;
  method: 'diploid-trio-transmission-v1';
  probability_of_parentage: null;
  official_parentage_confirmed: false;
  limitations: string[];
}

export interface CareList<T> { records: CareRecord<T>[]; limit: number; offset: number; next_offset: number | null }
export interface CareHistory { history: CareHistoryEntry[]; limit: number; truncated: boolean }
export interface CareCustodyRecord { id: string; event_type: CustodyInput['event_type']; occurred_at: string; custodian_ref: string; body: Omit<CustodyInput, 'operation_id' | 'reason'>; created_at: string }
export type CareStored<T extends CareCommand> = Omit<T, 'operation_id' | 'reason'>;
export type CareRequestOptions = { signal?: AbortSignal; idempotencyKey?: string };
export interface CareReadable<T extends CareCommand> {
  list(horseId: number, params?: { offset?: number }, options?: CareRequestOptions): Promise<CareList<CareStored<T>>>;
  get(horseId: number, id: string, options?: CareRequestOptions): Promise<{ record: CareRecord<CareStored<T>> }>;
  history(horseId: number, id: string, options?: CareRequestOptions): Promise<CareHistory>;
}
export interface CareClient {
  capabilities(horseId?: number, options?: CareRequestOptions): Promise<CareCapabilities>;
  clinical: CareReadable<ClinicalEventInput> & {
    create(horseId: number, input: ClinicalEventInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
    amend(horseId: number, id: string, input: ClinicalAmendInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
  };
  reproduction: CareReadable<ReproductiveEpisodeInput> & {
    create(horseId: number, input: ReproductiveEpisodeInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
    amend(horseId: number, id: string, input: ReproductiveAmendInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
  };
  samples: CareReadable<SampleInput> & {
    create(horseId: number, input: SampleInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
    custody(horseId: number, id: string, options?: CareRequestOptions): Promise<{ events: CareCustodyRecord[]; limit: number; truncated: boolean }>;
    addCustody(horseId: number, id: string, input: CustodyInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
  };
  reports: CareReadable<LabReportInput> & {
    create(horseId: number, input: LabReportInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
    review(horseId: number, id: string, input: LabReportReviewInput, options?: CareRequestOptions): Promise<{ receipt: CareReceipt }>;
  };
  baseColor(input: { sire_id: number; dam_id: number }, options?: CareRequestOptions): Promise<BaseColorProjection & { source_reports: Record<'sire' | 'dam', Array<{ id: string; version: number }>> }>;
  strParentage(input: { child_id: number; sire_id: number; dam_id: number }, options?: CareRequestOptions): Promise<StrComparison & { source_reports: Record<'child' | 'sire' | 'dam', Array<{ id: string; version: number }>> }>;
}
