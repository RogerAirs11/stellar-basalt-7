import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CornerDownLeft, Eye, GitFork, Keyboard, LayoutList, Palette, PanelLeftClose, Search, Type, X } from 'lucide-react';
import { useWorkspace } from '../lib/Workspace';
import { usePreferences } from '../preferences/PreferencesProvider';
import { navigate } from '../lib/hooks';
import { searchHorses, type Horse } from '../data/horses';
import { toDonorHorse } from '../HorseDbAdapter';
import { normalizeSearch } from '../i18n/domain';
// R117-29: canonical record-first sex display labels.
import { horseSexLabel } from '../../../../../frontend-kit';
import { Button, IconButton, Modal, SexBadge, Status } from './ui';
import { DeskIcon, type DeskIconName } from './DeskIcon';
import { useHorseDbAdapter } from '../HorseDbAdapter';

export function DeskMenus() {
  const { openModal, density, setDensity, focusMode, setFocusMode, readingSize, setReadingSize } = useWorkspace();
  const { runtime }=useHorseDbAdapter();
  const { t, language } = usePreferences();
  const [open, setOpen] = useState<'file' | 'view' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const act = (action: () => void) => { action(); setOpen(null); };
  const exportRegistry=()=>{const item=runtime.platform.exports.registry({},'csv'); const a=document.createElement('a');a.href=item.href;a.download=item.filename;document.body.appendChild(a);a.click();a.remove();};
  return <div className="desk-menus" ref={ref}>
    <div className="desk-menu-anchor"><button className={open === 'file' ? 'is-open' : ''} onClick={() => setOpen(open === 'file' ? null : 'file')} aria-expanded={open === 'file'}>{t('file')}</button>
      {open === 'file' && <div className="desk-menu-popover"><span className="menu-category">{language==='fa'?'سامانه اسب':'Horse registry'}</span><button onClick={() => act(exportRegistry)}><ArrowDownToLine size={15}/><span>{t('exportRegistry')}</span></button><button onClick={() => act(()=>navigate('/collections/governance'))}><DeskIcon name="guide" size={18}/><span>{language==='fa'?'حساب و مدیریت':'Account & administration'}</span></button></div>}
    </div>
    <div className="desk-menu-anchor"><button className={open === 'view' ? 'is-open' : ''} onClick={() => setOpen(open === 'view' ? null : 'view')} aria-expanded={open === 'view'}>{t('view')}</button>
      {open === 'view' && <div className="desk-menu-popover"><span className="menu-category">{t('makeRoom')}</span>{(['adaptive', 'compact', 'comfortable'] as const).map(value => <button key={value} onClick={() => act(() => setDensity(value))}><LayoutList size={15}/><span>{t(value)}</span>{density === value && <span>✓</span>}</button>)}<div className="menu-separator"/><button onClick={() => act(() => setReadingSize(!readingSize))}><Type size={15}/><span>{t('largerText')}</span>{readingSize && <span>✓</span>}</button><button onClick={() => act(() => setFocusMode(!focusMode))}><PanelLeftClose size={15}/><span>{t('focusMode')}</span>{focusMode && <span>✓</span>}</button><div className="menu-separator"/><button onClick={() => act(() => openModal({ type: 'settings' }))}><Palette size={15}/><span>{t('appearance')}</span></button></div>}
    </div>
    <button onClick={() => openModal({ type: 'command' })}>{t('goTo')}</button><button onClick={() => openModal({ type: 'help' })}>{t('help')}</button>
  </div>;
}

export function WorkspaceShortcuts() {
  const { openModal, closeModal, modal } = useWorkspace();
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') { event.preventDefault(); if (modal?.type === 'command') closeModal(); else if (!modal) openModal({ type: 'command' }); return; }
      if (modal) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.altKey && /^Digit[1-5]$/.test(event.code)) { event.preventDefault(); navigate(['/', '/horses', '/pedigree', '/collections', '/insights'][Number(event.code.slice(-1)) - 1]); }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); openModal({ type: 'command' }); }
      if (event.key === '?') { event.preventDefault(); openModal({ type: 'help' }); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [openModal, closeModal, modal]);
  return null;
}

interface CommandItem { id: string; title: string; detail: string; icon?: DeskIconName; image?: string; shortcut?: string; run: () => void }
export function CommandPalette() {
  const { horses, closeModal, openModal } = useWorkspace();
  const { runtime }=useHorseDbAdapter();
  const { t, text, n, language } = usePreferences();
  const [query, setQuery] = useState(''); const [active, setActive] = useState(0); const input = useRef<HTMLInputElement>(null);
  // R32: the palette searches the LIVE canonical registry (78k records) through
  // the platform search API instead of only the ~24 in-memory rows.
  const [remote, setRemote] = useState<Horse[]>([]);
  useEffect(() => {
    const trimmed = query.trim();
    setRemote([]);
    if (!trimmed) { setRemote([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      runtime.platform.search.horses(trimmed, { limit: 6, signal: controller.signal })
        .then(response => { if (!controller.signal.aborted) setRemote(response.results.map(row => toDonorHorse(row))); })
        .catch(() => { if (!controller.signal.aborted) setRemote([]); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, runtime.platform]);
  const go=(path:string)=>{closeModal();navigate(path);};
  const exportRegistry=()=>{const item=runtime.platform.exports.registry({},'csv'); const a=document.createElement('a');a.href=item.href;a.download=item.filename;document.body.appendChild(a);a.click();a.remove();closeModal();};
  const bilingual=(en:string,fa:string)=>language==='fa'?fa:en;
  const actions:CommandItem[]=[
    {id:'directory',title:t('directory'),detail:t('directoryHint'),icon:'registry',shortcut:'Alt 2',run:()=>go('/horses')},
    {id:'pedigree',title:t('pedigree'),detail:t('pedigreeHint'),icon:'pedigree',shortcut:'Alt 3',run:()=>go('/pedigree')},
    {id:'people',title:bilingual('People index','فهرست افراد'),detail:bilingual('Owners, breeders, importers and passport receivers','مالکان، پرورش‌دهندگان، واردکنندگان و تحویل‌گیرندگان گذرنامه'),icon:'collection',run:()=>go('/collections/people')},
    {id:'relationships',title:bilingual('Relationship desk','میز خویشاوندی'),detail:bilingual('Common ancestors and coefficients','نیاکان مشترک و ضرایب'),icon:'pedigree',run:()=>go('/collections/relationships')},
    {id:'breeding',title:bilingual('Breeding analysis','تحلیل پرورش'),detail:bilingual('Pedigree-only pairing analysis and optimizer','تحلیل جفت‌گیری صرفاً بر پایه تبارنامه'),icon:'report',run:()=>go('/collections/breeding')},
    {id:'governance',title:bilingual('Governance & admin','حاکمیت و مدیریت'),detail:bilingual('Claims, change requests, audit, quality and maintenance','ادعاها، درخواست تغییر، ممیزی، کیفیت و نگهداری'),icon:'guide',run:()=>go('/collections/governance')},
    {id:'insights',title:t('insights'),detail:t('insightsHint'),icon:'report',shortcut:'Alt 5',run:()=>go('/insights')},
    {id:'appearance',title:t('appearance'),detail:t('appearanceHint'),icon:'home',run:()=>openModal({type:'settings'})},
    {id:'export',title:t('exportRegistry'),detail:bilingual('Canonical CSV export','خروجی CSV رسمی'),icon:'registry',run:exportRegistry},
  ];
  const matched = query.trim() ? (remote.length ? remote : searchHorses(horses, query)).slice(0, 6) : horses.slice(0, 3);
  const records:CommandItem[]=matched.map(horse=>({id:`horse-${horse.id}`,title:text(horse.name),detail:`${n(horse.year,{useGrouping:false})} / ${text(horse.breed)} / ${horseSexLabel(horse.recordedSex ?? horse.sex, language)}`,image:horse.image,run:()=>go(`/horses/${horse.id}`)}));
  const matchingActions=actions.filter(action=>!query||normalizeSearch(`${action.title} ${action.detail}`).includes(normalizeSearch(query))).slice(0,6);
  const items=[...records,...matchingActions]; const selected=Math.min(active,Math.max(0,items.length-1));
  useEffect(()=>{document.getElementById(`command-result-${active}`)?.scrollIntoView({block:'nearest'});},[active]);
  return <Modal title={t('commandTitle')} subtitle={t('commandSubtitle')} onClose={closeModal} className="command-dialog"><div className="command-input"><Search size={20}/><input dir="auto" ref={input} value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} placeholder={t('commandPlaceholder')} aria-label={t('searchCommands')} role="combobox" aria-expanded="true" aria-controls="retro-command-results" aria-activedescendant={items[selected]?`command-result-${selected}`:undefined} autoComplete="off" onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setActive(Math.min(items.length-1,selected+1));}if(event.key==='ArrowUp'){event.preventDefault();setActive(Math.max(0,selected-1));}if(event.key==='Enter'&&items[selected]){event.preventDefault();items[selected].run();}}}/>{query?<IconButton label={t('clear')} onClick={()=>{setQuery('');setActive(0);input.current?.focus();}}><X size={16}/></IconButton>:<kbd>Esc</kbd>}</div><div className="command-results" id="retro-command-results" role="listbox" aria-label={t('allRecords')}>{items.map((item,index)=><div key={item.id}>{(index===0||index===records.length)&&<div className="command-group-label">{index<records.length?t('allRecords'):t('aroundDesk')}</div>}<button role="option" aria-selected={index===selected} id={`command-result-${index}`} className={index===selected?'active':''} onMouseMove={()=>setActive(index)} onClick={item.run}>{item.image?<img src={item.image} alt=""/>:<DeskIcon name={item.icon??'registry'} size={31}/>}<span><strong>{item.title}</strong><small>{item.detail}</small></span>{item.shortcut?<kbd>{item.shortcut}</kbd>:<CornerDownLeft size={14}/>}</button></div>)}</div><div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd>{t('chooseKey')}</span><span><kbd>Enter</kbd>{t('openKey')}</span><span><Keyboard size={13}/>{t('fingertips')}</span></div></Modal>;
}

export function HorsePreview({horseId}:{horseId:string}){
  const {horses,closeModal}=useWorkspace(); const {t,text,n,language}=usePreferences(); const horse=horses.find(item=>item.id===horseId);
  if(!horse)return <Modal title={t('noRecord')} onClose={closeModal}><div className="quick-preview"><p>{t('noRecordBody')}</p></div></Modal>;
  return <Modal title={t('quickLook')} subtitle={horse.registration} onClose={closeModal}><div className="quick-preview"><img src={horse.image} alt=""/><div className="preview-identity"><SexBadge sex={horse.sex} recordedSex={horse.recordedSex}/><h3>{text(horse.name)}</h3><p>{n(horse.year,{useGrouping:false})} · {text(horse.breed)} · {text(horse.coat)}</p><Status status={horse.status}/></div><div className="preview-racing"><div><strong>{horse.recordedOffspring??'—'}</strong><span>{language==='fa'?'فرزند ثبت‌شده':'recorded offspring'}</span></div><div><strong>{horse.knownParents}</strong><span>{language==='fa'?'والد شناخته‌شده':'known parents'}</span></div><div><strong>{horse.pedigreeCompleteness==null?'—':`${Math.round(horse.pedigreeCompleteness)}%`}</strong><span>{language==='fa'?'کامل‌بودن تبار':'pedigree completeness'}</span></div></div><div className="form-footer"><Button onClick={closeModal}>{t('close')}</Button><Button variant="primary" onClick={()=>{closeModal();navigate(`/horses/${horse.id}`);}}><Eye size={14}/>{t('openRecord')}</Button></div></div></Modal>;
}
