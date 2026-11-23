import { useCallback } from "react";
import { useDomainResource } from "./useDomainResource";
import { usePlatformCommand } from "./commandStatus";
import { isPlatformClientError } from "../errors";
import type {
  PlatformRequestOptions,
  WorkspaceSummary,
  WorkspaceTaskRecord,
  WorkspaceTaskInput,
  WorkspaceTaskResponse,
  WorkspaceTasksResponse,
  WorkspaceTaskCompleteResponse,
  WorkspaceTaskReopenResponse,
  WorkspaceTaskReassignResponse,
  WorkspacesMineResponse,
  WorkspaceDashboardResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceHorseMutationResponse,
  WorkspaceStaffInput,
  WorkspaceStaffResponse,
  WorkspaceInviteInput,
  WorkspaceInviteResponse,
  WorkspaceInviteRecord,
  WorkspaceInviteRespondResponse,
  WorkspaceInvitesResponse,
  WorkspaceDocumentInput,
  WorkspaceDocumentUpdateInput,
  WorkspaceDocumentsResponse,
  WorkspaceTaskImportRow,
  WorkspaceTaskImportResponse,
} from "../../contracts/platform";

/**
 * R114-05 (Master AI R113 handoff D22/D32–35) — the shared headless WORKSPACE
 * desk surface. The backend (P14/R98-N05/R108-08/R108-13) already enforces
 * every rule live; this module gives the five independent renderers ONE
 * honest state machine over it:
 *
 *  - A workspace is a WORKING SET, never an ownership claim. The reminder and
 *    herd copy never lets a working-set membership read as ownership.
 *  - Every read is scoped by principal AND workspace: a late response from a
 *    retired workspace or a previous principal can never paint the selected
 *    view, and a 403 answer (staff access revoked mid-session) renders as an
 *    explicit forbidden state that masks every private row.
 *  - Task completion and assignment are CAS-guarded (expected_version): a
 *    409 stale_version keeps the intent visible with the honest reload story,
 *    never a blind resubmit; already_closed is a distinct honest answer.
 *  - Staff delegation is consent-first: an owner invites, the invitee decides
 *    (accept/decline), invitations expire honestly (410) and a revoked or
 *    already-answered invitation refuses with its real cause (409).
 *  - The invitee's own inbox works WITHOUT selecting any workspace, and is
 *    principal-scoped like every other private list.
 */

// ---------------------------------------------------------------------------
// The minimal platform surface the workspace desk needs (typed exactly as in
// contracts/platform.ts — never widened, never guessed).
// ---------------------------------------------------------------------------

export interface WorkspaceDeskPlatform {
  modules: {
    workspaces: {
      mine(options?: PlatformRequestOptions): Promise<WorkspacesMineResponse>;
      create(input: WorkspaceCreateInput, options?: PlatformRequestOptions): Promise<WorkspaceCreateResponse>;
      dashboard(id: number, options?: PlatformRequestOptions): Promise<WorkspaceDashboardResponse>;
      addHorse(id: number, horseId: number, options?: PlatformRequestOptions): Promise<WorkspaceHorseMutationResponse>;
      removeHorse(id: number, horseId: number, options?: PlatformRequestOptions): Promise<WorkspaceHorseMutationResponse>;
      addTask(id: number, input: WorkspaceTaskInput, options?: PlatformRequestOptions): Promise<WorkspaceTaskResponse>;
      tasks(id: number, params?: { status?: "open" | "done" | "all" }, options?: PlatformRequestOptions): Promise<WorkspaceTasksResponse>;
      completeTask(id: number, taskId: number, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<WorkspaceTaskCompleteResponse>;
      reopenTask(id: number, taskId: number, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<WorkspaceTaskReopenResponse>;
      reassignTask(id: number, taskId: number, userId: string | null, options?: PlatformRequestOptions & { expectedVersion: number }): Promise<WorkspaceTaskReassignResponse>;
      inviteStaff(id: number, input: WorkspaceInviteInput, options?: PlatformRequestOptions): Promise<WorkspaceInviteResponse>;
      myInvites(options?: PlatformRequestOptions): Promise<WorkspaceInvitesResponse>;
      respondInvite(id: number, action: "accept" | "decline", options?: PlatformRequestOptions): Promise<WorkspaceInviteRespondResponse>;
      assignStaff(id: number, input: WorkspaceStaffInput, options?: PlatformRequestOptions): Promise<WorkspaceStaffResponse>;
      revokeStaff(id: number, userId: string, options?: PlatformRequestOptions): Promise<{ revoked: true; user_id: string; note: string }>;
      documents(id: number, params?: { includeArchived?: boolean }, options?: PlatformRequestOptions): Promise<WorkspaceDocumentsResponse>;
      createDocument(id: number, input: WorkspaceDocumentInput, options?: PlatformRequestOptions): Promise<{ created: true; note: string }>;
      updateDocument(id: number, documentId: number, input: WorkspaceDocumentUpdateInput, options: PlatformRequestOptions & { expectedVersion: number }): Promise<{ updated: true }>;
      archiveDocument(id: number, documentId: number, options?: PlatformRequestOptions): Promise<{ archived: true; note: string }>;
      importTasks(id: number, tasks: WorkspaceTaskImportRow[], options?: PlatformRequestOptions & { intentKey?: string }): Promise<WorkspaceTaskImportResponse>;
      exportUrl(id: number): string;
    };
  };
}

// ---------------------------------------------------------------------------
// Normalization (server rows are already typed; helpers keep renderers honest)
// ---------------------------------------------------------------------------

export interface WorkspacesMineLists {
  owned: WorkspaceSummary[];
  staff: WorkspaceSummary[];
  organization: WorkspaceSummary[];
}

export function normalizeWorkspacesMine(data: WorkspacesMineResponse | null | undefined): WorkspacesMineLists {
  return {
    owned: Array.isArray(data?.owned) ? [...data.owned] : [],
    staff: Array.isArray(data?.staff) ? [...data.staff] : [],
    organization: Array.isArray(data?.organization) ? [...data.organization] : [],
  };
}

export interface WorkspaceTaskBuckets {
  overdue: WorkspaceTaskRecord[];
  dueSoon: WorkspaceTaskRecord[];
  later: WorkspaceTaskRecord[];
  invalid: WorkspaceTaskRecord[];
  all: WorkspaceTaskRecord[];
  open: WorkspaceTaskRecord[];
  byId: Map<number, WorkspaceTaskRecord>;
}

/** Normalize the dashboard task buckets into one honest view. Every open
 * reminder appears exactly once (all = overdue + due_soon + later); rows the
 * server flagged invalid stay visible as needing review, never hidden. */
export function normalizeWorkspaceTasks(tasks: WorkspaceDashboardResponse["tasks"] | null | undefined): WorkspaceTaskBuckets {
  const overdue = Array.isArray(tasks?.overdue) ? [...tasks!.overdue] : [];
  const dueSoon = Array.isArray(tasks?.due_soon) ? [...tasks!.due_soon] : [];
  const later = Array.isArray(tasks?.later) ? [...tasks!.later] : [];
  const invalid = Array.isArray(tasks?.invalid) ? [...tasks!.invalid] : [];
  const all = [...overdue, ...dueSoon, ...later];
  return {
    overdue, dueSoon, later, invalid, all,
    open: all.filter((task) => task.status === "open"),
    byId: new Map(all.map((task) => [task.id, task])),
  };
}

export interface WorkspacePermissionView {
  /** tasks_manage — may add/complete/assign reminders. */
  mayTask: boolean;
  /** manage — may add/remove herd horses and manage staff. */
  mayManage: boolean;
  /** The plan is read-only: information and permitted exports remain. */
  readOnly: boolean;
}

/** Granted actions are the server's live truth (re-checked on every request);
 * the renderer only decides VISIBILITY from them, never authority. */
export function workspacePermissions(workspace: WorkspaceSummary | null | undefined): WorkspacePermissionView {
  const actions = Array.isArray(workspace?.granted_actions) ? workspace!.granted_actions! : [];
  return {
    mayTask: actions.includes("tasks_manage"),
    mayManage: actions.includes("manage"),
    readOnly: workspace?.writable === false,
  };
}

// ---------------------------------------------------------------------------
// Honest invitation + task-command classification
// ---------------------------------------------------------------------------

export type WorkspaceAnswerFailure =
  | { kind: "expired"; message: string }
  | { kind: "already_answered"; message: string }
  | { kind: "not_acceptable"; message: string }
  | { kind: "gone"; message: string }
  | { kind: "unknown"; message: string };

/** Map a workspace respondInvite refusal to its honest cause. The server
 * codes are distinct on purpose (410 expired / 409 already_responded / 409
 * invite_not_acceptable / 404 not_found); an unknown outcome stays unknown. */
export function classifyWorkspaceAnswerFailure(error: unknown): WorkspaceAnswerFailure {
  if (isPlatformClientError(error)) {
    if (error.status === 410) return { kind: "expired", message: error.message };
    if (error.status === 404) return { kind: "gone", message: error.message };
    if (error.status === 409) {
      if (error.code === "invite_not_acceptable") return { kind: "not_acceptable", message: error.message };
      return { kind: "already_answered", message: error.message };
    }
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

export interface MyWorkspaceInvitation {
  collection_id: number;
  workspace_name: string;
  proposed_actions: string;
  note: string | null;
  expires_at: string;
  created_at: string;
  /** Pending AND unexpired — the only rows worth showing an answer button for. */
  actionable: boolean;
}

export function normalizeMyWorkspaceInvites(rows: ReadonlyArray<WorkspaceInviteRecord>): MyWorkspaceInvitation[] {
  const now = Date.now();
  return rows.map((row) => {
    const expiresAt = row.expires_at ?? "";
    const expired = expiresAt !== "" && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) < now;
    return {
      collection_id: row.collection_id,
      workspace_name: row.workspace_name ?? "",
      proposed_actions: row.proposed_actions ?? "",
      note: row.note ?? null,
      expires_at: expiresAt,
      created_at: row.created_at ?? "",
      actionable: !expired,
    };
  });
}

// ---------------------------------------------------------------------------
// React bindings shared by all five renderers
// ---------------------------------------------------------------------------

export type WorkspacesMineSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; lists: WorkspacesMineLists }
  | { phase: "reloading"; lists: WorkspacesMineLists }
  | { phase: "empty" }
  | { phase: "forbidden"; reason: string }
  | { phase: "unavailable"; reason: string }
  | { phase: "error"; reason: string };

/** The signed-in principal's own workspace lists (owned / staff-of /
 * organization). Principal-scoped: an account change re-keys the resource so
 * one principal's lists can never paint under another. */
export function useMyWorkspaces(options: {
  platform: WorkspaceDeskPlatform | null;
  scope?: string;
  userId?: string | null;
  enabled?: boolean;
}): { mine: WorkspacesMineSnapshot; retry: () => void } {
  const { platform, scope, userId, enabled = true } = options;
  const identity = `${scope ?? "principal:unscoped"}|workspaces-mine|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ owned: [], staff: [] } as WorkspacesMineResponse);
    return platform.modules.workspaces.mine();
  }, [platform]);
  const state = useDomainResource<WorkspacesMineResponse>(
    "workspaces-mine", identity, load,
    { isEmpty: (data) => (data.owned?.length ?? 0) === 0 && (data.staff?.length ?? 0) === 0 && (data.organization?.length ?? 0) === 0, enabled: enabled && platform !== null && userId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { mine: { phase: state.state.phase, lists: normalizeWorkspacesMine(state.state.data) }, retry: state.retry };
  if (state.state.phase === "empty") return { mine: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { mine: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { mine: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

export interface WorkspaceDashboardLoaded {
  data: WorkspaceDashboardResponse;
  tasks: WorkspaceTaskBuckets;
  permissions: WorkspacePermissionView;
}
export type WorkspaceDashboardSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | ({ phase: "ready" } & WorkspaceDashboardLoaded)
  | ({ phase: "reloading" } & WorkspaceDashboardLoaded)
  | { phase: "empty"; reason?: string }
  | { phase: "forbidden"; reason: string }
  | { phase: "unavailable"; reason: string }
  | { phase: "error"; reason: string };

/** ONE workspace's private dashboard. The resource identity combines the
 * workspace id, the principal scope and the viewer's user id, so switching
 * workspace (or principal) mid-flight re-keys and the previous workspace's
 * rows can never paint under the new selection. A 403 (staff access revoked
 * mid-session) renders as forbidden with NO private row. */
export function useWorkspaceDashboard(options: {
  workspaceId: number | null;
  platform: WorkspaceDeskPlatform | null;
  scope?: string;
  userId?: string | null;
}): { dashboard: WorkspaceDashboardSnapshot; retry: () => void } {
  const { workspaceId, platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|workspace-dashboard:${workspaceId ?? "none"}|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null || workspaceId === null) return Promise.resolve(null as unknown as WorkspaceDashboardResponse);
    return platform.modules.workspaces.dashboard(workspaceId);
  }, [platform, workspaceId]);
  const state = useDomainResource<WorkspaceDashboardResponse>(
    "workspace-dashboard", identity, load,
    { isEmpty: () => false, enabled: platform !== null && workspaceId !== null });
  if (state.state.phase === "ready" || state.state.phase === "reloading") {
    const data = state.state.data;
    const loaded: WorkspaceDashboardLoaded = {
      data,
      tasks: normalizeWorkspaceTasks(data?.tasks),
      permissions: workspacePermissions(data?.workspace),
    };
    return { dashboard: { phase: state.state.phase, ...loaded }, retry: state.retry };
  }
  if (state.state.phase === "empty") return { dashboard: { phase: "empty", reason: "The workspace was not found." }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { dashboard: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { dashboard: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** The invitee's own cross-workspace inbox: pending invitations answerable
 * WITHOUT selecting any workspace. Principal-scoped the same way. */
export function useMyWorkspaceInvitations(options: {
  platform: WorkspaceDeskPlatform | null;
  scope?: string;
  userId?: string | null;
  enabled?: boolean;
}): { invitations: MyWorkspaceInvitation[]; phase: "idle" | "loading" | "ready" | "forbidden" | "unavailable" | "error"; reason?: string; retry: () => void } {
  const { platform, scope, userId, enabled = true } = options;
  const identity = `${scope ?? "principal:unscoped"}|workspace-invites-mine|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ rows: [] as WorkspaceInviteRecord[], note: "" });
    return platform.modules.workspaces.myInvites();
  }, [platform]);
  const state = useDomainResource<WorkspaceInvitesResponse>(
    "workspace-invites-mine", identity, load,
    { isEmpty: (data) => (data.rows?.length ?? 0) === 0, enabled: enabled && platform !== null && userId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { invitations: normalizeMyWorkspaceInvites(state.state.data.rows ?? []), phase: "ready", retry: state.retry };
  if (state.state.phase === "empty") return { invitations: [], phase: "ready", retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { invitations: [], phase: state.state.phase, reason: state.state.reason, retry: state.retry };
  return { invitations: [], phase: state.state.phase === "idle" ? "idle" : "loading", retry: state.retry };
}

/** Scoped command slots for the workspace actions; the renderer decides which
 * to surface. Scope changes mask feedback and reject stale handlers — they
 * never cancel or retry an already submitted write. */
export function useWorkspaceDeskCommands(scope: string | undefined) {
  const prefix = scope ?? "principal:unscoped";
  const create = usePlatformCommand(`${prefix}|workspace-create`);
  const addTask = usePlatformCommand(`${prefix}|workspace-add-task`);
  const completeTask = usePlatformCommand(`${prefix}|workspace-complete-task`);
  const reopenTask = usePlatformCommand(`${prefix}|workspace-reopen-task`);
  const reassignTask = usePlatformCommand(`${prefix}|workspace-reassign-task`);
  const addHorse = usePlatformCommand(`${prefix}|workspace-add-horse`);
  const removeHorse = usePlatformCommand(`${prefix}|workspace-remove-horse`);
  const invite = usePlatformCommand(`${prefix}|workspace-invite`);
  const respond = usePlatformCommand(`${prefix}|workspace-respond`);
  const assignStaff = usePlatformCommand(`${prefix}|workspace-assign-staff`);
  const revokeStaff = usePlatformCommand(`${prefix}|workspace-revoke-staff`);
  return { create, addTask, completeTask, reopenTask, reassignTask, addHorse, removeHorse, invite, respond, assignStaff, revokeStaff };
}

/** R117-14: the COMPLETED-reminders list (status=done) for the reopen
 * surface. Principal+workspace scoped like every private list: a late
 * response from a retired workspace or a previous principal can never paint
 * the selected view, and a 403 (staff access revoked mid-session) renders as
 * an explicit forbidden state that masks every private row. */
export function useWorkspaceDoneTasks(options: {
  workspaceId: number | null;
  platform: WorkspaceDeskPlatform | null;
  scope?: string;
  userId?: string | null;
}): { done: { phase: "idle" | "loading" | "ready" | "reloading" | "empty" | "forbidden" | "unavailable" | "error"; rows?: WorkspaceTaskRecord[]; reason?: string }; retry: () => void } {
  const { workspaceId, platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|workspace-tasks-done:${workspaceId ?? "none"}|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null || workspaceId === null) return Promise.resolve({ tasks: [] as WorkspaceTaskRecord[] } as WorkspaceTasksResponse);
    return platform.modules.workspaces.tasks(workspaceId, { status: "done" });
  }, [platform, workspaceId]);
  const state = useDomainResource<WorkspaceTasksResponse>(
    "workspace-tasks-done", identity, load,
    { isEmpty: (data) => (data.tasks?.length ?? 0) === 0, enabled: platform !== null && workspaceId !== null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { done: { phase: state.state.phase, rows: state.state.data.tasks ?? [] }, retry: state.retry };
  if (state.state.phase === "empty") return { done: { phase: "empty", rows: [] }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { done: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { done: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

// ---------------------------------------------------------------------------
// R114-06 (Master AI R113 handoff D23/D32–35) — the DOCUMENT tracker surface
// and the bounded no-overwrite task import over the same honest discipline.
// ---------------------------------------------------------------------------

export type DocumentCommandFailure =
  | { kind: "version_conflict"; message: string; currentVersion?: number }
  | { kind: "horse_immutable"; message: string }
  | { kind: "archived"; message: string }
  | { kind: "unknown"; message: string };

/** Map a document command refusal to its honest cause. The server codes are
 * distinct on purpose: document_version_conflict carries the CURRENT version
 * for comparison; document_horse_immutable is the R108-08 fixed-association
 * rule (a mismatched horse_id is refused, never silently ignored);
 * document_archived means read-only history. */
export function classifyDocumentCommandFailure(error: unknown): DocumentCommandFailure {
  if (isPlatformClientError(error)) {
    if (error.status === 409) {
      if (error.code === "document_horse_immutable") return { kind: "horse_immutable", message: error.message };
      if (error.code === "document_archived") return { kind: "archived", message: error.message };
      if (error.code === "document_version_conflict") {
        const details = error.details as { current_version?: number } | undefined;
        const currentVersion = typeof details?.current_version === "number" ? details.current_version : undefined;
        return { kind: "version_conflict", message: error.message, currentVersion };
      }
    }
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

export type WorkspaceDocumentsSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; rows: WorkspaceDocumentsResponse["rows"]; veterinaryNotice: string }
  | { phase: "empty" }
  | { phase: "forbidden"; reason: string }
  | { phase: "unavailable" | "error"; reason: string };

/** ONE workspace's document trackers. Principal+workspace+view scoped: the
 * identity includes the includeArchived toggle so switching views re-keys,
 * and a membership revoked mid-session renders forbidden with NO private row. */
export function useWorkspaceDocuments(options: {
  workspaceId: number | null;
  includeArchived: boolean;
  platform: WorkspaceDeskPlatform | null;
  scope?: string;
  userId?: string | null;
}): { documents: WorkspaceDocumentsSnapshot; retry: () => void } {
  const { workspaceId, includeArchived, platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|workspace-documents:${workspaceId ?? "none"}:${includeArchived ? "all" : "active"}|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null || workspaceId === null) return Promise.resolve({ rows: [], veterinary_notice: "", note: "" } as WorkspaceDocumentsResponse);
    return platform.modules.workspaces.documents(workspaceId, { includeArchived });
  }, [platform, workspaceId, includeArchived]);
  const state = useDomainResource<WorkspaceDocumentsResponse>(
    "workspace-documents", identity, load,
    { isEmpty: (data) => (data.rows?.length ?? 0) === 0, enabled: platform !== null && workspaceId !== null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { documents: { phase: state.state.phase, rows: state.state.data.rows ?? [], veterinaryNotice: state.state.data.veterinary_notice ?? "" }, retry: state.retry };
  if (state.state.phase === "empty") return { documents: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { documents: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { documents: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** Scoped document + import command slots. Per-document update/archive slots
 * are created by the renderer with a per-row scope suffix so one row's
 * in-flight state never paints onto another row. */
export function useWorkspaceDocumentCommands(scope: string | undefined) {
  const prefix = scope ?? "principal:unscoped";
  const createDocument = usePlatformCommand(`${prefix}|workspace-document-create`);
  const importTasks = usePlatformCommand(`${prefix}|workspace-import-tasks`);
  return { createDocument, importTasks };
}

/** One durable intent key per import SESSION: an interrupted import replays
 * with the SAME key and reconciles to its exact accepted rows (no duplicates);
 * a completed import mints a fresh key so the next import is a NEW intent.
 * The key lives in renderer state — the headless contract only fixes the
 * discipline, never the storage. */
export function newImportIntentKey(): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `import-${uuid}`;
}
