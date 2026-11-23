import type { PlatformClient, ServiceRequestCreateInput } from "../../contracts/platform";
import { isServiceCategoryId, isValidProvinceCode, PROVINCE_CODE_SCHEME } from "../../directory/vocabulary";
import { PlatformClientError } from "../errors";
import { classifyCommandError, type CommandState } from "./commandModel";
import {
  isIntentExpired, openIntentStorage, type IntentStorage,
  type MutationIntentRecord, type MutationIntentSnapshot,
} from "./mutationIntentStorage";
import { validServiceRequestId } from "./serviceWorkbench";

export type ServiceComposerApi = Pick<PlatformClient["modules"]["serviceRequests"], "create" | "reconcileIntent">;
export interface ServiceComposerSnapshot {
  command: CommandState;
  intent: MutationIntentSnapshot;
  canSubmit: boolean;
  /** Only an exact in-memory payload may be replayed, after a successful key lookup. */
  canReplay: boolean;
}
const WORKFLOW = "service-request";
function initial(durable: boolean): ServiceComposerSnapshot {
  return { command: { phase: "idle" }, intent: { phase: "idle", durable, record: null,
    requestId: null, unknownReason: null, reconciling: false }, canSubmit: false, canReplay: false };
}

/** A service-specific adapter to the shared durable intent protocol. It stores
 * only the key and coarse metadata; private request content stays in memory.
 * New intent, exact-key replay, and explicit discard are distinct operations.
 * It never automatically repeats a mutation after a timeout or page reload.
 */
export class ServiceRequestComposer {
  private snapshot: ServiceComposerSnapshot;
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private lookupSequence = 0;
  private busy = false;
  private replayReady = false;
  private exact: ServiceRequestCreateInput | null = null;
  private resource: string;
  constructor(private readonly api: ServiceComposerApi, private readonly scope: string,
    private readonly providerId: number, private readonly isCurrent = () => true,
    private readonly storage: IntentStorage = openIntentStorage()) {
    this.resource = String(providerId);
    this.snapshot = initial(storage.durable);
  }
  getSnapshot = (): ServiceComposerSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private live(epoch = this.epoch): boolean { return this.active && this.isCurrent() && epoch === this.epoch; }
  private publish(patch: Partial<ServiceComposerSnapshot>): void {
    if (!this.live()) return;
    const next = { ...this.snapshot, ...patch };
    this.snapshot = { ...next, intent: { ...next.intent, durable: this.storage.durable },
      canSubmit: !this.busy && !next.intent.reconciling && next.intent.record === null,
      canReplay: !this.busy && !next.intent.reconciling && !!next.intent.record && !!this.exact && this.replayReady };
    for (const listener of this.listeners) listener();
  }
  private setIntent(patch: Partial<MutationIntentSnapshot>): void {
    this.publish({ intent: { ...this.snapshot.intent, ...patch } });
  }
  start = (): void => {
    if (this.active || !this.isCurrent() || this.scope === "anonymous" || !validServiceRequestId(this.providerId)) return;
    this.active = true; this.epoch += 1;
    this.storage.sweepForeignScopes(this.scope);
    const record = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (record && isIntentExpired(record)) {
      this.storage.clear(this.scope, WORKFLOW, this.resource, record.key);
      this.setIntent({ phase: "expired", record: null });
    } else if (record) {
      this.setIntent({ phase: "unknown", record, unknownReason: "dispatch_unknown" });
      void this.reconcile();
    } else this.publish({});
  };
  dispose = (): void => {
    this.active = false; this.epoch += 1; this.lookupSequence += 1;
    this.exact = null; this.busy = false; this.replayReady = false;
    this.snapshot = initial(this.storage.durable);
  };
  private confirm(requestId: number, key: string): void {
    if (this.snapshot.intent.record?.key !== key) return;
    this.lookupSequence += 1;
    this.storage.clear(this.scope, WORKFLOW, this.resource, key);
    this.exact = null; this.replayReady = false;
    this.publish({ command: { phase: "accepted", message: "Request recorded. It is not an appointment or a delivery receipt." },
      intent: { ...this.snapshot.intent, record: null, phase: "confirmed", requestId, unknownReason: null, reconciling: false } });
  }
  create = async (input: ServiceRequestCreateInput): Promise<boolean> => {
    if (!this.live() || !this.snapshot.canSubmit || this.busy) return false;
    // Re-read before minting: another mounted composer/tab may already own this slot.
    const existing = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (existing) {
      this.setIntent({ phase: "unknown", record: existing, unknownReason: "dispatch_unknown" });
      return false;
    }
    const payload = { ...input, note: input.note?.trim(), city: input.city?.trim() ?? null };
    if (payload.provider_person_id !== this.providerId || !isServiceCategoryId(payload.category)
      || typeof payload.note !== "string" || payload.note.length < 10 || payload.note.length > 500
      || typeof payload.share_contact !== "boolean" || (payload.city?.length ?? 0) > 120
      || (payload.horse_id != null && !validServiceRequestId(payload.horse_id))
      || payload.provider_organization_id != null
      || (payload.province_code && (!isValidProvinceCode(payload.province_code) || payload.province_code_scheme !== PROVINCE_CODE_SCHEME))) {
      this.publish({ command: classifyCommandError(new PlatformClientError(400, "invalid_service_request", "Review the provider, category, province and a note of 10–500 characters.")) });
      return false;
    }
    const now = new Date().toISOString();
    const record: MutationIntentRecord = { key: crypto.randomUUID(), scope: this.scope, workflow: WORKFLOW,
      resource: this.resource, phase: "submitted", createdAt: now, updatedAt: now,
      summary: { workflow: WORKFLOW, provider_person_id: this.providerId, category: payload.category,
        share_contact: payload.share_contact, note_length: payload.note.length } };
    this.exact = Object.freeze(payload);
    this.storage.save(record);
    this.setIntent({ record, phase: "submitted", requestId: null, unknownReason: null });
    return this.dispatch(record);
  };
  private async dispatch(record: MutationIntentRecord): Promise<boolean> {
    if (!this.live() || this.busy || !this.exact) return false;
    const epoch = this.epoch, payload = this.exact, wasUncertain = this.snapshot.intent.phase === "unknown";
    this.busy = true; this.replayReady = false; this.lookupSequence += 1;
    this.publish({ command: { phase: "submitting" }, intent: { ...this.snapshot.intent, phase: "submitted", reconciling: false } });
    let accepted = false;
    try {
      const result = await this.api.create(payload, { idempotencyKey: record.key });
      if (!this.live(epoch) || this.snapshot.intent.record?.key !== record.key) return false;
      if (result?.created !== true || !validServiceRequestId(result.request?.id)
        || result.request.provider_person_id !== payload.provider_person_id || result.request.category !== payload.category
        || result.request.share_contact !== payload.share_contact || typeof result.request_digest !== "string" || !result.request_digest) {
        throw new Error("The server response did not confirm this request. Recheck the exact request key.");
      }
      this.confirm(result.request.id, record.key); accepted = true;
    } catch (error) {
      if (!this.live(epoch) || this.snapshot.intent.record?.key !== record.key) return false;
      const command = classifyCommandError(error);
      if (!wasUncertain && command.phase === "rejected" && command.status !== 409) {
        this.storage.clear(this.scope, WORKFLOW, this.resource, record.key);
        this.exact = null;
        this.publish({ command, intent: { ...this.snapshot.intent, record: null, phase: "idle", unknownReason: null } });
      } else this.publish({ command, intent: { ...this.snapshot.intent, phase: "unknown", unknownReason: "dispatch_unknown" } });
    } finally {
      if (this.live(epoch)) { this.busy = false; this.publish({}); }
    }
    return accepted && this.live(epoch);
  }
  reconcile = async (): Promise<void> => {
    const record = this.snapshot.intent.record;
    if (!this.live() || this.busy || !record) return;
    const epoch = this.epoch, sequence = ++this.lookupSequence;
    this.replayReady = false;
    this.setIntent({ reconciling: true });
    const current = () => this.live(epoch) && sequence === this.lookupSequence && this.snapshot.intent.record?.key === record.key;
    try {
      const answer = await this.api.reconcileIntent(record.key);
      if (!current()) return;
      if (answer?.state === "confirmed" && validServiceRequestId(answer.request_id)) {
        this.confirm(answer.request_id, record.key);
      } else if (answer?.state === "unknown") {
        // A no-receipt answer is not proof of non-delivery. Reuse the SAME key
        // only with this tab's exact payload, and only on an explicit action.
        this.replayReady = !!this.exact;
        this.setIntent({ phase: "unknown", unknownReason: "no_receipt_on_server", reconciling: false });
      } else {
        this.setIntent({ phase: "unknown", unknownReason: answer?.state === "unresolved" ? "legacy_receipt_unresolved" : "invalid_receipt", reconciling: false });
      }
    } catch {
      if (current()) this.setIntent({ phase: "unknown", unknownReason: "reconcile_failed", reconciling: false });
    }
  };
  retryExact = async (): Promise<boolean> => {
    const record = this.snapshot.intent.record;
    if (!this.live() || !this.snapshot.canReplay || !record) return false;
    // A different tab's newer record must never be cleared or replayed here.
    const stored = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (stored && stored.key !== record.key) {
      this.exact = null; this.replayReady = false;
      this.setIntent({ record: stored, phase: "unknown", unknownReason: "dispatch_unknown" });
      return false;
    }
    return this.dispatch(record);
  };
  /** UI must first explain that discarding local recovery does not cancel a request. */
  discard = (): boolean => {
    if (!this.live() || this.busy || this.snapshot.intent.reconciling) return false;
    const key = this.snapshot.intent.record?.key;
    const stored = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (stored && stored.key !== key) {
      this.exact = null; this.replayReady = false;
      this.setIntent({ record: stored, phase: "unknown", unknownReason: "dispatch_unknown" });
      return false;
    }
    if (key) this.storage.clear(this.scope, WORKFLOW, this.resource, key);
    this.lookupSequence += 1; this.exact = null; this.replayReady = false;
    this.publish({ command: { phase: "idle" }, intent: { ...initial(this.storage.durable).intent } });
    return true;
  };
}
