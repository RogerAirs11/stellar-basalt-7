import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PlatformClient } from "../../contracts/platform";
import { ServiceRequestComposer } from "./serviceComposer";

export function useServiceRequestComposer(platform: PlatformClient, principalScope: string, providerId: number, enabled = true) {
  const identity = useMemo(() => ({}), [platform, principalScope, providerId, enabled]);
  const current = useRef(identity); current.current = identity;
  const store = useMemo(() => new ServiceRequestComposer(platform.modules.serviceRequests, principalScope, providerId,
    () => enabled && current.current === identity), [platform, principalScope, providerId, identity, enabled]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { if (enabled) store.start(); return () => store.dispose(); }, [store, enabled]);
  return { store, snapshot };
}
