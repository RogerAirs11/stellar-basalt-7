export type HorseDbRoute =
  | { kind: "home" }
  | { kind: "browse" }
  | { kind: "stats" }
  | { kind: "horse"; id: number }
  | { kind: "person"; id: number }
  | { kind: "unknown"; path: string };

export interface FrontendLocalRoute {
  frontendId: string;
  path: string;
}

export const horseDbRoutes = Object.freeze({
  home: () => "/",
  browse: () => "/browse",
  stats: () => "/stats",
  horse: (id: number) => `/horse/${positiveId(id)}`,
  person: (id: number) => `/person/${positiveId(id)}`,
  /** Shareable route owned by one frontend, without colliding with canonical entity routes. */
  frontend: (frontendId: string, localPath = "/") => {
    const id = frontendSlug(frontendId);
    const path = normalizeLocalPath(localPath);
    return path === "/" ? `/f/${id}` : `/f/${id}${path}`;
  },
});

export function parseHorseDbRoute(path: string): HorseDbRoute {
  const pathname = normalizePath(path);
  if (pathname === "/") return { kind: "home" };
  if (pathname === "/browse" || pathname.startsWith("/browse/")) return { kind: "browse" };
  if (pathname === "/stats" || pathname.startsWith("/stats/")) return { kind: "stats" };
  const horse = pathname.match(/^\/horse\/(\d+)$/);
  if (horse && isRegistryId(Number(horse[1]))) return { kind: "horse", id: Number(horse[1]) };
  const person = pathname.match(/^\/person\/(\d+)$/);
  if (person && isRegistryId(Number(person[1]))) return { kind: "person", id: Number(person[1]) };
  return { kind: "unknown", path: pathname };
}

export function parseFrontendLocalRoute(path: string): FrontendLocalRoute | null {
  const pathname = normalizePath(path);
  const match = pathname.match(/^\/f\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/.*)?$/);
  if (!match) return null;
  return { frontendId: match[1]!, path: match[2] || "/" };
}

export function isCanonicalHorseDbRoute(path: string): boolean {
  return parseHorseDbRoute(path).kind !== "unknown";
}

function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] || "/";
  if (pathname.length > 1) return pathname.replace(/\/+$/, "") || "/";
  return pathname;
}

function normalizeLocalPath(path: string): string {
  const clean = normalizePath(path.startsWith("/") ? path : `/${path}`);
  if (clean.includes("..")) throw new Error("Frontend-local route must not contain '..'");
  return clean;
}

function positiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Expected a positive registry id");
  return value;
}

function frontendSlug(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("Expected a lowercase kebab-case frontend id");
  return value;
}

/** Reject missing, zero, negative and precision-losing entity IDs at route boundaries. */
export function isRegistryId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * R108-06: the ONE safe route-id parser for every skin entry. Accepts only a
 * digits-only segment that is a positive safe integer. Everything else —
 * empty, "0", signs, fractions, unsafe overflow, trailing junk, undefined —
 * returns null, meaning "invalid route": the caller renders a localized
 * invalid/not-found view and MUST NOT issue an SDK call with the raw value.
 * (An anchored \d+ regex already excludes fractions/signs/suffixes; this
 * parser additionally rejects "0" and precision-losing overflow, and gives
 * every entry one shared boundary instead of per-file Number() coercion.)
 */
export function parseRouteId(raw: string | undefined | null): number | null {
  if (raw == null || raw === "" || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return isRegistryId(value) ? value : null;
}

/** Malformed percent escapes are a not-found route, never an application crash. */
export function safeDecodeRouteSegment(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}
