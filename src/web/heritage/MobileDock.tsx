import { uiText, isUiRtl } from "../../shared/uiLocale";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { navigationGroups } from "../../frontend-kit/navigation";
import { HERITAGE_PRIMARY_IDS } from "./Navigation";
import { revealHeritageContent, type HeritageRevealTarget } from "./viewTransition";

export type HeritageDockItem = {
  id: string;
  label: string;
  shortLabel?: string;
  active?: boolean;
  icon?: React.ReactNode;
  onActivate: () => void;
  revealTarget?: HeritageRevealTarget;
};

export type HeritageDockLayer = {
  id: string;
  ariaLabel: string;
  items: HeritageDockItem[];
  level?: "secondary" | "tertiary";
};

type RegistryValue = {
  register(owner: string, layers: HeritageDockLayer[]): () => void;
};

const DockRegistryContext = createContext<RegistryValue | null>(null);

function DockIcon({ kind }: { kind: "search" | "registry" | "stats" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "search") return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>;
  if (kind === "registry") return <svg {...common}><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>;
  return <svg {...common}><path d="M5 19V9M12 19V5M19 19v-7"/><path d="M3 19h18"/></svg>;
}

function DockRow({ layer }: { layer: HeritageDockLayer }) {
  const { locale } = useI18n();
  const selected = layer.items.find(item => item.active)?.id ?? "";
  return <nav className={`heritage-app-dock-row dock-${layer.level ?? "secondary"}`} aria-label={layer.ariaLabel} data-layer={layer.id}>
    <label className="h112-dock-section"><span>{layer.ariaLabel}</span><select aria-label={layer.ariaLabel} value={selected} onChange={event => {
      const item = layer.items.find(candidate => candidate.id === event.target.value);
      if (!item) return;
      item.onActivate();
      if (item.revealTarget) revealHeritageContent(item.revealTarget);
    }}>
      {!selected && <option value="" disabled>{uiText(locale, "Choose a view", "انتخاب بخش")}</option>}
      {layer.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
  </nav>;
}

export function HeritageMobileDockProvider({ children, route, navigate, enabled }: { children: React.ReactNode; route: string; navigate: (path: string) => void; enabled: boolean }) {
  const { locale } = useI18n();
  const dockRef = useRef<HTMLDivElement>(null);
  const [registrations, setRegistrations] = useState<Record<string, HeritageDockLayer[]>>({});
  const register = useCallback((owner: string, layers: HeritageDockLayer[]) => {
    setRegistrations(previous => ({ ...previous, [owner]: layers }));
    return () => setRegistrations(previous => {
      if (!(owner in previous)) return previous;
      const next = { ...previous };
      delete next[owner];
      return next;
    });
  }, []);
  const contextValue = useMemo<RegistryValue>(() => ({ register }), [register]);
  const contextualLayers = useMemo(() => Object.values(registrations).flat(), [registrations]);
  const primary = useMemo<HeritageDockLayer>(() => ({
    id: "main",
    ariaLabel: uiText(locale, "Mobile quick navigation", "پیمایش سریع موبایل"),
    items: navigationGroups("heritage", route, locale).flatMap(group => group.links)
      .filter(link => HERITAGE_PRIMARY_IDS.some(id => id === link.id))
      .map(link => ({ id: link.id, label: link.label[locale], active: link.active,
        icon: <DockIcon kind={link.id === "home" ? "search" : link.id === "horses" ? "registry" : "stats"}/>,
        onActivate: () => navigate(link.href),
      })),
  }), [locale, navigate, route]);

  // R131: the CSS that hides the in-page section rails (profile-workspace-nav,
  // profile-subnav, stats-subnav/subtabs) used to key off data-tab-hierarchy —
  // but the dock only RENDERS when the navigation layout allows it, so in
  // sidebar/both layouts a docked phone ended up with ZERO navigation (the
  // reported "clicking the section options does nothing"). The hide rule now
  // keys off this attribute, which is set exactly when the dock is mounted —
  // hide-or-show is decided by the same source of truth as render-or-not.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!enabled) { delete document.documentElement.dataset.dockActive; return; }
    document.documentElement.dataset.dockActive = "1";
    return () => { delete document.documentElement.dataset.dockActive; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const id = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".heritage-global-app-dock .heritage-app-dock-row").forEach((row) => {
        const active = row.querySelector<HTMLElement>("button.active");
        if (!active) return;
        active.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [contextualLayers.length, enabled, route]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const rows = enabled ? 1 + contextualLayers.length : 0;
    const measure = () => {
      const bounds = dockRef.current?.getBoundingClientRect();
      // Include the actual bottom inset: it may contain a device safe area.
      const height = bounds?.height ? Math.ceil(bounds.height + Math.max(0, window.innerHeight - bounds.bottom)) + 7 : 0;
      document.documentElement.style.setProperty("--h-mobile-dock-stack-height", `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (dockRef.current) observer.observe(dockRef.current);
    document.documentElement.dataset.mobileDockDepth = String(rows);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--h-mobile-dock-stack-height");
      delete document.documentElement.dataset.mobileDockDepth;
    };
  }, [contextualLayers.length, enabled]);

  const portal = enabled && typeof document !== "undefined" ? createPortal(
    <div ref={dockRef} className="heritage-app-dock heritage-global-app-dock" dir={(isUiRtl(locale) ? "rtl" : "ltr")}>
      {[...contextualLayers].reverse().map(layer => <DockRow key={layer.id} layer={layer}/>)}
      <nav className="heritage-app-dock-row dock-primary heritage-main-dock" aria-label={primary.ariaLabel}>
        {primary.items.map(item => <button key={item.id} className={item.active ? "active" : ""} aria-current={item.active ? "page" : undefined} onClick={item.onActivate} title={item.label}>
          <span className="heritage-dock-icon">{item.icon}</span><small>{item.shortLabel ?? item.label}</small>
        </button>)}
      </nav>
    </div>,
    document.body,
  ) : null;

  return <DockRegistryContext.Provider value={contextValue}>{children}{portal}</DockRegistryContext.Provider>;
}

export function useHeritageMobileDock(owner: string, layers: HeritageDockLayer[]): void {
  const registry = useContext(DockRegistryContext);
  useEffect(() => {
    if (!registry) return;
    return registry.register(owner, layers);
  }, [registry, owner, layers]);
}
