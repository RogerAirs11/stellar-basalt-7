import { createUnavailableCareClient } from "./careClient";
import { createUnavailableMetadataClient } from "./metadataClient";
import {
  CHANGE_REQUEST_ITEMS_MAX,
  PLATFORM_CONTRACT_VERSION,
  PLATFORM_APPLICATION_VERSION,
  REGISTRY_EXPORT_ROWS_MAX,
  buildPlatformFeatureCatalog,
  type AncestorPedigreeResponse,
  type ClaimRecord,
  type ChangeRequestRecord,
  type AdminHorseRecord,
  type HorseCurationInput,
  type DescendantMetricsResponse,
  type HorseRecord,
  type HorseInsight,
  type PersonSummary,
  type PedigreeMetricsResponse,
  type PlatformCapabilities,
  type PlatformClient,
  type PlatformMetaResponse,
  type RegistryBrowseParams,
  type RegistryAnalyticsResponse,
  type RegistryCompletenessComponent,
  type RegistryCompletenessSection,
  type BreedingPairingAnalysisResponse,
  type BreedingOptimizerResponse,
  type ContentPost,
  type ContentPostInput,
  type ContentPostStatus,
  type ContentLanguageStatus,
  type ContentComment,
  type ContentMediaRights,
  type ContentPostRevision,
  type ContentRevisionCause,
  type ContentPreviewResponse,
  type ContentRevisionsResponse,
  type ContentAdminCommentsResponse,
  type AiAdminKeyTestResponse,
  type AiAdminKeysResponse,
  type AiAdminKeyRotationResponse,
  type AiAdminSettings,
  type AiAdminSettingsResponse,
  type AiContentGenerateInput,
  type MarketListingRecord,
} from "../contracts/platform";
import { PlatformClientError } from "./errors";

/** R76: one demo marketplace listing (provenance "demo") shared by list/detail
 * so offline prototyping shows the full canonical record shape. */
function mockMarketListing(withDescription = false): MarketListingRecord {
  return {
    id: "demo-listing-1",
    horse_id: 101,
    seller_contact_name: "Demo Stud",
    seller_contact_phone: null,
    seller_contact_email: null,
    seller_city: "Tehran",
    asking_price_toman: null,
    price_visible: 0,
    negotiable: 1,
    status: "published",
    title: "Championship stallion prospect",
    description: withDescription ? "Demo listing — canonical marketplace data shape." : null,
    view_count: 0,
    listed_at: "2026-09-20",
    updated_at: "2026-09-20",
    expires_at: null,
    provenance: "demo",
    row_version: 1,
    name_latin: "Shahriar",
    name_native: "شهریار",
    breed_desc: "Arabian",
    sex_desc: "Stallion",
    birth_year: 2016,
    color_desc: "Bay",
    main_strain_desc: null,
    is_stallion: 1,
    register_no: "MOCK-101",
    competition_starts: 1,
    verified_media_count: 1,
  };
}

export interface MockPlatformData {
  horses: HorseRecord[];
  people: PersonSummary[];
}

export interface MockPlatformOptions extends Partial<MockPlatformData> {
  capabilities?: Partial<PlatformCapabilities>;
  authenticated?: boolean;
}

const MOCK_CAPABILITIES: PlatformCapabilities = {
  authentication: true,
  search: true,
  structured_search: true,
  registry: true,
  registry_facets: true,
  horse_profiles: true,
  people: true,
  pedigree_ancestors: true,
  pedigree_descendants: true,
  pedigree_metrics: true,
  pedigree_paths: true,
  pedigree_coefficients: true,
  relationships: true,
  horse_insights: true,
  registry_analytics: true,
  quality_summary: true,
  quality_queue: true,
  evidence_summary: true,
  exact_identifier: true,
  owner_claims: true,
  change_requests: true,
  audit: true,
  admin: true,
  media: true,
  curation: true,
  verification: false,
  inspections: false,
  exports: true,
  breed_standards: false,
  breeding_analysis: true,
  genomics: false,
  performance_records: true,
  market_data: true,
  ai_assistant: false,
};

export const DEFAULT_MOCK_PLATFORM_DATA: MockPlatformData = {
  horses: [
    {
      id: 101,
      name_latin: "Shahriar",
      name_native: "شهریار",
      register_no: "MOCK-101",
      birth_year: 2016,
      breed_desc: "Arabian",
      sex_desc: "Stallion",
      color_desc: "Bay",
      birth_place_desc: "Tehran",
      father_id: 102,
      father_name: "Rostam",
      father_name_native: "رستم",
      mother_id: 103,
      mother_name: "Golnar",
      mother_name_native: "گلنار",
      owner_name: "Demo Stud",
      breeder_name: "Demo Breeder",
      is_active: 1,
      is_dead: 0,
    },
    {
      id: 102,
      name_latin: "Rostam",
      name_native: "رستم",
      register_no: "MOCK-102",
      birth_year: 2008,
      breed_desc: "Arabian",
      sex_desc: "Stallion",
      color_desc: "Grey",
      is_active: 1,
      is_dead: 0,
    },
    {
      id: 103,
      name_latin: "Golnar",
      name_native: "گلنار",
      register_no: "MOCK-103",
      birth_year: 2010,
      breed_desc: "Arabian",
      sex_desc: "Mare",
      color_desc: "Chestnut",
      is_active: 1,
      is_dead: 0,
    },
  ],
  people: [
    { id: 201, name_latin: "Demo Stud", name_native: "پرورشگاه نمونه", owner_count: 1, breeder_count: 0, importer_count: 0, passport_receiver_count: 0, horse_count: 1 },
    { id: 202, name_latin: "Demo Breeder", name_native: "پرورش‌دهنده نمونه", owner_count: 0, breeder_count: 1, importer_count: 0, passport_receiver_count: 0, horse_count: 1 },
  ],
};

/**
 * In-memory PlatformClient for frontend prototyping without Horse DB backend access.
 * It deliberately implements the same contract surface as the real client.
 */
export function createMockPlatformClient(options: MockPlatformOptions = {}): PlatformClient {
  const horses = [...(options.horses ?? DEFAULT_MOCK_PLATFORM_DATA.horses)];
  const people = [...(options.people ?? DEFAULT_MOCK_PLATFORM_DATA.people)];
  const capabilities: PlatformCapabilities = { ...MOCK_CAPABILITIES, ...options.capabilities };
  const claims: ClaimRecord[] = [];
  const changeRequests: ChangeRequestRecord[] = [];
  const contentPosts: ContentPost[] = [];
  // R117-17: in-memory version history mirroring content_post_revisions.
  const contentRevisions = new Map<string, ContentPostRevision[]>();
  // Turn 30: mock reader comments — seeded community voices per post.
  const contentComments = new Map<string, ContentComment[]>();

  const meta: PlatformMetaResponse = {
    contractVersion: PLATFORM_CONTRACT_VERSION,
    demoAdminLoginAvailable: true,
    application: { name: "Horse DB Mock Registry", shortName: "Mock Registry" },
    limits: {
      searchResultsMax: 50,
      registryPageMin: 1,
      registryPageMax: 100,
      peoplePageMax: 100,
      pedigreeAncestorDepthMax: 8,
      pedigreeDescendantDepthMax: 6,
      pedigreeDescendantNodesMax: 1000,
      pedigreeDescendantMetricsNodesMax: 1000,
      pedigreeMetricsDepthMax: 8,
      pedigreePathMax: 32,
      relationshipDepthMax: 16,
      relationshipPathMax: 36,
      registryExportRowsMax: REGISTRY_EXPORT_ROWS_MAX,
      changeRequestItemsMax: CHANGE_REQUEST_ITEMS_MAX,
    },
    stats: {
      horses: horses.length,
      people: people.length,
      ownerLinks: 1,
      breederLinks: 1,
      importerLinks: 0,
      passportReceiverLinks: 0,
      horsesWithBothParents: horses.filter((horse) => horse.father_id && horse.mother_id).length,
      horsesWithDnaData: 0,
      openQualityIssues: 0,
    },
    source: { filename: "mock-registry.json", sheet: "mock", rowCount: horses.length, sha256: "mock-v0.41.2", completedAt: null, status: "complete" },
    capabilities,
    featureCatalog: buildPlatformFeatureCatalog(capabilities),
  };

  let mockAuthenticated = options.authenticated ?? false;
  const mockUser = { id: "mock-user", email: "demo@horse-db.invalid", display_name: "Demo User", role: "owner" };
  const mockPermissions = ["horse.read", "person.read", "pedigree.read", "relationship.read", "claim.create", "claim.read_own", "change.create", "change.read_own"] as const;
  const ensure = (feature: keyof PlatformCapabilities) => {
    if (!capabilities[feature]) throw new PlatformClientError(501, "feature_unavailable", `Mock platform feature '${feature}' is unavailable`, { feature });
  };
  const ensureAuthenticated = () => {
    if (!mockAuthenticated) throw new PlatformClientError(401, "authentication_required", "Mock platform authentication required");
  };

  return {
    contractVersion: PLATFORM_CONTRACT_VERSION,
    care: createUnavailableCareClient(),
    metadata: createUnavailableMetadataClient(),
    auth: {
      mfa: {
        status: async () => ({ available: false, policy: "disabled", enrolled: false, factor_version: 0, pending_enrollment: null, verified_until: null, recovery_codes_remaining: 0, recovery_replacement_until: null, recent_events: [] }),
        beginEnrollment: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Authenticator setup requires the real account service"); },
        activate: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Authenticator verification requires the real account service"); },
        challenge: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Authenticator verification requires the real account service"); },
        recover: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Account recovery requires the real account service"); },
        rotateRecoveryCodes: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Recovery codes require the real account service"); },
        disable: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Authenticator settings require the real account service"); },
        cancelEnrollment: async () => { throw new PlatformClientError(501, "mock_mfa_unavailable", "Authenticator settings require the real account service"); },
      },
      me: async () => { ensure("authentication"); return { user: mockAuthenticated ? mockUser : null, permissions: mockAuthenticated ? [...mockPermissions] : [] }; },
      login: async () => { ensure("authentication"); mockAuthenticated = true; return { user: mockUser, permissions: [...mockPermissions] }; },
      demoAdmin: async () => { ensure("authentication"); mockAuthenticated = true; return { user: mockUser, permissions: [...mockPermissions] }; },
      demoPersona: async () => { throw new PlatformClientError(501, "demo_persona_unavailable", "Demo accounts require the isolated local demo server."); },
      logout: async () => { ensure("authentication"); mockAuthenticated = false; },
    },
    meta: async () => meta,
    health: async () => ({
      ok: true,
      applicationVersion: PLATFORM_APPLICATION_VERSION,
      contractVersion: PLATFORM_CONTRACT_VERSION,
      analyticsReady: true,
      analyticsSchemaVersion: "2.2.0",
      analyticsAlgorithmVersion: "2.2.0",
      analyticsSourceRevision: "mock-v0.41.2",
      horses: horses.length,
      searchRows: horses.length,
      users: 1,
      env: "mock",
      dataMode: horses.length ? "demo" : "empty",
      searchReady: true,
    }),
    ai: {
      status: async () => ({ available: false, defaultModel: null, models: [], visionAvailable: false, storageReady: false, reason: "mock_non_authoritative" }),
      models: async () => ({ models: [], defaultModel: null, visionAvailable: false }),
      list: async () => ({ conversations: [] }),
      create: async () => { throw new PlatformClientError(501, "ai_mock_unavailable", "MockPlatformClient deliberately does not fabricate AI authority"); },
      get: async () => { throw new PlatformClientError(501, "ai_mock_unavailable", "MockPlatformClient deliberately does not fabricate AI authority"); },
      remove: async () => ({ ok: false }),
      stream(){ throw new PlatformClientError(501, "ai_mock_unavailable", "MockPlatformClient deliberately does not fabricate AI responses"); },
    },
    search: {
      horses: async (query, options) => { ensure("search"); return ({
        query,
        results: filterHorses(horses, query).slice(0, clamp(options?.limit ?? 25, 1, 50)),
      }); },
      meta: async () => { ensure("structured_search"); return ({
        syntaxVersion: "1.1",
        maxQueryLength: 300,
        fields: [          { key: "name", aliases: ["name", "horse"] }, { key: "id", aliases: ["id", "no"] },
          { key: "owner", aliases: ["owner"] }, { key: "breeder", aliases: ["breeder"] },
          { key: "importer", aliases: ["importer"] }, { key: "passportReceiver", aliases: ["passport", "passportreceiver", "passport_receiver"] },
          { key: "father", aliases: ["father", "sire"] }, { key: "mother", aliases: ["mother", "dam"] },
          { key: "year", aliases: ["year", "born"] }, { key: "breed", aliases: ["breed"] }, { key: "place", aliases: ["place"] },
          { key: "color", aliases: ["color", "colour"] }, { key: "strain", aliases: ["strain", "bloodline"] }, { key: "imported", aliases: ["imported", "origin"] },
        ],
        registryFieldSearch: { version: "1.1", combinator: "and", fields: [
          { key: "horseName", queryParam: "name", type: "text" },
          { key: "horseId", queryParam: "id", type: "id" },
          { key: "registerNo", queryParam: "register", type: "text" },
          { key: "owner", queryParam: "owner", type: "text" },
          { key: "breeder", queryParam: "breeder", type: "text" },
          { key: "importer", queryParam: "importer", type: "text" },
          { key: "passportReceiver", queryParam: "passportReceiver", type: "text" },
          { key: "sire", queryParam: "sire", type: "text" },
          { key: "dam", queryParam: "dam", type: "text" },
          { key: "place", queryParam: "place", type: "text" },
          { key: "breed", queryParam: "breed", type: "facet" },
          { key: "sex", queryParam: "sex", type: "facet" },
          { key: "lifecycle", queryParam: "lifecycle", type: "facet" },
          { key: "color", queryParam: "color", type: "facet" },
          { key: "mainStrain", queryParam: "mainStrain", type: "facet" },
          { key: "importedFrom", queryParam: "importedFrom", type: "facet" },
          { key: "isImported", queryParam: "isImported", type: "boolean" },
          { key: "isSport", queryParam: "isSport", type: "boolean" },
          { key: "isStallion", queryParam: "isStallion", type: "boolean" },
          { key: "hasSportCard", queryParam: "hasSportCard", type: "boolean" },
          { key: "yearFrom", queryParam: "yearFrom", type: "year" },
          { key: "yearTo", queryParam: "yearTo", type: "year" },
        ] },
      }); },
      // R145-C05: authorized exact identifier lookup — the mock never holds
      // real identifiers, so the honest answer is always an empty result.
      exactIdentifier: async (kind) => {
        ensure("admin"); ensureAuthenticated();
        return { kind, matched: 0, results: [], note: "Mock lookup: demo data carries no real identifiers." };
      },
    },
    registry: {
      browse: async (params = {}) => { ensure("registry"); return browseMock(horses, params); },
      facets: async () => { ensure("registry_facets"); return ({
        breeds: facets(horses.map((horse) => horse.breed_desc)),
        sexes: facets(horses.map((horse) => horse.sex_desc)),
        places: facets(horses.map((horse) => horse.birth_place_desc)),
        colors: facets(horses.map((horse) => horse.color_desc)),
        mainStrains: facets(horses.map((horse) => horse.main_strain_desc)),
        importedFrom: facets(horses.map((horse) => horse.imported_from_desc)),
        decades: [],
        lifecycle: [],
        flags: [
          { value: "imported", count: horses.filter((h) => h.is_imported === 1).length },
          { value: "sport", count: horses.filter((h) => h.is_sport === 1).length },
          { value: "stallion", count: horses.filter((h) => h.is_stallion === 1).length },
          { value: "sport_card", count: horses.filter((h) => h.has_sport_card === 1).length },
        ],
      }); },
    },
    exports: {
      registry(params = {}, format = "csv") {
        const q = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") q.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
        q.set("format", format === "json" ? "json" : "csv"); q.set("limit", String(REGISTRY_EXPORT_ROWS_MAX));
        const safe = format === "json" ? "json" : "csv";
        return { format: safe, href: `/api/registry/export?${q.toString()}`, filename: `horse-registry-export.${safe}`, mimeType: safe === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8", maxRows: REGISTRY_EXPORT_ROWS_MAX };
      },
    },
    horses: {
      get: async (id) => {
        ensure("horse_profiles");
        const horse = requireHorse(horses, id);
        return { horse, people: [], aliases: [] };
      },
      // R145-C04: honest mock — a demo horse has no private evidence to hide,
      // so the summary is empty by construction.
      evidenceSummary: async (id) => {
        ensure("horse_profiles");
        const horse = requireHorse(horses, id);
        return {
          horse_id: horse.id, name_latin: horse.name_latin ?? null, name_native: horse.name_native ?? null,
          lifecycle_vocabulary: {}, media: { uploaded: 0, reviewed: 0 }, media_by_type: [],
          attestations: {}, attestations_by_record_kind: [], genetics_published: {},
          note: "Mock evidence summary for offline frontend development.",
        };
      },
      // T12: honest mock — lifecycle/ownership histories start empty (demo
      // data has no recorded temporal facts yet), with one demo lifecycle row
      // so offline prototyping shows the real record shape.
      lifecycle: async (id) => {
        ensure("horse_profiles");
        requireHorse(horses, id);
        return {
          horse_id: id,
          events: [{ id: 1, event_type: "other", date_value: "2024", date_precision: "year", date_calendar: "gregorian", uncertain_time: 1, note: "Demo lifecycle event (mock data)", source_ref: "demo", created_at: "2026-01-01T00:00:00Z" }],
        };
      },
      ownership: async (id) => {
        ensure("horse_profiles");
        requireHorse(horses, id);
        return { horse_id: id, periods: [] };
      },
    },
    people: {
      list: async (params = {}) => {
        ensure("people");
        const q = params.q?.trim().toLocaleLowerCase() ?? "";
        const filtered = q ? people.filter((person) => `${person.name_latin ?? ""} ${person.name_native ?? ""}`.toLocaleLowerCase().includes(q)) : people;
        const offset = Math.max(0, params.offset ?? 0);
        const limit = clamp(params.limit ?? 24, 1, 100);
        return { people: filtered.slice(offset, offset + limit), limit, offset };
      },
      get: async (id) => {
        ensure("people");
        const person = people.find((item) => item.id === id);
        if (!person) throw new PlatformClientError(404, "person_not_found", `Mock person ${id} not found`);
        return { person, horses: [], truncated: false };
      },
    },
    pedigree: {
      ancestors: async (id, params = {}) => { ensure("pedigree_ancestors"); return { direction: "ancestors", depth: params.depth ?? 4, tree: ancestorTree(horses, id, params.depth ?? 4) }; },
      descendants: async (id, params = {}) => { ensure("pedigree_descendants"); return { direction: "descendants", depth: params.depth ?? 3, tree: descendantTree(horses, id, params.depth ?? 3), truncated: false }; },
      metrics: async (id, params = {}) => { ensure("pedigree_metrics"); return mockPedigreeMetrics(horses, id, params.depth ?? 6); },
      descendantMetrics: async (id, params = {}) => { ensure("pedigree_metrics"); return mockDescendantMetrics(horses, id, params.depth ?? 4, params.maxNodes ?? 1000); },
      coefficients: async (id, params = {}) => { ensure("pedigree_coefficients"); requireHorse(horses,id); const depth=params.depth??8; return {horseId:id,depth,status:"ok",inbreedingCoefficient:0,inbreedingPercent:0,pedigreeCompletenessPercent:mockPedigreeMetrics(horses,id,depth).completenessPercent,analyzedHorses:horses.length,assumedFounderNodes:2,boundaryParentReferences:0,integrity:{cycleDetected:false,truncated:false},provenance:{method:"finite-pedigree-tabular-relationship",algorithmVersion:"1.0.0",founderAssumption:"unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders",interpretation:"Mock pedigree coefficient for frontend development; not genomic COI."}}; },
      pathsToAncestor: async (id,ancestorId,params={}) => { ensure("pedigree_paths"); requireHorse(horses,id); requireHorse(horses,ancestorId); const depth=params.depth??8; const path=mockPathToAncestor(horses,id,ancestorId,depth); return {horseId:id,ancestorId,depth,paths:path?[{path,branch:mockBranch(horses,id,path)}]:[],truncated:false,provenance:{method:"bounded-ancestor-path-enumeration",algorithmVersion:"1.0.0",interpretation:"Mock bounded pedigree paths."}}; },
    },
    relationships: {
      commonAncestors: async (from, to, params = {}) => { ensure("relationships"); return mockRelationship(horses, from, to, params.depth ?? 10); },
      coefficients: async (from,to,params={}) => { ensure("pedigree_coefficients"); requireHorse(horses,from);requireHorse(horses,to);const depth=params.depth??8; const rel=mockRelationship(horses,from,to,depth); const pct=rel.summary?.kind==="same_horse"?100:rel.summary?.kind==="direct_ancestor"||rel.summary?.kind==="direct_descendant"||rel.summary?.kind==="full_sibling"?50:rel.summary?.kind==="half_sibling"?25:rel.commonAncestors.length?12.5:0; return {from,to,depth,status:"ok",relationshipCoefficient:pct/100,relationshipPercent:pct,kinshipCoefficient:pct/200,kinshipPercent:pct/2,fromInbreedingCoefficient:0,fromInbreedingPercent:0,toInbreedingCoefficient:0,toInbreedingPercent:0,fromPedigreeCompletenessPercent:mockPedigreeMetrics(horses,from,Math.min(depth,8)).completenessPercent,toPedigreeCompletenessPercent:mockPedigreeMetrics(horses,to,Math.min(depth,8)).completenessPercent,analyzedHorses:horses.length,assumedFounderNodes:2,boundaryParentReferences:0,integrity:{cycleDetected:false,truncated:false},provenance:{method:"finite-pedigree-tabular-relationship",algorithmVersion:"1.0.0",founderAssumption:"unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders",interpretation:"Mock finite pedigree relationship coefficient."}}; },
    },
    breeding: {
      pairingEvidence: async () => { throw new PlatformClientError(501, "mock_evidence_unavailable", "Variant evidence requires the real registry service"); },
      pairingAnalysis: async (sireId, damId, params = {}) => {
        ensure("breeding_analysis");
        if (sireId === damId) throw new PlatformClientError(400, "invalid_pairing", "Mock sire and dam must be different horses");
        requireHorse(horses, sireId);
        requireHorse(horses, damId);
        const depth = params.depth ?? 8;
        const relation = mockRelationship(horses, sireId, damId, depth);
        const relPercent = relation.summary?.kind === "same_horse" ? 100
          : relation.summary?.kind === "direct_ancestor" || relation.summary?.kind === "direct_descendant" || relation.summary?.kind === "full_sibling" ? 50
          : relation.summary?.kind === "half_sibling" ? 25
          : relation.commonAncestors.length ? 12.5 : 0;
        const kinshipPercent = relPercent / 2;
        const sireCoverage = mockPedigreeMetrics(horses, sireId, Math.min(depth, 8)).completenessPercent;
        const damCoverage = mockPedigreeMetrics(horses, damId, Math.min(depth, 8)).completenessPercent;
        return {
          sireId, damId, depth, status: "ok",
          projectedOffspringInbreedingCoefficient: kinshipPercent / 100,
          projectedOffspringInbreedingPercent: kinshipPercent,
          parentalRelationshipCoefficient: relPercent / 100,
          parentalRelationshipPercent: relPercent,
          parentalKinshipCoefficient: kinshipPercent / 100,
          parentalKinshipPercent: kinshipPercent,
          sireInbreedingPercent: 0, damInbreedingPercent: 0,
          sirePedigreeCompletenessPercent: sireCoverage, damPedigreeCompletenessPercent: damCoverage,
          commonAncestors: relation.commonAncestors,
          integrity: { cycleDetected: false, truncated: false },
          provenance: {
            method: "prospective-offspring-pedigree-coi-from-parental-kinship",
            algorithmVersion: "1.0.0",
            founderAssumption: "unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders",
            interpretation: "Mock prospective pedigree pairing analysis; not genomic analysis or a breeding recommendation.",
          },
        } satisfies BreedingPairingAnalysisResponse;
      },
      optimize: async (input) => {
        ensure("breeding_analysis");
        const depth=input.depth??8;
        const rows=input.candidateIds.filter(id=>id!==input.fixedHorseId).map(candidateId=>{
          const candidate=requireHorse(horses,candidateId);
          const sireId=input.fixedRole==="sire"?input.fixedHorseId:candidateId;
          const damId=input.fixedRole==="dam"?input.fixedHorseId:candidateId;
          const relation=mockRelationship(horses,sireId,damId,depth);
          const relPercent=relation.commonAncestors.length?12.5:0;const coi=relPercent/2;
          const diversity=relation.commonAncestors.length?72:92;const concentration=relation.commonAncestors.length?38:18;
          const score=Math.max(0,Math.min(100,100-coi*4))*0.45+diversity*.25+(100-concentration)*.15+50*.15;
          return {rank:0,candidate:{id:candidate.id,name_latin:candidate.name_latin,name_native:candidate.name_native,birth_year:candidate.birth_year,breed_desc:candidate.breed_desc,sex_desc:candidate.sex_desc},sireId,damId,score:Number(score.toFixed(2)),confidenceAdjustedScore:Number(score.toFixed(2)),projectedOffspringInbreedingPercent:coi,projectedAncestorDiversityPercent:diversity,projectedTop5RecordedPathWeightSharePercent:concentration,projectedPedigreeCompletenessPercent:80,sharedRecordedAncestorsBetweenParents:relation.commonAncestors.length,candidateDiversityPreservationIndex:null,confidenceGrade:"high" as const,dataQualityGrade:"high" as const,scoreComponents:[{code:"low_projected_coi" as const,rawValue:coi,normalizedScore:Math.max(0,100-coi*8),nominalWeight:.45,appliedWeight:.5294},{code:"ancestor_diversity" as const,rawValue:diversity,normalizedScore:diversity,nominalWeight:.25,appliedWeight:.2941},{code:"low_ancestor_concentration" as const,rawValue:concentration,normalizedScore:100-concentration,nominalWeight:.15,appliedWeight:.1765},{code:"candidate_diversity_preservation" as const,rawValue:null,normalizedScore:null,nominalWeight:.15,appliedWeight:0}],avoidedAncestorsPresent:[],warnings:["Mock optimizer result; candidate DPI unavailable"]};
        }).sort((a,b)=>b.confidenceAdjustedScore-a.confidenceAdjustedScore).map((x,i)=>({...x,rank:i+1}));
        return {fixedHorseId:input.fixedHorseId,fixedRole:input.fixedRole,depth,evaluatedCandidates:rows.length,ranked:rows,objectives:{lowProjectedCoiWeight:input.objectives?.lowProjectedCoiWeight??.45,ancestorDiversityWeight:input.objectives?.ancestorDiversityWeight??.25,lowConcentrationWeight:input.objectives?.lowConcentrationWeight??.15,candidateDiversityPreservationWeight:input.objectives?.candidateDiversityPreservationWeight??.15,coiCeilingPercent:input.objectives?.coiCeilingPercent??12.5,avoidAncestorIds:input.objectives?.avoidAncestorIds??[],excludeAvoidedAncestors:input.objectives?.excludeAvoidedAncestors??false},provenance:{method:"explainable-pedigree-mating-candidate-ranking",algorithmVersion:"1.0.0",interpretation:"Mock explainable pedigree candidate ranking.",caveat:"Decision support only; not genetic merit or genomic prediction."}} satisfies BreedingOptimizerResponse;
      },
    },
    analytics: {
      horseInsights: async (id,params={}) => {
        ensure("horse_insights");
        const ancestorDepth=params.ancestorDepth??6; const descendantDepth=params.descendantDepth??4;
        const metricsDepth=params.metricsDepth??ancestorDepth; const coefficientDepth=params.coefficientDepth??8;
        const m=mockPedigreeMetrics(horses,id,ancestorDepth); const embeddedMetrics=mockPedigreeMetrics(horses,id,metricsDepth);
        const d=mockDescendantMetrics(horses,id,descendantDepth,5000);
        const cm=mockPedigreeMetrics(horses,id,coefficientDepth);
        const coefficient={horseId:id,depth:coefficientDepth,status:"ok" as const,inbreedingCoefficient:0,inbreedingPercent:0,pedigreeCompletenessPercent:cm.completenessPercent,analyzedHorses:horses.length,assumedFounderNodes:2,boundaryParentReferences:0,integrity:{cycleDetected:false,truncated:false},provenance:{method:"finite-pedigree-tabular-relationship" as const,algorithmVersion:"1.0.0",founderAssumption:"unobserved-or-out-of-depth parents are treated as unrelated non-inbred founders",interpretation:"Mock pedigree coefficient for frontend development; not genomic COI."}};
        const insights:HorseInsight[]=[{code:"pedigree_coverage",importance:"context",values:{completenessPercent:m.completenessPercent,depth:m.depth},provenance:{source:"pedigree_metrics",algorithmVersion:m.provenance.algorithmVersion}}];
        if(d.knownDescendants)insights.push({code:"descendant_reach",importance:"notable",values:{directChildren:d.directChildren,knownDescendants:d.knownDescendants},provenance:{source:"descendant_metrics",algorithmVersion:d.provenance.algorithmVersion}});
        return {horseId:id,ancestorDepth,descendantDepth,insights,pedigreeMetrics:embeddedMetrics,pedigreeCoefficient:coefficient,descendantMetrics:d};
      },
      registry: async () => { ensure("registry_analytics"); return mockRegistryAnalytics(horses); },
    },
    quality: {
      summary: async () => { ensure("quality_summary"); return { openIssues: 0, severities: [], topIssueCodes: [] }; },
    },
    content: {
      list: async (params = {}) => {
        const filtered = contentPosts.filter(post => post.status === "published" && (!params.kind || post.kind === params.kind));
        const offset = Math.max(0, params.offset ?? 0); const limit = clamp(params.limit ?? 12, 1, 50);
        return { posts: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
      },
      get: async (slug) => {
        const post = contentPosts.find(item => item.slug === slug && item.status === "published");
        if (!post) throw new PlatformClientError(404, "content_not_found", `Mock post ${slug} not found`);
        return { post };
      },
      comments: async (postId) => {
        const published = (contentComments.get(postId) ?? []).filter(comment => comment.status === "published");
        return { comments: published, total: published.length };
      },
      submitComment: async (postId, input) => {
        const post = contentPosts.find(item => item.id === postId && item.status === "published");
        if (!post) throw new PlatformClientError(404, "content_not_found", `Mock post ${postId} not found`);
        const comment: ContentComment = {
          id: `cmt_mock_${contentComments.size + 1}`,
          post_id: postId,
          author_name: input.author_name,
          body: input.body,
          locale: input.locale ?? "fa",
          likes: 0,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        const list = contentComments.get(postId) ?? [];
        list.push(comment);
        contentComments.set(postId, list);
        return { ok: true as const, comment, moderation: "pending" as const };
      },
    },
    claims: {
      mine: async () => { ensure("owner_claims"); ensureAuthenticated(); return { claims: [...claims] }; },
      create: async (horseId) => {
        ensure("owner_claims");
        ensureAuthenticated();
        requireHorse(horses, horseId);
        const claim: ClaimRecord = { id: `mock-${claims.length + 1}`, horse_id: horseId, status: "pending", created_at: new Date().toISOString() };
        claims.unshift(claim);
        return { claim, workflowEffect: "review_only", canonicalApplied: false };
      },
    },
    changes: {
      evidence: {
        list: async () => { throw new PlatformClientError(501, "evidence_storage_unavailable", "Private file storage requires a connected registry"); },
        upload: async () => { throw new PlatformClientError(501, "evidence_storage_unavailable", "Private file storage requires a connected registry"); },
        remove: async () => { throw new PlatformClientError(501, "evidence_storage_unavailable", "Private file storage requires a connected registry"); },
        fileUrl: () => "#private-evidence-unavailable",
      },
      mine: async () => { ensure("change_requests"); ensureAuthenticated(); return { requests: [...changeRequests] }; },
      create: async (input) => {
        ensure("change_requests"); ensureAuthenticated();
        if (input.horse_id) requireHorse(horses, input.horse_id);
        const now = new Date().toISOString();
        const request: ChangeRequestRecord = {
          id: `mock-change-${changeRequests.length + 1}`, horse_id: input.horse_id ?? null, request_type: input.request_type,
          status: input.submit === false ? "draft" : "pending", summary: input.summary ?? null, evidence: input.evidence ?? null,
          submitted_at: input.submit === false ? null : now, created_at: now, updated_at: now,
          items: (input.items ?? []).map((item, index) => ({ id: index + 1, field_name: item.field_name, old_value: item.old_value, proposed_value: item.proposed_value })),
          submission: input.submission ?? null,
          review_outcome: null,
          review_status: input.submit === false ? "draft" : "pending",
          canonical_horse_id: null,
        };
        changeRequests.unshift(request);
        return { request, workflowEffect: "review_only", canonicalApplied: false };
      },
      // T11 mock transitions: honest state machine, no canonical side effects.
      update: async (requestId, input) => {
        ensure("change_requests"); ensureAuthenticated();
        const item = changeRequests.find((request) => request.id === requestId);
        if (!item) throw new PlatformClientError(404, "change_request_not_found", `Mock change request ${requestId} not found`);
        if (item.status !== "draft") throw new PlatformClientError(409, "change_request_not_editable", "Only draft requests can be edited");
        if (input.summary !== undefined) item.summary = input.summary;
        if (input.evidence !== undefined) item.evidence = input.evidence;
        if (input.submission !== undefined) item.submission = input.submission;
        if (input.items !== undefined && input.items !== null) item.items = input.items.map((entry, index) => ({ id: index + 1, field_name: entry.field_name, old_value: entry.old_value, proposed_value: entry.proposed_value }));
        item.updated_at = new Date().toISOString();
        return { request: item, workflowEffect: "review_only", canonicalApplied: false };
      },
      submit: async (requestId) => {
        ensure("change_requests"); ensureAuthenticated();
        const item = changeRequests.find((request) => request.id === requestId);
        if (!item) throw new PlatformClientError(404, "change_request_not_found", `Mock change request ${requestId} not found`);
        if (item.status !== "draft") throw new PlatformClientError(409, "change_request_not_submittable", "Only draft requests can be submitted");
        item.status = "pending"; item.review_status = "pending"; item.review_outcome = null;
        item.submitted_at = new Date().toISOString(); item.updated_at = item.submitted_at;
        return { request: item, workflowEffect: "review_only", canonicalApplied: false };
      },
      withdraw: async (requestId) => {
        ensure("change_requests"); ensureAuthenticated();
        const item = changeRequests.find((request) => request.id === requestId);
        if (!item) throw new PlatformClientError(404, "change_request_not_found", `Mock change request ${requestId} not found`);
        if (item.status !== "draft" && item.status !== "pending") throw new PlatformClientError(409, "change_request_not_withdrawable", "Only draft or pending requests can be withdrawn");
        item.status = "withdrawn"; item.review_status = "withdrawn"; item.updated_at = new Date().toISOString();
        return { request: item, workflowEffect: "review_only", canonicalApplied: false };
      },
    },
    admin: {
      dashboard: async () => { ensure("admin"); ensureAuthenticated(); return { horses: horses.length, people: people.length, openIssues: 0, changesLast7Days: 0, reindexJobs: 0, pendingMutations: 0 }; },
      content: {
        list: async (params = {}) => {
          ensureAuthenticated();
          const filtered = contentPosts.filter(post => (!params.kind || post.kind === params.kind) && (!params.status || post.status === params.status));
          const offset = Math.max(0, params.offset ?? 0); const limit = clamp(params.limit ?? 50, 1, 100);
          return { posts: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
        },
        create: async (input: ContentPostInput) => {
          ensureAuthenticated(); if (input.status === "published" && mockLanguageStatus(input.title_en, input.body_en) !== "complete") throw new PlatformClientError(400, "content_publish_incomplete", "A complete English edition (title and body) is required before publishing");
          const post = mockContentPost(input, contentPosts.length + 1); contentPosts.unshift(post); mockRecordRevision(contentRevisions, post, "create", post.status); return { post };
        },
        update: async (id, expectedRowVersion, input: ContentPostInput) => {
          ensureAuthenticated(); if (input.status === "published" && mockLanguageStatus(input.title_en, input.body_en) !== "complete") throw new PlatformClientError(400, "content_publish_incomplete", "A complete English edition (title and body) is required before publishing");
          const index = contentPosts.findIndex(post => post.id === id); if (index < 0) throw new PlatformClientError(404, "content_not_found", `Mock post ${id} not found`);
          const current = contentPosts[index]!; if (current.row_version !== expectedRowVersion) throw new PlatformClientError(409, "edit_conflict", "Mock post changed");
          const post = { ...current, ...input, row_version: current.row_version + 1, updated_at: new Date().toISOString(), published_at: input.status === "published" ? (current.published_at ?? new Date().toISOString()) : current.published_at, language_completeness: { en: mockLanguageStatus(input.title_en, input.body_en), fa: mockLanguageStatus(input.title_fa, input.body_fa), ar: mockLanguageStatus(input.title_ar ?? "", input.body_ar ?? ""), zh: mockLanguageStatus(input.title_zh ?? "", input.body_zh ?? "") }, media_publication_rights: mockMediaRights(input.cover_image_url, input.cover_image_credit, input.cover_image_source_url) } satisfies ContentPost;
          contentPosts[index] = post; mockRecordRevision(contentRevisions, post, "update", current.status); return { post };
        },
        generate: async (input: AiContentGenerateInput) => {
          ensureAuthenticated(); const draft: ContentPostInput = { kind: input.kind, status: "draft", title_en: `Mock ${input.kind}`, title_fa: `نمونه ${input.kind === "news" ? "خبر" : input.kind === "update" ? "به‌روزرسانی" : "مقاله"}`, summary_en: "Mock bilingual newsroom content.", summary_fa: "محتوای دو زبانه نمونه برای اتاق خبر.", body_en: "This mock post demonstrates the structured newsroom contract without calling an external AI service.", body_fa: "این نوشته نمونه قرارداد ساخت‌یافته اتاق خبر را بدون فراخوانی سرویس هوش مصنوعی خارجی نمایش می‌دهد.", tags: ["mock"], sources: [], ai_model: input.model, ai_grounding: input.grounding, ai_prompt: input.topic ?? null };
          return { draft, post: null, sources: [], warnings: [], attempts: [] };
        },
        // R117-17: the governed editorial workflow actions, mirroring the server semantics.
        preview: async (id: string): Promise<ContentPreviewResponse> => {
          ensureAuthenticated(); const post = contentPosts.find(item => item.id === id); if (!post) throw new PlatformClientError(404, "content_not_found", `Mock post ${id} not found`);
          return { post, preview: true };
        },
        publish: async (id: string, expectedRowVersion: number) => {
          ensureAuthenticated(); const index = contentPosts.findIndex(post => post.id === id); if (index < 0) throw new PlatformClientError(404, "content_not_found", `Mock post ${id} not found`);
          const current = contentPosts[index]!; if (current.row_version !== expectedRowVersion) throw new PlatformClientError(409, "edit_conflict", "Mock post changed");
          if (current.status === "published") throw new PlatformClientError(409, "content_invalid_transition", "This post is already published");
          if (current.language_completeness.en !== "complete") throw new PlatformClientError(400, "content_publish_incomplete", "A complete English edition (title and body) is required before publishing");
          const post = { ...current, status: "published" as const, published_at: current.published_at ?? new Date().toISOString(), updated_at: new Date().toISOString(), row_version: current.row_version + 1 } satisfies ContentPost;
          contentPosts[index] = post; mockRecordRevision(contentRevisions, post, "publish", current.status); return { post };
        },
        retract: async (id: string, expectedRowVersion: number) => {
          ensureAuthenticated(); const index = contentPosts.findIndex(post => post.id === id); if (index < 0) throw new PlatformClientError(404, "content_not_found", `Mock post ${id} not found`);
          const current = contentPosts[index]!; if (current.row_version !== expectedRowVersion) throw new PlatformClientError(409, "edit_conflict", "Mock post changed");
          if (current.status !== "published") throw new PlatformClientError(409, "content_invalid_transition", "Only a published post can be retracted");
          const post = { ...current, status: "archived" as const, updated_at: new Date().toISOString(), row_version: current.row_version + 1 } satisfies ContentPost;
          contentPosts[index] = post; mockRecordRevision(contentRevisions, post, "retract", current.status); return { post };
        },
        revisions: async (id: string): Promise<ContentRevisionsResponse> => {
          ensureAuthenticated(); if (!contentPosts.some(post => post.id === id)) throw new PlatformClientError(404, "content_not_found", `Mock post ${id} not found`);
          const revisions = contentRevisions.get(id) ?? [];
          return { revisions, total: revisions.length };
        },
        comments: async (params = {}): Promise<ContentAdminCommentsResponse> => {
          ensureAuthenticated();
          const all = [...contentComments.values()].flat().filter(comment => !params.status || comment.status === params.status);
          const limit = clamp(params.limit ?? 100, 1, 500);
          return { comments: all.slice(0, limit), total: all.length };
        },
        moderateComment: async (commentId: string, action: "approve" | "hide" | "delete") => {
          ensureAuthenticated();
          for (const [postId, list] of contentComments.entries()) {
            const index = list.findIndex(comment => comment.id === commentId);
            if (index >= 0) {
              if (action === "delete") list.splice(index, 1);
              else list[index] = { ...list[index]!, status: action === "approve" ? "published" : "hidden" };
              contentComments.set(postId, list);
              return { ok: true };
            }
          }
          throw new PlatformClientError(404, "comment_not_found", `Mock comment ${commentId} not found`);
        },
      },
      ai: {
        status: async () => ({ status: { available: true, reason: null, defaultModel: "gemini-2.5-flash", models: [], storageReady: true } }),
        keys: async (): Promise<AiAdminKeysResponse> => ({ keys: [], envKeyCount: 1, ring: { totalKeys: 1, availableKeys: 1, coolingKeys: 0, keys: [{ id: "env-1", source: "env", label: "GEMINI_API_KEY", masked: "AIzaSy•••mock", cooling: false, cooldownRemainingMs: 0, lastUsedAt: null, lastStatus: null }] } }),
        addKey: async () => { throw new PlatformClientError(501, "mock_unsupported", "Mock client cannot persist AI keys"); },
        updateKey: async () => ({ ok: true }),
        deleteKey: async () => ({ ok: true }),
        testKey: async (): Promise<AiAdminKeyTestResponse> => ({ ok: true, code: "ok", message: "Mock key is valid" }),
        rotateKeyEncryption: async (): Promise<AiAdminKeyRotationResponse> => ({ ok: true, converted: 0, alreadyCurrent: 0, failed: [] }),
        getSettings: async (): Promise<AiAdminSettingsResponse> => ({ settings: { defaultChatModel: null, defaultExecutionMode: null }, models: [{ provider: "gemini", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", available: true, vision: true, paid: false, defaultForChat: true }] }),
        updateSettings: async (input: AiAdminSettings): Promise<{ ok: boolean; settings: AiAdminSettings }> => ({ ok: true, settings: input }),
      },
      audit: async () => { ensure("audit"); ensureAuthenticated(); return { events: [] }; },
      quality: async (params = {}) => { ensure("admin"); ensureAuthenticated(); return { issues: [] as never[], counts: { open: 0, assigned: 0, resolved: 0, total: 0, unresolved_by_severity: [], unresolved_by_code: [] }, low_risk_bulk_codes: [], limit: params.limit ?? 100, note: "Mock quality queue." }; },
      qualityDetail: async () => { ensure("admin"); ensureAuthenticated(); return { issue: { id: 0, issue_code: "NONE", severity: "info", message: "Mock", detected_at: "1970-01-01T00:00:00Z" }, history: [] }; },
      qualityAssign: async (id) => { ensure("admin"); ensureAuthenticated(); return { ok: true, id, status: "assigned", assigned_to: "mock" }; },
      qualityResolve: async (id) => { ensure("admin"); ensureAuthenticated(); return { ok: true, id, status: "resolved" }; },
      qualityReopen: async (id) => { ensure("admin"); ensureAuthenticated(); return { ok: true, id, status: "open" }; },
      qualityNote: async (id) => { ensure("admin"); ensureAuthenticated(); return { ok: true, id, noted: true }; },
      qualityBulkResolve: async (ids) => { ensure("admin"); ensureAuthenticated(); return { ok: true, resolved: ids.length, ids }; },
      qualityScan: async () => { ensure("admin"); ensureAuthenticated(); return { ok: true, detected_candidates: 0, created: 0, open_issues: 0, rule_version: "e04-1.0.0", completed: true, resume_after: null, scanned_from: 0, scanned_to: 0, note: "Mock scan." }; },
      rules: {
        list: async () => { ensure("admin"); ensureAuthenticated(); return { rules: [], recent_fail_counts_30d: {}, total: 0 }; },
        create: async (input: { id: string; title: string }) => { ensure("admin"); ensureAuthenticated(); return { rule: { id: input.id, rule_type: "chronology", title: input.title, severity: "warning", applicability: {}, spec: {}, state: "draft", version: 1, created_by: "mock", updated_by: "mock", created_at: "1970-01-01T00:00:00Z", updated_at: "1970-01-01T00:00:00Z" } as never }; },
        detail: async (ruleId: string) => { ensure("admin"); ensureAuthenticated(); return { rule: { id: ruleId, rule_type: "chronology", title: "Mock rule", severity: "warning", applicability: {}, spec: {}, state: "draft", version: 1, created_by: "mock", updated_by: "mock", created_at: "1970-01-01T00:00:00Z", updated_at: "1970-01-01T00:00:00Z" } as never, versions: [], outcomes: [] }; },
        patch: async (ruleId: string) => { ensure("admin"); ensureAuthenticated(); return { rule: { id: ruleId, state: "draft", version: 2 } as never }; },
        transition: async (ruleId: string, input: { state: string }) => { ensure("admin"); ensureAuthenticated(); return { rule: { id: ruleId, state: input.state, version: 2 } as never }; },
        preview: async (ruleId: string) => { ensure("admin"); ensureAuthenticated(); return { rule_id: ruleId, previewed: 0, pass: 0, fail: 0, sample: [], note: "Mock preview." }; },
      },
      fieldClaims: {
        queue: async () => { ensure("admin"); ensureAuthenticated(); return { claims: [], counts: {}, limit: 100 }; },
        horse: async (horseId: number) => { ensure("admin"); ensureAuthenticated(); return { horse_id: horseId, name_latin: null, row_version: 0, fields: {}, decisions: [] }; },
        select: async (horseId: number, claimId: number) => { ensure("admin"); ensureAuthenticated(); return { ok: true, applied_value: null, previous_canonical: null, horse_id: horseId, claim_id: claimId } as never; },
        reject: async (horseId: number, claimId: number) => { ensure("admin"); ensureAuthenticated(); return { ok: true, claim: { id: claimId, horse_id: horseId, field_name: "none", claimed_value: null, value_kind: "text", source_type: "import", source_ref: null, evidence: null, observed_at: null, review_status: "rejected", created_at: "1970-01-01T00:00:00Z" } as never }; },
        revertDecision: async (horseId: number, decisionId: number) => { ensure("admin"); ensureAuthenticated(); return { ok: true, reverted_decision_id: decisionId, restored_value: null, horse_id: horseId } as never; },
      },
      claims: async () => { ensure("admin"); ensureAuthenticated(); return { claims: claims.map((claim) => ({ ...claim, claimant: mockUser.display_name })) }; },
      reviewClaim: async (claimId, decision, note?) => {
        ensure("admin"); ensureAuthenticated();
        const claim = claims.find((item) => item.id === claimId);
        if (!claim) throw new PlatformClientError(404, "claim_not_found", `Mock claim ${claimId} not found`);
        claim.status = decision; claim.reviewed_at = new Date().toISOString(); claim.review_note = note ?? null;
        return { claim: { ...claim, claimant: mockUser.display_name }, workflowEffect: "review_only", canonicalApplied: false };
      },
      changeRequests: async () => { ensure("admin"); ensureAuthenticated(); return { requests: [...changeRequests] }; },
      reviewChangeRequest: async (requestId, decision, note?) => {
        ensure("admin"); ensureAuthenticated();
        const item = changeRequests.find((request) => request.id === requestId);
        if (!item) throw new PlatformClientError(404, "change_request_not_found", `Mock change request ${requestId} not found`);
        if (item.status !== "pending" && item.status !== "draft") throw new PlatformClientError(409, "change_request_closed", "Mock change request already decided");
        if (decision === "needs_changes") {
          if (!note?.trim()) throw new PlatformClientError(422, "review_note_required", "needs_changes requires a note");
          item.status = "draft"; item.review_outcome = "needs_changes"; item.review_status = "needs_changes";
        } else {
          item.status = decision; item.review_status = decision; item.review_outcome = decision;
        }
        item.reviewed_at = new Date().toISOString(); item.review_note = note ?? null; item.updated_at = item.reviewed_at;
        return { request: item, workflowEffect: "review_only", canonicalApplied: false };
      },
      horses: {
        get: async (id) => { ensure("curation"); ensureAuthenticated(); return { horse: { ...requireHorse(horses, id), row_version: 1 } as AdminHorseRecord }; },
        create: async (input: HorseCurationInput) => {
          ensure("curation"); ensureAuthenticated();
          const id = input.id ?? Math.max(0, ...horses.map((horse) => horse.id)) + 1;
          const horse = { id, ...input, is_active: 1, is_dead: 0, row_version: 1 } as AdminHorseRecord;
          horses.push(horse); return { horse };
        },
        update: async (id, _expectedRowVersion, changes) => {
          ensure("curation"); ensureAuthenticated();
          const horse = requireHorse(horses, id); Object.assign(horse, changes);
          return { horse: { ...horse, row_version: 2 } as AdminHorseRecord };
        },
        archive: async (id) => { ensure("curation"); ensureAuthenticated(); requireHorse(horses, id); return { ok: true as const, horseId: id }; },
        // T12: mock writes validate the shape and echo an honest result — a
        // death/castration event also flips the canonical flag like the API.
        createOwnershipPeriod: async (id, input) => {
          ensure("curation"); ensureAuthenticated(); requireHorse(horses, id);
          return {
            period: { id: 1, owner_person_id: input.owner_person_id, owner_name_latin: "Demo Owner", owner_name_native: null, start_value: input.start.value, start_precision: input.start.precision, start_calendar: input.start.calendar, end_value: input.end?.value ?? null, end_precision: input.end?.precision ?? null, end_calendar: input.end?.calendar ?? null, share_percent: input.share_percent ?? null },
            possible_overlap_period_ids: [],
          };
        },
        createLifecycleEvent: async (id, input) => {
          ensure("curation"); ensureAuthenticated();
          const horse = requireHorse(horses, id);
          if (input.event_type === "death") horse.is_dead = 1;
          return {
            events: [{ id: 1, event_type: input.event_type, date_value: input.date.value, date_precision: input.date.precision, date_calendar: input.date.calendar, uncertain_time: input.uncertain_time ? 1 : 0, note: input.note ?? null, source_ref: input.source_ref ?? null, created_at: "2026-01-01T00:00:00Z" }],
            canonical_field_updated: input.event_type === "death" ? "death_date" : input.event_type === "castration" ? "castration_date" : null,
          };
        },
      },
      maintenance: {
        reindex: async () => { ensure("admin"); ensureAuthenticated(); return { processed: 0, failed: 0, remaining: 0 }; },
        reconcileMutations: async () => { ensure("admin"); ensureAuthenticated(); return { processed: 0, remaining: 0, quarantined: 0 }; },
      },
      // R117-18: the offline mock never fabricates privacy execution. The
      // queue is honestly empty and the commands refuse — the offline demo
      // cannot produce an execution receipt.
      privacy: {
        redactionQueue: async () => { ensure("admin"); ensureAuthenticated(); return { requests: [], counts: { received: 0, deferred_active_hold: 0, granted: 0, refused: 0, executed: 0 }, note: "Offline demo: no redaction requests exist and no execution receipt can be produced here." }; },
        decideRedaction: async () => { ensure("admin"); ensureAuthenticated(); throw new Error("Offline demo cannot decide privacy redaction requests."); },
        fulfillRedaction: async () => { ensure("admin"); ensureAuthenticated(); throw new Error("Offline demo cannot execute privacy redaction requests."); },
      },
      // R141: the duplicate workbench is honestly inert offline — the demo
      // database holds no canonical duplicate groups and no merge receipts,
      // and the versioned merge commands must never be simulated.
      duplicates: {
        candidates: async () => { ensure("admin"); ensureAuthenticated(); return { generated: new Date().toISOString(), reasons: ["register_no_exact", "microchip_exact", "name_year_match", "same_parents"], group_limit: 20, groups: [], total_groups: 0, truncated: false, note: "Offline demo: no canonical duplicate candidates exist here." }; },
        mergePreview: async () => { ensure("admin"); ensureAuthenticated(); throw new Error("Offline demo cannot run merge previews."); },
        merge: async () => { ensure("admin"); ensureAuthenticated(); throw new Error("Offline demo cannot execute merges."); },
        unmerge: async () => { ensure("admin"); ensureAuthenticated(); throw new Error("Offline demo cannot execute unmerges."); },
        mergeHistory: async () => { ensure("admin"); ensureAuthenticated(); return { merges: [], limit: 20, include_resolved: false, note: "Offline demo: no merge receipts exist here." }; },
      },
    },
    modules: {
      competitions: {
        // R76: mock demo rows (provenance "demo") so offline prototyping shows
        // the real shapes of every record module — never presented as federation data.
        list: async () => ({ rows: [{ id: 1, name_native: "جام قهرمانی نمایش", name_latin: "Championship Show Cup", discipline: "halter", event_date: "2026-09-12", end_date: null, venue: "Tehran Equestrian Center", city: "Tehran", organizer: null, tier: "national", season: 2026, provenance: "demo", result_count: 2 }], total: 1, limit: 20, offset: 0 }),
        detail: async () => ({ competition: { id: 1, name_native: "جام قهرمانی نمایش", name_latin: "Championship Show Cup", discipline: "halter", event_date: "2026-09-12", end_date: null, venue: "Tehran Equestrian Center", city: "Tehran", organizer: null, tier: "national", season: 2026, provenance: "demo", result_count: 2 }, results: [
          { id: 1, competition_id: 1, horse_id: 101, rider_name: "Demo Rider", rider_club: null, class_name: "Stallions", placement: 1, placement_text: null, score: null, is_eliminated: 0, is_withdrawn: 0, provenance: "demo", name_latin: "Shahriar", name_native: "شهریار" },
          { id: 2, competition_id: 1, horse_id: 102, rider_name: "Demo Rider II", rider_club: null, class_name: "Stallions", placement: 3, placement_text: null, score: null, is_eliminated: 0, is_withdrawn: 0, provenance: "demo", name_latin: "Rostam", name_native: "رستم" },
        ] }),
        horseHistory: async (horseId = 101) => ({ horse: { id: horseId, name_latin: "Shahriar", name_native: "شهریار" }, summary: { starts: 1, wins: 1, podium: 1, eliminations: 0 }, results: [
          { id: 1, competition_id: 1, horse_id: horseId, rider_name: "Demo Rider", rider_club: null, class_name: "Stallions", placement: 1, placement_text: null, score: null, is_eliminated: 0, is_withdrawn: 0, provenance: "demo", competition_name: "Championship Show Cup", event_date: "2026-09-12" },
        ] }),
        // R114-02: versioned competition commands are admin/editor surfaces the
        // offline mock cannot honor truthfully — they refuse explicitly rather
        // than fabricate a receipt (an unknown write must never look applied).
        adminCreateResult: async () => { throw { status: 501, code: "not_supported_offline", message: "The offline mock does not execute versioned competition commands" }; },
        adminUpdateResult: async () => { throw { status: 501, code: "not_supported_offline", message: "The offline mock does not execute versioned competition commands" }; },
        adminUpdateEvent: async () => { throw { status: 501, code: "not_supported_offline", message: "The offline mock does not execute versioned competition commands" }; },
      },
      // R140-G: the offline mock carries the racing SHAPES (provenance
      // "demo"-flavored) so offline prototyping shows the real DTOs — the
      // live asbdavani dataset only exists behind the real service.
      racing: {
        horse: async (horseId = 101) => ({
          horse: { id: horseId, name_latin: "Shahriar", name_native: "شهریار" },
          summary: { starts: 1, wins: 1, second_places: 0, third_places: 0, first_race_date: "2026-10-16T00:00:00.000Z", last_race_date: "2026-10-16T00:00:00.000Z", seasons_count: 1 },
          results: [
            { racehorse_id: "demo-rh-1", race_id: "demo-race-1", week_id: "demo-week-1", week_date: "2026-10-16T00:00:00.000Z", season: "FALL", location: "تهران", round_no: 1, plan_name: "نژاد عرب دوسر +4سال مسافت 1400", distance_m: 1400, number: 3, rank: 1, is_run: null, time_s: null, weight: 58, carried_weight: 58, tools_weight: null, entrance_rating: null, dl: null, registration_cost: null, owner_text: null, horse_id: "demo-asb-1", horse_name: "شهریار", horse_sex: null, horse_birthdate: null, horse_starts: null, horse_p1: null, horse_p2: null, horse_p3: null, sire_id: null, sire_name: null, dam_id: null, dam_name: null, rider_id: null, rider_name: "Demo Rider", coach_id: null, coach_name: null, data_origin: null, registry_horse_id: String(horseId) },
          ],
          provenance: { source: "asbdavani" as const, trust_level: "imported_unverified" as const, identity_crosswalk: "Results attach to registry horses by the federation racing system's identity crosswalk (registry_horse_id), never by name." },
        }),
        races: async () => ({ total: 1, limit: 12, offset: 0, races: [
          { race_id: "demo-race-1", week_id: "demo-week-1", week_name: "هفته 1 تهران 1405", week_date: "2026-10-16T00:00:00.000Z", week_number: 1, league_id: null, season: "FALL", location: "تهران", round_no: 1, race_name: "دوی نمایشی", status: "PUBLISHING", media: null, plan_id: null, plan_name: "نژاد عرب دوسر", distance_m: 1400, age_class: null, blood: "ARAB", breed: "DO_SAR", condition_name: null, condition_type: null, prize_name: null, prizes: null, data_origin: null, starters_count: 1, decided_count: 1 },
        ], provenance: { source: "asbdavani" as const, trust_level: "imported_unverified" as const, identity_crosswalk: "Results attach to registry horses by the federation racing system's identity crosswalk (registry_horse_id), never by name." } }),
        race: async () => { throw new PlatformClientError(404, "not_found", "Race not found"); },
      },
      imports: {
        // R114-03: the staged-import operator surface is a privileged
        // review workflow the offline mock cannot honor truthfully — it
        // refuses explicitly rather than fabricate rows or receipts.
        adminBatchPreview: async () => { throw new PlatformClientError(501, "not_supported_offline", "The offline mock does not serve import batch previews"); },
        adminReviewReport: async () => { throw new PlatformClientError(501, "not_supported_offline", "The offline mock does not serve import review reports"); },
        adminReviewRow: async () => { throw new PlatformClientError(501, "not_supported_offline", "The offline mock does not execute import row reviews"); },
      },
      market: {
        list: async () => ({ rows: [mockMarketListing()], total: 1, limit: 20, offset: 0 }),
        detail: async () => ({ listing: mockMarketListing(true), pedigree: { sire: { id: 102, name_latin: "Rostam", name_native: "رستم", breed_desc: "Arabian" }, dam: { id: 103, name_latin: "Golnar", name_native: "گلنار", breed_desc: "Arabian" } }, competitions: [], media: [], genetics: [] }),
        create: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        setStatus: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        renew: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        inquire: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        setInquiryStatus: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        mine: async () => ({ listings: [], inquiries: [] }),
        // R117-15: the mock carries the honest empty inbox shape (bounded pagination echo); mock writes stay honest 501s.
        sentInquiries: async () => ({ rows: [], pagination: { limit: 50, offset: 0, total: 0 }, note: "Your sent inquiries. Each listing's status is reported honestly and the conversation history stays readable to both participants." }),
        // R98-N12: mock reads carry the honest disclosure + lifecycle shape;
        // mock writes stay honest 501s (the mock never fabricates a command).
        conversation: async () => ({ inquiry: { id: "demo-inquiry", listing_id: "demo-listing", status: "new", row_version: 1, created_at: "2026-10-06 08:00", message: "Is the horse still available?", buyer_name: "Demo Buyer", buyer_contact: null }, listing_status: "active", listing_expires_at: null, listing_title: null, replies: [], viewer_side: "buyer", staff_dispute_case: null, disclosure: { role: "introduction_only" as const, en: "This platform introduces buyers to sellers. It does not escrow payments, inspect horses, verify veterinary condition or guarantee any transaction. Buyers and sellers perform their own due diligence.", fa: "این پلتفرم فقط خریداران را به فروشندگان معرفی می‌کند. هیچ پرداخت امانی نمی‌گیرد، اسب را معاینه نمی‌کند و هیچ معامله‌ای را تضمین نمی‌کند. بررسی دقیق بر عهده طرفین است." } }),
        reply: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        closeOwnInquiry: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        watchlist: async () => ({ rows: [], note: "Your watchlist is private research data. Watching a listing is not a reservation and conveys no priority or claim." }),
        watch: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        unwatch: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        blocks: async () => ({ rows: [], note: "Blocking stops new inquiries between you and the other account in BOTH directions, and the other side is never told." }),
        block: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        unblock: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
        attachDossier: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock marketplace writes unavailable"); },
      },
      genetics: {
        capabilities: async (horseId) => ({ horse_id: horseId, policy_version: "r148.horse-scoped-genetics.1", permissions: [], can_view_private_evidence: false, can_view_verified_health_results: false, can_intake: false, can_review: false, can_publish: false }),
        addTest: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Genetic intake requires the real registry service"); },
        interpret: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Genetic review requires the real registry service"); },
        reviewHistory: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Private history requires the real registry service"); },
        reviewPairing: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Evidence review requires the real registry service"); }, setDisclosure: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Health-result disclosure requires the real registry service"); }, disclosureHistory: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Disclosure history requires the real registry service"); }, horse: async (horseId = 101) => ({ horse: { id: horseId, name_latin: "Shahriar", name_native: "شهریار", breed_desc: "Arabian" }, summary: { tested: 2, verified: 2, unverified: 0, clear: 1, carriers: 0, affected: 0, uninterpreted: 1, conflicts: 0, resolvedAssays: 1, unresolvedAssays: 0, unmappedRecords: 1 }, tests: [
        { id: 1, test_type: "SCID", test_category: "disease", result: "N/N", result_status: "clear" as const, result_interpretation: null, lab_name: null, lab_accession: null, tested_at: "2026-01-15", verified: 1, provenance: "demo", public_disclosed: 1, notes: null },
        { id: 2, test_type: "agouti_ASLIP", test_category: "coat_color", result: "a/a", result_status: "recorded_uninterpreted" as const, locus_quarantine: { status: "legacy_identifier_quarantined" as const, suggested: "agouti_ASIP", note: "Agouti locus gene symbol is ASIP; legacy ASLIP rows await reviewed mapping." }, result_interpretation: null, lab_name: null, lab_accession: null, tested_at: "2026-01-15", verified: 1, provenance: "demo", public_disclosed: 1, notes: null },
      ] }) },
      professionalGrants: {
        create: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Professional grants require the real registry service"); },
        list: async () => ({ grants: [] }),
        revoke: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Professional grants require the real registry service"); },
      },
      breedings: { correct: async () => { throw new PlatformClientError(501, "mock_write_unavailable", "Reviewed corrections require the real registry service"); }, horse: async (horseId = 101) => ({ horse: { id: horseId, name_latin: "Shahriar", name_native: "شهریار", sex_desc: "Stallion" }, as_sire: [
        { id: 1, row_version: 1, sire_id: 101, dam_id: 103, covering_date: "2025-04-10", season: 1404, method: null, outcome: "foaled", foal_id: null, provenance: "demo", sire_name: "Shahriar", dam_name: "Golnar" },
      ], as_dam: [], birth_record: null }) },
      media: {
        list: async (horseId = 101) => ({ horse_id: horseId, counts: { photos: 1, documents: 0, verified: 1 }, media: [
          { id: "demo-media-1", horse_id: horseId, media_type: "photo", role: "profile", file_name: "shahriar-profile.jpg", mime_type: "image/jpeg", size_bytes: 0, width: null, height: null, caption: "Studbook portrait (demo)", verification: "federation_verified", verification_level: "platform_reviewed", row_version: 1, consent_state: "shared_public" as const, public_visible: true, can_publish: false, can_withdraw: false, sort_order: 0, created_at: "2026-09-01" },
        ] }),
        upload: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock media writes unavailable"); },
        // R88 P09: mock mirrors the honest deployment story — token minting is
        // unavailable without the worker secret, so the mock reports exactly
        // that instead of inventing a fake token.
        access: async () => { throw new PlatformClientError(503, "token_access_unconfigured", "Short-lived media access is not configured in the mock"); },
        revokeAccess: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock media writes unavailable"); },
        setPublication: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock media writes unavailable"); },
        remove: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock media writes unavailable"); },
        verify: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock media writes unavailable"); },
        fileUrl: (id: string) => `/api/media/file/${encodeURIComponent(id)}`,
      },
      authExt: {
        register: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock auth unavailable"); },
        otpRequest: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock auth unavailable"); },
        otpVerify: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock auth unavailable"); },
      },
      registryExtras: {
        duplicateCheck: async () => ({ query: { name: null, registerNo: null, microchip: null, birthYear: null, fatherId: null, motherId: null }, candidates: [], blocked: false }),
        certificateUrl: (horseId: number) => `/api/horses/${horseId}/certificate.svg`,
        issueCertificate: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock certificates unavailable"); },
        issueExtract: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock extracts unavailable"); },
        verifyExtract: async () => ({ valid: false, reason: "feature_unavailable" }),
      },
      attestations: {
        listIssuers: async () => ({ issuers: [] }),
        listHorseAttestations: async () => ({ horse_id: 0, truncated: false, attestations: [] }),
        // R117-16: honest mock boundaries — no fabricated credentials, no
        // fabricated verification states, no mock issuance authority.
        verify: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock verification unavailable"); },
        issue: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock issuance unavailable"); },
        revoke: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock revocation unavailable"); },
        supersede: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock supersession unavailable"); },
        reviewSnapshot: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock snapshot review unavailable"); },
      },
      // Master-Ai T10: the demo client has no grants — honest empty actions,
      // never a fabricated permission.
      access: {
        horseActions: async () => ({ horse_id: 0, is_staff: false, relationships: [], actions: [], grants: [] }),
        myGrants: async () => ({ grants: [] }),
      },
      // R88 P20: the four domain modules. Reads return clearly-marked demo
      // data; every WRITE rejects 501 — the mock has no backend to durably
      // execute a command, and a fabricated successful transaction (payment,
      // claim, order) would be a lie. Same shapes as the real adapter.
      directory: {
        persons: async () => ({
          persons: [
            { person_id: 9001, name_latin: "Demo Farrier", name_native: "نعل‌بند نمایشی", service_categories: ["farrier"], province_code: "IR-23", province_code_scheme: "iso3166-2-ir:2020-11-24", city: "Tehran (demo)", contact_preference: "platform_message" as const, languages: "fa, en", availability_text: "Demo availability text", contact_note: "Contact is mediated by the platform per the stated preference." },
          ],
          next_cursor: null,
          page_size: 20,
          filters: { category: null, province: null, city: null, name: null },
        }),
        person: async (personId: number) => ({
          person: { person_id: personId, name_latin: "Demo Farrier", name_native: "نعل‌بند نمایشی", service_categories: ["farrier"], province_code: "IR-23", province_code_scheme: "iso3166-2-ir:2020-11-24", city: "Tehran (demo)", contact_preference: "platform_message" as const, languages: "fa, en", availability_text: null, contact_note: "Contact is mediated by the platform per the stated preference." },
          credentials: [
            { id: 1, role: "farrier", issuer_name: "Demo Issuer", identifier: "DEMO-1", issued_at: "2026-01-01", expires_at: null, is_active: true, recorded_period_status: "within_recorded_dates" as const, verification_state: "unverified", verification_level: "unverified" },
          ],
          active_credentials: [
            { id: 1, role: "farrier", issuer_name: "Demo Issuer", identifier: "DEMO-1", issued_at: "2026-01-01", expires_at: null, is_active: true, recorded_period_status: "within_recorded_dates" as const, verification_state: "unverified", verification_level: "unverified" },
          ],
          credentials_note: "Mock directory data. Credentials are self-declared until platform-reviewed or issuer-attested.",
        }),
        organizations: async () => ({ organizations: [], next_cursor: null, page_size: 20 }),
        submitClaim: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock directory claims unavailable — claims are moderated against the real database only"); },
        myClaims: async () => ({ claims: [] }),
        managedProfile: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock editable profiles are not durable records"); },
        upsertProfile: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock directory profile writes unavailable"); },
        addCredential: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock credential writes unavailable"); },
      },
      // R98-N07: organization onboarding — mock reads are clearly marked demo
      // data; every WRITE rejects 501 (no backend to durably execute staff
      // lifecycle or profile commands; a fabricated success would be a lie).
      organizations: {
        publicCard: async (organizationId: number) => ({
          organization: { id: organizationId, slug: "demo-farm", name_latin: "Demo Farm", name_native: "مزرعه نمایشی", kind: "stable", published: false },
        }),
        managed: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock organization management is not a durable record"); },
        upsertProfile: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock organization profile writes unavailable"); },
        staff: async () => ({ staff: [], policy: "Mock organization staff. Real staff rosters are evaluated against live memberships only." }),
        inbox: async () => ({ leads: [], policy: "Mock organization inbox. A real lead inbox is visible to CURRENT staff of that organization only." }),
        invite: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock staff invites unavailable"); },
        myInvites: async () => ({ invites: [] }),
        respondInvite: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock invite responses unavailable"); },
        setStaffRole: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock role changes unavailable"); },
        revokeStaff: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock revocations unavailable"); },
        appointOfficial: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock official appointments unavailable"); },
        addCredential: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock organization credential writes unavailable"); },
      },
      serviceRequests: {
        create: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock service request writes unavailable — a request is a durable record, not a simulation"); },
        mine: async () => ({ requests: [] }),
        inbox: async () => ({ requests: [], inbox: "provider" as const }),
        detail: async () => { throw new PlatformClientError(404, "not_found", "No service request exists in the mock"); },
        setStatus: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock service request writes unavailable"); },
        block: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock service request writes unavailable"); },
        report: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock service request writes unavailable"); },
        // R95-N12: mock reads are honest; writes stay refused — a block, a
        // consent withdrawal or a redaction is a durable record, not a simulation.
        withdrawConsent: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock consent withdrawal unavailable — consent is a durable record"); },
        providerBlock: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock provider block unavailable — a block is a durable record"); },
        redactNote: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock note redaction unavailable — redaction is a durable record"); },
        export: async () => ({ exported_for: "mock", generated_at: new Date().toISOString(), service_requests: [], requester_blocks: [], abuse_reports_filed: [], moderation_standing: { standing: "normal", reason: null, updated_at: null }, retention: { note: "Mock export: no personal data exists in the mock.", policy: "/api/service-requests/privacy-policy" } }),
        privacyPolicy: async () => ({ policy_version: "r95-n12", decision_table: [], ui_flow: { requester: ["Mock: no personal data exists"], provider: ["Mock: no personal data exists"] } }),
        // R108-05: reconciliation reads the mock's (empty) receipt store —
        // honestly unknown, never a fabricated confirmation.
        reconcileIntent: async () => ({ state: "unknown" as const, note: "No receipt exists in the mock — the write never happened here." }),
      },
      workspaces: {
        create: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        mine: async () => ({ owned: [], staff: [] }),
        dashboard: async () => { throw new PlatformClientError(404, "not_found", "No workspace exists in the mock"); },
        remove: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        addHorse: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        bulkHorses: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        removeHorse: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        assignStaff: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        revokeStaff: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        addTask: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        tasks: async () => ({ tasks: [] }),
        completeTask: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        reopenTask: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace writes unavailable"); },
        inviteStaff: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        respondInvite: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        revokeInvite: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        createDocument: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        updateDocument: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        archiveDocument: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        reassignTask: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        importTasks: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock workspace collaboration writes unavailable; use the isolated SQLite demo for durable workflows"); },
        myInvites: async () => ({ rows: [], note: "Mock: no invitations exist." }),
        documents: async () => ({ rows: [], veterinary_notice: "Tracker only; consult a qualified veterinarian.", note: "Mock: no document trackers exist." }),
        exportUrl: (id: number) => `/api/workspaces/${id}/export`,
      },
      billing: {
        catalog: async () => ({
          currency_internal: "IRR",
          prices: [
            { id: 1, sku: "farm_workspace_monthly", version: 1, name_en: "Farm workspace", name_fa: "فضای کار مزرعه", description: null, price_minor: 19000000, currency: "IRR", period_days: 30, active: 1, created_at: "2026-10-03", superseded_at: null },
          ],
          note: "Mock catalog. Prices are stored in integer rial (IRR) and displayed in toman (1 toman = 10 rial).",
        }),
        offers: async () => ({
          offers: [
            { sku: "farm_workspace_monthly", capability: "workspace_collections", name_en: "Farm workspace", name_fa: "فضای کار مزرعه", free_tier_en: "One private workspace collection is free forever.", free_tier_fa: "یک مجموعه کاری خصوصی برای همیشه رایگان است.", paid_en: "Additional workspace collections and delegated staff work.", paid_fa: "مجموعه‌های کاری بیشتر و واگذاری کار به کارکنان.", price: { price_minor: 19000000, price_toman: 1900000, currency: "IRR", period_days: 30, purchasable: false } },
          ],
          free_forever: [
            { en: "Basic horse identity, pedigree and results", fa: "مشخصات پایه اسب، تبارنامه و نتایج" },
          ],
          trust_note: "Mock offers. Payment buys conveniences only — never official approval, biological truth, evidence suppression, or access to another owner's private resources.",
          note: "Mock offer data for prototyping; nothing is purchasable in the mock.",
        }),
        createOrder: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock order writes unavailable — an order is a financial record, not a simulation"); },
        myOrders: async () => ({ orders: [], currency_note: "Mock: no orders exist. Internal amounts are integer rial (IRR); total_toman is a display conversion (1 toman = 10 rial)." }),
        order: async () => { throw new PlatformClientError(404, "not_found", "No order exists in the mock"); },
        cancelOrder: async () => { throw new PlatformClientError(501, "feature_unavailable", "Mock order writes unavailable"); },
        // P18 doctrine: payments fail closed on the real deployment until the
        // owner configures a provider; the mock mirrors that honesty — never
        // a fabricated gateway URL or successful transaction.
        pay: async () => { throw new PlatformClientError(503, "payment_provider_unconfigured", "Payment processing is not configured (mock mirrors the fail-closed real deployment). No charge can occur."); },
        entitlements: async () => ({ entitlements: [], boundary_note: "Mock: no entitlements. Entitlements unlock paid conveniences only." }),
      },
    },
  };
}

function filterHorses(horses: HorseRecord[], query: string): HorseRecord[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...horses];
  return horses.filter((horse) =>
    [horse.name_latin, horse.name_native, horse.register_no, horse.breed_desc, horse.birth_place_desc]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(q)),
  );
}

/* R128 — the mock mirrors the real browse contract's sort semantics, including
 * the locale-aware Persian collation (آ first) so the offline demo teaches the
 * same alphabetical order the production registry serves. The mapping matches
 * PERSIAN_ALPHABET_COLLATION in src/registry/query.ts. */
const MOCK_PERSIAN_COLLATION: ReadonlyArray<readonly [string, string]> = [
  ["\u0622\u0623\u0625\u0671", "01"], ["\u0627", "02"], ["\u0628", "03"], ["\u067E", "04"],
  ["\u062A", "05"], ["\u062B", "06"], ["\u062C", "07"], ["\u0686", "08"], ["\u062D", "09"],
  ["\u062E", "0a"], ["\u062F", "0b"], ["\u0630", "0c"], ["\u0631", "0d"], ["\u0632", "0e"],
  ["\u0698", "0f"], ["\u0633", "10"], ["\u0634", "11"], ["\u0635", "12"], ["\u0636", "13"],
  ["\u0637", "14"], ["\u0638", "15"], ["\u0639", "16"], ["\u063A", "17"], ["\u0641", "18"],
  ["\u0642", "19"], ["\u0643\u06A9", "1a"], ["\u06AF", "1b"], ["\u0644", "1c"], ["\u0645", "1d"],
  ["\u0646", "1e"], ["\u0629\u0647\u06C0", "1f"], ["\u0648", "20"], ["\u064A\u06CC\u0649\u0626", "21"],
];
const MOCK_PERSIAN_DIGITS = "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9";
const MOCK_ARABIC_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";

function mockPersianSortKey(value: string | null | undefined): string {
  if (!value) return "";
  let key = value.toLocaleLowerCase();
  const foldDigit = (char: string, index: number) => key = key.split(char).join(String(index));
  for (let index = 0; index < 10; index += 1) { foldDigit(MOCK_PERSIAN_DIGITS[index], index); foldDigit(MOCK_ARABIC_DIGITS[index], index); }
  for (const [alphabet, slot] of MOCK_PERSIAN_COLLATION) for (const char of alphabet) key = key.split(char).join(slot);
  for (const mark of ["\u200C", "\u200D", "\u200E", "\u200F", "\uFEFF", "\u064B", "\u064C", "\u064D", "\u064E", "\u064F", "\u0650", "\u0651", "\u0652", "\u0670", "\u0640"]) key = key.split(mark).join("");
  // Mirror the server's leading-noise hygiene: strip punctuation/space runs,
  // and sort nameless or noise-only records last.
  const noise = " \u00B7\u2010\u2011\u2013\u2014_(/\\)\u060C\u061B\u061F.,;:!?*&+#<>=" + '"' + "\u2018\u2019\u201C\u201D-";
  key = key.replace(new RegExp(`^[${noise.replace(/[\\\]\^-]/g, "\\$&")}]+`), "");
  return key || "~";
}

function browseMock(horses: HorseRecord[], params: RegistryBrowseParams) {
  let rows = filterHorses(horses, params.q ?? params.filter ?? params.name ?? "");
  if (params.breed) rows = rows.filter((horse) => horse.breed_desc === params.breed);
  if (params.sex) rows = rows.filter((horse) => horse.sex_desc === params.sex);
  if (params.color) rows = rows.filter((horse) => horse.color_desc === params.color);
  if (params.mainStrain) rows = rows.filter((horse) => horse.main_strain_desc === params.mainStrain);
  if (params.importedFrom) rows = rows.filter((horse) => horse.imported_from_desc === params.importedFrom);
  if (params.isImported !== undefined) rows = rows.filter((horse) => Boolean(horse.is_imported) === Boolean(params.isImported));
  if (params.isSport !== undefined) rows = rows.filter((horse) => Boolean(horse.is_sport) === Boolean(params.isSport));
  if (params.isStallion !== undefined) rows = rows.filter((horse) => Boolean(horse.is_stallion) === Boolean(params.isStallion));
  if (params.hasSportCard !== undefined) rows = rows.filter((horse) => Boolean(horse.has_sport_card) === Boolean(params.hasSportCard));
  if (params.id) rows = rows.filter((horse) => horse.id === Number(params.id));
  const persianNames = params.lang === "fa" || params.lang === "ar";
  const nameKey = (horse: HorseRecord): string =>
    persianNames
      ? mockPersianSortKey(horse.name_native || horse.name_latin)
      : (horse.name_latin || horse.name_native || "").toLocaleLowerCase();
  const sortColumn: ((horse: HorseRecord) => string | number | null) | null =
    params.sort === "name" ? nameKey
    : params.sort === "year" ? (horse) => horse.birth_year ?? -Infinity
    : params.sort === "breed" ? (horse) => horse.breed_desc ?? ""
    : params.sort === "sex" ? (horse) => horse.sex_desc ?? ""
    : params.sort === "place" ? (horse) => horse.birth_place_desc ?? ""
    : null;
  if (sortColumn) {
    rows = [...rows].sort((a, b) => {
      const left = sortColumn(a); const right = sortColumn(b);
      const compared = left === right ? 0 : (left === null || left === undefined ? 1 : right === null || right === undefined ? -1 : left > right ? 1 : -1);
      const direction = params.dir === "desc" ? -1 : 1;
      return compared * direction || a.id - b.id;
    });
  } else if (params.dir === "desc") {
    rows = [...rows].sort((a, b) => b.id - a.id);
  }
  const offset = Math.max(0, params.offset ?? 0);
  const limit = clamp(params.limit ?? 50, 1, 100);
  const page = rows.slice(offset, offset + limit);
  return {
    rows: page,
    total: rows.length,
    limit,
    offset,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    sort: params.sort ?? "id",
    dir: params.dir ?? "asc",
    filter: params.q ?? params.filter ?? "",
  };
}

function requireHorse(horses: HorseRecord[], id: number): HorseRecord {
  const horse = horses.find((item) => item.id === id);
  if (!horse) throw new PlatformClientError(404, "horse_not_found", `Mock horse ${id} not found`);
  return horse;
}

function ancestorTree(horses: HorseRecord[], id: number, depth: number, generation = 0): AncestorPedigreeResponse["tree"] {
  const horse = requireHorse(horses, id);
  const parents = depth > 0
    ? [horse.father_id, horse.mother_id]
        .filter((parentId): parentId is number => Boolean(parentId && horses.some((item) => item.id === parentId)))
        .map((parentId) => ({ ...ancestorTree(horses, parentId, depth - 1, generation + 1), relation: parentId === horse.father_id ? "father" as const : "mother" as const }))
    : [];
  return { horse, relation: "self", generation, repeated: false, cycle: false, ...(parents.length ? { parents } : {}) };
}

function descendantTree(horses: HorseRecord[], id: number, depth: number, generation = 0): AncestorPedigreeResponse["tree"] {
  const horse = requireHorse(horses, id);
  const children = depth > 0
    ? horses.filter((item) => item.father_id === id || item.mother_id === id).map((child) => ({ ...descendantTree(horses, child.id, depth - 1, generation + 1), relation: "offspring" as const }))
    : [];
  return { horse, relation: "self", generation, repeated: false, cycle: false, ...(children.length ? { children } : {}) };
}

function mockPedigreeMetrics(horses: HorseRecord[], id: number, rawDepth: number): PedigreeMetricsResponse {
  const root = requireHorse(horses, id);
  const depth = clamp(rawDepth, 1, 8);
  const byId = new Map(horses.map((horse) => [horse.id, horse]));
  const unique = new Set<number>();
  const occurrences = new Map<number, { count: number; nearestGeneration: number }>();
  const generationKnown = Array.from({ length: depth + 1 }, () => 0);
  const branchCounts = { sire: 0, dam: 0 };
  let known = 0;
  let repeated = 0;
  let cycles = 0;
  let unresolved = 0;
  let maxKnownGeneration = 0;
  const stack: Array<{ horseId: number; generation: number; path: Set<number>; branch: "sire" | "dam" | null }> = [{ horseId: id, generation: 0, path: new Set([id]), branch: null }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.generation >= depth) continue;
    const horse = byId.get(current.horseId);
    if (!horse) continue;
    for (const [parentIndex, parent] of [horse.father_id, horse.mother_id].entries()) {
      if (typeof parent !== "number") continue;
      const parentHorse = byId.get(parent);
      if (!parentHorse) { unresolved += 1; continue; }
      const generation = current.generation + 1;
      const branch = current.branch ?? (parentIndex === 0 ? "sire" : "dam");
      known += 1; branchCounts[branch] += 1;
      generationKnown[generation] = (generationKnown[generation] ?? 0) + 1;
      maxKnownGeneration = Math.max(maxKnownGeneration, generation);
      const occurrence = occurrences.get(parent);
      if (occurrence) { occurrence.count += 1; occurrence.nearestGeneration = Math.min(occurrence.nearestGeneration, generation); repeated += 1; }
      else { occurrences.set(parent, { count: 1, nearestGeneration: generation }); unique.add(parent); }
      if (current.path.has(parent)) { cycles += 1; continue; }
      if (generation < depth) { const path = new Set(current.path); path.add(parent); stack.push({ horseId: parent, generation, path, branch }); }
    }
  }
  const expected = (2 ** (depth + 1)) - 2;
  const branchExpected = (2 ** depth) - 1;
  const percent = (value: number, total: number) => total ? Math.round((value / total) * 10_000) / 100 : 100;
  const topRepeatedAncestors = [...occurrences.entries()].filter(([,value])=>value.count>1).map(([ancestorId,value])=>{
    const horse=byId.get(ancestorId)!; return { horse:{id:horse.id,name_latin:horse.name_latin,name_native:horse.name_native,birth_year:horse.birth_year}, occurrences:value.count, repeatedPositions:value.count-1, nearestGeneration:value.nearestGeneration, positionSharePercent:percent(value.count,known) };
  }).sort((a,b)=>b.occurrences-a.occurrences||a.nearestGeneration-b.nearestGeneration).slice(0,8);
  return {
    horseId: id, depth, status: cycles ? "cycle_detected" : unresolved ? "partial" : "ok",
    expectedAncestorPositions: expected, knownAncestorPositions: known, completenessPercent: percent(known, expected),
    uniqueAncestors: unique.size, repeatedAncestorPositions: repeated, maxKnownGeneration,
    generations: Array.from({ length: depth }, (_, index) => { const generation=index+1; const expectedPositions=2**generation; const knownPositions=generationKnown[generation]??0; return { generation, expectedPositions, knownPositions, completenessPercent: percent(knownPositions,expectedPositions) }; }),
    branches:{
      sire:{relation:"sire",rootHorseId:typeof root.father_id==="number"?root.father_id:null,expectedPositions:branchExpected,knownPositions:branchCounts.sire,completenessPercent:percent(branchCounts.sire,branchExpected)},
      dam:{relation:"dam",rootHorseId:typeof root.mother_id==="number"?root.mother_id:null,expectedPositions:branchExpected,knownPositions:branchCounts.dam,completenessPercent:percent(branchCounts.dam,branchExpected)},
    },
    topRepeatedAncestors,
    integrity: { cycleDetected: cycles > 0, cycleOccurrences: cycles, cycleNodeIds: [], unresolvedParentReferences: unresolved, truncated: false },
    provenance: { method: "pedigree-position-coverage", algorithmVersion: "1.1.0", interpretation: "Structural pedigree coverage; repeated ancestors count in every occupied pedigree position. This is not a genetic coefficient." },
  };
}

function mockDescendantMetrics(horses: HorseRecord[], id: number, rawDepth: number, rawMaxNodes: number): DescendantMetricsResponse {
  requireHorse(horses,id); const depth=clamp(rawDepth,1,6); const maxNodes=clamp(rawMaxNodes,100,1000); const seen=new Set<number>([id]); let frontier=[id]; const generations:Array<{generation:number;count:number}>=[]; let truncated=false;
  for(let generation=1;generation<=depth&&frontier.length;generation+=1){const next=new Set<number>();for(const parentId of frontier){for(const horse of horses){if(horse.father_id!==parentId&&horse.mother_id!==parentId)continue;if(seen.has(horse.id))continue;if(seen.size-1>=maxNodes){truncated=true;continue}seen.add(horse.id);next.add(horse.id)}}generations.push({generation,count:next.size});frontier=[...next]}
  return {horseId:id,depth,directChildren:generations[0]?.count??0,knownDescendants:seen.size-1,maxKnownGeneration:generations.reduce((m,g)=>g.count?g.generation:m,0),generations,truncated,provenance:{method:"bounded-descendant-reach",algorithmVersion:"1.0.0",interpretation:"Unique registered descendants reached within the selected bounded depth; this is a registry reach count, not a genetic influence score."}};
}

function mockRelationship(horses: HorseRecord[], from:number, to:number, rawDepth:number) {
  const depth=clamp(rawDepth,1,16);
  const byId=new Map(horses.map(h=>[h.id,h]));
  const fromHorse=requireHorse(horses,from);
  const toHorse=requireHorse(horses,to);
  const paths=(root:number)=>{
    const out=new Map<number,{depth:number;path:number[]}>([[root,{depth:0,path:[root]}]]);
    const q=[root];
    for(let i=0;i<q.length;i+=1){
      const id=q[i]!; const base=out.get(id)!;
      if(base.depth>=depth)continue;
      const h=byId.get(id); if(!h)continue;
      for(const parent of [h.father_id,h.mother_id]){
        if(typeof parent!=="number"||!byId.has(parent)||out.has(parent))continue;
        out.set(parent,{depth:base.depth+1,path:[...base.path,parent]}); q.push(parent);
      }
    }
    return out;
  };
  const a=paths(from),b=paths(to);
  const allCommon=[...a.keys()]
    .filter(id=>id!==from&&id!==to&&b.has(id))
    .map(id=>{const h=byId.get(id)!;const ap=a.get(id)!,bp=b.get(id)!;return{horse:{id:h.id,name_latin:h.name_latin,name_native:h.name_native,birth_year:h.birth_year},fromDepth:ap.depth,toDepth:bp.depth,totalDepth:ap.depth+bp.depth,fromPath:ap.path,toPath:bp.path}})
    .sort((x,y)=>x.totalDepth-y.totalDepth||Math.max(x.fromDepth,x.toDepth)-Math.max(y.fromDepth,y.toDepth));
  const common=allCommon.slice(0,20);
  let kind:"same_horse"|"direct_ancestor"|"direct_descendant"|"full_sibling"|"half_sibling"|"related"|"no_common_ancestor";
  if(from===to)kind="same_horse";
  else if((b.get(from)?.depth??0)>0)kind="direct_ancestor";
  else if((a.get(to)?.depth??0)>0)kind="direct_descendant";
  else if(typeof fromHorse.father_id==="number"&&fromHorse.father_id===toHorse.father_id&&typeof fromHorse.mother_id==="number"&&fromHorse.mother_id===toHorse.mother_id)kind="full_sibling";
  else if((typeof fromHorse.father_id==="number"&&fromHorse.father_id===toHorse.father_id)||(typeof fromHorse.mother_id==="number"&&fromHorse.mother_id===toHorse.mother_id))kind="half_sibling";
  else kind=allCommon.length?"related":"no_common_ancestor";
  const closest=common[0]??null;
  return {from,to,commonAncestors:common,summary:{kind,commonAncestorCount:allCommon.length,closestTotalDepth:closest?.totalDepth??null,fromDepth:closest?.fromDepth??null,toDepth:closest?.toDepth??null,integrity:{cycleDetected:false,truncated:false}}};
}

function facets(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}


function mockPathToAncestor(horses: HorseRecord[], from: number, ancestor: number, depth: number): number[] | null {
  const byId=new Map(horses.map(h=>[h.id,h])); const stack:Array<{id:number;path:number[]}>= [{id:from,path:[from]}];
  while(stack.length){const cur=stack.pop()!;if(cur.id===ancestor)return cur.path;if(cur.path.length-1>=depth)continue;const h=byId.get(cur.id);if(!h)continue;for(const p of [h.mother_id,h.father_id])if(typeof p==="number"&&!cur.path.includes(p))stack.push({id:p,path:[...cur.path,p]});}
  return null;
}
function mockBranch(horses: HorseRecord[], rootId:number, path:number[]): "sire"|"dam"|null { const root=horses.find(h=>h.id===rootId); return path[1]===root?.father_id?"sire":path[1]===root?.mother_id?"dam":null; }
function mockCompletenessSection(horses: HorseRecord[], named: number, both: number, anyParent: number): RegistryCompletenessSection {
  const total = horses.length;
  const pc2 = (n: number) => (total ? Math.round(n / total * 10000) / 100 : 0);
  const component = (key: string, label: string, covered: number, missingDefinition: string) => ({ key, label, coveredRecords: covered, totalRecords: total, coveragePercent: pc2(covered), missingDefinition });
  const measure = (key: string, label: string, covered: number, missingDefinition: string, components: RegistryCompletenessComponent[]) => ({ key, label, totalRecords: total, coveredRecords: covered, coveragePercent: pc2(covered), missingDefinition, components });
  const withName = horses.filter(h => (h.name_latin || "").trim() !== "" || (h.name_native || "").trim() !== "").length;
  return {
    snapshotTime: "2026-08-27T00:00:00Z",
    denominatorDefinition: "Every measure uses the same denominator: all non-deleted canonical horse records in this database revision.",
    permissionScope: "Computed over canonical registry records readable through the public registry surface; private, owner-scoped or draft rows are not part of these denominators.",
    interpretation: "These are recorded-data coverage measures. They describe which share of records carry recorded values or linked rows; they never assert verification, authenticity, or that the registry itself is complete.",
    measures: [
      measure("identity", "Identity field coverage", withName, "A record counts as covered only when the field carries a non-blank value that is not a dash placeholder. The identity measure itself requires a meaningful recorded name (Latin or native).", [
        component("name", "Meaningful name (Latin or native)", withName, "Latin or native name is non-blank."),
        component("nativeName", "Native name", named, "Native name is non-blank."),
        component("breed", "Recorded breed", horses.filter(h => (h.breed_desc || "").trim() !== "").length, "Breed description is non-blank."),
        component("sex", "Recorded sex", horses.filter(h => (h.sex_desc || "").trim() !== "").length, "Sex description is non-blank."),
      ]),
      measure("ancestry", "Recorded ancestry coverage", anyParent, "A record counts as covered when at least one parent is recorded.", [
        component("anyParent", "At least one recorded parent", anyParent, "Father or mother is recorded."),
        component("bothParents", "Both parents recorded", both, "Father and mother are both recorded."),
      ]),
      measure("evidence", "Linked evidence coverage", 0, "A record counts as covered when at least one linked evidence row exists. The mock dataset carries no evidence rows, so this measure is honestly zero.", [
        component("competitionResults", "Competition results", 0, "At least one competition result row is linked."),
        component("geneticTests", "Genetic tests", 0, "At least one genetic test row is linked."),
        component("liveIdentifiers", "Live external identifiers", 0, "At least one horse identifier with status='live' is linked."),
        component("activeAttestations", "Active attestations", 0, "At least one attestation with status='active' is linked."),
      ]),
      measure("media", "Media coverage", 0, "A record counts as covered when at least one media row is linked. The mock dataset carries no media rows, so this measure is honestly zero.", [
        component("photo", "Photo media", 0, "At least one photo media row is linked."),
        component("document", "Document media", 0, "At least one document media row is linked."),
      ]),
      measure("activity", "Recorded activity coverage", horses.length, "A record counts as covered when at least one recorded activity/lifecycle flag is set; mock horses are all marked active.", [
        component("active", "Marked active", horses.length, "is_active flag is set."),
        component("deceased", "Marked deceased", 0, "is_dead flag is set."),
        component("imported", "Marked imported", 0, "is_imported flag is set."),
      ]),
    ],
  };
}

function mockRegistryAnalytics(horses: HorseRecord[]):RegistryAnalyticsResponse{
  const counts=new Map<number,number>();for(const h of horses){for(const p of [h.father_id,h.mother_id])if(typeof p==="number")counts.set(p,(counts.get(p)||0)+1)}
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([id,count])=>{const h=horses.find(x=>x.id===id);return{id,name_latin:h?.name_latin,name_native:h?.name_native,birth_year:h?.birth_year,sex_desc:h?.sex_desc,count}});
  const both=horses.filter(h=>h.father_id&&h.mother_id).length, one=horses.filter(h=>Boolean(h.father_id)!==Boolean(h.mother_id)).length, none=Math.max(0,horses.length-both-one);const pc=(n:number)=>horses.length?Math.round(n/horses.length*10000)/100:0;
  const field=(key:string,count:number)=>({key,count,percent:pc(count)});const named=horses.filter(h=>h.name_native).length,registered=horses.filter(h=>h.register_no).length,years=horses.filter(h=>h.birth_year).length,breed=horses.filter(h=>h.breed_desc).length,sex=horses.filter(h=>h.sex_desc).length,places=horses.filter(h=>h.birth_place_desc).length;
  const hist=[{label:"0",count:Math.max(0,horses.length-ranked.length)},{label:"1",count:ranked.filter(x=>x.count===1).length},{label:"2–4",count:ranked.filter(x=>x.count>=2&&x.count<=4).length},{label:"5+",count:ranked.filter(x=>x.count>=5).length}];
  const mockPeople=[{id:1,name_latin:"Demo Breeder",name_native:"پرورش‌دهنده نمونه",count:Math.max(1,Math.round(horses.length*.4))}];
  return {schemaVersion:"2.2.0",algorithmVersion:"2.2.0",generatedAt:"2026-08-27T00:00:00Z",sourceRevision:"mock-v0.41.2",horseCount:horses.length,birthYears:[],birthDecades:[],birthYearSummary:{earliest:null,latest:null,median:null,peakYear:null,peakYearCount:0},sexDistribution:facets(horses.map(h=>h.sex_desc)).map(x=>({label:x.value,count:x.count})),topBreeds:facets(horses.map(h=>h.breed_desc)).map(x=>({label:x.value,count:x.count})),topBirthPlaces:facets(horses.map(h=>h.birth_place_desc)).map(x=>({label:x.value,count:x.count})),topColors:facets(horses.map(h=>h.color_desc)).map(x=>({label:x.value,count:x.count})),topMainStrains:[],parentage:{bothParents:both,oneParent:one,noParents:none,bothParentsPercent:pc(both),oneParentPercent:pc(one),noParentsPercent:pc(none)},activity:{active:{count:horses.length,percent:100},deceased:{count:0,percent:0},imported:{count:0,percent:0},stallions:{count:0,percent:0},sport:{count:0,percent:0},sportCard:{count:0,percent:0}},dataCoverage:{fields:[field("nativeName",named),field("registration",registered),field("birthYear",years),field("birthPlace",places),field("breed",breed),field("sex",sex),field("bothParents",both),field("anyParent",both+one),field("owner",Math.round(horses.length*.6)),field("breeder",Math.round(horses.length*.55))],byBirthDecade:[]},completeness:mockCompletenessSection(horses,named,both,both+one),progeny:{percentiles:{p50:0,p90:1,p95:1,p99:1,max:ranked[0]?.count??0},histogram:hist,horsesWithRecordedOffspring:ranked.length,topParents:ranked,topSires:ranked,topDams:ranked},people:{peopleCount:1,ownerCount:1,breederCount:1,importerCount:0,passportReceiverCount:0,horsesWithOwner:Math.round(horses.length*.6),horsesWithBreeder:Math.round(horses.length*.55),horsesWithImporter:0,horsesWithPassportReceiver:0,topOwners:mockPeople,topBreeders:mockPeople,topImporters:[],topPassportReceivers:[]},quality:{openIssues:0,severities:[],topIssueCodes:[]},pedigree:{analyticsEligibleHorseCount:horses.length,cycleNodeCount:0,cycleContaminatedHorseCount:0,completeness:[2,4,6,8].map(depth=>({depth,averagePercent:Math.max(5,50-depth*4),medianPercent:Math.max(3,45-depth*4),fullyRecordedCount:0,halfOrBetterCount:Math.round(horses.length*.4),eligibleHorseCount:horses.length})),topRepresentedAncestorsDepth4:ranked,representationInterpretation:"Mock structural representation.",cyclePolicy:"Mock pedigrees contain no cycle contamination."},rawBirthYears:[],premium:{analyticalValidity:{birthYear:{grade:"high",eligibleRecords:years,totalRecords:horses.length,coveragePercent:pc(years),exclusions:[],interpretation:"Mock analytical cohort."},pedigree:{grade:"high",eligibleRecords:horses.length,totalRecords:horses.length,coveragePercent:100,exclusions:[],interpretation:"Mock cycle-clean pedigrees."},meaningfulDnaRecords:0,parentYearConflictCount:0,cycleIssueCount:0},parentConcentration:{sires:{assignments:ranked.reduce((a,x)=>a+x.count,0),distinctParents:ranked.length,top1SharePercent:0,top5SharePercent:0,top10SharePercent:0,hhi:0,gini:0,shannonEntropy:0,entropyEffectiveParentCount:ranked.length,inverseSimpsonEffectiveParentCount:ranked.length},dams:{assignments:ranked.reduce((a,x)=>a+x.count,0),distinctParents:ranked.length,top1SharePercent:0,top5SharePercent:0,top10SharePercent:0,hhi:0,gini:0,shannonEntropy:0,entropyEffectiveParentCount:ranked.length,inverseSimpsonEffectiveParentCount:ranked.length},byBirthDecade:[]},generationIntervals:{plausibleAgeRangeYears:[2,35],sireToOffspring:{count:0,meanYears:null,medianYears:null,p10Years:null,p90Years:null},damToOffspring:{count:0,meanYears:null,medianYears:null,p10Years:null,p90Years:null},sireToSon:{count:0,meanYears:null,medianYears:null,p10Years:null,p90Years:null},sireToDaughter:{count:0,meanYears:null,medianYears:null,p10Years:null,p90Years:null},damToSon:{count:0,meanYears:null,medianYears:null,p10Years:null,p90Years:null},damToDaughter:{count:0,meanYears:null,medianYears:null,p10Years:null,p90Years:null},byOffspringBirthDecade:[]},pedigreeDiversity:{medianEquivalentCompleteGenerations:2,averageEquivalentCompleteGenerations:2,eligibleHorseCount:horses.length,depth:8,interpretation:"Mock pedigree diversity."}},provenance:{interpretation:"Mock disposable analytics for frontend development; never canonical truth.",canonical:false}};
}


function mockLanguageStatus(title: string, body: string): ContentLanguageStatus {
  const hasTitle = Boolean(title && title.trim());
  const hasBody = Boolean(body && body.trim());
  if (hasTitle && hasBody) return "complete";
  if (hasTitle || hasBody) return "partial";
  return "missing";
}
function mockMediaRights(url: string | null | undefined, credit: string | null | undefined, source: string | null | undefined): ContentMediaRights {
  if (!url || !url.trim()) return "no_media";
  return (credit && credit.trim()) || (source && source.trim()) ? "attributed" : "unattributed";
}
function mockContentPost(input: ContentPostInput, index: number): ContentPost {
  const now = new Date().toISOString();
  return {
    id: `mock-post-${index}`, slug: `mock-post-${index}`, ...input,
    title_ar: input.title_ar ?? "", title_zh: input.title_zh ?? "",
    summary_ar: input.summary_ar ?? "", summary_zh: input.summary_zh ?? "",
    body_ar: input.body_ar ?? "", body_zh: input.body_zh ?? "",
    ai_grounding: Boolean(input.ai_grounding), created_at: now, updated_at: now,
    published_at: input.status === "published" ? now : null, row_version: 1,
    author_user_id: "mock-user", author_label: "Demo User",
    language_completeness: { en: mockLanguageStatus(input.title_en, input.body_en), fa: mockLanguageStatus(input.title_fa, input.body_fa), ar: mockLanguageStatus(input.title_ar ?? "", input.body_ar ?? ""), zh: mockLanguageStatus(input.title_zh ?? "", input.body_zh ?? "") },
    media_publication_rights: mockMediaRights(input.cover_image_url, input.cover_image_credit, input.cover_image_source_url),
  };
}
function mockRecordRevision(store: Map<string, ContentPostRevision[]>, post: ContentPost, cause: ContentRevisionCause, fromStatus: ContentPostStatus): void {
  const list = store.get(post.id) ?? [];
  list.unshift({ id: `mock-rev-${post.id}-${post.row_version}`, post_id: post.id, revision_no: post.row_version, cause, from_status: fromStatus, to_status: post.status, actor_user_id: "mock-user", actor_label: "Demo User", created_at: new Date().toISOString(), post: { ...post } });
  store.set(post.id, list);
}
