import { useCallback, useEffect, useRef, useState } from "react";
import { DomainResourceController, domainLoadKey } from "./domainLoader";
import type { ResourceState } from "./resourceState";

/** Private identities MUST include the current principal, not just "mine".
 * No hidden cache. Retry retains same-identity data as visibly stale;
 * identity changes mask old data before effects run. Disabled loads do not
 * call private endpoints, and dispose any earlier in-flight request. */
export function useDomainResource<T>(
  domain: string,
  identity: string | number,
  load: (signal: AbortSignal) => Promise<T>,
  options?: { isEmpty?: (data: T) => boolean; enabled?: boolean },
): { state: ResourceState<T>; retry: () => void } {
  const [snapshot, setSnapshot] = useState<{ key: string | null; state: ResourceState<T> }>({ key: null, state: { phase: "idle" } });
  const loadRef = useRef(load); loadRef.current = load;
  const isEmptyRef = useRef(options?.isEmpty); isEmptyRef.current = options?.isEmpty;
  const current = useRef<DomainResourceController<T> | null>(null);
  const enabled = options?.enabled !== false;
  useEffect(() => {
    if (!enabled) { setSnapshot({ key: null, state: { phase: "idle" } }); return; }
    const controller = new DomainResourceController<T>();
    current.current = controller;
    const unsubscribe = controller.subscribe(() => setSnapshot(controller.getSnapshot()));
    controller.load({ domain, identity, load: (signal) => loadRef.current(signal),
      isEmpty: (data) => isEmptyRef.current?.(data) ?? false });
    return () => {
      if (current.current === controller) current.current = null;
      unsubscribe(); controller.dispose();
    };
  }, [domain, identity, enabled]);
  const retry = useCallback(() => current.current?.retry(), []);
  const state: ResourceState<T> = !enabled ? { phase: "idle" }
    : snapshot.key === domainLoadKey(domain, identity) ? snapshot.state : { phase: "loading" };
  return { state, retry };
}
