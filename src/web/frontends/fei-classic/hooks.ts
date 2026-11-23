import { useLatestAsyncValue, usePrincipalScope, useScopedState, type AsyncValueState } from "../../../frontend-kit";

export type LoadState<T> = AsyncValueState<T>;
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], enabled = true): LoadState<T> {
  return useLatestAsyncValue(load, deps, enabled);
}

// R107 NEXT-05: private loaders must key on the principal (identity +
// permission epoch) so account switches and revocations re-key the resource.
export { usePrincipalScope, useScopedState };
