import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { principalScopeKey, type PrincipalScopeUser } from "./principalIdentity";
export { principalScopeKey } from "./principalIdentity";
export type { PrincipalScopeUser } from "./principalIdentity";

/**
 * R107 NEXT-05 (master-AI R106 BACKLOG): principal-aware frontend resource
 * invalidation — the shared helpers every skin consumes.
 *
 *  - `principalScopeKey` / `usePrincipalScope` produce a STABLE string that
 *    identifies "who is looking" (user identity + the permission epoch of
 *    this session). Private loaders put this string in their dependency
 *    arrays / domain identities, so switching account A to account B — even
 *    when both hold the SAME permissions — always re-keys the resource and
 *    the old principal's snapshot can never render under the new one.
 *    Revocations change the permission epoch and re-key the same way.
 *    Nothing serializes an arbitrary object as a security key.
 *
 *  - `useScopedState` is the render-time mask for direct-effect pages
 *    (governance consoles, admin newsrooms, desks) that keep loaded private
 *    data in useState: the stored snapshot carries its scope, and during
 *    render — BEFORE any effect runs — a scope mismatch masks the stored
 *    value with the initial one. A committed effect then resets the store,
 *    so returning to an earlier scope can never resurrect its stale cache.
 */

/** Memoized hook form: the STRING is stable across renders with equal content,
 * so it is safe (and intended) as a dependency-array entry. */
export function usePrincipalScope(
  user: PrincipalScopeUser | null | undefined,
  permissions?: readonly string[] | null,
): string {
  const sorted = permissions ? [...permissions].slice().sort().join("+") : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(() => principalScopeKey(user, sorted ? sorted.split("+") : null), [user?.id, sorted])();
}

/**
 * Principal-scoped state with a render-time mask.
 *
 * `scope` is any stable identity string (typically `usePrincipalScope(...)`).
 * While `scope` matches the stored snapshot the stored value is returned;
 * the moment it differs — during RENDER, before effects — the INITIAL value
 * is returned instead, so a private snapshot of the previous principal never
 * paints under the new one. An effect commits the reset, which also prevents
 * a later return to the old scope from resurrecting its stale cache (the
 * data may have been revoked or re-consented in between; it must re-load).
 *
 * `initial` may be a value or a factory (factories are re-evaluated only when
 * the scope actually changes, never on every render).
 */
export function useScopedState<T>(scope: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  // A new object also distinguishes A -> B -> A. A scope string alone lets
  // an old A callback overwrite a freshly loaded A session after returning.
  const identity = useMemo(() => {
    const seed = initialRef.current;
    return { scope, initial: typeof seed === "function" ? (seed as () => T)() : seed };
  }, [scope]);
  const current = useRef(identity);
  current.current = identity;
  const [stored, setStored] = useState(() => ({ identity, value: identity.initial }));

  useEffect(() => {
    setStored(previous => previous.identity === identity ? previous : { identity, value: identity.initial });
  }, [identity]);

  const set = useCallback((update: SetStateAction<T>) => {
    if (current.current !== identity) return;
    setStored(previous => {
      // Re-check when React actually applies the queued update. Do not even
      // invoke a stale functional updater: it may contain obsolete follow-ups.
      if (current.current !== identity) return previous;
      const base = previous.identity === identity ? previous.value : identity.initial;
      const value = typeof update === "function" ? (update as (prior: T) => T)(base) : update;
      return { identity, value };
    });
  }, [identity]);

  return [stored.identity === identity ? stored.value : identity.initial, set];
}
