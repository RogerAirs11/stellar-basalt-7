import { useLayoutEffect, useState, type RefObject } from "react";
import { fitNavigationTabs } from "./navigation";

export type AdaptiveTabOptions = {
  activeIndex?: number;
  gap?: number;
  alwaysShowMore?: boolean;
  /** Locale/label revision. Also observes the hidden measurement row. */
  revision?: string;
};

/** A hidden twin renders ALL labels with the same metrics as visible links.
 * Watching the twin/controls (not just the container) handles locale changes,
 * loaded fonts and density settings without requiring a window resize.
 */
export function useFittedTabIndices(
  navigationRef: RefObject<HTMLElement | null>,
  measureRef: RefObject<HTMLElement | null>,
  moreRef: RefObject<HTMLElement | null>,
  total: number,
  { activeIndex = -1, gap = 6, alwaysShowMore = true, revision = "" }: AdaptiveTabOptions = {},
): number[] {
  const [indices, setIndices] = useState<number[]>(() => Array.from({ length: total }, (_, i) => i));
  useLayoutEffect(() => {
    const navigation = navigationRef.current, twin = measureRef.current;
    if (!navigation || !twin) return;
    let frame = 0, disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const style = getComputedStyle(navigation);
      const padding = (parseFloat(style.paddingInlineStart) || 0) + (parseFloat(style.paddingInlineEnd) || 0);
      const available = Math.max(0, navigation.clientWidth - padding);
      const widths = Array.from(twin.children, node => (node as HTMLElement).getBoundingClientRect().width);
      const more = moreRef.current?.getBoundingClientRect().width || 96;
      const next = fitNavigationTabs(widths, available, more, gap, activeIndex, alwaysShowMore);
      setIndices(previous => previous.length === next.length && previous.every((value, i) => value === next[i]) ? previous : next);
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(navigation); observer?.observe(twin);
    for (const child of Array.from(twin.children)) observer?.observe(child);
    if (moreRef.current) observer?.observe(moreRef.current);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mutations?.observe(twin, { childList: true, characterData: true, subtree: true });
    mutations?.observe(navigation, { childList: true, characterData: true, subtree: true });
    document.fonts?.addEventListener?.("loadingdone", schedule);
    void document.fonts?.ready.then(schedule).catch(() => {});
    window.addEventListener("resize", schedule);
    return () => {
      disposed = true; observer?.disconnect(); mutations?.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [navigationRef, measureRef, moreRef, total, activeIndex, gap, alwaysShowMore, revision]);
  return indices.filter(index => index < total);
}

/** Compatibility for external consumers requiring a prefix count. New primary
 * navigations must use indices so that the active tab is included in the budget. */
export function useFittingTabs(
  navigationRef: RefObject<HTMLElement | null>, measureRef: RefObject<HTMLDivElement | null>,
  moreRef: RefObject<HTMLElement | null>, total: number, gap = 6, _moreGap?: number,
): number {
  return useFittedTabIndices(navigationRef, measureRef, moreRef, total, { gap }).length;
}
