import { useCallback, useEffect, useMemo, useState } from "react";

import { useLatestAsyncValue, usePrincipalScope, useScopedState, type AsyncValueState } from "../../../frontend-kit";

export type AsyncState<T> = AsyncValueState<T>;
export function useAsyncValue<T>(loader: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  return useLatestAsyncValue(loader, deps);
}

// R107 NEXT-05: private loaders must key on the principal (identity +
// permission epoch) so account switches and revocations re-key the resource.
export { usePrincipalScope, useScopedState };

const FAVORITES_KEY = "equidata-elite-watchlist-v1";

function readFavorites(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
  } catch { return []; }
}

export function useFavorites() {
  const [ids, setIds] = useState<number[]>(() => typeof localStorage === "undefined" ? [] : readFavorites());
  useEffect(() => { try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)); } catch {} }, [ids]);
  const set = useMemo(() => new Set(ids), [ids]);
  const toggle = useCallback((id: number) => setIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]), []);
  return { ids, count: ids.length, has: (id: number) => set.has(id), toggle, clear: () => setIds([]) };
}
