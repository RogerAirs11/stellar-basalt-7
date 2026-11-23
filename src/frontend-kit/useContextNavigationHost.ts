import { useLayoutEffect, useRef, useState } from "react";
import type { NavigationFrontend } from "./navigation";
import { useNavigationLayout } from "./useNavigationLayout";

/**
 * A stable portal destination for a skin's own contextual navigation.
 *
 * React remounts a portal subtree when its destination changes. Moving one
 * persistent DOM host instead preserves live controls, component state, and
 * focus across layout changes. Small viewports keep the controls beside their
 * content rather than concealing them in a collapsed global navigation drawer.
 * This hook supplies lifecycle only; each frontend owns its DOM and styles.
 */
export function useContextNavigationHost(
  frontend: NavigationFrontend,
  sidebarSlotId: string,
  minSidebarWidth = 861,
) {
  const { layout } = useNavigationLayout(frontend);
  const homeRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLElement | null>(null);
  const [portalHost] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  const query = `(min-width: ${minSidebarWidth}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  useLayoutEffect(() => {
    if (!portalHost) return;
    const remember = (event: FocusEvent) => {
      focusedRef.current = event.target instanceof HTMLElement && portalHost.contains(event.target) ? event.target : null;
    };
    const forget = () => {
      // A removed sidebar loses the browser's activeElement before the next
      // layout effect. An explicit blur in a connected host must still win.
      if (portalHost.isConnected) focusedRef.current = null;
    };
    document.addEventListener("focusin", remember);
    portalHost.addEventListener("focusout", forget);
    return () => { document.removeEventListener("focusin", remember); portalHost.removeEventListener("focusout", forget); };
  }, [portalHost]);

  // Check after every commit: a skin may mount its sidebar slot in that commit.
  useLayoutEffect(() => {
    if (!portalHost) return;
    const sidebar = layout === "sidebar" && wide ? document.getElementById(sidebarSlotId) : null;
    const destination = sidebar ?? homeRef.current;
    if (!destination || portalHost.parentElement === destination) return;
    const focused = portalHost.contains(document.activeElement) ? document.activeElement as HTMLElement : !portalHost.isConnected ? focusedRef.current : null;
    destination.appendChild(portalHost);
    focused?.focus({ preventScroll: true });
  });

  useLayoutEffect(() => {
    if (!portalHost) return;
    const relocate = () => {
      const sidebar = layout === "sidebar" && wide ? document.getElementById(sidebarSlotId) : null;
      const destination = sidebar ?? homeRef.current;
      if (!destination || destination === portalHost.parentElement) return;
      const focused = portalHost.contains(document.activeElement) ? document.activeElement as HTMLElement : focusedRef.current;
      destination.appendChild(portalHost);
      if (focused && portalHost.contains(focused)) focused.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(records => {
      // React may filter the active link out without rendering the page itself.
      // Ignore unrelated content mutations; never poll or repeatedly remount controls.
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && (node.contains(portalHost) || node.id === sidebarSlotId || node.querySelector(`[id="${sidebarSlotId}"]`))
      ))) relocate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [layout, wide, sidebarSlotId, portalHost]);

  useLayoutEffect(() => () => { portalHost?.remove(); }, [portalHost]);
  return { homeRef, portalHost };
}
