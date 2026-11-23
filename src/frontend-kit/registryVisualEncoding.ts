/**
 * R56: the registry viewer's "visual encoding" (color marks for sex/status on
 * table rows) moved out of the browse toolbar into the Appearance Studio
 * (Foundation section). This tiny shared store keeps the localStorage-backed
 * preference in one place and lets the studio toggle update an open browse
 * page live via a custom event — no prop drilling, no remount.
 */

const KEY = "registry-visual-encoding";
const EVENT = "registry-visual-encoding-change";

export function readVisualEncoding(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function writeVisualEncoding(enabled: boolean): void {
  try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* optional */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { enabled } })); } catch { /* optional */ }
}

/** Subscribe to live changes; returns an unsubscribe function. */
export function onVisualEncodingChange(listener: (enabled: boolean) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
    if (detail && typeof detail.enabled === "boolean") listener(detail.enabled);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
