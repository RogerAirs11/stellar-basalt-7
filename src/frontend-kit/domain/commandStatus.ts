import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandFlight, type CommandState } from "./commandModel";
export { classifyCommandError, idempotentReplayOf, idleCommand } from "./commandModel";
export type { CommandState } from "./commandModel";

/** Shared command semantics only. Pass the principal/resource scope for private
 * commands. Scope changes mask feedback during render and reject stale event
 * handlers; they do NOT cancel, reverse or retry an already submitted write.
 * Idempotency keys and expected versions remain the domain's responsibility. */
export function usePlatformCommand(scope = "unscoped"): {
  state: CommandState;
  run: (execute: () => Promise<unknown>, options?: { successMessage?: string }) => Promise<boolean>;
  reset: () => void;
} {
  const identity = useMemo(() => ({}), [scope]);
  const current = useRef(identity);
  current.current = identity;
  const flight = useMemo(() => new CommandFlight(), [identity]);
  const [snapshot, setSnapshot] = useState<{ identity: object; state: CommandState }>(() => ({ identity, state: { phase: "idle" } }));
  const epoch = useRef(0);
  const alive = useRef(true);
  const run = useCallback(async (execute: () => Promise<unknown>, options?: { successMessage?: string }) => {
    if (!alive.current || current.current !== identity) return false;
    const generation = epoch.current;
    const accepted = await flight.execute(execute, next => {
      if (alive.current && epoch.current === generation && current.current === identity) setSnapshot({ identity, state: next });
    }, options?.successMessage);
    // Suppress the caller's success follow-up after unmount/account change too.
    return accepted && alive.current && epoch.current === generation && current.current === identity;
  }, [identity, flight]);
  const reset = useCallback(() => {
    if (alive.current && current.current === identity && !flight.busy) setSnapshot({ identity, state: { phase: "idle" } });
  }, [identity, flight]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current += 1; };
  }, []);
  return { state: snapshot.identity === identity ? snapshot.state : { phase: "idle" }, run, reset };
}
