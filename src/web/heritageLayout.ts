import { useSyncExternalStore } from "react";

/**
 * R37 — real-time layout & spacing customization for the Heritage frontend.
 *
 * Six independent sliders (top margin, bottom margin, side gutter, container
 * gap, panel inset, content width) compile into CSS custom properties that the
 * heritage.layout.css layer consumes. Stock values are intentionally inert:
 * the override layer only activates while `data-layout-tuning="1"` is present,
 * which happens exclusively when the user moves a slider away from its
 * default. That keeps density mode, responsive breakpoints and every curated
 * page rhythm untouched until the user explicitly customizes the layout.
 */
export type HeritageLayoutSnapshot = {
  pageTop: number;
  pageBottom: number;
  sideGutter: number;
  sectionGap: number;
  panelInset: number;
  contentWidth: number;
};

export const HERITAGE_LAYOUT_LIMITS: Record<keyof HeritageLayoutSnapshot, [number, number, number]> = {
  pageTop: [0, 96, 1],
  pageBottom: [0, 160, 1],
  sideGutter: [8, 64, 1],
  sectionGap: [0, 56, 1],
  panelInset: [6, 40, 1],
  contentWidth: [960, 1720, 10],
};

/** Values mirror the curated stock CSS so "reset" returns to the exact shipped rhythm.
 *  R124: compacted per the owner's "too much margin and padding" review — the
 *  reading column also widened so ultrawide viewports stop letterboxing the
 *  workspace (the content column follows the viewport up to the 1720 cap). */
export const DEFAULT_HERITAGE_LAYOUT: HeritageLayoutSnapshot = {
  pageTop: 12,
  pageBottom: 24,
  sideGutter: 18,
  sectionGap: 10,
  panelInset: 12,
  contentWidth: 1440,
};

const STORAGE_KEY = "registry-heritage-layout-v1";
const listeners = new Set<() => void>();
let persistTimer: number | undefined;

const safeStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);

const clampValue = (key: keyof HeritageLayoutSnapshot, value: number): number => {
  const [min, max] = HERITAGE_LAYOUT_LIMITS[key];
  return Math.max(min, Math.min(max, value));
};

export function isDefaultHeritageLayout(value: HeritageLayoutSnapshot): boolean {
  return (Object.keys(DEFAULT_HERITAGE_LAYOUT) as (keyof HeritageLayoutSnapshot)[]).every(
    (key) => value[key] === DEFAULT_HERITAGE_LAYOUT[key],
  );
}

function clampLayout(input: Partial<Record<keyof HeritageLayoutSnapshot, unknown>>): HeritageLayoutSnapshot {
  const next = { ...DEFAULT_HERITAGE_LAYOUT };
  for (const key of Object.keys(DEFAULT_HERITAGE_LAYOUT) as (keyof HeritageLayoutSnapshot)[]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) next[key] = clampValue(key, value);
  }
  return next;
}

function loadSnapshot(): HeritageLayoutSnapshot {
  const storage = safeStorage();
  if (!storage) return { ...DEFAULT_HERITAGE_LAYOUT };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HERITAGE_LAYOUT };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = clampLayout(parsed);
    // R38 migration: a stored snapshot that exactly matches the pre-R38
    // defaults was never a real customization — it predates the unified page
    // rhythm. Migrate it to the new shipped rhythm instead of forcing the old
    // oversized paddings back onto every page.
    const legacyDefault =
      next.pageTop === 36 && next.pageBottom === 80 && next.sideGutter === 28 &&
      next.sectionGap === 14 && next.panelInset === 16 && next.contentWidth === 1280;
    // R124 migration: the same argument for the R38 defaults — a stored snapshot
    // that exactly equals the previous shipped rhythm (16/34/22/14/16/1280) was
    // never a real customization, so it moves to the compact R124 rhythm
    // instead of pinning the old oversized paddings back onto every page.
    const legacyR38Default =
      next.pageTop === 16 && next.pageBottom === 34 && next.sideGutter === 22 &&
      next.sectionGap === 14 && next.panelInset === 16 && next.contentWidth === 1280;
    if (legacyDefault || legacyR38Default) {
      const fresh = { ...DEFAULT_HERITAGE_LAYOUT };
      storage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return next;
  } catch {
    return { ...DEFAULT_HERITAGE_LAYOUT };
  }
}

let snapshot = loadSnapshot();

function applyHeritageLayout(value: HeritageLayoutSnapshot): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const tuned = !isDefaultHeritageLayout(value);
  if (tuned) {
    root.dataset.layoutTuning = "1";
    root.style.setProperty("--h-user-layout-top", `${value.pageTop}px`);
    root.style.setProperty("--h-user-layout-bottom", `${value.pageBottom}px`);
    root.style.setProperty("--h-user-layout-gutter", `${value.sideGutter}px`);
    root.style.setProperty("--h-user-layout-gap", `${value.sectionGap}px`);
    root.style.setProperty("--h-user-layout-inset", `${value.panelInset}px`);
    root.style.setProperty("--h-user-layout-width", `${value.contentWidth}px`);
  } else {
    delete root.dataset.layoutTuning;
    for (const name of ["--h-user-layout-top", "--h-user-layout-bottom", "--h-user-layout-gutter", "--h-user-layout-gap", "--h-user-layout-inset", "--h-user-layout-width"]) {
      root.style.removeProperty(name);
    }
  }
}

function persist(): void {
  const storage = safeStorage();
  if (!storage) return;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* persistence is optional */ }
}
function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persist, 180);
}
function emit(): void { for (const listener of listeners) listener(); }

export function bootstrapHeritageLayout(): HeritageLayoutSnapshot {
  applyHeritageLayout(snapshot);
  return snapshot;
}
export function getHeritageLayout(): HeritageLayoutSnapshot { return snapshot; }
export function subscribeHeritageLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setHeritageLayout(patch: Partial<HeritageLayoutSnapshot>): void {
  snapshot = clampLayout({ ...snapshot, ...patch });
  applyHeritageLayout(snapshot);
  schedulePersist();
  emit();
}
export function updateHeritageLayout(key: keyof HeritageLayoutSnapshot, value: number): void {
  setHeritageLayout({ [key]: value } as Partial<HeritageLayoutSnapshot>);
}
export function resetHeritageLayout(): void {
  snapshot = { ...DEFAULT_HERITAGE_LAYOUT };
  applyHeritageLayout(snapshot);
  schedulePersist();
  emit();
}
export function useHeritageLayoutSnapshot(): HeritageLayoutSnapshot {
  return useSyncExternalStore(subscribeHeritageLayout, getHeritageLayout, getHeritageLayout);
}
