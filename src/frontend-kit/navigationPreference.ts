import type { NavigationLayout } from "./navigation";
export type NavigationPreference = NavigationLayout | "auto" | "both";
/**
 * 15.5rem rail + at least 56rem research workspace + gutters.
 * rem-based media queries respond to text scaling; short landscape keeps tabs.
 * A manually chosen layout is never overwritten by viewport changes.
 */
export const AUTO_SIDEBAR_QUERY = "(min-width: 78rem) and (min-height: 30rem)";
export function parseNavigationPreference(value: unknown, fallback: NavigationPreference): NavigationPreference {
  return value === "auto" || value === "tabs" || value === "sidebar" || value === "both" ? value : fallback;
}
export function resolveNavigationLayout(preference: NavigationPreference, hasRoom: boolean): NavigationLayout {
  return preference === "auto" || preference === "both" ? (hasRoom ? "sidebar" : "tabs") : preference;
}
/**
 * R124: derived chrome booleans — which navigation surfaces actually render.
 * The legacy single `layout` value stays authoritative for every other skin;
 * the Core additionally consumes these booleans so "both" can render the
 * sidebar rail AND the top tab row at the same time.
 *   sidebar — an explicit sidebar always shows; auto/both only with room.
 *   tabs    — an explicit tabs bar always shows; both keeps its tab row on
 *             every viewport (the sidebar hides itself when there is no room);
 *             auto falls back to a tab row when there is no room.
 */
export interface NavigationChrome {
  sidebar: boolean;
  tabs: boolean;
}
export function resolveNavigationChrome(preference: NavigationPreference, hasRoom: boolean): NavigationChrome {
  const sidebar = preference === "sidebar" || ((preference === "auto" || preference === "both") && hasRoom);
  const tabs = preference === "tabs" || preference === "both" || (preference === "auto" && !hasRoom);
  return { sidebar, tabs };
}
