export const PLATFORM_CONTRACT_VERSION = "2.13.0" as const;
export const PLATFORM_APPLICATION_VERSION = "0.42.16" as const;

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
  owner_claims: { version: "1.0.0", stability: "stable", access: "authenticated" },
  change_requests: { version: "1.0.0", stability: "stable", access: "authenticated" },
  audit: { version: "1.0.0", stability: "stable", access: "privileged" },
  admin: { version: "1.0.0", stability: "stable", access: "privileged" },
  media: { version: "0.0.0", stability: "reserved", access: "public" },
  curation: { version: "1.0.0", stability: "stable", access: "privileged" },
  verification: { version: "0.0.0", stability: "reserved", access: "public" },
  inspections: { version: "0.0.0", stability: "reserved", access: "public" },
  exports: { version: "1.0.0", stability: "stable", access: "privileged" },
  breed_standards: { version: "0.0.0", stability: "reserved", access: "public" },
  breeding_analysis: { version: "0.3.0", stability: "experimental", access: "public" },
  genomics: { version: "0.0.0", stability: "reserved", access: "public" },
  performance_records: { version: "0.0.0", stability: "reserved", access: "public" },
  market_data: { version: "0.0.0", stability: "reserved", access: "public" },
  ai_assistant: { version: "0.0.0", stability: "reserved", access: "public" },
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

export type PlatformPermission =
  | "horse.read"
  | "horse.create"
  | "horse.edit"
  | "horse.archive"
  | "person.read"
  | "pedigree.read"
  | "relationship.read"
  | "registry.export"
  | "claim.create"
  | "claim.read_own"
  | "claim.review"
  | "change.create"
  | "change.read_own"
  | "change.review"
  | "quality.read"
  | "audit.read"
  | "maintenance.run"
  | "content.manage";

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
  dataMode: "client" | "demo" | "empty";
  searchReady: boolean;
  database?: {
    mode: string;
    primary: "d1" | "turso";
    fallback?: "d1" | "turso";
    active: "d1" | "turso";
    failoverUsed: boolean;
  };
}

export interface HorseRecord {
  id: number;
  name_latin: string;
  name_native?: string | null;
  register_no?: string | null;
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

export type RegistrySort = "id" | "name" | "year" | "breed" | "sex" | "place";
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
  confidenceGrade: "high" | "medium" | "low";
  scoreComponents: BreedingOptimizerScoreComponent[];
  avoidedAncestorsPresent: number[];
  warnings: string[];
}

export interface BreedingOptimizerExclusion {
  candidateId: number;
  code: "missing_candidate" | "sex_role_conflict" | "avoid_ancestor_exclusion" | "coi_ceiling_exceeded";
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
  integrity: { cycleDetected: boolean; truncated: boolean };
  provenance: {
    method: "prospective-offspring-pedigree-coi-from-parental-kinship";
    algorithmVersion: string;
    founderAssumption: string;
    interpretation: string;
  };
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


export interface WorkflowReviewEffect {
  /** Review decisions do not directly mutate canonical horse or ownership data. */
  workflowEffect: "review_only";
  canonicalApplied: false;
}

export interface ClaimCreateResponse extends WorkflowReviewEffect {
  claim: ClaimRecord;
}

export type ChangeRequestType = "create_horse" | "update_horse" | "ownership" | "other";
export type ChangeRequestStatus = "draft" | "pending" | "approved" | "rejected" | "withdrawn";

export interface ChangeRequestItem {
  id?: number;
  field_name: string;
  old_value?: unknown;
  proposed_value: unknown;
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
  items: ChangeRequestItem[];
}

export interface ChangeRequestCreateInput {
  horse_id?: number | null;
  request_type: ChangeRequestType;
  summary: string;
  evidence?: Record<string, unknown>;
  items?: Array<Pick<ChangeRequestItem, "field_name" | "proposed_value"> & { old_value?: unknown }>;
}

export interface ChangeRequestsMineResponse { requests: ChangeRequestRecord[]; }
export interface ChangeRequestCreateResponse extends WorkflowReviewEffect { request: ChangeRequestRecord; }

export interface ClaimReviewResponse extends WorkflowReviewEffect { claim: AdminClaimRecord; }
export interface ChangeRequestReviewResponse extends WorkflowReviewEffect { request: ChangeRequestRecord; }

export interface AdminHorseRecord extends HorseRecord {
  microchip_no?: string | null;
  file_number?: string | null;
  lab_no?: string | null;
  passport_no?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
  row_version: number;
}

export interface HorseCurationInput {
  id?: number;
  name_latin: string;
  name_native?: string | null;
  register_no?: string | null;
  microchip_no?: string | null;
  father_id?: number | null;
  mother_id?: number | null;
  birth_year?: number | null;
  birth_place_desc?: string | null;
  breed_desc?: string | null;
  sex_desc?: string | null;
  color_desc?: string | null;
  description?: string | null;
}


export type ContentPostKind = "article" | "news" | "update";
export type ContentPostStatus = "draft" | "published" | "archived";
/** R117-17: per-language readiness, reported honestly and separately. */
export type ContentLanguageStatus = "complete" | "partial" | "missing";
/** R117-17: media-publication rights, tracked separately from language completeness. */
export type ContentMediaRights = "no_media" | "attributed" | "unattributed";
/** R117-17: the governed editorial transitions that record a version-history row. */
export type ContentRevisionCause = "create" | "update" | "publish" | "retract";
export type GeminiContentModel = "gemini-3.8-flash" | "gemini-3.5-flash-lite";

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
  summary_en: string;
  summary_fa: string;
  body_en: string;
  body_fa: string;
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
  /** R117-17: computed server-side from the stored fields — never claimed client-side. */
  language_completeness: { en: ContentLanguageStatus; fa: ContentLanguageStatus };
  media_publication_rights: ContentMediaRights;
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

/** R117-17: the editor-only preview payload. */
export interface ContentPreviewResponse {
  post: ContentPost;
  preview: true;
}

export interface ContentPostInput {
  kind: ContentPostKind;
  status: ContentPostStatus;
  title_en: string;
  title_fa: string;
  summary_en: string;
  summary_fa: string;
  body_en: string;
  body_fa: string;
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
  model: GeminiContentModel;
  grounding: boolean;
  kind: ContentPostKind;
  topic?: string;
  publish?: boolean;
}

export interface AiContentGenerateResponse {
  draft: ContentPostInput;
  post: ContentPost | null;
  sources: ContentSource[];
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
}

export interface AdminClaimRecord extends ClaimRecord { claimant?: string | null; }
export interface ReindexResponse { processed: number; failed: number; remaining: number; }
export interface MutationReconciliationResponse { processed: number; remaining: number; quarantined: number; }

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
}

export interface PlatformClient {
  readonly contractVersion: typeof PLATFORM_CONTRACT_VERSION;
  auth: {
    me(options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    login(input: PlatformLoginInput, options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    demoAdmin(options?: PlatformRequestOptions): Promise<PlatformAuthState>;
    logout(options?: PlatformRequestOptions): Promise<void>;
  };
  meta(options?: PlatformRequestOptions): Promise<PlatformMetaResponse>;
  health(options?: PlatformRequestOptions): Promise<PlatformHealthResponse>;
  search: {
    horses(query: string, options?: PlatformRequestOptions & { limit?: number }): Promise<HorseSearchResponse>;
    meta(options?: PlatformRequestOptions): Promise<SearchMetaResponse>;
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
  };
  people: {
    list(params?: { q?: string; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<PeopleListResponse>;
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
  };
  claims: {
    mine(options?: PlatformRequestOptions): Promise<ClaimsMineResponse>;
    create(horseId: number, evidence?: Record<string, unknown>, options?: PlatformRequestOptions): Promise<ClaimCreateResponse>;
  };
  changes: {
    mine(options?: PlatformRequestOptions): Promise<ChangeRequestsMineResponse>;
    create(input: ChangeRequestCreateInput, options?: PlatformRequestOptions): Promise<ChangeRequestCreateResponse>;
  };
  admin: {
    dashboard(options?: PlatformRequestOptions): Promise<AdminDashboardResponse>;
    content: {
      list(params?: { kind?: ContentPostKind; status?: ContentPostStatus; limit?: number; offset?: number }, options?: PlatformRequestOptions): Promise<ContentListResponse>;
      create(input: ContentPostInput, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
      update(id: string, expectedRowVersion: number, input: ContentPostInput, options?: PlatformRequestOptions): Promise<{ post: ContentPost }>;
      generate(input: AiContentGenerateInput, options?: PlatformRequestOptions): Promise<AiContentGenerateResponse>;
    };
    audit(options?: PlatformRequestOptions): Promise<{ events: AuditEventSummary[] }>;
    quality(severity?: AdminQualityIssue["severity"], options?: PlatformRequestOptions): Promise<{ issues: AdminQualityIssue[] }>;
    claims(options?: PlatformRequestOptions): Promise<{ claims: AdminClaimRecord[] }>;
    reviewClaim(claimId: string, decision: "approved" | "rejected", note?: string | null, options?: PlatformRequestOptions): Promise<ClaimReviewResponse>;
    changeRequests(options?: PlatformRequestOptions): Promise<{ requests: ChangeRequestRecord[] }>;
    reviewChangeRequest(requestId: string, decision: "approved" | "rejected", note?: string | null, options?: PlatformRequestOptions): Promise<ChangeRequestReviewResponse>;
    horses: {
      get(id: number, options?: PlatformRequestOptions): Promise<{ horse: AdminHorseRecord }>;
      create(input: HorseCurationInput, options?: PlatformRequestOptions): Promise<{ horse: AdminHorseRecord }>;
      update(id: number, expectedRowVersion: number, changes: Partial<Omit<HorseCurationInput, "id">>, options?: PlatformRequestOptions): Promise<{ horse: AdminHorseRecord }>;
      archive(id: number, options?: PlatformRequestOptions): Promise<{ ok: true; horseId: number }>;
    };
    maintenance: {
      reindex(options?: PlatformRequestOptions): Promise<ReindexResponse>;
      reconcileMutations(options?: PlatformRequestOptions): Promise<MutationReconciliationResponse>;
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
