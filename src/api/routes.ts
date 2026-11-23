import {horseSourceDetails} from './modules/sourceDetails';
import { z } from "zod";
import { routeMfa } from "../auth/mfa";
import { guardMfaRequest, mfaPolicy, withMfaPolicy } from "../auth/mfaGuard";
import { horseGeneticAccess, geneticReviewHistory } from "./modules/genetics";
import { routeRequestEvidence } from "./modules/requestEvidence";
import { routeEquineCare } from "./modules/equineCare";
import { routeRegistryMetadata } from "./modules/registryMetadata";
import { registrationDetailCreateStatements, validateRegistrationDetails } from "../registry/registrationDetails";
import { isDemoAdminLoginAvailable } from "../auth/publicAuthPolicy";
import { requireSameOriginMutation } from "../security/origin";
import { datasetClassification } from "../registry/datasetProvenance";
import { error, json, readJson, requestId, HttpError } from "./http";
import { verifyPassword } from "../auth/password";
import { clearSessionCookie, createSession, getAuth, isSecureRequest, sessionCookie } from "../auth/session";
import { requireAuth, requireCsrf } from "../auth/guards";
import { searchHorses } from "../search/service";
import { processSearchReindexQueue, refreshHorseSearch } from "../search/refresh";
import { abortCanonicalMutation, canonicalMutationIntentStatement, finalizeCanonicalMutation, markMutationAuditComplete, reconcilePendingMutationAudits, recordMutationPendingError } from "../audit/mutationJournal";
import { canonicalJson } from "../marketplace/commands";
import { loadAncestors, loadDescendants } from "../pedigree/graph";
import { analyzeRelationship } from "../pedigree/relationship";
import { calculatePedigreeCoefficient, calculateRelationshipCoefficient } from "../pedigree/coefficients";
import { buildHorseInsights } from "../pedigree/insights";
import { analyzeBreedingPairing, optimizeBreedingCandidates } from "../pedigree/breeding";
import { calculateDescendantReach, calculatePedigreeCoverage, collectAncestorPathSets, loadAncestorGraph, pedigreePathBranch } from "../pedigree/engine";
import { validateParentAssignment, type ParentAssignmentIssue } from "../pedigree/integrity";
import type { HorseRow, PublicHorseProfileRow, PublicHorseRow, UserRow } from "../db/types";
import { ADMIN_HORSE_DETAIL_COLUMNS, PUBLIC_HORSE_COLUMNS_H, PUBLIC_HORSE_PROFILE_COLUMNS_H } from "../db/types";
import { normalizePublicHorseRecord } from "../db/publicProjection";
import { isSupabaseD1Database, isSupabaseFullModeDatabase } from "../db/supabaseCompat";
import { compileRegistryQuery, d1ContainsLikePattern, parseBoundedIntegerParam } from "../registry/query";
import { capabilitiesForRole } from "../auth/capabilities";
import { requirePermission } from "../auth/guards";
import { assertJsonEvidenceComplexity } from "../security/jsonComplexity";
import { listPublicContent, getPublicContent, listPublicComments, createPublicComment, listAdminComments, moderateAdminComment, listAdminContent, createAdminContent, updateAdminContent, generateAdminContent, previewAdminContent, publishAdminContent, retractAdminContent, listAdminContentRevisions } from "../content/api";
import { CHANGE_REQUEST_ITEMS_MAX, PLATFORM_APPLICATION_VERSION, PLATFORM_CONTRACT_VERSION, REGISTRY_EXPORT_ROWS_MAX, buildPlatformFeatureCatalog, type PlatformCapabilities } from "../contracts/platform";
import { CHANGE_REQUEST_APPLICABLE_FIELDS, validateProposedChangeItems, type ProposedChangeItem } from "./changeRequestValidation";
import { buildHorseCreateSchema, buildHorseUpdateSchema } from "../registry/validation";
import { MutationPlanError, buildCanonicalHorseUpdateStatements, planHorseMutation, runGuardedHorseBatch, staleBaseFieldDifferences } from "../registry/mutations";
import { HORSE_UPDATE_PARENTAGE_GUARD_SQL } from "../registry/mutationStatements";
import { archiveIdentifierStatement, identifierStatementsForHorseCreate, identifierStatementsForHorseChange, identifierTableReady } from "../registry/identifiers";
import { protectedIdentityMergeGuard } from "../registry/protectedIdentity";
import { mutationObservabilityBlock } from "../registry/impact";
import { routeAiApi } from "../ai/application/api";
import { getAiAssistantStatus } from "../ai/application/assistantService";
import { mediaProxyHandler } from "./mediaProxy";
import { listCompetitions, competitionDetail, horseCompetitionHistory, adminCreateCompetition, adminAddResults, adminCreateResultVersioned, adminUpdateResult, adminUpdateCompetition } from "./modules/competitions";
import { updateInquiryStatus, listListings, listingDetail, createListing, updateListingStatus, renewListing, createInquiry, myListings, sentInquiries, confirmListingAvailability, adminSponsorListing, inquiryConversation, replyToInquiry, buyerCloseInquiry, myWatchlist, watchlistAdd, watchlistRemove, myBlocks, blockCreate, blockRemove, attachListingDossier } from "./modules/marketplace";
import { reportCase, moderationQueue, assignCase, decideCase, appealCase, decideAppeal, caseDetail, setCaseStanding, myAbuseStanding } from "./modules/moderation";
import { billingCatalog, adminCreatePrice, createOrder, myOrders, orderDetail, cancelOrder, startOrderPayment, paymentCallback, verifyPaymentAttempt, myEntitlements, adminRefundOrder, adminReconciliation, adminAttemptInquiry, adminResolveReviewCase, requestOrderRefund, myRefunds, adminApproveRefund, adminRecordRefundOutcome, adminProposeRefundAllocation, adminApproveRefundAllocation, adminRefundReviewDetail, adminResolveRefundReview, publicOffers } from "./modules/billing";
import { horseRacing, racesList, raceDetail } from "./modules/racing";
import { demoPaymentSessionStatus, completeDemoPayment } from "./modules/demoPayments";
import { adminDemoDeliveries, adminSimulateDemoDelivery } from "./modules/demoNotifications";
import { listHorseMedia, uploadHorseMedia, serveMediaFile, deleteHorseMedia, verifyHorseMedia, mintMediaAccess, revokeMediaAccess, setMediaPublication, adminMediaQuarantine } from "./modules/media";
import { horseGenetics, adminAddGeneticTest, horseBreedings, adminAddBreedingRecord, adminCorrectBreedingRecord, recordGeneticInterpretation, adminSetGeneticTestDisclosure } from "./modules/genetics";
import { projectArabianPairing } from "../genetics/pairingProjection";
import { reviewPairingEvidence } from "./modules/pairingEvidence";
import { adminCreateImportSource, adminListImportSources, adminStageImportBatch, adminApplyImportBatch, adminImportBatchStatus, adminMergeHorses, adminUnmergeHorses, adminImportBatchPreview, adminImportReviewReport, adminReviewImportRow, adminMergePreview } from "./modules/imports";
import { adminCreateProfessionalGrant, adminProfessionalGrants, adminRevokeProfessionalGrant } from "./modules/professionalGrants";
import { adminGetGeneticTestDisclosureHistory } from "./modules/genetics";
import { adminDuplicateCandidates, adminMergeHistory } from "./modules/duplicates";
import { adminQualityQueue, adminQualityIssueDetail, adminAssignQualityIssue, adminResolveQualityIssue, adminReopenQualityIssue, adminQualityIssueNote, adminBulkResolveQualityIssues, adminQualityScan } from "./modules/qualityQueue";
import { publicEvidenceSummary } from "./modules/evidenceSummary";
import { exactIdentifierLookup } from "./modules/exactIdentifierLookup";
import { listDirectoryPersons, directoryPersonDetail, listDirectoryOrganizations, createDirectoryClaim, myDirectoryClaims, reviewDirectoryClaim, updatePersonDirectoryProfile, getManagedPersonProfile, addPersonCredential, reviewPersonCredential } from "./modules/directory";
import { getPublicOrganization, getManagedOrganization, getOrganizationStaff, getMyStaffInvites, getOrganizationInbox, updateOrganizationProfile, createStaffInvite, respondToStaffInvite, updateStaffRole, revokeStaff, appointOrganizationOfficial, addOrganizationCredential, reviewOrganizationCredentialEndpoint } from "./modules/organizations";
import { getCredentialReviewQueue, getCredentialBadge, submitRenewal, reviewRenewal, runExpiryScan, myExpiringCredentials } from "./modules/credentialWorkflows";
import { createServiceRequest, myServiceRequests, providerServiceRequests, serviceRequestDetail, transitionServiceRequest, blockProvider, reportServiceRequest, providerResponseStats, withdrawContactConsent, providerBlockRequester, redactMyNote, exportMyServiceData, servicePrivacyPolicy, reconcileServiceIntent, adminPlaceServiceRequestHold, adminReleaseServiceRequestHold, fileBlockComplaint, adminBlockComplaintQueue, adminResolveBlockComplaint, adminListRetentionPolicies, adminApproveRetentionPolicy, fileSubjectRedactionRequest, adminRedactionRequestQueue, adminDecideRedactionRequest, adminFulfillRedactionRequest } from "./modules/serviceRequests";
import { myNotifications, myNotificationPreferences, updateNotificationPreferences, adminOutboxQueue, adminRetryOutboxEvent, notificationCallback } from "../notifications/outbox";
import { createWorkspace, myWorkspaces, workspaceDashboard, addWorkspaceHorse, bulkWorkspaceHorses, removeWorkspaceHorse, assignWorkspaceStaff, revokeWorkspaceStaff, createWorkspaceTask, listWorkspaceTasks, completeWorkspaceTask, reopenWorkspaceTask, exportWorkspaceCsv, deleteWorkspace, inviteWorkspaceStaff, myWorkspaceInvites, respondWorkspaceInvite, revokeWorkspaceInvite, listWorkspaceDocuments, createWorkspaceDocument, updateWorkspaceDocument, archiveWorkspaceDocument, reassignWorkspaceTask, importWorkspaceTasks } from "./modules/workspaces";
import { createDossier, myDossiers, createDossierLink, revokeDossierLink, revokeDossier, viewDossierByToken } from "./modules/dossiers";
import { register, verifyEmail, requestOtp, verifyOtp } from "./modules/authExt";
import { requestPasswordReset, confirmPasswordReset, changePassword, revokeOtherSessions } from "../auth/recovery";
import { duplicateCheck, registryCertificateSvg, recordCertificateIssuance, verifyCertificateCode } from "./modules/registryExtras";
import { createAttestation, createIssuer, grantIssuerMembership, listHorseAttestations, listIssuers, revokeAttestation, revokeIssuerMembership, supersedeAttestation, grantIssuerScopeHandler, suspendIssuerScopeHandler, resumeIssuerScopeHandler, revokeIssuerScopeHandler, transitionIssuerStatusHandler, trustQueueHandler, trustLabelsHandler, verifyAttestationHandler, attestationSnapshotHandler } from "../trust/attestations";
import { claimApprovalGrantStatement, horseActionsForViewer, requireHorseAction, revokeHorseGrant, revokeOrganizationMembership } from "../access/horseAccess";
import {
  buildSubmissionApprovalStatements,
  HorseSubmissionSchema,
  isIdempotencyViolation,
  parseStoredSubmission,
  resolveIdempotencyReplay,
  submissionReviewStatus,
  SUBMISSION_NEEDS_CHANGES_SQL,
  validateSubmissionReferences,
  type HorseSubmission,
} from "../registry/submissions";
import { parseRegistryDate, type RegistryDate } from "../registry/dates";
import {
  detectOwnershipOverlaps,
  lifecycleEventInsertStatement,
  ownershipPeriodInsertStatement,
  ownershipShareSumExceeded,
  PARENT_CORRECTION_SCHEMA as PARENT_CORRECTION_INPUT_SCHEMA,
  parentCorrectionAutoSummary,
  parseStoredParentCorrection,
  validateLifecycleEventInput,
  validateOwnershipPeriodInput,
  validateParentCorrectionInput,
  type OwnershipPeriodRow,
  type ParentCorrection,
} from "../registry/relations";
import { revokeExtract, verifyExtractEndpoint } from "../trust/extracts";

// R117-20: cohesive handler families extracted to modules (dispatch + order unchanged).
import { assertNoLiveHorseDuplicates, assertValidParentAssignment, settleWorkflowMutation, settleCanonicalHorseMutation, audit } from "./modules/registryShared";
import { enforceRegistryRules, adminListRegistryRules, adminCreateRegistryRule, adminRegistryRuleDetail, adminPatchRegistryRule, adminTransitionRegistryRule, adminPreviewRegistryRule } from "./modules/registryRules";
import { adminHorseFieldClaims, adminSelectFieldClaim, adminRejectFieldClaim, adminRevertFieldClaimDecision, adminFieldClaimQueue } from "./modules/fieldClaims";
import { buildRuleSubject } from "../registry/rulesEngine";
import { createClaim, myClaims, adminClaims, horseActionsEndpoint, myGrants, adminGrants, adminRevokeGrant, adminRevokeOrgMembership, reviewClaim } from "./modules/claims";
import { createChangeRequest, submitChangeRequest, withdrawChangeRequest, editChangeRequest, myChangeRequests, adminChangeRequests, reviewChangeRequest } from "./modules/changeRequests";

const LoginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(512) });
const BreedingOptimizerSchema = z.object({
  fixedHorseId:z.number().int().positive(),
  fixedRole:z.enum(["sire","dam"]),
  candidateIds:z.array(z.number().int().positive()).min(1).max(12),
  depth:z.number().int().min(2).max(12).optional(),
  objectives:z.object({
    lowProjectedCoiWeight:z.number().min(0).max(1).optional(),
    ancestorDiversityWeight:z.number().min(0).max(1).optional(),
    lowConcentrationWeight:z.number().min(0).max(1).optional(),
    candidateDiversityPreservationWeight:z.number().min(0).max(1).optional(),
    coiCeilingPercent:z.number().min(.1).max(50).optional(),
    avoidAncestorIds:z.array(z.number().int().positive()).max(20).optional(),
    excludeAvoidedAncestors:z.boolean().optional(),
  }).optional(),
});
// T07: the horse field rules live in ONE shared module now — direct edits,
// reviewed updates and creates all parse through src/registry/validation.ts.
const HorseCreateSchema = buildHorseCreateSchema();
const HorseUpdateSchema = buildHorseUpdateSchema();
const BASE_PLATFORM_CAPABILITIES: PlatformCapabilities = {
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
  // R76 truth-in-advertising: these three module families have shipped real
  // endpoints + data for every frontend (media upload/verify, federation
  // competitions, canonical marketplace) — advertising them as unavailable
  // made live UIs render "reserved/dormant" placeholders for working features.
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

export async function routeApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const originalDb = env.DB;
  const authSharesDatabase = !env.AUTH_DB || env.AUTH_DB === originalDb;
  const aiSharesDatabase = !env.AI_DB || env.AI_DB === originalDb;
  env = { ...env, DB: withMfaPolicy(originalDb, mfaPolicy(env.MFA_MODE)) };
  if (authSharesDatabase) env.AUTH_DB = env.DB;
  const mfaResponse = await routeMfa(request, env);
  if (mfaResponse) return mfaResponse;
  env = { ...env, DB: await guardMfaRequest(request, env.DB, env.SESSION_COOKIE_NAME) };
  if (authSharesDatabase) env.AUTH_DB = env.DB;
  if (aiSharesDatabase) env.AI_DB = env.DB;
  if (path.startsWith("/api/admin/ai/") && (!authSharesDatabase || !aiSharesDatabase)) {
    throw new HttpError(503, "mfa_unified_authority_required", "AI administration requires the configured shared authentication and state database");
  }

  const aiResponse = await routeAiApi(request, env, url);
  if (aiResponse) return aiResponse;

  const careResponse = await routeEquineCare(request, env, url);
  if (careResponse) return careResponse;

  const metadataResponse = await routeRegistryMetadata(request, env, url);
  if (metadataResponse) return metadataResponse;

  if (path === "/api/health" && method === "GET") {
    const runtime = await loadRuntimeSnapshot(env.DB);
    // Prefer the precomputed snapshot: it already carries the authoritative
    // active-horse and search-row counts, so a healthy snapshot costs ZERO
    // scans. Fall back to the memoised pair only when the snapshot is stale.
    const snapHorses = runtime.currentHorseCount ?? runtime.summary?.stats?.horses;
    const snapSearch = runtime.summary?.stats?.searchRows;
    const haveSnap = !runtime.stale && Number.isSafeInteger(snapHorses) && Number.isSafeInteger(snapSearch);
    const [{ horses: horseCount, searchRows: indexedCount }, users] = await Promise.all([
      haveSnap ? Promise.resolve({ horses: Number(snapHorses), searchRows: Number(snapSearch) }) : counterPair(env.DB),
      activeUserCountCached(env.DB),
    ]);
    return json(publicHealthSnapshot(env, runtime, horseCount, indexedCount, users));
  }

  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/demo-admin" && method === "POST") return demoAdminLogin(request, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (path === "/api/auth/me" && method === "GET") return me(request, env);
  if (path === "/api/auth/register" && method === "POST") return register(request, env);
  if (path === "/api/auth/verify-email" && method === "GET") return verifyEmail(request, env);
  if (path === "/api/auth/verify-email" && method === "POST") return verifyEmail(request, env);
  if (path === "/api/auth/otp/request" && method === "POST") return requestOtp(request, env);
  if (path === "/api/auth/otp/verify" && method === "POST") return verifyOtp(request, env);
  // Master-Ai plan T13: delivery-and-recovery family. Rate limiting is applied
  // centrally by the Worker entrypoint (classify.ts puts these in the auth
  // class + per-account protection), exactly like every other /api route.
  if (path === "/api/auth/recover/request" && method === "POST") {
    return requestPasswordReset(env.DB, env as unknown as Record<string, unknown>, request);
  }
  if (path === "/api/auth/recover/confirm" && method === "POST") {
    return confirmPasswordReset(env.DB, env as unknown as Record<string, unknown>, request);
  }
  if (path === "/api/auth/change-password" && method === "POST") {
    const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
    requireCsrf(request, auth);
    return changePassword(env.DB, request, auth);
  }
  if (path === "/api/auth/sessions/revoke" && method === "POST") {
    const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
    requireCsrf(request, auth);
    return revokeOtherSessions(env.DB, auth);
  }

  if (path === "/api/competitions" && method === "GET") return listCompetitions(env.DB, url);
  const competitionDetailMatch = path.match(/^\/api\/competitions\/(\d+)$/);
  if (competitionDetailMatch && method === "GET") return competitionDetail(env.DB, Number(competitionDetailMatch[1]), url);
  if (path === "/api/admin/competitions" && method === "POST") return adminCreateCompetition(request, env);
  const competitionResultsMatch = path.match(/^\/api\/admin\/competitions\/(\d+)\/results$/);
  if (competitionResultsMatch && method === "POST") return adminAddResults(request, env, Number(competitionResultsMatch[1]));
  // R114-02 (Master AI R113 handoff D18): versioned competition editing —
  // create-only legacy above; these three carry expected_version + receipts.
  const competitionResultsVersionedMatch = path.match(/^\/api\/admin\/competitions\/(\d+)\/results\/versioned$/);
  if (competitionResultsVersionedMatch && method === "POST") return adminCreateResultVersioned(request, env, Number(competitionResultsVersionedMatch[1]));
  const competitionResultVersionMatch = path.match(/^\/api\/admin\/competitions\/(\d+)\/results\/(\d+)\/version$/);
  if (competitionResultVersionMatch && method === "POST") return adminUpdateResult(request, env, Number(competitionResultVersionMatch[1]), Number(competitionResultVersionMatch[2]));
  const competitionVersionMatch = path.match(/^\/api\/admin\/competitions\/(\d+)\/version$/);
  if (competitionVersionMatch && method === "POST") return adminUpdateCompetition(request, env, Number(competitionVersionMatch[1]));

  if (path === "/api/market/listings" && method === "GET") return listListings(env.DB, url);
  if (path === "/api/market/listings" && method === "POST") return createListing(request, env);
  if (path === "/api/market/mine" && method === "GET") return myListings(request, env);
  // R117-15: the buyer-owned sent-inquiry inbox — a bounded paginated query,
  // literal-path matched BEFORE the inquiry-id regexes below.
  if (path === "/api/market/inquiries/sent" && method === "GET") return sentInquiries(request, env);
  const marketDetailMatch = path.match(/^\/api\/market\/listings\/([a-f0-9-]{36})$/);
  if (marketDetailMatch && method === "GET") {
    // R59: drafts and hidden prices are filtered by viewer identity.
    const viewer = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
    return listingDetail(env.DB, marketDetailMatch[1], url, viewer);
  }
  if (path === "/api/verify" && method === "GET") return verifyCertificateCode(env.DB, url);

  // Master-Ai plan T05/T06: issuer attestations + versioned registry extracts.
  if (path === "/api/extract/verify" && method === "GET") return verifyExtractEndpoint(env.DB, url);
  if (path === "/api/issuers" && method === "GET") return listIssuers(env.DB);
  if (path === "/api/admin/issuers" && method === "POST") return createIssuer(request, env);
  // R98-N04: structured issuer scopes, issuer status transitions, operator queue, trust labels.
  if (path === "/api/trust/labels" && method === "GET") return trustLabelsHandler();
  if (path === "/api/admin/trust/queue" && method === "GET") return trustQueueHandler(request, env);
  const issuerScopeMatch = path.match(/^\/api\/admin\/issuers\/([a-f0-9-]{36})\/scopes$/);
  if (issuerScopeMatch && method === "POST") return grantIssuerScopeHandler(request, env, issuerScopeMatch[1]);
  const scopeSuspendMatch = path.match(/^\/api\/issuer-scopes\/([a-f0-9-]{36})\/suspend$/);
  if (scopeSuspendMatch && method === "POST") return suspendIssuerScopeHandler(request, env, scopeSuspendMatch[1]);
  const scopeResumeMatch = path.match(/^\/api\/issuer-scopes\/([a-f0-9-]{36})\/resume$/);
  if (scopeResumeMatch && method === "POST") return resumeIssuerScopeHandler(request, env, scopeResumeMatch[1]);
  const scopeRevokeMatch = path.match(/^\/api\/issuer-scopes\/([a-f0-9-]{36})\/revoke$/);
  if (scopeRevokeMatch && method === "POST") return revokeIssuerScopeHandler(request, env, scopeRevokeMatch[1]);
  const issuerStatusMatch = path.match(/^\/api\/admin\/issuers\/([a-f0-9-]{36})\/status$/);
  if (issuerStatusMatch && method === "POST") return transitionIssuerStatusHandler(request, env, issuerStatusMatch[1]);
  // R98-N05: public attestation verification + private snapshot review.
  const attestationVerifyMatch = path.match(/^\/api\/attestations\/([a-f0-9-]{36})\/verify$/);
  if (attestationVerifyMatch && method === "GET") return verifyAttestationHandler(env.DB, attestationVerifyMatch[1]);
  const attestationSnapshotMatch = path.match(/^\/api\/admin\/attestations\/([a-f0-9-]{36})\/snapshot$/);
  if (attestationSnapshotMatch && method === "GET") return attestationSnapshotHandler(request, env, attestationSnapshotMatch[1]);
  const issuerMembershipMatch = path.match(/^\/api\/admin\/issuers\/([a-f0-9-]{36})\/memberships$/);
  if (issuerMembershipMatch && method === "POST") return grantIssuerMembership(request, env, issuerMembershipMatch[1]);
  const membershipRevokeMatch = path.match(/^\/api\/issuer-memberships\/([a-f0-9-]{36})\/revoke$/);
  if (membershipRevokeMatch && method === "POST") return revokeIssuerMembership(request, env, membershipRevokeMatch[1]);
  const issuerAttestationMatch = path.match(/^\/api\/issuers\/([a-f0-9-]{36})\/attestations$/);
  if (issuerAttestationMatch && method === "POST") return createAttestation(request, env, issuerAttestationMatch[1]);
  const attestationRevokeMatch = path.match(/^\/api\/attestations\/([a-f0-9-]{36})\/revoke$/);
  if (attestationRevokeMatch && method === "POST") return revokeAttestation(request, env, attestationRevokeMatch[1]);
  const attestationSupersedeMatch = path.match(/^\/api\/attestations\/([a-f0-9-]{36})\/supersede$/);
  if (attestationSupersedeMatch && method === "POST") return supersedeAttestation(request, env, attestationSupersedeMatch[1]);
  const extractRevokeMatch = path.match(/^\/api\/extracts\/([a-f0-9-]{36})\/revoke$/);
  if (extractRevokeMatch && method === "POST") return revokeExtract(request, env, extractRevokeMatch[1]);
  const marketStatusMatch = path.match(/^\/api\/market\/listings\/([a-f0-9-]{36})\/status$/);
  if (marketStatusMatch && method === "POST") return updateListingStatus(request, env, marketStatusMatch[1]);
  // R88 agent plan P03: versioned listing renewal (expiry extension + expired reactivation).
  const marketRenewMatch = path.match(/^\/api\/market\/listings\/([a-f0-9-]{36})\/renew$/);
  if (marketRenewMatch && method === "POST") return renewListing(request, env, marketRenewMatch[1]);
  const inquiryStatusMatch = path.match(/^\/api\/market\/inquiries\/([a-f0-9-]{36})\/status$/);
  if (inquiryStatusMatch && method === "POST") return updateInquiryStatus(request, env, inquiryStatusMatch[1]);
  const marketInquiryMatch = path.match(/^\/api\/market\/listings\/([a-f0-9-]{36})\/inquiries$/);
  if (marketInquiryMatch && method === "POST") return createInquiry(request, env, marketInquiryMatch[1]);
  // R98-N12: the private conversation view, reply thread and buyer closure.
  const inquiryConversationMatch = path.match(/^\/api\/market\/inquiries\/([a-f0-9-]{36})$/);
  if (inquiryConversationMatch && method === "GET") return inquiryConversation(request, env, inquiryConversationMatch[1]);
  const inquiryReplyMatch = path.match(/^\/api\/market\/inquiries\/([a-f0-9-]{36})\/replies$/);
  if (inquiryReplyMatch && method === "POST") return replyToInquiry(request, env, inquiryReplyMatch[1]);
  const inquiryBuyerCloseMatch = path.match(/^\/api\/market\/inquiries\/([a-f0-9-]{36})\/close$/);
  if (inquiryBuyerCloseMatch && method === "POST") return buyerCloseInquiry(request, env, inquiryBuyerCloseMatch[1]);
  // R98-N12: buyer watchlist (saved listings) and participant blocks.
  if (path === "/api/market/watchlist" && method === "GET") return myWatchlist(request, env);
  const watchlistMatch = path.match(/^\/api\/market\/watchlist\/([A-Za-z0-9-]{8,64})$/);
  if (watchlistMatch && method === "POST") return watchlistAdd(request, env, watchlistMatch[1]);
  if (watchlistMatch && method === "DELETE") return watchlistRemove(request, env, watchlistMatch[1]);
  if (path === "/api/market/blocks" && method === "GET") return myBlocks(request, env);
  if (path === "/api/market/blocks" && method === "POST") return blockCreate(request, env);
  const blockMatch = path.match(/^\/api\/market\/blocks\/([A-Za-z0-9_-]{3,64})$/);
  if (blockMatch && method === "DELETE") return blockRemove(request, env, blockMatch[1]);
  // R98-N12: the optional immutable dossier link on a listing.
  const listingDossierMatch = path.match(/^\/api\/market\/listings\/([a-f0-9-]{36})\/dossier$/);
  if (listingDossierMatch && method === "POST") return attachListingDossier(request, env, listingDossierMatch[1]);

  if (path === "/api/horses/duplicate-check" && method === "GET") {
    const privateIdentifier=Boolean(url.searchParams.get("microchip")?.trim());
    if (privateIdentifier) {
      await requirePermission(env.DB,request,env.SESSION_COOKIE_NAME,"horse.edit");
    }
    return duplicateCheck(env.DB,url,privateIdentifier);
  }

  if (path === "/api/platform/meta" && method === "GET") return platformMeta(env);
  if (path === "/api/analytics/registry" && method === "GET") return registryAnalytics(env.DB);

  if (path === "/api/media/proxy" && method === "GET") return mediaProxyHandler(url);
  if (path === "/api/content/posts" && method === "GET") return listPublicContent(env.DB, url);
  const publicContentMatch = path.match(/^\/api\/content\/posts\/([^/]+)$/);
  if (publicContentMatch && method === "GET") return getPublicContent(env.DB, decodeURIComponent(publicContentMatch[1]));
  // Turn 30: newsroom reader comments — public read of published rows + open
  // visitor submission (queued as 'pending', moderated before it ever shows).
  const publicContentCommentsMatch = path.match(/^\/api\/content\/posts\/([^/]+)\/comments$/);
  if (publicContentCommentsMatch && method === "GET") return listPublicComments(env.DB, decodeURIComponent(publicContentCommentsMatch[1]), url);
  if (publicContentCommentsMatch && method === "POST") return createPublicComment(request, env, decodeURIComponent(publicContentCommentsMatch[1]));
  if (path === "/api/admin/content/comments" && method === "GET") return listAdminComments(request, env, url);
  const adminCommentModerateMatch = path.match(/^\/api\/admin\/content\/comments\/([^/]+)\/moderate$/);
  if (adminCommentModerateMatch && method === "POST") return moderateAdminComment(request, env, decodeURIComponent(adminCommentModerateMatch[1]));
  if (path === "/api/admin/content/posts" && method === "GET") return listAdminContent(request, env, url);
  if (path === "/api/admin/content/posts" && method === "POST") return createAdminContent(request, env);
  // R117-17: the governed editorial workflow actions — preview (editor-only,
  // never on the public read routes), explicit publish, retract, and the
  // immutable per-post version history.
  const adminContentPreviewMatch = path.match(/^\/api\/admin\/content\/posts\/([^/]+)\/preview$/);
  if (adminContentPreviewMatch && method === "GET") return previewAdminContent(request, env, decodeURIComponent(adminContentPreviewMatch[1]));
  const adminContentPublishMatch = path.match(/^\/api\/admin\/content\/posts\/([^/]+)\/publish$/);
  if (adminContentPublishMatch && method === "POST") return publishAdminContent(request, env, decodeURIComponent(adminContentPublishMatch[1]));
  const adminContentRetractMatch = path.match(/^\/api\/admin\/content\/posts\/([^/]+)\/retract$/);
  if (adminContentRetractMatch && method === "POST") return retractAdminContent(request, env, decodeURIComponent(adminContentRetractMatch[1]));
  const adminContentRevisionsMatch = path.match(/^\/api\/admin\/content\/posts\/([^/]+)\/revisions$/);
  if (adminContentRevisionsMatch && method === "GET") return listAdminContentRevisions(request, env, decodeURIComponent(adminContentRevisionsMatch[1]));
  const adminContentMatch = path.match(/^\/api\/admin\/content\/posts\/([^/]+)$/);
  if (adminContentMatch && method === "PUT") return updateAdminContent(request, env, decodeURIComponent(adminContentMatch[1]));
  if (path === "/api/admin/content/generate" && method === "POST") return generateAdminContent(request, env);
  if (path === "/api/registry/facets" && method === "GET") return registryFacets(env.DB);
  if (path === "/api/registry/export" && method === "GET") return exportRegistry(request, env, url);
  if (path === "/api/quality/summary" && method === "GET") return publicQualitySummary(env.DB);
  if (path === "/api/people" && method === "GET") return listPeople(env.DB, url);
  if (path === "/api/claims/mine" && method === "GET") return myClaims(request, env);
  if (path === "/api/claims" && method === "POST") return createClaim(request, env);
  // Master-Ai plan T10: horse-scoped access grants (owner self-service).
  if (path === "/api/grants/mine" && method === "GET") return myGrants(request, env);
  if (path === "/api/admin/grants" && method === "GET") return adminGrants(request, env, url);
  const grantRevokeMatch = path.match(/^\/api\/admin\/grants\/([a-f0-9-]{36})\/revoke$/);
  if (grantRevokeMatch && method === "POST") return adminRevokeGrant(request, env, grantRevokeMatch[1]);
  const orgMembershipRevokeMatch = path.match(/^\/api\/admin\/org-memberships\/(\d+)\/revoke$/);
  if (orgMembershipRevokeMatch && method === "POST") return adminRevokeOrgMembership(request, env, Number(orgMembershipRevokeMatch[1]));
  // R144-D01: professional grants scoped to horse, data and purpose — the
  // ONLY non-staff path to private health data (admin manages, editor reads).
  if (path === "/api/admin/professional-grants" && method === "POST") return adminCreateProfessionalGrant(request, env);
  if (path === "/api/admin/professional-grants" && method === "GET") return adminProfessionalGrants(request, env, url);
  const professionalGrantRevokeMatch = path.match(/^\/api\/admin\/professional-grants\/([a-f0-9-]{36})\/revoke$/);
  if (professionalGrantRevokeMatch && method === "POST") return adminRevokeProfessionalGrant(request, env, professionalGrantRevokeMatch[1]);
  const requestEvidenceResponse = await routeRequestEvidence(request, env, url);
  if (requestEvidenceResponse) return requestEvidenceResponse;
  if (path === "/api/change-requests/mine" && method === "GET") return myChangeRequests(request, env);
  if (path === "/api/change-requests" && method === "POST") return createChangeRequest(request, env);
  // Master-Ai plan T11: the submission state machine — submit (draft ->
  // pending), withdraw (draft/pending -> withdrawn), edit (draft content).
  const changeSubmitMatch = path.match(/^\/api\/change-requests\/([^/]+)\/submit$/);
  if (changeSubmitMatch && method === "POST") return submitChangeRequest(request, env, decodeURIComponent(changeSubmitMatch[1]));
  const changeWithdrawMatch = path.match(/^\/api\/change-requests\/([^/]+)\/withdraw$/);
  if (changeWithdrawMatch && method === "POST") return withdrawChangeRequest(request, env, decodeURIComponent(changeWithdrawMatch[1]));
  const changeEditMatch = path.match(/^\/api\/change-requests\/([^/]+)$/);
  if (changeEditMatch && (method === "PUT" || method === "PATCH")) return editChangeRequest(request, env, decodeURIComponent(changeEditMatch[1]));
  if (path === "/api/admin/claims" && method === "GET") return adminClaims(request, env);
  const claimReviewMatch = path.match(/^\/api\/admin\/claims\/([^/]+)\/review$/);
  if (claimReviewMatch && method === "POST") return reviewClaim(request, env, decodeURIComponent(claimReviewMatch[1]));
  if (path === "/api/admin/change-requests" && method === "GET") return adminChangeRequests(request, env);
  const changeReviewMatch = path.match(/^\/api\/admin\/change-requests\/([^/]+)\/review$/);
  if (changeReviewMatch && method === "POST") return reviewChangeRequest(request, env, decodeURIComponent(changeReviewMatch[1]));

  if (path === "/api/search/meta" && method === "GET") return searchMeta();

  if (path === "/api/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").slice(0, 300);
    const limit = parseBoundedIntegerParam(url.searchParams.get("limit"), 25, 1, 50, "limit");
    return json({ query: q, results: await searchHorses(env.DB, q, limit) });
  }

  if (path === "/api/breeding/optimizer" && method === "POST") {
    const parsed=BreedingOptimizerSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
    if(!parsed.success) throw new HttpError(400,"invalid_optimizer_input","Invalid mating optimizer request",parsed.error.flatten());
    if(parsed.data.candidateIds.includes(parsed.data.fixedHorseId)) throw new HttpError(400,"invalid_optimizer_input","fixed horse cannot also be a candidate");
    return json(await optimizeBreedingCandidates(env.DB,parsed.data));
  }

  if (path === "/api/breeding/pairing-evidence" && method === "GET") {
    const sire = requiredPositiveIntegerParam(url, "sire");
    const dam = requiredPositiveIntegerParam(url, "dam");
    const viewer = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
    return json(await projectArabianPairing(env.DB, sire, dam, viewer));
  }

  if (path === "/api/breeding/pairing-analysis" && method === "GET") {
    const sire = requiredPositiveIntegerParam(url, "sire");
    const dam = requiredPositiveIntegerParam(url, "dam");
    if (sire === dam) throw new HttpError(400, "invalid_pairing", "sire and dam must be different horses");
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 8, 1, 12, "depth");
    const result = await analyzeBreedingPairing(env.DB, sire, dam, depth);
    if (!result) return error(404, "not_found", "Horse not found");
    return json(result);
  }

  if (path === "/api/relationship" && method === "GET") {
    const from = requiredPositiveIntegerParam(url, "from");
    const to = requiredPositiveIntegerParam(url, "to");
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 10, 1, 16, "depth");
    return json(await analyzeRelationship(env.DB, from, to, depth, 512));
  }

  if (path === "/api/relationship/coefficients" && method === "GET") {
    const from = requiredPositiveIntegerParam(url, "from");
    const to = requiredPositiveIntegerParam(url, "to");
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 8, 1, 12, "depth");
    const result = await calculateRelationshipCoefficient(env.DB, from, to, depth);
    if (!result) return error(404, "not_found", "Horse not found");
    return json(result);
  }

  const pedigreeMatch = path.match(/^\/api\/horses\/(\d+)\/pedigree$/);
  if (pedigreeMatch && method === "GET") {
    const id = Number(pedigreeMatch[1]);
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 4, 0, 8, "depth");
    const tree = await loadAncestors(env.DB, id, depth);
    if (!tree) return error(404, "not_found", "Horse not found");
    return json({ direction: "ancestors", depth: Math.max(0, Math.min(depth, 8)), tree });
  }

  const sourceNotes=path.match(/^\/api\/horses\/(\d+)\/source-details$/);
  if(sourceNotes && method==='GET') return horseSourceDetails(env.DB,Number(sourceNotes[1]));
  // R47b module routes scoped to a horse.
  const horseModuleMatch = path.match(/^\/api\/horses\/(\d+)\/(competitions|media|genetics|breedings|attestations|certificate\.svg|certificate|actions|racing)$/);
  if (horseModuleMatch && method === "GET") {
    const id = Number(horseModuleMatch[1]);
    if (horseModuleMatch[2] === "competitions") return horseCompetitionHistory(env.DB, id, url);
    // R140-G: the sleeping racing dataset becomes visible — identity crosswalk
    // only (registry_horse_id), provenance-stamped asbdavani / imported_unverified.
    if (horseModuleMatch[2] === "racing") return horseRacing(env.DB, id);
    if (horseModuleMatch[2] === "media") return listHorseMedia(env.DB, id, await getAuth(env.DB, request, env.SESSION_COOKIE_NAME));
    // Master-Ai plan T03 (F01): genetics + breedings GETs now run through the
    // shared viewer-context privacy projection (lab accession/notes/
    // interpretation/unpublished tests are private by default).
    if (horseModuleMatch[2] === "genetics") return horseGenetics(env.DB, id, await getAuth(env.DB, request, env.SESSION_COOKIE_NAME));
    if (horseModuleMatch[2] === "breedings") return horseBreedings(env.DB, id, await getAuth(env.DB, request, env.SESSION_COOKIE_NAME));
    if (horseModuleMatch[2] === "attestations") return listHorseAttestations(env.DB, id);
    // Master-Ai plan T10: the backend computes the viewer's per-horse actions
    // (grants + staff capability). The UI never re-derives permissions from
    // the account role. Public/anonymous viewers get an empty action set.
    if (horseModuleMatch[2] === "actions") return horseActionsEndpoint(request, env, id);
    // Master-Ai plan T06: certificate.svg renders a PREVIEW of live data, or
    // the STORED snapshot of a specific extract when ?extract=CODE is given.
    if (horseModuleMatch[2].startsWith("certificate")) {
      const extractCode = url.searchParams.get("extract");
      return registryCertificateSvg(env.DB, id, url.searchParams.get("lang") === "en" ? "en" : "fa", extractCode && /^[A-Za-z0-9-]{8,80}$/.test(extractCode) ? extractCode.toUpperCase() : null);
    }
  }
  if (horseModuleMatch && method === "POST") {
    const id = Number(horseModuleMatch[1]);
    if (horseModuleMatch[2] === "media") return uploadHorseMedia(request, env, id);
    if (horseModuleMatch[2] === "genetics") return adminAddGeneticTest(request, env, id);
    if (horseModuleMatch[2] === "breedings") return adminAddBreedingRecord(request, env, id);
    if (horseModuleMatch[2] === "certificate") return recordCertificateIssuance(request, env, id);
  }
  // R140-G: national race-card browse — 12,924 races + 122,063 results from
  // the federation racing system (asbdavani), read-only, provenance-stamped.
  if (path === "/api/racing/races" && method === "GET") return racesList(env.DB, url);
  const raceDetailMatch = path.match(/^\/api\/racing\/races\/([A-Za-z0-9_-]{4,64})$/);
  if (raceDetailMatch && method === "GET") return raceDetail(env.DB, raceDetailMatch[1]);
  const mediaFileMatch = path.match(/^\/api\/media\/file\/([a-f0-9-]{36})$/);
  if (mediaFileMatch && method === "GET") return serveMediaFile(env.DB, mediaFileMatch[1], url, await getAuth(env.DB, request, env.SESSION_COOKIE_NAME), env.MEDIA_ACCESS_TOKEN_SECRET);
  // R88 agent plan P09: short-lived signed private-document delivery. Minting
  // re-checks read authorization; tokens bind (media, user, expiry) and every
  // mint records a revocable grant row. The operator quarantine queue lists
  // pending/rejected evidence with reasons — metadata only, never payloads.
  const mediaAccessMatch = path.match(/^\/api\/media\/([a-f0-9-]{36})\/access$/);
  if (mediaAccessMatch && method === "POST") return mintMediaAccess(request, env, mediaAccessMatch[1]);
  const mediaGrantMatch = path.match(/^\/api\/media\/([a-f0-9-]{36})\/access\/([a-f0-9-]{36})$/);
  if (mediaGrantMatch && method === "DELETE") return revokeMediaAccess(request, env, mediaGrantMatch[1], mediaGrantMatch[2]);
  const mediaPublicationMatch = path.match(/^\/api\/media\/([a-f0-9-]{36})\/publication$/);
  if (mediaPublicationMatch && method === "POST") return setMediaPublication(request, env, mediaPublicationMatch[1]);
  if (path === "/api/admin/media/quarantine" && method === "GET") return adminMediaQuarantine(request, env);
  // R88 agent plan P06: append-only reviewed-interpretation provenance. The
  // laboratory report is never rewritten; the structured interpretation is
  // versioned against the catalog and audited in the same batch.
  const geneticInterpretationMatch = path.match(/^\/api\/admin\/genetic-tests\/(\d+)\/interpretation$/);
  if (geneticInterpretationMatch && method === "GET") return geneticReviewHistory(request, env, Number(geneticInterpretationMatch[1]));
  if (geneticInterpretationMatch && method === "POST") return recordGeneticInterpretation(request, env, Number(geneticInterpretationMatch[1]));
  const geneticAccessMatch = path.match(/^\/api\/horses\/(\d+)\/genetic-access$/);
  if (geneticAccessMatch && method === "GET") return horseGeneticAccess(request, env, Number(geneticAccessMatch[1]));
  const pairingReviewMatch = path.match(/^\/api\/admin\/genetic-tests\/(\d+)\/pairing-review$/);
  if (pairingReviewMatch && method === "POST") return reviewPairingEvidence(request, env, Number(pairingReviewMatch[1]));
  // R140-A: health-result publication switch (decoupled from verification).
  const geneticDisclosureMatch = path.match(/^\/api\/admin\/genetic-tests\/(\d+)\/disclosure$/);
  if (geneticDisclosureMatch && method === "POST") return adminSetGeneticTestDisclosure(request, env, Number(geneticDisclosureMatch[1]));
  // R144-D02: explainable publication-decision history for one health result.
  if (geneticDisclosureMatch && method === "GET") return adminGetGeneticTestDisclosureHistory(request, env, Number(geneticDisclosureMatch[1]));
  // R88 agent plan P08: the ONLY reviewed correction path for reproduction/
  // calendar facts. The read-only anomaly report never writes; corrections
  // land here with a reason, revalidated values and an audit row carrying
  // the old values.
  const breedingCorrectionMatch = path.match(/^\/api\/admin\/breeding\/(\d+)\/correct$/);
  if (breedingCorrectionMatch && method === "POST") return adminCorrectBreedingRecord(request, env, Number(breedingCorrectionMatch[1]));
  // R88 agent plan P10: licensed ingestion, staging, resumable apply and
  // reviewer merge/unmerge. Staging is the dry run (no canonical writes);
  // apply is the only canonical writer — per-row transactional, conflict
  // rows always wait for review. Synthetic sources can never feed canonical.
  if (path === "/api/admin/imports/sources" && method === "POST") return adminCreateImportSource(request, env);
  if (path === "/api/admin/imports/sources" && method === "GET") return adminListImportSources(request, env);
  if (path === "/api/admin/imports/stage" && method === "POST") return adminStageImportBatch(request, env);
  const importApplyMatch = path.match(/^\/api\/admin\/imports\/batches\/(\d+)\/apply$/);
  // R114-03 (Master AI handoff D31-A): staged-import operator surface —
  // bounded preview, blob-free review report, versioned row-review command.
  const importPreviewMatch = path.match(/^\/api\/admin\/imports\/batches\/(\d+)\/preview$/);
  if (importPreviewMatch && method === "GET") return adminImportBatchPreview(request, env, Number(importPreviewMatch[1]));
  const importReviewReportMatch = path.match(/^\/api\/admin\/imports\/batches\/(\d+)\/review-report$/);
  if (importReviewReportMatch && method === "GET") return adminImportReviewReport(request, env, Number(importReviewReportMatch[1]));
  const importRowReviewMatch = path.match(/^\/api\/admin\/imports\/batches\/(\d+)\/rows\/(\d+)\/review$/);
  if (importRowReviewMatch && method === "POST") return adminReviewImportRow(request, env, Number(importRowReviewMatch[1]), Number(importRowReviewMatch[2]));
  if (importApplyMatch && method === "POST") return adminApplyImportBatch(request, env, Number(importApplyMatch[1]));
  const importBatchMatch = path.match(/^\/api\/admin\/imports\/batches\/(\d+)$/);
  if (importBatchMatch && method === "GET") return adminImportBatchStatus(request, env, Number(importBatchMatch[1]));
  // R117-19 (Master AI handoff D31): reversible duplicate resolution — the
  // read-only merge dry run (full reference/permission enumeration + the
  // manifest digest the versioned merge command requires) and the versioned
  // merge/unmerge commands with idempotent receipts.
  const horseMergePreviewMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/merge-preview$/);
  if (horseMergePreviewMatch && method === "GET") return adminMergePreview(request, env, Number(horseMergePreviewMatch[1]));
  const horseMergeMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/merge$/);
  if (horseMergeMatch && method === "POST") return adminMergeHorses(request, env, Number(horseMergeMatch[1]));
  const mergeUnmergeMatch = path.match(/^\/api\/admin\/horse-merges\/(\d+)\/unmerge$/);
  if (mergeUnmergeMatch && method === "POST") return adminUnmergeHorses(request, env, Number(mergeUnmergeMatch[1]));
  // R141: duplicate-resolution workbench reads — the standing fuzzy
  // similar-names miner (candidate groups over live canonical rows) and the
  // recent merge receipts list that feeds the guarded unmerge. Both read-only,
  // both gated on horse.edit like the merge commands themselves.
  if (path === "/api/admin/duplicates" && method === "GET") return adminDuplicateCandidates(request, env);
  if (path === "/api/admin/horse-merges" && method === "GET") return adminMergeHistory(request, env);
  // R88 agent plan P11: the professional directory — public consent-gated
  // person/organization listings (cursor-paginated, approved province codes),
  // credentials with honest expiry + verification states, and reviewed
  // claim/represent moderation with an appeal path.
  if (path === "/api/directory/persons" && method === "GET") return listDirectoryPersons(env.DB, url);
  const directoryPersonMatch = path.match(/^\/api\/directory\/persons\/(\d+)$/);
  if (directoryPersonMatch && method === "GET") return directoryPersonDetail(env.DB, Number(directoryPersonMatch[1]));
  if (path === "/api/directory/organizations" && method === "GET") return listDirectoryOrganizations(env.DB, url);
  if (path === "/api/directory/claims" && method === "POST") return createDirectoryClaim(request, env);
  if (path === "/api/directory/claims/mine" && method === "GET") return myDirectoryClaims(request, env);
  const directoryProfileMatch = path.match(/^\/api\/directory\/persons\/(\d+)\/profile$/);
  if (directoryProfileMatch && method === "GET") return getManagedPersonProfile(request, env, Number(directoryProfileMatch[1]));
  if (directoryProfileMatch && method === "PUT") return updatePersonDirectoryProfile(request, env, Number(directoryProfileMatch[1]));
  const directoryCredentialMatch = path.match(/^\/api\/directory\/persons\/(\d+)\/credentials$/);
  if (directoryCredentialMatch && method === "POST") return addPersonCredential(request, env, Number(directoryCredentialMatch[1]));
  const directoryClaimReviewMatch = path.match(/^\/api\/admin\/directory\/claims\/(\d+)\/review$/);
  if (directoryClaimReviewMatch && method === "POST") return reviewDirectoryClaim(request, env, Number(directoryClaimReviewMatch[1]));
  const directoryCredentialReviewMatch = path.match(/^\/api\/admin\/directory\/credentials\/(\d+)\/review$/);
  if (directoryCredentialReviewMatch && method === "POST") return reviewPersonCredential(request, env, Number(directoryCredentialReviewMatch[1]));
  // R98-N07: organization onboarding — public consent-gated cards, managed
  // profile with the SAME version/428 semantics as person profiles, the
  // staff invitation lifecycle, the per-organization lead inbox and
  // person-level officiating appointments (judge/steward/ringmaster/dc).
  const organizationPublicMatch = path.match(/^\/api\/directory\/organizations\/(\d+)$/);
  if (organizationPublicMatch && method === "GET") return getPublicOrganization(request, env, Number(organizationPublicMatch[1]));
  const organizationManageMatch = path.match(/^\/api\/organizations\/(\d+)\/manage$/);
  if (organizationManageMatch && method === "GET") return getManagedOrganization(request, env, Number(organizationManageMatch[1]));
  const organizationProfileMatch = path.match(/^\/api\/organizations\/(\d+)\/profile$/);
  if (organizationProfileMatch && method === "PUT") return updateOrganizationProfile(request, env, Number(organizationProfileMatch[1]));
  const organizationStaffMatch = path.match(/^\/api\/organizations\/(\d+)\/staff$/);
  if (organizationStaffMatch && method === "GET") return getOrganizationStaff(request, env, Number(organizationStaffMatch[1]));
  const organizationInboxMatch = path.match(/^\/api\/organizations\/(\d+)\/inbox$/);
  if (organizationInboxMatch && method === "GET") return getOrganizationInbox(request, env, Number(organizationInboxMatch[1]));
  const staffInviteMatch = path.match(/^\/api\/organizations\/(\d+)\/staff\/invites$/);
  if (staffInviteMatch && method === "POST") return createStaffInvite(request, env, Number(staffInviteMatch[1]));
  if (path === "/api/organizations/invites/mine" && method === "GET") return getMyStaffInvites(request, env);
  const staffInviteResponseMatch = path.match(/^\/api\/organizations\/invites\/(\d+)$/);
  if (staffInviteResponseMatch && method === "POST") return respondToStaffInvite(request, env, Number(staffInviteResponseMatch[1]));
  const staffRoleMatch = path.match(/^\/api\/organizations\/(\d+)\/staff\/([^\/]+)\/role$/);
  if (staffRoleMatch && method === "POST") return updateStaffRole(request, env, Number(staffRoleMatch[1]), staffRoleMatch[2]);
  const staffRevokeMatch = path.match(/^\/api\/organizations\/(\d+)\/staff\/([^\/]+)\/revoke$/);
  if (staffRevokeMatch && method === "POST") return revokeStaff(request, env, Number(staffRevokeMatch[1]), staffRevokeMatch[2]);
  const organizationOfficialMatch = path.match(/^\/api\/organizations\/(\d+)\/officials$/);
  if (organizationOfficialMatch && method === "POST") return appointOrganizationOfficial(request, env, Number(organizationOfficialMatch[1]));
  const organizationCredentialMatch = path.match(/^\/api\/organizations\/(\d+)\/credentials$/);
  if (organizationCredentialMatch && method === "POST") return addOrganizationCredential(request, env, Number(organizationCredentialMatch[1]));
  const organizationCredentialReviewMatch = path.match(/^\/api\/admin\/organizations\/credentials\/(\d+)\/review$/);
  if (organizationCredentialReviewMatch && method === "POST") return reviewOrganizationCredentialEndpoint(request, env, Number(organizationCredentialReviewMatch[1]));
  // R98-N08: credential evidence and expiry workflows — the platform
  // evidence-review queue (never the claimant's own), holder-submitted
  // renewal evidence, pre-expiry reminders with dedup, the honest public
  // badge, and the ONE current-qualification predicate.
  if (path === "/api/admin/directory/credentials/queue" && method === "GET") return getCredentialReviewQueue(request, env);
  if (path === "/api/admin/directory/credentials/expiry-scan" && method === "POST") return runExpiryScan(request, env);
  if (path === "/api/directory/credentials/expiring/mine" && method === "GET") return myExpiringCredentials(request, env);
  const credentialBadgeMatch = path.match(/^\/api\/directory\/credentials\/(person|organization)\/(\d+)\/badge$/);
  if (credentialBadgeMatch && method === "GET") return getCredentialBadge(request, env, credentialBadgeMatch[1], Number(credentialBadgeMatch[2]));
  const credentialRenewalMatch = path.match(/^\/api\/directory\/credentials\/(person|organization)\/(\d+)\/renewal$/);
  if (credentialRenewalMatch && method === "POST") return submitRenewal(request, env, credentialRenewalMatch[1], Number(credentialRenewalMatch[2]));
  const credentialRenewalReviewMatch = path.match(/^\/api\/admin\/directory\/credentials\/renewals\/(\d+)\/review$/);
  if (credentialRenewalReviewMatch && method === "POST") return reviewRenewal(request, env, Number(credentialRenewalReviewMatch[1]));
  // R88 agent plan P12: the consented service request inbox. A request is a
  // LEAD — never a confirmed appointment, never paid/booked (those states do
  // not exist in the machine). Contact is consent-gated and re-authorized at
  // every read; idempotent create reuses the P03 receipt discipline.
  if (path === "/api/service-requests" && method === "POST") return createServiceRequest(request, env);
  if (path === "/api/service-requests/mine" && method === "GET") return myServiceRequests(request, env);
  // R108-05: the uncertain-write reconciliation read (actor-scoped; registered
  // before the numeric detail route so the UUID-shaped key cannot be parsed
  // as an id).
  const serviceIntentMatch = path.match(/^\/api\/service-requests\/intents\/([A-Za-z0-9_-]{8,128})$/);
  if (serviceIntentMatch && method === "GET") return reconcileServiceIntent(request, env, serviceIntentMatch[1]);
  if (path === "/api/service-requests/inbox" && method === "GET") return providerServiceRequests(request, env);
  // R95-N12: the public privacy decision table + the requester's own export.
  if (path === "/api/service-requests/privacy-policy" && method === "GET") return servicePrivacyPolicy();
  if (path === "/api/service-requests/export" && method === "GET") return exportMyServiceData(request, env);
  const serviceRequestMatch = path.match(/^\/api\/service-requests\/(\d+)$/);
  if (serviceRequestMatch && method === "GET") return serviceRequestDetail(request, env, Number(serviceRequestMatch[1]));
  const serviceRequestStatusMatch = path.match(/^\/api\/service-requests\/(\d+)\/status$/);
  if (serviceRequestStatusMatch && method === "POST") return transitionServiceRequest(request, env, Number(serviceRequestStatusMatch[1]));
  const serviceRequestBlockMatch = path.match(/^\/api\/service-requests\/(\d+)\/block$/);
  if (serviceRequestBlockMatch && method === "POST") return blockProvider(request, env, Number(serviceRequestBlockMatch[1]));
  const serviceRequestReportMatch = path.match(/^\/api\/service-requests\/(\d+)\/report$/);
  if (serviceRequestReportMatch && method === "POST") return reportServiceRequest(request, env, Number(serviceRequestReportMatch[1]));
  // R96-N08: dispute/legal holds (retention minimization blocks) + the
  // block-complaint support queue (private block reasons never leak).
  const serviceHoldMatch = path.match(/^\/api\/admin\/service-requests\/(\d+)\/hold$/);
  if (serviceHoldMatch && method === "POST") return adminPlaceServiceRequestHold(request, env, Number(serviceHoldMatch[1]));
  const serviceHoldReleaseMatch = path.match(/^\/api\/admin\/service-requests\/(\d+)\/hold\/release$/);
  if (serviceHoldReleaseMatch && method === "POST") return adminReleaseServiceRequestHold(request, env, Number(serviceHoldReleaseMatch[1]));
  if (path === "/api/service-requests/block-complaints" && method === "POST") return fileBlockComplaint(request, env);
  if (path === "/api/admin/service-requests/block-complaints" && method === "GET") return adminBlockComplaintQueue(request, env);
  const blockComplaintResolveMatch = path.match(/^\/api\/admin\/service-requests\/block-complaints\/(\d+)\/resolve$/);
  if (blockComplaintResolveMatch && method === "POST") return adminResolveBlockComplaint(request, env, Number(blockComplaintResolveMatch[1]));
  // R95-N12: consent withdrawal (one-way), provider-side block (neutral
  // refusal, private reason) and requester note redaction (digest evidence).
  const serviceRequestConsentMatch = path.match(/^\/api\/service-requests\/(\d+)\/consent$/);
  if (serviceRequestConsentMatch && method === "POST") return withdrawContactConsent(request, env, Number(serviceRequestConsentMatch[1]));
  const serviceProviderBlockMatch = path.match(/^\/api\/service-requests\/(\d+)\/provider-block$/);
  if (serviceProviderBlockMatch && method === "POST") return providerBlockRequester(request, env, Number(serviceProviderBlockMatch[1]));
  const serviceRequestRedactMatch = path.match(/^\/api\/service-requests\/(\d+)\/redact$/);
  if (serviceRequestRedactMatch && method === "POST") return redactMyNote(request, env, Number(serviceRequestRedactMatch[1]));
  // R98-N09: operator-approved retention policies + subject redaction requests
  // (a request against a held record is DEFERRED, never dropped, never forced).
  if (path === "/api/admin/privacy/retention-policies" && method === "GET") return adminListRetentionPolicies(request, env);
  if (path === "/api/admin/privacy/retention-policies" && method === "POST") return adminApproveRetentionPolicy(request, env);
  if (path === "/api/privacy/redaction-requests" && method === "POST") return fileSubjectRedactionRequest(request, env);
  if (path === "/api/admin/privacy/redaction-requests" && method === "GET") return adminRedactionRequestQueue(request, env);
  const redactionDecideMatch = path.match(/^\/api\/admin\/privacy\/redaction-requests\/(\d+)\/decide$/);
  if (redactionDecideMatch && method === "POST") return adminDecideRedactionRequest(request, env, Number(redactionDecideMatch[1]));
  // R114-01: the separate audited fulfillment executor (decision != execution).
  const redactionFulfillMatch = path.match(/^\/api\/admin\/privacy\/redaction-requests\/(\d+)\/fulfill$/);
  if (redactionFulfillMatch && method === "POST") return adminFulfillRedactionRequest(request, env, Number(redactionFulfillMatch[1]));
  const providerResponseStatsMatch = path.match(/^\/api\/directory\/persons\/(\d+)\/response-stats$/);
  if (providerResponseStatsMatch && method === "GET") return providerResponseStats(env.DB, Number(providerResponseStatsMatch[1]));
  // R88 agent plan P13: transactional notifications with accurate delivery
  // language. A 2xx provider reply is ACCEPTANCE, never delivery; `delivered`
  // exists only after a signature-verified provider callback. The outbox row
  // lands in the same transaction as the business mutation.
  if (path === "/api/notifications/mine" && method === "GET") return myNotifications(request, env);
  if (path === "/api/notifications/preferences" && method === "GET") return myNotificationPreferences(request, env);
  if (path === "/api/notifications/preferences" && method === "PUT") return updateNotificationPreferences(request, env);
  if (path === "/api/admin/notifications/outbox" && method === "GET") return adminOutboxQueue(request, env);
  // R98-N11 demo inbox: the operator's paired provider-side/platform-side
  // view for demonstration deliveries, plus the explicit simulate action
  // that drives the REAL signed-callback recording path.
  if (path === "/api/admin/notifications/demo-deliveries" && method === "GET") return adminDemoDeliveries(request, env);
  const demoDeliveryMatch = path.match(/^\/api\/admin\/notifications\/demo-deliveries\/(\d+)\/callback$/);
  if (demoDeliveryMatch && method === "POST") return adminSimulateDemoDelivery(request, env, Number(demoDeliveryMatch[1]));
  const outboxRetryMatch = path.match(/^\/api\/admin\/notifications\/outbox\/(\d+)\/retry$/);
  if (outboxRetryMatch && method === "POST") return adminRetryOutboxEvent(request, env, Number(outboxRetryMatch[1]));
  const notificationCallbackMatch = path.match(/^\/api\/notifications\/callback\/([a-z0-9\-]{2,24})$/);
  if (notificationCallbackMatch && method === "POST") return notificationCallback(request, env, notificationCallbackMatch[1]);
  // R88 agent plan P14: farm workspace collections and delegated daily work.
  // A private collection is a WORKING SET, never an ownership claim; staff
  // access is action-scoped and re-authorized live at every read; tasks are
  // user-entered reminders (mechanical recurrence only, never medical
  // instructions); CSV export is formula-injection protected.
  if (path === "/api/workspaces" && method === "POST") return createWorkspace(request, env);
  if (path === "/api/workspaces/mine" && method === "GET") return myWorkspaces(request, env);
  const workspaceMatch = path.match(/^\/api\/workspaces\/(\d+)$/);
  if (workspaceMatch && method === "GET") return workspaceDashboard(request, env, Number(workspaceMatch[1]));
  if (workspaceMatch && method === "DELETE") return deleteWorkspace(request, env, Number(workspaceMatch[1]));
  const workspaceHorseMatch = path.match(/^\/api\/workspaces\/(\d+)\/horses$/);
  if (workspaceHorseMatch && method === "POST") return addWorkspaceHorse(request, env, Number(workspaceHorseMatch[1]));
  const workspaceBulkMatch = path.match(/^\/api\/workspaces\/(\d+)\/horses\/bulk$/);
  if (workspaceBulkMatch && method === "POST") return bulkWorkspaceHorses(request, env, Number(workspaceBulkMatch[1]));
  const workspaceHorseRemoveMatch = path.match(/^\/api\/workspaces\/(\d+)\/horses\/(\d+)$/);
  if (workspaceHorseRemoveMatch && method === "DELETE") return removeWorkspaceHorse(request, env, Number(workspaceHorseRemoveMatch[1]), Number(workspaceHorseRemoveMatch[2]));
  const workspaceStaffMatch = path.match(/^\/api\/workspaces\/(\d+)\/staff$/);
  if (workspaceStaffMatch && method === "POST") return assignWorkspaceStaff(request, env, Number(workspaceStaffMatch[1]));
  const workspaceStaffRevokeMatch = path.match(/^\/api\/workspaces\/(\d+)\/staff\/([A-Za-z0-9_\-]{3,64})\/revoke$/);
  if (workspaceStaffRevokeMatch && method === "POST") return revokeWorkspaceStaff(request, env, Number(workspaceStaffRevokeMatch[1]), workspaceStaffRevokeMatch[2]);
  const workspaceTaskMatch = path.match(/^\/api\/workspaces\/(\d+)\/tasks$/);
  if (workspaceTaskMatch && method === "POST") return createWorkspaceTask(request, env, Number(workspaceTaskMatch[1]));
  if (workspaceTaskMatch && method === "GET") return listWorkspaceTasks(request, env, Number(workspaceTaskMatch[1]));
  const workspaceTaskCompleteMatch = path.match(/^\/api\/workspaces\/(\d+)\/tasks\/(\d+)\/complete$/);
  if (workspaceTaskCompleteMatch && method === "POST") return completeWorkspaceTask(request, env, Number(workspaceTaskCompleteMatch[1]), Number(workspaceTaskCompleteMatch[2]));
  // R117-14: reopen a completed ONE-SHOT reminder (recurring closures refuse honestly).
  const workspaceTaskReopenMatch = path.match(/^\/api\/workspaces\/(\d+)\/tasks\/(\d+)\/reopen$/);
  if (workspaceTaskReopenMatch && method === "POST") return reopenWorkspaceTask(request, env, Number(workspaceTaskReopenMatch[1]), Number(workspaceTaskReopenMatch[2]));
  const workspaceExportMatch = path.match(/^\/api\/workspaces\/(\d+)\/export$/);
  if (workspaceExportMatch && method === "GET") return exportWorkspaceCsv(request, env, Number(workspaceExportMatch[1]));
  // R98-N16: staff invitations (consent before delegation), documents,
  // reassignment and no-overwrite task import.
  const workspaceInviteMatch = path.match(/^\/api\/workspaces\/(\d+)\/invites$/);
  if (workspaceInviteMatch && method === "POST") return inviteWorkspaceStaff(request, env, Number(workspaceInviteMatch[1]));
  const workspaceInviteRevokeMatch = path.match(/^\/api\/workspaces\/(\d+)\/invites\/([A-Za-z0-9_-]{3,64})\/revoke$/);
  if (workspaceInviteRevokeMatch && method === "POST") return revokeWorkspaceInvite(request, env, Number(workspaceInviteRevokeMatch[1]), workspaceInviteRevokeMatch[2]);
  if (path === "/api/workspaces/invites/mine" && method === "GET") return myWorkspaceInvites(request, env);
  const workspaceInviteRespondMatch = path.match(/^\/api\/workspaces\/invites\/(\d+)\/respond$/);
  if (workspaceInviteRespondMatch && method === "POST") return respondWorkspaceInvite(request, env, Number(workspaceInviteRespondMatch[1]));
  const workspaceDocumentsMatch = path.match(/^\/api\/workspaces\/(\d+)\/documents$/);
  if (workspaceDocumentsMatch && method === "GET") return listWorkspaceDocuments(request, env, Number(workspaceDocumentsMatch[1]));
  if (workspaceDocumentsMatch && method === "POST") return createWorkspaceDocument(request, env, Number(workspaceDocumentsMatch[1]));
  const workspaceDocumentMatch = path.match(/^\/api\/workspaces\/(\d+)\/documents\/(\d+)$/);
  if (workspaceDocumentMatch && method === "PATCH") return updateWorkspaceDocument(request, env, Number(workspaceDocumentMatch[1]), Number(workspaceDocumentMatch[2]));
  const workspaceDocumentArchiveMatch = path.match(/^\/api\/workspaces\/(\d+)\/documents\/(\d+)\/archive$/);
  if (workspaceDocumentArchiveMatch && method === "POST") return archiveWorkspaceDocument(request, env, Number(workspaceDocumentArchiveMatch[1]), Number(workspaceDocumentArchiveMatch[2]));
  const workspaceTaskReassignMatch = path.match(/^\/api\/workspaces\/(\d+)\/tasks\/(\d+)\/reassign$/);
  if (workspaceTaskReassignMatch && method === "POST") return reassignWorkspaceTask(request, env, Number(workspaceTaskReassignMatch[1]), Number(workspaceTaskReassignMatch[2]));
  const workspaceTaskImportMatch = path.match(/^\/api\/workspaces\/(\d+)\/tasks\/import$/);
  if (workspaceTaskImportMatch && method === "POST") return importWorkspaceTasks(request, env, Number(workspaceTaskImportMatch[1]));
  // R88 agent plan P15: shareable sale dossiers. A versioned FROZEN snapshot
  // of permitted data; high-entropy hashed share tokens with expiry and
  // revocation; redacted sections stay visible as not_shared; every view
  // carries the not-title-transfer / not-vetting warnings. No verification
  // badge exists for sale.
  if (path === "/api/dossiers" && method === "POST") return createDossier(request, env);
  if (path === "/api/dossiers/mine" && method === "GET") return myDossiers(request, env);
  const dossierLinkMatch = path.match(/^\/api\/dossiers\/(\d+)\/links$/);
  if (dossierLinkMatch && method === "POST") return createDossierLink(request, env, Number(dossierLinkMatch[1]));
  const dossierLinkRevokeMatch = path.match(/^\/api\/dossiers\/(\d+)\/links\/(\d+)\/revoke$/);
  if (dossierLinkRevokeMatch && method === "POST") return revokeDossierLink(request, env, Number(dossierLinkRevokeMatch[1]), Number(dossierLinkRevokeMatch[2]));
  const dossierRevokeMatch = path.match(/^\/api\/dossiers\/(\d+)\/revoke$/);
  if (dossierRevokeMatch && method === "POST") return revokeDossier(request, env, Number(dossierRevokeMatch[1]));
  const dossierViewMatch = path.match(/^\/api\/dossiers\/view\/([A-Za-z0-9_-]{40,60})$/);
  if (dossierViewMatch && method === "GET") return viewDossierByToken(request, env, dossierViewMatch[1]);
  // R88 agent plan P16: moderation, reporting and marketplace trust
  // operations. Content moderation is SEPARATE from registry correction —
  // a case never targets a horse record; hiding a listing is a transparent
  // suspension overlay. The decision trail is append-only (decisions,
  // appeals, reversals); support hours are stated honestly (no 24/7 claim).
  if (path === "/api/moderation/reports" && method === "POST") return reportCase(request, env);
  if (path === "/api/moderation/standing" && method === "GET") return myAbuseStanding(request, env);
  if (path === "/api/admin/moderation/queue" && method === "GET") return moderationQueue(request, env);
  const moderationCaseMatch = path.match(/^\/api\/moderation\/cases\/(\d+)$/);
  if (moderationCaseMatch && method === "GET") return caseDetail(request, env, Number(moderationCaseMatch[1]));
  const moderationAssignMatch = path.match(/^\/api\/admin\/moderation\/cases\/(\d+)\/assign$/);
  if (moderationAssignMatch && method === "POST") return assignCase(request, env, Number(moderationAssignMatch[1]));
  const moderationDecisionMatch = path.match(/^\/api\/admin\/moderation\/cases\/(\d+)\/decision$/);
  if (moderationDecisionMatch && method === "POST") return decideCase(request, env, Number(moderationDecisionMatch[1]));
  const moderationStandingMatch = path.match(/^\/api\/admin\/moderation\/cases\/(\d+)\/standing$/);
  if (moderationStandingMatch && method === "POST") return setCaseStanding(request, env, Number(moderationStandingMatch[1]));
  const moderationAppealMatch = path.match(/^\/api\/moderation\/cases\/(\d+)\/appeal$/);
  if (moderationAppealMatch && method === "POST") return appealCase(request, env, Number(moderationAppealMatch[1]));
  const moderationAppealDecisionMatch = path.match(/^\/api\/admin\/moderation\/appeals\/(\d+)\/decision$/);
  if (moderationAppealDecisionMatch && method === "POST") return decideAppeal(request, env, Number(moderationAppealDecisionMatch[1]));
  const listingAvailabilityMatch = path.match(/^\/api\/market\/listings\/([A-Za-z0-9-]{8,64})\/confirm-availability$/);
  if (listingAvailabilityMatch && method === "POST") return confirmListingAvailability(request, env, listingAvailabilityMatch[1]);
  // R88 agent plan P17: billing catalog, orders and unambiguous money units.
  // Every amount is integer minor IRR (currency='IRR' CHECK-enforced); toman
  // exists only at display boundaries. Prices are immutable VERSIONS (a
  // reprice supersedes, never mutates); order totals are ALWAYS recomputed
  // server-side; duplicate order_key = ONE order. No payment provider is
  // enabled in this phase (P18 wires verified payments).
  if (path === "/api/billing/catalog" && method === "GET") return billingCatalog(request, env);
  if (path === "/api/admin/billing/prices" && method === "POST") return adminCreatePrice(request, env);
  if (path === "/api/billing/orders" && method === "POST") return createOrder(request, env);
  if (path === "/api/billing/orders/mine" && method === "GET") return myOrders(request, env);
  const orderMatch = path.match(/^\/api\/billing\/orders\/(\d+)$/);
  if (orderMatch && method === "GET") return orderDetail(request, env, Number(orderMatch[1]));
  const orderCancelMatch = path.match(/^\/api\/billing\/orders\/(\d+)\/cancel$/);
  if (orderCancelMatch && method === "POST") return cancelOrder(request, env, Number(orderCancelMatch[1]));
  // R88 agent plan P18: verified payments, entitlements, reconciliation.
  // Verification is SERVER-SIDE (stored amount + authority against the
  // provider; redirect status never trusted); exactly ONE entitlement event
  // per verified payment (UNIQUE event_key — concurrent callbacks/replays
  // cannot double-grant); timeouts stay pending, never guessed; refunds are
  // compensating events; reconciliation exceptions queue for operators.
  const orderPayMatch = path.match(/^\/api\/billing\/orders\/(\d+)\/pay$/);
  if (orderPayMatch && method === "POST") return startOrderPayment(request, env, Number(orderPayMatch[1]));
  const orderRefundMatch = path.match(/^\/api\/admin\/billing\/orders\/(\d+)\/refund$/);
  if (orderRefundMatch && method === "POST") return adminRefundOrder(request, env, Number(orderRefundMatch[1]));
  if (path === "/api/billing/payments/callback" && method === "GET") return paymentCallback(request, env);
  if (path === "/api/billing/payments/verify" && method === "POST") return verifyPaymentAttempt(request, env);
  // R98-N10 demo gateway: the hosted demonstration pay page's two endpoints.
  // Unauthenticated BY DESIGN (a real gateway's pay page does not know the
  // buyer's session either); the settlement is simulated and server-side
  // verification remains the only source of truth for entitlements.
  const demoSessionMatch = path.match(/^\/api\/demo\/payments\/([A-Za-z0-9-]{8,64})$/);
  if (demoSessionMatch && method === "GET") return demoPaymentSessionStatus(request, env, demoSessionMatch[1]);
  if (demoSessionMatch && method === "POST") return completeDemoPayment(request, env, demoSessionMatch[1]);
  if (path === "/api/billing/entitlements" && method === "GET") return myEntitlements(request, env);
  if (path === "/api/admin/billing/reconciliation" && (method === "GET" || method === "POST")) return adminReconciliation(request, env);
  // R95-N05: gateway uncertainty workflow — operator provider inquiry (audit
  // evidence, never a state guess) and review-case resolution that must
  // reconcile echoed evidence against the stored attempt/order rows.
  const attemptInquiryMatch = path.match(/^\/api\/admin\/billing\/attempts\/(\d+)\/inquiry$/);
  if (attemptInquiryMatch && method === "POST") return adminAttemptInquiry(request, env, Number(attemptInquiryMatch[1]));
  const reviewResolveMatch = path.match(/^\/api\/admin\/billing\/review-cases\/(\d+)\/resolve$/);
  if (reviewResolveMatch && method === "POST") return adminResolveReviewCase(request, env, Number(reviewResolveMatch[1]));
  // R95-N06: truthful provider-confirmed refunds — buyer request + status,
  // operator approval, operator-recorded provider panel outcome. The legacy
  // instant-refund route above stays 501: money returns only when the
  // provider outcome is confirmed with a reference.
  const orderRefundRequestMatch = path.match(/^\/api\/billing\/orders\/(\d+)\/refund-request$/);
  if (orderRefundRequestMatch && method === "POST") return requestOrderRefund(request, env, Number(orderRefundRequestMatch[1]));
  if (path === "/api/billing/refunds/mine" && method === "GET") return myRefunds(request, env);
  const refundApproveMatch = path.match(/^\/api\/admin\/billing\/refund-requests\/(\d+)\/approve$/);
  if (refundApproveMatch && method === "POST") return adminApproveRefund(request, env, Number(refundApproveMatch[1]));
  const refundOutcomeMatch = path.match(/^\/api\/admin\/billing\/refund-requests\/(\d+)\/provider-outcome$/);
  if (refundOutcomeMatch && method === "POST") return adminRecordRefundOutcome(request, env, Number(refundOutcomeMatch[1]));
  // R96-N05: the refund/access allocation ledger — propose, approve the exact
  // amount, inspect the review, resolve with grant-specific decisions.
  const allocationProposeMatch = path.match(/^\/api\/admin\/billing\/refund-requests\/(\d+)\/allocation\/propose$/);
  if (allocationProposeMatch && method === "POST") return adminProposeRefundAllocation(request, env, Number(allocationProposeMatch[1]));
  const allocationApproveMatch = path.match(/^\/api\/admin\/billing\/refund-requests\/(\d+)\/allocation\/approve$/);
  if (allocationApproveMatch && method === "POST") return adminApproveRefundAllocation(request, env, Number(allocationApproveMatch[1]));
  const refundReviewMatch = path.match(/^\/api\/admin\/billing\/refund-requests\/(\d+)\/review$/);
  if (refundReviewMatch && method === "GET") return adminRefundReviewDetail(request, env, Number(refundReviewMatch[1]));
  const refundReviewResolveMatch = path.match(/^\/api\/admin\/billing\/refund-requests\/(\d+)\/review\/resolve$/);
  if (refundReviewResolveMatch && method === "POST") return adminResolveRefundReview(request, env, Number(refundReviewResolveMatch[1]));
  // R88 agent plan P19: the first paid offers with public trust protected —
  // three pilot offers with stated free tiers; server-entitlement gates for
  // conveniences only (resource authorization never consults entitlements);
  // sponsored placement clearly labeled bilingually and excluded from every
  // scientific surface.
  if (path === "/api/commerce/offers" && method === "GET") return publicOffers(request, env);
  const listingSponsorMatch = path.match(/^\/api\/admin\/market\/listings\/([A-Za-z0-9-]{8,64})\/sponsor$/);
  if (listingSponsorMatch && method === "POST") return adminSponsorListing(request, env, listingSponsorMatch[1]);
  const mediaOpsMatch = path.match(/^\/api\/media\/([a-f0-9-]{36})$/);
  if (mediaOpsMatch && method === "DELETE") return deleteHorseMedia(request, env, mediaOpsMatch[1]);
  const mediaVerifyMatch = path.match(/^\/api\/admin\/media\/([a-f0-9-]{36})\/verify$/);
  if (mediaVerifyMatch && method === "POST") return verifyHorseMedia(request, env, mediaVerifyMatch[1]);

  const descendantsMatch = path.match(/^\/api\/horses\/(\d+)\/descendants$/);
  if (descendantsMatch && method === "GET") {
    const id = Number(descendantsMatch[1]);
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 3, 0, 6, "depth");
    const maxNodes = parseBoundedIntegerParam(url.searchParams.get("max"), 160, 20, 1000, "max");
    const result = await loadDescendants(env.DB, id, depth, maxNodes);
    if (!result.tree) return error(404, "not_found", "Horse not found");
    return json({ direction: "descendants", depth: Math.max(0, Math.min(depth, 6)), ...result });
  }

  const pedigreeMetricsMatch = path.match(/^\/api\/horses\/(\d+)\/pedigree\/metrics$/);
  if (pedigreeMetricsMatch && method === "GET") {
    const id = Number(pedigreeMetricsMatch[1]);
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 6, 1, 8, "depth");
    const graph = await loadAncestorGraph(env.DB, id, depth);
    if (!graph) return error(404, "not_found", "Horse not found");
    return json(calculatePedigreeCoverage(graph, depth));
  }

  const descendantMetricsMatch = path.match(/^\/api\/horses\/(\d+)\/pedigree\/descendant-metrics$/);
  if (descendantMetricsMatch && method === "GET") {
    const id = Number(descendantMetricsMatch[1]);
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 4, 1, 6, "depth");
    const maxNodes = parseBoundedIntegerParam(url.searchParams.get("max"), 1000, 100, 1000, "max");
    const result = await calculateDescendantReach(env.DB, id, depth, maxNodes);
    if (!result) return error(404, "not_found", "Horse not found");
    return json(result);
  }

  const pedigreeCoefficientMatch = path.match(/^\/api\/horses\/(\d+)\/pedigree\/coefficients$/);
  if (pedigreeCoefficientMatch && method === "GET") {
    const id = Number(pedigreeCoefficientMatch[1]);
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 8, 1, 12, "depth");
    const result = await calculatePedigreeCoefficient(env.DB, id, depth);
    if (!result) return error(404, "not_found", "Horse not found");
    return json(result);
  }

  const pedigreePathMatch = path.match(/^\/api\/horses\/(\d+)\/pedigree\/paths$/);
  if (pedigreePathMatch && method === "GET") {
    const id = Number(pedigreePathMatch[1]);
    const ancestorId = requiredPositiveIntegerParam(url, "ancestor");
    const depth = parseBoundedIntegerParam(url.searchParams.get("depth"), 8, 1, 12, "depth");
    const maxPaths = parseBoundedIntegerParam(url.searchParams.get("maxPaths"), 12, 1, 32, "maxPaths");
    const graph = await loadAncestorGraph(env.DB, id, depth);
    if (!graph) return error(404, "not_found", "Horse not found");
    const collection = collectAncestorPathSets(graph, maxPaths, Math.max(64, maxPaths * 20));
    const paths = (collection.pathsByAncestor.get(ancestorId) ?? []).slice(0, maxPaths).map(pathValue => ({ path: pathValue, branch: pedigreePathBranch(graph, pathValue) }));
    return json({
      horseId: id, ancestorId, depth, paths,
      truncated: collection.truncated || (collection.pathsByAncestor.get(ancestorId)?.length ?? 0) > maxPaths,
      provenance: {
        method: "bounded-ancestor-path-enumeration", algorithmVersion: "1.0.0",
        interpretation: "Recorded simple pedigree paths from the subject to the selected ancestor within the requested depth; paths may share intermediate horses.",
      },
    });
  }

  const horseInsightsMatch = path.match(/^\/api\/horses\/(\d+)\/insights$/);
  if (horseInsightsMatch && method === "GET") {
    const id = Number(horseInsightsMatch[1]);
    const ancestorDepth = parseBoundedIntegerParam(url.searchParams.get("ancestorDepth"), 6, 1, 8, "ancestorDepth");
    const descendantDepth = parseBoundedIntegerParam(url.searchParams.get("descendantDepth"), 4, 1, 6, "descendantDepth");
    const metricsDepth = parseBoundedIntegerParam(url.searchParams.get("metricsDepth"), ancestorDepth, 1, 8, "metricsDepth");
    const coefficientDepth = parseBoundedIntegerParam(url.searchParams.get("coefficientDepth"), 8, 1, 8, "coefficientDepth");
    const result = await buildHorseInsights(env.DB, id, ancestorDepth, descendantDepth, metricsDepth, coefficientDepth);
    if (!result) return error(404, "not_found", "Horse not found");
    return json(result);
  }


  const personMatch = path.match(/^\/api\/people\/(\d+)$/);
  if (personMatch && method === "GET") return getPerson(env.DB, Number(personMatch[1]));

  const adminHorseMatch = path.match(/^\/api\/admin\/horses\/(\d+)$/);
  if (adminHorseMatch && method === "GET") return getAdminHorse(request, env, Number(adminHorseMatch[1]));

  const horseMatch = path.match(/^\/api\/horses\/(\d+)$/);
  if (horseMatch && method === "GET") return getHorse(env.DB, Number(horseMatch[1]));
  if (horseMatch && (method === "PUT" || method === "PATCH")) return updateHorse(request, env, Number(horseMatch[1]));
  if (horseMatch && method === "DELETE") return archiveHorse(request, env, Number(horseMatch[1]));

  // Master-Ai plan T12: temporal relations — public reads.
  const horseLifecycleMatch = path.match(/^\/api\/horses\/(\d+)\/lifecycle$/);
  if (horseLifecycleMatch && method === "GET") return horseLifecycle(env.DB, Number(horseLifecycleMatch[1]));
  // R145-C04: the deliberately limited public evidence summary (lifecycle
  // vocabulary, no private presence, reviewed ≠ attested).
  const horseEvidenceSummaryMatch = path.match(/^\/api\/horses\/(\d+)\/evidence-summary$/);
  if (horseEvidenceSummaryMatch && method === "GET") return publicEvidenceSummary(env.DB, Number(horseEvidenceSummaryMatch[1]));
  // R145-C05: authorized exact chip/passport lookup (staff capability; public
  // probes refuse; miss is indistinguishable from concealed).
  if (path === "/api/search/exact-identifier" && method === "GET") return exactIdentifierLookup(request, env);
  const horseOwnershipMatch = path.match(/^\/api\/horses\/(\d+)\/ownership$/);
  if (horseOwnershipMatch && method === "GET") return horseOwnership(env.DB, Number(horseOwnershipMatch[1]));
  // T12: staff-curated temporal facts (guarded, precision-checked).
  const adminOwnershipPeriodMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/ownership-periods$/);
  if (adminOwnershipPeriodMatch && method === "POST") return adminCreateOwnershipPeriod(request, env, Number(adminOwnershipPeriodMatch[1]));
  const adminLifecycleEventMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/lifecycle-events$/);
  if (adminLifecycleEventMatch && method === "POST") return adminCreateLifecycleEvent(request, env, Number(adminLifecycleEventMatch[1]));

  if (path === "/api/horses" && method === "GET") return browseHorses(env.DB, url);
  if (path === "/api/horses" && method === "POST") return createHorse(request, env);
  if (path === "/api/admin/dashboard" && method === "GET") return adminDashboard(request, env);
  if (path === "/api/admin/audit" && method === "GET") return auditFeed(request, env);
  // R145-E04: the usable data-quality queue (list/counts, detail+history,
  // assign, resolve, reopen, note, low-risk-only bulk resolve, idempotent scan).
  if (path === "/api/admin/quality" && method === "GET") return adminQualityQueue(request, env);
  if (path === "/api/admin/quality/scan" && method === "POST") return adminQualityScan(request, env);
  if (path === "/api/admin/quality/bulk-resolve" && method === "POST") return adminBulkResolveQualityIssues(request, env);
  const qualityIssueMatch = path.match(/^\/api\/admin\/quality\/(\d+)$/);
  if (qualityIssueMatch && method === "GET") return adminQualityIssueDetail(request, env, Number(qualityIssueMatch[1]));
  if (qualityIssueMatch && method === "POST") return adminQualityIssueNote(request, env, Number(qualityIssueMatch[1]));
  const qualityAssignMatch = path.match(/^\/api\/admin\/quality\/(\d+)\/assign$/);
  if (qualityAssignMatch && method === "POST") return adminAssignQualityIssue(request, env, Number(qualityAssignMatch[1]));
  const qualityResolveMatch = path.match(/^\/api\/admin\/quality\/(\d+)\/resolve$/);
  if (qualityResolveMatch && method === "POST") return adminResolveQualityIssue(request, env, Number(qualityResolveMatch[1]));
  const qualityReopenMatch = path.match(/^\/api\/admin\/quality\/(\d+)\/reopen$/);
  if (qualityReopenMatch && method === "POST") return adminReopenQualityIssue(request, env, Number(qualityReopenMatch[1]));
  if (path === "/api/admin/maintenance/reindex" && method === "POST") return processReindex(request, env);
  if (path === "/api/admin/maintenance/reconcile-mutations" && method === "POST") return processMutationReconciliation(request, env);

  // R146-D04: the bounded, versioned rules service (draft -> report_only ->
  // active -> retired; typed specs; preview before activation; outcome trail).
  if (path === "/api/admin/registry-rules" && method === "GET") return adminListRegistryRules(request, env);
  if (path === "/api/admin/registry-rules" && method === "POST") return adminCreateRegistryRule(request, env);
  const registryRuleMatch = path.match(/^\/api\/admin\/registry-rules\/([a-z0-9][a-z0-9_.-]*)$/);
  if (registryRuleMatch && method === "GET") return adminRegistryRuleDetail(request, env, registryRuleMatch[1]);
  if (registryRuleMatch && method === "PATCH") return adminPatchRegistryRule(request, env, registryRuleMatch[1]);
  if (registryRuleMatch && method === "POST") return adminTransitionRegistryRule(request, env, registryRuleMatch[1]);
  const registryRulePreviewMatch = path.match(/^\/api\/admin\/registry-rules\/([a-z0-9][a-z0-9_.-]*)\/preview$/);
  if (registryRulePreviewMatch && method === "POST") return adminPreviewRegistryRule(request, env, registryRulePreviewMatch[1]);

  // R146-D05: field-level claims and conflict resolution (reviewable
  // competing values, explicit decisions, reversal with full audit).
  if (path === "/api/admin/field-claims" && method === "GET") return adminFieldClaimQueue(request, env);
  const fieldClaimDecisionMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/field-claims\/decisions\/(\d+)\/revert$/);
  if (fieldClaimDecisionMatch && method === "POST") return adminRevertFieldClaimDecision(request, env, Number(fieldClaimDecisionMatch[1]), Number(fieldClaimDecisionMatch[2]));
  const fieldClaimsMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/field-claims$/);
  if (fieldClaimsMatch && method === "GET") return adminHorseFieldClaims(request, env, Number(fieldClaimsMatch[1]));
  const fieldClaimSelectMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/field-claims\/(\d+)\/select$/);
  if (fieldClaimSelectMatch && method === "POST") return adminSelectFieldClaim(request, env, Number(fieldClaimSelectMatch[1]), Number(fieldClaimSelectMatch[2]));
  const fieldClaimRejectMatch = path.match(/^\/api\/admin\/horses\/(\d+)\/field-claims\/(\d+)\/reject$/);
  if (fieldClaimRejectMatch && method === "POST") return adminRejectFieldClaim(request, env, Number(fieldClaimRejectMatch[1]), Number(fieldClaimRejectMatch[2]));

  return error(404, "not_found", "API route not found");
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let out = "";
  for (const char of value) {
    if (encoder.encode(out + char).length > maxBytes) break;
    out += char;
  }
  return out;
}

/** T12: parse a typed date through the shared calendar validation for the
 * direct create path; throws a structured 422 on invalid calendar math. */
interface ParsedTypedDateTriple { value: string | null; precision: string | null; calendar: string | null; gregorianYear: number | null; }
function parseTypedDateForHorseCreate(field: string, raw: unknown): ParsedTypedDateTriple {
  if (raw == null) return { value: null, precision: null, calendar: null, gregorianYear: null };
  const parsed = parseRegistryDate(raw as { value: unknown; precision: unknown; calendar: unknown }, new Date().getUTCFullYear());
  if (!parsed.ok) throw new HttpError(422, "invalid_typed_date", `${field}: ${parsed.message}`);
  return { value: parsed.date.value, precision: parsed.date.precision, calendar: parsed.date.calendar, gregorianYear: parsed.gregorianYear };
}
function typedDateTriple(parsed: ParsedTypedDateTriple): [string | null, string | null, string | null] {
  return [parsed.value, parsed.precision, parsed.calendar];
}

/** Assemble the typed-date + place projection of a horse row for public DTOs. */
function assembleTypedDateField(row: Record<string, unknown>, prefix: string): RegistryDate | null {
  const value = row[`${prefix}_date_value`];
  const precision = row[`${prefix}_date_precision`];
  const calendar = row[`${prefix}_date_calendar`];
  if (typeof value !== "string" || !value) return null;
  if (typeof precision !== "string" || typeof calendar !== "string") return null;
  return { value, precision: precision as RegistryDate["precision"], calendar: calendar as RegistryDate["calendar"] };
}

function requiredPositiveIntegerParam(url: URL, fieldName: string): number {
  const raw = url.searchParams.get(fieldName);
  if (raw === null || raw.trim() === "") throw new HttpError(400, "invalid_query_parameter", `${fieldName} is required`, { field: fieldName });
  return parseBoundedIntegerParam(raw, 1, 1, Number.MAX_SAFE_INTEGER, fieldName);
}

function searchMeta(): Response {
  return json({
    syntaxVersion: "1.2",
    maxQueryLength: 300,
    fields: [
      { key: "name", aliases: ["name", "horse"] },
      { key: "id", aliases: ["id", "no"] },
      { key: "owner", aliases: ["owner"] },
      { key: "breeder", aliases: ["breeder"] },
      { key: "importer", aliases: ["importer"] },
      { key: "passportReceiver", aliases: ["passport", "passportreceiver", "passport_receiver"] },
      { key: "father", aliases: ["father", "sire"] },
      { key: "mother", aliases: ["mother", "dam"] },
      { key: "year", aliases: ["year", "born"] },
      { key: "breed", aliases: ["breed"] },
      { key: "place", aliases: ["place"] },
      { key: "color", aliases: ["color"] },
      { key: "strain", aliases: ["strain", "bloodline"] },
      { key: "imported", aliases: ["imported", "origin"] },
    ],
    registryFieldSearch: {
      version: "1.2",
      combinator: "and",
      fields: [
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
      ],
    },
  });
}

type RuntimeSummary = {
  stats: {
    horses: number; people: number; ownerLinks: number; breederLinks: number; importerLinks: number; passportReceiverLinks: number;
    horsesWithBothParents: number; horsesWithDnaData: number; openQualityIssues: number; searchRows: number;
  };
  source: null | { filename: string; sheet: string; rowCount: number; sha256: string; completedAt: string | null; status: "running" | "complete" | "failed" };
  facets: { breeds: unknown[]; sexes: unknown[]; places: unknown[]; colors: unknown[]; mainStrains: unknown[]; importedFrom: unknown[]; decades: unknown[]; lifecycle: unknown[]; flags: unknown[] };
  quality: { openIssues: number; severities: unknown[]; topIssueCodes: unknown[] };
};

type RuntimeSnapshot = {
  stale: boolean; summary: RuntimeSummary | null; schemaVersion?: string; algorithmVersion?: string; sourceRevision?: string;
  /** Transactionally maintained exact active-horse count, independent of analytics freshness. */
  currentHorseCount?: number;
};

async function loadRuntimeSnapshot(db: D1Database): Promise<RuntimeSnapshot> {
  try {
    const row = await db.prepare(`
      SELECT s.analytics_stale,s.analytics_source_revision,a.schema_version,a.algorithm_version,a.source_revision,a.payload_json,r.active_horse_count
      FROM registry_state s
      LEFT JOIN registry_runtime_counters r ON r.id=1
      LEFT JOIN analytics_snapshots a ON a.key IN ('registry-runtime','registry-overview')
      WHERE s.id=1
      ORDER BY CASE a.key WHEN 'registry-runtime' THEN 0 ELSE 1 END
      LIMIT 1
    `).first<{ analytics_stale: number; analytics_source_revision?: string; schema_version?: string; algorithm_version?: string; source_revision?: string; payload_json?: string; active_horse_count?: number }>();
    let summary: RuntimeSummary | null = null;
    if (row?.payload_json) {
      const payload = JSON.parse(row.payload_json) as { runtimeSummary?: RuntimeSummary };
      if (payload.runtimeSummary && typeof payload.runtimeSummary === "object") summary = payload.runtimeSummary;
    }
    const revisionMismatch = Boolean(row?.analytics_source_revision && row?.source_revision && row.analytics_source_revision !== row.source_revision);
    return {
      // Restricted (is_active<>1) horses are excluded by every public query anyway, so they
      // must not invalidate the snapshot: with 4,118 such rows this term was permanently
      // true, which meant the snapshot cache was never used and facets re-scanned
      // 92,020 rows twelve times on every single request.
      stale: Number(row?.analytics_stale ?? 1) !== 0 || revisionMismatch, summary,
      schemaVersion: row?.schema_version, algorithmVersion: row?.algorithm_version, sourceRevision: row?.source_revision,
      currentHorseCount: Number.isSafeInteger(Number(row?.active_horse_count)) ? Number(row?.active_horse_count) : undefined,
    };
  } catch {
    return { stale: true, summary: null };
  }
}

function publicSnapshotResponseInit(stale = false, shared = false): ResponseInit {
  // Snapshot-served payloads are byte-identical for every visitor and only change when the
  // scheduled rebuild runs, so they are safe to cache at the edge. That turns repeat traffic
  // into zero database reads, which is what keeps us inside the free-tier rows-read allowance.
  // Live-scan responses stay no-store.
  const cacheable = shared && !stale;
  return {
    headers: {
      "cache-control": cacheable ? "public, max-age=60, s-maxage=300" : "private, no-store",
      vary: cacheable ? "Accept-Encoding" : "Cookie",
      ...(stale ? { "x-registry-snapshot-stale": "1" } : {}),
    },
  };
}

function meaningfulSourceTextSql(column: string): string {
  return `${column} IS NOT NULL AND trim(${column})<>'' AND upper(trim(${column})) NOT IN ('NULL','N/A','NA','UNKNOWN','NONE','0') AND replace(trim(${column}),'-','')<>''`;
}

function platformLimits() {
  return {
    searchResultsMax: 50, registryPageMin: 1, registryPageMax: 100, peoplePageMax: 100,
    pedigreeAncestorDepthMax: 8, pedigreeDescendantDepthMax: 6, pedigreeDescendantNodesMax: 1000,
    pedigreeDescendantMetricsNodesMax: 1000, pedigreeMetricsDepthMax: 8, pedigreePathMax: 32,
    relationshipDepthMax: 16, relationshipPathMax: 36,
    registryExportRowsMax: REGISTRY_EXPORT_ROWS_MAX, changeRequestItemsMax: CHANGE_REQUEST_ITEMS_MAX,
  } as const;
}

function publicHealthSnapshot(
  env: Env,
  runtime: RuntimeSnapshot,
  horseCount: number,
  indexedCount: number,
  users: number,
) {
  return {
    ok: true,
    applicationVersion: PLATFORM_APPLICATION_VERSION,
    sourceFingerprint: env.SOURCE_FINGERPRINT || undefined,
    contractVersion: PLATFORM_CONTRACT_VERSION,
    analyticsReady: !runtime.stale && Boolean(runtime.schemaVersion),
    analyticsSchemaVersion: runtime.schemaVersion,
    analyticsAlgorithmVersion: runtime.algorithmVersion,
    analyticsSourceRevision: runtime.sourceRevision,
    horses: horseCount,
    searchRows: indexedCount,
    users,
    env: env.APP_ENV,
    ...datasetClassification(env, horseCount),
    searchReady: horseCount > 0 && indexedCount >= horseCount,
    snapshotStale: runtime.stale,
    ...(env.DB_RUNTIME ? { database: {
      mode: env.DB_RUNTIME.configuredMode,
      primary: env.DB_RUNTIME.primary,
      fallback: env.DB_RUNTIME.fallback,
      active: env.DB_RUNTIME.active,
      failoverUsed: env.DB_RUNTIME.failoverUsed,
    } } : {}),
  };
}

async function platformCapabilities(env: Env): Promise<PlatformCapabilities> {
  const ai = await getAiAssistantStatus(env).catch(() => ({ available: false } as const));
  if (!isSupabaseD1Database(env.DB)) return { ...BASE_PLATFORM_CAPABILITIES, ai_assistant: Boolean(ai.available) };
  // R62: supabase_full is the FULL canonical database — authentication, owner
  // claims, change requests, audit, admin, curation and exports all run on
  // Supabase (42-table schema, verified write paths). Advertising them as
  // unavailable was a stale pre-R59 assumption from the public-read-only
  // serving image; it wrongly disabled frontends that require those features
  // (classic-registry became unselectable) and hid the login entry points in
  // the standalone frontends.
  if (isSupabaseFullModeDatabase(env.DB)) return { ...BASE_PLATFORM_CAPABILITIES, ai_assistant: Boolean(ai.available) };
  // Legacy public-read-only Supabase serving modes (supabase_only /
  // supabase_with_d1_read_failover): do not advertise workflows whose backing
  // tables/write journal are not part of the optimized serving image. Public
  // registry/search/pedigree/analytics remain.
  return {
    ...BASE_PLATFORM_CAPABILITIES,
    ai_assistant: Boolean(ai.available),
    authentication: false,
    owner_claims: false,
    change_requests: false,
    audit: false,
    admin: false,
    curation: false,
    exports: false,
  };
}

// ---------------------------------------------------------------------------
// Quota guard: memoise the two counter scans that every page boot used to pay for.
// A cold isolate pays once; a warm isolate pays nothing. TTL is short so the
// numbers cannot drift meaningfully, and the snapshot row remains the source of
// truth for anything that needs to be exact.
const COUNTER_TTL_MS = 5 * 60 * 1000;
type CounterPair = { horses: number; searchRows: number; at: number };
let counterMemo: CounterPair | null = null;

async function counterPair(db: D1Database): Promise<{ horses: number; searchRows: number }> {
  const now = Date.now();
  if (counterMemo && now - counterMemo.at < COUNTER_TTL_MS) {
    return { horses: counterMemo.horses, searchRows: counterMemo.searchRows };
  }
  const [horses, searchRows] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1"),
    db.prepare("SELECT COUNT(*) AS count FROM horse_search_source s JOIN horses h ON h.id=s.horse_id WHERE h.deleted_at IS NULL AND h.is_active=1"),
  ]);
  const val = (r: D1Result | undefined) => Number((r?.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  const pair = { horses: val(horses), searchRows: val(searchRows), at: now };
  counterMemo = pair;
  return { horses: pair.horses, searchRows: pair.searchRows };
}

let userMemo: { count: number; at: number } | null = null;
async function activeUserCountCached(db: D1Database): Promise<number> {
  const now = Date.now();
  if (userMemo && now - userMemo.at < COUNTER_TTL_MS) return userMemo.count;
  const n = await activeUserCount(db);
  userMemo = { count: n, at: now };
  return n;
}

async function activeUserCount(db: D1Database): Promise<number> {
  // R59: Supabase is the full canonical database; the user count is served
  // from the same provider as every other read.
  const users = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_active=1").first<{ count: number }>();
  return Number(users?.count ?? 0);
}

async function platformMeta(env: Env): Promise<Response> {
  const runtime = await loadRuntimeSnapshot(env.DB);
  if (runtime.summary && !runtime.stale) {
    // R131: the two independent lookups used to run back-to-back; together
    // they set the floor of every page boot, so they now resolve in parallel.
    const [activeUsers, capabilities] = await Promise.all([activeUserCountCached(env.DB), platformCapabilities(env)]);
    const currentHorseCount = runtime.currentHorseCount ?? runtime.summary.stats.horses;
    const health = publicHealthSnapshot(env, runtime, currentHorseCount, runtime.summary.stats.searchRows, activeUsers);
    return json({
      contractVersion: PLATFORM_CONTRACT_VERSION,
      application: { name: "Equine Registry", shortName: "Registry" },
      limits: platformLimits(),
      stats: {
        horses: currentHorseCount, people: runtime.summary.stats.people, ownerLinks: runtime.summary.stats.ownerLinks,
        breederLinks: runtime.summary.stats.breederLinks, importerLinks: runtime.summary.stats.importerLinks,
        passportReceiverLinks: runtime.summary.stats.passportReceiverLinks, horsesWithBothParents: runtime.summary.stats.horsesWithBothParents,
        horsesWithDnaData: runtime.summary.stats.horsesWithDnaData, openQualityIssues: runtime.summary.stats.openQualityIssues,
      },
      source: runtime.summary.source, capabilities, featureCatalog: buildPlatformFeatureCatalog(capabilities), snapshotStale: runtime.stale, health, demoAdminLoginAvailable: isDemoAdminLoginAvailable(env),
    }, publicSnapshotResponseInit(runtime.stale));
  }
  const results = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM people WHERE deleted_at IS NULL"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.role='owner' AND h.deleted_at IS NULL AND h.is_active=1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.role='breeder' AND h.deleted_at IS NULL AND h.is_active=1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.role='importer' AND h.deleted_at IS NULL AND h.is_active=1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.role='passport_receiver' AND h.deleted_at IS NULL AND h.is_active=1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND EXISTS(SELECT 1 FROM horses parent WHERE parent.id=horses.father_id AND parent.deleted_at IS NULL AND parent.is_active=1) AND EXISTS(SELECT 1 FROM horses parent WHERE parent.id=horses.mother_id AND parent.deleted_at IS NULL AND parent.is_active=1)"),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND ((${meaningfulSourceTextSql("dna_status")}) OR (${meaningfulSourceTextSql("dna_desc")}))`),
    env.DB.prepare("SELECT COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL AND (horse_id IS NULL OR EXISTS(SELECT 1 FROM horses qh WHERE qh.id=data_quality_issues.horse_id AND qh.deleted_at IS NULL AND qh.is_active=1))"),
    env.DB.prepare("SELECT source_filename,source_sha256,source_sheet,source_rows,completed_at,status FROM source_imports ORDER BY id DESC LIMIT 1"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horse_search_source s JOIN horses h ON h.id=s.horse_id WHERE h.deleted_at IS NULL AND h.is_active=1"),
  ]);
  const count = (index: number) => Number((results[index]?.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  const sourceRow = results[9]?.results?.[0] as { source_filename?: string; source_sha256?: string; source_sheet?: string; source_rows?: number; completed_at?: string | null; status?: "running" | "complete" | "failed" } | undefined;
  const horseCount = count(0);
  const [activeUsers, capabilities] = await Promise.all([activeUserCountCached(env.DB), platformCapabilities(env)]);
  const health = publicHealthSnapshot(env, runtime, horseCount, count(10), activeUsers);
  return json({
    contractVersion: PLATFORM_CONTRACT_VERSION,
    application: { name: "Equine Registry", shortName: "Registry" },
    limits: platformLimits(),
    stats: {
      horses: horseCount,
      people: count(1),
      ownerLinks: count(2),
      breederLinks: count(3),
      importerLinks: count(4),
      passportReceiverLinks: count(5),
      horsesWithBothParents: count(6),
      horsesWithDnaData: count(7),
      openQualityIssues: count(8),
    },
    source: sourceRow?.source_filename && sourceRow.source_sha256 && sourceRow.source_sheet && sourceRow.status ? {
      filename: sourceRow.source_filename,
      sheet: sourceRow.source_sheet,
      rowCount: Number(sourceRow.source_rows ?? 0),
      sha256: sourceRow.source_sha256,
      completedAt: sourceRow.completed_at ?? null,
      status: sourceRow.status,
    } : null,
    capabilities,
    featureCatalog: buildPlatformFeatureCatalog(capabilities),
    health,
    demoAdminLoginAvailable: isDemoAdminLoginAvailable(env),
  });
}

async function registryAnalytics(db: D1Database): Promise<Response> {
  try {
    if (await db.prepare("SELECT 1 AS present FROM horses WHERE deleted_at IS NULL AND is_active<>1 LIMIT 1").first()) {
      return error(409, "public_snapshot_rebuild_required", "This analytics snapshot does not have a verified public-only cohort; rebuild and verify its audience policy before publication");
    }
    const row = await db.prepare(`
      SELECT a.payload_json,s.analytics_stale
      FROM registry_state s LEFT JOIN analytics_snapshots a ON a.key='registry-overview'
      WHERE s.id=1 LIMIT 1
    `).first<{ payload_json?: string; analytics_stale: number }>();
    if (Number(row?.analytics_stale ?? 1) !== 0) {
      return error(409, "analytics_stale", "Registry analytics are stale for the current canonical data revision; rebuild derived analytics before presenting them as current");
    }
    if (!row?.payload_json) return error(503, "analytics_unavailable", "Registry analytics snapshot has not been built yet");
    return json(JSON.parse(row.payload_json));
  } catch {
    return error(503, "analytics_unavailable", "Registry analytics snapshot is unavailable; rebuild derived analytics for this database revision");
  }
}

async function registryFacets(db: D1Database): Promise<Response> {
  const runtime = await loadRuntimeSnapshot(db);
  if (runtime.summary && !runtime.stale) return json({ ...runtime.summary.facets, snapshotStale: false }, publicSnapshotResponseInit(false, true));
  const [breeds, sexes, places, colors, mainStrains, importedFrom, decades, lifecycle, flags] = await db.batch([
    db.prepare(`SELECT breed_desc AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND ${meaningfulSourceTextSql("breed_desc")} GROUP BY breed_desc ORDER BY count DESC,value COLLATE NOCASE LIMIT 40`),
    db.prepare(`SELECT sex_desc AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND ${meaningfulSourceTextSql("sex_desc")} GROUP BY sex_desc ORDER BY count DESC,value COLLATE NOCASE LIMIT 20`),
    db.prepare(`SELECT birth_place_desc AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND ${meaningfulSourceTextSql("birth_place_desc")} GROUP BY birth_place_desc ORDER BY count DESC,value COLLATE NOCASE LIMIT 40`),
    db.prepare(`SELECT color_desc AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND ${meaningfulSourceTextSql("color_desc")} GROUP BY color_desc ORDER BY count DESC,value COLLATE NOCASE LIMIT 40`),
    db.prepare(`SELECT main_strain_desc AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND ${meaningfulSourceTextSql("main_strain_desc")} GROUP BY main_strain_desc ORDER BY count DESC,value COLLATE NOCASE LIMIT 40`),
    db.prepare(`SELECT imported_from_desc AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_imported=1 AND ${meaningfulSourceTextSql("imported_from_desc")} GROUP BY imported_from_desc ORDER BY count DESC,value COLLATE NOCASE LIMIT 40`),
    db.prepare("SELECT CAST(birth_year/10 AS INTEGER)*10 AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND birth_year BETWEEN 1500 AND 2200 GROUP BY CAST(birth_year/10 AS INTEGER)*10 ORDER BY value DESC LIMIT 80"),
    db.prepare("SELECT CASE WHEN is_dead=1 THEN 'deceased' WHEN is_active=1 THEN 'active' ELSE 'inactive' END AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 GROUP BY CASE WHEN is_dead=1 THEN 'deceased' WHEN is_active=1 THEN 'active' ELSE 'inactive' END ORDER BY count DESC"),
    db.prepare(`SELECT value,count FROM (
      SELECT 'imported' AS value,COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_imported=1
      UNION ALL SELECT 'sport',COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_sport=1
      UNION ALL SELECT 'stallion',COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_active=1 AND is_stallion=1
      UNION ALL SELECT 'sport_card',COUNT(*) FROM horses WHERE deleted_at IS NULL AND is_active=1 AND has_sport_card=1
    )`),
  ]);
  return json({ breeds: breeds.results, sexes: sexes.results, places: places.results, colors: colors.results, mainStrains: mainStrains.results, importedFrom: importedFrom.results, decades: decades.results, lifecycle: lifecycle.results, flags: flags.results });
}

async function publicQualitySummary(db: D1Database): Promise<Response> {
  const runtime = await loadRuntimeSnapshot(db);
  if (runtime.summary && !runtime.stale) return json({ ...runtime.summary.quality, snapshotStale: false }, publicSnapshotResponseInit(false, true));
  const [total, severities, codes] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL AND (horse_id IS NULL OR EXISTS(SELECT 1 FROM horses qh WHERE qh.id=data_quality_issues.horse_id AND qh.deleted_at IS NULL AND qh.is_active=1))"),
    db.prepare("SELECT severity AS value,COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL AND (horse_id IS NULL OR EXISTS(SELECT 1 FROM horses qh WHERE qh.id=data_quality_issues.horse_id AND qh.deleted_at IS NULL AND qh.is_active=1)) GROUP BY severity ORDER BY count DESC"),
    db.prepare("SELECT issue_code AS value,COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL AND (horse_id IS NULL OR EXISTS(SELECT 1 FROM horses qh WHERE qh.id=data_quality_issues.horse_id AND qh.deleted_at IS NULL AND qh.is_active=1)) GROUP BY issue_code ORDER BY count DESC LIMIT 12"),
  ]);
  const count = Number((total.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  return json({ openIssues: count, severities: severities.results, topIssueCodes: codes.results });
}

async function listPeople(db: D1Database, url: URL): Promise<Response> {
  const limit = parseBoundedIntegerParam(url.searchParams.get("limit"), 24, 1, 100, "limit");
  const offset = parseBoundedIntegerParam(url.searchParams.get("offset"), 0, 0, 1_000_000, "offset");
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_]/g, " ");
  const where = q ? "p.deleted_at IS NULL AND (p.name_latin LIKE ? COLLATE NOCASE OR p.name_native LIKE ?)" : "p.deleted_at IS NULL";
  const role = url.searchParams.get('role');
  if (role && role !== 'breeder') throw new HttpError(400,'INVALID_ROLE','Unsupported people role');
  const page = (rows: unknown[]) => json({ people: rows.slice(0,limit), limit, offset,
    nextOffset: rows.length > limit && offset + limit <= 1_000_000 ? offset + limit : null });
  const like = q ? d1ContainsLikePattern(q, "q") : null;
  const bindings = like ? [like, like] : [];

  // Normal deployment precomputes role counts once. This removes a 26k-person /
  // 110k-link GROUP BY from every people-page request while returning identical
  // counts and ordering. If the derived model is absent, preserve the old exact path.
  const [ready, materialized] = await db.batch([
    db.prepare(`SELECT 1 AS ready FROM registry_state rs
      WHERE rs.id=1 AND rs.analytics_stale=0
        AND NOT EXISTS(SELECT 1 FROM horse_people visible_hp JOIN horses visible_h ON visible_h.id=visible_hp.horse_id WHERE visible_h.deleted_at IS NOT NULL OR visible_h.is_active<>1)
        AND rs.analytics_source_revision IS NOT NULL
        AND EXISTS(SELECT 1 FROM person_registry_stats ps WHERE ps.source_revision=rs.analytics_source_revision LIMIT 1)`),
    db.prepare(`
      SELECT p.id,p.name_latin,p.name_native,
        ps.owner_count,ps.breeder_count,ps.importer_count,ps.passport_receiver_count,ps.horse_count
      FROM person_registry_stats ps
      JOIN registry_state rs ON rs.id=1 AND rs.analytics_stale=0 AND ps.source_revision=rs.analytics_source_revision
      JOIN people p ON p.id=ps.person_id
      WHERE ${where} ${role ? "AND ps.breeder_count > 0" : ""}
      ORDER BY ps.horse_count DESC,p.name_latin COLLATE NOCASE,p.id
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit+1, offset),
  ]);
  if (ready.results.length) return page(materialized.results);

  const rows = await db.prepare(`
    SELECT p.id,p.name_latin,p.name_native,
      SUM(CASE WHEN hp.role='owner' THEN 1 ELSE 0 END) AS owner_count,
      SUM(CASE WHEN hp.role='breeder' THEN 1 ELSE 0 END) AS breeder_count,
      SUM(CASE WHEN hp.role='importer' THEN 1 ELSE 0 END) AS importer_count,
      SUM(CASE WHEN hp.role='passport_receiver' THEN 1 ELSE 0 END) AS passport_receiver_count,
      COUNT(DISTINCT hp.horse_id) AS horse_count
    FROM people p LEFT JOIN horse_people hp ON hp.person_id=p.id AND EXISTS(SELECT 1 FROM horses visible_h WHERE visible_h.id=hp.horse_id AND visible_h.deleted_at IS NULL AND visible_h.is_active=1)
    WHERE ${where}
    GROUP BY p.id,p.name_latin,p.name_native
    ${role ? "HAVING SUM(CASE WHEN hp.role='breeder' THEN 1 ELSE 0 END)>0" : ""}
    ORDER BY horse_count DESC,p.name_latin COLLATE NOCASE,p.id
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit+1, offset).all();
  return page(rows.results);
}

async function browseHorses(db: D1Database, url: URL): Promise<Response> {
  const plan = compileRegistryQuery(
    url,
    { defaultLimit: 50, maxLimit: 100, maxOffset: 1_000_000 },
    isSupabaseD1Database(db) ? "postgres" : "sqlite",
  );
  // Imported restricted records are private until explicitly activated.
  // Historical materialized counters include inactive rows, so the public
  // page and its total must use the same live visibility predicate.
  plan.where += " AND h.is_active=1";
  const prepareRows = () => shouldDeferRegistryProjection(plan)
    ? db.prepare(registryHorseDeepPageSelectSql(plan)).bind(...plan.bindings, plan.limit, plan.offset)
    : db.prepare(`${registryHorseSelectSql(plan.where)} ORDER BY ${plan.sortSql} ${plan.directionSql}, h.id ASC LIMIT ? OFFSET ?`).bind(...plan.bindings, plan.limit, plan.offset);
  const [rows, totalResult] = await db.batch([
    prepareRows(),
    db.prepare(`SELECT COUNT(*) AS count FROM horses h${plan.countJoinsSql} WHERE ${plan.where}`).bind(...plan.bindings),
  ]);
  return registryBrowseResponse(rows, Number((totalResult.results?.[0] as { count?: number } | undefined)?.count ?? 0), plan);
}

function registryBrowseResponse(rows: D1Result, total: number, plan: ReturnType<typeof compileRegistryQuery>): Response {
  return json({
    rows: rows.results.map((row) => normalizePublicHorseRecord(row as Record<string, unknown>)),
    total, limit: plan.limit, offset: plan.offset,
    nextOffset: plan.offset + plan.limit < total ? plan.offset + plan.limit : null,
    previousOffset: plan.offset > 0 ? Math.max(0, plan.offset - plan.limit) : null,
    sort: plan.requestedSort, dir: plan.direction, filter: plan.filter,
  });
}

function registryPersonDisplayFallbackSql(role: "owner" | "breeder" | "importer" | "passport_receiver", column: "name_latin" | "name_native"): string {
  return `(SELECT p_people.${column}
    FROM horse_people hp_people JOIN people p_people ON p_people.id=hp_people.person_id
    WHERE hp_people.horse_id=h.id AND hp_people.role='${role}' AND hp_people.is_current=1 AND p_people.deleted_at IS NULL
    ORDER BY p_people.name_latin COLLATE NOCASE,p_people.id LIMIT 1)`;
}

function registryHorseProjectionSql(fromSql: string, whereSql = ""): string {
  const person = (role: "owner" | "breeder" | "importer" | "passport_receiver", column: "name_latin" | "name_native", materializedColumn: string) =>
    `COALESCE(ps.${materializedColumn},${registryPersonDisplayFallbackSql(role,column)}) AS ${materializedColumn}`;
  return `SELECT ${PUBLIC_HORSE_COLUMNS_H.replace("h.father_id", "f.id AS father_id").replace("h.mother_id", "m.id AS mother_id")}, f.name_latin AS father_name, f.name_native AS father_name_native, m.name_latin AS mother_name, m.name_native AS mother_name_native,
    ${person("owner","name_latin","owner_name")}, ${person("owner","name_native","owner_name_native")},
    ${person("breeder","name_latin","breeder_name")}, ${person("breeder","name_native","breeder_name_native")},
    ${person("importer","name_latin","importer_name")}, ${person("importer","name_native","importer_name_native")},
    ${person("passport_receiver","name_latin","passport_receiver_name")}, ${person("passport_receiver","name_native","passport_receiver_name_native")}
    ${fromSql}
    LEFT JOIN horses f ON f.id=h.father_id AND f.deleted_at IS NULL AND f.is_active=1
    LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
    LEFT JOIN registry_state rs_people ON rs_people.id=1
    LEFT JOIN horse_registry_people_summary ps ON ps.horse_id=h.id AND rs_people.analytics_stale=0 AND ps.source_revision=rs_people.analytics_source_revision${whereSql ? ` WHERE ${whereSql}` : ""}`;
}

function registryHorseSelectSql(where: string): string {
  return registryHorseProjectionSql("FROM horses h", where);
}

function registryHorseDeepPageSelectSql(plan: ReturnType<typeof compileRegistryQuery>): string {
  return `WITH page_ids AS MATERIALIZED (
      SELECT h.id FROM horses h${plan.countJoinsSql}
      WHERE ${plan.where}
      ORDER BY ${plan.sortSql} ${plan.directionSql}, h.id ASC
      LIMIT ? OFFSET ?
    )
    ${registryHorseProjectionSql("FROM page_ids page JOIN horses h ON h.id=page.id")}
    ORDER BY ${plan.sortSql} ${plan.directionSql}, h.id ASC`;
}

function shouldDeferRegistryProjection(plan: ReturnType<typeof compileRegistryQuery>): boolean {
  // Deep OFFSET normally causes SQLite/D1 to evaluate the expensive public-row
  // projection (parent/people joins) for rows that are discarded. Page IDs first
  // once the skip is large, then project only the requested <=100 rows.
  return plan.offset >= 10_000;
}

async function exportRegistry(request: Request, env: Env, url: URL): Promise<Response> {
  // Semantic permission authority (D17): the shared role->permission mapping grants
  // registry.export to admin/super-admin; the frontend hides the entry point on the same capability.
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "registry.export");
  const db = env.DB;
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const plan = compileRegistryQuery(url, { defaultLimit: REGISTRY_EXPORT_ROWS_MAX, maxLimit: REGISTRY_EXPORT_ROWS_MAX, maxOffset: 1_000_000 }, isSupabaseD1Database(db) ? "postgres" : "sqlite");
  const exportSql = shouldDeferRegistryProjection(plan)
    ? registryHorseDeepPageSelectSql(plan)
    : `${registryHorseSelectSql(plan.where)} ORDER BY ${plan.sortSql} ${plan.directionSql}, h.id ASC LIMIT ? OFFSET ?`;
  const result = await db.prepare(exportSql).bind(...plan.bindings, plan.limit, plan.offset).all();
  const rows = result.results.map((row) => normalizePublicHorseRecord(row as Record<string, unknown>));
  const headers = new Headers({
    "content-disposition": `attachment; filename="horse-registry-export.${format}"`,
    "cache-control": "no-store",
    "x-horse-db-export-limit": String(plan.limit),
  });
  if (format === "json") {
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ schemaVersion: "1.0", generatedAt: new Date().toISOString(), limit: plan.limit, offset: plan.offset, rows }, null, 2), { headers });
  }
  headers.set("content-type", "text/csv; charset=utf-8");
  const columns = ["id","name_latin","name_native","register_no","birth_year","birth_place_desc","breed_desc","sex_desc","color_desc","main_strain_desc","sub_strain_desc","father_id","father_name","mother_id","mother_name","owner_name","breeder_name","importer_name","passport_receiver_name","dna_status","originality","is_active","is_dead","is_imported","imported_from_desc","is_sport","is_stallion","has_sport_card"] as const;
  const esc = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  };
  const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => esc((row as Record<string, unknown>)[key])).join(","))].join("\r\n");
  return new Response(`\uFEFF${csv}`, { headers });
}

async function demoAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!isDemoAdminLoginAvailable(env) || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname)) throw new HttpError(404, "not_found", "Route not found");
  requireSameOriginMutation(request);
  const marker = await env.DB.prepare("SELECT namespace FROM local_demo_manifest WHERE id=1").first<{namespace:string}>();
  if (marker?.namespace !== "synthetic:r111") throw new HttpError(404, "not_found", "Route not found");
  const raw = request.headers.get("content-length") === "0" || !request.body ? {} : await readJson<unknown>(request, 2 * 1024);
  const parsed = z.object({ persona: z.enum(["admin","owner_a","owner_b","reviewer","provider","manager","staff"]).default("admin") }).strict().safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid_demo_persona", "Choose one of the fixed fictional demo personas");
  // The persona allowlist and seeded account determine authority. Client user
  // IDs, roles and passwords are never accepted and removed roles stay removed.
  const user = await env.DB.prepare("SELECT u.* FROM local_demo_personas p JOIN users u ON u.id=p.user_id AND u.role=p.role WHERE p.persona_key=? AND u.is_active=1 AND u.password_hash='demo-route-only'")
    .bind(parsed.data.persona).first<UserRow>();
  if (!user) throw new HttpError(403, "demo_persona_unavailable", "This fictional persona is disabled or its authority changed; reset the stopped demo to restore its baseline");
  const previous = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  if (previous) requireCsrf(request, previous);
  const session = await createSession(env.DB, user.id, request);
  if (previous) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(previous.sessionId).run();
  await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
  const response = json({ user: publicUser(user), csrfToken: session.csrfToken, permissions: capabilitiesForRole(user.role), demo: true, persona: parsed.data.persona, sessionExpiresAt: session.expiresAt });
  response.headers.append("set-cookie", sessionCookie(env.SESSION_COOKIE_NAME, session.token, session.expiresAt, isSecureRequest(request)));
  return response;
}

async function login(request: Request, env: Env): Promise<Response> {
  const parsed = LoginSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_login", "Invalid email or password format");
  const user = await env.DB.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE AND is_active=1")
    .bind(parsed.data.email).first<UserRow>();
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    // Deliberately generic response.
    throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
  }
  const session = await createSession(env.DB, user.id, request);
  await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
  const response = json({ user: publicUser(user), csrfToken: session.csrfToken, permissions: capabilitiesForRole(user.role) });
  response.headers.append("set-cookie", sessionCookie(env.SESSION_COOKIE_NAME, session.token, session.expiresAt, isSecureRequest(request)));
  return response;
}

async function logout(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  if (auth) {
    requireCsrf(request, auth);
    await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(auth.sessionId).run();
  }
  const response = json({ ok: true });
  response.headers.append("set-cookie", clearSessionCookie(env.SESSION_COOKIE_NAME, isSecureRequest(request)));
  return response;
}

async function me(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  if (!auth) return json({ user: null, csrfToken: null, permissions: [] });
  return json({ user: auth.user, csrfToken: auth.csrfToken, permissions: capabilitiesForRole(auth.user.role) });
}

async function getHorse(db: D1Database, id: number): Promise<Response> {
  // R132 PERFORMANCE: the profile lookup, people and aliases used to run as
  // one query followed by a batch — two sequential Hyperdrive round trips
  // (~1.5-2s). All three statements are pre-bound, so a single ordered batch
  // preserves the exact D1 semantics at one round trip.
  const [profile, people, aliases] = await db.batch([
    db.prepare(`
      SELECT ${PUBLIC_HORSE_PROFILE_COLUMNS_H.replace("h.father_id", "f.id AS father_id").replace("h.mother_id", "m.id AS mother_id")},
        f.name_latin AS father_name,
        f.name_native AS father_name_native,
        m.name_latin AS mother_name,
        m.name_native AS mother_name_native
      FROM horses h
      LEFT JOIN horses f ON f.id=h.father_id AND f.deleted_at IS NULL AND f.is_active=1
      LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
      WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1
    `).bind(id),
    db.prepare(`
      SELECT hp.role, hp.is_current, p.id, p.name_latin, p.name_native
      FROM horse_people hp JOIN people p ON p.id=hp.person_id
      WHERE hp.horse_id=? AND p.deleted_at IS NULL ORDER BY hp.role, p.name_latin
    `).bind(id),
    // R59: Supabase is the full canonical database — horse_aliases exists there
    // like everywhere else, so both providers share the same query path.
    db.prepare(`
      SELECT id,alias,language,alias_type,source FROM horse_aliases WHERE horse_id=? ORDER BY alias_type,alias COLLATE NOCASE
    `).bind(id),
  ]);
  const horse = profile.results?.[0] as (PublicHorseProfileRow & { father_name: string | null; father_name_native: string | null; mother_name: string | null; mother_name_native: string | null }) | undefined;
  if (!horse) return error(404, "not_found", "Horse not found");
  // T12: assemble the typed-date facts (value + precision + explicit calendar)
  // next to the raw columns, so clients can render Solar Hijri in the Persian
  // UI without re-implementing the storage projection.
  const horseRecord = normalizePublicHorseRecord(horse as Record<string, unknown>) as Record<string, unknown>;
  horseRecord.birth_date_typed = assembleTypedDateField(horseRecord, "birth");
  horseRecord.death_date_typed = assembleTypedDateField(horseRecord, "death");
  horseRecord.castration_date_typed = assembleTypedDateField(horseRecord, "castration");
  return json({ horse: horseRecord, people: people.results, aliases: aliases.results });
}

// Master-Ai plan T12: public lifecycle history with uncertain-time honesty.
async function horseLifecycle(db: D1Database, id: number): Promise<Response> {
  // R132 PERFORMANCE: existence + events in one ordered batch (one Hyperdrive
  // round trip instead of two sequential ones).
  const [exists, events] = await db.batch([
    db.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(id),
    db.prepare(`
      SELECT e.id,e.event_type,e.date_value,e.date_precision,e.date_calendar,e.uncertain_time,e.note,e.source_ref,e.created_at
      FROM horse_lifecycle_events e
      WHERE e.horse_id=?
      ORDER BY e.date_value DESC,e.id DESC
    `).bind(id),
  ]);
  if (!exists.results?.length) return error(404, "not_found", "Horse not found");
  return json({ horse_id: id, events: events.results });
}

// Master-Ai plan T12: public historical ownership periods (title facts, not
// permissions — grants live in horse_access_grants, T10 doctrine).
async function horseOwnership(db: D1Database, id: number): Promise<Response> {
  // R132 PERFORMANCE: existence + periods in one ordered batch (one Hyperdrive
  // round trip instead of two sequential ones).
  const [exists, periods] = await db.batch([
    db.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(id),
    db.prepare(`
      SELECT o.id,o.owner_person_id,p.name_latin AS owner_name_latin,p.name_native AS owner_name_native,
        o.start_value,o.start_precision,o.start_calendar,o.end_value,o.end_precision,o.end_calendar,o.share_percent
      FROM horse_ownership_periods o
      JOIN people p ON p.id=o.owner_person_id
      WHERE o.horse_id=? AND p.deleted_at IS NULL
      ORDER BY o.start_value DESC,o.id DESC
    `).bind(id),
  ]);
  if (!exists.results?.length) return error(404, "not_found", "Horse not found");
  return json({ horse_id: id, periods: periods.results });
}

// T12: staff-curated ownership period with precision-aware overlap and
// co-ownership share-sum guards. A DEFINITE overlap is a conflict (409); a
// POSSIBLE overlap (year-precision ambiguity) is allowed but reported, because
// the stored facts cannot prove the two periods truly intersect.
async function adminCreateOwnershipPeriod(request: Request, env: Env, horseId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  requireCsrf(request, auth);
  const raw = await readJson<unknown>(request, 16 * 1024);
  const validated = validateOwnershipPeriodInput(raw);
  if (!validated.ok) {
    throw new HttpError(422, "invalid_ownership_period", "The ownership period failed validation", { issues: validated.issues.map((issue) => issue.message) });
  }
  const payload = (typeof raw === "object" && raw !== null ? raw : {}) as { owner_person_id?: unknown; share_percent?: unknown; evidence_note?: unknown; source?: unknown };
  const ownerPersonId = Number(payload.owner_person_id);
  const sharePercent = payload.share_percent == null ? null : Number(payload.share_percent);
  const horse = await env.DB.prepare("SELECT id,row_version FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first<{ id: number; row_version: number }>();
  if (!horse) return error(404, "not_found", "Horse not found");
  const person = await env.DB.prepare("SELECT id FROM people WHERE id=? AND deleted_at IS NULL").bind(ownerPersonId).first();
  if (!person) throw new HttpError(422, "unknown_owner_person", "The owner person record does not exist");
  const existing = await env.DB.prepare(`
    SELECT id,owner_person_id,start_value,start_precision,start_calendar,end_value,end_precision,end_calendar,share_percent
    FROM horse_ownership_periods WHERE horse_id=?
  `).bind(horseId).all<OwnershipPeriodRow>();
  const candidate: OwnershipPeriodRow = {
    id: -1,
    owner_person_id: ownerPersonId,
    start_value: validated.period.start.value,
    start_precision: validated.period.start.precision,
    start_calendar: validated.period.start.calendar,
    end_value: validated.period.end ? validated.period.end.value : null,
    end_precision: validated.period.end ? validated.period.end.precision : null,
    end_calendar: validated.period.end ? validated.period.end.calendar : null,
    share_percent: sharePercent,
  };
  const overlaps = detectOwnershipOverlaps(existing.results, candidate);
  const definite = overlaps.filter((finding) => finding.kind === "definite");
  if (definite.length) {
    throw new HttpError(409, "ownership_overlap", "This period definitely overlaps an existing ownership period for this horse", {
      overlapping_period_ids: definite.map((finding) => finding.periodId),
    });
  }
  if (ownershipShareSumExceeded(overlaps, existing.results, sharePercent)) {
    throw new HttpError(409, "ownership_share_sum_exceeded", "The co-ownership shares of the overlapping periods exceed 100 percent of the horse");
  }
  const evidenceNote = typeof payload.evidence_note === "string" ? payload.evidence_note.trim().slice(0, 2000) : null;
  const source = typeof payload.source === "string" ? payload.source.trim().slice(0, 500) : null;
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const batchResults = await env.DB.batch([
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "ownership_period.create", entityType: "horse", entityId: String(horseId),
      requested: raw, requestId: reqId, searchStatus: "not_applicable",
    }),
    env.DB.prepare(`UPDATE horses SET row_version=row_version+1,last_mutation_id=? WHERE id=? AND deleted_at IS NULL AND row_version=?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))
      AND EXISTS(SELECT 1 FROM people WHERE id=? AND deleted_at IS NULL)`)
      .bind(mutationId, horseId, horse.row_version, auth.user.id, ownerPersonId),
    ownershipPeriodInsertStatement(env.DB, {
      horseId,
      ownerPersonId,
      period: validated.period,
      sharePercent,
      evidenceNote,
      source,
      createdByUserId: auth.user.id,
      mutationId,
    }),
  ]);
  // Every ownership acceptance advances the horse version. Concurrent
  // proposals that read the same periods cannot both pass this CAS, and the
  // period insert is conditioned on this transaction's successful marker.
  if (Number(batchResults[1]?.meta.changes ?? 0) !== 1 || Number(batchResults[2]?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "ownership acceptance precondition changed"); } catch {}
    throw new HttpError(409, "ownership_conflict", "The horse or ownership history changed; reload and review the periods");
  }
  const insertedPeriodId = Number(batchResults[2]?.meta.last_row_id ?? 0);
  if (!insertedPeriodId) {
    throw new HttpError(503, "ownership_receipt_unavailable", "The period may have been committed; read the ownership history before retrying");
  }
  const period = await env.DB.prepare(`
    SELECT o.id,o.owner_person_id,p.name_latin AS owner_name_latin,p.name_native AS owner_name_native,
      o.start_value,o.start_precision,o.start_calendar,o.end_value,o.end_precision,o.end_calendar,o.share_percent,o.evidence_note,o.source,o.created_at
    FROM horse_ownership_periods o JOIN people p ON p.id=o.owner_person_id
    WHERE o.id=? AND p.deleted_at IS NULL
  `).bind(insertedPeriodId).first();
  await settleWorkflowMutation(env.DB, mutationId, String(horseId), auth.user.id, "ownership_period.create", "horse", null, period, reqId);
  return json({
    period,
    possible_overlap_period_ids: overlaps.filter((finding) => finding.kind === "possible").map((finding) => finding.periodId),
  }, { status: 201 });
}

// T12: staff-recorded lifecycle event (history) — a death or castration event
// also lands the canonical typed-date fact on the horse row in the SAME
// guarded batch, so the searchable record never disagrees with the history.
async function adminCreateLifecycleEvent(request: Request, env: Env, horseId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  requireCsrf(request, auth);
  const raw = await readJson<unknown>(request, 16 * 1024);
  const validated = validateLifecycleEventInput(raw);
  if (!validated.ok) throw new HttpError(422, "invalid_lifecycle_event", validated.message);
  const horse = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first<HorseRow>();
  if (!horse) return error(404, "not_found", "Horse not found");
  const event = validated.event;
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  // Death/castration events carry the canonical typed-date fact; every other
  // event type is history-only (the horse row keeps its current facts).
  const canonicalField = event.eventType === "death" ? "death_date" : event.eventType === "castration" ? "castration_date" : null;
  const statements: D1PreparedStatement[] = [
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "lifecycle_event.create", entityType: "horse", entityId: String(horseId),
      requested: raw, requestId: reqId, searchStatus: canonicalField ? "pending" : "not_applicable",
    }),
  ];
  let plan: ReturnType<typeof planHorseMutation> | null = null;
  let lifecyclePolicy: import("../registry/ruleCommit").RegistryPolicyCommit | undefined;
  if (canonicalField) {
    plan = planHorseMutation(horse, { [canonicalField]: { value: event.date.value, precision: event.date.precision, calendar: event.date.calendar } });
    const lifecycleSubject = await buildRuleSubject(env.DB, {
      subjectType: "horse_update", subjectRef: horseId,
      record: { ...horse, horse_id: horseId,
        ...(canonicalField === "death_date" ? { is_dead: 1, life_status: "dead", death_date_value: event.date.value, death_date_precision: event.date.precision, death_date_calendar: event.date.calendar }
          : { castration_date_value: event.date.value, castration_date_precision: event.date.precision, castration_date_calendar: event.date.calendar }) },
      includeEvidenceCounts: true,
    });
    const lifecycleRules = await enforceRegistryRules(env.DB, lifecycleSubject, []);
    lifecyclePolicy = { subject: lifecycleSubject, ...lifecycleRules, operationId: mutationId, actorUserId: auth.user.id };
    const built = buildCanonicalHorseUpdateStatements(env.DB, {
      plan, horseId, expectedRowVersion: horse.row_version, mutationId,
      identifierTableReady: await identifierTableReady(env.DB),
      additionalGuard: { sql: "EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))", bindings: [auth.user.id] },
    });
    statements.push(built.updateStatement,
      lifecycleEventInsertStatement(env.DB, { horseId, event, createdByUserId: auth.user.id, mutationId }),
      ...built.afterUpdateStatements);
  } else {
    statements.push(
      env.DB.prepare(`UPDATE horses SET row_version=row_version+1,last_mutation_id=? WHERE id=? AND deleted_at IS NULL AND row_version=?
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))`)
        .bind(mutationId, horseId, horse.row_version, auth.user.id),
      lifecycleEventInsertStatement(env.DB, { horseId, event, createdByUserId: auth.user.id, mutationId }),
    );
  }
  const results = lifecyclePolicy
    ? await runGuardedHorseBatch(env.DB, statements, plan?.effectiveIdentifierChanges ?? {}, { policy: lifecyclePolicy })
    : await env.DB.batch(statements);
  if (Number(results[1]?.meta.changes ?? 0) !== 1 || Number(results[2]?.meta.changes ?? 0) !== 1) {
    try { await abortCanonicalMutation(env.DB, mutationId, "lifecycle acceptance precondition changed"); } catch {}
    throw new HttpError(409, "edit_conflict", "The horse changed while the lifecycle event was being recorded. Reload and retry.", { current_row_version: horse.row_version });
  }
  const events = await env.DB.prepare(`
    SELECT e.id,e.event_type,e.date_value,e.date_precision,e.date_calendar,e.uncertain_time,e.note,e.source_ref,e.created_at
    FROM horse_lifecycle_events e WHERE e.horse_id=? ORDER BY e.date_value DESC,e.id DESC
  `).bind(horseId).all();
  if (canonicalField) {
    await settleCanonicalHorseMutation(env.DB, mutationId, horseId, auth.user.id, "lifecycle_event.create", horse, null, reqId);
  } else {
    await settleWorkflowMutation(env.DB, mutationId, String(horseId), auth.user.id, "lifecycle_event.create", "horse", null, events.results[0] ?? null, reqId);
  }
  return json({ events: events.results, canonical_field_updated: canonicalField }, { status: 201 });
}

async function getPerson(db: D1Database, id: number): Promise<Response> {
  const materialized = await db.prepare(`
    SELECT p.id,p.name_latin,p.name_native,
      ps.profile_owner_count AS owner_count,ps.profile_breeder_count AS breeder_count,
      ps.profile_importer_count AS importer_count,ps.profile_passport_receiver_count AS passport_receiver_count,
      ps.profile_horse_count AS horse_count,
      EXISTS(SELECT 1 FROM horse_people visible_hp JOIN horses visible_h ON visible_h.id=visible_hp.horse_id WHERE visible_hp.person_id=p.id AND (visible_h.deleted_at IS NOT NULL OR visible_h.is_active<>1)) AS has_private_links,
      rs.analytics_stale,rs.analytics_source_revision,ps.source_revision AS stats_source_revision
    FROM people p
    CROSS JOIN registry_state rs
    LEFT JOIN person_registry_stats ps ON ps.person_id=p.id
    WHERE p.id=? AND p.deleted_at IS NULL
  `).bind(id).first<Record<string, unknown>>();
  if (!materialized) return error(404, "not_found", "Person not found");

  const statsFresh = Number(materialized.analytics_stale ?? 1) === 0
    && Number(materialized.has_private_links ?? 1) === 0
    && typeof materialized.analytics_source_revision === "string"
    && materialized.analytics_source_revision === materialized.stats_source_revision;
  let person: Record<string, unknown>;
  if (statsFresh) {
    const { analytics_stale, analytics_source_revision, stats_source_revision, has_private_links, ...publicPerson } = materialized;
    person = publicPerson;
  } else {
    const exact = await db.prepare(`
      SELECT p.id,p.name_latin,p.name_native,
        (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.person_id=p.id AND hp.role='owner' AND h.deleted_at IS NULL AND h.is_active=1) AS owner_count,
        (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.person_id=p.id AND hp.role='breeder' AND h.deleted_at IS NULL AND h.is_active=1) AS breeder_count,
        (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.person_id=p.id AND hp.role='importer' AND h.deleted_at IS NULL AND h.is_active=1) AS importer_count,
        (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.person_id=p.id AND hp.role='passport_receiver' AND h.deleted_at IS NULL AND h.is_active=1) AS passport_receiver_count,
        (SELECT COUNT(DISTINCT hp.horse_id) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id WHERE hp.person_id=p.id AND h.deleted_at IS NULL AND h.is_active=1) AS horse_count
      FROM people p WHERE p.id=? AND p.deleted_at IS NULL
    `).bind(id).first<Record<string, unknown>>();
    if (!exact) return error(404, "not_found", "Person not found");
    person = exact;
  }

  const rows = await db.prepare(`
    SELECT hp.role,h.id,h.name_latin,h.name_native,h.birth_year,h.breed_desc,h.sex_desc,h.color_desc,
      (SELECT id FROM horses parent WHERE parent.id=h.father_id AND parent.deleted_at IS NULL AND parent.is_active=1) AS father_id,
      (SELECT id FROM horses parent WHERE parent.id=h.mother_id AND parent.deleted_at IS NULL AND parent.is_active=1) AS mother_id,
      h.register_no,h.birth_place_desc,h.is_active,h.is_dead,h.main_strain_desc,h.sub_strain_desc
    FROM horse_people hp JOIN horses h ON h.id=hp.horse_id
    WHERE hp.person_id=? AND h.deleted_at IS NULL AND h.is_active=1
    ORDER BY hp.is_current DESC,h.birth_year DESC,h.name_latin COLLATE NOCASE LIMIT 101
  `).bind(id).all();
  return json({ person, horses: rows.results.slice(0,100).map((horse) => normalizePublicHorseRecord(horse as Record<string, unknown>)), truncated: rows.results.length > 100 });
}

async function getAdminHorse(request: Request, env: Env, id: number): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  const horse = await env.DB.prepare(`SELECT ${ADMIN_HORSE_DETAIL_COLUMNS} FROM horses WHERE id=? AND deleted_at IS NULL`)
    .bind(id).first();
  if (!horse) return error(404, "not_found", "Horse not found");
  return json({ horse });
}

async function createHorse(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  requireCsrf(request, auth);
  const parsed = HorseCreateSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_horse", "Horse data failed validation", parsed.error.flatten());
  const d = parsed.data;
  // R148 Task 6: direct-create retry idempotency. The client's stable command
  // key binds (actor, action, key) -> request digest. Same key + same content
  // replays the original result; the same key with different content is
  // refused; the receipt commits in the SAME batch as the creation.
  const commandKey = d.command_key;
  const commandDigest = commandKey
    ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson({ ...d, command_key: null }))).then((bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""))
    : null;
  if (commandKey && commandDigest) {
    const existing = await env.DB.prepare(
      "SELECT request_digest,entity_id FROM canonical_command_receipts WHERE actor_user_id=? AND action='horse.create' AND command_key=?"
    ).bind(auth.user.id, commandKey).first<{ request_digest: string; entity_id: string }>();
    if (existing) {
      if (existing.request_digest !== commandDigest) {
        throw new HttpError(409, "command_key_reuse", "This creation command key was already used with different content. Mint a fresh command key instead of reusing it.");
      }
      const replayHorse = await env.DB.prepare(`SELECT ${ADMIN_HORSE_DETAIL_COLUMNS} FROM horses WHERE id=?`).bind(Number(existing.entity_id)).first();
      if (replayHorse) return json({ horse: replayHorse, idempotent_replay: true }, { status: 201 });
      // The receipt exists but its entity is gone (archived after create):
      // fall through and refuse the key — replay cannot resurrect it.
      throw new HttpError(409, "command_key_reuse", "This creation command key already produced a record that no longer exists. Mint a fresh command key.");
    }
  }
  await assertValidParentAssignment(env.DB, parsed.data.id ?? null, parsed.data.father_id, parsed.data.mother_id);
  await assertNoLiveHorseDuplicates(env.DB, parsed.data.id ?? null, parsed.data);
  // T12: typed dates parse through the shared calendar validation; a typed
  // birth date seeds the legacy birth_year bucket (search/filter projection).
  const birthTyped = parseTypedDateForHorseCreate("birth_date", d.birth_date);
  const deathTyped = parseTypedDateForHorseCreate("death_date", d.death_date);
  const castrationTyped = parseTypedDateForHorseCreate("castration_date", d.castration_date);
  validateRegistrationDetails(d);
  // R146-D04: the SAME rule engine the reviewed and import paths use.
  // Zero active rules = no-op, so this ships dark and is turned on rule by rule.
  const createRuleSubject = await buildRuleSubject(env.DB, {
    subjectType: "horse_create", subjectRef: d.id ?? null, includeEvidenceCounts: false,
    record: {
      horse_id: d.id ?? null,
      name_latin: d.name_latin ?? null,
      breed_desc: d.breed_desc ?? null,
      sex_desc: d.sex_desc ?? null,
      register_no: d.register_no ?? null,
      microchip_no: d.microchip_no ?? null,
      birth_year: d.birth_year ?? birthTyped.gregorianYear ?? null,
      birth_date_value: d.birth_date?.value ?? null,
      birth_date_precision: d.birth_date?.precision ?? null,
      birth_date_calendar: d.birth_date?.calendar ?? null,
      death_date_value: d.death_date?.value ?? null,
      death_date_precision: d.death_date?.precision ?? null,
      death_date_calendar: d.death_date?.calendar ?? null,
      is_dead: d.death_date != null || d.life_status === "dead" ? 1 : 0,
      father_id: d.father_id ?? null,
      mother_id: d.mother_id ?? null,
    },
  });
  const createRules = await enforceRegistryRules(env.DB, createRuleSubject, d.rule_overrides);
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  // Auto and explicit IDs claim live identifiers atomically with the horse.
  const identifiersReady = await identifierTableReady(env.DB);
  const createIdentifierChanges = { register_no: d.register_no ?? null, microchip_no: d.microchip_no ?? null,
    passport_no: d.passport_no ?? null, passport_issuer: d.passport_issuer ?? null, uel_no: d.uel_no ?? null,
    life_number: d.life_number ?? null, foreign_registration_no: d.foreign_registration_no ?? null,
    foreign_registration_issuer: d.foreign_registration_issuer ?? null };
  const identifierStatements = identifierStatementsForHorseCreate(env.DB, {
    mutationId, identifierTableReady: identifiersReady,
    changes: createIdentifierChanges,
  });
  const createStatements: D1PreparedStatement[] = [
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "horse.create", entityType: "horse",
      entityId: d.id == null ? null : String(d.id), requested: d, requestId: reqId, searchStatus: "pending",
    }),
    // R148 Task 6: the command receipt claims the (actor, action, key) slot
    // FIRST; the creation below only lands while this receipt is the current
    // one for the exact digest, so concurrent duplicates produce one horse.
    ...(commandKey && commandDigest ? [
      env.DB.prepare("INSERT OR IGNORE INTO canonical_command_receipts(actor_user_id,action,command_key,request_digest,entity_type,entity_id) VALUES(?,'horse.create',?,?, 'horse', ?)")
        .bind(auth.user.id, commandKey, commandDigest, d.id == null ? "pending" : String(d.id)),
    ] : []),
    env.DB.prepare(`
      INSERT INTO horses(id,name_latin,name_native,register_no,microchip_no,father_id,mother_id,birth_year,birth_place_desc,breed_desc,sex_desc,color_desc,description,main_strain_desc,sub_strain_desc,
        birth_date_value,birth_date_precision,birth_date_calendar,
        death_date_value,death_date_precision,death_date_calendar,
        castration_date_value,castration_date_precision,castration_date_calendar,
        birth_city,birth_province,keeping_city,keeping_province,precise_address,
        is_dead,last_mutation_id)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?,
        ?,?
      WHERE 1=1 ${HORSE_UPDATE_PARENTAGE_GUARD_SQL}
        ${commandKey && commandDigest ? "AND EXISTS(SELECT 1 FROM canonical_command_receipts WHERE actor_user_id=? AND action='horse.create' AND command_key=? AND request_digest=?)" : ""}
    `).bind(d.id ?? null, d.name_latin, d.name_native ?? null, d.register_no ?? null, d.microchip_no ?? null,
      d.father_id ?? null, d.mother_id ?? null,
      d.birth_date != null ? birthTyped.gregorianYear : (d.birth_year ?? null),
      d.birth_place_desc ?? null,
      d.breed_desc ?? null, d.sex_desc ?? null, d.color_desc ?? null, d.description ?? null, d.main_strain_desc ?? null, d.sub_strain_desc ?? null,
      ...typedDateTriple(birthTyped), ...typedDateTriple(deathTyped), ...typedDateTriple(castrationTyped),
      d.birth_city ?? null, d.birth_province ?? null, d.keeping_city ?? null, d.keeping_province ?? null, d.precise_address ?? null,
      // A death date on create states the horse died (T12).
      (d.death_date != null ? 1 : 0), mutationId,
      d.father_id ?? null, d.mother_id ?? null, d.id ?? null,
      ...(commandKey && commandDigest ? [auth.user.id, commandKey, commandDigest] : [])),
    ...registrationDetailCreateStatements(env.DB, d, mutationId),
    ...identifierStatements,
    env.DB.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL)").bind(mutationId),
    env.DB.prepare("UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL)").bind(mutationId),
    // R148 Task 6: bind the receipt to the actual created horse id inside the
    // same transaction (auto-ID cases insert the receipt before the id exists).
    ...(commandKey && commandDigest ? [
      env.DB.prepare("UPDATE canonical_command_receipts SET entity_id=(SELECT id FROM horses WHERE last_mutation_id=?) WHERE actor_user_id=? AND action='horse.create' AND command_key=? AND entity_id='pending'")
        .bind(mutationId, auth.user.id, commandKey),
    ] : []),
  ];
  const horseInsertIndex = 1 + (commandKey && commandDigest ? 1 : 0);
  const results = await runGuardedHorseBatch(env.DB, createStatements, createIdentifierChanges, { graphLock: true, policy: { subject: createRuleSubject, ...createRules, operationId: mutationId, actorUserId: auth.user.id } });
  const result = results[horseInsertIndex];
  if (!result?.meta.changes) {
    try { await abortCanonicalMutation(env.DB, mutationId, "parentage precondition changed during creation"); } catch {}
    // R148 Task 6: a no-op creation under a command key means a concurrent
    // request on the SAME key won — replay the winner instead of reporting a
    // pedigree conflict that never happened.
    if (commandKey) {
      const winner = await env.DB.prepare(
        "SELECT request_digest,entity_id FROM canonical_command_receipts WHERE actor_user_id=? AND action='horse.create' AND command_key=?"
      ).bind(auth.user.id, commandKey).first<{ request_digest: string; entity_id: string }>();
      if (winner && winner.request_digest === commandDigest) {
        const replayHorse = await env.DB.prepare(`SELECT ${ADMIN_HORSE_DETAIL_COLUMNS} FROM horses WHERE id=?`).bind(Number(winner.entity_id)).first();
        if (replayHorse) return json({ horse: replayHorse, idempotent_replay: true }, { status: 201 });
      }
    }
    throw new HttpError(409, "pedigree_precondition_changed", "A proposed parent or pedigree changed while saving. Nothing was created. Reload and review the parents before retrying.");
  }
  const horseId = d.id ?? Number(result?.meta.last_row_id);
  const after = await env.DB.prepare("SELECT * FROM horses WHERE id=?").bind(horseId).first();
  await settleCanonicalHorseMutation(env.DB, mutationId, horseId, auth.user.id, "horse.create", null, after ?? d, reqId);
  const responseHorse = await env.DB.prepare(`SELECT ${ADMIN_HORSE_DETAIL_COLUMNS} FROM horses WHERE id=?`).bind(horseId).first();
  return json({ horse: responseHorse }, { status: 201 });
}


async function updateHorse(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  requireCsrf(request, auth);
  const parsed = HorseUpdateSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_horse", "Horse data failed validation", parsed.error.flatten());
  const changes = parsed.data.changes;
  if (!Object.keys(changes).length) throw new HttpError(400, "empty_update", "No fields supplied");

  const before = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(id).first<HorseRow>();
  if (!before) return error(404, "not_found", "Horse not found");

  // T07: one typed plan — normalized values only, parentage + identifier +
  // search-impact flags computed once, shared with the reviewed apply path.
  let plan;
  try {
    plan = planHorseMutation(before, changes);
  } catch (cause) {
    if (cause instanceof MutationPlanError) {
      throw new HttpError(cause.code === "unsupported_field" ? 400 : 422, cause.code, cause.message);
    }
    throw cause;
  }

  await assertNoLiveHorseDuplicates(env.DB, id, changes);
  if (plan.parentageChanged) {
    await assertValidParentAssignment(env.DB, id, plan.nextFather, plan.nextMother);
  }
  if (before.row_version !== parsed.data.expected_row_version) {
    throw new HttpError(409, "edit_conflict", "This horse was changed by someone else. Reload before saving.", { current_row_version: before.row_version });
  }
  // R146-D04: evaluate the PROPOSED combined record (before + changes) with
  // the same engine as every other write path. Zero active rules = no-op.
  const mergedForRules: Record<string, unknown> = { ...before };
  for (const [field, value] of Object.entries(plan.normalizedChanges)) {
    mergedForRules[field] = value;
    // Typed-date changes arrive as { __typedDate, date, gregorianYear } markers;
    // project them onto the canonical value columns the rule engine reads.
    if (field === "birth_date" && value != null && typeof value === "object" && "__typedDate" in (value as object)) {
      const marker = value as { date?: { value?: string; precision?: string; calendar?: string } | null; gregorianYear?: number | null };
      mergedForRules.birth_date_value = marker.date?.value ?? null;
      mergedForRules.birth_date_precision = marker.date?.precision ?? null;
      mergedForRules.birth_date_calendar = marker.date?.calendar ?? null;
      if (marker.gregorianYear != null) mergedForRules.birth_year = marker.gregorianYear;
    }
    if (field === "death_date" && value != null && typeof value === "object" && "__typedDate" in (value as object)) {
      const marker = value as { date?: { value?: string; precision?: string; calendar?: string } | null };
      mergedForRules.death_date_value = marker.date?.value ?? null;
      mergedForRules.death_date_precision = marker.date?.precision ?? null;
      mergedForRules.death_date_calendar = marker.date?.calendar ?? null;
      if (marker.date != null) mergedForRules.is_dead = 1;
    }
  }
  const updateRuleSubject = await buildRuleSubject(env.DB, {
    subjectType: "horse_update", subjectRef: id, includeEvidenceCounts: true,
    record: {
      horse_id: id,
      name_latin: mergedForRules.name_latin == null ? null : String(mergedForRules.name_latin),
      breed_desc: mergedForRules.breed_desc == null ? null : String(mergedForRules.breed_desc),
      sex_desc: mergedForRules.sex_desc == null ? null : String(mergedForRules.sex_desc),
      register_no: mergedForRules.register_no == null ? null : String(mergedForRules.register_no),
      microchip_no: mergedForRules.microchip_no == null ? null : String(mergedForRules.microchip_no),
      birth_year: mergedForRules.birth_year == null ? null : Number(mergedForRules.birth_year),
      birth_date_value: (mergedForRules as Record<string, unknown>).birth_date_value == null ? null : String((mergedForRules as Record<string, unknown>).birth_date_value),
      birth_date_precision: mergedForRules.birth_date_precision == null ? null : String(mergedForRules.birth_date_precision),
      birth_date_calendar: mergedForRules.birth_date_calendar == null ? null : String(mergedForRules.birth_date_calendar),
      death_date_value: (mergedForRules as Record<string, unknown>).death_date_value == null ? null : String((mergedForRules as Record<string, unknown>).death_date_value),
      death_date_precision: mergedForRules.death_date_precision == null ? null : String(mergedForRules.death_date_precision),
      death_date_calendar: mergedForRules.death_date_calendar == null ? null : String(mergedForRules.death_date_calendar),
      is_dead: mergedForRules.is_dead == null ? null : Number(mergedForRules.is_dead),
      father_id: mergedForRules.father_id == null ? null : Number(mergedForRules.father_id),
      mother_id: mergedForRules.mother_id == null ? null : Number(mergedForRules.mother_id),
    },
  });
  const updateRules = await enforceRegistryRules(env.DB, updateRuleSubject, parsed.data.rule_overrides);
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  const { updateStatement, afterUpdateStatements } = buildCanonicalHorseUpdateStatements(env.DB, {
    plan,
    horseId: id,
    expectedRowVersion: parsed.data.expected_row_version,
    mutationId,
    identifierTableReady: await identifierTableReady(env.DB),
  });
  const results = await runGuardedHorseBatch(env.DB, [
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "horse.update", entityType: "horse", entityId: String(id),
      before, requested: changes, requestId: reqId, searchStatus: "pending",
    }),
    updateStatement,
    ...afterUpdateStatements,
  ], plan.effectiveIdentifierChanges, { graphLock: plan.parentageChanged, policy: { subject: updateRuleSubject, ...updateRules, operationId: mutationId, actorUserId: auth.user.id } });
  const result = results[1];
  if (!result?.meta.changes) {
    try { await abortCanonicalMutation(env.DB, mutationId, "optimistic concurrency or pedigree precondition conflict"); } catch {}
    if (plan.parentageChanged) {
      const current = await env.DB.prepare("SELECT row_version FROM horses WHERE id=? AND deleted_at IS NULL").bind(id).first<{ row_version: number }>();
      if (current?.row_version === parsed.data.expected_row_version) {
        // The optimistic version still matches, so the atomic ancestry guard is the likely failed precondition.
        // Re-run the detailed validator against the now-current graph to return a specific cycle/limit error.
        await assertValidParentAssignment(env.DB, id, plan.nextFather, plan.nextMother);
      }
    }
    throw new HttpError(409, "edit_conflict", "Record or pedigree preconditions changed while saving. Reload before retrying.");
  }
  const after = await env.DB.prepare("SELECT * FROM horses WHERE id=?").bind(id).first();
  await settleCanonicalHorseMutation(env.DB, mutationId, id, auth.user.id, "horse.update", before, after ?? changes, reqId);
  // R146-D04: record the fail/override trail only after a successful write.
  const responseHorse = await env.DB.prepare(`SELECT ${ADMIN_HORSE_DETAIL_COLUMNS} FROM horses WHERE id=?`).bind(id).first();
  return json({ horse: responseHorse });
}


async function archiveHorse(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const before = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(id).first();
  if (!before) return error(404, "not_found", "Horse not found");
  const protectedIdentity = protectedIdentityMergeGuard([id]);
  if (!await env.DB.prepare(`SELECT 1 AS allowed WHERE ${protectedIdentity.sql}`).bind(...protectedIdentity.bindings).first()) {
    throw new HttpError(409, "protected_identity_reconciliation_required", "This horse has retained medical records, supplementary values or professional assignments. Resolve them through a reviewed companion workflow before archiving.");
  }
  const dependent = await env.DB.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL AND (father_id=? OR mother_id=?)").bind(id,id).first<{ count: number }>();
  if (Number(dependent?.count ?? 0) > 0) {
    throw new HttpError(409, "horse_is_parent", "This horse is referenced by active descendants and cannot be archived without first resolving those pedigree links.", { dependent_horses: Number(dependent?.count ?? 0) });
  }
  const mutationId = crypto.randomUUID();
  const reqId = requestId(request);
  // T08: live identifiers retire together with the horse, so an archived
  // horse's register number can be legitimately reused later.
  const archiveIdentifiers = archiveIdentifierStatement(env.DB, id, mutationId, await identifierTableReady(env.DB));
  const [, , result] = await runGuardedHorseBatch(env.DB, [
    // Match care, metadata and grant writers. PostgreSQL's next statement
    // takes a fresh snapshot after this row lock is granted.
    env.DB.prepare("UPDATE horses SET row_version=row_version WHERE id=?").bind(id),
    canonicalMutationIntentStatement(env.DB, {
      id: mutationId, actorUserId: auth.user.id, action: "horse.archive", entityType: "horse", entityId: String(id),
      before, requested: { deleted_at: "CURRENT_TIMESTAMP" }, requestId: reqId, searchStatus: "pending",
    }),
    env.DB.prepare(`
      UPDATE horses
      SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_mutation_id=?
      WHERE id=? AND deleted_at IS NULL
        AND row_version=?
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
        AND (${protectedIdentity.sql})
        AND NOT EXISTS (SELECT 1 FROM horses child WHERE child.deleted_at IS NULL AND (child.father_id=? OR child.mother_id=?))
    `).bind(mutationId,id,Number(before.row_version),auth.user.id,...protectedIdentity.bindings,id,id),
    ...(archiveIdentifiers ? [archiveIdentifiers] : []),
    env.DB.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS (SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)").bind(id,mutationId),
    env.DB.prepare("UPDATE registry_runtime_counters SET active_horse_count=CASE WHEN active_horse_count>0 THEN active_horse_count-1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS (SELECT 1 FROM horses WHERE id=? AND last_mutation_id=? AND deleted_at IS NOT NULL AND is_active=1)").bind(id,mutationId),
  ], {}, { graphLock: true });
  if (!result?.meta.changes) {
    try { await abortCanonicalMutation(env.DB, mutationId, "archive precondition changed concurrently"); } catch {}
    throw new HttpError(409, "horse_archive_conflict", "The horse, linked records or archive authority changed while saving; reload and resolve them before retrying.");
  }
  const after = await env.DB.prepare("SELECT * FROM horses WHERE id=?").bind(id).first();
  await settleCanonicalHorseMutation(env.DB, mutationId, id, auth.user.id, "horse.archive", before, after, reqId);
  return json({ ok: true, horseId: id });
}


async function adminDashboard(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  // D16: stable snapshot values come from the runtime summary only while revision-fresh;
  // stale/missing snapshots fall back to exact live counts. Audit/reindex counters are always live.
  const runtime = await loadRuntimeSnapshot(env.DB);
  const live = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE created_at >= datetime('now','-7 days')"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM horse_search_reindex_queue"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM canonical_mutation_log WHERE audit_status='pending' AND status IN ('intent','committed')"),
    // T09 observability: queue age, failed mutations and search-work lag
    // (age is computed in JS from MIN(queued_at) — julianday() is not
    // portable across the SQLite/Postgres providers)
    env.DB.prepare("SELECT MIN(queued_at) AS oldest FROM horse_search_reindex_queue"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM canonical_mutation_log WHERE last_error IS NOT NULL AND updated_at >= datetime('now','-7 days')"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM canonical_mutation_log WHERE search_status='pending' AND status IN ('intent','committed')"),
    env.DB.prepare("SELECT canonical_revision AS revision FROM registry_state WHERE id=1"),
  ]);
  const count = (r: D1Result | undefined) => Number((r?.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  const scalar = (r: D1Result | undefined, key: string) => {
    const row = r?.results?.[0] as Record<string, unknown> | undefined;
    const value = row?.[key];
    return value === null || value === undefined ? null : Number(value);
  };
  const oldestQueued = (live[3]?.results?.[0] as { oldest?: unknown } | undefined)?.oldest ?? null;
  const oldestQueuedAgeSeconds = (() => {
    if (oldestQueued === null || oldestQueued === undefined || oldestQueued === "") return null;
    let millis: number;
    if (oldestQueued instanceof Date) {
      millis = oldestQueued.getTime();
    } else {
      const text = String(oldestQueued);
      // SQLite UTC text form 'YYYY-MM-DD HH:MM:SS' — parse as UTC explicitly.
      const sqliteStyle = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)
        ? Date.parse(text.replace(" ", "T") + (text.endsWith("Z") ? "" : "Z"))
        : Date.parse(text);
      if (!Number.isFinite(sqliteStyle)) return null;
      millis = sqliteStyle;
    }
    return Math.max(0, Math.round((Date.now() - millis) / 1000));
  })();
  const observability = mutationObservabilityBlock({
    reindexQueueCount: count(live[1]),
    oldestQueuedAgeSeconds,
    failedMutations: count(live[4]),
    pendingSearchWork: count(live[5]),
    pendingAuditWork: count(live[2]),
    canonicalRevision: scalar(live[6], "revision"),
    identifierConflictsOpen: null,
  });
  if (runtime.summary && !runtime.stale) {
    return json({
      horses: runtime.summary.stats.horses,
      people: runtime.summary.stats.people,
      openIssues: runtime.summary.stats.openQualityIssues,
      changesLast7Days: count(live[0]),
      reindexJobs: count(live[1]),
      pendingMutations: count(live[2]),
      snapshotStale: runtime.stale,
      mutationObservability: observability,
    });
  }
  const fallback = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM people WHERE deleted_at IS NULL"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM data_quality_issues WHERE resolved_at IS NULL"),
  ]);
  return json({ horses: count(fallback[0]), people: count(fallback[1]), openIssues: count(fallback[2]), changesLast7Days: count(live[0]), reindexJobs: count(live[1]), pendingMutations: count(live[2]), mutationObservability: observability });
}

async function auditFeed(request: Request, env: Env): Promise<Response> {
  await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "editor");
  const rows = await env.DB.prepare(`
    SELECT a.id,a.action,a.entity_type,a.entity_id,CASE WHEN a.entity_type='genetic_test' THEN NULL ELSE a.reason END AS reason,a.created_at,u.display_name AS actor
    FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id
    ORDER BY a.id DESC LIMIT 100
  `).all();
  return json({ events: rows.results });
}

async function processReindex(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const result = await processSearchReindexQueue(env.DB, 3);
  await audit(env.DB, auth.user.id, "search.reindex.process", "maintenance", "search", null, result, requestId(request));
  return json(result);
}

async function processMutationReconciliation(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const result = await reconcilePendingMutationAudits(env.DB, 4);
  await audit(env.DB, auth.user.id, "canonical_mutation.reconcile", "maintenance", "canonical_mutations", null, result, requestId(request));
  return json(result);
}


function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, display_name: user.display_name, role: user.role };
}
