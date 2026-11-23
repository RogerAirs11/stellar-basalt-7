import { createCareClient } from "./careClient";
import { createMetadataClient } from "./metadataClient";
import { createMfaClient } from "./mfaClient";
import type { MfaCommandResponse } from "../contracts/mfa";
import type { WorkspaceInviteResponse, WorkspaceInvitesResponse, WorkspaceInviteRespondResponse,
  WorkspaceDocumentsResponse, WorkspaceTaskReassignResponse, WorkspaceTaskImportResponse } from "../contracts/platform";
import { validateSessionResponse } from "./sessionState";
import {
  CHANGE_REQUEST_ITEMS_MAX,
  PLATFORM_CONTRACT_VERSION,
  REGISTRY_EXPORT_ROWS_MAX,
  type AncestorPedigreeResponse,
  type ClaimCreateResponse,
  type ClaimReviewResponse,
  type ClaimsMineResponse,
  type ChangeRequestCreateInput,
  type ChangeRequestCreateResponse,
  type ChangeRequestEditInput,
  type ChangeRequestReviewResponse,
  type ChangeRequestTransitionResponse,
  type ChangeRequestsMineResponse,
  type AdminDashboardResponse,
  type AuditEventSummary,
  type AdminQualityIssue,
  type QualityQueueListParams,
  type QualityQueueListResponse,
  type QualityIssueDetailResponse,
  type QualityScanResponse,
  type EvidenceSummaryResponse,
  type ExactIdentifierResponse,
  type AdminClaimRecord,
  type ChangeRequestRecord,
  type AdminHorseRecord,
  type HorseCurationInput,
  type ReindexResponse,
  type MutationReconciliationResponse,
  type AdminRedactionQueueResponse,
  type RedactionDecideResponse,
  type RedactionFulfillResponse,
  type DescendantMetricsResponse,
  type DescendantPedigreeResponse,
  type HorseProfileResponse,
  type HorseSearchResponse,
  type HorseLifecycleEventRecord,
  type HorseLifecycleResponse,
  type HorseOwnershipPeriodRecord,
  type HorseOwnershipResponse,
  type PeopleListResponse,
  type PedigreeMetricsResponse,
  type PedigreeCoefficientResponse,
  type PedigreePathResponse,
  type PersonProfileResponse,
  type PlatformAuthState,
  type PlatformClient,
  type PlatformLoginInput,
  type PlatformPermission,
  type PlatformUser,
  type PlatformHealthResponse,
  type PlatformMetaResponse,
  type PlatformRequestOptions,
  type QualitySummaryResponse,
  type RegistryBrowseParams,
  type RegistryBrowseResponse,
  type RegistryFacetsResponse,
  type RegistryExportFormat,
  type RegistryExportDescriptor,
  type RelationshipResponse,
  type RelationshipCoefficientResponse,
  type HorseInsightsResponse,
  type RegistryAnalyticsResponse,
  type SearchMetaResponse,
  type BreedingPairingAnalysisResponse,
  type BreedingOptimizerInput,
  type BreedingOptimizerResponse,
  type ContentListResponse,
  type ContentPost,
  type ContentPostInput,
  type ContentPreviewResponse,
  type ContentRevisionsResponse,
  type ContentCommentsResponse,
  type ContentCommentSubmitResponse,
  type ContentAdminCommentsResponse,
  type ContentCommentStatus,
  type AiContentGenerateInput,
  type AiAdminKeyTestResponse,
  type AiAdminKeysResponse,
  type AiAdminKeyRotationResponse,
  type AiAdminSettings,
  type AiAdminSettingsResponse,
  type AiContentGenerateResponse,
  type AiAssistantStatus, type AiModelDescriptor, type AiConversationSummary, type AiConversationDetail, type AiExecutionMode, type AiProviderName, type AiRuntimeProviderName, type AiImageReference, type AiClientStreamEvent,
  type CompetitionsListResponse, type CompetitionDetailResponse, type HorseCompetitionsResponse,
  type HorseRacingResponse, type RacingRacesResponse, type RacingRaceDetailResponse,
  type CompetitionResultCommandResponse, type CompetitionEventCommandResponse,
  type ImportBatchPreviewResponse, type ImportReviewReportResponse, type ImportRowReviewResponse,
  type MarketListResponse, type MarketListingDetailResponse, type MarketListingRecord, type ListingCreateInput, type MarketConversationResponse, type MarketWatchlistResponse, type MarketSentInquiriesResponse,
  type IssuerDirectoryRow, type HorseCredentialStoriesResponse, type CredentialVerificationResponse, type CredentialIssueInput, type CredentialRevokeInput, type CredentialSupersedeInput, type IssuedCredentialStory, type CredentialSnapshotReviewResponse,
  type HorseGeneticsResponse, type HorseBreedingsResponse, type HorseMediaListResponse, type HorseMediaRecord, type MediaUploadInput, type MediaAccessTokenResponse, type MediaPublicationResponse,
  type DuplicateCheckResponse, type DuplicateCandidatesResponse, type DuplicateCandidateReason,
  type MergePreviewResponse, type MergeCommandResponse, type UnmergeCommandResponse, type MergeHistoryResponse,
  type OtpRequestResponse, type RegisterInput, type OtpVerifyInput, type EmailVerificationInfo,
  type HorseAccessActionsResponse, type HorseAccessGrantRecord,
  type DirectoryPersonsParams, type DirectoryPersonsResponse, type DirectoryPersonDetailResponse, type DirectoryOrganizationsParams, type DirectoryOrganizationsResponse,
  type DirectoryClaimInput, type DirectoryClaimResponse, type DirectoryMyClaimsResponse, type DirectoryProfileInput, type DirectoryProfileResponse, type DirectoryManagedProfileResponse, type DirectoryCredentialInput, type DirectoryCredentialResponse,
  type OrganizationPublicCardResponse, type OrganizationManagedResponse, type OrganizationProfileInput, type OrganizationProfileResponse, type OrganizationStaffResponse, type OrganizationInboxResponse, type OrganizationStaffInviteInput, type OrganizationStaffInviteResponse, type OrganizationOfficialInput,
  type ServiceRequestCreateInput, type ServiceRequestCreateResponse, type ServiceRequestListResponse, type ServiceRequestInboxResponse, type ServiceRequestDetailResponse, type ServiceRequestStatusResponse, type ServiceIntentReconciliationResponse,
  type ServiceRequestConsentWithdrawResponse, type ServiceRequestProviderBlockResponse, type ServiceRequestRedactResponse, type ServiceRequestExportResponse, type ServicePrivacyPolicyResponse,
  type WorkspaceCreateInput, type WorkspaceCreateResponse, type WorkspacesMineResponse, type WorkspaceDashboardResponse, type WorkspaceHorseMutationResponse, type WorkspaceBulkResponse,
  type WorkspaceStaffInput, type WorkspaceStaffResponse, type WorkspaceTaskInput, type WorkspaceTaskResponse, type WorkspaceTasksResponse, type WorkspaceTaskCompleteResponse, type WorkspaceTaskReopenResponse,
  type BillingCatalogResponse, type BillingOffersResponse, type BillingOrderInput, type BillingOrderResponse, type BillingMyOrdersResponse, type BillingOrderDetailResponse, type BillingPayResponse, type BillingEntitlementsResponse,
} from "../contracts/platform";
import { PlatformClientError } from "./errors";
import { platformResponseError, throwIfRequestAborted } from "./transportErrors";
import { AiSseDecoder } from "./aiStream";

// R148 Task 6: minimal stable stringify for the client-side create-command
// content digest. The server re-hashes the full payload authoritatively.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export type PlatformTransport = <T>(url: string, init?: RequestInit) => Promise<T>;
export type AiStreamTransport = (url:string, init?:RequestInit) => AsyncIterable<AiClientStreamEvent>;

export interface PlatformSessionChange extends PlatformAuthState {
  csrfToken: string | null;
}

export interface PlatformClientOptions {
  transport: PlatformTransport;
  csrfToken?: () => string | null;
  onSessionChange?: (session: PlatformSessionChange) => void;
  aiStreamTransport?: AiStreamTransport;
}

/** Host-side transport; frontends receive PlatformClient, never raw credentials. */
export function createFetchPlatformTransport(fetcher: typeof fetch = fetch): PlatformTransport {
  return async <T>(url: string, init?: RequestInit): Promise<T> => {
    throwIfRequestAborted(init?.signal);
    const response = await fetcher(url, { credentials: "same-origin", ...init });
    let data: unknown;
    try { data = await response.json(); }
    catch (cause) {
      throwIfRequestAborted(init?.signal, cause);
      if (!response.ok) throw platformResponseError(response, undefined, "invalid_error_response");
      throw new PlatformClientError(response.status, "invalid_json_response", "Platform returned an invalid JSON response");
    }
    throwIfRequestAborted(init?.signal);
    if (!response.ok) throw platformResponseError(response, data);
    return data as T;
  };
}

export function createFetchAiStreamTransport(fetcher: typeof fetch = fetch): AiStreamTransport {
  return async function* (url: string, init?: RequestInit) {
    throwIfRequestAborted(init?.signal);
    const response = await fetcher(url, { credentials: "same-origin", ...init });
    if (!response.ok) {
      let data: unknown;
      try { data = await response.json(); } catch (cause) { throwIfRequestAborted(init?.signal, cause); }
      throw platformResponseError(response, data, "ai_stream_failed");
    }
    if (!response.body) throw new PlatformClientError(502, "ai_stream_missing_body", "AI stream returned no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const frames = new AiSseDecoder();
    let completed = false;
    let terminal = false;
    try {
      const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (type !== "text/event-stream") throw new PlatformClientError(502, "ai_stream_invalid_content_type", "AI endpoint did not return an event stream");
      while (true) {
        throwIfRequestAborted(init?.signal);
        const { done, value } = await reader.read();
        throwIfRequestAborted(init?.signal);
        let text: string;
        try { text = done ? decoder.decode() : decoder.decode(value, { stream: true }); }
        catch { throw new PlatformClientError(502, "ai_stream_invalid_encoding", "AI stream returned invalid UTF-8"); }
        for (const event of frames.push(text)) {
          if (terminal) throw new PlatformClientError(502, "ai_stream_after_terminal", "AI stream continued after its terminal event");
          terminal = event.type === "done" || event.type === "error";
          yield event;
        }
        if (done) { completed = true; break; }
      }
      // EOF is not proof that a turn committed; keep the existing clientMessageId
      // for manual reconciliation/retry. Never automatically replay an AI turn.
      if (!terminal) throw new PlatformClientError(502, "ai_stream_incomplete", "AI stream ended before completion; reload the conversation before retrying");
    } finally {
      // Also runs when a consumer breaks out of for-await before EOF.
      if (!completed) { try { await reader.cancel(); } catch { /* Preserve the original failure. */ } }
      reader.releaseLock();
    }
  };
}

export function createPlatformClient(options: PlatformClientOptions): PlatformClient {
  const { transport, csrfToken = () => null, onSessionChange = () => {}, aiStreamTransport } = options;
  const get = <T>(url: string, request?: PlatformRequestOptions) => transport<T>(url, { signal: request?.signal });
  const write = <T>(url: string, method: "POST" | "PUT" | "DELETE" | "PATCH", body: unknown, request?: PlatformRequestOptions) => {
    const csrf = csrfToken();
    return transport<T>(url, {
      method,
      signal: request?.signal,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        // R88 P03: durable idempotency receipts for marketplace commands.
        ...(request?.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  // All cookie-changing paths share one per-client fence. A later /me response
  // cannot resurrect a principal after logout, and concurrent login/OTP/register
  // commands cannot race Set-Cookie within this SDK instance. Cross-tab/browser
  // cookie races still require server session controls and visibility refresh.
  let sessionRevision = 0;
  let sessionRead = 0;
  let changingSession = false;
  let publishedPrincipalId: string | null = null;
  const clearSession = () => { publishedPrincipalId = null; onSessionChange({ user: null, permissions: [], csrfToken: null }); };
  const publishSession = (data: unknown): PlatformAuthState => {
    let session;
    try { session = validateSessionResponse(data); }
    catch (error) { clearSession(); throw error; }
    onSessionChange(session);
    publishedPrincipalId = session.user?.id ?? null;
    return { user: session.user, permissions: session.permissions };
  };
  const mutateSession = async <T>(execute: () => Promise<T>, request?: PlatformRequestOptions): Promise<T> => {
    throwIfRequestAborted(request?.signal);
    if (changingSession) throw new PlatformClientError(409, "session_change_in_progress", "Wait for the current sign-in or sign-out request to finish");
    changingSession = true;
    sessionRevision += 1;
    sessionRead += 1;
    // Hide private views immediately. A failed/uncertain write is reconciled by
    // an explicit fresh /me, never by restoring the old in-memory authority.
    try { clearSession(); return await execute(); }
    finally { changingSession = false; }
  };
  const sessionWrite = <T extends AuthTransportResponse>(url: string, body: unknown, request?: PlatformRequestOptions): Promise<T> => {
    // An existing session may require CSRF even when switching demo accounts.
    // Capture it before mutateSession masks authority and clears the host ref.
    const csrf = csrfToken();
    return mutateSession(async () => {
      const data = await transport<T>(url, { method: "POST", signal: request?.signal,
        headers: { ...(csrf ? { "x-csrf-token": csrf } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      throwIfRequestAborted(request?.signal);
      publishSession(data);
      return data;
    }, request);
  };

  const mfaCommand = async <T extends MfaCommandResponse>(url: string, body: unknown, request?: PlatformRequestOptions): Promise<T> => {
    throwIfRequestAborted(request?.signal);
    if (changingSession) throw new PlatformClientError(409, "session_change_in_progress", "Wait for the current account security request to finish");
    const principal = publishedPrincipalId;
    changingSession = true; sessionRevision += 1; sessionRead += 1;
    try {
      const data = await write<T>(url, "POST", body, request);
      throwIfRequestAborted(request?.signal);
      if (principal && data?.user?.id !== principal) throw new PlatformClientError(502, "mfa_principal_changed", "Reload your session before continuing account security setup");
      publishSession(data);
      return data;
    } catch (cause) {
      // A network/abort/5xx outcome may have rotated the cookie. Mask authority
      // until a fresh /me; never replay a secret-bearing command automatically.
      if (!(cause instanceof PlatformClientError) || cause.status >= 500 || cause.status === 401 || cause.status === 403) clearSession();
      throw cause;
    } finally { changingSession = false; }
  };

  return {
    contractVersion: PLATFORM_CONTRACT_VERSION,
    care: createCareClient({ get, write }),
    metadata: createMetadataClient({ get, write }),
    auth: {
      mfa: createMfaClient({ get, command: mfaCommand }),
      async me(request) {
        throwIfRequestAborted(request?.signal);
        if (changingSession) throw new PlatformClientError(409, "session_change_in_progress", "A sign-in or sign-out request is still in progress");
        const revision = sessionRevision;
        const ticket = ++sessionRead;
        const data = await get<unknown>("/api/auth/me", request);
        throwIfRequestAborted(request?.signal);
        if (changingSession || revision !== sessionRevision || ticket !== sessionRead) {
          throw new PlatformClientError(409, "session_superseded", "This session read was superseded; use the current session state");
        }
        return publishSession(data);
      },
      async login(input, request) {
        const data = await sessionWrite<AuthTransportResponse>("/api/auth/login", normalizeLogin(input), request);
        return { user: data.user, permissions: [...data.permissions] };
      },
      async demoAdmin(request) {
        const data = await sessionWrite<AuthTransportResponse>("/api/auth/demo-admin", undefined, request);
        return { user: data.user, permissions: [...data.permissions] };
      },
      async demoPersona(persona, request) {
        if (!["admin", "owner_a", "owner_b", "reviewer", "provider", "manager", "staff"].includes(persona)) {
          throw new PlatformClientError(400, "invalid_demo_persona", "Select a supported demo account.");
        }
        const data = await sessionWrite<AuthTransportResponse>("/api/auth/demo-admin", { persona }, request);
        return { user: data.user, permissions: [...data.permissions] };
      },
      async logout(request) {
        // Capture before mutateSession clears the host's CSRF ref.
        const csrf = csrfToken();
        await mutateSession(async () => {
          const data = await transport<{ ok: boolean }>("/api/auth/logout", {
            method: "POST", signal: request?.signal, headers: csrf ? { "x-csrf-token": csrf } : undefined,
          });
          throwIfRequestAborted(request?.signal);
          if (!data || data.ok !== true) throw new PlatformClientError(502, "invalid_logout_response", "Sign-out could not be confirmed; reload to reconcile the session");
        }, request);
      },
    },
    meta: (request) => get<PlatformMetaResponse>("/api/platform/meta", request),
    health: (request) => get<PlatformHealthResponse>("/api/health", request),
    ai: {
      status: (request) => get<AiAssistantStatus>("/api/ai/status",request),
      models: (request) => get<{models:AiModelDescriptor[];defaultModel:string|null;visionAvailable:boolean}>("/api/ai/models",request),
      list: (request) => get<{conversations:AiConversationSummary[]}>("/api/ai/conversations",request),
      create(input={},request){return write<{conversation:AiConversationSummary}>("/api/ai/conversations","POST",{mode:input.mode??"auto",locale:input.locale??"auto",provider:input.provider??null,model:input.model??null},request)},
      get(id,request){return get<{conversation:AiConversationDetail}>(`/api/ai/conversations/${encodeURIComponent(id)}`,request)},
      remove(id,request){return write<{ok:boolean}>(`/api/ai/conversations/${encodeURIComponent(id)}`,"DELETE",undefined,request)},
      stream(id,input,request){if(!aiStreamTransport)throw new PlatformClientError(501,"ai_stream_unavailable","This platform client was not configured with AI streaming transport");const csrf=csrfToken();return aiStreamTransport(`/api/ai/conversations/${encodeURIComponent(id)}/messages`,{method:"POST",signal:request?.signal,headers:{"content-type":"application/json",...(csrf?{"x-csrf-token":csrf}:{})},body:JSON.stringify(input)})},
    },
    search: {
      horses(query, request) {
        return get<HorseSearchResponse>(`/api/search?${queryString({ q: query, limit: request?.limit })}`, request);
      },
      meta: (request) => get<SearchMetaResponse>("/api/search/meta", request),
      // R145-C05: authorized exact chip/passport lookup (staff capability).
      exactIdentifier(kind, value, request) {
        return get<ExactIdentifierResponse>(`/api/search/exact-identifier?${queryString({ kind, value })}`, request);
      },
    },
    registry: {
      browse(params = {}, request) {
        return get<RegistryBrowseResponse>(`/api/horses?${queryString(params)}`, request);
      },
      facets: (request) => get<RegistryFacetsResponse>("/api/registry/facets", request),
    },
    exports: {
      registry(params = {}, format: RegistryExportFormat = "csv"): RegistryExportDescriptor {
        const safeFormat: RegistryExportFormat = format === "json" ? "json" : "csv";
        const query = queryString({ ...params, format: safeFormat, limit: REGISTRY_EXPORT_ROWS_MAX });
        return {
          format: safeFormat,
          href: `/api/registry/export?${query}`,
          filename: `horse-registry-export.${safeFormat}`,
          mimeType: safeFormat === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
          maxRows: REGISTRY_EXPORT_ROWS_MAX,
        };
      },
    },
    horses: {
      get: async (id, request) => get<HorseProfileResponse>(`/api/horses/${positiveId(id)}`, request),
      lifecycle: (id, request) => get<HorseLifecycleResponse>(`/api/horses/${positiveId(id)}/lifecycle`, request),
      ownership: (id, request) => get<HorseOwnershipResponse>(`/api/horses/${positiveId(id)}/ownership`, request),
      // R145-C04: deliberately limited public evidence summary.
      evidenceSummary: (id: number, request?: PlatformRequestOptions) =>
        get<EvidenceSummaryResponse>(`/api/horses/${positiveId(id)}/evidence-summary`, request),
    },
    people: {
      list(params = {}, request) {
        return get<PeopleListResponse>(`/api/people?${queryString(params)}`, request);
      },
      get: (id, request) => get<PersonProfileResponse>(`/api/people/${positiveId(id)}`, request),
    },
    pedigree: {
      ancestors(id, params = {}, request) {
        return get<AncestorPedigreeResponse>(`/api/horses/${positiveId(id)}/pedigree?${queryString(params)}`, request);
      },
      descendants(id, params = {}, request) {
        return get<DescendantPedigreeResponse>(`/api/horses/${positiveId(id)}/descendants?${queryString({ depth: params.depth, max: params.maxNodes })}`, request);
      },
      metrics(id, params = {}, request) {
        return get<PedigreeMetricsResponse>(`/api/horses/${positiveId(id)}/pedigree/metrics?${queryString(params)}`, request);
      },
      descendantMetrics(id, params = {}, request) {
        return get<DescendantMetricsResponse>(`/api/horses/${positiveId(id)}/pedigree/descendant-metrics?${queryString({ depth: params.depth, max: params.maxNodes })}`, request);
      },
      coefficients(id, params = {}, request) {
        return get<PedigreeCoefficientResponse>(`/api/horses/${positiveId(id)}/pedigree/coefficients?${queryString({ depth: params.depth })}`, request);
      },
      pathsToAncestor(id, ancestorId, params = {}, request) {
        return get<PedigreePathResponse>(`/api/horses/${positiveId(id)}/pedigree/paths?${queryString({ ancestor: positiveId(ancestorId), depth: params.depth, maxPaths: params.maxPaths })}`, request);
      },
    },
    relationships: {
      commonAncestors(from, to, params = {}, request) {
        return get<RelationshipResponse>(`/api/relationship?${queryString({ from: positiveId(from), to: positiveId(to), depth: params.depth })}`, request);
      },
      coefficients(from, to, params = {}, request) {
        return get<RelationshipCoefficientResponse>(`/api/relationship/coefficients?${queryString({ from: positiveId(from), to: positiveId(to), depth: params.depth })}`, request);
      },
    },
    breeding: {
      async pairingEvidence(sireId, damId, request) {
        const sire = positiveId(sireId), dam = positiveId(damId);
        if (sire === dam) throw new PlatformClientError(400, "invalid_pairing", "sire and dam must be different horses");
        return get<import("../contracts/platform").ArabianPairingEvidenceResponse>(`/api/breeding/pairing-evidence?${queryString({ sire, dam })}`, request);
      },
      async pairingAnalysis(sireId, damId, params = {}, request) {
        const sire = positiveId(sireId);
        const dam = positiveId(damId);
        if (sire === dam) throw new PlatformClientError(400, "invalid_pairing", "sire and dam must be different horses");
        return get<BreedingPairingAnalysisResponse>(`/api/breeding/pairing-analysis?${queryString({ sire, dam, depth: params.depth })}`, request);
      },
      optimize(input: BreedingOptimizerInput, request) {
        return write<BreedingOptimizerResponse>("/api/breeding/optimizer", "POST", input, request);
      },
    },
    analytics: {
      horseInsights(id, params = {}, request) {
        return get<HorseInsightsResponse>(`/api/horses/${positiveId(id)}/insights?${queryString({ ancestorDepth: params.ancestorDepth, descendantDepth: params.descendantDepth, metricsDepth: params.metricsDepth, coefficientDepth: params.coefficientDepth })}`, request);
      },
      registry: (request) => get<RegistryAnalyticsResponse>("/api/analytics/registry", request),
    },
    quality: {
      summary: (request) => get<QualitySummaryResponse>("/api/quality/summary", request),
    },
    content: {
      list(params = {}, request) {
        return get<ContentListResponse>(`/api/content/posts?${queryString(params)}`, request);
      },
      get(slug, request) {
        return get<{ post: ContentPost }>(`/api/content/posts/${encodeURIComponent(slug)}`, request);
      },
      comments(postId, request) {
        return get<ContentCommentsResponse>(`/api/content/posts/${encodeURIComponent(postId)}/comments`, request);
      },
      submitComment(postId, input, request) {
        return write<ContentCommentSubmitResponse>(`/api/content/posts/${encodeURIComponent(postId)}/comments`, "POST", input, request);
      },
    },
    claims: {
      mine: (request) => get<ClaimsMineResponse>("/api/claims/mine", request),
      create(horseId, evidence, request) {
        return write<ClaimCreateResponse>("/api/claims", "POST", { horse_id: positiveId(horseId), evidence }, request);
      },
    },
    changes: {
      evidence: {
        list: (id, request) => get<import("../contracts/registrationEvidence").RegistrationEvidenceListResponse>(`/api/change-requests/${encodeURIComponent(id)}/evidence`, request),
        upload: (id, input, request) => write<{ evidence: import("../contracts/registrationEvidence").RegistrationEvidenceRecord; idempotent_replay: boolean }>(`/api/change-requests/${encodeURIComponent(id)}/evidence`, "POST", input, request),
        remove: (id, evidenceId, request) => write<{ removed: boolean; evidence_id: string }>(`/api/change-requests/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`, "DELETE", {}, request),
        fileUrl: (id, evidenceId) => `/api/change-requests/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/file`,
      },
      mine: (request) => get<ChangeRequestsMineResponse>("/api/change-requests/mine", request),
      create(input: ChangeRequestCreateInput, request) {
        // Shared contract ceiling (D02): reject over-sized submissions client-side with the
        // same bounded semantics the server Zod schema enforces; never silently truncate.
        if (input.items && input.items.length > CHANGE_REQUEST_ITEMS_MAX) {
          throw new PlatformClientError(400, "invalid_change_request", `Change requests accept at most ${CHANGE_REQUEST_ITEMS_MAX} items`, { changeRequestItemsMax: CHANGE_REQUEST_ITEMS_MAX });
        }
        return write<ChangeRequestCreateResponse>("/api/change-requests", "POST", input, request);
      },
      // Master-Ai plan T11: the submission state machine. R148 Task 5: the edit
      // contract REQUIRES the loaded content revision — a stale tab conflicts
      // with 409 content_revision_conflict instead of overwriting a newer save.
      update(requestId: string, input: ChangeRequestEditInput, request) {
        if (!Number.isInteger(input?.expected_content_revision) || input.expected_content_revision < 1) {
          throw new PlatformClientError(400, "invalid_change_request", "Draft edits must send expected_content_revision from the version the form loaded", { field: "expected_content_revision" });
        }
        if (input.items && input.items.length > CHANGE_REQUEST_ITEMS_MAX) {
          throw new PlatformClientError(400, "invalid_change_request", `Change requests accept at most ${CHANGE_REQUEST_ITEMS_MAX} items`, { changeRequestItemsMax: CHANGE_REQUEST_ITEMS_MAX });
        }
        return write<ChangeRequestTransitionResponse>(`/api/change-requests/${encodeURIComponent(requestId)}`, "PUT", input, request);
      },
      submit: (requestId: string, request) => write<ChangeRequestTransitionResponse>(`/api/change-requests/${encodeURIComponent(requestId)}/submit`, "POST", {}, request),
      withdraw: (requestId: string, request) => write<ChangeRequestTransitionResponse>(`/api/change-requests/${encodeURIComponent(requestId)}/withdraw`, "POST", {}, request),
    },
    admin: {
      dashboard: (request) => get<AdminDashboardResponse>("/api/admin/dashboard", request),
      content: {
        list(params = {}, request) {
          return get<ContentListResponse>(`/api/admin/content/posts?${queryString(params)}`, request);
        },
        create(input: ContentPostInput, request) {
          return write<{ post: ContentPost }>("/api/admin/content/posts", "POST", input, request);
        },
        update(id: string, expectedRowVersion: number, input: ContentPostInput, request) {
          return write<{ post: ContentPost }>(`/api/admin/content/posts/${encodeURIComponent(id)}`, "PUT", { expected_row_version: expectedRowVersion, post: input }, request);
        },
        generate(input: AiContentGenerateInput, request) {
          return write<AiContentGenerateResponse>("/api/admin/content/generate", "POST", input, request);
        },
        // R117-17: the governed editorial workflow actions.
        preview(id: string, request) {
          return get<ContentPreviewResponse>(`/api/admin/content/posts/${encodeURIComponent(id)}/preview`, request);
        },
        comments(params = {}, request) {
          return get<ContentAdminCommentsResponse>(`/api/admin/content/comments?${queryString(params)}`, request);
        },
        moderateComment(commentId: string, action, request) {
          return write<{ ok: boolean }>(`/api/admin/content/comments/${encodeURIComponent(commentId)}/moderate`, "POST", { action }, request);
        },
        publish(id: string, expectedRowVersion: number, request) {
          return write<{ post: ContentPost }>(`/api/admin/content/posts/${encodeURIComponent(id)}/publish`, "POST", { expected_row_version: expectedRowVersion }, request);
        },
        retract(id: string, expectedRowVersion: number, request) {
          return write<{ post: ContentPost }>(`/api/admin/content/posts/${encodeURIComponent(id)}/retract`, "POST", { expected_row_version: expectedRowVersion }, request);
        },
        revisions(id: string, request) {
          return get<ContentRevisionsResponse>(`/api/admin/content/posts/${encodeURIComponent(id)}/revisions`, request);
        },
      },
      ai: {
        status: (request) => get<Record<string, unknown>>("/api/admin/ai/status", request),
        keys: (request) => get<AiAdminKeysResponse>("/api/admin/ai/keys", request),
        addKey(input: { provider: "gemini"; label: string; apiKey: string }, request) {
          return write<{ ok: boolean; id: string; masked: string }>("/api/admin/ai/keys", "POST", input, request);
        },
        updateKey(id: string, input: { is_enabled?: boolean; label?: string }, request) {
          return write<{ ok: boolean }>(`/api/admin/ai/keys/${encodeURIComponent(id)}`, "PATCH", input, request);
        },
        deleteKey(id: string, request) {
          return write<{ ok: boolean }>(`/api/admin/ai/keys/${encodeURIComponent(id)}`, "DELETE", {}, request);
        },
        testKey(id: string, request) {
          return write<AiAdminKeyTestResponse>(`/api/admin/ai/keys/${encodeURIComponent(id)}/test`, "POST", {}, request);
        },
        rotateKeyEncryption(request) {
          return write<AiAdminKeyRotationResponse>("/api/admin/ai/keys/rotate-encryption", "POST", {}, request);
        },
        getSettings: (request) => get<AiAdminSettingsResponse>("/api/admin/ai/settings", request),
        updateSettings(input: AiAdminSettings, request) {
          return write<{ ok: boolean; settings: AiAdminSettings }>("/api/admin/ai/settings", "PUT", input, request);
        },
      },
      audit: (request) => get<{ events: AuditEventSummary[] }>("/api/admin/audit", request),
      // R145-E04: the usable data-quality queue. The list always carries the
      // reconciled counts; the workflow verbs (assign/resolve/reopen/note)
      // append to the issue's event history server-side.
      quality(params: QualityQueueListParams = {}, request) {
        const query: Record<string, unknown> = {};
        if (params.severity) query.severity = params.severity;
        if (params.status) query.status = params.status;
        if (params.issue_code) query.issue_code = params.issue_code;
        if (params.assigned) query.assigned = params.assigned;
        if (params.limit != null) query.limit = params.limit;
        return get<QualityQueueListResponse>(`/api/admin/quality?${queryString(query)}`, request);
      },
      qualityDetail(id: number, request) {
        return get<QualityIssueDetailResponse>(`/api/admin/quality/${positiveId(id)}`, request);
      },
      qualityAssign(id: number, assigneeUserId: string, note: string | null | undefined, request) {
        return write<{ ok: boolean; id: number; status: string; assigned_to: string }>(`/api/admin/quality/${positiveId(id)}/assign`, "POST", { assignee_user_id: assigneeUserId, note: note ?? null }, request);
      },
      qualityResolve(id: number, resolutionNote: string, request) {
        return write<{ ok: boolean; id: number; status: string }>(`/api/admin/quality/${positiveId(id)}/resolve`, "POST", { resolution_note: resolutionNote }, request);
      },
      qualityReopen(id: number, note: string, request) {
        return write<{ ok: boolean; id: number; status: string }>(`/api/admin/quality/${positiveId(id)}/reopen`, "POST", { note }, request);
      },
      qualityNote(id: number, note: string, request) {
        return write<{ ok: boolean; id: number; noted: boolean }>(`/api/admin/quality/${positiveId(id)}`, "POST", { note }, request);
      },
      qualityBulkResolve(ids: number[], resolutionNote: string, request) {
        return write<{ ok: boolean; resolved: number; ids: number[] }>("/api/admin/quality/bulk-resolve", "POST", { ids, resolution_note: resolutionNote }, request);
      },
      qualityScan(params: { resume_after?: number } | undefined, request) {
        const query = params?.resume_after != null ? `?resume_after=${positiveId(params.resume_after)}` : "";
        return write<QualityScanResponse>(`/api/admin/quality/scan${query}`, "POST", {}, request);
      },
      // R146-D04: the bounded, versioned rules service. Rules are DATA
      // validated against typed schemas server-side — no executable policy.
      rules: {
        list(params: { state?: string; rule_type?: string } = {}, request) {
          const query: Record<string, unknown> = {};
          if (params.state) query.state = params.state;
          if (params.rule_type) query.rule_type = params.rule_type;
          const search = new URLSearchParams();
          for (const [key, value] of Object.entries(query)) search.set(key, String(value));
          const suffix = search.toString() ? `?${search.toString()}` : "";
          return get<import("../contracts/platform").RegistryRuleListResponse>(`/api/admin/registry-rules${suffix}`, request);
        },
        create(input, request) {
          return write<{ rule: import("../contracts/platform").RegistryRuleRecord }>("/api/admin/registry-rules", "POST", input, request);
        },
        detail(ruleId, request) {
          return get<import("../contracts/platform").RegistryRuleDetailResponse>(`/api/admin/registry-rules/${encodeURIComponent(ruleId)}`, request);
        },
        patch(ruleId, input, request) {
          return write<{ rule: import("../contracts/platform").RegistryRuleRecord }>(`/api/admin/registry-rules/${encodeURIComponent(ruleId)}`, "PATCH", input, request);
        },
        transition(ruleId, input, request) {
          return write<{ rule: import("../contracts/platform").RegistryRuleRecord }>(`/api/admin/registry-rules/${encodeURIComponent(ruleId)}`, "POST", input, request);
        },
        preview(ruleId, limit, request) {
          return write<import("../contracts/platform").RegistryRulePreviewResponse>(`/api/admin/registry-rules/${encodeURIComponent(ruleId)}/preview`, "POST", { limit: limit ?? 50 }, request);
        },
      },
      // R146-D05: field-level claims — retained competing values, explicit
      // decisions, reversal with a full audit trail.
      fieldClaims: {
        queue(params: { status?: string; limit?: number } = {}, request) {
          const search = new URLSearchParams();
          if (params.status) search.set("status", params.status);
          if (params.limit != null) search.set("limit", String(params.limit));
          const suffix = search.toString() ? `?${search.toString()}` : "";
          return get<import("../contracts/platform").FieldClaimQueueResponse>(`/api/admin/field-claims${suffix}`, request);
        },
        horse(horseId, request) {
          return get<import("../contracts/platform").HorseFieldClaimsResponse>(`/api/admin/horses/${positiveId(horseId)}/field-claims`, request);
        },
        select(horseId, claimId, reason, request) {
          return write<{ ok: boolean; applied_value: string | null; previous_canonical: string | null }>(`/api/admin/horses/${positiveId(horseId)}/field-claims/${positiveId(claimId)}/select`, "POST", { reason }, request);
        },
        reject(horseId, claimId, reason, request) {
          return write<{ ok: boolean; claim: import("../contracts/platform").FieldClaimRecord }>(`/api/admin/horses/${positiveId(horseId)}/field-claims/${positiveId(claimId)}/reject`, "POST", { reason }, request);
        },
        revertDecision(horseId, decisionId, reason, request) {
          return write<{ ok: boolean; reverted_decision_id: number; restored_value: string | null }>(`/api/admin/horses/${positiveId(horseId)}/field-claims/decisions/${positiveId(decisionId)}/revert`, "POST", { reason }, request);
        },
      },
      claims: (request) => get<{ claims: AdminClaimRecord[] }>("/api/admin/claims", request),
      reviewClaim(claimId, decision, note, request) {
        return write<ClaimReviewResponse>(`/api/admin/claims/${encodeURIComponent(claimId)}/review`, "POST", { decision, note }, request);
      },
      changeRequests: (request) => get<{ requests: ChangeRequestRecord[] }>("/api/admin/change-requests", request),
      reviewChangeRequest(requestId, decision, note, request) {
        return write<ChangeRequestReviewResponse>(`/api/admin/change-requests/${encodeURIComponent(requestId)}/review`, "POST", { decision, note }, request);
      },
      horses: {
        get: (id, request) => get<{ horse: AdminHorseRecord }>(`/api/admin/horses/${positiveId(id)}`, request),
        create(input: HorseCurationInput, request) {
          // R148 Task 6: direct-create retry idempotency. The SDK owns a stable
          // command key per principal + request content: an exact retry after a
          // lost response replays the original horse instead of creating a
          // duplicate; changed content mints a fresh key. Only minimal
          // principal-scoped reconciliation metadata lives in browser storage.
          const principal = publishedPrincipalId ?? "anonymous";
          const storageKey = `hr:create-cmd:${principal}`;
          const canonical = stableStringify(input);
          let pending: { digest: string; key: string } | null = null;
          try { pending = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "null"); } catch { pending = null; }
          const mintKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
          // A content hash keeps the stored key tied to the exact attempt; the
          // lightweight FNV-1a style digest is enough to detect changes here —
          // the server re-hashes the full payload authoritatively.
          let hash = 2166136261;
          for (let i = 0; i < canonical.length; i++) { hash ^= canonical.charCodeAt(i); hash = Math.imul(hash, 16777619); }
          const digest = String(hash >>> 0);
          const commandKey = pending && pending.digest === digest ? pending.key : mintKey();
          try { globalThis.localStorage?.setItem(storageKey, JSON.stringify({ digest, key: commandKey })); } catch { /* storage unavailable: server-side replay still guards */ }
          return write<{ horse: AdminHorseRecord; idempotent_replay?: boolean }>("/api/horses", "POST", { ...input, command_key: commandKey }, request).then((data) => {
            try { globalThis.localStorage?.removeItem(storageKey); } catch { /* ignore */ }
            return data;
          });
        },
        update(id, expectedRowVersion, changes, request) {
          return write<{ horse: AdminHorseRecord }>(`/api/horses/${positiveId(id)}`, "PUT", { expected_row_version: expectedRowVersion, changes }, request);
        },
        archive(id, request) {
          return write<{ ok: true; horseId: number }>(`/api/horses/${positiveId(id)}`, "DELETE", undefined, request);
        },
        createOwnershipPeriod(id, input, request) {
          return write<{ period: HorseOwnershipPeriodRecord | null; possible_overlap_period_ids: number[] }>(`/api/admin/horses/${positiveId(id)}/ownership-periods`, "POST", input, request);
        },
        createLifecycleEvent(id, input, request) {
          return write<{ events: HorseLifecycleEventRecord[]; canonical_field_updated: string | null }>(`/api/admin/horses/${positiveId(id)}/lifecycle-events`, "POST", input, request);
        },
      },
      maintenance: {
        reindex(request) {
          return write<ReindexResponse>("/api/admin/maintenance/reindex", "POST", undefined, request);
        },
        reconcileMutations(request) {
          return write<MutationReconciliationResponse>("/api/admin/maintenance/reconcile-mutations", "POST", undefined, request);
        },
      },
      // R117-18: the privacy redaction operator surface (retained R114
      // executor; decision and execution stay separate commands).
      privacy: {
        redactionQueue(request) {
          return get<AdminRedactionQueueResponse>("/api/admin/privacy/redaction-requests", request);
        },
        decideRedaction(id, input, request) {
          return write<RedactionDecideResponse>(`/api/admin/privacy/redaction-requests/${positiveId(id)}/decide`, "POST", { decision: input.decision, decision_note: input.decision_note }, request);
        },
        fulfillRedaction(id, executionNote, request) {
          return write<RedactionFulfillResponse>(`/api/admin/privacy/redaction-requests/${positiveId(id)}/fulfill`, "POST", executionNote ? { execution_note: executionNote } : {}, request);
        },
      },
      // R141: duplicate-resolution workbench. Preview is the read-only dry
      // run whose manifest_digest the versioned merge command requires;
      // unmerge goes through the guarded, manifest-verified reversal.
      duplicates: {
        candidates(params = {}, request) {
          const query: Record<string, unknown> = {};
          if (params.reason) query.reason = params.reason;
          if (params.limit != null) query.limit = params.limit;
          return get<DuplicateCandidatesResponse>(`/api/admin/duplicates?${queryString(query)}`, request);
        },
        mergePreview(keptHorseId, mergeHorseId, request) {
          return get<MergePreviewResponse>(`/api/admin/horses/${positiveId(keptHorseId)}/merge-preview?merge_horse_id=${positiveId(mergeHorseId)}`, request);
        },
        merge(keptHorseId, input, request) {
          return write<MergeCommandResponse>(`/api/admin/horses/${positiveId(keptHorseId)}/merge`, "POST", input, request);
        },
        unmerge(mergeId, input, request) {
          return write<UnmergeCommandResponse>(`/api/admin/horse-merges/${positiveId(mergeId)}/unmerge`, "POST", input, request);
        },
        mergeHistory(params = {}, request) {
          const query: Record<string, unknown> = {};
          if (params.limit != null) query.limit = params.limit;
          if (params.includeResolved) query.include_resolved = "1";
          return get<MergeHistoryResponse>(`/api/admin/horse-merges?${queryString(query)}`, request);
        },
      },
    },
    modules: {
      competitions: {
        list(params = {}, request) {
          return get<CompetitionsListResponse>(`/api/competitions?${queryString(params as Record<string, unknown>)}`, request);
        },
        detail(id, request) {
          // R124 (R122-T05): keyset paging passes through to the endpoint —
          // resultsCursor/resultsLimit become ?results_cursor/?results_limit.
          const query: Record<string, unknown> = {};
          if (request?.resultsCursor) query.results_cursor = request.resultsCursor;
          if (request?.resultsLimit != null) query.results_limit = request.resultsLimit;
          const qs = queryString(query);
          return get<CompetitionDetailResponse>(`/api/competitions/${positiveId(id)}${qs ? `?${qs}` : ""}`, request);
        },
        horseHistory(horseId, request) {
          const query: Record<string, unknown> = {};
          if (request?.historyCursor) query.history_cursor = request.historyCursor;
          if (request?.historyLimit != null) query.history_limit = request.historyLimit;
          const qs = queryString(query);
          return get<HorseCompetitionsResponse>(`/api/horses/${positiveId(horseId)}/competitions${qs ? `?${qs}` : ""}`, request);
        },
        adminCreateResult(competitionId, input, request) {
          return write<CompetitionResultCommandResponse>(`/api/admin/competitions/${positiveId(competitionId)}/results/versioned`, "POST", { result: input.result, operation_id: input.operation_id }, request);
        },
        adminUpdateResult(competitionId, resultId, input, request) {
          return write<CompetitionResultCommandResponse>(`/api/admin/competitions/${positiveId(competitionId)}/results/${positiveId(resultId)}/version`, "POST", { expected_version: input.expected_version, changes: input.changes, operation_id: input.operation_id }, request);
        },
        adminUpdateEvent(competitionId, input, request) {
          return write<CompetitionEventCommandResponse>(`/api/admin/competitions/${positiveId(competitionId)}/version`, "POST", { expected_version: input.expected_version, changes: input.changes, operation_id: input.operation_id }, request);
        },
      },
      // R140-G: the national racing surfaces (read-only, provenance-stamped).
      racing: {
        horse(horseId, request) {
          return get<HorseRacingResponse>(`/api/horses/${positiveId(horseId)}/racing`, request);
        },
        races(params = {}, request) {
          const query: Record<string, unknown> = {};
          if (params.season) query.season = params.season;
          if (params.location) query.location = params.location;
          if (params.weekId) query.week_id = params.weekId;
          if (params.limit != null) query.limit = params.limit;
          if (params.offset != null) query.offset = params.offset;
          const qs = queryString(query);
          return get<RacingRacesResponse>(`/api/racing/races${qs ? `?${qs}` : ""}`, request);
        },
        race(raceId, request) {
          return get<RacingRaceDetailResponse>(`/api/racing/races/${encodeURIComponent(raceId)}`, request);
        },
      },
      imports: {
        adminBatchPreview(batchId, request) {
          return get<ImportBatchPreviewResponse>(`/api/admin/imports/batches/${positiveId(batchId)}/preview`, request);
        },
        adminReviewReport(batchId, request) {
          return get<ImportReviewReportResponse>(`/api/admin/imports/batches/${positiveId(batchId)}/review-report`, request);
        },
        adminReviewRow(batchId, rowId, input, request) {
          return write<ImportRowReviewResponse>(`/api/admin/imports/batches/${positiveId(batchId)}/rows/${positiveId(rowId)}/review`, "POST", {
            decision: input.decision,
            reason: input.reason,
            operation_id: input.operation_id,
            ...(input.target_horse_id === undefined ? {} : { target_horse_id: input.target_horse_id }),
          }, request);
        },
      },
      market: {
        list(params = {}, request) {
          return get<MarketListResponse>(`/api/market/listings?${queryString(params as Record<string, unknown>)}`, request);
        },
        detail(id, request) {
          return get<MarketListingDetailResponse>(`/api/market/listings/${encodeURIComponent(id)}`, request);
        },
        create(input, request) {
          return write<{ listing: MarketListingRecord }>("/api/market/listings", "POST", input, request);
        },
        // R88 P03: expected_version is mandatory — the server rejects stale
        // writes with 409 listing_version_conflict (details.current_version).
        setStatus(id, status, request) {
          const { expectedVersion, ...options } = request ?? {};
          return write<{ id: string; status: string; row_version: number }>(`/api/market/listings/${encodeURIComponent(id)}/status`, "POST", { status, expected_version: expectedVersion }, options);
        },
        renew(id, input, request) {
          const { expectedVersion, ...options } = request ?? {};
          return write<{ id: string; status: string; expires_at: string; row_version: number }>(`/api/market/listings/${encodeURIComponent(id)}/renew`, "POST", { extend_days: input?.extend_days, expected_version: expectedVersion }, options);
        },
        inquire(id, input, request) {
          return write<{ inquiry: { id: string; listing_id: string; status: string; row_version: number } }>(`/api/market/listings/${encodeURIComponent(id)}/inquiries`, "POST", input, request);
        },
        setInquiryStatus(id, status, request) {
          const { expectedVersion, ...options } = request ?? {};
          return write<{ inquiry: { id: string; status: string; row_version: number } }>(`/api/market/inquiries/${encodeURIComponent(id)}/status`, "POST", { status, expected_version: expectedVersion }, options);
        },
        mine(request) {
          return get<{ listings: MarketListingRecord[]; inquiries: Array<Record<string, unknown>> }>("/api/market/mine", request);
        },
        // R117-15: the buyer-owned sent-inquiry inbox (bounded, paginated).
        sentInquiries(request) {
          return get<MarketSentInquiriesResponse>("/api/market/inquiries/sent", request);
        },
        // R98-N12: conversation, reply thread, buyer closure, watchlist, blocks, dossier link.
        conversation(inquiryId, request) {
          return get<MarketConversationResponse>(`/api/market/inquiries/${encodeURIComponent(inquiryId)}`, request);
        },
        reply(inquiryId, input, request) {
          return write<{ reply: { id: string; inquiry_id: string; author_side: string; created_at: string } }>(`/api/market/inquiries/${encodeURIComponent(inquiryId)}/replies`, "POST", input, request);
        },
        closeOwnInquiry(inquiryId, request) {
          const { expectedVersion, ...options } = request ?? {};
          return write<{ inquiry: { id: string; status: string; row_version: number } }>(`/api/market/inquiries/${encodeURIComponent(inquiryId)}/close`, "POST", { expected_version: expectedVersion }, options);
        },
        watchlist(request) {
          return get<MarketWatchlistResponse>("/api/market/watchlist", request);
        },
        watch(listingId, request) {
          return write<{ added: boolean; bounded: boolean }>(`/api/market/watchlist/${encodeURIComponent(listingId)}`, "POST", {}, request);
        },
        unwatch(listingId, request) {
          return write<{ removed: boolean }>(`/api/market/watchlist/${encodeURIComponent(listingId)}`, "DELETE", {}, request);
        },
        blocks(request) {
          return get<{ rows: Array<{ blocked_user_id: string; reason_private: string | null; created_at: string }>; note: string }>("/api/market/blocks", request);
        },
        block(input, request) {
          return write<{ blocked: boolean; note: string }>("/api/market/blocks", "POST", input, request);
        },
        unblock(userId, request) {
          return write<{ removed: boolean }>(`/api/market/blocks/${encodeURIComponent(userId)}`, "DELETE", {}, request);
        },
        attachDossier(id, input, request) {
          return write<{ id: string; dossier_id: number | null; row_version: number; note: string }>(`/api/market/listings/${encodeURIComponent(id)}/dossier`, "POST", input, request);
        },
      },
      genetics: {
        capabilities: (horseId, request) => get(`/api/horses/${positiveId(horseId)}/genetic-access`, request),
        addTest: (horseId, input, request) => write(`/api/horses/${positiveId(horseId)}/genetics`, "POST", input, request),
        interpret: (testId, input, request) => write(`/api/admin/genetic-tests/${positiveId(testId)}/interpretation`, "POST", input, request),
        reviewHistory: (testId, request) => get(`/api/admin/genetic-tests/${positiveId(testId)}/interpretation`, request),
        reviewPairing(testId, input, request) {
          return write<{ review: import("../contracts/platform").PairingReviewRecord }>(`/api/admin/genetic-tests/${positiveId(testId)}/pairing-review`, "POST", input, request);
        },
        // R140-A: health-result publication switch (privileged staff only).
        setDisclosure(testId, input, request) {
          return write<import("../contracts/platform").GeneticDisclosureResponse>(`/api/admin/genetic-tests/${positiveId(testId)}/disclosure`, "POST", input, request);
        },
        // R144-D02: explainable publication-decision history for one health result.
        disclosureHistory(testId, request) {
          return get<import("../contracts/platform").GeneticDisclosureHistoryResponse>(`/api/admin/genetic-tests/${positiveId(testId)}/disclosure`, request);
        },
        horse(horseId, request) {
          return get<HorseGeneticsResponse>(`/api/horses/${positiveId(horseId)}/genetics`, request);
        },
      },
      professionalGrants: {
        // R144-D01: horse/data/purpose-scoped professional grants (staff managed).
        create(input, request) {
          return write<import("../contracts/platform").ProfessionalGrantCreateResponse>("/api/admin/professional-grants", "POST", input, request);
        },
        list(options?: { horse_id?: number } & PlatformRequestOptions) {
          const query = options?.horse_id != null ? `?horse_id=${positiveId(options.horse_id)}` : "";
          return get<import("../contracts/platform").ProfessionalGrantListResponse>(`/api/admin/professional-grants${query}`, options);
        },
        revoke(grantId, input, request) {
          return write<import("../contracts/platform").ProfessionalGrantRevokeResponse>(`/api/admin/professional-grants/${encodeURIComponent(grantId)}/revoke`, "POST", input, request);
        },
      },
      breedings: {
        correct(recordId, input, request) {
          return write<import("../contracts/platform").BreedingCorrectionResponse>(`/api/admin/breeding/${positiveId(recordId)}/correct`, "POST", input, request);
        },
        horse(horseId, request) {
          return get<HorseBreedingsResponse>(`/api/horses/${positiveId(horseId)}/breedings`, request);
        },
      },
      media: {
        list(horseId, request) {
          return get<HorseMediaListResponse>(`/api/horses/${positiveId(horseId)}/media`, request);
        },
        upload(horseId, input, request) {
          return write<{ media: HorseMediaRecord }>(`/api/horses/${positiveId(horseId)}/media`, "POST", input, request);
        },
        /** R88 P09: mint a short-lived signed URL for a private document the
         *  caller can already read (15-minute TTL, revocable grant row). */
        access(mediaId, request) {
          return write<MediaAccessTokenResponse>(`/api/media/${encodeURIComponent(mediaId)}/access`, "POST", undefined, request);
        },
        revokeAccess(mediaId, grantId, request) {
          return write<{ media_id: string; grant_id: string; revoked: true }>(`/api/media/${encodeURIComponent(mediaId)}/access/${encodeURIComponent(grantId)}`, "DELETE", undefined, request);
        },
        setPublication(mediaId, consent, request) {
          return write<MediaPublicationResponse>(`/api/media/${encodeURIComponent(mediaId)}/publication`, "POST", {
            consent_state: consent, expected_version: expectedVersion(request.expectedVersion),
          }, request);
        },
        remove(id, request) {
          return write<{ deleted: string }>(`/api/media/${encodeURIComponent(id)}`, "DELETE", undefined, request);
        },
        verify(id, decision, note, request) {
          return write<{ id: string; verification: string; verification_level: string; note: string }>(`/api/admin/media/${encodeURIComponent(id)}/verify`, "POST", { decision, note, expected_version: request?.expectedVersion }, request);
        },
        fileUrl: (id) => `/api/media/file/${encodeURIComponent(id)}`,
      },
      authExt: {
        register(input, request) {
          return sessionWrite<AuthTransportResponse & { emailVerification?: EmailVerificationInfo }>("/api/auth/register", input, request);
        },
        otpRequest(phone, request) {
          return write<OtpRequestResponse>("/api/auth/otp/request", "POST", { phone }, request);
        },
        otpVerify(input, request) {
          return sessionWrite<AuthTransportResponse & { method?: string }>("/api/auth/otp/verify", input, request);
        },
      },
      registryExtras: {
        duplicateCheck(params = {}, request) {
          return get<DuplicateCheckResponse>(`/api/horses/duplicate-check?${queryString(params as Record<string, unknown>)}`, request);
        },
        certificateUrl: (horseId, lang = "fa") => `/api/horses/${positiveId(horseId)}/certificate.svg?lang=${lang}`,
        issueCertificate(horseId, lang = "fa", request) {
          return write<{ certificate: { id: string; horse_id: number; language: string; verification_code: string; svg_url: string } }>(`/api/horses/${positiveId(horseId)}/certificate?lang=${lang}`, "POST", undefined, request);
        },
        // Master-Ai plan T06: versioned registry extracts.
        issueExtract(horseId, lang = "fa", request) {
          return write<{ extract: { id: string; horse_id: number; extract_code: string; language: string; issued_at: string; payload_digest: string; verify_url: string } }>(`/api/horses/${positiveId(horseId)}/certificate?lang=${lang}`, "POST", undefined, request);
        },
        verifyExtract(code, request) {
          return get<{ valid: boolean; reason?: string; extract?: Record<string, unknown> }>(`/api/extract/verify?code=${encodeURIComponent(code)}`, request);
        },
      },
      attestations: {
        listIssuers(request) {
          return get<{ issuers: IssuerDirectoryRow[] }>("/api/issuers", request);
        },
        listHorseAttestations(horseId, request) {
          return get<HorseCredentialStoriesResponse>(`/api/horses/${positiveId(horseId)}/attestations`, request);
        },
        // R117-16: public verification + the member/owner lifecycle commands.
        verify(attestationId, request) {
          return get<CredentialVerificationResponse>(`/api/attestations/${encodeURIComponent(attestationId)}/verify`, request);
        },
        issue(issuerId, input, request) {
          return write<{ attestation: IssuedCredentialStory }>(`/api/issuers/${encodeURIComponent(issuerId)}/attestations`, "POST", input, request);
        },
        revoke(attestationId, input, request) {
          return write<{ revoked: string; reason: string }>(`/api/attestations/${encodeURIComponent(attestationId)}/revoke`, "POST", input, request);
        },
        supersede(attestationId, input, request) {
          return write<{ superseded: string; reason: string; replacement: IssuedCredentialStory }>(`/api/attestations/${encodeURIComponent(attestationId)}/supersede`, "POST", input, request);
        },
        reviewSnapshot(attestationId, request) {
          return get<CredentialSnapshotReviewResponse>(`/api/admin/attestations/${encodeURIComponent(attestationId)}/snapshot`, request);
        },
      },
      // Master-Ai T10: horse-scoped grants. The UI asks the backend what the
      // viewer may do on THIS horse; it never infers permissions from role.
      access: {
        horseActions(horseId, request) {
          return get<HorseAccessActionsResponse>(`/api/horses/${positiveId(horseId)}/actions`, request);
        },
        myGrants(request) {
          return get<{ grants: HorseAccessGrantRecord[] }>("/api/grants/mine", request);
        },
      },
      // R88 P20: professional directory (P11) — public consent-gated reads + claims.
      directory: {
        persons(params, request) {
          return get<DirectoryPersonsResponse>(withQuery("/api/directory/persons", params), request);
        },
        person(personId, request) {
          return get<DirectoryPersonDetailResponse>(`/api/directory/persons/${positiveId(personId)}`, request);
        },
        organizations(params, request) {
          return get<DirectoryOrganizationsResponse>(withQuery("/api/directory/organizations", params), request);
        },
        submitClaim(input, request) {
          return write<DirectoryClaimResponse>("/api/directory/claims", "POST", input, request);
        },
        myClaims(request) {
          return get<DirectoryMyClaimsResponse>("/api/directory/claims/mine", request);
        },
        managedProfile(personId, request) {
          return get<DirectoryManagedProfileResponse>(`/api/directory/persons/${positiveId(personId)}/profile`, request);
        },
        upsertProfile(personId, input, request) {
          return write<DirectoryProfileResponse>(`/api/directory/persons/${positiveId(personId)}/profile`, "PUT", input, request);
        },
        addCredential(personId, input, request) {
          return write<DirectoryCredentialResponse>(`/api/directory/persons/${positiveId(personId)}/credentials`, "POST", input, request);
        },
      },
      // R98-N07: organization onboarding — managed profile (same version/428
      // semantics), staff lifecycle, per-organization inbox, officials.
      organizations: {
        publicCard(organizationId, request) {
          return get<OrganizationPublicCardResponse>(`/api/directory/organizations/${positiveId(organizationId)}`, request);
        },
        managed(organizationId, request) {
          return get<OrganizationManagedResponse>(`/api/organizations/${positiveId(organizationId)}/manage`, request);
        },
        upsertProfile(organizationId, input, request) {
          return write<OrganizationProfileResponse>(`/api/organizations/${positiveId(organizationId)}/profile`, "PUT", input, request);
        },
        staff(organizationId, request) {
          return get<OrganizationStaffResponse>(`/api/organizations/${positiveId(organizationId)}/staff`, request);
        },
        inbox(organizationId, request) {
          return get<OrganizationInboxResponse>(`/api/organizations/${positiveId(organizationId)}/inbox`, request);
        },
        invite(organizationId, input, request) {
          return write<OrganizationStaffInviteResponse>(`/api/organizations/${positiveId(organizationId)}/staff/invites`, "POST", input, request);
        },
        myInvites(request) {
          return get<{ invites: Array<Record<string, unknown>> }>("/api/organizations/invites/mine", request);
        },
        respondInvite(inviteId, accept, request) {
          return write<{ outcome: { status: string; membershipId: number | null } }>(`/api/organizations/invites/${positiveId(inviteId)}`, "POST", { accept }, request);
        },
        setStaffRole(organizationId, targetUserId, newRole, request) {
          return write<{ target_user_id: string; new_role: string }>(`/api/organizations/${positiveId(organizationId)}/staff/${encodeURIComponent(targetUserId)}/role`, "POST", { new_role: newRole }, request);
        },
        revokeStaff(organizationId, targetUserId, reason, request) {
          return write<{ target_user_id: string; status: string; note: string }>(`/api/organizations/${positiveId(organizationId)}/staff/${encodeURIComponent(targetUserId)}/revoke`, "POST", { reason }, request);
        },
        appointOfficial(organizationId, input, request) {
          return write<{ appointment: Record<string, unknown>; note: string }>(`/api/organizations/${positiveId(organizationId)}/officials`, "POST", input, request);
        },
        addCredential(organizationId, input, request) {
          return write<DirectoryCredentialResponse>(`/api/organizations/${positiveId(organizationId)}/credentials`, "POST", input, request);
        },
      },
      // R88 P20: consented service request inbox (P12) — leads, never appointments.
      serviceRequests: {
        create(input, request) {
          return write<ServiceRequestCreateResponse>("/api/service-requests", "POST", input, request);
        },
        mine(request) {
          return get<ServiceRequestListResponse>("/api/service-requests/mine", request);
        },
        inbox(request) {
          return get<ServiceRequestInboxResponse>("/api/service-requests/inbox", request);
        },
        detail(id, request) {
          return get<ServiceRequestDetailResponse>(`/api/service-requests/${positiveId(id)}`, request);
        },
        setStatus(id, status, request) {
          return write<ServiceRequestStatusResponse>(`/api/service-requests/${positiveId(id)}/status`, "POST", { status, expected_version: request?.expectedVersion }, request);
        },
        block(id, request) {
          return write<{ blocked: true; provider_person_id: number; note: string }>(`/api/service-requests/${positiveId(id)}/block`, "POST", undefined, request);
        },
        report(id, input, request) {
          return write<{ reported: true; report_id: number }>(`/api/service-requests/${positiveId(id)}/report`, "POST", input, request);
        },
        // R95-N12: consent withdrawal + anti-abuse lifecycle.
        withdrawConsent(id, request) {
          return write<ServiceRequestConsentWithdrawResponse>(`/api/service-requests/${positiveId(id)}/consent`, "POST", undefined, request);
        },
        providerBlock(id, input, request) {
          return write<ServiceRequestProviderBlockResponse>(`/api/service-requests/${positiveId(id)}/provider-block`, "POST", input ?? {}, request);
        },
        redactNote(id, request) {
          return write<ServiceRequestRedactResponse>(`/api/service-requests/${positiveId(id)}/redact`, "POST", undefined, request);
        },
        export(request) {
          return get<ServiceRequestExportResponse>("/api/service-requests/export", request);
        },
        privacyPolicy(request) {
          return get<ServicePrivacyPolicyResponse>("/api/service-requests/privacy-policy", request);
        },
        // R108-05: the uncertain-write reconciliation read (actor-scoped).
        reconcileIntent(key, request) {
          return get<ServiceIntentReconciliationResponse>(`/api/service-requests/intents/${encodeURIComponent(key)}`, request);
        },
      },
      // R88 P20: farm workspaces (P14) — working sets, never ownership.
      workspaces: {
        create(input, request) {
          return write<WorkspaceCreateResponse>("/api/workspaces", "POST", input, request);
        },
        mine(request) {
          return get<WorkspacesMineResponse>("/api/workspaces/mine", request);
        },
        dashboard(id, request) {
          return get<WorkspaceDashboardResponse>(`/api/workspaces/${positiveId(id)}`, request);
        },
        remove(id, request) {
          return write<{ deleted: true; note: string }>(`/api/workspaces/${positiveId(id)}`, "DELETE", undefined, request);
        },
        addHorse(id, horseId, request) {
          return write<WorkspaceHorseMutationResponse>(`/api/workspaces/${positiveId(id)}/horses`, "POST", { horse_id: positiveId(horseId) }, request);
        },
        bulkHorses(id, input, request) {
          return write<WorkspaceBulkResponse>(`/api/workspaces/${positiveId(id)}/horses/bulk`, "POST", input, request);
        },
        removeHorse(id, horseId, request) {
          return write<WorkspaceHorseMutationResponse>(`/api/workspaces/${positiveId(id)}/horses/${positiveId(horseId)}`, "DELETE", undefined, request);
        },
        assignStaff(id, input, request) {
          return write<WorkspaceStaffResponse>(`/api/workspaces/${positiveId(id)}/staff`, "POST", input, request);
        },
        revokeStaff(id, userId, request) {
          return write<{ revoked: true; user_id: string; note: string }>(`/api/workspaces/${positiveId(id)}/staff/${encodeURIComponent(userId)}/revoke`, "POST", undefined, request);
        },
        addTask(id, input, request) {
          return write<WorkspaceTaskResponse>(`/api/workspaces/${positiveId(id)}/tasks`, "POST", input, request);
        },
        tasks(id, params, request) {
          // R124 (R122-T05): cursor/limit ride the query string; status keeps
          // its default (open) server-side.
          const query: Record<string, string> = {};
          if (params?.status) query.status = params.status;
          if (params?.cursor) query.cursor = params.cursor;
          if (params?.limit != null) query.limit = String(params.limit);
          const qs = new URLSearchParams(query).toString();
          return get<WorkspaceTasksResponse>(`/api/workspaces/${positiveId(id)}/tasks${qs ? `?${qs}` : ""}`, request);
        },
        completeTask(id, taskId, request) {
          return write<WorkspaceTaskCompleteResponse>(`/api/workspaces/${positiveId(id)}/tasks/${positiveId(taskId)}/complete`, "POST", { expected_version: expectedVersion(request?.expectedVersion) }, request);
        },
        reopenTask(id, taskId, request) {
          return write<WorkspaceTaskReopenResponse>(`/api/workspaces/${positiveId(id)}/tasks/${positiveId(taskId)}/reopen`, "POST", { expected_version: expectedVersion(request?.expectedVersion) }, request);
        },
        inviteStaff(id, input, request) {
          return write<WorkspaceInviteResponse>(`/api/workspaces/${positiveId(id)}/invites`, "POST", { ...input, invitee_user_id: workspaceUserId(input.invitee_user_id) }, request);
        },
        myInvites(request) { return get<WorkspaceInvitesResponse>("/api/workspaces/invites/mine", request); },
        respondInvite(id, action, request) {
          if (action !== "accept" && action !== "decline") throw new PlatformClientError(400, "invalid_response", "An explicit accept or decline decision is required");
          return write<WorkspaceInviteRespondResponse>(`/api/workspaces/invites/${positiveId(id)}/respond`, "POST", { action }, request);
        },
        revokeInvite(id, userId, request) {
          return write<{ revoked: true; note: string }>(`/api/workspaces/${positiveId(id)}/invites/${workspaceUserId(userId)}/revoke`, "POST", undefined, request);
        },
        documents(id, params, request) {
          return get<WorkspaceDocumentsResponse>(`/api/workspaces/${positiveId(id)}/documents${params?.includeArchived ? "?all=1" : ""}`, request);
        },
        createDocument(id, input, request) {
          return write<{ created: true; note: string }>(`/api/workspaces/${positiveId(id)}/documents`, "POST", input, request);
        },
        updateDocument(id, documentId, input, request) {
          return write<{ updated: true }>(`/api/workspaces/${positiveId(id)}/documents/${positiveId(documentId)}`, "PATCH", { ...input, expected_version: expectedVersion(request?.expectedVersion) }, request);
        },
        archiveDocument(id, documentId, request) {
          return write<{ archived: true; note: string }>(`/api/workspaces/${positiveId(id)}/documents/${positiveId(documentId)}/archive`, "POST", undefined, request);
        },
        reassignTask(id, taskId, userId, request) {
          return write<WorkspaceTaskReassignResponse>(`/api/workspaces/${positiveId(id)}/tasks/${positiveId(taskId)}/reassign`, "POST", {
            assigned_to_user_id: userId === null ? null : workspaceUserId(userId), expected_version: expectedVersion(request?.expectedVersion),
          }, request);
        },
        importTasks(id, tasks, request) {
          if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 200) throw new PlatformClientError(400, "invalid_import", "Import requires 1-200 tasks");
          const intentKey = (request as { intentKey?: string } | undefined)?.intentKey;
          const body: Record<string, unknown> = { tasks };
          if (intentKey != null) body.intent_key = intentKey;
          return write<WorkspaceTaskImportResponse>(`/api/workspaces/${positiveId(id)}/tasks/import`, "POST", body, request);
        },
        exportUrl(id) {
          return `/api/workspaces/${positiveId(id)}/export`;
        },
      },
      // R88 P20: billing (P17-P19). Money is integer minor IRR; toman is display-only.
      billing: {
        catalog(request) {
          return get<BillingCatalogResponse>("/api/billing/catalog", request);
        },
        offers(request) {
          return get<BillingOffersResponse>("/api/commerce/offers", request);
        },
        createOrder(input, request) {
          return write<BillingOrderResponse>("/api/billing/orders", "POST", input, request);
        },
        myOrders(request) {
          return get<BillingMyOrdersResponse>("/api/billing/orders/mine", request);
        },
        order(id, request) {
          return get<BillingOrderDetailResponse>(`/api/billing/orders/${positiveId(id)}`, request);
        },
        cancelOrder(id, request) {
          return write<{ cancelled: true; note: string }>(`/api/billing/orders/${positiveId(id)}/cancel`, "POST", undefined, request);
        },
        pay(id, request) {
          return write<BillingPayResponse>(`/api/billing/orders/${positiveId(id)}/pay`, "POST", undefined, request);
        },
        entitlements(request) {
          return get<BillingEntitlementsResponse>("/api/billing/entitlements", request);
        },
      },
    },
  };
}

function positiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Expected a positive registry id");
  return value;
}

/** R88 P20: append a query string only when it has content (queryString returns no leading "?"). */
function withQuery<T extends object>(url: string, values?: T): string {
  if (!values) return url;
  const query = queryString(values as unknown as Record<string, unknown>);
  return query ? `${url}?${query}` : url;
}

function queryString(values: RegistryBrowseParams | Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const value = typeof raw === "boolean" ? (raw ? "1" : "0") : String(raw);
    params.set(key, value);
  }
  return params.toString();
}

interface AuthTransportResponse {
  user: PlatformUser | null;
  csrfToken: string | null;
  permissions: PlatformPermission[];
}

function normalizeLogin(input: PlatformLoginInput): PlatformLoginInput {
  const email = input.email.trim();
  if (!email || !input.password) throw new Error("Email and password are required");
  return { email, password: input.password };
}

/** Match the router's account-id grammar before constructing private paths. */
function workspaceUserId(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,64}$/.test(value)) throw new PlatformClientError(400, "invalid_user_id", "A valid workspace account id is required");
  return value;
}
function expectedVersion(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) throw new PlatformClientError(400, "invalid_version", "Reload the current row before submitting this versioned command");
  return value as number;
}
