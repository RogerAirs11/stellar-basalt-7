import { useEffect, useMemo, useState } from "react";

export type AsyncValueState<T> = {
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  error: string | null;
};

/** Headless legacy-hook bridge. Never render A's data under B's dependency identity.
 * Private callers must include the principal and relevant permission epoch in deps.
 * No retained data or client cache crosses a dependency change. */
export function useLatestAsyncValue<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
): AsyncValueState<T> {
  // Dependency identity is available DURING render, before effect cleanup/setup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => ({}), [enabled, ...deps]);
  const [snapshot, setSnapshot] = useState<{ key: object; state: AsyncValueState<T> }>(() => ({
    key, state: { status: enabled ? "loading" : "idle", data: null, error: null },
  }));

  useEffect(() => {
    if (!enabled) {
      setSnapshot({ key, state: { status: "idle", data: null, error: null } });
      return;
    }
    const controller = new AbortController();
    setSnapshot({ key, state: { status: "loading", data: null, error: null } });
    const failed = (reason: unknown) => {
      if (!controller.signal.aborted) setSnapshot({ key, state: {
        status: "error", data: null, error: reason instanceof Error ? reason.message : String(reason),
      } });
    };
    try {
      void Promise.resolve(loader(controller.signal)).then(data => {
        if (!controller.signal.aborted) setSnapshot({ key, state: { status: "ready", data, error: null } });
      }, failed);
    } catch (reason) { failed(reason); }
    return () => controller.abort();
  }, [key, enabled]);

  if (!enabled) return { status: "idle", data: null, error: null };
  if (snapshot.key !== key || snapshot.state.status === "idle") return { status: "loading", data: null, error: null };
  return snapshot.state;
}
