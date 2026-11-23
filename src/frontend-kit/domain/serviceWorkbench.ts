import type {
  PlatformClient, ServiceRequestRecord, ServiceRequestStatus,
} from "../../contracts/platform";
import { serviceTransitionsFor } from "../../shared/serviceTransitions";
import { PlatformClientError } from "../errors";
import { classifyCommandError, type CommandState } from "./commandModel";
import { classifyResourceError, type ResourceState } from "./resourceState";
import type { EngineLocale } from "../runtime";
import { kitText } from "./engineText";

export { PlatformClientError, serviceTransitionsFor };
export type ServiceRequestView = "mine" | "inbox";
export type ServiceRequestApi = Pick<PlatformClient["modules"]["serviceRequests"],
  "mine" | "inbox" | "detail" | "setStatus" | "withdrawConsent" | "redactNote" | "block" | "providerBlock" | "report">;
export interface ServiceRequestCommand {
  state: CommandState;
  recovery: "none" | "reading" | "ready" | "failed";
  recoveryReason?: string;
}
export interface ServiceWorkbenchSnapshot {
  view: ServiceRequestView;
  list: ResourceState<ServiceRequestRecord[]>;
  selectedId: number | null;
  detail: ResourceState<ServiceRequestRecord>;
  commands: Readonly<Record<number, ServiceRequestCommand>>;
}
const STATUS = ["new", "acknowledged", "discussing", "closed", "withdrawn", "spam"] as const;
const IDLE_COMMAND: ServiceRequestCommand = Object.freeze({ state: { phase: "idle" as const }, recovery: "none" });

export function validServiceRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function serviceRequestStatusLabel(status: string, locale: EngineLocale): string {
  const labels: Record<string, readonly [string, string]> = {
    new: ["New", "جدید"], acknowledged: ["Acknowledged", "دریافت تأیید شد"],
    discussing: ["Discussing", "در گفت‌وگو"], closed: ["Closed", "بسته شد"],
    withdrawn: ["Withdrawn", "پس گرفته شد"], spam: ["Spam", "هرزنامه"],
  };
  const pair = labels[status]; return pair ? kitText(locale, pair[0], pair[1]) : status;
}
export function validServiceRequest(value: unknown): value is ServiceRequestRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as ServiceRequestRecord;
  return validServiceRequestId(row.id) && validServiceRequestId(row.provider_person_id)
    && validServiceRequestId(row.row_version) && STATUS.includes(row.status)
    && typeof row.is_requester_view === "boolean" && typeof row.category === "string";
}
function initialSnapshot(): ServiceWorkbenchSnapshot {
  return { view: "mine", list: { phase: "idle" }, selectedId: null,
    detail: { phase: "idle" }, commands: {} };
}
function carried<T>(state: ResourceState<T>): T | undefined {
  return state.phase === "ready" || state.phase === "reloading" ? state.data : undefined;
}
function errorReason(state: ResourceState<unknown>): string | undefined {
  return "reason" in state ? state.reason : undefined;
}

/** Framework-neutral service lifecycle; no DOM, React, private persistent cache,
 * invented reply/history API, or cancellation/replay of an already dispatched write.
 * One instance belongs to one principal/authority scope. Native adapters must
 * dispose it on scope changes and convert transport errors to PlatformClientError.
 */
export class ServiceRequestWorkbench {
  private snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private listSequence = 0;
  private detailSequence = 0;
  private listAbort: AbortController | null = null;
  private detailAbort: AbortController | null = null;
  private reads = new Set<AbortController>();
  private busy = new Set<number>();
  private reconciliationSequence = new Map<number, number>();
  private authoritySequence = 0;
  private readClock = 0;
  /** A later detail/recovery read supersedes an earlier list for this row.
   * undefined = still checking; null = denied/failed; a record = verified read. */
  private recordReads = new Map<number, { sequence: number; record: ServiceRequestRecord | null | undefined }>();
  private privacyPending = new Set<number>();

  constructor(private readonly api: ServiceRequestApi, private readonly isCurrent = () => true) {}
  getSnapshot = (): ServiceWorkbenchSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private live(epoch = this.epoch): boolean { return this.active && this.isCurrent() && epoch === this.epoch; }
  private publish(patch: Partial<ServiceWorkbenchSnapshot>): void {
    if (!this.live()) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private setCommand(id: number, command: ServiceRequestCommand): void {
    this.publish({ commands: { ...this.snapshot.commands, [id]: command } });
  }
  start = (): void => {
    if (this.active || !this.isCurrent()) return;
    this.active = true;
    this.epoch += 1;
    void this.reload();
  };
  dispose = (): void => {
    this.active = false;
    this.epoch += 1;
    this.listAbort?.abort(); this.detailAbort?.abort();
    for (const read of this.reads) read.abort();
    this.reads.clear(); this.busy.clear(); this.reconciliationSequence.clear();
    this.recordReads.clear(); this.privacyPending.clear(); this.authoritySequence += 1;
    this.snapshot = initialSnapshot();
  };
  commandFor = (id: number): ServiceRequestCommand => this.snapshot.commands[id] ?? IDLE_COMMAND;
  private blocked(id: number): boolean {
    const state = this.commandFor(id).state;
    return this.busy.has(id) || state.phase === "submitting" || state.phase === "failed"
      || (state.phase === "rejected" && state.status === 409);
  }
  private currentRecord(id: number): ServiceRequestRecord | undefined {
    if (this.recordReads.has(id) && !this.recordReads.get(id)?.record) return undefined;
    if (this.snapshot.selectedId === id && this.snapshot.detail.phase === "ready") return this.snapshot.detail.data;
    if (this.snapshot.list.phase === "ready") return this.snapshot.list.data.find(row => row.id === id);
    return undefined;
  }
  canAct = (id: number): boolean => this.live() && !this.blocked(id) && !!this.currentRecord(id);
  setView = (view: ServiceRequestView): void => {
    if (!this.live() || (view !== "mine" && view !== "inbox") || view === this.snapshot.view) return;
    this.detailAbort?.abort(); this.detailSequence += 1;
    this.publish({ view, list: { phase: "loading" }, selectedId: null, detail: { phase: "idle" } });
    void this.reload();
  };
  select = (id: number | null): void => {
    if (!this.live() || (id !== null && !validServiceRequestId(id))) return;
    this.detailAbort?.abort(); this.detailSequence += 1;
    this.publish({ selectedId: id, detail: id === null ? { phase: "idle" } : { phase: "loading" } });
    if (id !== null) void this.readSelected(id);
  };
  reload = async (): Promise<void> => {
    if (!this.live()) return;
    const epoch = this.epoch, view = this.snapshot.view, sequence = ++this.listSequence;
    this.listAbort?.abort(); const abort = new AbortController(); this.listAbort = abort;
    // A newer authority check invalidates old details AND recovery acknowledgements.
    // Abort is advisory: the sequence checks also fence transports that ignore it.
    this.detailAbort?.abort(); this.detailSequence += 1; this.authoritySequence += 1;
    for (const read of this.reads) read.abort();
    this.reads.clear(); this.reconciliationSequence.clear(); this.recordReads.clear();
    const selectedSequence = this.detailSequence, started = ++this.readClock;
    const commands = Object.fromEntries(Object.entries(this.snapshot.commands).map(([id, command]) =>
      [id, command.recovery === "none" ? command : { ...command, recovery: "none" as const, recoveryReason: undefined }]));
    const previous = carried(this.snapshot.list);
    // Private contacts/notes are not retained while their authority is rechecked.
    this.publish({ commands, list: previous ? { phase: "reloading", data: previous.map(this.maskPrivate) } : { phase: "loading" },
      ...(this.snapshot.selectedId !== null ? { detail: { phase: "loading" as const } } : {}) });
    try {
      const result = await this.api[view]({ signal: abort.signal });
      if (!this.live(epoch) || sequence !== this.listSequence || abort.signal.aborted) return;
      if (!Array.isArray(result.requests) || !result.requests.every(validServiceRequest)) throw new Error("Invalid service request response.");
      const rows = result.requests.flatMap(row => {
        const newer = this.recordReads.get(row.id);
        const record = newer && newer.sequence > started
          ? newer.record === undefined ? this.maskPrivate(row) : newer.record : row;
        return record ? [this.visibleRecord(record)] : [];
      });
      this.publish({ list: rows.length ? { phase: "ready", data: rows } : { phase: "empty" } });
    } catch (error) {
      if (this.live(epoch) && sequence === this.listSequence && !abort.signal.aborted) {
        this.publish({ list: classifyResourceError(error) });
      }
    }
    if (this.live(epoch) && sequence === this.listSequence && this.detailSequence === selectedSequence && this.snapshot.selectedId !== null) {
      await this.readSelected(this.snapshot.selectedId);
    }
  };
  private maskPrivate = (row: ServiceRequestRecord): ServiceRequestRecord => ({ ...row, contact: null, note: undefined });
  private visibleRecord = (row: ServiceRequestRecord): ServiceRequestRecord =>
    this.privacyPending.has(row.id) ? this.maskPrivate(row) : row;
  private replaceRecord(id: number, record: ServiceRequestRecord | null): void {
    if (record) record = this.visibleRecord(record);
    const patch: Partial<ServiceWorkbenchSnapshot> = {};
    const rows = carried(this.snapshot.list);
    if (rows) {
      const next = rows.flatMap(row => row.id !== id ? [row] : record ? [record] : []);
      patch.list = this.snapshot.list.phase === "reloading" ? { phase: "reloading", data: next }
        : next.length ? { phase: "ready", data: next } : { phase: "empty" };
    }
    if (this.snapshot.selectedId === id) patch.detail = record
      ? { phase: "ready", data: record } : { phase: "unavailable", reason: "This request is no longer available." };
    this.publish(patch);
  }
  private readSelected = async (id: number): Promise<void> => {
    if (!this.live() || this.snapshot.selectedId !== id) return;
    const epoch = this.epoch, sequence = ++this.detailSequence, authority = this.authoritySequence;
    this.detailAbort?.abort(); const abort = new AbortController(); this.detailAbort = abort;
    const row = this.currentRecord(id), started = ++this.readClock;
    this.recordReads.set(id, { sequence: started, record: undefined });
    this.reconciliationSequence.delete(id);
    const command = this.commandFor(id);
    if (command.recovery !== "none") this.setCommand(id, { ...command, recovery: "none", recoveryReason: undefined });
    if (row) this.replaceRecord(id, this.maskPrivate(row));
    this.publish({ detail: { phase: "loading" } });
    const current = () => this.live(epoch) && authority === this.authoritySequence
      && sequence === this.detailSequence && !abort.signal.aborted && this.recordReads.get(id)?.sequence === started;
    try {
      const result = await this.api.detail(id, { signal: abort.signal });
      if (!current()) return;
      if (!validServiceRequest(result.request) || result.request.id !== id) throw new Error("Invalid service request response.");
      this.recordReads.set(id, { sequence: started, record: this.visibleRecord(result.request) });
      this.replaceRecord(id, result.request);
    } catch (error) {
      if (current()) {
        this.recordReads.set(id, { sequence: started, record: null });
        this.replaceRecord(id, null);
        this.publish({ detail: classifyResourceError(error) });
      }
    }
  };
  transition = (id: number, status: ServiceRequestStatus): Promise<boolean> => {
    const row = this.currentRecord(id);
    if (!row || !serviceTransitionsFor(row.status, row.is_requester_view ? "requester" : "provider").includes(status)) return Promise.resolve(false);
    return this.execute(id, () => this.api.setStatus(id, status, { expectedVersion: row.row_version }), result => {
      const request = (result as { request?: unknown })?.request;
      return validServiceRequest(request) && request.id === id && request.status === status && request.row_version > row.row_version;
    });
  };
  withdrawConsent = (id: number): Promise<boolean> => {
    if (!this.currentRecord(id)?.is_requester_view) return Promise.resolve(false);
    return this.execute(id, () => this.api.withdrawConsent(id), result => {
      const receipt = result as { withdrawn?: boolean; request_id?: number; share_contact?: boolean };
      return receipt?.withdrawn === true && receipt.request_id === id && receipt.share_contact === false;
    }, true);
  };
  redactNote = (id: number): Promise<boolean> => {
    if (!this.currentRecord(id)?.is_requester_view) return Promise.resolve(false);
    return this.execute(id, () => this.api.redactNote(id), result => {
      const receipt = result as { redacted?: boolean; request_id?: number };
      return receipt?.redacted === true && receipt.request_id === id;
    }, true);
  };
  block = (id: number): Promise<boolean> => {
    const row = this.currentRecord(id);
    if (!row?.is_requester_view) return Promise.resolve(false);
    return this.execute(id, () => this.api.block(id), result => {
      const receipt = result as { blocked?: boolean; provider_person_id?: number };
      return receipt?.blocked === true && receipt.provider_person_id === row.provider_person_id;
    });
  };
  providerBlock = (id: number, reason?: string): Promise<boolean> => {
    const row = this.currentRecord(id), note = reason?.trim();
    if (!row || row.is_requester_view || (note && (note.length < 5 || note.length > 500))) return Promise.resolve(false);
    return this.execute(id, () => this.api.providerBlock(id, note ? { reason: note } : {}), result => {
      const receipt = result as { blocked?: boolean; requester_account?: string };
      return receipt?.blocked === true && receipt.requester_account === "blocked";
    });
  };
  report = (id: number, reason: string): Promise<boolean> => {
    const note = reason.trim();
    if (!this.currentRecord(id) || note.length < 5 || note.length > 500) return Promise.resolve(false);
    return this.execute(id, () => this.api.report(id, { reason: note }), result => {
      const receipt = result as { reported?: boolean; report_id?: number };
      return receipt?.reported === true && validServiceRequestId(receipt.report_id);
    });
  };
  private async execute(id: number, run: () => Promise<unknown>, valid: (result: unknown) => boolean, privacy = false): Promise<boolean> {
    if (!this.canAct(id)) return false;
    const epoch = this.epoch;
    this.busy.add(id);
    if (privacy) {
      const row = this.currentRecord(id);
      this.privacyPending.add(id);
      if (row) this.replaceRecord(id, this.maskPrivate(row));
    }
    this.setCommand(id, { state: { phase: "submitting" }, recovery: "none" });
    let accepted = false;
    try {
      const result = await run();
      if (!this.live(epoch)) return false;
      if (!valid(result)) throw new Error("The server response did not confirm this change. Recheck the request before another attempt.");
      accepted = true;
      this.privacyPending.delete(id);
      await this.reload();
      if (this.live(epoch)) this.setCommand(id, { state: { phase: "accepted", message: "Change recorded. Notification delivery is not confirmed." }, recovery: "none" });
    } catch (error) {
      if (this.live(epoch)) {
        const state = classifyCommandError(error);
        if (privacy && state.phase === "rejected" && state.status !== 409) {
          // A definite refusal permits a fresh authorized read. Unknown/409
          // outcomes stay masked until the explicit reconciliation succeeds.
          this.privacyPending.delete(id);
          await this.reload();
        }
        if (this.live(epoch)) this.setCommand(id, { state, recovery: "none" });
      }
    } finally {
      if (this.live(epoch)) this.busy.delete(id);
      if (this.live(epoch)) this.publish({ commands: { ...this.snapshot.commands } });
    }
    return accepted && this.live(epoch);
  }
  reconcile = async (id: number): Promise<void> => {
    if (!this.live() || this.busy.has(id) || !validServiceRequestId(id)) return;
    const command = this.commandFor(id);
    if (command.recovery === "reading") return;
    if (command.state.phase !== "failed" && !(command.state.phase === "rejected" && command.state.status === 409)) return;
    const epoch = this.epoch, authority = this.authoritySequence;
    const sequence = (this.reconciliationSequence.get(id) ?? 0) + 1;
    this.reconciliationSequence.set(id, sequence);
    const abort = new AbortController(); this.reads.add(abort);
    const row = this.currentRecord(id), started = ++this.readClock;
    this.recordReads.set(id, { sequence: started, record: undefined });
    if (this.snapshot.selectedId === id) { this.detailAbort?.abort(); this.detailSequence += 1; }
    if (row) this.replaceRecord(id, this.maskPrivate(row));
    this.setCommand(id, { ...command, recovery: "reading", recoveryReason: undefined });
    const current = () => this.live(epoch) && authority === this.authoritySequence && !abort.signal.aborted
      && this.reconciliationSequence.get(id) === sequence && this.recordReads.get(id)?.sequence === started;
    try {
      const result = await this.api.detail(id, { signal: abort.signal });
      if (!current()) return;
      if (!validServiceRequest(result.request) || result.request.id !== id) throw new Error("Invalid service request response.");
      this.privacyPending.delete(id);
      this.recordReads.set(id, { sequence: started, record: result.request });
      this.replaceRecord(id, result.request);
      this.setCommand(id, { ...command, recovery: "ready", recoveryReason: undefined });
    } catch (error) {
      if (current()) {
        this.recordReads.set(id, { sequence: started, record: null });
        this.replaceRecord(id, null);
        const failed = classifyResourceError(error);
        if (this.snapshot.selectedId === id) this.publish({ detail: failed });
        this.setCommand(id, { ...command, recovery: "failed", recoveryReason: errorReason(failed) });
      }
    } finally { this.reads.delete(abort); }
  };
  acknowledge = (id: number): boolean => {
    if (!this.live() || this.busy.has(id) || this.commandFor(id).recovery !== "ready" || !this.currentRecord(id)) return false;
    this.setCommand(id, IDLE_COMMAND);
    return true;
  };
}
