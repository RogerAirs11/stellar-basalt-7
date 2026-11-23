import { useEffect, useMemo, useRef } from "react";
import type { AdminClaimRecord, ChangeRequestCreateInput, ChangeRequestRecord, ClaimRecord, PlatformClient } from "../../contracts/platform";
import { isRegistryId } from "../routes";
import { classifyCommandError, usePlatformCommand } from "./commandStatus";
import { useDomainResource } from "./useDomainResource";
import { useMutationIntent } from "./mutationIntent";
import { useScopedState } from "./principalScope";
import type { EngineLocale } from "../runtime";
import { kitText } from "./engineText";
import type { ResourceState } from "./resourceState";

/** Native renderers share workflow state, never forms or skin CSS. */
export interface HorseWorkflowAccess {
  claimRead: boolean;
  claimCreate: boolean;
  changeRead: boolean;
  changeCreate: boolean;
}
export interface HorseClaimDraft { horseId: string; evidence: string }
export interface HorseCorrectionDraft {
  horseId: string;
  requestType: "update_horse" | "ownership" | "other";
  summary: string;
  evidence: string;
  fieldName: string;
  oldValue: string;
  proposedValue: string;
}
export type HorseWorkflowIssue = "horse_required" | "horse_invalid" | "evidence_required" | "evidence_long" | "summary_required" | "summary_long" | "field_incomplete";

/** Do not silently turn an invalid, localized or oversized ID into a general request. */
export function parseWorkflowHorseId(value: string, required = false): { value: number | null; issue: HorseWorkflowIssue | null } {
  const ascii = value.trim().replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
  if (!ascii) return { value: null, issue: required ? "horse_required" : null };
  const number = /^\d+$/.test(ascii) ? Number(ascii) : NaN;
  return isRegistryId(number) ? { value: number, issue: null } : { value: null, issue: "horse_invalid" };
}

const HORSE_WORKFLOW_ISSUES: Record<HorseWorkflowIssue, readonly [string, string]> = ({
  horse_required: ["Enter the horse’s registry ID.", "شناسه ثبت اسب را وارد کنید."],
  horse_invalid: ["Use a positive whole registry ID. Persian and Arabic digits are accepted.", "شناسه ثبت باید عدد صحیح و مثبت باشد. ارقام فارسی و عربی پذیرفته می‌شوند."],
  evidence_required: ["Describe your ownership evidence in at least 10 characters.", "مدرک مالکیت خود را با دست‌کم ۱۰ نویسه شرح دهید."],
  evidence_long: ["Keep the evidence note within 2,000 characters.", "یادداشت مدرک باید حداکثر ۲۰۰۰ نویسه باشد."],
  summary_required: ["Describe the correction in at least 3 characters.", "اصلاح را با دست‌کم ۳ نویسه شرح دهید."],
  summary_long: ["Keep the correction summary within 2,000 characters.", "خلاصه اصلاح باید حداکثر ۲۰۰۰ نویسه باشد."],
  field_incomplete: ["Provide both a field name and its proposed value, or leave the field proposal empty.", "نام فیلد و مقدار پیشنهادی را با هم وارد کنید، یا پیشنهاد فیلد را خالی بگذارید."],
}) as Record<HorseWorkflowIssue, readonly [string, string]>;
export const horseWorkflowIssueText = (issue: HorseWorkflowIssue, locale: EngineLocale): string => {
  const pair = HORSE_WORKFLOW_ISSUES[issue] ?? ["Enter the horse’s registry ID.", "شناسه ثبت اسب را وارد کنید."];
  return kitText(locale, pair[0], pair[1]);
};

const claimRecord = (row: unknown): row is ClaimRecord => {
  if (!row || typeof row !== "object") return false;
  const r = row as ClaimRecord;
  return typeof r.id === "string" && r.id.trim().length > 0 && isRegistryId(r.horse_id)
    && typeof r.status === "string" && r.status.length > 0 && typeof r.created_at === "string";
};
const correctionRecord = (row: unknown): row is ChangeRequestRecord => {
  if (!row || typeof row !== "object") return false;
  const r = row as ChangeRequestRecord;
  return typeof r.id === "string" && r.id.trim().length > 0 && (r.horse_id == null || isRegistryId(r.horse_id))
    && ["draft", "pending", "approved", "rejected", "withdrawn"].includes(r.status)
    && ["create_horse", "update_horse", "ownership", "other"].includes(r.request_type)
    && Array.isArray(r.items) && typeof r.created_at === "string" && typeof r.updated_at === "string";
};
function assertReviewReceipt(value: unknown): void {
  const response = value as { workflowEffect?: unknown; canonicalApplied?: unknown } | null;
  if (!response || response.workflowEffect !== "review_only" || response.canonicalApplied !== false) {
    throw new Error("The server returned an incomplete workflow receipt. Reload your requests before taking another action.");
  }
}
const seedClaim = (horseId: number | null): HorseClaimDraft => ({ horseId: horseId == null ? "" : String(horseId), evidence: "" });
const seedCorrection = (horseId: number | null): HorseCorrectionDraft => ({ horseId: horseId == null ? "" : String(horseId), requestType: horseId == null ? "other" : "update_horse", summary: "", evidence: "", fieldName: "", oldValue: "", proposedValue: "" });
const noteOf = (evidence: Record<string, unknown> | null | undefined): string => typeof evidence?.note === "string" ? evidence.note : "";
function rowsState<T>(state: ResourceState<{ rows: T[]; serial: number }>): ResourceState<T[]> {
  return state.phase === "ready" || state.phase === "reloading" ? { phase: state.phase, data: state.data.rows } : state;
}

/**
 * Private state is scoped to the account, its permission epoch and optional horse.
 * An uncertain create survives a page reload as a key and coarse metadata only;
 * private evidence stays in memory. Claims have no idempotent replay endpoint:
 * only a fresh successful own-list read and explicit inspection unlock them.
 * Corrections retain the exact payload/key for a same-page safe retry.
 */
export function useHorseWorkflows(options: {
  platform: PlatformClient;
  scope: string;
  access: HorseWorkflowAccess;
  horseId?: number | null;
  source: string;
}) {
  const { platform, access, source } = options;
  const horseId = options.horseId ?? null;
  const scope = `${options.scope}|horse:${horseId ?? "all"}`;
  const guard = useMemo(() => ({
    claim: false, change: false, claimSerial: 0, changeSerial: 0,
    exactChange: null as ChangeRequestCreateInput | null,
  }), [scope, platform]);
  const current = useRef(guard); current.current = guard;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const currentScope = () => alive.current && current.current === guard;
  const [claimDraft, setClaimDraft] = useScopedState(scope, () => seedClaim(horseId));
  const [changeDraft, setChangeDraft] = useScopedState(scope, () => seedCorrection(horseId));
  const [editing, setEditing] = useScopedState<ChangeRequestRecord | null>(scope, null);
  const [claimReadAfter, setClaimReadAfter] = useScopedState<number | null>(scope, null);
  const [changeReadAfter, setChangeReadAfter] = useScopedState<number | null>(scope, null);
  const [claimReceipt, setClaimReceipt] = useScopedState<ClaimRecord | null>(scope, null);
  const [changeReceipt, setChangeReceipt] = useScopedState<ChangeRequestRecord | null>(scope, null);
  const [changeOperation, setChangeOperation] = useScopedState<"create" | "edit" | "submit" | "withdraw" | null>(scope, null);
  const claimCommand = usePlatformCommand(`${scope}:claim`);
  const changeCommand = usePlatformCommand(`${scope}:change`);
  // Receipt IDs are opaque strings in this domain. Validate them above, then
  // clear the matching intent; do not coerce a UUID into the numeric receipt API.
  const claimIntent = useMutationIntent("horse-claim", options.scope, horseId ?? "all", null);
  const changeIntent = useMutationIntent("registry-correction", options.scope, horseId ?? "all", null);
  const claimsLoad = useDomainResource("horse-workflow-claims", scope, async signal => {
    const serial = ++guard.claimSerial;
    const result = await platform.claims.mine({ signal });
    if (!result || !Array.isArray(result.claims) || !result.claims.every(claimRecord)) throw new Error("The ownership-claim list could not be verified. Try loading it again.");
    return { rows: horseId == null ? result.claims : result.claims.filter(row => row.horse_id === horseId), serial };
  }, { enabled: access.claimRead });
  const changesLoad = useDomainResource("horse-workflow-changes", scope, async signal => {
    const serial = ++guard.changeSerial;
    const result = await platform.changes.mine({ signal });
    if (!result || !Array.isArray(result.requests) || !result.requests.every(correctionRecord)) throw new Error("The correction list could not be verified. Try loading it again.");
    return { rows: horseId == null ? result.requests : result.requests.filter(row => row.horse_id === horseId), serial };
  }, { enabled: access.changeRead });

  const claimPending = claimCommand.state.phase === "submitting";
  const changePending = changeCommand.state.phase === "submitting";
  const claimUncertain = claimCommand.state.phase === "failed" || (!claimPending && claimIntent.snapshot.record !== null);
  const changeUncertain = changeCommand.state.phase === "failed" || (!changePending && changeIntent.snapshot.record !== null);
  const claimConflict = claimCommand.state.phase === "rejected" && claimCommand.state.status === 409;
  const changeConflict = changeCommand.state.phase === "rejected" && changeCommand.state.status === 409;
  const claimLocked = claimPending || claimUncertain || claimConflict;
  const changeLocked = changePending || changeUncertain || changeConflict;
  const claimRecoveryReady = (claimUncertain || claimConflict) && claimReadAfter != null && claimsLoad.state.phase === "ready" && claimsLoad.state.data.serial >= claimReadAfter;
  const changeRecoveryReady = (changeUncertain || changeConflict) && changeReadAfter != null && changesLoad.state.phase === "ready" && changesLoad.state.data.serial >= changeReadAfter;

  const claimId = parseWorkflowHorseId(claimDraft.horseId, true);
  const claimIssues: HorseWorkflowIssue[] = [
    ...(claimId.issue ? [claimId.issue] : []),
    ...(claimDraft.evidence.trim().length < 10 ? ["evidence_required" as const] : []),
    ...(claimDraft.evidence.length > 2000 ? ["evidence_long" as const] : []),
  ];
  const correctionId = parseWorkflowHorseId(changeDraft.horseId, changeDraft.requestType !== "other");
  const changeIssues: HorseWorkflowIssue[] = [
    ...(correctionId.issue ? [correctionId.issue] : []),
    ...(changeDraft.summary.trim().length < 3 ? ["summary_required" as const] : []),
    ...(changeDraft.summary.length > 2000 ? ["summary_long" as const] : []),
    ...(changeDraft.evidence.length > 2000 ? ["evidence_long" as const] : []),
    ...(!editing && Boolean(changeDraft.fieldName.trim() || changeDraft.oldValue.trim() || changeDraft.proposedValue.trim())
      && (!changeDraft.fieldName.trim() || !changeDraft.proposedValue.trim()) ? ["field_incomplete" as const] : []),
  ];

  function reloadClaims() {
    if (!currentScope() || !access.claimRead || claimPending) return;
    setClaimReadAfter(guard.claimSerial + 1); claimsLoad.retry();
  }
  function reloadChanges() {
    if (!currentScope() || !access.changeRead || changePending) return;
    setChangeReadAfter(guard.changeSerial + 1); changesLoad.retry();
  }
  async function submitClaim(): Promise<boolean> {
    if (!currentScope() || !access.claimCreate || guard.claim || claimLocked || claimIssues.length || claimId.value == null) return false;
    guard.claim = true; setClaimReceipt(null); setClaimReadAfter(null);
    let row: ClaimRecord | null = null;
    let refusal = false;
    let conflict = false;
    const accepted = await claimCommand.run(async () => {
      const key = claimIntent.begin({ workflow: "horse-claim", note_length: claimDraft.evidence.trim().length });
      claimIntent.markSubmitted(key);
      try {
        const response = await platform.claims.create(claimId.value!, { note: claimDraft.evidence.trim(), source });
        assertReviewReceipt(response);
        if (!claimRecord(response.claim) || response.claim.horse_id !== claimId.value) throw new Error("The ownership receipt does not match this horse. Reload your claims.");
        row = response.claim; return response;
      } catch (error) { const state = classifyCommandError(error); refusal = state.phase === "rejected"; conflict = state.phase === "rejected" && state.status === 409; throw error; }
    });
    if (!currentScope()) return false;
    if (accepted && row) {
      claimIntent.discard(); guard.claim = false; setClaimReceipt(row); setClaimDraft(seedClaim(horseId)); claimsLoad.retry();
    } else if (refusal) { claimIntent.discard(); if (!conflict) guard.claim = false; }
    return accepted;
  }

  function correctionEvidence() {
    const value = { ...(editing?.evidence ?? {}) };
    if (changeDraft.evidence.trim()) value.note = changeDraft.evidence.trim(); else delete value.note;
    return Object.keys(value).length ? value : undefined;
  }
  async function performChange(execute: () => ReturnType<PlatformClient["changes"]["create"]>, operation: "create" | "edit" | "submit" | "withdraw", expected: { id?: string; horseId?: number | null; type?: string }): Promise<boolean> {
    guard.change = true; setChangeReceipt(null); setChangeReadAfter(null); setChangeOperation(operation);
    let row: ChangeRequestRecord | null = null;
    let refusal = false;
    let conflict = false;
    const accepted = await changeCommand.run(async () => {
      try {
        const response = await execute(); assertReviewReceipt(response);
        if (!correctionRecord(response.request) || (expected.id != null && response.request.id !== expected.id)
          || (expected.type != null && (response.request.request_type !== expected.type || (response.request.horse_id ?? null) !== expected.horseId))) {
          throw new Error("The correction receipt could not be matched to this action. Reload your requests.");
        }
        row = response.request; return response;
      } catch (error) {
        const state = classifyCommandError(error); refusal = state.phase === "rejected"; conflict = state.phase === "rejected" && state.status === 409; throw error;
      }
    });
    if (!currentScope()) return false;
    if (accepted && row) {
      if (operation === "create") changeIntent.discard();
      guard.change = false; guard.exactChange = null; setChangeReceipt(row);
      if (operation === "create" || operation === "edit") { setEditing(null); setChangeDraft(seedCorrection(horseId)); }
      changesLoad.retry();
    } else if (refusal && !conflict) {
      if (operation === "create") changeIntent.discard();
      guard.change = false; guard.exactChange = null;
    }
    return accepted;
  }
  async function saveCorrection(submit: boolean): Promise<boolean> {
    if (!currentScope() || !access.changeCreate || guard.change || changeLocked || changeIssues.length) return false;
    if (editing) {
      if (editing.status !== "draft" || editing.request_type === "create_horse" || editing.submission || editing.parent_correction) return false;
      // Updating only summary/evidence leaves existing typed field values intact.
      // R148 Task 5: send the revision this record was loaded at; a stale tab
      // gets 409 content_revision_conflict instead of clobbering a newer save.
      return performChange(() => platform.changes.update(editing.id, { expected_content_revision: editing.content_revision ?? 0, summary: changeDraft.summary.trim(), evidence: correctionEvidence() ?? null }), "edit", { id: editing.id });
    }
    const input: ChangeRequestCreateInput = {
      horse_id: correctionId.value, request_type: changeDraft.requestType, summary: changeDraft.summary.trim(),
      evidence: correctionEvidence(), submit,
      ...(changeDraft.fieldName.trim() ? { items: [{ field_name: changeDraft.fieldName.trim(), ...(changeDraft.oldValue.trim() ? { old_value: changeDraft.oldValue.trim() } : {}), proposed_value: changeDraft.proposedValue.trim() }] } : {}),
    };
    return performChange(() => {
      const key = changeIntent.begin({ workflow: "registry-correction", note_length: changeDraft.summary.trim().length });
      const exact = { ...input, idempotency_key: key }; guard.exactChange = exact; changeIntent.markSubmitted(key);
      return platform.changes.create(exact);
    }, "create", { horseId: correctionId.value, type: input.request_type });
  }
  function editCorrection(row: ChangeRequestRecord): boolean {
    if (!currentScope() || !access.changeCreate || guard.change || changeLocked || changesLoad.state.phase !== "ready"
      || row.status !== "draft" || row.request_type === "create_horse" || row.submission || row.parent_correction || !changesLoad.state.data.rows.some(item => item.id === row.id)) return false;
    setEditing(row); setChangeDraft({ ...seedCorrection(horseId), horseId: row.horse_id == null ? "" : String(row.horse_id), requestType: row.request_type as HorseCorrectionDraft["requestType"], summary: row.summary ?? "", evidence: noteOf(row.evidence) });
    setChangeReceipt(null); changeCommand.reset(); return true;
  }
  function cancelEdit() { if (currentScope() && !guard.change && !changeLocked) { setEditing(null); setChangeDraft(seedCorrection(horseId)); changeCommand.reset(); } }
  async function transitionCorrection(id: string, action: "submit" | "withdraw"): Promise<boolean> {
    if (!currentScope() || !access.changeCreate || guard.change || changeLocked || changesLoad.state.phase !== "ready") return false;
    const row = changesLoad.state.data.rows.find(item => item.id === id);
    if (!row || (action === "submit" ? row.status !== "draft" : !["draft", "pending"].includes(row.status))) return false;
    return performChange(() => platform.changes[action](id), action, { id });
  }
  async function retryExactCorrection(): Promise<boolean> {
    const input = guard.exactChange;
    if (!currentScope() || !access.changeCreate || changePending || !changeRecoveryReady || !input) return false;
    return performChange(() => platform.changes.create(input), "create", { horseId: input.horse_id ?? null, type: input.request_type });
  }
  function acknowledgeClaim() {
    if (!currentScope() || !claimRecoveryReady) return;
    claimIntent.discard(); claimCommand.reset(); guard.claim = false; setClaimReadAfter(null);
  }
  function acknowledgeCorrection() {
    if (!currentScope() || !changeRecoveryReady) return;
    changeIntent.discard(); changeCommand.reset(); guard.change = false; guard.exactChange = null; setChangeReadAfter(null);
  }

  return {
    scope, horseId, access,
    claims: rowsState(claimsLoad.state), changes: rowsState(changesLoad.state),
    claimDraft, changeDraft, editing,
    setClaimDraft: (patch: Partial<HorseClaimDraft>) => { if (currentScope() && !guard.claim && !claimLocked) setClaimDraft(previous => ({ ...previous, ...patch })); },
    setChangeDraft: (patch: Partial<HorseCorrectionDraft>) => { if (currentScope() && !guard.change && !changeLocked) setChangeDraft(previous => ({ ...previous, ...patch })); },
    claimIssues, changeIssues, claimCommand: claimCommand.state, changeCommand: changeCommand.state,
    claimReceipt, changeReceipt, changeOperation, claimLocked, changeLocked, claimUncertain, changeUncertain, claimConflict, changeConflict,
    claimRecoveryReady, changeRecoveryReady, canRetryExactCorrection: changeRecoveryReady && guard.exactChange != null,
    claimIntentDurable: claimIntent.snapshot.durable, changeIntentDurable: changeIntent.snapshot.durable,
    reloadClaims, reloadChanges, submitClaim, saveCorrection, editCorrection, cancelEdit, transitionCorrection,
    retryExactCorrection, acknowledgeClaim, acknowledgeCorrection,
  };
}
export type HorseWorkflowModel = ReturnType<typeof useHorseWorkflows>;

export type HorseReviewKind = "claim" | "change";
export type HorseReviewDecision = "approved" | "rejected" | "needs_changes";
type HorseReviewRecords = { claim: AdminClaimRecord; change: ChangeRequestRecord };
export interface HorseReviewReceipt {
  id: string;
  status: string;
  canonicalApplied: boolean;
  accessGranted: boolean;
  canonicalHorseId: number | null;
}

/** One current, permission-scoped queue and one guarded review at a time.
 * Review reasons and protected evidence never enter durable storage. Only a
 * coarse outstanding-intent marker survives a reload; no review is replayed
 * automatically. Unknown/409 outcomes require a new successful queue read and
 * explicit inspection before another decision can be sent. */
export function useHorseReviewQueue<K extends HorseReviewKind>(options: {
  platform: PlatformClient; scope: string; kind: K; enabled: boolean;
}) {
  const { platform, kind, enabled } = options;
  const scope = `${options.scope}|review:${kind}|enabled:${enabled}`;
  const guard = useMemo(() => ({ busy: false, serial: 0 }), [scope, platform]);
  const current = useRef(guard); current.current = guard;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const stillCurrent = () => alive.current && current.current === guard;
  const [notes, setNotes] = useScopedState<Record<string, string>>(scope, () => ({}));
  const [readAfter, setReadAfter] = useScopedState<number | null>(scope, null);
  const [receipt, setReceipt] = useScopedState<HorseReviewReceipt | null>(scope, null);
  const [activeId, setActiveId] = useScopedState<string | null>(scope, null);
  const command = usePlatformCommand(scope);
  const intent = useMutationIntent(`horse-${kind}-review`, options.scope, "queue", null);
  const loaded = useDomainResource(`horse-${kind}-review`, scope, async signal => {
    const serial = ++guard.serial;
    let rows: unknown;
    if (kind === "claim") rows = (await platform.admin.claims({ signal })).claims;
    else rows = (await platform.admin.changeRequests({ signal })).requests;
    const valid = kind === "claim" ? claimRecord : correctionRecord;
    if (!Array.isArray(rows) || !rows.every(valid)) throw new Error("The protected review queue could not be verified. Reload before deciding.");
    return { rows: rows as HorseReviewRecords[K][], serial };
  }, { enabled });
  const pending = command.state.phase === "submitting";
  const conflict = command.state.phase === "rejected" && command.state.status === 409;
  const uncertain = command.state.phase === "failed" || (!pending && intent.snapshot.record !== null);
  const locked = pending || conflict || uncertain;
  const recoveryReady = (uncertain || conflict) && readAfter !== null && loaded.state.phase === "ready" && loaded.state.data.serial >= readAfter;
  const rows = rowsState(loaded.state);
  function reload() {
    if (!stillCurrent() || !enabled || pending) return;
    setReadAfter(guard.serial + 1); loaded.retry();
  }
  function canReview(id: string, decision: HorseReviewDecision = "approved") {
    if (!stillCurrent() || !enabled || locked || guard.busy || rows.phase !== "ready") return false;
    if (kind === "claim" && decision === "needs_changes") return false;
    const row = rows.data.find(value => value.id === id);
    const statusEligible = row && (row.status === "pending" || (kind === "change" && row.status === "draft"));
    const note = (notes[id] ?? "").trim();
    return Boolean(statusEligible && note.length >= 3 && note.length <= 2000);
  }
  async function review(id: string, decision: HorseReviewDecision): Promise<boolean> {
    if (!canReview(id, decision)) return false;
    guard.busy = true; setActiveId(id); setReadAfter(null); setReceipt(null);
    const note = notes[id]!.trim();
    let outcome: HorseReviewReceipt | null = null;
    let rejected = false;
    let conflictResult = false;
    const accepted = await command.run(async () => {
      const key = intent.begin({ workflow: `horse-${kind}-review`, note_length: note.length });
      intent.markSubmitted(key);
      try {
        const response = kind === "claim"
          ? await platform.admin.reviewClaim(id, decision as "approved" | "rejected", note)
          : await platform.admin.reviewChangeRequest(id, decision, note);
        // Review approvals may commit canonical changes or an access grant;
        // create/submission receipts, in contrast, are review-only.
        const payload = response as unknown as { claim?: AdminClaimRecord; request?: ChangeRequestRecord; canonicalApplied?: unknown; accessGranted?: unknown; canonical_horse_id?: unknown };
        const row = kind === "claim" ? payload.claim : payload.request;
        const valid = kind === "claim" ? claimRecord(row) : correctionRecord(row);
        if (!valid || !row || row.id !== id || row.status !== (decision === "needs_changes" ? "draft" : decision)
          || typeof payload.canonicalApplied !== "boolean") throw new Error("The review receipt did not match this decision. Reload the queue before another decision.");
        outcome = {
          id, status: row.status, canonicalApplied: payload.canonicalApplied,
          accessGranted: payload.accessGranted === true,
          canonicalHorseId: typeof payload.canonical_horse_id === "number" && isRegistryId(payload.canonical_horse_id) ? payload.canonical_horse_id : null,
        };
        return response;
      } catch (error) {
        const state = classifyCommandError(error);
        rejected = state.phase === "rejected";
        conflictResult = state.phase === "rejected" && state.status === 409;
        throw error;
      }
    });
    if (!stillCurrent()) return false;
    if (accepted && outcome) {
      intent.discard(); guard.busy = false; setReceipt(outcome);
      setNotes(previous => { const next = { ...previous }; delete next[id]; return next; });
      loaded.retry();
    } else if (rejected && !conflictResult) { intent.discard(); guard.busy = false; }
    return accepted;
  }
  function acknowledge() {
    if (!stillCurrent() || !recoveryReady) return;
    intent.discard(); command.reset(); guard.busy = false; setReadAfter(null); setActiveId(null);
  }
  return {
    rows, notes, command: command.state, receipt, activeId, pending, locked, uncertain, conflict, recoveryReady,
    durable: intent.snapshot.durable, reload, canReview, review, acknowledge,
    setNote: (id: string, value: string) => { if (stillCurrent() && enabled && !guard.busy && !locked) setNotes(previous => ({ ...previous, [id]: value })); },
  };
}
