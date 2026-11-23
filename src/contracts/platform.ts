import type { ArabianPairingEvidenceResponse, PairingReviewInput, PairingReviewRecord, BreedingCorrectionInput, BreedingCorrectionResponse } from "./genetics";
import type { RegistrationEvidenceRecord, RegistrationEvidenceUploadInput, RegistrationEvidenceListResponse } from "./registrationEvidence";
import type { CareClient } from "./equineCare";
import type { MetadataClient } from "./registryMetadata";
import type { MfaClient } from "./mfa";
import type { GeneticAccessResponse, ProfessionalGrantPermission } from "./professionalAccess";
import type { GeneticIntakeInput, GeneticIntakeResponse, GeneticInterpretationInput, GeneticInterpretationResponse, GeneticReviewHistoryResponse } from "./genetics";
export type * from "./mfa";
export type * from "./professionalAccess";
export type { GeneticIntakeInput, GeneticIntakeResponse, GeneticInterpretationInput, GeneticInterpretationResponse, GeneticReviewHistoryResponse } from "./genetics";
export type * from "./equineCare";
export type * from "./registryMetadata";
export type { RegistrationEvidenceRecord, RegistrationEvidenceUploadInput, RegistrationEvidenceListResponse, RegistrationEvidenceRole } from "./registrationEvidence";
export type { ArabianPairingEvidenceResponse, PairingReviewInput, PairingReviewRecord, BreedingCorrectionInput, BreedingCorrectionResponse, ArabianVariant, VariantEvidenceStatus } from "./genetics";

export const PLATFORM_CONTRACT_VERSION = "2.35.0" as const;
export const PLATFORM_APPLICATION_VERSION = "0.101.0" as const;

/**
 * Maximum rows a single synchronous privileged registry export request may return.
 * Whole-registry dump remains a future offline/resumable workflow, never synchronous.
 */
export const REGISTRY_EXPORT_ROWS_MAX = 500 as const;
/** Maximum submitted items accepted in one change-request creation request. */
export const CHANGE_REQUEST_ITEMS_MAX = 24 as const;

export type PlatformFeatureKey =
  | "authentication"
  | "search"
  | "structured_search"
  | "registry"
  | "registry_facets"
  | "horse_profiles"
  | "people"
  | "pedigree_ancestors"
  | "pedigree_descendants"
  | "pedigree_metrics"
  | "pedigree_paths"
  | "pedigree_coefficients"
  | "relationships"
  | "horse_insights"
  | "registry_analytics"
  | "quality_summary"
  | "quality_queue"
  | "evidence_summary"
  | "exact_identifier"
  | "owner_claims"
  | "change_requests"
  | "audit"
  | "admin"
  | "media"
  | "curation"
  | "verification"
  | "inspections"
  | "exports"
  | "breed_standards"
  | "breeding_analysis"
  | "genomics"
  | "performance_records"
  | "market_data"
  | "ai_assistant";

export type PlatformFeatureStability = "core" | "stable" | "experimental" | "reserved";
export type PlatformFeatureAccess = "public" | "authenticated" | "privileged";

export interface PlatformFeatureSpec {
  version: string;
  stability: PlatformFeatureStability;
  access: PlatformFeatureAccess;
}

export const PLATFORM_FEATURE_SPECS: Record<PlatformFeatureKey, PlatformFeatureSpec> = {
  authentication: { version: "1.0.0", stability: "core", access: "public" },
  search: { version: "1.0.0", stability: "core", access: "public" },
  structured_search: { version: "1.3.0", stability: "stable", access: "public" },
  registry: { version: "1.2.0", stability: "core", access: "public" },
  registry_facets: { version: "1.1.0", stability: "stable", access: "public" },
  horse_profiles: { version: "1.1.0", stability: "core", access: "public" },
  people: { version: "1.1.0", stability: "stable", access: "public" },
  pedigree_ancestors: { version: "1.0.0", stability: "core", access: "public" },
  pedigree_descendants: { version: "1.0.0", stability: "stable", access: "public" },
  pedigree_metrics: { version: "0.4.0", stability: "experimental", access: "public" },
  pedigree_paths: { version: "0.1.0", stability: "experimental", access: "public" },
  pedigree_coefficients: { version: "0.1.0", stability: "experimental", access: "public" },
  relationships: { version: "1.2.0", stability: "stable", access: "public" },
  horse_insights: { version: "0.3.0", stability: "experimental", access: "public" },
  registry_analytics: { version: "0.5.0", stability: "experimental", access: "public" },
  quality_summary: { version: "1.0.0", stability: "stable", access: "public" },
  quality_queue: { version: "1.0.0", stability: "stable", access: "privileged" },
  evidence_summary: { version: "1.0.0", stability: "stable", access: "public" },
  exact_identifier: { version: "1.0.0", stability: "stable", access: "privileged" },
  owner_claims: { version: "1.0.0", stability: "stable", access: "authenticated" },
  change_requests: { version: "1.0.0", stability: "stable", access: "authenticated" },
  audit: { version: "1.0.0", stability: "stable", access: "privileged" },
  admin: { version: "1.0.0", stability: "stable", access: "privileged" },
  media: { version: "1.0.0", stability: "stable", access: "public" },
  curation: { version: "1.0.0", stability: "stable", access: "privileged" },
  verification: { version: "0.0.0", stability: "reserved", access: "public" },
  inspections: { version: "0.0.0", stability: "reserved", access: "public" },
  exports: { version: "1.0.0", stability: "stable", access: "privileged" },
  breed_standards: { version: "0.0.0", stability: "reserved", access: "public" },
  breeding_analysis: { version: "0.3.0", stability: "experimental", access: "public" },
  genomics: { version: "0.0.0", stability: "reserved", access: "public" },
  performance_records: { version: "1.0.0", stability: "stable", access: "public" },
  market_data: { version: "1.0.0", stability: "stable", access: "public" },
  ai_assistant: { version: "1.0.0", stability: "experimental", access: "public" },
};

/**
 * Canonical feature-key enumeration for frontend coverage accounting.
 *
 * Keep this derived from PLATFORM_FEATURE_SPECS so adding a platform feature
 * automatically becomes visible to compatibility/coverage tooling.
 */
export const PLATFORM_FEATURE_KEYS = Object.freeze(
  Object.keys(PLATFORM_FEATURE_SPECS) as PlatformFeatureKey[],
);

export type PlatformCapabilities = Record<PlatformFeatureKey, boolean>;

export interface PlatformFeatureDescriptor extends PlatformFeatureSpec {
  available: boolean;
}

export type PlatformFeatureCatalog = Record<PlatformFeatureKey, PlatformFeatureDescriptor>;

export interface PlatformFeatureRequirement {
  feature: PlatformFeatureKey;
  minVersion?: string;
  /** Highest feature major this frontend explicitly supports. */
  maxMajor?: number;
}

export interface PlatformContractRequirement {
  minVersion: string;
  maxMajor: number;
}

export interface PlatformStats {
  horses: number;
  people: number;
  ownerLinks: number;
  breederLinks: number;
  importerLinks: number;
  passportReceiverLinks: number;
  horsesWithBothParents: number;
  horsesWithDnaData: number;
  openQualityIssues: number;
}

export interface PlatformLimits {
  searchResultsMax: number;
  registryPageMin: number;
  registryPageMax: number;
  peoplePageMax: number;
  pedigreeAncestorDepthMax: number;
  pedigreeDescendantDepthMax: number;
  pedigreeDescendantNodesMax: number;
  pedigreeDescendantMetricsNodesMax: number;
  pedigreeMetricsDepthMax: number;
  pedigreePathMax: number;
  relationshipDepthMax: number;
  relationshipPathMax: number;
  /** Synchronous privileged export row ceiling per request. */
  registryExportRowsMax: number;
  /** Maximum items per change-request submission. */
  changeRequestItemsMax: number;
}

export interface PlatformSourceProvenance {
  filename: string;
  sheet: string;
  rowCount: number;
  sha256: string;
  completedAt: string | null;
  status: "running" | "complete" | "failed";
}

export interface PlatformMetaResponse {
  contractVersion: string;
  application: {
    name: string;
    shortName: string;
  };
  limits: PlatformLimits;
  stats: PlatformStats;
  /** Safe canonical-import provenance. Raw source payloads remain server-only. */
  source: PlatformSourceProvenance | null;
  /** Simple availability map retained for lightweight consumers. */
  capabilities: PlatformCapabilities;
  /** Versioned capability metadata used for robust frontend negotiation. */
  featureCatalog: PlatformFeatureCatalog;
  /** Derived runtime-snapshot freshness indicator when surfaced; operational fallbacks remain exact/live. */
  snapshotStale?: boolean;
  /** Optional coalesced public runtime health snapshot. Current hosts include this to avoid a second startup request. */
  health?: PlatformHealthResponse;
  /** One-click demo administrator session is available in this environment. Disabled in production unless explicitly enabled. */
  demoAdminLoginAvailable?: boolean;
}

export interface PlatformErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Canonical permission vocabulary for types and runtime session validation. */
export const PLATFORM_PERMISSION_KEYS = [
  "horse.read",
  "horse.create",
  "horse.edit",
  "horse.archive",
  "person.read",
  "pedigree.read",
  "relationship.read",
  "registry.export",
  "claim.create",
  "claim.read_own",
  "claim.review",
  "change.create",
  "change.read_own",
  "change.review",
  "quality.read",
  "audit.read",
  "maintenance.run",
  "content.manage",
] as const;
export type PlatformPermission = typeof PLATFORM_PERMISSION_KEYS[number];

export interface PlatformUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export interface PlatformAuthState {
  user: PlatformUser | null;
  permissions: PlatformPermission[];
}

export interface PlatformLoginInput {
  email: string;
  password: string;
}

export interface PlatformHealthResponse {
  ok: boolean;
  applicationVersion?: string;
  sourceFingerprint?: string;
  contractVersion?: string;
  analyticsReady?: boolean;
  analyticsSchemaVersion?: string;
  analyticsAlgorithmVersion?: string;
  analyticsSourceRevision?: string;
  /** True when the derived runtime snapshot is stale; returned fallback counts are still exact/live. */
  snapshotStale?: boolean;
  horses: number;
  searchRows: number;
  users: number;
  env: string;
  /** Legacy display mode: client means nonempty and not explicitly marked synthetic, not certified provenance. */
  dataMode: "client" | "demo" | "empty";
  datasetProvenance?: "synthetic" | "declared_client" | "unspecified";
  searchReady: boolean;
  database?: {
    mode: string;
    primary: "d1" | "turso" | "supabase";
    fallback?: "d1" | "turso" | "supabase";
    active: "d1" | "turso" | "supabase";
    failoverUsed: boolean;
  };
}

export interface HorseRecord {
  id: number;
  name_latin: string;
  name_native?: string | null;
  birth_name?: string | null;
  previous_names_json?: string | null;
  life_status?: "unknown" | "alive" | "dead" | "missing";
  markings?: string | null;
  height_cm?: number | null;
  register_no?: string | null;
  microchip_no?: string | null;
  birth_year?: number | null;
  birth_place_desc?: string | null;
  breed_desc?: string | null;
  sex_desc?: string | null;
  color_desc?: string | null;
  main_strain_desc?: string | null;
  sub_strain_desc?: string | null;
  father_id?: number | null;
  mother_id?: number | null;
  father_name?: string | null;
  father_name_native?: string | null;
  mother_name?: string | null;
  mother_name_native?: string | null;
  owner_name?: string | null;
  owner_name_native?: string | null;
  breeder_name?: string | null;
  breeder_name_native?: string | null;
  importer_name?: string | null;
  importer_name_native?: string | null;
  passport_receiver_name?: string | null;
  passport_receiver_name_native?: string | null;
  is_active?: number;
  is_dead?: number;
  company_code?: string | null;
  book_version?: string | null;
  originality?: string | null;
  birth_date?: string | null;
  birth_place_code?: string | null;
  breed_type?: string | null;
  sex_code?: string | null;
  color_code?: string | null;
  main_strain_no?: string | null;
  sub_strain_no?: string | null;
  uel_no?: string | null;
  dna_status?: string | null;
  dna_desc?: string | null;
  life_number?: string | null;
  passport_date?: string | null;
  passport_deliver_date?: string | null;
  is_stallion?: number;
  is_sport?: number;
  is_imported?: number;
  imported_date?: string | null;
  imported_from_code?: string | null;
  imported_from_desc?: string | null;
  import_register_no?: string | null;
  export_certificate?: string | null;
  horse_sr_no?: string | null;
  death_date?: string | null;
  is_register_sport?: number;
  has_sport_card?: number;
  allow_stallion?: number;
  source_created_at?: string | null;
  // T12: typed registry dates — raw storage columns plus the assembled fact.
  birth_date_value?: string | null;
  birth_date_precision?: string | null;
  birth_date_calendar?: string | null;
  death_date_value?: string | null;
  death_date_precision?: string | null;
  death_date_calendar?: string | null;
  castration_date_value?: string | null;
  castration_date_precision?: string | null;
  castration_date_calendar?: string | null;
  birth_date_typed?: RegistryDateInput | null;
  death_date_typed?: RegistryDateInput | null;
  castration_date_typed?: RegistryDateInput | null;
  // T12: public birth/keeping places (the private address never appears here).
  birth_city?: string | null;
  birth_province?: string | null;
  keeping_city?: string | null;
  keeping_province?: string | null;
  /** Turn 32: representative profile photo (prominent records only). */
  profile_image_url?: string | null;
  profile_image_credit?: string | null;
  score?: number;
  matched_by?: string[];
}

export interface HorseAliasRecord {
  id: number;
  alias: string;
  language?: string | null;
  alias_type: string;
  source: string;
}

export interface HorsePersonLink {
  role: string;
  is_current?: number;
  id: number;
  name_latin: string | null;
  name_native: string | null;
}

export interface HorseProfileResponse {
  horse: HorseRecord;
  people: HorsePersonLink[];
  aliases: HorseAliasRecord[];
}

export interface HorseSearchResponse {
  query: string;
  results: HorseRecord[];
}

export type RegistrySort = "id" | "name" | "year" | "breed" | "sex" | "place" | "importance";
export type RegistrySortDirection = "asc" | "desc";
export type RegistryLifecycle = "active" | "inactive" | "deceased";

export interface RegistryBrowseParams {
  q?: string;
  filter?: string;
  breed?: string;
  sex?: string;
  status?: RegistryLifecycle | string;
  lifecycle?: RegistryLifecycle | string;
  place?: string;
  color?: string;
  mainStrain?: string;
  importedFrom?: string;
  yearFrom?: number | string;
  yearTo?: number | string;
  ownerId?: number;
  breederId?: number;
  name?: string;
  id?: string | number;
  register?: string;
  owner?: string;
  breeder?: string;
  importer?: string;
  passportReceiver?: string;
  sire?: string;
  dam?: string;
  hasSire?: boolean;
  hasDam?: boolean;
  isImported?: boolean;
  isSport?: boolean;
  isStallion?: boolean;
  hasSportCard?: boolean;
  sort?: RegistrySort;
  dir?: RegistrySortDirection;
  /** Presentation locale for the alphabetical name-sort collation family (fa/ar → Persian order, otherwise Latin). */
  lang?: string;
  limit?: number;
  offset?: number;
}

export type RegistryExportFormat = "csv" | "json";

export interface RegistryExportDescriptor {
  format: RegistryExportFormat;
  href: string;
  filename: string;
  mimeType: "text/csv;charset=utf-8" | "application/json;charset=utf-8";
  maxRows: number;
}

export interface RegistryBrowseResponse {
  rows: HorseRecord[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  previousOffset: number | null;
  sort: RegistrySort | string;
  dir: RegistrySortDirection | string;
  filter: string;
}

export interface RegistryFacetValue {
  value: string;
  count: number;
}

export interface RegistryFacetsResponse {
  breeds: RegistryFacetValue[];
  sexes: RegistryFacetValue[];
  places: RegistryFacetValue[];
  colors: RegistryFacetValue[];
  mainStrains: RegistryFacetValue[];
  importedFrom: RegistryFacetValue[];
  decades: Array<{ value: number; count: number }>;
  lifecycle: RegistryFacetValue[];
  flags: Array<{ value: "imported" | "sport" | "stallion" | "sport_card"; count: number }>;
  /** Optional derived-snapshot freshness indicator; stale state is served via exact live fallback. */
  snapshotStale?: boolean;
}

export interface PersonSummary {
  id: number;
  name_latin: string | null;
  name_native: string | null;
  owner_count: number;
  breeder_count: number;
  importer_count: number;
  passport_receiver_count: number;
  horse_count: number;
}

export interface PeopleListResponse {
  nextOffset?: number | null;
  people: PersonSummary[];
  limit: number;
  offset: number;
}

export interface PersonProfileResponse {
  person: Omit<PersonSummary, "horse_count"> & { horse_count?: number };
  horses: Array<HorseRecord & { role?: string }>;
  truncated: boolean;
}

export interface PedigreeNode {
  horse: HorseRecord;
  relation: "self" | "father" | "mother" | "offspring";
  generation: number;
  repeated: boolean;
  cycle: boolean;
  parents?: PedigreeNode[];
  children?: PedigreeNode[];
}

export interface AncestorPedigreeResponse {
  direction: "ancestors";
  depth: number;
  tree: PedigreeNode;
}

export interface DescendantPedigreeResponse {
  direction: "descendants";
  depth: number;
  tree: PedigreeNode;
  truncated: boolean;
}

export interface PedigreeGenerationCoverage {
  generation: number;
  expectedPositions: number;
  knownPositions: number;
  completenessPercent: number;
}

export interface PedigreeBranchCoverage {
  relation: "sire" | "dam";
  rootHorseId: number | null;
  expectedPositions: number;
  knownPositions: number;
  completenessPercent: number;
}

export interface RepeatedAncestorSummary {
  horse: Pick<HorseRecord, "id" | "name_latin" | "name_native" | "birth_year">;
  occurrences: number;
  repeatedPositions: number;
  nearestGeneration: number;
  positionSharePercent: number;
  /** Added in pedigree_metrics 0.4.0; structured linebreeding occurrence detail. */
  generationOccurrences?: Array<{ generation: number; count: number }>;
  sireBranchOccurrences?: number;
  damBranchOccurrences?: number;
  crossesBranches?: boolean;
}

export interface PedigreeMetricsResponse {
  horseId: number;
  depth: number;
  status: "ok" | "partial" | "cycle_detected";
  expectedAncestorPositions: number;
  knownAncestorPositions: number;
  completenessPercent: number;
  uniqueAncestors: number;
  repeatedAncestorPositions: number;
  /** Added in pedigree_metrics 0.3.0; structural identity diversity, not genetic diversity. */
  uniqueAncestorRatioPercent?: number;
  maxKnownGeneration: number;
  generations: PedigreeGenerationCoverage[];
  /** Added in pedigree_metrics 0.2.0; optional for compatibility with 0.1.x backends. */
  branches?: {
    sire: PedigreeBranchCoverage;
    dam: PedigreeBranchCoverage;
  };
  /** Most repeated recorded ancestor identities at the selected depth. */
  topRepeatedAncestors?: RepeatedAncestorSummary[];
  /** Added in pedigree_metrics 0.3.0. Includes the subject as the first horse in each chain. */
  lineages?: {
    tailMale: PedigreeLineageSummary;
    tailFemale: PedigreeLineageSummary;
  };
  integrity: {
    cycleDetected: boolean;
    cycleOccurrences: number;
    cycleNodeIds: number[];
    unresolvedParentReferences: number;
    truncated: boolean;
  };
  provenance: {
    method: "pedigree-position-coverage";
    algorithmVersion: string;
    interpretation: string;
  };
}

export interface PedigreeLineageSummary {
  relation: "tail_male" | "tail_female";
  horses: Array<Pick<HorseRecord, "id" | "name_latin" | "name_native" | "birth_year">>;
  completeToDepth: boolean;
  stoppedByCycle: boolean;
}

export interface PedigreePathResponse {
  horseId: number;
  ancestorId: number;
  depth: number;
  paths: Array<{ path: number[]; branch: "sire" | "dam" | null }>;
  truncated: boolean;
  provenance: { method: "bounded-ancestor-path-enumeration"; algorithmVersion: string; interpretation: string };
}

export interface PedigreeCoefficientResponse {
  horseId: number;
  depth: number;
  status: "ok" | "cycle_detected" | "truncated";
  inbreedingCoefficient: number | null;
  inbreedingPercent: number | null;
  pedigreeCompletenessPercent: number;
  analyzedHorses: number;
  assumedFounderNodes: number;
  boundaryParentReferences: number;
  integrity: { cycleDetected: boolean; truncated: boolean };
  /** P07: present when COI is exactly 0 with incomplete ancestry — no inbreeding
   *  detected within the AVAILABLE pedigree, never "unrelated" or "safe". */
  zeroWithinIncompleteAncestry?: boolean;
  provenance: {
    method: "finite-pedigree-tabular-relationship";
    algorithmVersion: string;
    founderAssumption: string;
    interpretation: string;
  };
}

export interface RelationshipCoefficientResponse {
  from: number;
  to: number;
  depth: number;
  status: "ok" | "cycle_detected" | "truncated";
  relationshipCoefficient: number | null;
  relationshipPercent: number | null;
  kinshipCoefficient: number | null;
  kinshipPercent: number | null;
  fromInbreedingCoefficient: number | null;
  fromInbreedingPercent: number | null;
  toInbreedingCoefficient: number | null;
  toInbreedingPercent: number | null;
  fromPedigreeCompletenessPercent: number;
  toPedigreeCompletenessPercent: number;
  analyzedHorses: number;
  assumedFounderNodes: number;
  boundaryParentReferences: number;
  integrity: { cycleDetected: boolean; truncated: boolean };
  provenance: { method: "finite-pedigree-tabular-relationship"; algorithmVersion: string; founderAssumption: string; interpretation: string };
}

export interface CommonAncestor {
  horse: Pick<HorseRecord, "id" | "name_latin" | "name_native" | "birth_year">;
  fromDepth: number;
  toDepth: number;
  totalDepth: number;
  fromPath: number[];
  toPath: number[];
}

export type RelationshipKind =
  | "same_horse"
  | "direct_ancestor"
  | "direct_descendant"
  | "full_sibling"
  | "half_sibling"
  | "related"
  | "no_common_ancestor";

export interface RelationshipSummary {
  kind: RelationshipKind;
  commonAncestorCount: number;
  closestTotalDepth: number | null;
  fromDepth: number | null;
  toDepth: number | null;
  /** Added in relationships 1.2.0. */
  directGeneration?: number | null;
  directPath?: number[] | null;
  paternalConnectionCount?: number;
  maternalConnectionCount?: number;
  crossBranchConnectionCount?: number;
  integrity: {
    cycleDetected: boolean;
    truncated: boolean;
  };
}

export interface RelationshipPathConnection {
  via: Pick<HorseRecord, "id" | "name_latin" | "name_native" | "birth_year">;
  fromDepth: number;
  toDepth: number;
  totalDepth: number;
  fromBranch: "sire" | "dam" | null;
  toBranch: "sire" | "dam" | null;
  fromPath: number[];
  toPath: number[];
}

export interface RelationshipAtlas {
  connections: RelationshipPathConnection[];
  tracedConnectionCount: number;
  pathEnumerationTruncated: boolean;
  provenance: { method: "bounded-pedigree-path-atlas"; algorithmVersion: string; interpretation: string };
}

export interface RelationshipResponse {
  from: number;
  to: number;
  commonAncestors: CommonAncestor[];
  /** Added in relationships 1.1.0; optional for compatibility with 1.0.x backends. */
  summary?: RelationshipSummary;
  /** Added in relationships 1.2.0. */
  atlas?: RelationshipAtlas;
}


export interface BreedingDiversityProjection {
  depth: number;
  projectedKnownAncestorPositions: number;
  projectedExpectedAncestorPositions: number;
  projectedPedigreeCompletenessPercent: number;
  projectedUniqueRecordedAncestors: number;
  projectedRepeatedAncestorPositions: number;
  projectedAncestorDiversityPercent: number;
  sharedRecordedAncestorsBetweenParents: number;
  sireUniqueRecordedAncestors: number;
  damUniqueRecordedAncestors: number;
  projectedTop5RecordedPathWeightSharePercent: number;
  projectedTop10RecordedPathWeightSharePercent: number;
  topProjectedAncestorContributions: Array<{ horse: Pick<HorseRecord,"id"|"name_latin"|"name_native"|"birth_year">; pathWeight:number; shareOfRecordedPathWeightPercent:number; fromSire:boolean; fromDam:boolean }>;
  confidence: { grade:"high"|"medium"|"low"; reasons:string[] };
  provenance: { method:"prospective-offspring-recorded-pedigree-diversity"; algorithmVersion:string; interpretation:string };
}

export interface BreedingOptimizerInput {
  fixedHorseId: number;
  fixedRole: "sire" | "dam";
  candidateIds: number[];
  depth?: number;
  objectives?: {
    lowProjectedCoiWeight?: number;
    ancestorDiversityWeight?: number;
    lowConcentrationWeight?: number;
    candidateDiversityPreservationWeight?: number;
    coiCeilingPercent?: number;
    avoidAncestorIds?: number[];
    excludeAvoidedAncestors?: boolean;
  };
}

export interface BreedingOptimizerScoreComponent {
  code: "low_projected_coi" | "ancestor_diversity" | "low_ancestor_concentration" | "candidate_diversity_preservation";
  rawValue: number | null;
  normalizedScore: number | null;
  nominalWeight: number;
  appliedWeight: number;
}

export interface BreedingOptimizerCandidate {
  rank: number;
  candidate: Pick<HorseRecord,"id"|"name_latin"|"name_native"|"birth_year"|"breed_desc"|"sex_desc">;
  sireId: number;
  damId: number;
  score: number;
  confidenceAdjustedScore: number;
  projectedOffspringInbreedingPercent: number | null;
  projectedAncestorDiversityPercent: number | null;
  projectedTop5RecordedPathWeightSharePercent: number | null;
  projectedPedigreeCompletenessPercent: number | null;
  sharedRecordedAncestorsBetweenParents: number | null;
  candidateDiversityPreservationIndex: number | null;
  /** Honest name for the former heuristic "confidence" grade: it grades recorded-data quality, not certainty (T26). */
  dataQualityGrade: "high" | "medium" | "low";
  /** Deprecated alias of dataQualityGrade, kept for frontend compatibility until all themes migrate. */
  confidenceGrade: "high" | "medium" | "low";
  scoreComponents: BreedingOptimizerScoreComponent[];
  avoidedAncestorsPresent: number[];
  warnings: string[];
}

export interface BreedingOptimizerExclusion {
  candidateId: number;
  /** R140-D adds `insufficient_ancestry`: below the 20% recorded-ancestry evidence floor. */
  code: "missing_candidate" | "sex_role_conflict" | "avoid_ancestor_exclusion" | "coi_ceiling_exceeded" | "pedigree_integrity" | "insufficient_ancestry";
  message: string;
}

export interface BreedingOptimizerResponse {
  fixedHorseId: number;
  fixedRole: "sire" | "dam";
  depth: number;
  evaluatedCandidates: number;
  ranked: BreedingOptimizerCandidate[];
  /** Explicit reasons candidates were omitted from ranking. */
  excludedCandidates?: BreedingOptimizerExclusion[];
  /** Eligibility/data-quality warnings applying to the fixed horse or all candidates. */
  eligibilityWarnings?: string[];
  objectives: Required<Pick<NonNullable<BreedingOptimizerInput["objectives"]>,"lowProjectedCoiWeight"|"ancestorDiversityWeight"|"lowConcentrationWeight"|"candidateDiversityPreservationWeight"|"coiCeilingPercent">> & { avoidAncestorIds:number[]; excludeAvoidedAncestors:boolean };
  provenance: {
    method: "explainable-pedigree-mating-candidate-ranking";
    algorithmVersion: string;
    interpretation: string;
    caveat: string;
  };
}

export interface BreedingPairingAnalysisResponse {
  sireId: number;
  damId: number;
  depth: number;
  status: "ok" | "cycle_detected" | "truncated";
  /** Prospective offspring pedigree COI = parental kinship at the selected finite depth. */
  projectedOffspringInbreedingCoefficient: number | null;
  projectedOffspringInbreedingPercent: number | null;
  parentalRelationshipCoefficient: number | null;
  parentalRelationshipPercent: number | null;
  parentalKinshipCoefficient: number | null;
  parentalKinshipPercent: number | null;
  sireInbreedingPercent: number | null;
  damInbreedingPercent: number | null;
  sirePedigreeCompletenessPercent: number;
  damPedigreeCompletenessPercent: number;
  commonAncestors: CommonAncestor[];
  /** Added in breeding_analysis 0.2.0. */
  diversityProjection?: BreedingDiversityProjection;
  /** Added in breeding_analysis 0.3.0 — verdict helpers for mating decisions. */
  verdict?: BreedingMatingVerdict;
  /** Added in breeding_analysis 0.3.0 — COI convergence trend across analysis depths. */
  coiByDepth?: BreedingDepthPoint[];
  /** Added in breeding_analysis 0.3.0 — classic ancestor-loss (AVK) per parent and projected foal. */
  ancestorLoss?: { sireAvkPercent: number | null; damAvkPercent: number | null; projectedFoalAvkPercent: number | null };
  integrity: { cycleDetected: boolean; truncated: boolean };
  provenance: {
    method: "prospective-offspring-pedigree-coi-from-parental-kinship";
    algorithmVersion: string;
    founderAssumption: string;
    interpretation: string;
  };
}

export interface BreedingMatingVerdict {
  /** Band classification of the projected offspring COI, gated by ancestry quality. */
  classification: "outcross" | "mild_linebreeding" | "linebreeding" | "close_inbreeding" | "insufficient_ancestry" | "unknown";
  /** Human-readable classification label (EN). */
  classificationLabel: string;
  /** Closest recorded relationship kind between the parents (half/full sibs, parent-offspring…). */
  relationshipKind: string | null;
  /** True when the recorded pairing mirrors full-sib, half-sib or parent-offspring matings. */
  closeMatingWarning: boolean;
  /** English warning text when closeMatingWarning is true. */
  closeMatingWarningText: string | null;
  /** Generation of the closest common ancestor (1 = parent). */
  closestCommonAncestorGeneration: number | null;
  /** Ancestry-quality evidence behind this verdict (Master-Ai plan T26 / finding F20). */
  ancestryQuality?: {
    sireKnownAncestorPositions: number;
    damKnownAncestorPositions: number;
    observedAncestorPositions: number;
    minParentPedigreeCompletenessPercent: number | null;
    sufficientForComparativeLabels: boolean;
    policyVersion: string;
    policyNote: string;
  };
}

export interface BreedingDepthPoint {
  depth: number;
  inbreedingPercent: number | null;
  /** Pedigree completeness of both parent graphs combined at this depth. */
  pedigreeCompletenessPercent: number | null;
  /** Parent-specific coverage retained so a 50% combined result is explainable. */
  sirePedigreeCompletenessPercent?: number;
  damPedigreeCompletenessPercent?: number;
}

export interface DescendantGenerationCount {
  generation: number;
  count: number;
}

export interface DescendantMetricsResponse {
  horseId: number;
  depth: number;
  directChildren: number;
  knownDescendants: number;
  maxKnownGeneration: number;
  generations: DescendantGenerationCount[];
  truncated: boolean;
  provenance: {
    method: "bounded-descendant-reach";
    algorithmVersion: string;
    interpretation: string;
  };
}

export type HorseInsightCode =
  | "pedigree_coverage"
  | "branch_imbalance"
  | "repeated_ancestor"
  | "tail_male_line"
  | "tail_female_line"
  | "pedigree_inbreeding"
  | "descendant_reach"
  | "pedigree_integrity_warning";

export interface HorseInsight {
  code: HorseInsightCode;
  importance: "headline" | "notable" | "context" | "warning";
  values: Record<string, string | number | boolean | null>;
  relatedHorses?: Array<Pick<HorseRecord, "id" | "name_latin" | "name_native" | "birth_year">>;
  provenance: { source: "pedigree_metrics" | "pedigree_coefficients" | "descendant_metrics"; algorithmVersion: string };
}

export interface PremiumAncestorContribution {
  horse: Pick<HorseRecord, "id" | "name_latin" | "name_native" | "birth_year">;
  occurrences: number;
  nearestGeneration: number;
  pathWeight: number;
  shareOfRecordedPathWeightPercent: number;
  sireBranchPathWeight: number;
  damBranchPathWeight: number;
  crossesBranches: boolean;
}

export interface HorsePremiumPedigreeAnalytics {
  depth: number;
  status: "ok" | "partial" | "cycle_detected";
  equivalentCompleteGenerations: number;
  knownAncestorPositions: number;
  uniqueAncestors: number;
  repeatedAncestorPositions: number;
  repeatedPositionPercent: number;
  ancestorDiversityPercent: number;
  ancestorLossPercent: number;
  weightedCoveragePercent: number;
  weightedRepeatedBurdenPercent: number;
  crossBranchRepeatedAncestorCount: number;
  top5RecordedPathWeightSharePercent: number;
  top10RecordedPathWeightSharePercent: number;
  topAncestorContributions: PremiumAncestorContribution[];
  confidence: { grade: "high" | "medium" | "low"; coveragePercent: number; reasons: string[] };
  provenance: { method: "recorded-pedigree-path-weight-diversity"; algorithmVersion: string; interpretation: string };
}

export interface ReferencePopulationSummary {
  key: string;
  label: string;
  breed: string;
  startYear: number;
  endYear: number;
  populationSize: number;
  sampleSize: number;
  meanKinshipPercent: { count:number; mean:number|null; median:number|null; p10:number|null; p90:number|null };
  recordedAncestorRarityIndex: { count:number; mean:number|null; median:number|null; p10:number|null; p90:number|null };
  diversityPreservationIndex: { count:number; mean:number|null; median:number|null; p10:number|null; p90:number|null };
  tailMaleDistinctRoots: number;
  tailFemaleDistinctRoots: number;
  interpretation: string;
}

export interface HorseReferencePopulationIntelligence {
  horseId: number;
  cohort: {
    key: string; label: string; breed: string; startYear: number; endYear: number; populationSize: number; sampleSize: number; memberOfReferenceCohort: boolean;
  };
  meanKinship: {
    estimatePercent: number|null; standardErrorPercent: number|null; approximate95PercentSamplingInterval: [number,number]|null;
    samplingPrecision: { grade:"high"|"medium"|"low"|"unavailable"; approximate95HalfWidthPercent:number|null; interpretation:string };
    percentile: number|null; rarityPercentile: number|null; method: "sampled-exact-pedigree-kinship"; founderAssumption: string;
  };
  recordedAncestorRarity: { index:number; percentile:number; depth:number; interpretation:string };
  directLines: { tailMaleRootId:number|null; tailMaleRootSharePercent:number|null; tailFemaleRootId:number|null; tailFemaleRootSharePercent:number|null };
  diversityPreservationIndex: {
    score:number; components:Array<{code:"lowMeanKinship"|"rareRecordedAncestors"|"rareTailMaleLine"|"rareTailFemaleLine";score:number;nominalWeight:number}>; interpretation:string;
  };
  confidence: { grade:"high"|"medium"|"low"; pedigreeCompletenessPercent:number; reasons:string[] };
  provenance: { algorithmVersion:string; sourceRevision:string; interpretation:string };
}

export interface HorseInsightsResponse {
  horseId: number;
  ancestorDepth: number;
  descendantDepth: number;
  insights: HorseInsight[];
  /** Reused calculations embedded to prevent clients from reloading the same pedigree graph. */
  pedigreeMetrics?: PedigreeMetricsResponse;
  pedigreeCoefficient?: PedigreeCoefficientResponse;
  descendantMetrics?: DescendantMetricsResponse;
  /** Premium explainable pedigree intelligence. Never genomic ancestry or genetic merit. */
  premiumPedigree?: HorsePremiumPedigreeAnalytics;
  /** Population-relative pedigree context; never a breeding value or genomic score. */
  referencePopulation?: HorseReferencePopulationIntelligence;
}

export interface RegistryAnalyticsHorseRank {
  id: number;
  name_latin?: string | null;
  name_native?: string | null;
  birth_year?: number | null;
  sex_desc?: string | null;
  count: number;
}

export interface RegistryAnalyticsPersonRank {
  id: number;
  name_latin?: string | null;
  name_native?: string | null;
  count: number;
}

export interface RegistryAnalyticsCoverageField {
  key: string;
  count: number;
  percent: number;
}

export interface AnalyticsConfidenceSummary {
  grade: "high" | "medium" | "low";
  eligibleRecords: number;
  totalRecords: number;
  coveragePercent: number;
  exclusions: Array<{ code: string; count: number; interpretation: string }>;
  interpretation: string;
}

export interface ParentConcentrationMetrics {
  assignments: number;
  distinctParents: number;
  top1SharePercent: number;
  top5SharePercent: number;
  top10SharePercent: number;
  hhi: number;
  gini: number;
  shannonEntropy: number;
  entropyEffectiveParentCount: number;
  inverseSimpsonEffectiveParentCount: number;
}

export interface RegistryRoleConcentrationMetrics {
  assignments: number;
  distinctPeople: number;
  top1SharePercent: number;
  top5SharePercent: number;
  top10SharePercent: number;
  hhi: number;
  gini: number;
  shannonEntropy: number;
  entropyEffectivePeopleCount: number;
  inverseSimpsonEffectivePeopleCount: number;
}

export interface GenerationIntervalMetric {
  count: number;
  meanYears: number | null;
  medianYears: number | null;
  p10Years: number | null;
  p90Years: number | null;
}

export interface RegistryInfluenceTrajectory {
  horse: RegistryAnalyticsHorseRank;
  directChildren: number;
  representedAncestorPositionsDepth4: number;
  uniqueDescendantsDepth4: number;
  recentDescendants: number;
  priorPeriodDescendants: number;
  momentumPercent: number;
  byBirthDecade: Array<{decade:number;count:number}>;
}

export interface RegistryInfluenceTrajectories {
  depth:number;
  recentPeriod:[number,number];
  priorPeriod:[number,number];
  topCurrent:RegistryInfluenceTrajectory[];
  rising:RegistryInfluenceTrajectory[];
  fading:RegistryInfluenceTrajectory[];
  interpretation:string;
}

export interface RegistryPremiumAnalytics {
  analyticalValidity: {
    birthYear: AnalyticsConfidenceSummary;
    pedigree: AnalyticsConfidenceSummary;
    meaningfulDnaRecords: number;
    parentYearConflictCount: number;
    cycleIssueCount: number;
  };
  parentConcentration: {
    sires: ParentConcentrationMetrics;
    dams: ParentConcentrationMetrics;
    recentCohort?: { startYear: number; endYear: number; horses: number; sires: ParentConcentrationMetrics; dams: ParentConcentrationMetrics };
    byBirthDecade: Array<{ decade: number; horses: number; sires: ParentConcentrationMetrics; dams: ParentConcentrationMetrics }>;
  };
  peopleConcentration?: {
    owners: RegistryRoleConcentrationMetrics;
    breeders: RegistryRoleConcentrationMetrics;
    importers: RegistryRoleConcentrationMetrics;
    passportReceivers: RegistryRoleConcentrationMetrics;
    interpretation: string;
  };
  generationIntervals: {
    plausibleAgeRangeYears: [number, number];
    sireToOffspring: GenerationIntervalMetric;
    damToOffspring: GenerationIntervalMetric;
    sireToSon: GenerationIntervalMetric;
    sireToDaughter: GenerationIntervalMetric;
    damToSon: GenerationIntervalMetric;
    damToDaughter: GenerationIntervalMetric;
    byOffspringBirthDecade: Array<{ decade: number; sire: GenerationIntervalMetric; dam: GenerationIntervalMetric }>;
  };
  lineSurvival?: {
    cohort: { startYear: number; endYear: number; horses: number };
    tailMale: { distinctRecordedRoots: number; top10SharePercent: number; topRoots: RegistryAnalyticsHorseRank[] };
    tailFemale: { distinctRecordedRoots: number; top10SharePercent: number; topRoots: RegistryAnalyticsHorseRank[] };
    interpretation: string;
  };
  pedigreeDiversity?: {
    medianEquivalentCompleteGenerations: number;
    averageEquivalentCompleteGenerations: number;
    eligibleHorseCount: number;
    depth: number;
    interpretation: string;
  };
  referencePopulations?: ReferencePopulationSummary[];
  influenceTrajectories?: RegistryInfluenceTrajectories|null;
}

export interface RegistryCompletenessComponent {
  /** Stable component key, e.g. "bothParents", "geneticTests". */
  key: string;
  /** English label naming the recorded value being counted. */
  label: string;
  coveredRecords: number;
  totalRecords: number;
  coveragePercent: number;
  /** How a record counts as missing for this component. */
  missingDefinition: string;
}

/** R117-21: one separate data-derived coverage measure with its own explicit denominator. */
export interface RegistryCompletenessMeasure {
  /** One of "identity" | "ancestry" | "evidence" | "media" | "activity". */
  key: string;
  label: string;
  /** Denominator: all non-deleted canonical horse records in this revision. */
  totalRecords: number;
  coveredRecords: number;
  coveragePercent: number;
  /** How missing/unknown is defined for this measure. */
  missingDefinition: string;
  components?: RegistryCompletenessComponent[];
}

/**
 * R117-21: separate, data-derived completeness measures. Coverage of recorded
 * values only — never a verification score and never a registry-completeness
 * claim. Every skin renders these same values with its own presentation.
 */
export interface RegistryCompletenessSection {
  /** Snapshot build time (matches payload generatedAt). */
  snapshotTime: string;
  denominatorDefinition: string;
  permissionScope: string;
  interpretation: string;
  measures: RegistryCompletenessMeasure[];
}

export interface RegistryAnalyticsResponse {
  schemaVersion: string;
  algorithmVersion: string;
  generatedAt: string;
  sourceRevision: string;
  horseCount: number;
  /** Raw source-year distribution retained for forensic comparison. */
  rawBirthYears?: Array<{ year: number; count: number }>;
  /** Analytical birth-year distribution after documented sentinel exclusions. */
  birthYears?: Array<{ year: number; count: number }>;
  birthDecades: Array<{ decade: number; count: number }>;
  birthYearSummary?: { earliest: number | null; latest: number | null; median: number | null; peakYear: number | null; peakYearCount: number };
  sexDistribution: Array<{ label: string; count: number }>;
  topBreeds: Array<{ label: string; count: number }>;
  topBirthPlaces: Array<{ label: string; count: number }>;
  /** Added in registry_analytics 0.2.0. Placeholder/sentinel values are excluded from these rankings. */
  topColors?: Array<{ label: string; count: number }>;
  /** Added in registry_analytics 0.2.0. Placeholder/sentinel values are excluded from these rankings. */
  topMainStrains?: Array<{ label: string; count: number }>;
  parentage?: {
    bothParents: number;
    oneParent: number;
    noParents: number;
    bothParentsPercent: number;
    oneParentPercent: number;
    noParentsPercent: number;
  };
  activity?: Record<"active" | "deceased" | "imported" | "stallions" | "sport" | "sportCard", { count: number; percent: number }>;
  dataCoverage?: {
    fields: RegistryAnalyticsCoverageField[];
    byBirthDecade: Array<{
      decade: number;
      count: number;
      nativeNamePercent: number;
      registrationPercent: number;
      birthPlacePercent: number;
      bothParentsPercent: number;
    }>;
  };
  /** R117-21 (analytics schema 2.2.0): separate data-derived completeness measures with explicit denominators. */
  completeness?: RegistryCompletenessSection;
  progeny: {
    percentiles: { p50: number; p90: number; p95: number; p99: number; max: number };
    histogram?: Array<{ label: string; count: number }>;
    horsesWithRecordedOffspring: number;
    topParents: RegistryAnalyticsHorseRank[];
    topSires: RegistryAnalyticsHorseRank[];
    topDams: RegistryAnalyticsHorseRank[];
  };
  people?: {
    peopleCount: number;
    ownerCount: number;
    breederCount: number;
    importerCount: number;
    passportReceiverCount: number;
    horsesWithOwner: number;
    horsesWithBreeder: number;
    horsesWithImporter: number;
    horsesWithPassportReceiver: number;
    topOwners: RegistryAnalyticsPersonRank[];
    topBreeders: RegistryAnalyticsPersonRank[];
    topImporters: RegistryAnalyticsPersonRank[];
    topPassportReceivers: RegistryAnalyticsPersonRank[];
  };
  quality?: {
    openIssues: number;
    severities: Array<{ label: string; count: number }>;
    topIssueCodes: Array<{ label: string; count: number }>;
  };
  pedigree: {
    analyticsEligibleHorseCount: number;
    cycleNodeCount: number;
    cycleContaminatedHorseCount: number;
    completeness: Array<{ depth: number; averagePercent: number; medianPercent: number; fullyRecordedCount: number; halfOrBetterCount: number; eligibleHorseCount?: number }>;
    topRepresentedAncestorsDepth4: RegistryAnalyticsHorseRank[];
    representationInterpretation: string;
    cyclePolicy?: string;
  };
  premium?: RegistryPremiumAnalytics;
  provenance: { interpretation: string; canonical: boolean };
}

export interface QualitySummaryResponse {
  openIssues: number;
  severities: Array<{ value: string; count: number }>;
  topIssueCodes: Array<{ value: string; count: number }>;
  /** Optional derived-snapshot freshness indicator; stale state is served via exact live fallback. */
  snapshotStale?: boolean;
}

export interface ClaimRecord {
  id: string;
  horse_id: number;
  status: string;
  created_at: string;
  reviewed_at?: string | null;
  review_note?: string | null;
  name_latin?: string;
  name_native?: string | null;
}

export interface ClaimsMineResponse {
  claims: ClaimRecord[];
}


export interface WorkflowSubmissionEffect {
  /** Submitting/editing a proposal does not apply it to the canonical registry. */
  workflowEffect: "review_only";
  canonicalApplied: false;
}
/** @deprecated Use WorkflowSubmissionEffect. Review decisions have their own effect types below. */
export type WorkflowReviewEffect = WorkflowSubmissionEffect;

export interface ClaimCreateResponse extends WorkflowReviewEffect {
  claim: ClaimRecord;
}

export type ChangeRequestType = "create_horse" | "update_horse" | "ownership" | "other";
export type ChangeRequestStatus = "draft" | "pending" | "approved" | "rejected" | "withdrawn";
/** Computed review status (T11): a draft bounced back by a reviewer surfaces as needs_changes. */
export type ChangeRequestReviewStatus = ChangeRequestStatus | "needs_changes";

export interface ChangeRequestItem {
  id?: number;
  field_name: string;
  old_value?: unknown;
  proposed_value: unknown;
}

/** A parent the submitter could not resolve to a registry record (T11). */
export interface UnresolvedParentAssertion {
  name_native?: string;
  name_latin?: string;
  note?: string;
}

/** The structured payload of a create_horse submission (Master-Ai T11). */
export interface HorseSubmission {
  name_native?: string | null;
  name_latin?: string | null;
  register_no?: string | null;
  microchip_no?: string | null;
  passport_no?: string | null;
  passport_issuer?: string | null;
  passport_issue_date?: RegistryDateInput | null;
  passport_expiry?: RegistryDateInput | null;
  uel_no?: string | null;
  life_number?: string | null;
  foreign_registration_no?: string | null;
  foreign_registration_issuer?: string | null;
  birth_name?: string | null;
  previous_names?: string[] | null;
  height_cm?: number | null;
  markings?: string | null;
  life_status?: "unknown" | "alive" | "dead" | "missing";
  death_date?: RegistryDateInput | null;
  birth_year?: number | null;
  birth_place_desc?: string | null;
  breed_desc?: string | null;
  sex_desc?: string | null;
  color_desc?: string | null;
  description?: string | null;
  main_strain_desc?: string | null;
  sub_strain_desc?: string | null;
  father_horse_id?: number | null;
  mother_horse_id?: number | null;
  father_unresolved?: UnresolvedParentAssertion | null;
  mother_unresolved?: UnresolvedParentAssertion | null;
  breeder_person_id?: number | null;
  current_owner_person_id?: number | null;
  /** T12: typed birth date (value + precision + explicit calendar). */
  birth_date?: RegistryDateInput | null;
  /** T12: public birth/keeping places. */
  birth_city?: string | null;
  birth_province?: string | null;
  keeping_city?: string | null;
  keeping_province?: string | null;
}

export interface ChangeRequestRecord {
  id: string;
  horse_id?: number | null;
  request_type: ChangeRequestType;
  status: ChangeRequestStatus;
  summary?: string | null;
  evidence?: Record<string, unknown> | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
  name_latin?: string | null;
  name_native?: string | null;
  submitted_by?: string | null;
  submitted_by_user_id?: string | null;
  items: ChangeRequestItem[];
  /** T11: the structured submission payload (create_horse requests). */
  submission?: HorseSubmission | null;
  /** T12: the structured parent-correction payload (update_horse requests). */
  parent_correction?: ParentCorrectionInput | null;
  review_outcome?: string | null;
  review_status?: ChangeRequestReviewStatus;
  /** T11: the canonical horse id, set only after an approved creation actually landed. */
  canonical_horse_id?: number | null;
  /** R148 Task 5: bumped on every accepted draft edit; echoes the guarded version contract. */
  content_revision?: number;
}

export interface ChangeRequestCreateInput {
  horse_id?: number | null;
  request_type: ChangeRequestType;
  summary?: string;
  evidence?: Record<string, unknown>;
  items?: Array<Pick<ChangeRequestItem, "field_name" | "proposed_value"> & { old_value?: unknown }>;
  /** T11: structured payload for create_horse requests. */
  submission?: HorseSubmission | null;
  /** T12: structured parent-correction payload for update_horse requests. */
  parent_correction?: ParentCorrectionInput | null;
  /** T11: per-user dedupe key — a repeated key replays the original request. */
  idempotency_key?: string;
  /** T11: false stores the request as a draft instead of submitting it. */
  submit?: boolean;
}

export interface ChangeRequestEditInput {
  /** R148 Task 5: the content_revision the editing form loaded. A stale value gets a 409 content_revision_conflict instead of clobbering a newer save. */
  expected_content_revision: number;
  summary?: string;
  evidence?: Record<string, unknown> | null;
  items?: Array<Pick<ChangeRequestItem, "field_name" | "proposed_value"> & { old_value?: unknown }> | null;
  submission?: HorseSubmission | null;
  /** T12: replace the structured parent-correction payload of a draft. */
  parent_correction?: ParentCorrectionInput | null;
}

export interface ChangeRequestsMineResponse { requests: ChangeRequestRecord[]; }
export interface ChangeRequestCreateResponse extends WorkflowReviewEffect { request: ChangeRequestRecord; idempotent_replay?: boolean; }
export interface ChangeRequestTransitionResponse extends WorkflowReviewEffect { request: ChangeRequestRecord; }

export interface ClaimReviewResponse {
  claim: AdminClaimRecord;
  workflowEffect: "review_only" | "canonical_owner_link";
  canonicalApplied: boolean;
  /** Approval can grant scoped access without creating a legal owner link. */
  accessGranted?: boolean;
}
export interface ChangeRequestReviewResponse {
  request: ChangeRequestRecord;
  workflowEffect: "review_only" | "canonical_horse_create" | "canonical_horse_update";
  canonicalApplied: boolean;
  /** T11: present only after an approved submission actually created the canonical horse. */
  canonical_horse_id?: number;
  horse?: AdminHorseRecord;
  ownership_note?: string;
  appliedFields?: string[];
}

export interface AdminHorseRecord extends HorseRecord {
  birth_date_source?: string | null;
  microchip_no?: string | null;
  file_number?: string | null;
  lab_no?: string | null;
  passport_no?: string | null;
  passport_issuer?: string | null;
  passport_issue_date_value?: string | null;
  passport_issue_date_precision?: string | null;
  passport_issue_date_calendar?: string | null;
  passport_expiry_value?: string | null;
  passport_expiry_precision?: string | null;
  passport_expiry_calendar?: string | null;
  foreign_registration_no?: string | null;
  foreign_registration_issuer?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
  row_version: number;
  // T12: staff-only curation fact — the private precise address (typed dates
  // are carried by the *_value/*_precision/*_calendar columns of HorseRecord).
  precise_address?: string | null;
  // Turn 12: staff-only data lineage — which import/scrape produced this row
  // (e.g. original_import:horse-allll.xlsx/2026-08-24, scrape:sheyhe.com/2026-10).
  data_origin?: string | null;
}

export interface HorseCurationInput {
  id?: number;
  name_latin: string;
  /** R148 Task 6: stable command identity for create retry idempotency (SDK mints one automatically). */
  command_key?: string;
  name_native?: string | null;
  register_no?: string | null;
  microchip_no?: string | null;
  passport_no?: string | null;
  passport_issuer?: string | null;
  passport_issue_date?: RegistryDateInput | null;
  passport_expiry?: RegistryDateInput | null;
  uel_no?: string | null;
  life_number?: string | null;
  foreign_registration_no?: string | null;
  foreign_registration_issuer?: string | null;
  birth_name?: string | null;
  previous_names?: string[] | null;
  markings?: string | null;
  height_cm?: number | null;
  life_status?: "unknown" | "alive" | "dead" | "missing";
  father_id?: number | null;
  mother_id?: number | null;
  birth_year?: number | null;
  birth_place_desc?: string | null;
  breed_desc?: string | null;
  sex_desc?: string | null;
  color_desc?: string | null;
  description?: string | null;
  // T07: strains are settable through direct edits AND reviewed change
  // requests — both paths share the same validation rules now.
  main_strain_desc?: string | null;
  sub_strain_desc?: string | null;
  // T12: typed registry dates (value + precision + explicit calendar) and
  // public places. precise_address is editor-direct only (PII).
  birth_date?: RegistryDateInput | null;
  death_date?: RegistryDateInput | null;
  castration_date?: RegistryDateInput | null;
  birth_city?: string | null;
  birth_province?: string | null;
  keeping_city?: string | null;
  keeping_province?: string | null;
  precise_address?: string | null;
}

/** T12: shape of a typed date as clients send and receive it. */
export interface RegistryDateInput {
  value: string;
  precision: "day" | "month" | "year";
  calendar: "gregorian" | "solar_hijri";
}

/** T12: one dated lifecycle fact from a horse's history. */
export interface HorseLifecycleEventRecord {
  id: number;
  event_type: "death" | "castration" | "retirement" | "export" | "import" | "other";
  date_value: string;
  date_precision: string;
  date_calendar: string;
  uncertain_time: number;
  note: string | null;
  source_ref: string | null;
  created_at: string;
}

export interface HorseLifecycleResponse {
  horse_id: number;
  events: HorseLifecycleEventRecord[];
}

/** T12: one historical title period (co-ownership shares optional). */
export interface HorseOwnershipPeriodRecord {
  id: number;
  owner_person_id: number;
  owner_name_latin: string | null;
  owner_name_native: string | null;
  start_value: string;
  start_precision: string;
  start_calendar: string;
  end_value: string | null;
  end_precision: string | null;
  end_calendar: string | null;
  share_percent: number | null;
}

export interface HorseOwnershipResponse {
  horse_id: number;
  periods: HorseOwnershipPeriodRecord[];
}

/** T12: input for a staff-curated ownership period. */
export interface OwnershipPeriodCreateInput {
  owner_person_id: number;
  start: RegistryDateInput;
  end?: RegistryDateInput | null;
  share_percent?: number | null;
  evidence_note?: string | null;
  source?: string | null;
}

/** T12: input for a staff-recorded lifecycle event. */
export interface LifecycleEventCreateInput {
  event_type: HorseLifecycleEventRecord["event_type"];
  date: RegistryDateInput;
  uncertain_time?: boolean | null;
  note?: string | null;
  source_ref?: string | null;
}

/** T12: structured parent-correction submission for update_horse requests. */
export interface ParentCorrectionInput {
  kind: "parent_correction";
  horse_id: number;
  father_id?: number | null;
  mother_id?: number | null;
  reason: string;
  source: string;
  conflicting_evidence?: string | null;
}


export type ContentPostKind = "article" | "news" | "update";
export type ContentPostStatus = "draft" | "published" | "archived";
/** R117-17: per-language readiness shown on its own, never conflated with
 * publication status — "complete" (title + body present), "partial" (exactly
 * one of title/body present), "missing" (neither present). An English
 * publication therefore never claims a completed Persian translation. */
export type ContentLanguageStatus = "complete" | "partial" | "missing";
/** R117-17: media-publication rights tracked separately from language
 * completeness — "no_media" (no cover image), "attributed" (credit or source
 * URL recorded), "unattributed" (cover image without credit or source). */
export type ContentMediaRights = "no_media" | "attributed" | "unattributed";
/** R117-17: the governed editorial transitions that record a version-history row. */
export type ContentRevisionCause = "create" | "update" | "publish" | "retract";
export type GeminiContentModel = "gemini-2.5-flash" | "gemini-3.8-flash" | "gemini-3.5-flash-lite";
export type AiContentModel = GeminiContentModel | "deepseek-flash" | "offline-test";

export interface ContentSource {
  title: string;
  url: string;
}

export interface ContentPost {
  id: string;
  slug: string;
  kind: ContentPostKind;
  status: ContentPostStatus;
  title_en: string;
  title_fa: string;
  title_ar: string;
  title_zh: string;
  summary_en: string;
  summary_fa: string;
  summary_ar: string;
  summary_zh: string;
  body_en: string;
  body_fa: string;
  body_ar: string;
  body_zh: string;
  tags: string[];
  sources: ContentSource[];
  cover_image_url?: string | null;
  cover_image_alt_en?: string | null;
  cover_image_alt_fa?: string | null;
  cover_image_credit?: string | null;
  cover_image_source_url?: string | null;
  author_user_id?: string | null;
  author_label?: string | null;
  ai_model?: string | null;
  ai_grounding: boolean;
  ai_prompt?: string | null;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  row_version: number;
  /** R117-17: computed server-side from the stored fields — never claimed client-side.
   * Turn 28: the newsroom is fully quadlingual (fa/en/ar/zh) — ar/zh report honestly. */
  language_completeness: { en: ContentLanguageStatus; fa: ContentLanguageStatus; ar: ContentLanguageStatus; zh: ContentLanguageStatus };
  media_publication_rights: ContentMediaRights;
}

/** Turn 30: newsroom reader comments. Only 'published' rows are served by the
 * public read route; visitor submissions arrive as 'pending' and stay invisible
 * until an editor approves them. The row shape is identical for seeded
 * community comments and future visitor comments — nothing betrays origin. */
export type ContentCommentStatus = "published" | "pending" | "hidden";

export interface ContentComment {
  id: string;
  post_id: string;
  author_name: string;
  body: string;
  locale: "fa" | "en" | "ar" | "zh";
  likes: number;
  status: ContentCommentStatus;
  created_at: string;
}

export interface ContentCommentInput {
  author_name: string;
  body: string;
  locale?: ContentComment["locale"];
}

export interface ContentCommentsResponse {
  comments: ContentComment[];
  total: number;
}

export interface ContentCommentSubmitResponse {
  ok: true;
  comment: ContentComment;
  /** Honest moderation notice: the submission is queued, not yet public. */
  moderation: "pending";
}

export interface ContentAdminCommentsResponse {
  comments: ContentComment[];
  total: number;
}

/** R117-17: one immutable version-history entry (snapshot of the post after the change). */
export interface ContentPostRevision {
  id: string;
  post_id: string;
  revision_no: number;
  cause: ContentRevisionCause;
  from_status: ContentPostStatus;
  to_status: ContentPostStatus;
  actor_user_id?: string | null;
  actor_label?: string | null;
  created_at: string;
  post: ContentPost;
}

export interface ContentRevisionsResponse {
  revisions: ContentPostRevision[];
  total: number;
}

/** R117-17: the editor-only preview payload — carries the honest readiness
 * indicators so the preview banner can never claim more than is stored. */
export interface ContentPreviewResponse {
  post: ContentPost;
  preview: true;
}

export interface ContentPostInput {
  kind: ContentPostKind;
  status: ContentPostStatus;
  title_en: string;
  title_fa: string;
  title_ar?: string;
  title_zh?: string;
  summary_en: string;
  summary_fa: string;
  summary_ar?: string;
  summary_zh?: string;
  body_en: string;
  body_fa: string;
  body_ar?: string;
  body_zh?: string;
  tags: string[];
  sources: ContentSource[];
  cover_image_url?: string | null;
  cover_image_alt_en?: string | null;
  cover_image_alt_fa?: string | null;
  cover_image_credit?: string | null;
  cover_image_source_url?: string | null;
  ai_model?: string | null;
  ai_grounding?: boolean;
  ai_prompt?: string | null;
}

export interface ContentListResponse {
  posts: ContentPost[];
  total: number;
  limit: number;
  offset: number;
}

export interface AiContentGenerateInput {
  model: AiContentModel;
  grounding: boolean;
  kind: ContentPostKind;
  topic?: string;
}

export interface AiAdminKeyRecord {
  id: string;
  provider: string;
  label: string;
  masked: string;
  is_enabled: boolean;
  last_status: string | null;
  last_used_at: string | null;
  created_at: string;
  /** A19/B06: whether this row is stored as an encrypted envelope (vs legacy plaintext). */
  encrypted?: boolean;
  /** Present when the stored envelope could not be decrypted with the current secret set. */
  decryption_error?: string;
}

export interface AiAdminKeyRingKey {
  id: string;
  source: "env" | "database";
  label: string;
  masked: string;
  cooling: boolean;
  cooldownRemainingMs: number;
  lastUsedAt: string | null;
  lastStatus: string | null;
}

export interface AiAdminKeysResponse {
  keys: AiAdminKeyRecord[];
  envKeyCount: number;
  ring: { totalKeys: number; availableKeys: number; coolingKeys: number; keys: AiAdminKeyRingKey[] } | null;
  /** A19/B06 encryption-at-rest status for the admin key store. */
  encryption?: {
    available: boolean;
    activeConfigured: boolean;
    legacyPlaintextRows: number;
    undecryptableRows: number;
  };
}

export interface AiAdminKeyRotationResponse {
  ok: boolean;
  converted: number;
  alreadyCurrent: number;
  failed: Array<{ id: string; error: string }>;
}

export interface AiAdminKeyTestResponse {
  ok: boolean;
  code: string;
  message: string;
}

export interface AiAdminSettings {
  /** Admin-selected default chat model id, or null for the system default. */
  defaultChatModel: string | null;
  /** Admin-selected default execution mode, or null for "auto". */
  defaultExecutionMode: "fast" | "auto" | "research" | null;
}

export interface AiAdminSettingsResponse {
  settings: AiAdminSettings;
  models: Array<{ provider: string; id: string; label: string; available: boolean; vision: boolean; paid: boolean; defaultForChat?: boolean }>;
}

export interface AiContentGenerateResponse {
  draft: ContentPostInput;
  post: ContentPost | null;
  sources: ContentSource[];
  /** Non-fatal runtime notices (e.g. grounding skipped because the operator disabled it, or a model fallback occurred). */
  warnings?: string[];
  /** Human-readable summary of the resilience measures actually used (key rotation, retries, repairs). */
  attempts?: string[];
}

export interface AdminDashboardResponse {
  horses: number;
  people: number;
  openIssues: number;
  changesLast7Days: number;
  reindexJobs: number;
  /** Pending durable mutation intents whose audit side-effect still needs reconciliation. */
  pendingMutations?: number;
  /** Optional derived-snapshot freshness indicator; stale state uses exact live dashboard counts. */
  snapshotStale?: boolean;
}

export interface AuditEventSummary {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  reason?: string | null;
  created_at: string;
  actor?: string | null;
}

export interface AdminQualityIssue {
  id: number;
  horse_id?: number | null;
  issue_code: string;
  severity: "info" | "warning" | "error";
  field_name?: string | null;
  message: string;
  detected_at: string;
  name_latin?: string | null;
  /** R145-E04 workflow columns (optional for older compatible servers). */
  horse_name_native?: string | null;
  horse_register_no?: string | null;
  details?: unknown;
  resolved_at?: string | null;
  resolution_note?: string | null;
  status?: "open" | "assigned" | "resolved";
  assigned_to?: string | null;
  assignee_name?: string | null;
  assigned_at?: string | null;
  source?: string | null;
  rule_version?: string | null;
  resolver_name?: string | null;
  age_days?: number | null;
}

/** R145-E04: reconciled queue counts — computed from the SAME table as the rows. */
export interface QualityQueueListParams {
  severity?: AdminQualityIssue["severity"];
  status?: "open" | "assigned" | "resolved" | "all";
  issue_code?: string;
  assigned?: "me" | "unassigned";
  limit?: number;
}

export interface QualityQueueCounts {
  open: number;
  assigned: number;
  resolved: number;
  total: number;
  unresolved_by_severity: Array<{ value: string; count: number }>;
  unresolved_by_code: Array<{ value: string; count: number }>;
}

export interface QualityQueueListResponse {
  issues: AdminQualityIssue[];
  counts: QualityQueueCounts;
  low_risk_bulk_codes: string[];
  limit: number;
  note: string;
}

export interface QualityIssueEvent {
  id: number;
  event_type: "detected" | "assigned" | "resolved" | "reopened" | "note";
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export interface QualityIssueDetailResponse {
  issue: AdminQualityIssue;
  history: QualityIssueEvent[];
}

export interface QualityScanResponse {
  ok: boolean;
  detected_candidates: number;
  created: number;
  open_issues: number;
  rule_version: string;
  /** Keyset paging: repeat with resume_after until completed=true (production corpora never fit one request). */
  completed: boolean;
  resume_after: number | null;
  scanned_from: number;
  scanned_to: number;
  note: string;
}

/** R146-D04: the bounded, versioned rules service. A rule is DATA validated
 *  against its typed schema — never executable policy. */
export interface RegistryRuleRecord {
  id: string;
  rule_type: "registration_numbering" | "studbook_admission" | "identifier_conflict" | "required_evidence" | "chronology" | "life_status";
  title: string;
  severity: "info" | "warning" | "error" | "blocker";
  applicability: Record<string, unknown>;
  spec: Record<string, unknown>;
  state: "draft" | "report_only" | "active" | "retired";
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegistryRuleListResponse {
  rules: RegistryRuleRecord[];
  recent_fail_counts_30d: Record<string, number>;
  total: number;
}

export interface RegistryRuleVersionRecord {
  id: number;
  version: number;
  state: string;
  title: string;
  severity: string;
  applicability: Record<string, unknown>;
  spec: Record<string, unknown>;
  changed_by: string | null;
  change_note: string | null;
  created_at: string;
}

export interface RegistryRuleOutcomeRecord {
  id: number;
  /** Null for historical outcomes recorded before atomic policy receipts. */
  operation_id?: string | null;
  policy_revision?: number | null;
  rule_version: number;
  subject_type: string;
  subject_ref: string | null;
  outcome: "fail" | "override";
  detail: Record<string, unknown> | null;
  override_by: string | null;
  override_reason: string | null;
  created_at: string;
}

export interface RegistryRuleDetailResponse {
  rule: RegistryRuleRecord;
  versions: RegistryRuleVersionRecord[];
  outcomes: RegistryRuleOutcomeRecord[];
}

export interface RegistryRulePreviewResponse {
  rule_id: string;
  previewed: number;
  pass: number;
  fail: number;
  sample: Array<{ horse_id: number; name_latin: string | null; failures: Array<{ requirement: string; detail: string | null }> }>;
  note: string;
}

/** R146-D05: field-level claims and conflict resolution. */
export interface FieldClaimRecord {
  id: number;
  horse_id: number;
  horse_name?: string | null;
  field_name: string;
  claimed_value: string | null;
  value_kind: "text" | "number" | "date" | "horse_ref";
  source_type: "import" | "external_scrape" | "owner_statement" | "professional" | "review" | "prior_canonical";
  source_ref: string | null;
  evidence: Record<string, unknown> | null;
  observed_at: string | null;
  review_status: "pending" | "selected" | "rejected" | "superseded";
  created_at: string;
}

export interface FieldClaimDecisionRecord {
  id: number;
  horse_id: number;
  field_name: string;
  decision: "select_claim" | "keep_canonical" | "revert";
  claim_id: number | null;
  previous_canonical: Record<string, unknown> | null;
  applied_value: string | null;
  decided_by: string;
  reason: string;
  reverted_by_decision_id: number | null;
  created_at: string;
}

export interface HorseFieldClaimsResponse {
  horse_id: number;
  name_latin: string | null;
  row_version: number;
  fields: Record<string, { canonical: string | null; claims: FieldClaimRecord[] }>;
  decisions: FieldClaimDecisionRecord[];
}

export interface FieldClaimQueueResponse {
  claims: FieldClaimRecord[];
  counts: Record<string, number>;
  limit: number;
}

/** R145-C04: deliberately limited public evidence summary (no private presence). */
export interface EvidenceSummaryResponse {
  horse_id: number;
  name_latin: string | null;
  name_native: string | null;
  lifecycle_vocabulary: Record<string, string>;
  media: Record<string, number>;
  media_by_type: Array<{ media_type: string; verification: string; count: number }>;
  attestations: Record<string, number>;
  attestations_truncated?: boolean;
  attestations_by_record_kind: Array<{ record_kind: string; status: string; count: number }>;
  genetics_published: Record<string, number>;
  note: string;
}

/** R145-C05: authorized exact identifier lookup (minimal fields, no namespace harvest). */
export interface ExactIdentifierResponse {
  kind: string;
  matched: number;
  results: Array<{
    id: number;
    name_latin: string | null;
    name_native: string | null;
    register_no: string | null;
    birth_year: number | null;
    active: boolean;
  }>;
  note: string;
}

export interface AdminClaimRecord extends ClaimRecord {
  claimant?: string | null;
  /** Protected reviewer projection only; omitted by older compatible servers. */
  person_id?: number | null;
  evidence?: Record<string, unknown> | null;
}
export interface ReindexResponse { processed: number; failed: number; remaining: number; }
export interface MutationReconciliationResponse { processed: number; remaining: number; quarantined: number; }

// ---------------------------------------------------------------------------
// R117-18 (Master AI R117 handoff D43) — the privacy redaction operator
// queue: decision vs execution surfaced as SEPARATE states. The R114
// fulfillment executor stays the server authority; these types only carry
// its honest answers. A grant is a decision; only the executor's own
// operation receipt reports completion.
// ---------------------------------------------------------------------------

/** Subject redaction categories the operator queue currently covers. */
export type SubjectRedactionCategory = "service_request_notes" | "service_request_contact_location";

/** One queue row: the request, its decision state AND its separate
 * execution state (the executor receipt, not the decision, is the proof). */
export interface AdminRedactionQueueRow {
  id: number;
  subject_user_id: string;
  subject_name: string | null;
  service_request_id: number | null;
  data_category: SubjectRedactionCategory;
  request_note: string;
  status: "received" | "deferred_active_hold" | "granted" | "refused";
  hold_interaction: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  execution_status: "completed" | null;
  executed_at: string | null;
  execution_receipt_json: string | null;
  request_under_active_hold: boolean;
  /** Computed server-side: a grant never claims execution. */
  redaction_completed: boolean;
  fulfillment_status: "completed" | "blocked_active_hold" | "not_executed" | "not_applicable";
}

export interface AdminRedactionQueueResponse {
  requests: AdminRedactionQueueRow[];
  counts: { received: number; deferred_active_hold: number; granted: number; refused: number; executed: number };
  note: string;
}

export interface RedactionDecisionInput {
  decision: "grant" | "refuse";
  decision_note: string;
}

export interface RedactionDecideResponse {
  decided: true;
  request_id: number;
  decision: "grant" | "refuse";
  redaction_completed: boolean;
  fulfillment_status: string;
  note: string;
}

export interface RedactionFulfillResponse {
  fulfilled: true;
  already_fulfilled?: boolean;
  request_id: number;
  category?: string;
  already_minimized?: boolean;
  execution_receipt: Record<string, unknown> | null;
  redaction_completed: boolean;
  fulfillment_status: "completed";
  note: string;
}

export interface SearchMetaResponse {
  syntaxVersion: string;
  maxQueryLength: number;
  fields: Array<{ key: string; aliases: string[] }>;
  registryFieldSearch: {
    version: string;
    combinator: "and";
    fields: Array<{ key: string; queryParam: string; type: string }>;
  };
}

export interface PlatformRequestOptions {
  signal?: AbortSignal;
  /**
   * R88 agent plan P03: client-supplied idempotency key for marketplace
   * mutation commands. Sent as the Idempotency-Key header; the server claims
   * one durable receipt per (actor, command, target) — the same key + payload
   * replays the stored response, the same key under a different payload is a
   * 409 idempotency_conflict.
   */
  idempotencyKey?: string;
}

/** Providers that callers may explicitly select through the public client. */
export type AiProviderName = "gemini" | "deepseek";
/** Actual response providers include the server-gated isolated local assistant. */
export type AiRuntimeProviderName = AiProviderName | "offline";
export type AiExecutionMode = "fast" | "auto" | "research";
export interface AiImageReference { kind: "image"; url: string; mimeType?: string | null; altText?: string | null; }
export interface AiEntityReference { kind: "horse" | "person" | "content" | "pedigree" | "external"; id: string; label: string; href: string; subtitle?: string | null; }
export interface AiEvidenceReference { id: string; kind: "registry_record" | "pedigree_calculation" | "registry_analytics" | "published_content" | "external_source" | "user_attachment"; title: string; sourceRef: string; entityRefs?: AiEntityReference[]; completeness?: { total?: number | null; returned?: number | null; truncated?: boolean; hasMore?: boolean; cursor?: string | null; coveragePercent?: number | null; note?: string | null; }; }
export interface AiConversationMessage { id: string; role: "user" | "assistant" | "system_event"; text: string; clientMessageId?: string | null; provider?: AiRuntimeProviderName | null; model?: string | null; status?: "pending" | "complete" | "error" | "cancelled"; evidence?: AiEvidenceReference[]; entityRefs?: AiEntityReference[]; attachments?: AiImageReference[]; createdAt: string; }
export interface AiConversationSummary { id: string; title: string | null; locale: string; executionMode: AiExecutionMode; preferredProvider?: AiRuntimeProviderName | null; preferredModel?: string | null; activeProvider: AiRuntimeProviderName | null; activeModel: string | null; updatedAt: string; lastActivityAt: string; messageCount?: number; busy?: boolean; /** True while the D1 write quota is exhausted: session-only conversation. */ ephemeral?: boolean; }
export interface AiConversationDetail extends AiConversationSummary { messages: AiConversationMessage[]; }
export interface AiModelDescriptor { provider: AiRuntimeProviderName; id: string; label: string; available: boolean; vision: boolean; paid: boolean; defaultForChat?: boolean; }
export interface AiAssistantStatus { available: boolean; defaultModel: string | null; models: AiModelDescriptor[]; visionAvailable: boolean; storageReady: boolean; reason?: string | null; }
export type AiClientStreamEvent =
 | { type: "meta"; conversationId: string; messageId?: string; provider?: AiRuntimeProviderName; model?: string }
 | { type: "text_delta"; text: string } | { type: "draft_reset" } | { type: "status"; code: string; text: string }
 | { type: "trace"; at: string; phase: string; data?: Record<string, unknown> }
 | { type: "evidence"; evidence: AiEvidenceReference[]; entityRefs: AiEntityReference[] }
 | { type: "usage"; usage: Record<string, number | undefined>; provider: AiRuntimeProviderName; model: string }
 | { type: "done"; message: AiConversationMessage } | { type: "error"; code: string; message: string; details?: unknown };

export interface PlatformClient {
  readonly contractVersion: typeof PLATFORM_CONTRACT_VERSION;
  care: CareClient;
  metadata: MetadataClient;
  auth: {
    mfa: MfaClient;
    me(options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    login(input: PlatformLoginInput, options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    demoAdmin(options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    /** Synthetic personas exist only in the explicitly isolated local demo. */
    demoPersona(persona: "admin" | "owner_a" | "owner_b" | "reviewer" | "provider" | "manager" | "staff", options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    logout(options?: PlatformRequestOptions): Promise<void>;
  };
  meta(options?: PlatformRequestOptions): Promise<PlatformMetaResponse>;
  health(options?: PlatformRequestOptions): Promise<PlatformHealthResponse>;
  ai: {
    status(options?: PlatformRequestOptions): Promise<AiAssistantStatus>;
    models(options?: PlatformRequestOptions): Promise<{ models: AiModelDescriptor[]; defaultModel: string | null; visionAvailable: boolean }>;
    list(options?: PlatformRequestOptions): Promise<{ conversations: AiConversationSummary[] }>;
    create(input?: { mode?: AiExecutionMode; locale?: string; provider?: AiProviderName | null; model?: string | null }, options?: PlatformRequestOptions): Promise<{ conversation: AiConversationSummary }>;
    get(id: string, options?: PlatformRequestOptions): Promise<{ conversation: AiConversationDetail }>;
    remove(id: string, options?: PlatformRequestOptions): Promise<{ ok: boolean }>;
    stream(id: string, input: { clientMessageId: string; text: string; mode?: AiExecutionMode; attachments?: AiImageReference[]; provider?: AiProviderName | null; model?: string | null; pageContext?: { route?: string; horseId?: number; personId?: number; articleSlug?: string } }, options?: PlatformRequestOptions): AsyncIterable<AiClientStreamEvent>;
  };
  search: {
    horses(query: string, options?: PlatformRequestOptions & { limit?: number }): Promise<HorseSearchResponse>;
    meta(options?: PlatformRequestOptions): Promise<SearchMetaResponse>;
    /** R145-C05: authorized exact chip/passport lookup — staff capability; a miss is indistinguishable from a concealed record. */
    exactIdentifier(kind: "microchip" | "passport" | "life_number" | "uel" | "register", value: string, options?: PlatformRequestOptions): Promise<ExactIdentifierResponse>;
  };
  registry: {
    browse(params?: RegistryBrowseParams, options?: PlatformRequestOptions): Promise<RegistryBrowseResponse>;
    facets(options?: PlatformRequestOptions): Promise<RegistryFacetsResponse>;
  };
  exports: {
    /** Build a canonical same-origin download URL without exposing raw API routes to frontends. */
    registry(params?: Omit<RegistryBrowseParams, "limit" | "offset">, format?: RegistryExportFormat): RegistryExportDescriptor;
  };
  horses: {
    get(id: number, options?: PlatformRequestOptions): Promise<HorseProfileResponse>;
    /** T12: dated lifecycle history (death, castration, retirement...). */
    lifecycle(id: number, options?: PlatformRequestOptions): Promise<HorseLifecycleResponse>;
    /** T12: historical ownership periods (title facts, not permissions). */
    ownership(id: number, options?: PlatformRequestOptions): Promise<HorseOwnershipResponse>;
    /** R145-C04: the deliberately limited public evidence summary. */
    evidenceSummary(id: number, options?: PlatformRequestOptions): Promise<EvidenceSummaryResponse>;
  };
  people: {
    list(params?: { q?: string; role?: "breeder"; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<PeopleListResponse>;
    get(id: number, options?: PlatformRequestOptions): Promise<PersonProfileResponse>;
  };
  pedigree: {
    ancestors(id: number, params?: { depth?: number }, options?: PlatformRequestOptions): Promise<AncestorPedigreeResponse>;
    descendants(id: number, params?: { depth?: number; maxNodes?: number }, options?: PlatformRequestOptions): Promise<DescendantPedigreeResponse>;
    metrics(id: number, params?: { depth?: number }, options?: PlatformRequestOptions): Promise<PedigreeMetricsResponse>;
    descendantMetrics(id: number, params?: { depth?: number; maxNodes?: number }, options?: PlatformRequestOptions): Promise<DescendantMetricsResponse>;
    coefficients(id: number, params?: { depth?: number }, options?: PlatformRequestOptions): Promise<PedigreeCoefficientResponse>;
    pathsToAncestor(id: number, ancestorId: number, params?: { depth?: number; maxPaths?: number }, options?: PlatformRequestOptions): Promise<PedigreePathResponse>;
  };
  relationships: {
    commonAncestors(from: number, to: number, params?: { depth?: number }, options?: PlatformRequestOptions): Promise<RelationshipResponse>;
    coefficients(from: number, to: number, params?: { depth?: number }, options?: PlatformRequestOptions): Promise<RelationshipCoefficientResponse>;
  };
  breeding: {
    pairingAnalysis(sireId: number, damId: number, params?: { depth?: number }, options?: PlatformRequestOptions): Promise<BreedingPairingAnalysisResponse>;
    pairingEvidence(sireId: number, damId: number, options?: PlatformRequestOptions): Promise<ArabianPairingEvidenceResponse>;
    optimize(input: BreedingOptimizerInput, options?: PlatformRequestOptions): Promise<BreedingOptimizerResponse>;
  };
  analytics: {
    horseInsights(id: number, params?: { ancestorDepth?: number; descendantDepth?: number; metricsDepth?: number; coefficientDepth?: number }, options?: PlatformRequestOptions): Promise<HorseInsightsResponse>;
    registry(options?: PlatformRequestOptions): Promise<RegistryAnalyticsResponse>;
  };
  quality: {
    summary(options?: PlatformRequestOptions): Promise<QualitySummaryResponse>;
  };
  content: {
    list(params?: { kind?: ContentPostKind; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<ContentListResponse>;
    get(slug: string, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
    /** Turn 30: published reader comments of a post — public read. */
    comments(postId: string, options?: PlatformRequestOptions): Promise<ContentCommentsResponse>;
    /** Turn 30: submit a reader comment — queued as 'pending', never auto-published. */
    submitComment(postId: string, input: ContentCommentInput, options?: PlatformRequestOptions): Promise<ContentCommentSubmitResponse>;
  };
  claims: {
    mine(options?: PlatformRequestOptions): Promise<ClaimsMineResponse>;
    create(horseId: number, evidence?: Record<string, unknown>, options?: PlatformRequestOptions): Promise<ClaimCreateResponse>;
  };
  changes: {
    evidence: {
      list(requestId: string, options?: PlatformRequestOptions): Promise<RegistrationEvidenceListResponse>;
      upload(requestId: string, input: RegistrationEvidenceUploadInput, options?: PlatformRequestOptions): Promise<{ evidence: RegistrationEvidenceRecord; idempotent_replay: boolean }>;
      remove(requestId: string, evidenceId: string, options?: PlatformRequestOptions): Promise<{ removed: boolean; evidence_id: string }>;
      fileUrl(requestId: string, evidenceId: string): string;
    };
    mine(options?: PlatformRequestOptions): Promise<ChangeRequestsMineResponse>;
    create(input: ChangeRequestCreateInput, options?: PlatformRequestOptions): Promise<ChangeRequestCreateResponse>;
    /** T11: edit the content of your own draft request (e.g. after needs_changes). */
    update(requestId: string, input: ChangeRequestEditInput, options?: PlatformRequestOptions): Promise<ChangeRequestTransitionResponse>;
    /** T11: draft -> pending. */
    submit(requestId: string, options?: PlatformRequestOptions): Promise<ChangeRequestTransitionResponse>;
    /** T11: draft/pending -> withdrawn. */
    withdraw(requestId: string, options?: PlatformRequestOptions): Promise<ChangeRequestTransitionResponse>;
  };
  admin: {
    dashboard(options?: PlatformRequestOptions): Promise<AdminDashboardResponse>;
    content: {
      list(params?: { kind?: ContentPostKind; status?: ContentPostStatus; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<ContentListResponse>;
      create(input: ContentPostInput, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
      update(id: string, expectedRowVersion: number, input: ContentPostInput, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
      generate(input: AiContentGenerateInput, options?: PlatformRequestOptions): Promise<AiContentGenerateResponse>;
      /** R117-17: editor-only preview of any saved post — drafts are never served by the public read routes. */
      preview(id: string, options?: PlatformRequestOptions): Promise<ContentPreviewResponse>;
      /** R117-17: the explicit human publish action — draft/archived becomes
 * published; requires a complete English edition. */
      publish(id: string, expectedRowVersion: number, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
      /** R117-17: retract a publication — published becomes archived; public
 * reads stop serving it immediately. */
      retract(id: string, expectedRowVersion: number, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
      /** R117-17: the immutable per-post version history, newest first. */
      revisions(id: string, options?: PlatformRequestOptions): Promise<ContentRevisionsResponse>;
      /** Turn 30: comment moderation queue + actions. */
      comments(params?: { status?: ContentCommentStatus; limit?: number }, options?: PlatformRequestOptions): Promise<ContentAdminCommentsResponse>;
      moderateComment(commentId: string, action: "approve" | "hide" | "delete", options?: PlatformRequestOptions): Promise<{ ok: boolean }>;
    };
    ai: {
      status(options?: PlatformRequestOptions): Promise<Record<string, unknown>>;
      keys(options?: PlatformRequestOptions): Promise<AiAdminKeysResponse>;
      addKey(input: { provider: "gemini"; label: string; apiKey: string }, options?: PlatformRequestOptions): Promise<{ ok: boolean; id: string; masked: string }>;
      updateKey(id: string, input: { is_enabled?: boolean; label?: string }, options?: PlatformRequestOptions): Promise<{ ok: boolean }>;
      deleteKey(id: string, options?: PlatformRequestOptions): Promise<{ ok: boolean }>;
      testKey(id: string, options?: PlatformRequestOptions): Promise<AiAdminKeyTestResponse>;
      /** A19/B06: re-encrypt every stored key under the currently active secret (converts legacy plaintext rows). */
      rotateKeyEncryption(options?: PlatformRequestOptions): Promise<AiAdminKeyRotationResponse>;
      getSettings(options?: PlatformRequestOptions): Promise<AiAdminSettingsResponse>;
      updateSettings(input: AiAdminSettings, options?: PlatformRequestOptions): Promise<{ ok: boolean; settings: AiAdminSettings }>;
    };
    audit(options?: PlatformRequestOptions): Promise<{ events: AuditEventSummary[] }>;
    /** R145-E04: the usable data-quality queue — reconciled counts ride along. */
    quality(params?: { severity?: AdminQualityIssue["severity"]; status?: "open" | "assigned" | "resolved" | "all"; issue_code?: string; assigned?: "me" | "unassigned"; limit?: number }, options?: PlatformRequestOptions): Promise<QualityQueueListResponse>;
    qualityDetail(id: number, options?: PlatformRequestOptions): Promise<QualityIssueDetailResponse>;
    qualityAssign(id: number, assigneeUserId: string, note?: string | null, options?: PlatformRequestOptions): Promise<{ ok: boolean; id: number; status: string; assigned_to: string }>;
    qualityResolve(id: number, resolutionNote: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; id: number; status: string }>;
    qualityReopen(id: number, note: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; id: number; status: string }>;
    qualityNote(id: number, note: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; id: number; noted: boolean }>;
    qualityBulkResolve(ids: number[], resolutionNote: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; resolved: number; ids: number[] }>;
    qualityScan(params?: { resume_after?: number }, options?: PlatformRequestOptions): Promise<QualityScanResponse>;
    /** R146-D04: the bounded, versioned rules service — draft, report_only, active, retired. */
    rules: {
      list(params?: { state?: RegistryRuleRecord["state"]; rule_type?: RegistryRuleRecord["rule_type"] }, options?: PlatformRequestOptions): Promise<RegistryRuleListResponse>;
      create(input: { id: string; rule_type: RegistryRuleRecord["rule_type"]; title: string; severity: RegistryRuleRecord["severity"]; applicability?: Record<string, unknown>; spec: Record<string, unknown> }, options?: PlatformRequestOptions): Promise<{ rule: RegistryRuleRecord }>;
      detail(ruleId: string, options?: PlatformRequestOptions): Promise<RegistryRuleDetailResponse>;
      patch(ruleId: string, input: { expected_version: number; title?: string; severity?: RegistryRuleRecord["severity"]; applicability?: Record<string, unknown>; spec?: Record<string, unknown>; change_note?: string | null }, options?: PlatformRequestOptions): Promise<{ rule: RegistryRuleRecord }>;
      transition(ruleId: string, input: { expected_version: number; state: RegistryRuleRecord["state"]; change_note?: string | null }, options?: PlatformRequestOptions): Promise<{ rule: RegistryRuleRecord }>;
      preview(ruleId: string, limit?: number, options?: PlatformRequestOptions): Promise<RegistryRulePreviewResponse>;
    };
    /** R146-D05: field-level claims and conflict resolution. */
    fieldClaims: {
      queue(params?: { status?: FieldClaimRecord["review_status"] | "all"; limit?: number }, options?: PlatformRequestOptions): Promise<FieldClaimQueueResponse>;
      horse(horseId: number, options?: PlatformRequestOptions): Promise<HorseFieldClaimsResponse>;
      select(horseId: number, claimId: number, reason: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; applied_value: string | null; previous_canonical: string | null }>;
      reject(horseId: number, claimId: number, reason: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; claim: FieldClaimRecord }>;
      revertDecision(horseId: number, decisionId: number, reason: string, options?: PlatformRequestOptions): Promise<{ ok: boolean; reverted_decision_id: number; restored_value: string | null }>;
    };
    claims(options?: PlatformRequestOptions): Promise<{ claims: AdminClaimRecord[] }>;
    reviewClaim(claimId: string, decision: "approved" | "rejected", note?: string | null, options?: PlatformRequestOptions): Promise<ClaimReviewResponse>;
    changeRequests(options?: PlatformRequestOptions): Promise<{ requests: ChangeRequestRecord[] }>;
    reviewChangeRequest(requestId: string, decision: "approved" | "rejected" | "needs_changes", note?: string | null, options?: PlatformRequestOptions): Promise<ChangeRequestReviewResponse>;
    horses: {
      get(id: number, options?: PlatformRequestOptions): Promise<{ horse: AdminHorseRecord }>;
      create(input: HorseCurationInput, options?: PlatformRequestOptions): Promise<{ horse: AdminHorseRecord }>;
      update(id: number, expectedRowVersion: number, changes: Partial<Omit<HorseCurationInput, "id">>, options?: PlatformRequestOptions): Promise<{ horse: AdminHorseRecord }>;
      archive(id: number, options?: PlatformRequestOptions): Promise<{ ok: true; horseId: number }>;
      /** T12: record a historical ownership period (overlap + share guarded). */
      createOwnershipPeriod(id: number, input: OwnershipPeriodCreateInput, options?: PlatformRequestOptions): Promise<{ period: HorseOwnershipPeriodRecord | null; possible_overlap_period_ids: number[] }>;
      /** T12: record a lifecycle event; death/castration also update the canonical typed date. */
      createLifecycleEvent(id: number, input: LifecycleEventCreateInput, options?: PlatformRequestOptions): Promise<{ events: HorseLifecycleEventRecord[]; canonical_field_updated: string | null }>;
    };
    maintenance: {
      reindex(options?: PlatformRequestOptions): Promise<ReindexResponse>;
      reconcileMutations(options?: PlatformRequestOptions): Promise<MutationReconciliationResponse>;
    };
    /** R117-18: the privacy redaction operator surface over the retained R114
     * executor — queue read + decide + fulfill. A grant is a decision; only
     * the fulfill receipt reports completion. No policy expansion rides on
     * this surface — subject categories stay the server-approved set. */
    privacy: {
      redactionQueue(options?: PlatformRequestOptions): Promise<AdminRedactionQueueResponse>;
      decideRedaction(id: number, input: RedactionDecisionInput, options?: PlatformRequestOptions): Promise<RedactionDecideResponse>;
      fulfillRedaction(id: number, executionNote?: string | null, options?: PlatformRequestOptions): Promise<RedactionFulfillResponse>;
    };
    /** R141: duplicate-resolution workbench — standing candidate miner,
     * the versioned merge dry run / commit / guarded reversal, and the
     * recent merge receipts list. All merge commands keep the R117-19
     * semantics: fresh preview digest, idempotent operation keys. */
    duplicates: {
      candidates(params?: { reason?: DuplicateCandidateReason; limit?: number }, options?: PlatformRequestOptions): Promise<DuplicateCandidatesResponse>;
      mergePreview(keptHorseId: number, mergeHorseId: number, options?: PlatformRequestOptions): Promise<MergePreviewResponse>;
      merge(keptHorseId: number, input: { merge_horse_id: number; reason: string; operation_id: string; expected_manifest_digest: string }, options?: PlatformRequestOptions): Promise<MergeCommandResponse>;
      unmerge(mergeId: number, input: { reason: string; operation_id: string }, options?: PlatformRequestOptions): Promise<UnmergeCommandResponse>;
      mergeHistory(params?: { limit?: number; includeResolved?: boolean }, options?: PlatformRequestOptions): Promise<MergeHistoryResponse>;
    };
  };
  /** R47b federation feature modules. */
  modules: {
    competitions: {
      list(params?: { discipline?: string; season?: number; tier?: string; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<CompetitionsListResponse>;
      /** R124 (R122-T05): detail accepts keyset paging — `resultsCursor` is the
       * results_page.next_cursor of the previous page; `resultsLimit` bounds the
       * page size, 1..500 with a 500 default. */
      detail(id: number, options?: PlatformRequestOptions & { resultsCursor?: string; resultsLimit?: number }): Promise<CompetitionDetailResponse>;
      /** R124 (R122-T05): horseHistory accepts keyset paging ordered by
       * event_date then id, descending — `historyCursor` is the
       * history_page.next_cursor of the previous page; `historyLimit` bounds the
       * page size, 1..500 with a 200 default. */
      horseHistory(horseId: number, options?: PlatformRequestOptions & { historyCursor?: string; historyLimit?: number }): Promise<HorseCompetitionsResponse>;
      /** R114-02: versioned single-result create (one operation key, one receipt). */
      adminCreateResult(competitionId: number, input: { result: CompetitionResultInput; operation_id: string }, options?: PlatformRequestOptions): Promise<CompetitionResultCommandResponse>;
      /** R114-02: versioned result update — exact expected_version, no rebase. */
      adminUpdateResult(competitionId: number, resultId: number, input: { expected_version: number; changes: CompetitionResultChange; operation_id: string }, options?: PlatformRequestOptions): Promise<CompetitionResultCommandResponse>;
      /** R114-02: versioned event update — merged event must keep R113 invariants. */
      adminUpdateEvent(competitionId: number, input: { expected_version: number; changes: CompetitionEventChange; operation_id: string }, options?: PlatformRequestOptions): Promise<CompetitionEventCommandResponse>;
    };
    /** R140-G: the national racing surfaces (read-only, provenance-stamped). */
    racing: {
      horse(horseId: number, options?: PlatformRequestOptions): Promise<HorseRacingResponse>;
      races(params?: { season?: string; location?: string; weekId?: string; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<RacingRacesResponse>;
      race(raceId: string, options?: PlatformRequestOptions): Promise<RacingRaceDetailResponse>;
    };
    imports: {
      /** R114-03: bounded read-only preview — raw/normalized side by side. */
      adminBatchPreview(batchId: number, options?: PlatformRequestOptions): Promise<ImportBatchPreviewResponse>;
      /** R114-03: blob-free bounded review/result report. */
      adminReviewReport(batchId: number, options?: PlatformRequestOptions): Promise<ImportReviewReportResponse>;
      /** R114-03: versioned row-review command — skip / reclassify / typed-identifier-proven target override. */
      adminReviewRow(batchId: number, rowId: number, input: { decision: "skip" | "reclassify" | "target_override"; reason: string; operation_id: string; target_horse_id?: number }, options?: PlatformRequestOptions): Promise<ImportRowReviewResponse>;
    };
    market: {
      list(params?: { breed?: string; sex?: string; city?: string; q?: string; minPrice?: number; maxPrice?: number; sort?: "newest" | "price_asc" | "price_desc"; limit?: number; offset?: number; all?: boolean }, options?: PlatformRequestOptions): Promise<MarketListResponse>;
      detail(id: string, options?: PlatformRequestOptions & { count?: boolean }): Promise<MarketListingDetailResponse>;
      create(input: ListingCreateInput, options?: PlatformRequestOptions): Promise<{ listing: MarketListingRecord }>;
      /** R88 P03: status edits are optimistic-concurrency guarded — the row_version the client read must be sent; a stale write rejects with 409 listing_version_conflict (details.current_version). */
      setStatus(id: string, status: string, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<{ id: string; status: string; row_version: number }>;
      /** R88 P03: bounded expiry extension; an expired listing reactivates to active. */
      renew(id: string, input: { extend_days?: number }, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<{ id: string; status: string; expires_at: string; row_version: number }>;
      inquire(id: string, input: { buyer_name: string; buyer_contact: string; message?: string | null }, options?: PlatformRequestOptions): Promise<{ inquiry: { id: string; listing_id: string; status: string; row_version: number } }>;
      setInquiryStatus(id: string, status: "new" | "contacted" | "closed", options?: PlatformRequestOptions & { expectedVersion: number }): Promise<{ inquiry: { id: string; status: string; row_version: number } }>;
      mine(options?: PlatformRequestOptions): Promise<{ listings: MarketListingRecord[]; inquiries: Array<Record<string, unknown>> }>;
      /** R117-15: the buyer-owned sent-inquiry inbox — a bounded paginated query separate from the seller's mine(). */
      sentInquiries(options?: PlatformRequestOptions): Promise<MarketSentInquiriesResponse>;
      /** R98-N12: the private conversation — participants only; staff only while triaging a dispute. */
      conversation(inquiryId: string, options?: PlatformRequestOptions): Promise<MarketConversationResponse>;
      /** R98-N12: append one reply to an open conversation (participants only). */
      reply(inquiryId: string, input: { body: string }, options?: PlatformRequestOptions): Promise<{ reply: { id: string; inquiry_id: string; author_side: string; created_at: string } }>;
      /** R98-N12: the buyer of record closes their own inquiry. */
      closeOwnInquiry(inquiryId: string, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<{ inquiry: { id: string; status: string; row_version: number } }>;
      /** R98-N12: the buyer's saved-listings research list. */
      watchlist(options?: PlatformRequestOptions): Promise<MarketWatchlistResponse>;
      watch(listingId: string, options?: PlatformRequestOptions): Promise<{ added: boolean; bounded: boolean }>;
      unwatch(listingId: string, options?: PlatformRequestOptions): Promise<{ removed: boolean }>;
      /** R98-N12: participant blocks — the blocker's own management only; the other side is never told. */
      blocks(options?: PlatformRequestOptions): Promise<{ rows: Array<{ blocked_user_id: string; reason_private: string | null; created_at: string }>; note: string }>;
      block(input: { blocked_user_id: string; reason_private?: string | null }, options?: PlatformRequestOptions): Promise<{ blocked: boolean; note: string }>;
      unblock(userId: string, options?: PlatformRequestOptions): Promise<{ removed: boolean }>;
      /** R98-N12: attach or detach the optional immutable dossier link to one of the seller's own listings — a null dossier_id detaches. */
      attachDossier(id: string, input: { dossier_id: number | null; expected_version: number }, options?: PlatformRequestOptions): Promise<{ id: string; dossier_id: number | null; row_version: number; note: string }>;
    };
    genetics: {
      capabilities(horseId: number, options?: PlatformRequestOptions): Promise<GeneticAccessResponse>;
      addTest(horseId: number, input: GeneticIntakeInput, options?: PlatformRequestOptions): Promise<GeneticIntakeResponse>;
      interpret(testId: number, input: GeneticInterpretationInput, options?: PlatformRequestOptions): Promise<GeneticInterpretationResponse>;
      reviewHistory(testId: number, options?: PlatformRequestOptions): Promise<GeneticReviewHistoryResponse>;
      horse(horseId: number, options?: PlatformRequestOptions): Promise<HorseGeneticsResponse>;
      reviewPairing(testId: number, input: PairingReviewInput, options?: PlatformRequestOptions): Promise<{ review: PairingReviewRecord }>;
      /** R140-A: the health-result publication switch (privileged staff only). */
      setDisclosure(testId: number, input: GeneticDisclosureInput, options?: PlatformRequestOptions): Promise<GeneticDisclosureResponse>;
      /** R144-D02: the explainable publication-decision history for one health result. */
      disclosureHistory(testId: number, options?: PlatformRequestOptions): Promise<GeneticDisclosureHistoryResponse>;
    };
    professionalGrants: {
      /** R144-D01: horse/data/purpose-scoped professional grants — staff managed. */
      create(input: ProfessionalGrantCreateInput, options?: PlatformRequestOptions): Promise<ProfessionalGrantCreateResponse>;
      list(options?: { horse_id?: number } & PlatformRequestOptions): Promise<ProfessionalGrantListResponse>;
      revoke(grantId: string, input: ProfessionalGrantRevokeInput, options?: PlatformRequestOptions): Promise<ProfessionalGrantRevokeResponse>;
    };
    breedings: {
      horse(horseId: number, options?: PlatformRequestOptions): Promise<HorseBreedingsResponse>;
      correct(recordId: number, input: BreedingCorrectionInput, options?: PlatformRequestOptions): Promise<BreedingCorrectionResponse>;
    };
    media: {
      list(horseId: number, options?: PlatformRequestOptions): Promise<HorseMediaListResponse>;
      upload(horseId: number, input: MediaUploadInput, options?: PlatformRequestOptions): Promise<{ media: HorseMediaRecord }>;
      /** R88 P09: mint a short-lived signed URL for a private document (15-minute TTL). */
      access(mediaId: string, options?: PlatformRequestOptions): Promise<MediaAccessTokenResponse>;
      revokeAccess(mediaId: string, grantId: string, options?: PlatformRequestOptions): Promise<{ media_id: string; grant_id: string; revoked: true }>;
      setPublication(mediaId: string, consent: "private" | "shared_public", options: PlatformRequestOptions & { expectedVersion: number }): Promise<MediaPublicationResponse>;
      remove(id: string, options?: PlatformRequestOptions): Promise<{ deleted: string }>;
      verify(id: string, decision: "platform_reviewed" | "federation_verified" | "rejected", note?: string | null, options?: PlatformRequestOptions & { expectedVersion?: number }): Promise<{ id: string; verification: string; verification_level: string; note: string }>;
      fileUrl(id: string): string;
    };
    authExt: {
      register(input: RegisterInput, options?: PlatformRequestOptions): Promise<PlatformAuthState & { emailVerification?: EmailVerificationInfo }>;
      otpRequest(phone: string, options?: PlatformRequestOptions): Promise<OtpRequestResponse>;
      otpVerify(input: OtpVerifyInput, options?: PlatformRequestOptions): Promise<PlatformAuthState & { method?: string }>;
    };
    registryExtras: {
      duplicateCheck(params: { name?: string; registerNo?: string; microchip?: string; birthYear?: number; fatherId?: number; motherId?: number }, options?: PlatformRequestOptions): Promise<DuplicateCheckResponse>;
      certificateUrl(horseId: number, lang?: "fa" | "en"): string;
      issueCertificate(horseId: number, lang?: "fa" | "en", options?: PlatformRequestOptions): Promise<{ certificate: { id: string; horse_id: number; language: string; verification_code: string; svg_url: string } }>;
      /** Master-Ai T06: issue a versioned registry extract (immutable snapshot + secure random code). */
      issueExtract(horseId: number, lang?: "fa" | "en", options?: PlatformRequestOptions): Promise<{ extract: { id: string; horse_id: number; extract_code: string; language: string; issued_at: string; payload_digest: string; verify_url: string } }>;
      verifyExtract(code: string, options?: PlatformRequestOptions): Promise<{ valid: boolean; reason?: string; extract?: Record<string, unknown> }>;
    };
    attestations: {
      listIssuers(options?: PlatformRequestOptions): Promise<{ issuers: IssuerDirectoryRow[] }>;
      listHorseAttestations(horseId: number, options?: PlatformRequestOptions): Promise<HorseCredentialStoriesResponse>;
      /** R117-16: public verification — digest + markers only, never the snapshot bytes. */
      verify(attestationId: string, options?: PlatformRequestOptions): Promise<CredentialVerificationResponse>;
      /** Issue under an issuer that granted the caller an active membership — the server enforces the narrow scope. */
      issue(issuerId: string, input: CredentialIssueInput, options?: PlatformRequestOptions): Promise<{ attestation: IssuedCredentialStory }>;
      /** Issuer owner / platform content managers only; requires a reason. */
      revoke(attestationId: string, input: CredentialRevokeInput, options?: PlatformRequestOptions): Promise<{ revoked: string; reason: string }>;
      /** Issuer owner / platform content managers only; the replacement must concern the exact same record. */
      supersede(attestationId: string, input: CredentialSupersedeInput, options?: PlatformRequestOptions): Promise<{ superseded: string; reason: string; replacement: IssuedCredentialStory }>;
      /** Private full-snapshot review — platform content managers and the issuer's active owner only. */
      reviewSnapshot(attestationId: string, options?: PlatformRequestOptions): Promise<CredentialSnapshotReviewResponse>;
    };
    /** Master-Ai T10: horse-scoped access grants — backend-computed per-horse actions. */
    access: {
      horseActions(horseId: number, options?: PlatformRequestOptions): Promise<HorseAccessActionsResponse>;
      myGrants(options?: PlatformRequestOptions): Promise<{ grants: Array<HorseAccessGrantRecord> }>;
    };
    /** R88 P20: professional directory (P11 surface) — consent-gated public reads + claims. */
    directory: {
      persons(params?: DirectoryPersonsParams, options?: PlatformRequestOptions): Promise<DirectoryPersonsResponse>;
      person(personId: number, options?: PlatformRequestOptions): Promise<DirectoryPersonDetailResponse>;
      organizations(params?: DirectoryOrganizationsParams, options?: PlatformRequestOptions): Promise<DirectoryOrganizationsResponse>;
      /** Submit a claim/appeal with evidence. Moderated; never auto-publishes. */
      submitClaim(input: DirectoryClaimInput, options?: PlatformRequestOptions): Promise<DirectoryClaimResponse>;
      myClaims(options?: PlatformRequestOptions): Promise<DirectoryMyClaimsResponse>;
      /** Private, uncached editable snapshot. Includes version and field-level permissions. */
      managedProfile(personId: number, options?: PlatformRequestOptions): Promise<DirectoryManagedProfileResponse>;
      /** Upsert the caller's manageable profile. Unrelated accounts receive 403. */
      upsertProfile(personId: number, input: DirectoryProfileInput, options?: PlatformRequestOptions): Promise<DirectoryProfileResponse>;
      /** Self-declared credential; lands as 'unverified' — never becomes verification by itself. */
      addCredential(personId: number, input: DirectoryCredentialInput, options?: PlatformRequestOptions): Promise<DirectoryCredentialResponse>;
    };
    /** R98-N07: organization onboarding — managed profile with the same
     * version/428 semantics as person profiles, staff lifecycle, per-org inbox. */
    organizations: {
      /** Public consent-gated card; honest location + credential states. */
      publicCard(organizationId: number, options?: PlatformRequestOptions): Promise<OrganizationPublicCardResponse>;
      /** The private manageable organization view: current staff or editorial. */
      managed(organizationId: number, options?: PlatformRequestOptions): Promise<OrganizationManagedResponse>;
      upsertProfile(organizationId: number, input: OrganizationProfileInput, options?: PlatformRequestOptions): Promise<OrganizationProfileResponse>;
      staff(organizationId: number, options?: PlatformRequestOptions): Promise<OrganizationStaffResponse>;
      inbox(organizationId: number, options?: PlatformRequestOptions): Promise<OrganizationInboxResponse>;
      invite(organizationId: number, input: OrganizationStaffInviteInput, options?: PlatformRequestOptions): Promise<OrganizationStaffInviteResponse>;
      myInvites(options?: PlatformRequestOptions): Promise<{ invites: Array<Record<string, unknown>> }>;
      respondInvite(inviteId: number, accept: boolean, options?: PlatformRequestOptions): Promise<{ outcome: { status: string; membershipId: number | null } }>;
      setStaffRole(organizationId: number, targetUserId: string, newRole: "owner" | "manager" | "member", options?: PlatformRequestOptions): Promise<{ target_user_id: string; new_role: string }>;
      revokeStaff(organizationId: number, targetUserId: string, reason: string, options?: PlatformRequestOptions): Promise<{ target_user_id: string; status: string; note: string }>;
      appointOfficial(organizationId: number, input: OrganizationOfficialInput, options?: PlatformRequestOptions): Promise<{ appointment: Record<string, unknown>; note: string }>;
      addCredential(organizationId: number, input: DirectoryCredentialInput, options?: PlatformRequestOptions): Promise<DirectoryCredentialResponse>;
    };
    /** R88 P20: consented service request inbox (P12 surface) — leads, never appointments. */
    serviceRequests: {
      create(input: ServiceRequestCreateInput, options?: PlatformRequestOptions & { idempotencyKey: string }): Promise<ServiceRequestCreateResponse>;
      mine(options?: PlatformRequestOptions): Promise<ServiceRequestListResponse>;
      inbox(options?: PlatformRequestOptions): Promise<ServiceRequestInboxResponse>;
      detail(id: number, options?: PlatformRequestOptions): Promise<ServiceRequestDetailResponse>;
      /** CAS transition through the explicit table; stale row_version = 409. */
      setStatus(id: number, status: ServiceRequestStatus, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<ServiceRequestStatusResponse>;
      block(id: number, options?: PlatformRequestOptions): Promise<{ blocked: true; provider_person_id: number; note: string }>;
      report(id: number, input: { reason: string }, options?: PlatformRequestOptions): Promise<{ reported: true; report_id: number }>;
      /** R95-N12: withdraw contact consent (one-way; suppresses pending optional notices). */
      withdrawConsent(id: number, options?: PlatformRequestOptions): Promise<ServiceRequestConsentWithdrawResponse>;
      /** R95-N12: provider-side block — neutral refusal for new leads, private reason. */
      providerBlock(id: number, input?: { reason?: string | null }, options?: PlatformRequestOptions): Promise<ServiceRequestProviderBlockResponse>;
      /** R95-N12: replace the note body with a marker; SHA-256 evidence preserved. */
      redactNote(id: number, options?: PlatformRequestOptions): Promise<ServiceRequestRedactResponse>;
      /** R95-N12: the requester's own data export (leads, blocks, reports, standing). */
      export(options?: PlatformRequestOptions): Promise<ServiceRequestExportResponse>;
      /** R95-N12: the public privacy decision table (no personal data). */
      privacyPolicy(options?: PlatformRequestOptions): Promise<ServicePrivacyPolicyResponse>;
      /** R108-05: reconcile a durable intent key after a timeout/reload —
       * confirmed/unresolved/unknown, never a fabricated success. */
      reconcileIntent(key: string, options?: PlatformRequestOptions): Promise<ServiceIntentReconciliationResponse>;
    };
    /** R88 P20: farm workspaces (P14 surface) — working sets, never ownership. */
    workspaces: {
      create(input: WorkspaceCreateInput, options?: PlatformRequestOptions): Promise<WorkspaceCreateResponse>;
      mine(options?: PlatformRequestOptions): Promise<WorkspacesMineResponse>;
      dashboard(id: number, options?: PlatformRequestOptions): Promise<WorkspaceDashboardResponse>;
      remove(id: number, options?: PlatformRequestOptions): Promise<{ deleted: true; note: string }>;
      addHorse(id: number, horseId: number, options?: PlatformRequestOptions): Promise<WorkspaceHorseMutationResponse>;
      bulkHorses(id: number, input: { add?: number[]; remove?: number[] }, options?: PlatformRequestOptions): Promise<WorkspaceBulkResponse>;
      removeHorse(id: number, horseId: number, options?: PlatformRequestOptions): Promise<WorkspaceHorseMutationResponse>;
      /** Action-scoped staff grant (allowlist: view/tasks_manage/export); re-grant reactivates. */
      assignStaff(id: number, input: WorkspaceStaffInput, options?: PlatformRequestOptions): Promise<WorkspaceStaffResponse>;
      revokeStaff(id: number, userId: string, options?: PlatformRequestOptions): Promise<{ revoked: true; user_id: string; note: string }>;
      addTask(id: number, input: WorkspaceTaskInput, options?: PlatformRequestOptions): Promise<WorkspaceTaskResponse>;
      tasks(id: number, params?: { status?: "open" | "done" | "all"; cursor?: string; limit?: number }, options?: PlatformRequestOptions): Promise<WorkspaceTasksResponse>;
      /** CAS completion; a stale row_version = 409 with the current version in details. */
      completeTask(id: number, taskId: number, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<WorkspaceTaskCompleteResponse>;
      /** R117-14: CAS reopen of a completed ONE-SHOT reminder. A closed
       * recurring occurrence refuses with 409 recurring_occurrence_completed
       * (its next occurrence already exists); a stale version is 409
       * stale_version with the current version in details. */
      reopenTask(id: number, taskId: number, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<WorkspaceTaskReopenResponse>;
      /** Existing collaboration routes, now available to every independent renderer. */
      inviteStaff(id: number, input: WorkspaceInviteInput, options?: PlatformRequestOptions): Promise<WorkspaceInviteResponse>;
      myInvites(options?: PlatformRequestOptions): Promise<WorkspaceInvitesResponse>;
      respondInvite(id: number, action: "accept" | "decline", options?: PlatformRequestOptions): Promise<WorkspaceInviteRespondResponse>;
      revokeInvite(id: number, userId: string, options?: PlatformRequestOptions): Promise<{ revoked: true; note: string }>;
      documents(id: number, params?: { includeArchived?: boolean }, options?: PlatformRequestOptions): Promise<WorkspaceDocumentsResponse>;
      createDocument(id: number, input: WorkspaceDocumentInput, options?: PlatformRequestOptions): Promise<{ created: true; note: string }>;
      updateDocument(id: number, documentId: number, input: WorkspaceDocumentUpdateInput, options: PlatformRequestOptions & { expectedVersion: number }): Promise<{ updated: true }>;
      archiveDocument(id: number, documentId: number, options?: PlatformRequestOptions): Promise<{ archived: true; note: string }>;
      reassignTask(id: number, taskId: number, userId: string | null, options: PlatformRequestOptions & { expectedVersion: number }): Promise<WorkspaceTaskReassignResponse>;
      importTasks(id: number, tasks: WorkspaceTaskImportRow[], options?: PlatformRequestOptions & { intentKey?: string }): Promise<WorkspaceTaskImportResponse>;
      /** CSV download URL (registry-safe fields, formula-injection protected, no-store). */
      exportUrl(id: number): string;
    };
    /** R88 P20: billing (P17-P19 surface). Money is integer minor IRR; toman is display-only. */
    billing: {
      catalog(options?: PlatformRequestOptions): Promise<BillingCatalogResponse>;
      offers(options?: PlatformRequestOptions): Promise<BillingOffersResponse>;
      createOrder(input: BillingOrderInput, options?: PlatformRequestOptions & { idempotencyKey: string }): Promise<BillingOrderResponse>;
      myOrders(options?: PlatformRequestOptions): Promise<BillingMyOrdersResponse>;
      order(id: number, options?: PlatformRequestOptions): Promise<BillingOrderDetailResponse>;
      /** Cancel a not-yet-paid order — a state change, never a deletion. */
      cancelOrder(id: number, options?: PlatformRequestOptions): Promise<{ cancelled: true; note: string }>;
      /** Start a payment. FAIL-CLOSED (503) while the owner has not configured a provider; never a fabricated gateway. */
      pay(id: number, options?: PlatformRequestOptions): Promise<BillingPayResponse>;
      entitlements(options?: PlatformRequestOptions): Promise<BillingEntitlementsResponse>;
    };
  };
}

export function buildPlatformFeatureCatalog(capabilities: PlatformCapabilities): PlatformFeatureCatalog {
  return Object.fromEntries(
    (Object.keys(PLATFORM_FEATURE_SPECS) as PlatformFeatureKey[]).map((feature) => [
      feature,
      { ...PLATFORM_FEATURE_SPECS[feature], available: capabilities[feature] },
    ]),
  ) as PlatformFeatureCatalog;
}

// ---------------------------------------------------------------------------
// R47b federation feature modules (competitions / marketplace / genetics /
// media / public auth / registry extras). Every demo-seeded row is
// distinguishable through its provenance field and UIs must surface it.

export type ModuleProvenance = "demo" | "federation" | "user" | "derived";

export const COMPETITION_DISCIPLINES = ["show_jumping", "dressage", "endurance", "racing", "eventing", "halter", "freestyle"] as const;
export type CompetitionDiscipline = typeof COMPETITION_DISCIPLINES[number];

export interface CompetitionRecord {
  id: number;
  name_native: string;
  name_latin: string | null;
  discipline: string;
  event_date: string;
  end_date: string | null;
  venue: string;
  city: string | null;
  organizer: string | null;
  tier: string;
  season: number;
  provenance: string;
  result_count?: number;
  /** R114-02: monotonic row version for versioned event editing. */
  row_version?: number;
  /** Turn 32: illustrative event photo (competitions page). */
  image_url?: string | null;
  image_credit?: string | null;
}

export interface CompetitionResultRecord {
  id: number;
  competition_id: number;
  horse_id: number;
  rider_name: string | null;
  rider_club: string | null;
  class_name: string | null;
  placement: number | null;
  placement_text: string | null;
  score: string | null;
  is_eliminated: number;
  is_withdrawn: number;
  provenance: string;
  /** R114-02: version + last mutation time for versioned result editing. */
  row_version?: number;
  updated_at?: string | null;
  name_latin?: string | null;
  name_native?: string | null;
  breed_desc?: string | null;
  sex_desc?: string | null;
  birth_year?: number | null;
  color_desc?: string | null;
  competition_name?: string | null;
  discipline?: string | null;
  event_date?: string | null;
  venue?: string | null;
  city?: string | null;
  tier?: string | null;
  season?: number | null;
}

export interface CompetitionsListResponse {
  rows: CompetitionRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface CompetitionDetailResponse {
  competition: CompetitionRecord;
  results: CompetitionResultRecord[];
  /** R114-02: the bounded result window is explicit — never present the
   * subset as the complete event. */
  results_window?: { limit: number; total: number; has_more: boolean };
  /** R124 (R122-T05): the window is WALKABLE — keyset page metadata. Feed
   * next_cursor back as ?results_cursor to fetch the page strictly after the
   * last returned row; has_more is null-cursor exactly at exhaustion. */
  results_page?: { limit: number; returned: number; next_cursor: string | null; has_more: boolean; total: number };
}

// R114-03 (Master AI handoff D31-A): staged-import operator surface —
// bounded preview (raw/normalized side by side), the blob-free review
// report, and the versioned row-review command. A review decision never
// writes canonical data; one immutable receipt per caller operation key
// (exact retry replays, reuse with different content = 409).

export interface ImportBatchPreviewRow {
  id: number;
  external_id: string;
  raw: unknown;
  normalized: unknown;
  row_action: "create" | "update" | "conflict" | "skip";
  outcome: string;
  outcome_detail: unknown;
  horse_id: number | null;
  target: { name_latin: string | null; register_no: string | null } | null;
  last_review_operation_id: string | null;
  processed_at: string | null;
  reviews: Array<Record<string, unknown>>;
}

export interface ImportBatchPreviewResponse {
  batch: {
    id: number; source_id: number; source_name: string; issuer_namespace: string;
    scope_note: string; redistribution_allowed: boolean; retention_note: string | null;
    update_cadence: string | null; license_note: string | null; is_synthetic: boolean;
    file_name: string; mapping_version: string; status: string;
    rows_total: number; rows_created: number; rows_updated: number;
    rows_conflict: number; rows_skipped: number;
  };
  rows: ImportBatchPreviewRow[];
  rows_window: { limit: number; total: number; has_more: boolean };
  note: string;
}

export interface ImportReviewReportResponse {
  batch: Record<string, unknown>;
  outcome_counts: { pending: number; applied_create: number; applied_update: number; conflict: number; skipped: number; failed: number };
  rows: Array<{ id: number; external_id: string; row_action: string; outcome: string; outcome_detail: unknown; horse_id: number | null; processed_at: string | null }>;
  reviews: Array<Record<string, unknown>>;
  window: { limit: number; total: number };
  note: string;
}

export interface ImportRowReviewResponse {
  reviewed: boolean;
  replayed: boolean;
  row: { id: number; batch_id: number; external_id: string; row_action: string; outcome: string; horse_id: number | null };
  receipt: { operation_id: string; decision: "skip" | "reclassify" | "target_override"; prior: Record<string, unknown>; new: Record<string, unknown> };
  reclassified?: { action: string; detail: string };
  target_evidence?: { via: string; target_horse_id: number; target_name_latin: string };
  note: string;
}

export interface HorseCompetitionsResponse {
  horse: { id: number; name_latin: string; name_native: string | null };
  summary: { entries?:number;withdrawals?:number;starts: number; wins: number; podium: number; eliminations: number };
  results: CompetitionResultRecord[];
  /** R114-02: lifetime aggregate + explicit window — the summary covers the
   * full history while `results` is the bounded recent window. */
  history_window?: { limit: number; total: number; has_more: boolean };
  /** R124 (R122-T05): the window is WALKABLE — keyset page metadata on
   * (event_date, id) DESC. Feed next_cursor back as ?history_cursor. */
  history_page?: { limit: number; returned: number; next_cursor: string | null; has_more: boolean; total: number };
}

// R140-G: the racing surfaces — the federation racing system (asbdavani)
// dataset (12,924 races / 122,063 results) served read-only with explicit
// provenance. Identity crosswalk only: results attach to registry horses by
// registry_horse_id, never by name.

/** Provenance block on every racing response. */
export interface RacingProvenance {
  source: "asbdavani";
  /** The 4-level ladder level these rows carry until an issuer attests them. */
  trust_level: "imported_unverified";
  identity_crosswalk: string;
}

export interface RacingRaceRecord {
  race_id: string;
  week_id: string | null;
  week_name: string | null;
  /** ISO timestamp of the race week. */
  week_date: string | null;
  week_number: number | null;
  league_id: string | null;
  season: string | null;
  location: string | null;
  round_no: number | null;
  race_name: string | null;
  status: string | null;
  plan_id: string | null;
  plan_name: string | null;
  distance_m: number | null;
  age_class: string | null;
  blood: string | null;
  breed: string | null;
  condition_name: string | null;
  condition_type: string | null;
  prize_name: string | null;
  prizes: string | null;
  data_origin: string | null;
  starters_count?: number;
  decided_count?: number;
}

export interface RacingResultRecord {
  racehorse_id: string;
  race_id: string;
  week_id: string | null;
  week_date: string | null;
  season: string | null;
  location: string | null;
  round_no: number | null;
  plan_name: string | null;
  distance_m: number | null;
  number: number | null;
  rank: number | null;
  is_run: number | null;
  time_s: number | null;
  weight: number | null;
  carried_weight: number | null;
  tools_weight: number | null;
  entrance_rating: number | null;
  dl: number | null;
  registration_cost: number | null;
  owner_text: string | null;
  horse_id: string | null;
  horse_name: string | null;
  horse_sex: string | null;
  horse_birthdate: string | null;
  horse_starts: number | null;
  horse_p1: number | null;
  horse_p2: number | null;
  horse_p3: number | null;
  sire_id: string | null;
  sire_name: string | null;
  dam_id: string | null;
  dam_name: string | null;
  rider_id: string | null;
  rider_name: string | null;
  coach_id: string | null;
  coach_name: string | null;
  data_origin: string | null;
  registry_horse_id: string | null;
}

export interface HorseRacingResponse {
  horse: { id: number; name_latin: string; name_native: string | null };
  summary: {
    starts: number; wins: number; second_places: number; third_places: number;
    first_race_date: string | null; last_race_date: string | null; seasons_count: number;
  };
  results: RacingResultRecord[];
  provenance: RacingProvenance;
}

export interface RacingRacesResponse {
  total: number;
  limit: number;
  offset: number;
  races: RacingRaceRecord[];
  provenance: RacingProvenance;
}

export interface RacingRaceDetailResponse {
  race: RacingRaceRecord;
  results: RacingResultRecord[];
  provenance: RacingProvenance;
}

// R114-02 (Master AI R113 handoff D18): versioned competition editing —
// additive DTOs for the create-only legacy batch and the three versioned
// commands. Every command carries a caller operation key; an exact retry
// replays the stored receipt response, a reused key with different content
// is a 409 idempotency_conflict, and a stale expected_version is a 409
// version_conflict that returns the CURRENT row for comparison (no rebase).

export interface CompetitionResultInput {
  horse_id: number;
  rider_name?: string | null;
  rider_club?: string | null;
  class_name?: string | null;
  placement?: number | null;
  placement_text?: string | null;
  score?: string | null;
  is_eliminated?: boolean;
  is_withdrawn?: boolean;
  notes?: string | null;
}

export type CompetitionResultChange = Omit<CompetitionResultInput, "horse_id">;

export interface CompetitionEventChange {
  name_native?: string;
  name_latin?: string | null;
  discipline?: CompetitionDiscipline;
  event_date?: string;
  end_date?: string | null;
  venue?: string;
  city?: string | null;
  organizer?: string | null;
  tier?: "local" | "regional" | "national" | "international";
  season?: number;
  notes?: string | null;
}

export interface CompetitionCommandReceipt {
  operation_id: string;
  command: "result.create" | "result.update" | "event.update";
  competition_id: number;
  result_id: number | null;
  status_code: 200 | 201;
  created_at: string;
}

export interface CompetitionResultCommandResponse {
  created?: boolean;
  updated?: boolean;
  replayed: boolean;
  result: CompetitionResultRecord;
  row_version: number;
  receipt: CompetitionCommandReceipt;
  note: string;
}

export interface CompetitionEventCommandResponse {
  updated: boolean;
  replayed: boolean;
  competition: CompetitionRecord;
  row_version: number;
  receipt: CompetitionCommandReceipt;
  note: string;
}

export interface MarketListingRecord {
  id: string;
  horse_id: number;
  seller_contact_name: string;
  seller_contact_phone?: string | null;
  seller_contact_email?: string | null;
  seller_city: string | null;
  asking_price_toman: number | null;
  price_visible: number;
  negotiable: number;
  status: string;
  title: string | null;
  description: string | null;
  view_count: number;
  listed_at: string;
  updated_at: string;
  expires_at: string | null;
  provenance: string;
  /** R88 P03: optimistic-concurrency version; send it back as expected_version on edits. */
  row_version: number;
  name_latin: string | null;
  name_native: string | null;
  breed_desc: string | null;
  sex_desc: string | null;
  birth_year: number | null;
  color_desc: string | null;
  main_strain_desc: string | null;
  is_stallion: number | null;
  register_no: string | null;
  competition_starts: number | null;
  verified_media_count: number | null;
}

export interface MarketListResponse {
  rows: MarketListingRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface MarketListingDetailResponse {
  listing: MarketListingRecord & {
    /** R98-N12: live-computed at read time — never a stored flag. An expired mandate is reported as false, never as verified ownership. */
    seller_mandate_current?: boolean | null;
    seller_mandate_note?: string;
    /** R98-N12: optional immutable dossier link summary (content stays behind the access-controlled dossier view). */
    dossier?: { id: number; status: string; version: number } | null;
    /** R98-N12: the signed-in viewer's own watch state. */
    watched?: boolean;
    suspended?: boolean;
    suspension?: { reason_scope: string; note: string } | null;
    availability_note?: string;
  };
  pedigree: { sire: { id: number; name_latin: string; name_native: string | null; breed_desc: string | null } | null; dam: { id: number; name_latin: string; name_native: string | null; breed_desc: string | null } | null };
  competitions: Array<Record<string, unknown>>;
  media: Array<Record<string, unknown>>;
  genetics: Array<Record<string, unknown>>;
  /** R98-N12: the platform's honest role — introduction only, never escrow/inspection/guarantee. */
  disclosure?: { role: "introduction_only"; en: string; fa: string };
}

/** R98-N12: the private inquiry conversation (participant-only reads for the conversation's whole life). */
export interface MarketConversationResponse {
  inquiry: {
    id: string;
    listing_id: string;
    status: string;
    row_version: number;
    created_at: string;
    message: string | null;
    buyer_name: string;
    buyer_contact: string | null;
  };
  listing_status: string;
  listing_expires_at: string | null;
  listing_title: string | null;
  replies: Array<{ id: string; author_side: string; body: string; created_at: string }>;
  viewer_side: "buyer" | "seller" | "staff";
  staff_dispute_case: { id: number; status: string } | null;
  disclosure: { role: "introduction_only"; en: string; fa: string };
}

/** R98-N12: the buyer's saved-listings research list. */
export interface MarketWatchlistResponse {
  rows: Array<Record<string, unknown>>;
  note: string;
}

/** R117-15 (Master AI R117 handoff D19): one row of the buyer's own
 * sent-inquiry inbox. The row reports the listing's CURRENT status honestly
 * (sold/withdrawn/expired say so) while the conversation history stays
 * readable; the horse names are absent (not fabricated) when the horse record
 * is unreadable. No seller contact fields appear here — contact exchange
 * lives in the participant-only conversation. */
export interface MarketSentInquiryRow {
  id: string;
  listing_id: string;
  status: "new" | "contacted" | "closed";
  row_version: number;
  created_at: string;
  message: string | null;
  listing_status: string;
  listing_expires_at: string | null;
  listing_title: string | null;
  horse_id: number;
  name_latin: string | null;
  name_native: string | null;
  reply_count: number;
  last_reply_at: string | null;
}

export interface MarketSentInquiriesResponse {
  rows: MarketSentInquiryRow[];
  pagination: { limit: number; offset: number; total: number };
  note: string;
}

/* R117-16 (Master AI R117 handoff D24) — truthful credential demonstration
 * stories. The public projections below are exactly what the server emits:
 * statement and field_scope are NEVER part of the public horse rows
 * (scope_redacted), and the public verification exposes the digest and
 * markers, never the snapshot bytes. */
export interface IssuerDirectoryRow {
  id: string;
  slug: string;
  name: string;
  name_native: string | null;
  kind: "organization" | "laboratory" | "federation" | "clinic" | "government";
  status: string;
  created_at: string;
}

export interface CredentialStoryIssuer {
  slug: string;
  name: string;
  name_native: string | null;
  kind: string;
  status: string;
}

/** Public per-horse credential row (GET /api/horses/:id/attestations). */
export interface CredentialStoryRow {
  id: string;
  issuer: CredentialStoryIssuer;
  record_kind: "genetic_test" | "media" | "competition_result" | "horse_identity";
  record_id: string;
  horse_id: number;
  issued_at: string;
  expires_at: string | null;
  status: string;
  effective_status: string;
  statement: null;
  field_scope: null;
  scope_redacted: true;
  scope_note: string;
  limitations: { rank: number; isAuthorityClaim: boolean; en: string; fa: string };
}

export interface HorseCredentialStoriesResponse {
  horse_id: number;
  truncated: boolean;
  attestations: CredentialStoryRow[];
}

/** Public verification (GET /api/attestations/:id/verify) — honest states:
 * current / expired / revoked / superseded / source_changed /
 * snapshot_tampered / issuer_suspended / issuer_retired / issuer_inactive /
 * not_yet_valid / invalid_dates / unbound_legacy. */
export interface CredentialVerificationResponse {
  attestation_id: string;
  issuer: CredentialStoryIssuer;
  record_kind: CredentialStoryRow["record_kind"];
  record_id: string;
  horse_id: number | null;
  issued_at: string;
  expires_at: string | null;
  status: string;
  effective_status: string;
  verification_state: string;
  source_detail: { changed_tables?: string[]; removed_tables?: string[] } | null;
  snapshot: {
    schema_version: number;
    content_digest: string;
    source_row_versions: Record<string, unknown>;
    scope_authority: Record<string, unknown>;
    captured_at: string;
    is_private: true;
  } | null;
  server_derived_source_version: string | null;
  limitations: CredentialStoryRow["limitations"];
  note: string;
}

export type CredentialRecordKind = CredentialStoryRow["record_kind"];

/** Issue input — the server derives horse binding and source version; the
 * caller can never attach a made-up version to any record. */
export interface CredentialIssueInput {
  record_kind: CredentialRecordKind;
  record_id: string;
  field_scope?: string[] | null;
  statement?: string | null;
  evidence_media_id?: string | null;
  expires_at?: string | null;
}

export interface IssuedCredentialStory {
  id: string;
  issuer_id: string;
  horse_id: number | null;
  record_kind: CredentialRecordKind;
  record_id: string;
  field_scope: string[] | null;
  statement: string | null;
  evidence_media_id: string | null;
  source_version: string | null;
  issued_at: string;
  expires_at: string | null;
  status: "active";
}

export interface CredentialRevokeInput { reason: string }

export interface CredentialSupersedeInput {
  reason: string;
  replacement: CredentialIssueInput;
}

/** Private full-snapshot review (GET /api/admin/attestations/:id/snapshot) —
 * platform content managers and the issuer's active owner only. */
export interface CredentialSnapshotReviewResponse {
  attestation_id: string;
  snapshot: Record<string, unknown>;
}

export interface GeneticTestRecord {
  id: number;
  /** Private review metadata; absent from public projections. */
  row_version?: number;
  review_eligibility?: { own_submission: boolean; legacy_origin_unknown: boolean };
  pairing_review?: { row_version: number; assay_key: "SCID" | "CA" | "LFS" | "OAAM1"; review_state: "accepted" | "withdrawn"; expires_at: string | null } | null;
  test_type: string;
  test_category: string;
  result: string;
  /** Catalog-validated status (assay whitelist, exact allele tokens). `recorded_uninterpreted` keeps the lab text authoritative (T04/F02). */
  result_status?: "clear" | "carrier" | "affected" | "recorded_uninterpreted";
  /** Explicit interpretation scope: never a clinical diagnosis or whole-horse clearance. */
  interpretation_scope?: "recorded_genotype_only";
  clinical_diagnosis?: false;
  assay_catalog_version?: string;
  /** Incorrect legacy labels require reviewed mapping; legitimate champagne SLC36A1 does not. */
  locus_quarantine?: { status: "legacy_identifier_quarantined"; suggested: string; note: string };
  result_interpretation: string | null;
  lab_name: string | null;
  lab_accession: string | null;
  tested_at: string | null;
  verified: number;
  provenance: string;
  /** R140-A: disease/health rows are private-by-default; 1 = explicit publication decision exists. Non-health categories report 1 (published by the verified=>public rule). */
  public_disclosed: number;
  notes: string | null;
}

/** POST /api/admin/genetic-tests/:id/disclosure (R140-A) — the health-result publication switch. */
export interface GeneticDisclosureResponse {
  test: Pick<GeneticTestRecord, "id" | "test_type" | "test_category" | "verified"> & { horse_id: number; public_disclosed: number };
  changed: boolean;
  note?: string;
  /** R144-D02: the appended decision row (null when the state already held). */
  decision?: PublicationDecisionRecord | null;
  /** R144-D02: the current per-record decision version after the call. */
  decision_version?: number;
}
/** R144-D02: optimistic concurrency + explainable basis on every disclosure change. */
export interface GeneticDisclosureInput {
  public_disclosed: boolean;
  /** Caller's known decision version; a stale value is rejected 409 publication_decision_conflict. */
  expected_decision_version: number;
  basis: "owner_consent" | "staff_publication" | "official_basis";
  purpose?: string | null;
  evidence_ref?: string | null;
  reason: string;
}

/** R144-D02 (migration 0106) — one versioned publication/withdrawal decision. */
export interface PublicationDecisionRecord {
  id: string;
  subject_kind: "genetic_test";
  record_id: string;
  horse_id: number;
  decision: "publish" | "withdraw";
  decision_version: number;
  basis: "owner_consent" | "staff_publication" | "official_basis";
  purpose: string | null;
  evidence_ref: string | null;
  reason: string;
  actor_user_id: string;
  expected_version: number | null;
  created_at: string;
}

/** GET /api/admin/genetic-tests/:id/disclosure (R144-D02) — explainable history. */
export interface GeneticDisclosureHistoryResponse {
  test: Pick<GeneticTestRecord, "id" | "test_type" | "test_category" | "verified"> & { horse_id: number; public_disclosed: number };
  effective: { disclosed: boolean; source: "decision_log" | "legacy_boolean"; latest_version: number | null; materialized_matches: boolean };
  decisions: PublicationDecisionRecord[];
}

/** R144-D01 (migration 0105) — professional grant scoped to horse, data, purpose. */
export interface ProfessionalGrantRecord {
  id: string;
  horse_id: number;
  grantee_user_id: string | null;
  grantee_organization_id: number | null;
  professional_kind: "veterinarian" | "laboratory" | "farrier" | "physiotherapist" | "dentist" | "nutritionist" | "federation_official";
  permissions: string;
  /** Parsed convenience projection of `permissions` (vocabulary-filtered). */
  permission_list: ProfessionalGrantPermission[];
  authority_ref: string;
  assignment_ref: string;
  basis: "admin_grant" | "owner_consent" | "institution_assignment";
  basis_ref: string | null;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
  created_at: string;
  name_latin?: string | null;
  name_native?: string | null;
}

/** POST /api/admin/professional-grants (R144-D01, admin only). */
export interface ProfessionalGrantCreateInput {
  horse_id: number;
  grantee_user_id?: string | null;
  grantee_organization_id?: number | null;
  professional_kind: ProfessionalGrantRecord["professional_kind"];
  permissions: ProfessionalGrantRecord["permission_list"];
  authority_ref: string;
  assignment_ref: string;
  basis: ProfessionalGrantRecord["basis"];
  basis_ref?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
}
export interface ProfessionalGrantCreateResponse { grant: ProfessionalGrantRecord }
export interface ProfessionalGrantListResponse { grants: ProfessionalGrantRecord[] }
export interface ProfessionalGrantRevokeInput { reason: string }
export interface ProfessionalGrantRevokeResponse { id: string; revoked: boolean }

export interface HorseGeneticsResponse {
  horse: { id: number; name_latin: string; name_native: string | null; breed_desc: string | null };
  /** Record totals are tested/verified/unverified; outcome/conflict totals are distinct reviewed assays. */
  summary: { tested: number; verified: number; unverified: number; clear: number; carriers: number; affected: number; uninterpreted: number; conflicts: number; resolvedAssays: number; unresolvedAssays: number; unmappedRecords: number };
  tests: GeneticTestRecord[];
}

export interface BreedingRecordRow {
  id: number;
  row_version: number;
  /** Public projections mask unavailable linked subjects without changing stored parentage. */
  sire_id: number | null;
  dam_id: number | null;
  covering_date: string | null;
  season: number | null;
  method: string | null;
  outcome: string;
  foal_id: number | null;
  provenance: string;
  sire_name?: string | null;
  sire_name_native?: string | null;
  dam_name?: string | null;
  dam_name_native?: string | null;
  foal_name?: string | null;
}

export interface HorseBreedingsResponse {
  horse: { id: number; name_latin: string; name_native: string | null; sex_desc: string | null };
  as_sire: BreedingRecordRow[];
  as_dam: BreedingRecordRow[];
  birth_record: BreedingRecordRow | null;
}

export interface HorseMediaRecord {
  id: string;
  horse_id: number;
  media_type: string;
  role: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** Returned by uploads: digest of the exact bytes retained after sanitization. */
  sha256?: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  verification: string;
  row_version: number;
  consent_state: "private" | "shared_public";
  public_visible: boolean;
  can_publish: boolean;
  can_withdraw: boolean;
  /** Master-Ai T05: honest level — 'platform_reviewed' means editorial staff review, NOT an issuer attestation. */
  verification_level?: string;
  sort_order: number;
  created_at: string;
}

export interface MediaPublicationResponse {
  id: string;
  consent_state: "private" | "shared_public";
  row_version: number;
  public_visible: boolean;
  replayed?: boolean;
}

export interface HorseMediaListResponse {
  horse_id: number;
  counts: { photos: number | null; documents: number | null; verified: number | null } | null;
  media: HorseMediaRecord[];
}

/** Master-Ai T10: backend-computed per-horse actions for the signed-in viewer. */
export interface HorseAccessActionsResponse {
  horse_id: number;
  is_staff: boolean;
  relationships: string[];
  actions: string[];
  grants: Array<{ id: string; relationship: string; actions: string[]; via: "user" | "organization"; valid_until: string | null }>;
}

export interface HorseAccessGrantRecord {
  id: string;
  horse_id: number;
  relationship: string;
  actions: string;
  basis: string;
  basis_ref: string | null;
  valid_from: string;
  valid_until: string | null;
  name_latin?: string | null;
  name_native?: string | null;
}

export interface MediaUploadInput {
  media_type: "photo" | "document";
  role: "profile" | "gallery" | "passport" | "certificate" | "veterinary" | "competition" | "other";
  file_name: string;
  mime_type: string;
  data_base64: string;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
}

/** R88 P09: short-lived private document access token mint response. */
export interface MediaAccessTokenResponse {
  media_id: string;
  grant_id: string;
  token: string;
  url: string;
  expires_at: string;
  ttl_seconds: number;
  evidence_class: string;
  consent_state: string;
}

/** R88 P09: operator quarantine/retention queue item (metadata only — payloads are never included). */
export interface MediaQuarantineItem {
  id: string;
  horse_id: number;
  media_type: string;
  evidence_class: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  state: "pending_review" | "quarantined";
  quarantine_reason: string | null;
  quarantined_at: string | null;
  created_at: string;
  uploaded_by_user_id: string | null;
  age_days: number;
  abandoned: boolean;
}

export interface MediaQuarantineResponse {
  queue: MediaQuarantineItem[];
  counts: { pending_review: number; quarantined: number; abandoned_pending: number };
  retention: { abandoned_after_days: number; note: string };
}

export interface DuplicateCheckResponse {
  query: { name: string | null; registerNo: string | null; microchip: string | null; birthYear: number | null; fatherId: number | null; motherId: number | null };
  candidates: Array<{ horse: { id: number; name_latin: string | null; name_native: string | null; register_no: string | null; birth_year: number | null; breed_desc: string | null; sex_desc: string | null }; reasons: string[]; score: number }>;
  blocked: boolean;
}

/** R141 — duplicate-resolution workbench surfaces. */
export type DuplicateCandidateReason = "register_no_exact" | "microchip_exact" | "name_year_match" | "same_parents";

export interface DuplicateCandidateMember {
  id: number;
  name_latin: string | null;
  name_native: string | null;
  register_no: string | null;
  microchip_no: string | null;
  birth_year: number | null;
  sex_desc: string | null;
  breed_desc: string | null;
  created_at: string | null;
}

export interface DuplicateCandidateGroup {
  reason: DuplicateCandidateReason;
  key: string;
  members: DuplicateCandidateMember[];
}

export interface DuplicateCandidatesResponse {
  generated: string;
  reasons: DuplicateCandidateReason[];
  group_limit: number;
  groups: DuplicateCandidateGroup[];
  total_groups: number;
  truncated: boolean;
  note: string;
}

export interface MergePreviewPolicyRow {
  table: string;
  column: string;
  kind: string;
  disposition: string;
  references_on_merged_horse: number;
  manifest_row_ids?: number[];
  manifest_count?: number;
  over_bound?: boolean;
  note: string;
}

export interface MergePreviewResponse {
  dry_run: true;
  operator: { user_id: number; role: string; capability: string; authorized: boolean };
  command_permission: string;
  kept: { id: number; name_latin: string | null; register_no: string | null; microchip_no: string | null; deleted_at: string | null } | null;
  merged: { id: number; name_latin: string | null; register_no: string | null; microchip_no: string | null; deleted_at: string | null } | null;
  blockers: Array<{ code: string; message: string }>;
  inventory_version: string;
  policy: MergePreviewPolicyRow[];
  manifest_digest: string;
  manifest_summary: { moves: number; archives: number; per_pair: Array<{ table: string; column: string; count: number; over_bound: boolean }> };
  bounds: { max_per_pair: number; max_total: number; within_bounds: boolean };
  warnings: Array<{ code: string; message: string }>;
  note: string;
}

export interface MergeCommandResponse {
  merged: true;
  replayed: boolean;
  kept_horse_id: number;
  merged_horse_id: number;
  moved_references: number;
  manifest_digest: string;
  policy_version: string;
  operation_id: string;
  note: string;
}

export interface UnmergeCommandResponse {
  unmerged: true;
  replayed: boolean;
  merge_id: number;
  kept_horse_id: number;
  merged_horse_id: number;
  restored_references: number;
  operation_id: string;
  note: string;
}

export interface MergeHistoryRecord {
  id: number;
  kept_horse_id: number;
  merged_horse_id: number;
  kept_name_latin: string | null;
  kept_name_native: string | null;
  merged_name_latin: string | null;
  merged_name_native: string | null;
  reason: string;
  merged_at: string | null;
  unmerged_at: string | null;
  unmerge_operation_id: string | null;
  manifest_digest: string | null;
  policy_version: string | null;
  operation_id: string | null;
  merged_by: string | null;
}

export interface MergeHistoryResponse {
  merges: MergeHistoryRecord[];
  limit: number;
  include_resolved: boolean;
  note: string;
}

export interface OtpRequestResponse {
  sent: boolean;
  demoMode: boolean;
  demoCode?: string;
  demoNotice?: string;
  expiresInMinutes?: number;
}

/** Email delivery is separate from account creation; unavailable is not sent. */
export interface EmailVerificationInfo {
  required: boolean;
  expiresInHours: number;
  demoTokenUrl?: string;
  demoNotice: string;
  delivery?: "unavailable" | "sent";
}

export interface RegisterInput {
  email: string;
  password: string;
  display_name: string;
  role?: "user" | "owner";
}

export interface OtpVerifyInput {
  phone: string;
  code: string;
  display_name?: string;
}

export interface ListingCreateInput {
  horse_id: number;
  seller_contact_name: string;
  seller_contact_phone?: string | null;
  seller_contact_email?: string | null;
  seller_city?: string | null;
  asking_price_toman?: number | null;
  price_visible?: boolean;
  negotiable?: boolean;
  title?: string | null;
  description?: string | null;
}

// ---------------------------------------------------------------------------
// R88 agent plan P20: typed domain modules (directory / serviceRequests /
// workspaces / billing). Shapes mirror the API DTOs exactly — including the
// honest notes and the fields the API deliberately omits (contact_value is
// NEVER in a public DTO).

// --- P11 directory ---

export interface DirectoryPersonsParams {
  category?: string;
  province?: string;
  city?: string;
  name?: string;
  cursor?: number;
}

export interface DirectoryPersonPublic {
  person_id: number;
  name_latin: string | null;
  name_native: string | null;
  service_categories: string[];
  province_code: string | null;
  province_code_scheme?: string;
  province_code_raw?: string | null;
  province_needs_review?: boolean;
  city: string | null;
  contact_preference: "platform_message" | "phone" | "email";
  languages: string | null;
  availability_text: string | null;
  /** Honesty marker shipped by the API; contact_value is deliberately absent. */
  contact_note: string;
}

export interface DirectoryPersonsResponse {
  persons: DirectoryPersonPublic[];
  next_cursor: number | null;
  page_size: number;
  filters: { category: string | null; province: string | null; city: string | null; name: string | null };
}

export interface DirectoryCredentialPublic {
  id: number;
  role: string;
  issuer_name: string;
  identifier: string;
  issued_at: string | null;
  expires_at: string | null;
  /** Honesty: an expired credential loses its active state but STAYS as history. */
  /** Date-window convenience only, NOT proof of qualification. */
  is_active: boolean;
  recorded_period_status?: "dates_not_recorded" | "within_recorded_dates" | "not_yet_valid" | "expired" | "revoked" | "invalid_dates";
  authority_needs_review?: boolean;
  row_version?: number;
  verification_state: string;
  verification_level: string;
}

export interface DirectoryPersonDetailResponse {
  person: DirectoryPersonPublic;
  credentials: DirectoryCredentialPublic[];
  active_credentials: DirectoryCredentialPublic[];
  credentials_note: string;
}

export interface DirectoryOrganizationsParams {
  category?: string;
  province?: string;
  cursor?: number;
}

export interface DirectoryOrganizationPublic {
  organization_id: number;
  slug: string;
  name_latin: string | null;
  name_native: string | null;
  kind: string;
  description: string | null;
  service_categories: string[];
  province_code: string | null;
  province_code_scheme?: string;
  province_code_raw?: string | null;
  province_needs_review?: boolean;
  city: string | null;
  contact_preference: string;
  contact_note: string;
}

export interface DirectoryOrganizationsResponse {
  organizations: DirectoryOrganizationPublic[];
  next_cursor: number | null;
  page_size: number;
}

export interface DirectoryClaimInput {
  claim_type: "person" | "organization";
  person_id?: number | null;
  organization_id?: number | null;
  evidence_note: string;
  evidence_media_id?: string | null;
  appeal_for_claim_id?: number | null;
}

export interface DirectoryClaimResponse {
  claim: Record<string, unknown>;
  note: string;
}

export interface DirectoryMyClaimsResponse {
  claims: Array<Record<string, unknown>>;
}

export interface DirectoryManagedProfileResponse {
  profile: {
    person_id: number; name_latin: string | null; name_native: string | null; row_version: number;
    service_categories: string[]; province_code: string | null; province_code_raw: string | null;
    province_code_scheme: string; province_needs_review: boolean; city: string | null;
    contact_preference: "platform_message" | "phone" | "email"; contact_value: string | null;
    languages: string | null; availability_text: string | null; publication_consent: boolean; published_at: string | null;
  };
  permissions: { edit: boolean; initial_publication: boolean; private_contact: boolean };
  current_province_scheme: string;
}

export interface DirectoryProfileInput {
  /** Required for an existing profile (428 if absent). Use 0 for first creation. */
  expected_version?: number;
  /** Required when province_code is nonempty. */
  province_code_scheme?: string;
  service_categories: string[];
  province_code?: string | null;
  city?: string | null;
  contact_preference?: "platform_message" | "phone" | "email";
  contact_value?: string | null;
  languages?: string | null;
  availability_text?: string | null;
  publication_consent: boolean;
}

export interface DirectoryProfileResponse {
  profile: Record<string, unknown>;
  contact_value_stored: string | null;
  publication: string;
}

export interface DirectoryCredentialInput {
  role: string;
  issuer_name: string;
  identifier: string;
  issued_at?: string | null;
  expires_at?: string | null;
  evidence_media_id?: string | null;
}

export interface DirectoryCredentialResponse {
  credential: Record<string, unknown>;
  verification_level: string;
  note: string;
}

// --- R98-N07 organization onboarding ---

export interface OrganizationProfileRecord {
  id: number; slug: string; name_latin: string | null; name_native: string | null;
  kind: string; status: string; row_version: number;
  description: string | null; service_categories: string[]; specialties: string[];
  service_areas: string[]; accessibility_notes: string | null;
  opening_hours: Record<string, string> | null;
  province_code: string | null; province_code_raw: string | null;
  province_code_scheme: string; province_needs_review: boolean; city: string | null;
  contact_preference: "platform_message" | "phone" | "email"; contact_value: string | null;
  publication_consent: boolean; published_at: string | null;
}

export interface OrganizationManagedResponse {
  organization: OrganizationProfileRecord;
  permissions: { edit: boolean; initial_publication: boolean; private_contact: boolean };
  current_province_scheme: string;
}

export interface OrganizationProfileInput {
  /** Required for an existing profile (428 if absent). Use 0 for first creation. */
  expected_version?: number;
  /** Required when province_code is nonempty. */
  province_code_scheme?: string;
  description?: string | null;
  service_categories: string[];
  specialties?: string[];
  service_areas?: string[];
  accessibility_notes?: string | null;
  opening_hours?: string | null;
  province_code?: string | null;
  city?: string | null;
  contact_preference?: "platform_message" | "phone" | "email";
  contact_value?: string | null;
  publication_consent: boolean;
}

export interface OrganizationProfileResponse {
  organization: Record<string, unknown>;
  contact_value_stored: string | null;
  publication: string;
}

export interface OrganizationPublicCardResponse {
  organization: Record<string, unknown> & { id: number; published: boolean };
}

export interface OrganizationStaffResponse {
  staff: Array<Record<string, unknown>>;
  policy: string;
}

export interface OrganizationInboxResponse {
  leads: Array<Record<string, unknown>>;
  policy: string;
}

export interface OrganizationStaffInviteInput {
  invitee_user_id: string;
  proposed_role: "owner" | "manager" | "member";
  note?: string | null;
}

export interface OrganizationStaffInviteResponse {
  invite: Record<string, unknown>;
  policy: string;
}

export interface OrganizationOfficialInput {
  person_id: number;
  official_role: "judge" | "steward" | "ringmaster" | "dc";
  credential_id: number;
  valid_until?: string | null;
  scope_note?: string | null;
}

// --- P12 service requests ---

export type ServiceRequestStatus = "new" | "acknowledged" | "discussing" | "closed" | "withdrawn" | "spam";

export interface ServiceRequestCreateInput {
  province_code_scheme?: string;
  provider_person_id: number;
  provider_organization_id?: number | null;
  category: string;
  province_code?: string | null;
  city?: string | null;
  horse_id?: number | null;
  note: string;
  share_contact: boolean;
}

export interface ServiceRequestRecord {
  id: number;
  provider_person_id: number;
  category: string;
  province_code: string | null;
  city: string | null;
  horse_id: number | null;
  status: ServiceRequestStatus;
  row_version: number;
  created_at: string;
  updated_at: string;
  is_requester_view: boolean;
  /** Only present with consent + CURRENT manager authorization. */
  contact: { display_name: string; email: string; via: "consented" } | null;
  contact_note: string;
  note?: string;
  appointment_warning: string;
}

export interface ServiceRequestCreateResponse {
  created: true;
  idempotent_replay?: boolean;
  request: { id: number; provider_person_id: number; category: string; status: string; share_contact: boolean };
  request_digest: string;
  note: string;
}

export interface ServiceRequestListResponse {
  requests: ServiceRequestRecord[];
}

/** R108-05: the uncertain-write reconciliation answer for one intent key.
 * Actor-scoped: another account's key always reads as "unknown". */
export interface ServiceIntentReconciliationResponse {
  state: "confirmed" | "unresolved" | "unknown";
  /** Present when state=confirmed — the SAME receipt the original attempt produced. */
  request_id?: number;
  response?: ServiceRequestCreateResponse;
  created_at?: string;
  note: string;
}

export interface ServiceRequestInboxResponse {
  requests: ServiceRequestRecord[];
  inbox: "provider";
}

export interface ServiceRequestDetailResponse {
  request: ServiceRequestRecord;
}

export interface ServiceRequestStatusResponse {
  request: ServiceRequestRecord;
  /** P13 honesty: the notice is queued — queuing is not provider notification, and acceptance is not delivery. */
  notification: { recorded: true; outbox_status: string; note: string };
}

// --- R95-N12: consent withdrawal + anti-abuse lifecycle ---

export interface ServiceRequestConsentWithdrawResponse {
  withdrawn: true;
  request_id: number;
  share_contact: false;
  consent_updated_at: string | null;
  effects: {
    future_contact_disclosure: string;
    pending_optional_notices: string;
    dispute_record: string;
    reversibility: string;
  };
}

export interface ServiceRequestProviderBlockResponse {
  blocked: true;
  requester_account: "blocked";
  effects: { new_leads: string; pending_optional_notices: string; existing_lead: string };
}

export interface ServiceRequestRedactResponse {
  redacted: true;
  request_id: number;
  note_now: string;
  evidence: string;
}

export interface ServiceRequestExportedRecord {
  id: number;
  provider_person_id: number;
  category: string;
  province_code: string | null;
  city: string | null;
  horse_id: number | null;
  note: string;
  share_contact: number;
  status: ServiceRequestStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  consent_updated_at: string | null;
  note_redacted_at: string | null;
}

export interface ServiceRequestExportResponse {
  exported_for: string;
  generated_at: string;
  service_requests: ServiceRequestExportedRecord[];
  requester_blocks: { blocked_person_id: number; created_at: string }[];
  abuse_reports_filed: { service_request_id: number; reason: string; created_at: string }[];
  moderation_standing: { standing: string; reason: string | null; updated_at: string | null };
  retention: { note: string; policy: string };
}

export interface ServicePrivacyPolicyResponse {
  policy_version: string;
  decision_table: { field: string; stored: string; visible_to: string[]; condition: string; retention: string }[];
  ui_flow: { requester: string[]; provider: string[] };
}

// --- P14 workspaces ---

export interface WorkspaceCreateInput {
  name: string;
  description?: string | null;
  organization_id?: number | null;
}

export interface WorkspaceSummary {
  id: number;
  name: string;
  description: string | null;
  organization_id: number | null;
  role: "owner" | "staff" | "manager";
  row_version: number;
  created_at: string;
  granted_actions?: string[];
  writable?: boolean;
  protective_actions?: Array<"revoke_staff"|"archive">;
}

export interface WorkspaceCreateResponse {
  created: true;
  workspace: { id: number; name: string; organization_id: number | null };
  ownership_note: string;
}

export interface WorkspacesMineResponse {
  owned: WorkspaceSummary[];
  staff: WorkspaceSummary[];
  organization?: WorkspaceSummary[];
}

export interface WorkspaceTaskRecord {
  id: number;
  horse_id: number | null;
  title: string;
  category: string;
  due_date: string;
  due_timezone?: string;
  recurrence: string;
  status: string;
  assigned_to_user_id: string | null;
  occurrence_key: string;
  row_version: number;
  veterinary_notice?: string;
  [key: string]: unknown;
}

export interface WorkspaceDashboardResponse {
  workspace: WorkspaceSummary | null;
  herd_size: number;
  horses: Array<Record<string, unknown>>;
  tasks: { overdue: WorkspaceTaskRecord[]; due_soon: WorkspaceTaskRecord[]; later: WorkspaceTaskRecord[]; invalid?:WorkspaceTaskRecord[] };
  tasks_truncated?:boolean;
  task_limit?:number;
  active_staff: Array<{ user_id: string; actions: string[]; granted_at: string }>;
  notes: string[];
}

export interface WorkspaceHorseMutationResponse {
  added?: true;
  removed?: true;
  horse_id: number;
  ownership_note: string;
}

export interface WorkspaceBulkResponse {
  bulk: true;
  requested_add: number;
  requested_remove: number;
  note: string;
}

export interface WorkspaceStaffInput {
  user_id: string;
  actions: string;
}

export interface WorkspaceStaffResponse {
  assigned: true;
  user_id: string;
  actions: string[];
  note: string;
}

export interface WorkspaceTaskInput {
  horse_id?: number | null;
  title: string;
  category: "document_renewal" | "farrier" | "veterinary_appointment" | "other";
  due_date: string;
  due_timezone?:string;
  recurrence?: "none" | "custom_days";
  recurrence_interval_days?: number | null;
  assigned_to_user_id?: string | null;
}

export interface WorkspaceTaskResponse {
  created: true;
  idempotent_replay?: boolean;
  task_id?:number;
  task?: { title: string; category: string; due_date: string; due_timezone?:string; recurrence: string };
  veterinary_notice?: string;
  note: string;
}

export interface WorkspaceTasksResponse {
  tasks: WorkspaceTaskRecord[];
  /** R124 (R122-T05): keyset page metadata — feed next_cursor back as
   * params.cursor to fetch the page strictly after the last returned row. */
  page?: { limit: number; returned: number; next_cursor: string | null; has_more: boolean; total: number; status: string };
}

export interface WorkspaceTaskCompleteResponse {
  completed: true;
  next_occurrence: { due_date: string; interval_days: number } | null;
  next_note?: string;
}

/** Trackers only: no file bytes, medical interpretation, or proof of title. */
export const WORKSPACE_DOCUMENT_CATEGORY_KEYS = ["identification", "registration", "insurance", "ownership", "veterinary_paper", "transport", "other"] as const;
export type WorkspaceDocumentKind = typeof WORKSPACE_DOCUMENT_CATEGORY_KEYS[number];
export interface WorkspaceDocumentInput {
  horse_id?: number | null; title: string; category: WorkspaceDocumentKind;
  note?: string | null; expires_at?: string | null;
}
/** R108-08: the writable update fields. A document's horse association is
 * FIXED AT CREATION — update accepts horse_id only for client round-trips and
 * the value must equal the stored association; a different value is rejected
 * with 409 document_horse_immutable and nothing is mutated. */
export interface WorkspaceDocumentUpdateInput extends WorkspaceDocumentInput {
  horse_id?: number | null;
}
export interface WorkspaceDocumentRecord extends WorkspaceDocumentInput {
  id: number; horse_id: number | null; note: string | null; expires_at: string | null;
  status: "active" | "archived"; row_version: number; created_at: string; updated_at: string;
}
export interface WorkspaceDocumentsResponse { rows: WorkspaceDocumentRecord[]; veterinary_notice: string; note: string }
export interface WorkspaceInviteInput { invitee_user_id: string; actions: string; note?: string | null }
export interface WorkspaceInviteResponse { invited: true; invitee_user_id: string; actions: string[]; expires_in_days: number; note: string }
export interface WorkspaceInviteRecord { collection_id: number; proposed_actions: string; note: string | null; expires_at: string; created_at: string; workspace_name: string }
export interface WorkspaceInvitesResponse { rows: WorkspaceInviteRecord[]; note: string }
export interface WorkspaceInviteRespondResponse { accepted: boolean; actions: string[] | null; note: string }
export interface WorkspaceTaskReassignResponse { reassigned: true; assigned_to_user_id: string | null; row_version: number; note: string }
/** R117-14: one-shot completed reminder restored to open. Recurring closures
 * are refused before this shape is ever returned. */
export interface WorkspaceTaskReopenResponse { reopened: true; note: string }
export type WorkspaceTaskImportRow = Pick<WorkspaceTaskInput, "title" | "category" | "due_date" | "recurrence" | "recurrence_interval_days" | "horse_id">;
/** R108-08: durable per-row import receipt. "imported" = accepted now;
 * "already_imported" = accepted by a previous attempt of the SAME import
 * intent (never re-executed, never duplicated); "occurrence_exists" = a
 * pre-existing occurrence (different import or manual creation) — honestly
 * skipped, never overwritten; "row_refused" = the write refused the row. */
export type WorkspaceTaskImportReceiptStatus = "imported" | "already_imported" | "occurrence_exists" | "row_refused";
export interface WorkspaceTaskImportReceipt {
  title: string; category: string; due_date: string; horse_id: number | null;
  status: WorkspaceTaskImportReceiptStatus; task_id: number | null;
}
export interface WorkspaceTaskImportResponse {
  imported: number; skipped: number;
  accepted: number; already_imported: number; intent_key: string | null;
  imported_titles: string[]; skipped_rows: Array<{ title: string; reason: string }>;
  receipts: WorkspaceTaskImportReceipt[]; note: string;
}

// --- P17-P19 billing ---

export interface BillingPriceRecord {
  id: number;
  sku: string;
  version: number;
  name_en: string;
  name_fa: string;
  description: string | null;
  price_minor: number;
  currency: string;
  period_days: number | null;
  active: number;
  created_at: string;
  superseded_at: string | null;
}

export interface BillingCatalogResponse {
  currency_internal: string;
  prices: BillingPriceRecord[];
  note: string;
}

export interface BillingOffer {
  sku: string;
  capability: string;
  name_en: string;
  name_fa: string;
  free_tier_en: string;
  free_tier_fa: string;
  paid_en: string;
  paid_fa: string;
  price: { price_minor: number; price_toman: number; currency: string; period_days: number | null; purchasable: boolean } | null;
}

export interface BillingOffersResponse {
  offers: BillingOffer[];
  free_forever: Array<{ en: string; fa: string }>;
  trust_note: string;
  note: string;
}

export interface BillingOrderInput {
  order_key: string;
  items: Array<{ sku: string; quantity: number }>;
  payer_organization_id?: number | null;
}

export interface BillingOrderLine {
  price_id: number;
  sku: string;
  title_en: string;
  title_fa: string;
  unit_minor: number;
  quantity: number;
  line_total_minor: number;
  version: number;
}

export interface BillingOrderRecord {
  id: number;
  order_key: string;
  status: string;
  total_minor: number;
  currency: string;
  total_toman: number;
  created_at?: string;
  updated_at?: string;
  lines?: BillingOrderLine[];
}

export interface BillingOrderResponse {
  created: true;
  idempotent_replay?: boolean;
  order: BillingOrderRecord;
  money_note: string;
  payment_note?: string;
}

export interface BillingMyOrdersResponse {
  orders: BillingOrderRecord[];
  currency_note: string;
}

export interface BillingPaymentAttempt {
  id: number;
  provider: string;
  authority: string | null;
  amount_minor: number;
  currency: string;
  state: string;
  created_at: string;
  verified_at: string | null;
}

export interface BillingOrderDetailResponse {
  order: BillingOrderRecord & Record<string, unknown>;
  lines: BillingOrderLine[];
  payment_attempts: BillingPaymentAttempt[];
  status_note: string;
}

export interface BillingPayResponse {
  attempt_id: number;
  state?: string;
  authority?: string;
  start_pay_url?: string;
  amount_minor?: number;
  currency?: string;
  amount_toman?: number;
  note: string;
}

export interface BillingEntitlementRecord {
  sku: string;
  activated_at: string;
  expires_at: string | null;
  currently_active: number;
}

export interface BillingEntitlementsResponse {
  entitlements: BillingEntitlementRecord[];
  boundary_note: string;
}
