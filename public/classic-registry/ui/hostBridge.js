/** Only the same-origin embedding parent can update host-owned state. */
export function installClassicHostBridge(handlers) {
  const onMessage = (event) => {
    if (window.parent === window || event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "horse-db-classic-locale" && (data.locale === "en" || data.locale === "fa" || data.locale === "ar")) {
      Promise.resolve(handlers.locale(data.locale)).catch(() => {});
    } else if (data.type === "horse-db-classic-ai" && typeof data.open === "boolean") handlers.ai(data.open);
    else if (data.type === "horse-db-classic-session") {
      // R107 NEXT-05: the host principal changed (login/logout/switch) —
      // re-read the authoritative session and re-render under it.
      Promise.resolve(handlers.session()).catch(() => {});
    }
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
