import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  NAVIGATION_LABELS, filterNavigation, navigationGroups, isPlainNavigationClick,
  useNavigationLayout, useContextNavigationHost, useFittedTabIndices, type NavigationLocale, type NavigationGroup,
} from "../../../frontend-kit";
import { edxText } from "./i18n";

type NavigationProps = { route: string; locale: NavigationLocale; navigate: (path: string) => void };
const FRONTEND = "equidata-elite";

export function LayoutSwitcher({ locale }: { locale: NavigationLocale }) {
  const { layout, setLayout } = useNavigationLayout(FRONTEND);
  return <label className="edx102-layout"><span>{NAVIGATION_LABELS.layout[locale]}</span>
    <select aria-label={NAVIGATION_LABELS.layout[locale]} value={layout}
      onChange={event => setLayout(event.target.value === "sidebar" ? "sidebar" : "tabs")}>
      <option value="tabs">{NAVIGATION_LABELS.tabs[locale]}</option>
      <option value="sidebar">{NAVIGATION_LABELS.sidebar[locale]}</option>
    </select>
  </label>;
}

/** One canonical link inventory is used in both local navigation presentations. */
function SectionGroups({ groups, locale, navigate, id, collapsed, onToggle, onNavigate }: {
  groups: NavigationGroup[]; locale: NavigationLocale; navigate: (path: string) => void; id: string;
  collapsed?: ReadonlySet<string>; onToggle?: (id: string) => void; onNavigate?: () => void;
}) {
  return <>{groups.map(group => {
    const expanded = !collapsed?.has(group.id);
    return <section className="edx102-group" data-group={group.id} key={group.id}>
      {onToggle ? <button type="button" className="edx102-group-title" aria-expanded={expanded} aria-controls={`${id}-${group.id}`} onClick={() => onToggle(group.id)}>
        <span>{group.label[locale]}</span><span className="nav-group-count" aria-hidden="true">{group.links.length}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button> : <h3 className="edx102-group-title">{group.label[locale]}</h3>}
      <ul id={`${id}-${group.id}`} hidden={!expanded}>{group.links.map(link => <li key={link.id}>
        <a href={link.href} aria-current={link.active ? "page" : undefined} onClick={event => {
          if (isPlainNavigationClick(event)) {
            onNavigate?.();
            if (!link.external) { event.preventDefault(); navigate(link.href); }
          }
        }}>{link.label[locale]}{link.external && <span aria-hidden="true"> ↗</span>}</a>
      </li>)}</ul>
    </section>;
  })}{groups.length === 0 && <p role="status" className="edx112-nav-empty">{NAVIGATION_LABELS.empty[locale]}</p>}</>;
}

function SectionSearch({ locale, id, query, setQuery, inputRef }: {
  locale: NavigationLocale; id: string; query: string; setQuery: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return <div className="edx102-find">
    <label htmlFor={`${id}-search`}>{NAVIGATION_LABELS.search[locale]}</label>
    <div className="edx102-search-controls">
      <input ref={inputRef} id={`${id}-search`} type="search" value={query} maxLength={120} autoComplete="off" onChange={event => setQuery(event.target.value)} />
      <button type="button" disabled={!query} aria-label={NAVIGATION_LABELS.clearSearch[locale]} onClick={() => { setQuery(""); inputRef.current?.focus(); }}><span aria-hidden="true">×</span></button>
    </div>
  </div>;
}

/** R116: the primary row is no longer a fixed trio — every canonical
 * destination that fits the measured bar width renders as a tab (shared
 * group order) and the remainder stays reachable through the Sections
 * disclosure, which keeps carrying the full searchable inventory. */
export function PrimaryNavigation({ route, locale, navigate }: NavigationProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = navigationGroups(FRONTEND, route, locale);
  const links = groups.flatMap(group => group.links);

  // Measure the actual flexible row, not a fixed tab count or outer page.
  // The current destination consumes the same budget as every other link.
  const fitted = useFittedTabIndices(rowRef, measureRef, toggleRef, links.length,
    { activeIndex: links.findIndex(link => link.active), revision: locale, gap: 4 });
  const active = links.find(link => link.active);
  const shown = links.filter((_, index) => fitted.includes(index));
  const overflowed = links.filter((_, index) => !fitted.includes(index));
  const activeHidden = overflowed.some(link => link.active);
  const moreLabel = edxText(locale === "fr" ? "en" : locale, "More", "\u0628\u06cc\u0634\u062a\u0631");
  const close = (restore = false) => { setOpen(false); setQuery(""); if (restore) toggleRef.current?.focus(); };
  useEffect(() => { setOpen(false); setQuery(""); }, [route, locale]);
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const height = viewport?.height ?? window.innerHeight;
      const bottom = (viewport?.offsetTop ?? 0) + height;
      const available = Math.max(0, bottom - panel.getBoundingClientRect().top - 12);
      panel.style.maxBlockSize = `${Math.floor(Math.min(height * .7, available))}px`;
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (rootRef.current) observer?.observe(rootRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={rootRef} className="edx112-primary" onKeyDown={event => {
    if (event.key === "Escape" && open && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(true); }
  }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(); }}>
    {/* Hidden measurement twin: always fully rendered so every tab's intrinsic width stays observable. */}
    <div ref={measureRef} className="edx112-primary-measure" aria-hidden="true">
      {links.map(link => <span key={link.id}>{link.label[locale]}{link.external && <span aria-hidden="true">↗</span>}</span>)}
    </div>
    <nav ref={rowRef} className="edx112-shortcuts" aria-label={edxText(locale === "fr" ? "en" : locale, "Primary navigation", "\u067e\u06cc\u0645\u0627\u06cc\u0634 \u0627\u0635\u0644\u06cc")}>
      {shown.map(link =>
        <a key={link.id} href={link.href} aria-current={link.active ? "page" : undefined} onClick={event => {
          if (isPlainNavigationClick(event)) { event.preventDefault(); close(); navigate(link.href); }
        }}>{link.label[locale]}{link.external && <span aria-hidden="true">↗</span>}</a>)}
      <button ref={toggleRef} type="button" className="edx112-sections-toggle" data-active={activeHidden || undefined} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => { if (open) close(); else setOpen(true); }}>
        <span>{moreLabel}</span>{overflowed.length > 0 && <span className="edx112-more-count" aria-hidden="true">{overflowed.length}</span>}<span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
    </nav>
    {open && <div ref={panelRef} className="edx112-sections-panel" id={`${id}-panel`}>
      <div className="edx112-sections-head"><strong>{NAVIGATION_LABELS.sections[locale]}</strong><button type="button" aria-label={edxText(locale === "fr" ? "en" : locale, "Close sections", "\u0628\u0633\u062a\u0646 \u0628\u062e\u0634\u200c\u0647\u0627")} onClick={() => close(true)}>×</button></div>
      <SectionSearch locale={locale} id={id} query={query} setQuery={setQuery} inputRef={searchRef} />
      <nav className="edx112-section-grid" aria-label={NAVIGATION_LABELS.sections[locale]}><SectionGroups groups={filterNavigation(groups, query)} locale={locale} navigate={navigate} id={id} onNavigate={() => close()} /></nav>
    </div>}
  </div>;
}

export function HierarchicalNavigation({ route, locale, navigate }: NavigationProps) {
  const id = useId();
  const rootRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(["research", "business", "governance", "showcase"]));
  useEffect(() => {
    setMobileOpen(false); setQuery("");
    const active = navigationGroups(FRONTEND, route, locale).find(group => group.links.some(link => link.active));
    if (active) setCollapsed(previous => { const next = new Set(previous); next.delete(active.id); return next; });
  }, [route, locale]);
  useEffect(() => {
    if (!mobileOpen) return;
    searchRef.current?.focus();
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setMobileOpen(false); setQuery(""); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [mobileOpen]);
  const groups = filterNavigation(navigationGroups(FRONTEND, route, locale), query);
  return <aside ref={rootRef} className="edx102-sidebar" data-open={mobileOpen} aria-label={NAVIGATION_LABELS.sidebar[locale]} onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (mobileOpen) { event.preventDefault(); event.stopPropagation(); setMobileOpen(false); setQuery(""); toggleRef.current?.focus(); }
    else if (query) { event.preventDefault(); event.stopPropagation(); setQuery(""); searchRef.current?.focus(); }
  }}>
    <button ref={toggleRef} type="button" className="edx102-mobile-toggle" aria-expanded={mobileOpen} aria-controls={`${id}-body`} onClick={() => setMobileOpen(value => !value)}>{NAVIGATION_LABELS.sections[locale]} <span aria-hidden="true">{mobileOpen ? "−" : "+"}</span></button>
    <div className="edx102-sidebar-body" id={`${id}-body`}>
      <div className="edx102-context" id="edx102-context" />
      <SectionSearch locale={locale} id={id} query={query} setQuery={setQuery} inputRef={searchRef} />
      <nav aria-label={NAVIGATION_LABELS.sections[locale]}><SectionGroups groups={groups} locale={locale} navigate={navigate} id={id} collapsed={query.trim() ? undefined : collapsed} onNavigate={() => { setMobileOpen(false); setQuery(""); }} onToggle={groupId => setCollapsed(previous => { const next = new Set(previous); if (next.has(groupId)) next.delete(groupId); else next.add(groupId); return next; })} /></nav>
    </div>
  </aside>;
}

/** Moving the host preserves mounted control state; mobile record controls stay beside their content. */
export function ContextNavigation({ children }: { children: ReactNode }) {
  const { homeRef, portalHost } = useContextNavigationHost(FRONTEND, "edx102-context", 861);
  return <><div ref={homeRef} className="edx112-context-home" />{portalHost && createPortal(children, portalHost)}</>;
}
