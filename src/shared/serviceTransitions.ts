/** Canonical, renderer- and database-independent service lead state graph. */
export const SERVICE_STATES = ["new", "acknowledged", "discussing", "closed", "withdrawn", "spam"] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export const SERVICE_ACTORS = ["requester", "provider", "moderator"] as const;
export type ServiceActor = (typeof SERVICE_ACTORS)[number];

export const SERVICE_TERMINAL_STATES: readonly ServiceState[] = ["closed", "withdrawn", "spam"];

/**
 * The single role-aware transition graph. Every state x actor cell is
 * explicit — this table IS the state machine.
 *
 *  - requester: may close or withdraw their own lead at any live state.
 *  - provider: may acknowledge (first response), move to discussing, close
 *    or mark spam. The provider can never withdraw someone else's lead.
 *  - moderator: NO transitions, by design and after review (N14). The
 *    moderation lifecycle's authority lives in the moderation case workflow
 *    (src/moderation), never in this machine: an unlinked editor or
 *    organization member gets 404 on another person's lead, re-checked live.
 */
export const SERVICE_TRANSITION_MATRIX: Readonly<Record<ServiceState, Readonly<Record<ServiceActor, readonly ServiceState[]>>>> = {
  new: {
    requester: ["closed", "withdrawn"],
    provider: ["acknowledged", "closed", "spam"],
    moderator: [],
  },
  acknowledged: {
    requester: ["closed", "withdrawn"],
    provider: ["discussing", "closed", "spam"],
    moderator: [],
  },
  discussing: {
    requester: ["closed", "withdrawn"],
    provider: ["closed", "spam"],
    moderator: [],
  },
  closed: { requester: [], provider: [], moderator: [] },
  withdrawn: { requester: [], provider: [], moderator: [] },
  spam: { requester: [], provider: [], moderator: [] },
};

/** The ONE permission decision used by both the route and the command. */
export function serviceTransitionAllowed(from: string, to: string, actor: ServiceActor): boolean {
  const state = SERVICE_TRANSITION_MATRIX[from as ServiceState];
  if (!state) return false;
  return (state[actor] ?? []).includes(to as ServiceState);
}

/** States the given actor may move a request in `from` to (matrix-derived). */
export function serviceTransitionsFor(from: string, actor: ServiceActor): readonly ServiceState[] {
  const state = SERVICE_TRANSITION_MATRIX[from as ServiceState];
  return state ? [...state[actor]] : [];
}

/** Actors whose matrix row permits `from` -> `to` (for honest refusals). */
export function serviceActorsPermitting(from: string, to: string): readonly ServiceActor[] {
  return SERVICE_ACTORS.filter((actor) => serviceTransitionAllowed(from, to, actor));
}

/**
 * Route metadata DERIVED from the matrix — replaces the old hand-written
 * table with its broad "by: anyone" claim. `to` is the union across actors;
 * `by` lists exactly the actors that may move the request somewhere.
 */
export interface ServiceRouteTransitions {
  to: readonly ServiceState[];
  by: readonly ServiceActor[];
}

export function serviceRouteTransitions(): Readonly<Record<ServiceState, ServiceRouteTransitions>> {
  const out = {} as Record<ServiceState, ServiceRouteTransitions>;
  for (const state of SERVICE_STATES) {
    const by = SERVICE_ACTORS.filter((actor) => SERVICE_TRANSITION_MATRIX[state][actor].length > 0);
    const to = [...new Set(SERVICE_ACTORS.flatMap((actor) => SERVICE_TRANSITION_MATRIX[state][actor]))];
    out[state] = { to, by };
  }
  return out;
}

