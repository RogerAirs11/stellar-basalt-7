import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPlatformClientError } from "../errors";
import { useScopedState } from "./principalScope";
import { classifyCommandError } from "./commandModel";
import type {
  DirectoryManagedProfileResponse,
  DirectoryProfileInput,
} from "../../contracts/platform";

/**
 * R98-N06 — the ONE headless person-profile editor controller shared by every
 * frontend. Renderer-agnostic and pure where possible: the five independent
 * visual frontends bind to this state machine, each with its own components.
 *
 * Pinned behaviors (from the reviewed N06 ticket):
 *  - The actual stored row_version populates every update; FIRST CREATION
 *    (no stored profile row) submits WITHOUT expected_version — the server's
 *    428 gate is the proof, not a client guess.
 *  - An editor without private-contact permission (platform staff curating,
 *    or a representation that was revoked) never renders or submits private
 *    contact fields: they are absent from the draft AND the submission.
 *  - On 409 profile_conflict the controller fetches the CURRENT profile and
 *    reports FIELD-LEVEL differences against the local draft; the draft is
 *    retained locally, never silently overwritten.
 *  - A publication consent withdrawn elsewhere is NEVER auto-resubmitted:
 *    when the local draft says "publish" but the current server state says
 *    consent was withdrawn, resubmission is blocked until the representative
 *    explicitly re-consents (reconsentRequired).
 *  - The claim flow explains the difference between ACCOUNT VERIFICATION,
 *    PERSON REPRESENTATION and PROFESSIONAL QUALIFICATION, and appeals are
 *    bounded: only the claimant's own REJECTED claims may be appealed.
 */

// ---------------------------------------------------------------------------
// Draft model
// ---------------------------------------------------------------------------

export interface ProfileEditorPermissions {
  edit: boolean;
  initial_publication: boolean;
  private_contact: boolean;
}

export interface ProfileEditorDraft {
  service_categories: string[];
  province_code: string;
  /** Explicit confirmation that the province was picked under the CURRENT
   * reference dataset — sent as province_code_scheme on every submission. */
  province_scheme_confirmed: boolean;
  city: string;
  contact_preference: "platform_message" | "phone" | "email";
  contact_value: string;
  languages: string;
  availability_text: string;
  publication_consent: boolean;
}

export type StoredProfile = DirectoryManagedProfileResponse["profile"] & {
  contact_value?: string | null;
};

export type ProfileEditorState =
  | { phase: "loading" }
  | { phase: "denied"; reason: string }
  | { phase: "unavailable"; reason: string }
  /** No stored profile row yet — the representative is creating it. */
  | { phase: "empty"; draft: ProfileEditorDraft; permissions: ProfileEditorPermissions; stored: null }
  | { phase: "ready"; draft: ProfileEditorDraft; permissions: ProfileEditorPermissions; stored: StoredProfile }
  | { phase: "saving"; draft: ProfileEditorDraft; permissions: ProfileEditorPermissions; stored: StoredProfile | null }
  | { phase: "saved"; draft: ProfileEditorDraft; permissions: ProfileEditorPermissions; stored: StoredProfile | null; publication: string }
  | {
      phase: "conflict";
      draft: ProfileEditorDraft;
      permissions: ProfileEditorPermissions;
      stored: StoredProfile | null;
      current: StoredProfile;
      differences: ProfileFieldDifference[];
      /** True when the draft still wants publication but consent was
       * withdrawn on the server — resubmission requires explicit re-consent. */
      reconsentRequired: boolean;
    };

export interface ProfileFieldDifference {
  field: keyof ProfileEditorDraft;
  local: string;
  server: string;
}

/** A first-creation draft: no stored row, publication only with consent. */
export function newDraft(): ProfileEditorDraft {
  return {
    service_categories: [],
    province_code: "",
    province_scheme_confirmed: false,
    city: "",
    contact_preference: "platform_message",
    contact_value: "",
    languages: "",
    availability_text: "",
    publication_consent: false,
  };
}

/** Build a draft from the loaded profile. Private contact fields enter the
 * draft ONLY when the viewer holds private-contact permission — an editor
 * without that permission cannot render or submit them. */
export function draftFromProfile(
  profile: StoredProfile,
  permissions: ProfileEditorPermissions,
): ProfileEditorDraft {
  return {
    service_categories: [...profile.service_categories],
    province_code: profile.province_code ?? "",
    province_scheme_confirmed: true, // the stored province came from the current scheme
    city: profile.city ?? "",
    contact_preference: profile.contact_preference ?? "platform_message",
    contact_value: permissions.private_contact ? profile.contact_value ?? "" : "",
    languages: profile.languages ?? "",
    availability_text: profile.availability_text ?? "",
    publication_consent: profile.publication_consent === true,
  };
}

// ---------------------------------------------------------------------------
// Submission building (pure — the acceptance core)
// ---------------------------------------------------------------------------

export interface ProfileSubmission extends DirectoryProfileInput {}

/**
 * Build the profile submission from a draft.
 *
 *  - expected_version is populated from the ACTUAL stored row_version, and
 *    only when a stored row exists (first creation submits without it — the
 *    server's 428 gate distinguishes creation from update, never the client).
 *  - province_code_scheme is sent explicitly whenever a province is set.
 *  - Private contact fields are stripped entirely without private-contact
 *    permission: the server ignores them for non-representatives anyway, and
 *    the client never even carries them.
 */
export function buildProfileSubmission(
  draft: ProfileEditorDraft,
  stored: StoredProfile | null,
  permissions: ProfileEditorPermissions,
  currentScheme: string,
): ProfileSubmission {
  const submission: ProfileSubmission = {
    service_categories: [...draft.service_categories],
    province_code: draft.province_code || null,
    city: draft.city || null,
    contact_preference: draft.contact_preference,
    languages: draft.languages || null,
    availability_text: draft.availability_text || null,
    publication_consent: draft.publication_consent,
  };
  if (stored && stored.row_version > 0) {
    submission.expected_version = stored.row_version;
  }
  if (draft.province_code) {
    submission.province_code_scheme = currentScheme;
  }
  if (permissions.private_contact) {
    submission.contact_value = draft.contact_value || null;
  }
  return submission;
}

/** Field-level differences between the local draft and the current server
 * state — surfaced on conflict so the representative decides field by field. */
export function diffProfileDraft(draft: ProfileEditorDraft, current: StoredProfile): ProfileFieldDifference[] {
  const differences: ProfileFieldDifference[] = [];
  const push = (field: keyof ProfileEditorDraft, local: string, server: string) => {
    if (local !== server) differences.push({ field, local, server });
  };
  push("service_categories", [...draft.service_categories].sort().join(","), [...current.service_categories].sort().join(","));
  push("province_code", draft.province_code, current.province_code ?? "");
  push("city", draft.city, current.city ?? "");
  push("contact_preference", draft.contact_preference, current.contact_preference ?? "platform_message");
  push("languages", draft.languages, current.languages ?? "");
  push("availability_text", draft.availability_text, current.availability_text ?? "");
  push("publication_consent", draft.publication_consent ? "consented" : "withdrawn", current.publication_consent ? "consented" : "withdrawn");
  return differences;
}

/** True when the draft wants publication but the current server state has
 * consent withdrawn — the old publication choice must never be auto-resubmitted. */
export function consentWithdrawnElsewhere(draft: ProfileEditorDraft, current: StoredProfile): boolean {
  return draft.publication_consent === true && current.publication_consent === false;
}

// ---------------------------------------------------------------------------
// The claim-flow explainer (shared copy, rendered by each frontend's visuals)
// ---------------------------------------------------------------------------

export interface ClaimExplainerEntry {
  concept: "account_verification" | "person_representation" | "professional_qualification";
  en: string;
  fa: string;
}

export const DIRECTORY_CLAIM_EXPLAINER: readonly ClaimExplainerEntry[] = [
  {
    concept: "account_verification",
    en: "Account verification confirms you control this account (email/OTP). It says nothing about any person in the registry.",
    fa: "تأیید حساب فقط کنترل شما بر این حساب را ثبت می‌کند (ایمیل/رمز یک‌بار‌مصرف). درباره هیچ شخص موجود در ثبت‌نامه چیزی نمی‌گوید.",
  },
  {
    concept: "person_representation",
    en: "Person representation is granted when an approved directory claim verifies your link to a specific person. It is what unlocks private contact management and initial publication consent.",
    fa: "نمایندگی شخص با تأیید درخواست فهرست متخصصان و اثبات پیوند شما با شخص مشخص فعال می‌شود. همین نمایندگی است که مدیریت تماس خصوصی و رضایت اولیه انتشار را باز می‌کند.",
  },
  {
    concept: "professional_qualification",
    en: "A professional qualification is a credential you record (self-declared at first). It stays unverified until platform review or an issuer attestation — it never proves representation by itself.",
    fa: "صلاحیت حرفه‌ای مدرکی است که ثبت می‌کنید (در ابتدا خوداظهاری). تا بازبینی سامانه یا تأیید صادرکننده، «تأییدنشده» می‌ماند و هرگز به‌تنهایی نمایندگی را اثبات نمی‌کند.",
  },
];

export interface DirectoryClaimSummary {
  id: number;
  claim_type: string;
  person_id: number | null;
  organization_id: number | null;
  status: string;
  review_note: string | null;
  created_at: string | null;
  appeal_for_claim_id: number | null;
  /** Bounded appeal availability: only the claimant's own REJECTED claims. */
  appealable: boolean;
}

/** Normalize raw claim rows (server returns Record<string, unknown>) into the
 * honest claim summary — status, rejection reason and appeal availability. */
export function summarizeClaims(rows: ReadonlyArray<Record<string, unknown>>): DirectoryClaimSummary[] {
  return rows.map((row) => {
    const status = typeof row.status === "string" ? row.status : "unknown";
    const appealFor = typeof row.appeal_for_claim_id === "number" ? row.appeal_for_claim_id : null;
    return {
      id: typeof row.id === "number" ? row.id : -1,
      claim_type: typeof row.claim_type === "string" ? row.claim_type : "person",
      person_id: typeof row.person_id === "number" ? row.person_id : null,
      organization_id: typeof row.organization_id === "number" ? row.organization_id : null,
      status,
      review_note: typeof row.review_note === "string" ? row.review_note : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
      appeal_for_claim_id: appealFor,
      // Bounded appeals: a rejected claim may be appealed ONCE — an appeal
      // already referencing it (or this row BEING an appeal) is not re-appealable.
      appealable: status === "rejected" && appealFor === null,
    };
  });
}

// ---------------------------------------------------------------------------
// Controller (framework-agnostic state machine)
// ---------------------------------------------------------------------------

type EditorListener = () => void;

/** The minimal platform surface the editor needs — deliberately narrow so
 * every frontend (and the tests) can bind any client that provides it. */
export interface ProfileEditorPlatform {
  modules: {
    directory: {
      managedProfile(personId: number, options?: unknown): Promise<DirectoryManagedProfileResponse>;
      upsertProfile(personId: number, input: DirectoryProfileInput, options?: unknown): Promise<{ profile: Record<string, unknown>; publication?: string; contact_value_stored?: string | null }>;
      submitClaim(input: unknown, options?: unknown): Promise<{ claim: Record<string, unknown>; note: string }>;
      myClaims(options?: unknown): Promise<{ claims: Array<Record<string, unknown>> }>;
    };
  };
}

export interface ProfileEditorDeps {
  platform: ProfileEditorPlatform;
  personId: number;
}

export class ProfileEditorController {
  private state: ProfileEditorState = { phase: "loading" };
  private disposed = false;
  private loadGeneration = 0;
  private readonly listeners = new Set<EditorListener>();
  private deps: ProfileEditorDeps | null = null;

  getState(): ProfileEditorState {
    return this.state;
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private patch(state: ProfileEditorState): void {
    if (this.disposed) return;
    this.state = state;
    this.notify();
  }

  async load(deps: ProfileEditorDeps): Promise<void> {
    if (this.disposed) return;
    this.deps = deps;
    const generation = ++this.loadGeneration;
    this.patch({ phase: "loading" });
    try {
      const view = await deps.platform.modules.directory.managedProfile(deps.personId);
      if (this.disposed || generation !== this.loadGeneration) return;
      const permissions: ProfileEditorPermissions = view.permissions;
      const stored = view.profile.row_version > 0 ? (view.profile as StoredProfile) : null;
      if (stored) {
        this.patch({ phase: "ready", draft: draftFromProfile(stored, permissions), permissions, stored });
      } else {
        this.patch({ phase: "empty", draft: newDraft(), permissions, stored: null });
      }
    } catch (error) {
      if (this.disposed || generation !== this.loadGeneration) return;
      if (isPlatformClientError(error)) {
        if (error.status === 403 || error.status === 404) {
          this.patch({ phase: "denied", reason: error.message });
          return;
        }
        this.patch({ phase: "unavailable", reason: error.message });
        return;
      }
      this.patch({ phase: "unavailable", reason: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Local draft mutation — the draft lives entirely on the client. */
  updateDraft(mutate: (draft: ProfileEditorDraft) => ProfileEditorDraft): void {
    const current = this.state;
    if (current.phase === "empty" || current.phase === "ready" || current.phase === "saving"
      || current.phase === "saved" || current.phase === "conflict") {
      const draft = mutate(current.draft);
      if (current.phase === "conflict") {
        // A local edit while conflicted keeps the conflict context (the
        // representative is reconciling field by field).
        this.patch({ ...current, draft });
        return;
      }
      this.patch({ ...current, draft });
    }
  }

  /** Explicit re-consent after a conflict revealed the withdrawal. */
  reconsentPublication(): void {
    const current = this.state;
    if (current.phase !== "conflict") return;
    const draft = { ...current.draft, publication_consent: true };
    this.patch({ ...current, draft, reconsentRequired: false });
  }

  async submit(): Promise<void> {
    const current = this.state;
    if (this.disposed || this.deps === null) return;
    if (current.phase !== "ready" && current.phase !== "empty" && current.phase !== "saved" && current.phase !== "conflict") return;
    if (current.phase === "conflict" && current.reconsentRequired) return; // blocked until explicit re-consent
    const { platform, personId } = this.deps;
    // A retry from the conflict phase carries the CURRENT fetched version —
    // the stale one is what caused the 409 in the first place.
    const storedForSubmission = current.phase === "empty" ? null
      : current.phase === "conflict" ? current.current
      : current.stored;
    const submission = buildProfileSubmission(
      current.draft,
      storedForSubmission,
      current.permissions,
      "IR-3166-2:2024",
    );
    this.patch({ phase: "saving", draft: current.draft, permissions: current.permissions, stored: current.phase === "empty" ? null : current.stored });
    try {
      const result = await platform.modules.directory.upsertProfile(personId, submission);
      if (this.disposed) return;
      const publication = typeof result.publication === "string"
        ? result.publication
        : current.draft.publication_consent ? "published" : "unpublished (consent not given or withdrawn)";
      // R108-04: edits made while the command was in flight were never part
      // of this submission — retain the LATEST local draft across the
      // authoritative reload instead of clobbering it with the snapshot
      // captured at submit start.
      const latestDraft = this.state.phase === "saving" ? this.state.draft : current.draft;
      // Reload the authoritative view: the stored row_version moved.
      await this.load(this.deps);
      if (this.disposed) return;
      const after = this.state;
      this.patch({ phase: "saved", draft: latestDraft, permissions: current.permissions, stored: after.phase !== "loading" && after.phase !== "denied" && after.phase !== "unavailable" ? after.stored : null, publication });
    } catch (error) {
      if (this.disposed) return;
      if (isPlatformClientError(error) && (error.status === 409 || error.status === 428)) {
        await this.enterConflict(current);
        return;
      }
      // Unknown outcome — never guess; go back through the loader.
      await this.load(this.deps);
    }
  }

  /** 409/428 handling: fetch the CURRENT profile, diff it against the local
   * draft and keep the draft for field-by-field reconciliation. */
  private async enterConflict(prior: Extract<ProfileEditorState, { phase: "ready" | "empty" | "saving" | "saved" | "conflict" }>): Promise<void> {
    if (this.deps === null) return;
    // R108-04: the draft carried into the conflict is the LATEST local one —
    // edits typed while the command was in flight are retained for the
    // field-by-field reconciliation, never silently discarded.
    const draft = this.state.phase === "saving" ? this.state.draft : prior.draft;
    try {
      const view = await this.deps.platform.modules.directory.managedProfile(this.deps.personId);
      if (this.disposed) return;
      const current = view.profile as StoredProfile;
      const permissions = view.permissions;
      this.patch({
        phase: "conflict",
        draft,
        permissions,
        stored: prior.stored,
        current,
        differences: diffProfileDraft(draft, current),
        reconsentRequired: consentWithdrawnElsewhere(draft, current),
      });
    } catch {
      if (this.disposed) return;
      this.patch({ phase: "unavailable", reason: "The profile changed and the current version could not be fetched. Reload to retry." });
    }
  }

  /** Resolve a conflict by taking the server values into the draft (the
   * representative then reviews and resubmits deliberately). */
  takeServerValues(): void {
    const current = this.state;
    if (current.phase !== "conflict") return;
    const draft = draftFromProfile(current.current, current.permissions);
    this.patch({ phase: "ready", draft, permissions: current.permissions, stored: current.current });
  }

  /** Keep the local draft but adopt the server's row_version for the retry. */
  retryWithCurrentVersion(): void {
    const current = this.state;
    if (current.phase !== "conflict" || current.reconsentRequired) return;
    this.patch({ phase: "ready", draft: current.draft, permissions: current.permissions, stored: current.current });
  }

  retry(): void {
    if (this.deps === null || this.disposed) return;
    void this.load(this.deps);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useProfileEditorController(personId: number | null, platform: ProfileEditorPlatform | null, scope?: string): {
  state: ProfileEditorState;
  controller: ProfileEditorController | null;
  updateDraft: (mutate: (draft: ProfileEditorDraft) => ProfileEditorDraft) => void;
  submit: () => void;
  reconsentPublication: () => void;
  takeServerValues: () => void;
  retryWithCurrentVersion: () => void;
  retry: () => void;
} {
  const identity = useMemo(() => ({}), [personId, platform, scope]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const controllerRef = useRef<ProfileEditorController | null>(null);
  const [, force] = useState(0);
  // R107 NEXT-05: the managed-profile view is private. With a principal
  // `scope` the controller itself is scoped — a scope change recreates it
  // and the previous principal's controller/state is masked in render
  // (never handed to the caller) before the replacement mounts.
  const [controller, setController] = useScopedState<ProfileEditorController | null>(`${scope ?? "principal:unscoped"}|resource:${personId ?? "none"}`, null);

  useEffect(() => {
    if (personId === null || platform === null) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setController(null);
      return;
    }
    const instance = new ProfileEditorController();
    controllerRef.current = instance;
    setController(instance);
    const unsubscribe = instance.subscribe(() => force((n) => n + 1));
    void instance.load({ platform, personId });
    return () => {
      unsubscribe();
      instance.dispose();
      controllerRef.current = null;
    };
  }, [personId, platform, scope, setController]);

  const updateDraft = useCallback((mutate: (draft: ProfileEditorDraft) => ProfileEditorDraft) => {
    if (currentIdentity.current === identity) controllerRef.current?.updateDraft(mutate);
  }, [identity]);
  const submit = useCallback(() => { if (currentIdentity.current === identity) void controllerRef.current?.submit(); }, [identity]);
  const reconsentPublication = useCallback(() => { if (currentIdentity.current === identity) controllerRef.current?.reconsentPublication(); }, [identity]);
  const takeServerValues = useCallback(() => { if (currentIdentity.current === identity) controllerRef.current?.takeServerValues(); }, [identity]);
  const retryWithCurrentVersion = useCallback(() => { if (currentIdentity.current === identity) controllerRef.current?.retryWithCurrentVersion(); }, [identity]);
  const retry = useCallback(() => { if (currentIdentity.current === identity) controllerRef.current?.retry(); }, [identity]);

  const state = controller?.getState() ?? ({ phase: "loading" } as ProfileEditorState);
  return { state, controller, updateDraft, submit, reconsentPublication, takeServerValues, retryWithCurrentVersion, retry };
}

/** The claim-flow state machine: submit a claim with evidence, watch status,
 * read rejection reasons, appeal a rejection (bounded — own + rejected only).
 * R108-04: the flow is principal-scoped — a completion from an earlier
 * principal/session (account switch, permission epoch change, or a platform
 * replacement) can never publish its result under the current one, and the
 * visible flow resets to idle when the scope changes. */
export type ClaimFlowState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "submitted"; claim: DirectoryClaimSummary; note: string }
  | { phase: "rejected"; code: string; message: string }
  | { phase: "failed"; message: string };

export function useDirectoryClaimFlow(platform: ProfileEditorPlatform | null, scope?: string): {
  state: ClaimFlowState;
  submitClaim: (input: { claim_type: "person" | "organization"; person_id?: number | null; organization_id?: number | null; evidence_note: string; evidence_media_id?: string | null; appeal_for_claim_id?: number | null }) => void;
  reset: () => void;
} {
  const scopeKey = scope ?? "principal:unscoped";
  const [state, setState] = useScopedState<ClaimFlowState>(scopeKey, { phase: "idle" } as ClaimFlowState);
  const platformRef = useRef(platform); platformRef.current = platform;
  const identity = useMemo(() => ({ busy: false, uncertain: false }), [scopeKey, platform]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const mounted = useRef(false);
  // The completion epoch: every scope/platform change invalidates every
  // in-flight command, and an explicit reset invalidates the pending one.
  const epochRef = useRef(0);
  useEffect(() => {
    mounted.current = true;
    epochRef.current += 1;
    return () => { mounted.current = false; epochRef.current += 1; };
  }, [scopeKey, platform]);
  const submitClaim = useCallback((input: { claim_type: "person" | "organization"; person_id?: number | null; organization_id?: number | null; evidence_note: string; evidence_media_id?: string | null; appeal_for_claim_id?: number | null }) => {
    const current = platformRef.current;
    if (current === null || !mounted.current || currentIdentity.current !== identity || identity.busy || identity.uncertain) return;
    identity.busy = true;
    const epoch = epochRef.current;
    setState({ phase: "submitting" });
    void (async () => current.modules.directory.submitClaim(input))()
      .then((result) => {
        if (epochRef.current !== epoch || currentIdentity.current !== identity) return;
        const candidate = summarizeClaims([result.claim])[0];
        const claim = candidate && Number.isSafeInteger(candidate.id) && candidate.id > 0 ? candidate : null;
        identity.uncertain = !claim;
        setState(claim
          ? { phase: "submitted", claim, note: result.note }
          : { phase: "failed", message: "The claim was filed but its record could not be read back." });
      })
      .catch((error: unknown) => {
        if (epochRef.current !== epoch || currentIdentity.current !== identity) return;
        const classified = classifyCommandError(error);
        if (classified.phase === "rejected") {
          setState({ phase: "rejected", code: classified.code, message: classified.message });
          return;
        }
        identity.uncertain = true;
        setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
      }).finally(() => { identity.busy = false; });
  }, [setState, identity]);
  const reset = useCallback(() => {
    if (!mounted.current || currentIdentity.current !== identity || identity.busy) return;
    epochRef.current += 1; // a reset also retires any still-pending completion
    identity.uncertain = false;
    setState({ phase: "idle" });
  }, [setState, identity]);
  return { state, submitClaim, reset };
}

/** Convenience: my claims with statuses/rejection reasons, loaded through the
 * canonical domain loader so loading/empty/unavailable are distinct states.
 * R107 NEXT-05: pass the caller's principal scope so an account switch
 * re-keys the load and the earlier principal's claims are masked in render. */
export function useMyDirectoryClaims(platform: ProfileEditorPlatform | null, scope?: string): {
  claims: DirectoryClaimSummary[];
  loading: boolean;
  unavailable: string | null;
  retry: () => void;
} {
  const scopeKey = scope ?? "principal:unscoped";
  type ClaimsSnapshot = { claims: DirectoryClaimSummary[]; loading: boolean; unavailable: string | null };
  const [snapshot, setSnapshot] = useScopedState<ClaimsSnapshot>(scopeKey, { claims: [], loading: true, unavailable: null });
  // R108-04: reload GENERATION fencing — only the newest load may commit.
  // A slow earlier myClaims() response (an overlapping retry, or a load
  // superseded by a scope change whose effect already re-ran) can never
  // resurrect the earlier principal's claims or overwrite a newer snapshot.
  const generationRef = useRef(0);
  const loadRef = useRef<() => void>(() => {});
  const load = useCallback(() => {
    if (platform === null) return;
    const generation = ++generationRef.current;
    setSnapshot((prior) => ({ ...prior, loading: true, unavailable: null }));
    platform.modules.directory.myClaims()
      .then((result) => {
        if (generationRef.current !== generation) return;
        setSnapshot({ claims: summarizeClaims(result.claims), loading: false, unavailable: null });
      })
      .catch((error: unknown) => {
        if (generationRef.current !== generation) return;
        setSnapshot({ claims: [], loading: false, unavailable: error instanceof Error ? error.message : String(error) });
      });
  }, [platform, setSnapshot]);
  loadRef.current = load;
  useEffect(() => { loadRef.current(); }, [platform, scopeKey]);
  const retry = useCallback(() => { loadRef.current(); }, []);
  return useMemo(() => ({ ...snapshot, retry }), [snapshot, retry]);
}
