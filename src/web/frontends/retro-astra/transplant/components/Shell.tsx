import { NAVIGATION_LABELS, navigationGroups, filterNavigation, useNavigationLayout } from "../../../../../frontend-kit";
import { retroText } from '../i18n/messages';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronDown, ChevronRight, Database, Keyboard, LayoutList, Menu, Moon, Palette, Search, ShieldCheck, Sun, Type, X } from 'lucide-react';
import { useWorkspace } from '../lib/Workspace';
import { usePreferences } from '../preferences/PreferencesProvider';
import type { Route } from '../lib/hooks';
import { HorseMark, IconButton } from './ui';
import { DeskIcon } from './DeskIcon';
import { DeskMenus, WorkspaceShortcuts } from './DeskTools';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { NavigationGroups, PrimaryNavigation } from './GroupedNavigation';

function Sidebar({ route, close, mobileOpen }: { route: Route; close: () => void; mobileOpen: boolean }) {
  const { openModal } = useWorkspace();
  const { t, language } = usePreferences();
  const [navQuery,setNavQuery]=useState('');
  const ref = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const clearSearch = () => { setNavQuery(''); searchRef.current?.focus(); };
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const main = document.getElementById('main-content');
    const oldInert = main?.inert ?? false;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (main) main.inert = true;
    ref.current?.querySelector<HTMLElement>('button, a')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, summary') ?? []).filter(element => element.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', trap);
    return () => { window.removeEventListener('keydown', trap); if (main) main.inert = oldInert; document.body.style.overflow = oldOverflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [mobileOpen]);
  const navGroups=filterNavigation(navigationGroups("retro-astra",location.hash||"#/",language),navQuery);
  return <aside className="sidebar" id="retro-sidebar" ref={ref} aria-label={t('deskIndex')} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (navQuery) { event.preventDefault(); event.stopPropagation(); clearSearch(); }
    else if (mobileOpen) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="sidebar-mobile-close"><span>{t('deskIndex')}</span><IconButton label={t('closeNavigation')} onClick={close}><X size={20}/></IconButton></div>
    <div className="sidebar-nameplate"><span className="metal-screw"/><span>{t('deskIndex')}</span><span className="metal-screw"/></div>
    <div className="astra102-navigation">
      <div className="astra102-find"><label htmlFor="astra102-search">{NAVIGATION_LABELS.search[language]}</label>
        <div className="astra102-search-controls"><input ref={searchRef} id="astra102-search" type="search" value={navQuery} maxLength={120} onChange={event=>setNavQuery(event.target.value)}/>
          <button type="button" disabled={!navQuery} aria-label={NAVIGATION_LABELS.clearSearch[language]} onClick={clearSearch}><span aria-hidden="true">&#215;</span></button>
        </div>
      </div>
      <div id="astra102-context"/>
      <nav aria-label={NAVIGATION_LABELS.sections[language]}><NavigationGroups groups={navGroups} query={navQuery} close={close}/></nav>
      {navGroups.length===0&&<p role="status">{NAVIGATION_LABELS.empty[language]}</p>}
    </div>
    <div className="sidebar-bottom">
      <button className="field-guide" onClick={() => { close(); openModal({ type: 'help' }); }}><span className="guide-book-spine"/><span className="guide-book-content"><span className="guide-volume">{t('companion')}</span><DeskIcon name="guide" size={35}/><strong>{t('littleGuide')}</strong><span className="guide-book-bottom">{t('guideSubtitle')}<ChevronRight size={12} className="directional"/></span></span></button>
      <span className="sidebar-footnote"><ShieldCheck size={13}/>{t('ownCorner')}</span>
    </div>
  </aside>;
}
export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { name, horses, openModal, density, setDensity, setFocusMode, readingSize, setReadingSize, viewport } = useWorkspace();
  const { total, runtime, loading, error } = useHorseDbAdapter();
  const { t, text, n, date, language, setLanguage, mode, toggleMode } = usePreferences();
  const {layout:navigationLayout,setLayout:setNavigationLayout}=useNavigationLayout("retro-astra","sidebar");
  useEffect(()=>{if(navigationLayout==="sidebar")setFocusMode(false)},[navigationLayout,setFocusMode]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const section = navigationGroups('retro-astra', location.hash || '#/', language).flatMap(group => group.links).find(link => link.active);
  const title = route.page === 'profile' ? text(horses.find(horse => horse.id === route.id)?.name ?? '') : section?.label[language] ?? t('welcome');
  const initials = text(name).split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMobileOpen(false); setActivityOpen(false); } };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  useEffect(() => { setMobileOpen(false); setActivityOpen(false); }, [route.page, route.id, route.query, route.filter, route.person]);
  useEffect(() => { if (!viewport.narrow) setMobileOpen(false); }, [viewport.narrow]);
  return (
    <div className="desk-surround" data-navigation-layout={navigationLayout}><div className="app-shell">
      <WorkspaceShortcuts/>
      <a href="#main-content" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t('skipContent')}</a>
      <div className="desk-menubar" role="region" aria-label={retroText(language, 'Desk menu', 'منوی میز کار')}><span className="desktop-app-label"><HorseMark/>{t('appName')}<span>/ {t('appSubtitle')}</span></span><DeskMenus/><span className="edition-label"><span className="status-dot"/>{t('personalEdition')}<span className="edition-number">{n(3, { minimumIntegerDigits: 2 })}</span></span></div>
      <header className="site-header"><div className="header-inner">
        <a href="#/" className="brand"><span className="brand-seal"><span className="seal-rim"/><HorseMark/></span><span><span className="brand-name">{t('appName')}<span className="brand-period">.</span></span><span className="brand-tagline">{t('tagline')}</span></span></a>
        <button className="global-search" onClick={() => openModal({ type: 'command' })} title={t('searchCommands')}><Search size={18}/><span>{t('searchPlaceholder')}</span><kbd dir="ltr">Ctrl K</kbd></button>
        <div className="header-tools">
          <div className="appearance-quick-controls"><IconButton label={t('appearance')} className="header-tool" onClick={() => openModal({ type: 'settings' })}><Palette size={17}/></IconButton><IconButton label={t('toggleMode', { mode: t(mode === 'light' ? 'dark' : 'light') })} className="header-tool" onClick={toggleMode}>{mode === 'light' ? <Moon size={16}/> : <Sun size={16}/>}</IconButton><button className="language-switch" onClick={() => setLanguage(language === 'en' ? 'fa' : 'en')} aria-label={`${language === 'en' ? 'فا' : 'EN'} · ${t('switchLanguage')}`} lang={language === 'en' ? 'fa' : 'en'}>{language === 'en' ? 'فا' : 'EN'}</button></div>
          <div className="notification-anchor"><IconButton label={t('activity')} className={`header-tool ${activityOpen ? 'is-open' : ''}`} onClick={() => setActivityOpen(!activityOpen)}><Bell size={17}/><span className="notification-dot"/></IconButton>{activityOpen && <><button className="popover-dismiss" aria-label={t('close')} onClick={() => setActivityOpen(false)}/><div className="activity-popover"><div className="popover-title">{t('fromDesk')}<IconButton label={t('close')} onClick={() => setActivityOpen(false)}><X size={15}/></IconButton></div><div className="activity-popover-item"><Check size={17}/><span><strong>{t('wellKeptWorkspace')}</strong><small>{loading ? 'Loading canonical registry…' : error ? error : t('demoCount', { count: total })}</small></span></div><a href="#/collections/governance" onClick={() => setActivityOpen(false)}><DeskIcon name="guide" size={24}/><span><strong>{runtime.user?.display_name ?? 'Public desk'}</strong><small>{runtime.user ? 'Authenticated Horse DB session' : 'Public / read-only session'}</small></span></a><p className="popover-footnote">{t('privateBrowser')}</p></div></>}</div>
          <button className="account-button" onClick={() => openModal({ type: 'settings' })} title={t('preferences')}><span className="account-label"><small>{t('deskOf')}</small><strong>{text(name)}</strong></span><span className="avatar">{initials}</span><ChevronDown size={12}/></button>
          <IconButton label={mobileOpen ? t('closeNavigation') : t('openNavigation')} className="mobile-menu" aria-controls="retro-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={21}/> : <Menu size={21}/>}</IconButton>
        </div>
      </div></header>
      <PrimaryNavigation route={location.hash || '#/'} />
      <div className="workspace-location" role="region" aria-label={retroText(language, 'Workspace context and reading preferences', 'موقعیت و تنظیمات خوانایی')}><div className="location-inner"><div className="breadcrumb"><span className="status-dot"/><a href="#/">{t('workspace')}</a><ChevronRight size={10} className="directional"/><span>{title}</span></div><div className="workspace-view-tools"><label className="density-control"><select aria-label={NAVIGATION_LABELS.layout[language]} value={navigationLayout} onChange={event=>{const next=event.target.value==="sidebar"?"sidebar":"tabs";setNavigationLayout(next);if(next==="sidebar")setFocusMode(false);}}><option value="tabs">{NAVIGATION_LABELS.tabs[language]}</option><option value="sidebar">{NAVIGATION_LABELS.sidebar[language]}</option></select></label><span className="workspace-date">{date(new Date(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><span className="toolbar-divider"/><label className="density-control"><LayoutList size={13}/><select aria-label={t('layout')} value={density} onChange={event => setDensity(event.target.value as typeof density)}>{(['adaptive', 'compact', 'comfortable'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><IconButton label={readingSize ? t('standardText') : t('largerText')} aria-pressed={readingSize} className={readingSize ? 'active' : ''} onClick={() => setReadingSize(!readingSize)}><Type size={14}/><span className="reading-plus">+</span></IconButton></div></div></div>
      <div className={`workspace-layout ${mobileOpen ? 'is-mobile-open' : ''}`}>
        {mobileOpen && <button className="sidebar-scrim" aria-label={t('closeNavigation')} onClick={() => setMobileOpen(false)}/>}
        <Sidebar route={route} close={() => setMobileOpen(false)} mobileOpen={mobileOpen}/>
        <main className="workspace-main" id="main-content" tabIndex={-1}>{children}</main>
      </div>
      <footer className="status-bar"><div><span className="status-dot"/><strong>{t('localReady')}</strong><span className="footer-divider"/><Database size={12}/><span>{t('recordsCount', { count: total })}</span><span className="footer-divider footer-storage"/><span className="footer-storage">{t('savedBrowser')}</span></div><button onClick={() => openModal({ type: 'command' })}><Keyboard size={12}/><span>{t('findAnything')}</span><kbd dir="ltr">Ctrl K</kbd></button><span className="footer-motto">{density === 'adaptive' ? t('fitStatus', { width: viewport.width, height: viewport.height }) : t('footerMotto')}</span><button className="footer-appearance" onClick={() => openModal({ type: 'settings' })} aria-label={t('appearance')}><Palette size={14}/></button></footer>
    </div></div>
  );
}