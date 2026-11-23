import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { uiText } from "../../shared/uiLocale";
import type { NavigationPreference } from "../../frontend-kit";
import {
  NAVIGATION_LABELS, filterNavigation, navigationGroups, isPlainNavigationClick,
  useContextNavigationHost, useNavigationLayout, useFittedTabIndices, type NavigationGroup, type NavigationLink, type NavigationLocale,
} from "../../frontend-kit";

// Core owns this presentation; the shared kit supplies information and lifecycle.
// R115: the primary row shows every canonical destination that fits the available
// header width (measured live), in the shared group order; whatever does not fit
// stays reachable through the "More" disclosure. The previously hard-coded trio
// (home/horses/analytics) hid most of the registry behind a toggle.
export const HERITAGE_PRIMARY_IDS = ["home", "horses", "analytics"] as const;
type NavigationProps = { route: string; locale: NavigationLocale; navigate: (path: string) => void };

const parseLayoutChoice = (value: string): NavigationPreference =>
  value === "sidebar" || value === "both" || value === "auto" ? value : "tabs";

export function LayoutSwitcher({ locale }: { locale: NavigationLocale }) {
  const { preference, setLayout } = useNavigationLayout("heritage");
  return <label className="h102-layout"><span>{NAVIGATION_LABELS.layout[locale]}</span>
    <select aria-label={NAVIGATION_LABELS.layout[locale]} value={preference}
      onChange={event => setLayout(parseLayoutChoice(event.target.value))}>
      <option value="auto">{NAVIGATION_LABELS.auto[locale]}</option>
      <option value="tabs">{NAVIGATION_LABELS.tabs[locale]}</option>
      <option value="sidebar">{NAVIGATION_LABELS.sidebar[locale]}</option>
      <option value="both">{NAVIGATION_LABELS.both[locale]}</option>
    </select>
  </label>;
}

/** R124: the visible header control for the navigation layout. The owner could
 *  never find the buried select in the Appearance Studio; this popover keeps
 *  every mode one click away and shows the live chrome for the current
 *  viewport. In "both" the sidebar rail AND the top tab row render together
 *  (the sidebar follows the viewport like auto — it simply never loses the
 *  tab row). */
export function LayoutSwitcherButton({ locale }: { locale: NavigationLocale }) {
  const { preference, chrome, setLayout } = useNavigationLayout("heritage");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const effective = chrome.sidebar && chrome.tabs ? "both" : chrome.sidebar ? "sidebar" : "tabs";
  const hint = {
    auto: uiText(locale, "Automatic: sidebar on wide viewports, tabs otherwise", "خودکار: در صفحه‌های پهن منوی کناری و در بقیه تب‌ها"),
    tabs: uiText(locale, "Top tabs only", "فقط منوی بالا"),
    sidebar: uiText(locale, "Sidebar only", "فقط منوی کناری"),
    both: uiText(locale, "Sidebar and top tabs together; the sidebar follows the viewport", "منوی کناری و تب‌ها با هم؛ منوی کناری از روی عرض صفحه تعیین می‌شود"),
  } as const;
  const glyph = {
    tabs: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.4"/><path d="M6.2 6v8.5M10.8 6v8.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
    sidebar: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 1.5v13" stroke="currentColor" strokeWidth="1.4"/></svg>,
    both: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 1.5v13" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 6h9" stroke="currentColor" strokeWidth="1.2"/></svg>,
  } as const;
  const options: Array<{ id: NavigationPreference; label: string; description: string }> = [
    { id: "auto", label: NAVIGATION_LABELS.auto[locale], description: hint.auto },
    { id: "tabs", label: NAVIGATION_LABELS.tabs[locale], description: hint.tabs },
    { id: "sidebar", label: NAVIGATION_LABELS.sidebar[locale], description: hint.sidebar },
    { id: "both", label: NAVIGATION_LABELS.both[locale], description: hint.both },
  ];
  const effectiveLabel = effective === "both" ? NAVIGATION_LABELS.both[locale] : effective === "sidebar" ? NAVIGATION_LABELS.sidebar[locale] : NAVIGATION_LABELS.tabs[locale];
  const preferenceLabel = preference === "auto" ? NAVIGATION_LABELS.auto[locale] : preference === "both" ? NAVIGATION_LABELS.both[locale] : preference === "sidebar" ? NAVIGATION_LABELS.sidebar[locale] : NAVIGATION_LABELS.tabs[locale];
  // R125: translate the title prefix through the shared AR copy (the labels
  // themselves are already four-locale via NAVIGATION_LABELS[locale]).
  const title = locale === "fa" ? "چیدمان منو — برای تغییر کلیک کنید" : `${uiText(locale, "Navigation layout", "چیدمان منو")}: ${effectiveLabel} · ${preferenceLabel}`;
  return <div ref={rootRef} className={`h122-layout-switcher${open ? " open" : ""}`}>
    <button ref={triggerRef} type="button" className="h122-layout-toggle" aria-haspopup="menu" aria-expanded={open} title={title} aria-label={title} onClick={() => setOpen(value => !value)}>
      {glyph[effective]}
    </button>
    {open && createPortal(<div className="h122-layout-popover" role="menu" aria-label={NAVIGATION_LABELS.layout[locale]}>
      {options.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={preference === option.id} className={preference === option.id ? "active" : ""} onClick={() => { setLayout(option.id); setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }}>
        <strong>{option.label}</strong><small>{option.description}</small>
      </button>)}
    </div>, rootRef.current?.closest("header") ?? document.body)}
  </div>;
}

function MobileLayoutSwitcher({ locale }: { locale: NavigationLocale }) {
  return <button type="button" className="h112-navigation-settings" onClick={() => window.dispatchEvent(new CustomEvent("heritage:open-appearance", { detail: { section: "appearance-navigation" } }))}>
    {uiText(locale, "Navigation & appearance", "ناوبری و ظاهر")} <span aria-hidden="true">↗</span>
  </button>;
}

/** R135: the interface (frontend) choice joins the sidebar / More panel so the
 *  floating pill can disappear on phones — one compact entry, same picker. */
function FrontendSwitcherEntry({ locale }: { locale: NavigationLocale }) {
  return <button type="button" className="h112-navigation-settings h112-frontend-entry" onClick={() => window.dispatchEvent(new CustomEvent("heritage:open-frontend-switcher"))}>
    {uiText(locale, "Change interface", "تغییر رابط کاربری")} <span aria-hidden="true">↗</span>
  </button>;
}

function SectionLink({ link, locale, navigate }: { link: NavigationLink; locale: NavigationLocale; navigate: (path: string) => void }) {
  return <a href={link.href} aria-current={link.active ? "page" : undefined} onClick={event => {
    if (!link.external && isPlainNavigationClick(event)) { event.preventDefault(); navigate(link.href); }
  }}><span>{link.label[locale]}</span>{link.external && <span aria-hidden="true">↗</span>}</a>;
}

function SectionGroups({ groups, locale, navigate, collapsible = false, searching = false }: {
  groups: NavigationGroup[]; locale: NavigationLocale; navigate: (path: string) => void; collapsible?: boolean; searching?: boolean;
}) {
  const id = useId();
  const activeGroup = groups.find(group => group.links.some(link => link.active))?.id ?? groups[0]?.id;
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  useEffect(() => {
    if (activeGroup) setExpandedGroups(previous => new Set([...previous, activeGroup]));
  }, [activeGroup]);
  return <div className="h102-groups">{groups.map(group => {
    const expanded = !collapsible || searching || expandedGroups.has(group.id);
    return <section className="h102-group" data-group={group.id} key={group.id}>
      <h3 className="h102-group-heading">{collapsible ? <button type="button" className="h102-group-title" aria-expanded={expanded} aria-controls={`${id}-${group.id}`}
        onClick={() => setExpandedGroups(previous => {
          const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next;
        })}><span className="h102-group-marker" aria-hidden="true"/><span>{group.label[locale]}</span><span className="h102-group-count">{group.links.length}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span></button> : <><span className="h102-group-marker" aria-hidden="true"/><span>{group.label[locale]}</span><span className="h102-group-count">{group.links.length}</span></>}</h3>
      <ul id={`${id}-${group.id}`} hidden={!expanded}>{group.links.map(link => <li key={link.id} className={link.id === "wallpaper" ? "wallpaper-nav-tab" : undefined}><SectionLink link={link} locale={locale} navigate={navigate}/>{collapsible && link.id === "analytics" && link.active && <div id="h102-analytics-context" className="h122-analytics-context"/>}</li>)}</ul>
    </section>;
  })}{groups.length === 0 && <p className="h102-empty" role="status">{NAVIGATION_LABELS.empty[locale]}</p>}</div>;
}

function SectionSearch({ id, locale, query, setQuery, inputRef }: {
  id: string; locale: NavigationLocale; query: string; setQuery: (query: string) => void; inputRef: RefObject<HTMLInputElement | null>;
}) {
  return <div className="h102-find">
    <label htmlFor={`${id}-search`}>{NAVIGATION_LABELS.search[locale]}</label>
    <div className="h102-search-controls">
      <input ref={inputRef} id={`${id}-search`} type="search" autoComplete="off" value={query} maxLength={120} onChange={event => setQuery(event.target.value)}/>
      <button type="button" disabled={!query} aria-label={NAVIGATION_LABELS.clearSearch[locale]} onClick={() => { setQuery(""); inputRef.current?.focus(); }}><span aria-hidden="true">×</span></button>
    </div>
  </div>;
}

/** Every canonical destination, in the shared group order; overflow collapses into "More". */
export function PrimaryNavigation({ route, locale, navigate, showAppearanceTools = false }: NavigationProps & { showAppearanceTools?: boolean }) {
  const id = useId();
  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = navigationGroups("heritage", route, locale);
  const candidates = groups.flatMap(group => group.links.map(link => ({ ...link, group: group.id })));
  const active = candidates.find(link => link.active);
  const fitted = useFittedTabIndices(rootRef, measureRef, toggleRef, candidates.length,
    { activeIndex: candidates.findIndex(link => link.active), revision: locale, gap: 6 });
  const shown = candidates.filter((_, index) => fitted.includes(index));
  const overflowed = candidates.filter((_, index) => !fitted.includes(index));
  const activeHidden = overflowed.some(link => link.active);
  const overflowLabel = uiText(locale, "More", "بیشتر");
  useEffect(() => { setOpen(false); setQuery(""); }, [route, locale]);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const navigation = rootRef.current;
      const header = navigation?.closest("header");
      if (!navigation || !header) return;
      header.style.setProperty("--h-nav-menu-top", `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
      header.style.setProperty("--h-nav-menu-viewport", `${Math.floor(window.visualViewport?.height ?? window.innerHeight)}px`);
    };
    measure();
    // R135: phones must not have the keyboard yanked open by the More panel —
    // the group list is short enough to scan. Keyboard users still get focus.
    if (!matchMedia("(pointer: coarse)").matches) searchRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open]);
  const close = () => { setOpen(false); toggleRef.current?.focus({ preventScroll: true }); };
  return <nav ref={rootRef} className="h112-primary-navigation" aria-label={uiText(locale, "Primary navigation", "پیمایش اصلی")}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}
    onBlur={event => { if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !panelRef.current?.contains(event.relatedTarget)) setOpen(false); }}>
    <div ref={measureRef} className="h112-primary-measure" aria-hidden="true" hidden={false}>
      {candidates.map(link => <span key={link.id} data-group={link.group}>{link.label[locale]}{link.external && <span aria-hidden="true">↗</span>}</span>)}
    </div>
    <div className="h112-primary-links">{shown.map(link =>
      <a key={link.id} data-group={link.group} href={link.href} aria-current={link.active ? "page" : undefined}
        onClick={event => { if (!link.external && isPlainNavigationClick(event)) { event.preventDefault(); navigate(link.href); } }}>
        <span>{link.label[locale]}</span>{link.external && <span aria-hidden="true">↗</span>}</a>)}</div>
    <button ref={toggleRef} type="button" className="h112-sections-toggle" data-active={activeHidden || undefined}
      aria-label={NAVIGATION_LABELS.sections[locale]} aria-expanded={open} aria-controls={`${id}-sections`} onClick={() => setOpen(value => !value)}>
      <span>{overflowLabel}</span>{overflowed.length > 0 && <span className="h112-more-count" aria-hidden="true">{overflowed.length}</span>}<span aria-hidden="true" className="h112-more-caret">{open ? "−" : "+"}</span>
    </button>
    {createPortal(<div ref={panelRef} id={`${id}-sections`} className="h112-sections-panel" hidden={!open}>
      <div className="h112-sections-head"><div><strong>{NAVIGATION_LABELS.sections[locale]}</strong>{active && <p>{uiText(locale, "Current section: ", "بخش فعلی: ")}{active.label[locale]}</p>}</div>
        <button className="h112-sections-close" type="button" onClick={close} aria-label={uiText(locale, "Close sections", "بستن بخش‌ها")}>×</button>
      </div>
      {showAppearanceTools && <MobileLayoutSwitcher locale={locale}/>}
      <FrontendSwitcherEntry locale={locale}/>
      <SectionSearch id={id} locale={locale} query={query} setQuery={setQuery} inputRef={searchRef}/>
      <SectionGroups groups={filterNavigation(groups, query)} locale={locale} navigate={path => { close(); navigate(path); }}/>
    </div>, rootRef.current?.closest("header") ?? document.body)}
  </nav>;
}

export function HierarchicalNavigation({ route, locale, navigate, showAppearanceTools = false }: NavigationProps & { showAppearanceTools?: boolean }) {
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); setQuery(""); }, [route, locale]);
  const allGroups = navigationGroups("heritage", route, locale);
  const active = allGroups.flatMap(group => group.links).find(link => link.active);
  return <aside className="h102-sidebar" data-open={mobileOpen} aria-label={NAVIGATION_LABELS.sidebar[locale]} onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (query) { event.preventDefault(); event.stopPropagation(); setQuery(""); searchRef.current?.focus(); }
    else if (mobileOpen) { event.preventDefault(); event.stopPropagation(); setMobileOpen(false); toggleRef.current?.focus(); }
  }}>
    <button ref={toggleRef} type="button" className="h102-mobile-toggle" aria-expanded={mobileOpen} aria-controls={`${id}-body`}
      onClick={() => setMobileOpen(value => !value)}><span>{NAVIGATION_LABELS.sections[locale]}{active && <small>{active.label[locale]}</small>}</span><span aria-hidden="true">{mobileOpen ? "−" : "+"}</span></button>
    <div className="h102-sidebar-body" id={`${id}-body`}>
      {showAppearanceTools && <MobileLayoutSwitcher locale={locale}/>}
      <FrontendSwitcherEntry locale={locale}/>
      <SectionSearch id={id} locale={locale} query={query} setQuery={setQuery} inputRef={searchRef}/>
      <div className="h102-context" id="h102-context"/>
      <nav aria-label={NAVIGATION_LABELS.sections[locale]}><SectionGroups groups={filterNavigation(allGroups, query)} locale={locale}
        searching={Boolean(query.trim())} collapsible navigate={path => { if (mobileOpen) { setMobileOpen(false); toggleRef.current?.focus(); } navigate(path); }}/></nav>
    </div>
  </aside>;
}

/** The same mounted controls move only on desktop; mobile controls stay inline. */
export function ContextNavigation({ children, slot = "h102-context" }: { children: ReactNode; slot?: string }) {
  const { homeRef, portalHost } = useContextNavigationHost("heritage", slot);
  return <><div ref={homeRef} className="h112-context-home"/>{portalHost && createPortal(children, portalHost)}</>;
}
