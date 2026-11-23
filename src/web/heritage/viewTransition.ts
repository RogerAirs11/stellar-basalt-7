export type HeritageRevealTarget = string | HTMLElement | null | undefined;

function resolveTarget(target: HeritageRevealTarget): HTMLElement | null {
  if (!target) return null;
  if (typeof target === "string") return document.querySelector<HTMLElement>(target);
  return target;
}

export function isHeritageCompactViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
}

export function revealHeritageContent(
  target: HeritageRevealTarget,
  options: { mobileOnly?: boolean; focus?: boolean; behavior?: ScrollBehavior } = {},
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const { mobileOnly = true, focus = true } = options;
  if (mobileOnly && !isHeritageCompactViewport()) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const run = () => {
    const element = resolveTarget(target);
    if (!element) return;
    element.scrollIntoView({ behavior: reduceMotion ? "auto" : (options.behavior ?? "smooth"), block: "start", inline: "nearest" });
    if (!focus) return;
    const hadTabIndex = element.hasAttribute("tabindex");
    const previousTabIndex = element.getAttribute("tabindex");
    if (!hadTabIndex) element.setAttribute("tabindex", "-1");
    try { element.focus({ preventScroll: true }); } catch { /* older browsers */ }
    if (!hadTabIndex) {
      const cleanup = () => {
        if (previousTabIndex == null) element.removeAttribute("tabindex");
        else element.setAttribute("tabindex", previousTabIndex);
        element.removeEventListener("blur", cleanup);
      };
      element.addEventListener("blur", cleanup, { once: true });
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}
