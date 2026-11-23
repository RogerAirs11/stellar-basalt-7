export const ANALYTICS_VIEWS = {
  all: ["all"],
  overview: ["all", "snapshot", "intelligence"],
  pedigree: ["all", "coverage", "influence"],
  breeding: ["all", "distribution", "leaders"],
  population: ["all", "demography", "classification"],
  people: ["all", "summary", "rankings"],
  quality: ["all", "coverage", "findings", "era"],
} as const;
export type AnalyticsSection = keyof typeof ANALYTICS_VIEWS;
export function readAnalyticsLocation(search: string): { section: AnalyticsSection; view: string } {
  const query = new URLSearchParams(search);
  const requested = query.get("section") ?? "all";
  const section: AnalyticsSection = Object.hasOwn(ANALYTICS_VIEWS, requested) ? requested as AnalyticsSection : "all";
  const requestedView = query.get("view") ?? "all";
  return { section, view: (ANALYTICS_VIEWS[section] as readonly string[]).includes(requestedView) ? requestedView : "all" };
}
export function analyticsLocation(search: string, section: AnalyticsSection, view: string): string {
  const query = new URLSearchParams(search);
  query.delete("section"); query.delete("view");
  if (section !== "all") {
    query.set("section", section);
    query.set("view", (ANALYTICS_VIEWS[section] as readonly string[]).includes(view) ? view : "all");
  }
  const value = query.toString();
  return `/stats${value ? `?${value}` : ""}`;
}
