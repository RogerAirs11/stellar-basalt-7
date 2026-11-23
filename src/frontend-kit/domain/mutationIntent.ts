import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * R108-05 — durable, privacy-scoped uncertain-write intent recovery.
 *
 * The ONE headless protocol every skin reuses (no presentation copied):
 * when a write command's outcome becomes uncertain (timeout, network loss,
 * reload mid-flight), the intent survives in DEVICE storage so the client
 * can RECONCILE the exact command key with the server before allowing a new
 * intent — and never fabricates success.
 *
 * Privacy discipline (pinned by tests):
 *  - Only MINIMUM NON-SENSITIVE metadata is persisted: the command key, the
 *    workflow/resource identity and a coarse summary (category, share flag,
 *    note LENGTH). The raw private payload (the note text, contact values)
 *    is NEVER written to storage.
 *  - Records are namespaced by principal scope; every load sweeps records
 *    belonging to OTHER principals (cross-account deletion on account
 *    switch) and an anonymous/logout load clears them ALL.
 *  - Storage denial (private mode, quota, disabled localStorage) degrades to
 *    an in-memory session store with an honest durable:false — success is
 *    never claimed for a record that would not survive a reload.
 *  - Records expire (TTL) — an expired intent is surfaced once and cleared;
 *    a fresh explicit intent always mints a NEW key.
 *
 * Intent states (the reviewed vocabulary):
 *  - pending: key minted, the command is about to fly (this tab).
 *  - submitted: the command flew; the outcome is uncertain — the record is
 *    persisted so a reload can reconcile it.
 *  - confirmed: reconciliation (or the response itself) proved the write
 *    landed; the record is cleared and the receipt id kept for the notice.
 *  - unknown: reconciliation could not establish certainty (transport
 *    failure, or the server has no receipt yet). The user may recheck or
 *    discard; nothing is auto-concluded.
 *  - expired: the record outlived its TTL; it is cleared and a fresh intent
 *    (new key) is required.
 */

export { MUTATION_INTENT_TTL_MS, MUTATION_INTENT_PREFIX, openIntentStorage, isIntentExpired } from "./mutationIntentStorage";
export type { MutationIntentSummary, MutationIntentRecord, MutationIntentPhase, MutationIntentSnapshot, IntentStorage } from "./mutationIntentStorage";
import { openIntentStorage, isIntentExpired, type MutationIntentSummary, type MutationIntentRecord, type MutationIntentSnapshot } from "./mutationIntentStorage";
import { useScopedState } from "./principalScope";

/** The reconciliation lookup the hook asks the server to perform. */
export interface IntentReconciliationLookup {
  (key: string): Promise<{ state: "confirmed" | "unresolved" | "unknown"; request_id?: number }>;
}

/**
 * The headless intent controller. `scope` MUST be the caller's principal
 * scope (usePrincipalScope) — records are namespaced by it and foreign
 * records are swept on every mount. `reconcile` is the actor-scoped server
 * lookup (platform.modules.serviceRequests.reconcileIntent); it is only
 * invoked for records that belong to the CURRENT scope.
 */
export function useMutationIntent(
  workflow: string,
  scope: string,
  resource: string | number,
  reconcile: IntentReconciliationLookup | null,
): {
  snapshot: MutationIntentSnapshot;
  begin: (summary: MutationIntentSummary) => string;
  markSubmitted: (expectedKey?: string) => void;
  confirmResult: (requestId: number | null, expectedKey: string) => boolean;
  reconcileNow: () => Promise<void>;
  discard: () => void;
} {
  const resourceKey = String(resource);
  const storage = useMemo(openIntentStorage, []);
  const identity = useMemo(() => ({ scope, workflow, resourceKey }), [scope, workflow, resourceKey]);
  const current = useRef(identity);
  current.current = identity;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [snapshot, setSnapshot] = useScopedState<MutationIntentSnapshot>(JSON.stringify([scope, workflow, resourceKey]), {
    phase: "idle", durable: storage.durable, record: null, requestId: null, unknownReason: null, reconciling: false,
  });
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;
  const recordRef = useRef<MutationIntentRecord | null>(null);
  const reconciliationEpoch = useRef(0);

  const applyRecord = useCallback((next: Partial<MutationIntentSnapshot> & { record?: MutationIntentRecord | null }) => {
    if (!mounted.current || current.current !== identity) return;
    recordRef.current = next.record ?? null;
    setSnapshot((prior) => ({ ...prior, record: next.record ?? null, ...next, durable: storage.durable }));
  }, [identity, storage, setSnapshot]);

  const reconcileNow = useCallback(async (): Promise<void> => {
    if (!mounted.current || current.current !== identity) return;
    const record = recordRef.current;
    if (record === null || record.scope !== scope) return;
    const epoch = ++reconciliationEpoch.current;
    const stillCurrent = () => mounted.current && current.current === identity && recordRef.current?.key === record.key && reconciliationEpoch.current === epoch;
    const lookup = reconcileRef.current;
    if (lookup === null) {
      applyRecord({ record, phase: "unknown", unknownReason: "reconcile_unavailable" });
      return;
    }
    setSnapshot((prior) => ({ ...prior, reconciling: true }));
    let settled = false;
    try {
      const answer = await lookup(record.key);
      if (!stillCurrent()) return;
      settled = true;
      if (answer.state === "confirmed" && typeof answer.request_id === "number" && Number.isSafeInteger(answer.request_id) && answer.request_id > 0) {
        storage.clear(scope, workflow, resourceKey, record.key);
        applyRecord({ record: null, phase: "confirmed", requestId: answer.request_id ?? null, unknownReason: null, reconciling: false });
        return;
      }
      if (answer.state === "unresolved") {
        // A legacy receipt exists: do NOT retry the key. Keep the record so
        // the honest notice stays until the user discards it.
        applyRecord({ record, phase: "unknown", unknownReason: "legacy_receipt_unresolved", reconciling: false });
        return;
      }
      // No receipt on the server: the write never landed (or is in flight in
      // another tab). Keep the record — the user rechecks or discards; the
      // client never concludes "delivered" on its own.
      applyRecord({ record, phase: "unknown", unknownReason: "no_receipt_on_server", reconciling: false });
    } catch {
      if (!stillCurrent() || settled) return;
      applyRecord({ record, phase: "unknown", unknownReason: "reconcile_failed", reconciling: false });
    }
  }, [identity, scope, workflow, resourceKey, storage, applyRecord, setSnapshot]);

  useEffect(() => {
    if (!mounted.current || current.current !== identity) return;
    // Cross-account deletion on every mount: another principal's (or a
    // logged-out session's) pending intents must not survive into this one.
    storage.sweepForeignScopes(scope);
    const stored = storage.load(scope, workflow, resourceKey);
    if (stored === null) {
      applyRecord({ record: null, phase: "idle", requestId: null, unknownReason: null });
      return;
    }
    if (isIntentExpired(stored)) {
      storage.clear(scope, workflow, resourceKey, stored.key);
      applyRecord({ record: null, phase: "expired", requestId: null, unknownReason: null });
      return;
    }
    recordRef.current = stored;
    setSnapshot({ phase: stored.phase, durable: storage.durable, record: stored, requestId: null, unknownReason: null, reconciling: false });
    if (stored.phase === "submitted") void reconcileNow();
    // A pending record (minted, but dispatch completion is unknown — e.g. a crash between begin
    // and the transport call) is surfaced as unknown: the user rechecks or
    // discards before a new intent is allowed.
    if (stored.phase === "pending") applyRecord({ record: stored, phase: "unknown", unknownReason: "dispatch_unknown" });
  }, [identity, scope, workflow, resourceKey, storage, applyRecord, reconcileNow]);

  const begin = useCallback((summary: MutationIntentSummary): string => {
    if (!mounted.current || current.current !== identity) throw new Error("Intent scope has changed");
    // A second mounted controller/tab may already have published this slot.
    // Reuse that durable key before minting another. localStorage is not a CAS:
    // simultaneous cross-tab creation still requires server idempotency.
    const pending = recordRef.current ?? storage.load(scope, workflow, resourceKey);
    // Double submits before React paints a disabled button reuse the original
    // key. A different payload will conflict server-side, never create a second lead.
    if (pending?.scope === scope && pending.workflow === workflow && pending.resource === resourceKey) {
      applyRecord({ record: pending, phase: "unknown", unknownReason: "dispatch_unknown" });
      return pending.key;
    }
    reconciliationEpoch.current++;
    const key = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: MutationIntentRecord = {
      key, scope, workflow, resource: resourceKey, summary,
      phase: "pending", createdAt: now, updatedAt: now,
    };
    storage.save(record);
    applyRecord({ record, phase: "pending", requestId: null, unknownReason: null });
    return key;
  }, [identity, scope, workflow, resourceKey, storage, applyRecord]);

  const markSubmitted = useCallback((expectedKey?: string) => {
    if (!mounted.current || current.current !== identity) return;
    const record = recordRef.current;
    if (record === null || record.scope !== scope || (expectedKey !== undefined && record.key !== expectedKey)) return;
    const next: MutationIntentRecord = { ...record, phase: "submitted", updatedAt: new Date().toISOString() };
    storage.save(next);
    applyRecord({ record: next, phase: "submitted" });
  }, [identity, scope, storage, applyRecord]);

  const confirmResult = useCallback((requestId: number | null, expectedKey: string): boolean => {
    if (!mounted.current || current.current !== identity || recordRef.current?.key !== expectedKey) return false;
    if (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId <= 0) {
      applyRecord({ record: recordRef.current, phase: "unknown", unknownReason: "invalid_receipt", reconciling: false });
      return false;
    }
    reconciliationEpoch.current++;
    storage.clear(scope, workflow, resourceKey, expectedKey);
    applyRecord({ record: null, phase: "confirmed", requestId, unknownReason: null, reconciling: false });
    return true;
  }, [identity, scope, workflow, resourceKey, storage, applyRecord]);

  const discard = useCallback(() => {
    if (!mounted.current || current.current !== identity) return;
    reconciliationEpoch.current++;
    storage.clear(scope, workflow, resourceKey, recordRef.current?.key);
    applyRecord({ record: null, phase: "idle", requestId: null, unknownReason: null, reconciling: false });
  }, [identity, scope, workflow, resourceKey, storage, applyRecord]);

  return { snapshot, begin, markSubmitted, confirmResult, reconcileNow, discard };
}
