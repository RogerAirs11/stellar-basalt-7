import { useEffect, useRef } from 'react';
import { retroText } from '../i18n/messages';
import { ChevronDown } from 'lucide-react';
import { navigationGroups, useFittedTabIndices, type NavigationGroup } from '../../../../../frontend-kit';
import { usePreferences } from '../preferences/PreferencesProvider';

/** Canonical destinations; this skin owns only labels, grouping and presentation. */
export function NavigationGroups({ groups, query = '', close }: { groups: NavigationGroup[]; query?: string; close: () => void }) {
  const { language } = usePreferences();
  return <>{groups.map((group, index) => <details className="astra-nav-group" data-group={group.id} key={`${group.id}:${query ? 'search' : group.links.some(link => link.active) ? 'current' : 'other'}`} open={!!query || group.links.some(link => link.active) || index === 0}>
    <summary>{group.label[language]} <span className="nav-group-count" aria-hidden="true">{group.links.length}</span></summary>
    <div className="side-nav">{group.links.map(link => <a href={link.href} key={link.id} onClick={close} aria-current={link.active ? 'page' : undefined} className={link.active ? 'active' : ''}><span>{link.label[language]}</span>{link.external && <span aria-hidden="true">↗</span>}</a>)}</div>
  </details>)}</>;
}

export function PrimaryNavigation({ route }: { route: string }) {
  const { language } = usePreferences();
  const root = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const groups = navigationGroups('retro-astra', route, language);
  const links = groups.flatMap(group => group.links);
  const fitted = useFittedTabIndices(row, measure, disclosure, links.length,
    { activeIndex: links.findIndex(link => link.active), revision: language, gap: 4, alwaysShowMore: false });
  const shown = links.filter((_, index) => fitted.includes(index));
  const overflowed = links.filter((_, index) => !fitted.includes(index));
  const shownIds = new Set(shown.map(link => link.id));
  const overflowGroups = groups
    .map(group => ({ ...group, links: group.links.filter(link => !shownIds.has(link.id)) }))
    .filter(group => group.links.length);
  const current = overflowGroups.flatMap(group => group.links).find(link => link.active);
  const close = () => { if (disclosure.current) disclosure.current.open = false; };
  useEffect(close, [route, language]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <nav ref={root} className="primary-nav astra-primary" aria-label={retroText(language, 'Primary navigation', 'پیمایش اصلی')} onKeyDown={event => {
    if (event.key === 'Escape' && disclosure.current?.open) { event.preventDefault(); event.stopPropagation(); close(); disclosure.current.querySelector('summary')?.focus(); }
  }}><div ref={row} className="primary-nav-inner">
    {/* Hidden measurement twin: always fully rendered so every tab's intrinsic width stays observable. */}
    <div ref={measure} className="astra-primary-measure" aria-hidden="true">{links.map(link => <span key={link.id}>{link.label[language]}</span>)}</div>
    {shown.map(link => <a key={link.id} href={link.href} className={link.active ? 'active' : ''} aria-current={link.active ? 'page' : undefined}>{link.label[language]}</a>)}
    {overflowGroups.length > 0 && <details ref={disclosure} className="astra-more"><summary className={current ? 'is-current' : ''} title={current?.label[language]}>{retroText(language, 'More', 'بیشتر')}{overflowed.length > 0 && <span className="astra-more-count" aria-hidden="true">{overflowed.length}</span>}<ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="astra-more-panel"><NavigationGroups groups={overflowGroups} close={close} /><button type="button" className="astra-nav-close" onClick={() => { close(); disclosure.current?.querySelector('summary')?.focus(); }}>{retroText(language, 'Close sections', 'بستن فهرست')}</button></div>
    </details>}
  </div></nav>;
}
