import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PlatformClient } from "../contracts/platform";
import { ServiceRequestWorkbench } from "./domain/serviceWorkbench";

/** Browser/React lifetime adapter. The domain store itself has no browser globals. */
export function useServiceRequestWorkbench(platform: PlatformClient, principalScope: string, enabled = true) {
  const identity = useMemo(() => ({}), [platform, principalScope, enabled]);
  const current = useRef(identity); current.current = identity;
  const store = useMemo(() => new ServiceRequestWorkbench(platform.modules.serviceRequests,
    () => enabled && current.current === identity), [platform, identity, enabled]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    store.start();
    const refresh = () => { if (document.visibilityState === "visible") void store.reload(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      store.dispose();
    };
  }, [store, enabled]);
  return { store, snapshot };
}
