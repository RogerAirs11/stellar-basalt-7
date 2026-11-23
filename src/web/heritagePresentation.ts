import { useSyncExternalStore } from "react";

/** A presentation of the existing Heritage application, not a second data client.
 * R154: the "professional" presentation was removed by owner decision; the
 * state layer stays so saved preferences and the switcher contract keep working. */
export type HeritagePresentation = "heritage";
const STORAGE_KEY = "registry-heritage-presentation-v1";
const EVENT = "heritage:presentation-changed";
let current: HeritagePresentation | undefined;

export function readHeritagePresentation(): HeritagePresentation {
  if (current) return current;
  try {
    // The retired "professional" choice is actively cleared so a stale
    // saved preference can never resurrect a removed surface.
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "professional") localStorage.removeItem(STORAGE_KEY);
    current = "heritage";
  } catch { current = "heritage"; }
  return current;
}

export function bootstrapHeritagePresentation(): void {
  if (typeof document !== "undefined") document.documentElement.dataset.heritagePresentation = readHeritagePresentation();
}

export function setHeritagePresentation(value: HeritagePresentation): void {
  current = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* The view remains usable without persistence. */ }
  bootstrapHeritagePresentation();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  const sync = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    current = "heritage";
    bootstrapHeritagePresentation();
    listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", sync);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", sync); };
}

export function useHeritagePresentation(): HeritagePresentation {
  return useSyncExternalStore(subscribe, readHeritagePresentation, () => "heritage");
}
