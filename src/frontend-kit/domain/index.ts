/**
 * R88 agent plan P20: canonical frontend domain loaders and command hooks.
 * Headless shared SEMANTICS — data loading, normalized errors, race/abort
 * handling, pagination, command status, bilingual field labels. Presentation
 * components live in each frontend; this layer never renders and never
 * imports a skin or stylesheet.
 */
export type {
  ResourcePhase,
  ResourceState,
} from "./resourceState";
export {
  classifyResourceError,
  hasRenderableData,
  idleResource,
  isAbortError,
  retryAfterSecondsOf,
} from "./resourceState";
export {
  DomainResourceController,
  domainLoadKey,
} from "./domainLoader";
export type { DomainLoad, DomainLoadRequest } from "./domainLoader";
export { useDomainResource } from "./useDomainResource";
// R107 NEXT-05: principal-aware resource invalidation (identity + permission
// epoch in private loader dependencies; render-time scoped-state mask).
export {
  principalScopeKey,
  usePrincipalScope,
  useScopedState,
} from "./principalScope";
export type { PrincipalScopeUser } from "./principalScope";
export type { CommandState } from "./commandStatus";
export {
  classifyCommandError,
  idempotentReplayOf,
  idleCommand,
  usePlatformCommand,
} from "./commandStatus";
export type {
  CursorPageState,
  OffsetPageState,
} from "./pager";
export {
  advanceCursor,
  advanceOffset,
  canAdvanceCursor,
  canAdvanceOffset,
  canRetreatCursor,
  canRetreatOffset,
  cursorPageLoaded,
  initialCursorPage,
  initialOffsetPage,
  offsetPageLoaded,
  retreatCursor,
  retreatOffset,
} from "./pager";
export type { BilingualText, Locale } from "./locale";
export { pick } from "./locale";
export { BILLING, DATES, DIRECTORY, MONEY, ORGANIZATION_STAFF, RESOURCE_STATES, SERVICE_REQUESTS, WORKSPACES, WORKSPACE_DESK } from "./locale";
// R98-N06: the ONE headless person-profile editor controller + claim flow.
export type {
  ClaimExplainerEntry,
  ClaimFlowState,
  DirectoryClaimSummary,
  ProfileEditorDraft,
  ProfileEditorPermissions,
  ProfileEditorState,
  ProfileFieldDifference,
  ProfileSubmission,
  StoredProfile,
} from "./profileEditor";
export {
  DIRECTORY_CLAIM_EXPLAINER,
  ProfileEditorController,
  buildProfileSubmission,
  consentWithdrawnElsewhere,
  diffProfileDraft,
  draftFromProfile,
  newDraft,
  summarizeClaims,
  useDirectoryClaimFlow,
  useMyDirectoryClaims,
  useProfileEditorController,
} from "./profileEditor";
// R98-N07: the ONE headless organization editor controller.
export type {
  OrganizationEditorDraft,
  OrganizationEditorPermissions,
  OrganizationEditorState,
  OrganizationFieldDifference,
  OrganizationOnboardingEntry,
  OrganizationSubmission,
  StaffRosterEntry,
  StoredOrganization,
} from "./organizationEditor";
export {
  ORGANIZATION_ONBOARDING_EXPLAINER,
  OrganizationEditorController,
  buildOrganizationSubmission,
  diffOrganizationDraft,
  draftFromOrganization,
  newOrganizationDraft,
  normalizeStaffRoster,
  orgConsentWithdrawnElsewhere,
  useOrganizationEditorController,
} from "./organizationEditor";
// R114-04 (Master AI R113 handoff D21): shared headless staff lifecycle.
export type {
  InvitationAnswerFailure,
  MyOrganizationInvitation,
  OrganizationRosterEntry,
  OrganizationRosterInvite,
  OrganizationRosterMembership,
  OrganizationRosterSnapshot,
  OrganizationStaffPlatform,
} from "./organizationStaff";
export {
  classifyInvitationFailure,
  commandFeedback,
  unanswerableInvitationReason,
  normalizeMyOrganizationInvites,
  normalizeOrganizationRoster,
  useMyOrganizationInvitations,
  useOrganizationRoster,
  useOrganizationStaffCommands,
} from "./organizationStaff";

export {
  LISTING_LIFECYCLE,
  MARKETPLACE_DISCLOSURE,
  listingLifecycleView,
  classifyMarketplaceError,
  conversationThread,
  useMarketplaceListing,
  useInquiryConversation,
  useMyMarketplace,
  useSentInquiries,
  useWatchlist,
  useMarketplaceLifecycleCommands,
} from "./marketplace";
export type {
  ListingViewerRole,
  ListingLifecycleView,
  MarketplaceErrorState,
  MarketplacePlatform,
  MarketplaceListingState,
  InquiryConversationState,
  ConversationEntry,
  MarketplaceLifecyclePlatform,
  MyMarketplaceSnapshot,
  SentInquiriesSnapshot,
  WatchlistSnapshot,
} from "./marketplace";
// R117-16: the ONE headless credential-stories controller (public read +
// verify projections, member-scoped issue, owner-scoped revoke/supersede,
// private snapshot review) shared by every frontend.
export {
  useHorseCredentialStories,
  useAttestationVerification,
  useIssuerDirectory,
  useCredentialStoryCommands,
  runSnapshotReview,
} from "./credentialStories";
export type {
  CredentialStoriesPlatform,
  CredentialStoriesSnapshot,
  CredentialVerificationSnapshot,
  IssuerDirectorySnapshot,
  CredentialSnapshotReviewOutcome,
} from "./credentialStories";
export {
  buildWorkspaceCalendar,
  localDateInZoneCalendar,
} from "./workspaceCalendar";
export type {
  CalendarTaskInput,
  CalendarTask,
  CalendarDay,
  CalendarModel,
} from "./workspaceCalendar";
// R114-05 (Master AI R113 handoff D22/D32–35): shared headless workspace desk.
export type {
  DocumentCommandFailure,
  MyWorkspaceInvitation,
  WorkspaceAnswerFailure,
  WorkspaceDashboardSnapshot,
  WorkspaceDeskPlatform,
  WorkspaceDocumentsSnapshot,
  WorkspacePermissionView,
  WorkspaceTaskBuckets,
  WorkspacesMineLists,
  WorkspacesMineSnapshot,
} from "./workspaceDesk";
export {
  classifyDocumentCommandFailure,
  classifyWorkspaceAnswerFailure,
  newImportIntentKey,
  normalizeMyWorkspaceInvites,
  normalizeWorkspaceTasks,
  normalizeWorkspacesMine,
  useMyWorkspaces,
  useMyWorkspaceInvitations,
  useWorkspaceDashboard,
  useWorkspaceDeskCommands,
  useWorkspaceDoneTasks,
  useWorkspaceDocumentCommands,
  useWorkspaceDocuments,
  workspacePermissions,
} from "./workspaceDesk";
export {
  MUTATION_INTENT_TTL_MS,
  MUTATION_INTENT_PREFIX,
  isIntentExpired,
  openIntentStorage,
  useMutationIntent,
} from "./mutationIntent";
export type {
  MutationIntentSummary,
  MutationIntentRecord,
  MutationIntentPhase,
  MutationIntentSnapshot,
  IntentStorage,
  IntentReconciliationLookup,
} from "./mutationIntent";

// Recovery copy is shared semantics, not a cross-skin renderer.
export { mutationIntentCopy } from "./mutationIntentCopy";

// R113: shared workflow semantics with a native renderer in each frontend.
export * from "./horseWorkflows";
export {
  ServiceRequestWorkbench,
  serviceRequestStatusLabel,
  validServiceRequest,
  validServiceRequestId,
} from "./serviceWorkbench";
export type {
  ServiceRequestView,
  ServiceRequestApi,
  ServiceRequestCommand,
  ServiceWorkbenchSnapshot,
} from "./serviceWorkbench";
export { ServiceRequestComposer } from "./serviceComposer";
export type { ServiceComposerApi, ServiceComposerSnapshot } from "./serviceComposer";
export { useServiceRequestComposer } from "./useServiceComposer";
export { formatDirectoryLanguages } from "./directoryDisplay";
// R117-18 (Master AI R117 handoff D43): the ONE headless privacy-redaction
// OPERATOR controller (queue read + decide + the separate fulfillment
// executor call, receipt-driven completion) shared by every frontend.
export {
  useAdminRedactionQueue,
  useRedactionCommands,
  runRedactionDecision,
  runRedactionFulfillment,
  redactionFulfillmentLabel,
} from "./privacyDesk";
export type {
  PrivacyDeskPlatform,
  RedactionQueueSnapshot,
  RedactionCommandOutcome,
} from "./privacyDesk";

// R123: shared engine-localization seam — three-locale engine contract with
// authored Arabic dictionaries and RTL/number helpers.
export {
  KIT_ARABIC,
  CORE_ARABIC,
  kitText,
  kitEngineArabic,
  matchArabicTemplate,
  kitIsRtl,
  kitNumberTag,
  kitDigits,
} from "./engineText";
export type { ArabicTemplate } from "./engineText";
