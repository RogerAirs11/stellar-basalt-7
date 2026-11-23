import { useEffect, useState } from "react";
import { navigationStorageKey, type NavigationFrontend } from "./navigation";
import { AUTO_SIDEBAR_QUERY, parseNavigationPreference, resolveNavigationLayout, resolveNavigationChrome, type NavigationChrome, type NavigationPreference } from "./navigationPreference";
export { resolveNavigationChrome };
export type { NavigationChrome, NavigationPreference };
const EVENT = "horse-registry:navigation-change";
/** Persist intent, not a transient viewport decision. Storage denial is harmless. */
export function useNavigationLayout(frontend: NavigationFrontend, fallback?: NavigationPreference) {
  const defaultPreference = fallback ?? (frontend === "heritage" ? "auto" : "tabs");
  const key = navigationStorageKey(frontend);
  const read = () => {
    try { return parseNavigationPreference(window.localStorage.getItem(key), defaultPreference); }
    catch { return defaultPreference; }
  };
  const [preference, setLocal] = useState<NavigationPreference>(read);
  const [hasRoom, setHasRoom] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(AUTO_SIDEBAR_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(AUTO_SIDEBAR_QUERY);
    const update = () => setHasRoom(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setLocal(read());
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) setLocal(read()); };
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (detail?.key === key) setLocal(parseNavigationPreference(detail.value, defaultPreference));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onLocal);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(EVENT, onLocal); };
  }, [key, defaultPreference]);
  const setLayout = (value: NavigationPreference) => {
    const next = parseNavigationPreference(value, defaultPreference);
    setLocal(next);
    try { window.localStorage.setItem(key, next); } catch { /* Session-only preference. */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value: next } }));
  };
  return { layout: resolveNavigationLayout(preference, hasRoom), preference, chrome: resolveNavigationChrome(preference, hasRoom), setLayout };
}
