import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPlatformClientError } from "../errors";
import { useScopedState } from "./principalScope";
import type {
  OrganizationManagedResponse,
  OrganizationProfileInput,
  OrganizationProfileRecord,
} from "../../contracts/platform";

/**
 * R98-N07 — the ONE headless organization editor controller shared by every
 * frontend. Renderer-agnostic: the five independent visual frontends bind to
 * this state machine, each with its own components.
 *
 * Pinned behaviors (from the reviewed N07 ticket, mirroring the N06 person
 * editor where the rules are shared):
 *  - The stored row_version populates every update; FIRST CREATION (no stored
 *    profile row) submits WITHOUT expected_version — the server's 428 gate is
 *    the proof, not a client guess.
 *  - An editor without private-contact permission (platform curator, or a
 *    membership that was revoked mid-session) never renders or submits the
 *    private contact fields: absent from the draft AND the submission.
 *  - On 409 profile_conflict the controller fetches the CURRENT profile and
 *    reports FIELD-LEVEL differences; the draft is retained locally.
 *  - Publication consent withdrawn elsewhere is NEVER auto-resubmitted:
 *    resubmission is blocked until a current staff member explicitly
 *    re-consents (reconsentRequired).
 *  - Staff operations (invite, role change, revocation) never self-escalate:
 *    the UI blocks self-targeted role changes and self-revocation outright,
 *    and the server enforces it again for every request.
 */

// ---------------------------------------------------------------------------
// Draft model
// ---------------------------------------------------------------------------

export interface OrganizationEditorPermissions {
  edit: boolean;
  initial_publication: boolean;
  private_contact: boolean;
}

export interface OrganizationEditorDraft {
  description: string;
  service_categories: string[];
  specialties: string[];
  service_areas: string[];
  accessibility_notes: string;
  /** Explicit confirmation that the province was picked under the CURRENT
   * reference dataset — sent as province_code_scheme on every submission. */
  province_code: string;
  province_scheme_confirmed: boolean;
  city: string;
  contact_preference: "platform_message" | "phone" | "email";
  contact_value: string;
  opening_hours: Record<string, string>;
  publication_consent: boolean;
}

export type StoredOrganization = OrganizationProfileRecord;

export type OrganizationEditorState =
  | { phase: "loading" }
  | { phase: "denied"; reason: string }
  | { phase: "unavailable"; reason: string }
  /** No stored profile row yet — current staff (or curator) is creating it. */
  | { phase: "empty"; draft: OrganizationEditorDraft; permissions: OrganizationEditorPermissions; stored: null }
  | { phase: "ready"; draft: OrganizationEditorDraft; permissions: OrganizationEditorPermissions; stored: StoredOrganization }
  | { phase: "saving"; draft: OrganizationEditorDraft; permissions: OrganizationEditorPermissions; stored: StoredOrganization | null }
  | { phase: "saved"; draft: OrganizationEditorDraft; permissions: OrganizationEditorPermissions; stored: StoredOrganization | null; publication: string }
  | {
      phase: "conflict";
      draft: OrganizationEditorDraft;
      permissions: OrganizationEditorPermissions;
      stored: StoredOrganization | null;
      current: StoredOrganization;
      differences: OrganizationFieldDifference[];
      /** True when the draft still wants publication but consent was
       * withdrawn on the server — resubmission requires explicit re-consent. */
      reconsentRequired: boolean;
    };

export interface OrganizationFieldDifference {
  field: keyof OrganizationEditorDraft;
  local: string;
  server: string;
}

/** A first-creation draft: no stored row, publication only with consent. */
export function newOrganizationDraft(): OrganizationEditorDraft {
  return {
    description: "",
    service_categories: [],
    specialties: [],
    service_areas: [],
    accessibility_notes: "",
    province_code: "",
    province_scheme_confirmed: false,
    city: "",
    contact_preference: "platform_message",
    contact_value: "",
    opening_hours: {},
    publication_consent: false,
  };
}

/** Build a draft from the loaded profile. Private contact fields enter the
 * draft ONLY when the viewer holds private-contact permission. */
export function draftFromOrganization(
  organization: StoredOrganization,
  permissions: OrganizationEditorPermissions,
): OrganizationEditorDraft {
  return {
    description: organization.description ?? "",
    service_categories: [...organization.service_categories],
    specialties: [...organization.specialties],
    service_areas: [...organization.service_areas],
    accessibility_notes: organization.accessibility_notes ?? "",
    province_code: organization.province_code ?? "",
    province_scheme_confirmed: organization.province_needs_review !== true,
    city: organization.city ?? "",
    contact_preference: organization.contact_preference ?? "platform_message",
    contact_value: permissions.private_contact ? organization.contact_value ?? "" : "",
    opening_hours: organization.opening_hours ? { ...organization.opening_hours } : {},
    publication_consent: organization.publication_consent === true,
  };
}

// ---------------------------------------------------------------------------
// Submission building (pure — the acceptance core)
// ---------------------------------------------------------------------------

export interface OrganizationSubmission extends OrganizationProfileInput {}

/**
 * Build the profile submission from a draft.
 *
 *  - expected_version is populated from the ACTUAL stored row_version, and
 *    only when a stored row exists (first creation submits without it).
 *  - province_code_scheme is sent explicitly whenever a province is set.
 *  - Private contact fields are stripped entirely without permission.
 *  - opening_hours is serialized from the structured draft (the server
 *    validates the same shape; the client never sends free text).
 */
export function buildOrganizationSubmission(
  draft: OrganizationEditorDraft,
  stored: StoredOrganization | null,
  permissions: OrganizationEditorPermissions,
  currentScheme: string,
): OrganizationSubmission {
  const submission: OrganizationSubmission = {
    description: draft.description || null,
    service_categories: [...draft.service_categories],
    specialties: [...draft.specialties],
    service_areas: [...draft.service_areas],
    accessibility_notes: draft.accessibility_notes || null,
    province_code: draft.province_code || null,
    city: draft.city || null,
    contact_preference: draft.contact_preference,
    publication_consent: draft.publication_consent,
  };
  if (Object.keys(draft.opening_hours).length > 0) {
    submission.opening_hours = JSON.stringify(draft.opening_hours);
  }
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
 * state — surfaced on conflict so staff reconciles field by field. */
export function diffOrganizationDraft(draft: OrganizationEditorDraft, current: StoredOrganization): OrganizationFieldDifference[] {
  const differences: OrganizationFieldDifference[] = [];
  const push = (field: keyof OrganizationEditorDraft, local: string, server: string) => {
    if (local !== server) differences.push({ field, local, server });
  };
  push("description", draft.description, current.description ?? "");
  push("service_categories", [...draft.service_categories].sort().join(","), [...current.service_categories].sort().join(","));
  push("specialties", [...draft.specialties].sort().join(","), [...current.specialties].sort().join(","));
  push("service_areas", [...draft.service_areas].sort().join(","), [...current.service_areas].sort().join(","));
  push("accessibility_notes", draft.accessibility_notes, current.accessibility_notes ?? "");
  push("province_code", draft.province_code, current.province_code ?? "");
  push("city", draft.city, current.city ?? "");
  push("contact_preference", draft.contact_preference, current.contact_preference ?? "platform_message");
  push("opening_hours", JSON.stringify(draft.opening_hours), current.opening_hours ? JSON.stringify(current.opening_hours) : "{}");
  push("publication_consent", draft.publication_consent ? "consented" : "withdrawn", current.publication_consent ? "consented" : "withdrawn");
  return differences;
}

/** True when the draft wants publication but the current server state has
 * consent withdrawn — the choice must never be auto-resubmitted. */
export function orgConsentWithdrawnElsewhere(draft: OrganizationEditorDraft, current: StoredOrganization): boolean {
  return draft.publication_consent === true && current.publication_consent === false;
}

// ---------------------------------------------------------------------------
// The onboarding explainer (shared copy, rendered by each frontend's visuals)
// ---------------------------------------------------------------------------

export interface OrganizationOnboardingEntry {
  concept: "account" | "person" | "organization" | "official_role";
  en: string;
  fa: string;
}

export const ORGANIZATION_ONBOARDING_EXPLAINER: readonly OrganizationOnboardingEntry[] = [
  {
    concept: "account",
    en: "A login account identifies who is signed in. It can hold memberships in many organizations, but it is never itself the organization.",
    fa: "حساب کاربری فقط مشخص می‌کند چه کسی وارد شده است. یک حساب می‌تواند عضو چند سازمان باشد، اما خودِ حساب هرگز سازمان نیست.",
  },
  {
    concept: "person",
    en: "A person is a human record in the registry (an owner, a professional). A person can serve several organizations without merging them.",
    fa: "«شخص» یک رکورد انسانی در ثبت‌نامه است (مالک یا متخصص). یک شخص می‌تواند در چند سازمان خدمت کند بدون اینکه سازمان‌ها در هم آمیزند.",
  },
  {
    concept: "organization",
    en: "An organization is a separate legal entity (farm, club, clinic, shop, transport). Authority over it belongs to CURRENT staff memberships only — a former employee retains nothing, not even read access to new leads.",
    fa: "سازمان یک شخصیت حقوقی مستقل است (مزرعه، باشگاه، درمانگاه، فروشگاه، حمل‌ونقل). اختیار روی سازمان فقط با عضویت جاری کارکنان است — کارمند سابق هیچ دسترسی‌ای ندارد، حتی خواندن سرنخ‌های جدید.",
  },
  {
    concept: "official_role",
    en: "Judge, steward, ringmaster and disciplinary committee are distinct officiating roles held by PERSONS through current credentials — they are never organization staff roles and never granted by a membership.",
    fa: "داور، سرپاست، رینگ‌مستر و کمیته انضباطی نقش‌های داوری مستقلی هستند که اشخاص با مدرک معتبرِ جاری می‌گیرند — این‌ها نقش کارمندان سازمان نیستند و با عضویت داده نمی‌شوند.",
  },
];

// ---------------------------------------------------------------------------
// Staff roster normalization (server rows are Record<string, unknown>)
// ---------------------------------------------------------------------------

export interface StaffRosterEntry {
  kind: "membership" | "invite";
  user_id?: string;
  email?: string;
  role?: string;
  status: string;
  is_current: boolean;
  revoked_at?: string | null;
  valid_until?: string | null;
  expires_at?: string | null;
  id?: number;
}

export function normalizeStaffRoster(rows: ReadonlyArray<Record<string, unknown>>): StaffRosterEntry[] {
  return rows.map((row) => ({
    kind: row.kind === "invite" ? "invite" : "membership",
    user_id: typeof row.user_id === "string" ? row.user_id : undefined,
    email: typeof row.email === "string" ? row.email : undefined,
    role: typeof row.role === "string" ? row.role : (typeof row.proposed_role === "string" ? row.proposed_role : undefined),
    status: typeof row.status === "string" ? row.status : "unknown",
    is_current: row.is_current === 1 || row.is_current === true,
    revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
    valid_until: typeof row.valid_until === "string" ? row.valid_until : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    id: typeof row.id === "number" ? row.id : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Controller (framework-agnostic state machine)
// ---------------------------------------------------------------------------

type EditorListener = () => void;

/** The minimal platform surface the organization editor needs. */
export interface OrganizationEditorPlatform {
  modules: {
    organizations: {
      managed(organizationId: number, options?: unknown): Promise<OrganizationManagedResponse>;
      upsertProfile(organizationId: number, input: OrganizationProfileInput, options?: unknown): Promise<{ organization: Record<string, unknown>; publication?: string; contact_value_stored?: string | null }>;
    };
  };
}

export interface OrganizationEditorDeps {
  platform: OrganizationEditorPlatform;
  organizationId: number;
}

export class OrganizationEditorController {
  private state: OrganizationEditorState = { phase: "loading" };
  private disposed = false;
  private loadGeneration = 0;
  /** The server-declared current province scheme (from every managed view —
   * never hardcoded on the client). */
  private scheme = "iso3166-2-ir:2020-11-24";
  private readonly listeners = new Set<EditorListener>();
  private deps: OrganizationEditorDeps | null = null;

  getState(): OrganizationEditorState {
    return this.state;
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private patch(state: OrganizationEditorState): void {
    if (this.disposed) return;
    this.state = state;
    this.notify();
  }

  async load(deps: OrganizationEditorDeps): Promise<void> {
    if (this.disposed) return;
    this.deps = deps;
    const generation = ++this.loadGeneration;
    this.patch({ phase: "loading" });
    try {
      const view = await deps.platform.modules.organizations.managed(deps.organizationId);
      if (this.disposed || generation !== this.loadGeneration) return;
      this.scheme = view.current_province_scheme ?? this.scheme;
      const permissions: OrganizationEditorPermissions = view.permissions;
      const stored = view.organization.row_version > 0 ? view.organization : null;
      if (stored) {
        this.patch({ phase: "ready", draft: draftFromOrganization(stored, permissions), permissions, stored });
      } else {
        this.patch({ phase: "empty", draft: newOrganizationDraft(), permissions, stored: null });
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
  updateDraft(mutate: (draft: OrganizationEditorDraft) => OrganizationEditorDraft): void {
    const current = this.state;
    if (current.phase === "empty" || current.phase === "ready" || current.phase === "saving"
      || current.phase === "saved" || current.phase === "conflict") {
      const draft = mutate(current.draft);
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
    const { platform, organizationId } = this.deps;
    // A retry from the conflict phase carries the CURRENT fetched version —
    // the stale one is what caused the 409 in the first place.
    const storedForSubmission = current.phase === "empty" ? null
      : current.phase === "conflict" ? current.current
      : current.stored;
    const submission = buildOrganizationSubmission(current.draft, storedForSubmission, current.permissions, this.scheme);
    this.patch({ phase: "saving", draft: current.draft, permissions: current.permissions, stored: current.phase === "empty" ? null : current.stored });
    try {
      const result = await platform.modules.organizations.upsertProfile(organizationId, submission);
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
  private async enterConflict(prior: Extract<OrganizationEditorState, { phase: "ready" | "empty" | "saving" | "saved" | "conflict" }>): Promise<void> {
    if (this.deps === null) return;
    // R108-04: the draft carried into the conflict is the LATEST local one —
    // edits typed while the command was in flight are retained for the
    // field-by-field reconciliation, never silently discarded.
    const draft = this.state.phase === "saving" ? this.state.draft : prior.draft;
    try {
      const view = await this.deps.platform.modules.organizations.managed(this.deps.organizationId);
      if (this.disposed) return;
      if (view.organization.row_version <= 0) {
        this.patch({ phase: "unavailable", reason: "The organization profile changed and the current version could not be fetched. Reload to retry." });
        return;
      }
      const current = view.organization;
      this.scheme = view.current_province_scheme ?? this.scheme;
      this.patch({
        phase: "conflict",
        draft,
        permissions: view.permissions,
        stored: prior.stored,
        current,
        differences: diffOrganizationDraft(draft, current),
        reconsentRequired: orgConsentWithdrawnElsewhere(draft, current),
      });
    } catch {
      if (this.disposed) return;
      this.patch({ phase: "unavailable", reason: "The organization profile changed and the current version could not be fetched. Reload to retry." });
    }
  }

  /** Resolve a conflict by taking the server values into the draft (staff
   * then reviews and resubmits deliberately). */
  takeServerValues(): void {
    const current = this.state;
    if (current.phase !== "conflict") return;
    const draft = draftFromOrganization(current.current, current.permissions);
    this.patch({ phase: "ready", draft, permissions: current.permissions, stored: current.current });
  }

  /** Keep the local draft but adopt the server's row_version for the retry. */
  retryWithCurrentVersion(): void {
    const current = this.state;
    if (current.phase !== "conflict" || current.reconsentRequired) return;
    this.patch({ phase: "ready", draft: current.draft, permissions: current.permissions, stored: current.current });
  }

  /** Adopt the server's current field values into the local draft (staff
   * chooses per conflict); publication consent is NEVER adopted. */
  adoptServerValues(fields: ReadonlyArray<keyof OrganizationEditorDraft>): void {
    const current = this.state;
    if (current.phase !== "conflict") return;
    const draft = { ...current.draft };
    const server = current.current;
    for (const field of fields) {
      switch (field) {
        case "description": draft.description = server.description ?? ""; break;
        case "service_categories": draft.service_categories = [...server.service_categories]; break;
        case "specialties": draft.specialties = [...server.specialties]; break;
        case "service_areas": draft.service_areas = [...server.service_areas]; break;
        case "accessibility_notes": draft.accessibility_notes = server.accessibility_notes ?? ""; break;
        case "province_code": draft.province_code = server.province_code ?? ""; draft.province_scheme_confirmed = true; break;
        case "city": draft.city = server.city ?? ""; break;
        case "contact_preference": draft.contact_preference = server.contact_preference ?? "platform_message"; break;
        case "opening_hours": draft.opening_hours = server.opening_hours ? { ...server.opening_hours } : {}; break;
        case "publication_consent": break; // never adopted — consent is explicit or absent
        default: break;
      }
    }
    this.patch({ ...current, draft });
  }

  async reload(): Promise<void> {
    if (this.deps) await this.load(this.deps);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// React bindings (the five frontends share these; visuals stay independent)
// ---------------------------------------------------------------------------

export function useOrganizationEditorController(organizationId: number | null, platform: OrganizationEditorPlatform | null, scope?: string): {
  state: OrganizationEditorState;
  controller: OrganizationEditorController | null;
  updateDraft: (mutate: (draft: OrganizationEditorDraft) => OrganizationEditorDraft) => void;
  submit: () => void;
  reconsentPublication: () => void;
  adoptServerValues: (fields: ReadonlyArray<keyof OrganizationEditorDraft>) => void;
  adoptAllServerValues: () => void;
  retryWithCurrentVersion: () => void;
  retry: () => void;
} {
  const identity = useMemo(() => ({}), [organizationId, platform, scope]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const controllerRef = useRef<OrganizationEditorController | null>(null);
  const [, force] = useState(0);
  // R107 NEXT-05: the managed-organization view is private. With a principal
  // `scope` the controller itself is scoped — a scope change recreates it and
  // the previous principal's controller/state is masked in render first.
  const [controller, setController] = useScopedState<OrganizationEditorController | null>(`${scope ?? "principal:unscoped"}|resource:${organizationId ?? "none"}`, null);

  useEffect(() => {
    if (organizationId === null || platform === null) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setController(null);
      return;
    }
    const instance = new OrganizationEditorController();
    controllerRef.current = instance;
    setController(instance);
    const unsubscribe = instance.subscribe(() => force((n) => n + 1));
    void instance.load({ platform, organizationId });
    return () => {
      unsubscribe();
      instance.dispose();
      controllerRef.current = null;
    };
  }, [organizationId, platform, scope, setController]);

  const updateDraft = useCallback((mutate: (draft: OrganizationEditorDraft) => OrganizationEditorDraft) => {
    if (currentIdentity.current === identity) controllerRef.current?.updateDraft(mutate);
  }, [identity]);
  const submit = useCallback(() => { if (currentIdentity.current === identity) void controllerRef.current?.submit(); }, [identity]);
  const reconsentPublication = useCallback(() => { if (currentIdentity.current === identity) controllerRef.current?.reconsentPublication(); }, [identity]);
  const adoptServerValues = useCallback((fields: ReadonlyArray<keyof OrganizationEditorDraft>) => {
    if (currentIdentity.current === identity) controllerRef.current?.adoptServerValues(fields);
  }, [identity]);
  const adoptAllServerValues = useCallback(() => {
    if (currentIdentity.current === identity) controllerRef.current?.takeServerValues();
  }, [identity]);
  /** Retry the SAME draft against the CURRENT server version — the version is
   * re-read, never guessed; a withdrawn consent still requires re-consent. */
  const retryWithCurrentVersion = useCallback(() => {
    if (currentIdentity.current === identity) controllerRef.current?.retryWithCurrentVersion();
  }, [identity]);
  const retry = useCallback(() => { if (currentIdentity.current === identity) void controllerRef.current?.reload(); }, [identity]);

  const state = controller?.getState() ?? ({ phase: "loading" } as OrganizationEditorState);
  return { state, controller, updateDraft, submit, reconsentPublication, adoptServerValues, adoptAllServerValues, retryWithCurrentVersion, retry };
}
