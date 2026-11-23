import { formatRegistryDate } from '../../../../registry/dates';
import { ArrowDown, ArrowUp, ArrowUpRight, GitBranch, HeartHandshake, AlertTriangle, Link2, Tag, Workflow } from 'lucide-react';
import { useState } from 'react';
import { shownSex, px, type Horse, ageText, coatLabel, coatSwatch, sexDisplay } from '../data';
import { idsOf, primaryTrust } from '../records';
import { useI18n } from '../i18n';
import { Img, PanelHeader, Segmented, SexDot, TrustBadge, trustBar } from './ui';
import { MiniPedigree } from './Pedigree';
import { useBreeding } from '../store';
import { go, useElementSize } from '../lib';
import { cn } from '../utils/cn';

export const statusDot = (h: Horse) => h.registryFacts?'bg-slate-300':trustBar(primaryTrust(h));

/* ---------- dense sortable table ----------
   Columns appear according to the width of the TABLE itself (container queries), so it stays
   tidy whether or not the filter rail and the preview column are open.
   R157 priority order: the two facts the owner named as mattering most — the
   horse's name and the owner's name — come first and show up at the narrowest
   container widths; everything else is adaptive and yields as space shrinks.
   The first column carries ONLY the horse name (registry number got its own
   column — nothing is crammed underneath the name any more). */
export type SortKey = 'recent' | 'name' | 'age' | 'height' | 'breed' | 'location' | 'status';
interface TableProps { rows: Horse[]; sort: SortKey; dir: 1 | -1; onSort: (k: SortKey) => void; via?: (id: string) => string | undefined; selId?: string; onPick?: (id: string) => void }

export function HorseTable({ rows, sort, dir, onSort, via, selId, onPick }: TableProps) {
  const { tr, tx, n } = useI18n();
  const th = 'whitespace-nowrap py-2 text-start align-middle text-[10px] font-bold uppercase leading-4 tracking-wider text-fg-navy-500';
  const Th = ({ k, label, cls }: { k: SortKey; label: string; cls?: string }) => (
    <th className={cn('whitespace-nowrap px-2 py-2 text-start align-middle', cls)} aria-sort={sort === k ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 text-[10px] font-bold uppercase leading-4 tracking-wider transition hover:text-fg-sky-700', sort === k ? 'text-fg-sky-700' : 'text-fg-navy-500')}>
        {label}{sort === k && (dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
  return (
    <div className="panel @container overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr className="border-b border-line">
            <Th k="name" label={tx('Horse', 'اسب')} cls="ps-3" />
            <th className={cn(th, 'hidden px-2 @xs:table-cell')}>{tx('Owner', 'مالک')}</th>
            <Th k="age" label={tx('Sex · Age', 'جنس · سن')} />
            <Th k="breed" label={tx('Breed', 'نژاد')} cls="hidden @xl:table-cell" />
            <th className={cn(th, 'hidden px-2 @2xl:table-cell')}>{tx('Colour', 'رنگ')}</th>
            <Th k="location" label={tx('Location', 'محل')} cls="hidden @3xl:table-cell" />
            <th className={cn(th, 'hidden px-2 @3xl:table-cell')}>{tx('Reg. no.', 'شماره ثبت')}</th>
            <th className={cn(th, 'hidden px-2 @5xl:table-cell')}>{tx('Microchip', 'میکروچیپ')}</th>
            <Th k="status" label={tx('Status', 'وضعیت')} cls="pe-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            const on = selId === h.id;
            return (
              <tr key={h.id} aria-selected={on} title={onPick ? tx('Click to preview · click again to open', 'یک‌بار کلیک برای پیش‌نمایش · دوباره برای باز کردن') : undefined} onClick={() => (onPick ? onPick(h.id) : go(`/horses/${h.id}`))}
                className={cn('group cursor-pointer border-b border-line/70 transition-colors last:border-0', on ? 'bg-sky-100/70' : 'hover:bg-sky-50/70')} style={{ animation: `enter .35s ${Math.min(i, 14) * 18}ms both` }}>
                <td className={cn('relative py-1.5 ps-3', on && 'before:absolute before:inset-y-1 before:start-0 before:w-[3px] before:rounded-full before:bg-sky-500')}>
                  <a href={`#/horses/${h.id}`} className="flex items-center gap-2.5" onClick={(e) => { if (onPick) e.preventDefault(); else e.stopPropagation(); }}>
                    <Img src={px(h.photo, 80, 80)} alt="" pos={h.pos} className="h-8 w-8 shrink-0 rounded-lg" />
                    <span className="flex min-w-0 items-center gap-1.5 leading-tight">
                      <span className="truncate font-bold text-fg-navy-900 group-hover:text-fg-sky-800">{tr(h.name)}</span>
                      {h.sale && <Tag className="h-3 w-3 shrink-0 text-fg-gold-600" />}
                      {via?.(h.id) && <i className="shrink-0 font-sans text-[10px] font-semibold not-italic text-fg-gold-700" title={via(h.id)}>· {via(h.id)}</i>}
                    </span>
                  </a>
                </td>
                <td className="hidden px-2 text-fg-navy-600 @xs:table-cell"><span className="block max-w-[150px] truncate" title={tr(h.owner)}>{tr(h.owner)}</span></td>
                <td className="whitespace-nowrap px-2"><span className="flex items-center gap-1.5"><SexDot sex={shownSex(h)} />{n(ageText(h))}</span></td>
                <td className="hidden whitespace-nowrap px-2 text-fg-navy-700 @xl:table-cell">{tr(h.breed)}</td>
                <td className="hidden whitespace-nowrap px-2 @2xl:table-cell"><span className="flex items-center gap-1.5 text-fg-navy-700"><span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: coatSwatch(h) }} />{tr(coatLabel(h))}</span></td>
                <td className="hidden whitespace-nowrap px-2 text-fg-navy-700 @3xl:table-cell">{tr(h.location)}</td>
                <td className="hidden whitespace-nowrap px-2 font-mono text-[11px] text-fg-navy-500 @3xl:table-cell" dir="ltr">{h.regId}</td>
                <td className="hidden whitespace-nowrap px-2 font-mono text-[11px] text-fg-navy-500 @5xl:table-cell" dir="ltr">{idsOf(h).chip || '—'}</td>
                <td className="whitespace-nowrap px-2 pe-3">{!h.registryFacts && <TrustBadge level={primaryTrust(h)} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- photo gallery ---------- */
export function HorseGallery({ rows, selId, onPick }: { rows: Horse[]; selId?: string; onPick?: (id: string) => void }) {
  const { tr, n } = useI18n();
  return (
    <div className="auto-grid" style={{ '--min': '160px' } as React.CSSProperties}>
      {rows.map((h, i) => (
        <a key={h.id} href={`#/horses/${h.id}`} onClick={(e) => { if (onPick) { e.preventDefault(); onPick(h.id); } }} aria-current={selId === h.id}
          className={cn('group relative aspect-square overflow-hidden rounded-xl border shadow-sm', selId === h.id ? 'border-sky-500 ring-2 ring-sky-500/60' : 'border-line')} style={{ animation: `enter .4s ${Math.min(i, 20) * 20}ms both` }}>
          <Img src={px(h.photo, 400, 400)} alt={tr(h.name)} pos={h.pos} className="absolute inset-0 h-full w-full transition-transform duration-700 group-hover:scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
          <span className={cn('absolute start-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-white/70', statusDot(h))} />
          <SexDot sex={shownSex(h)} className="absolute end-2 top-2 !h-5 !w-5 shadow" />
          {h.sale && <Tag className="absolute end-2 bottom-9 h-3.5 w-3.5 text-od-gold-300" />}
          <div className="absolute inset-x-2 bottom-1.5 text-white"><div className="text-[13px] font-bold leading-tight drop-shadow">{tr(h.name)}</div><div className="text-[10px] text-white/75">{tr(h.breed)} · {n(ageText(h))}</div></div>
        </a>
      ))}
    </div>
  );
}

/* ---------- compact list (equal-width columns, so it stays tidy on wide screens too) ---------- */
export function HorseList({ rows, selId, onPick, via }: { rows: Horse[]; selId?: string; onPick: (id: string) => void; via?: (id: string) => string | undefined }) {
  const { tr, n } = useI18n();
  return (
    <ul className="auto-grid" style={{ '--min': '290px', gap: '0.5rem' } as React.CSSProperties}>
      {rows.map((h, i) => (
        <li key={h.id}>
          <button onClick={() => onPick(h.id)} aria-current={selId === h.id} className={cn('flex h-full w-full items-center gap-2.5 rounded-xl border p-2 text-start transition-all duration-200 max-sm:gap-2 max-sm:p-1.5', selId === h.id ? 'border-sky-400 bg-sky-100/70 shadow-sm' : 'border-line bg-surface hover:border-sky-300 hover:bg-sky-50/60')} style={{ animation: `enter .3s ${Math.min(i, 12) * 14}ms both` }}>
            <Img src={px(h.photo, 80, 80)} alt="" pos={h.pos} className="h-10 w-10 shrink-0 rounded-lg max-sm:h-9 max-sm:w-9" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-1.5"><span className="text-[13px] font-bold text-fg-navy-900">{tr(h.name)}</span>{h.sale && <Tag className="h-3 w-3 shrink-0 text-fg-gold-600" />}</span>
              <span className="block text-[11px] text-fg-navy-500"><span dir="ltr">{h.regId}</span> · {tr(h.breed)} · {n(ageText(h))}{via?.(h.id) && <i className="ms-1 font-semibold not-italic text-fg-gold-700">· {via(h.id)}</i>}</span>
            </span>
            <SexDot sex={shownSex(h)} />
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', statusDot(h))} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------- preview column: a quick look beside the list, sized to the height it is given ---------- */
export function HorsePreviewPane({ horse }: { horse: Horse }) {
  const { tr, tx, n, date, lang, cal } = useI18n();
  const { setS, setM } = useBreeding();
  const [ref, , h] = useElementSize<HTMLDivElement>();
  const [orient, setOrient] = useState<'h' | 'v'>(() => { try { return localStorage.getItem('eq-mini-orient') === 'v' ? 'v' : 'h'; } catch { return 'h'; } });
  const setO = (o: 'h' | 'v') => { setOrient(o); try { localStorage.setItem('eq-mini-orient', o); } catch { /* ignore */ } };
  const tier = !h || h >= 720 ? 0 : h >= 500 ? 1 : 2; // how much detail fits
  const SEXBAR = { stallion: 'bg-blue-500', mare: 'bg-rose-500', gelding: 'bg-slate-500' } as const;
  const SEXC = { stallion: 'bg-blue-100 text-fg-blue-800', mare: 'bg-rose-100 text-fg-rose-800', gelding: 'bg-slate-200 text-fg-slate-700' } as const;
  const facts: [string, React.ReactNode, boolean?][] = [
    [tx('Born', 'تولد'), horse.registryFacts ? horse.registryFacts.birth ? formatRegistryDate(horse.registryFacts.birth,cal==='jalali'?'solar_hijri':'gregorian',lang).text : '—' : date(horse.birth)],
    [tx('Colour', 'رنگ'), <span key="c" className="flex items-start gap-1.5"><span className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: coatSwatch(horse) }} />{tr(coatLabel(horse))}</span>],
    [horse.registryFacts ? tx('Birthplace','محل تولد') : tx('Kept at','محل'), tr(horse.location)],
    [tx('Owner', 'مالک'), tr(horse.owner), true],
  ];
  const shown = tier === 0 ? facts : tier === 1 ? facts.slice(0, 2) : [];
  return (
    <div ref={ref} key={horse.id} className="flex h-full min-h-0 animate-enter flex-col gap-2">
      <div className="panel relative shrink-0 overflow-hidden p-2.5">
        <span className={cn('absolute inset-y-0 start-0 w-[3px]', (shownSex(horse)?SEXBAR[horse.gender]:'bg-slate-300'))} />
        <div className="flex items-start gap-2.5 ps-1">
          <Img src={px(horse.photo, 120, 120)} alt={tr(horse.name)} pos={horse.pos} className="h-12 w-12 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[15px] font-semibold leading-tight text-fg-navy-900">{tr(horse.name)}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-navy-500"><span className="font-mono" dir="ltr">{horse.regId}</span><span>{tr(horse.breed)}</span></div>
          </div>
          {horse.sale && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-bold text-fg-gold-800" title={tx('For sale', 'فروشی')}><Tag className="h-3 w-3" />{n(horse.sale.priceM)}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 ps-1">
          {!horse.registryFacts && <TrustBadge level={primaryTrust(horse)} />}
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', (shownSex(horse)?SEXC[horse.gender]:'bg-slate-100'))}>{tr(sexDisplay(horse))}</span>
          <span className="text-[11px] font-semibold text-fg-navy-600">{n(ageText(horse))} {tx('yrs', 'سال')}{!horse.registryFacts && <> · {n(horse.height)} {tx('cm', 'سانتی‌متر')}</>}</span>
        </div>
        {shown.length > 0 && (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-2 ps-1">
            {shown.map(([k, v, wide]) => (
              <div key={k} className={cn('min-w-0', wide && 'col-span-2')}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-fg-navy-500">{k}</dt>
                <dd className="text-xs font-semibold leading-snug text-fg-navy-900">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {horse.carrier && <div className="mt-2 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-100/60 px-2 py-1 text-[11px] font-semibold text-fg-red-800"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{tx(`Carrier: ${horse.carrier.join(', ')}`, `ناقل: ${horse.carrier.join('، ')}`)}</div>}
        <div className="mt-2.5 flex gap-1.5">
          <a href={`#/horses/${horse.id}`} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700">{tx('Open full profile', 'پروفایل کامل')}<ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" /></a>
          {(horse.registryFacts ? horse.registryFacts.breedingSex && !horse.registryFacts.deceased : horse.gender !== 'gelding') && <button onClick={() => { if (horse.gender === 'mare') setM(horse.id); else setS(horse.id); go('/breeding'); }} aria-label={tx('Plan mating', 'جفت‌گیری')} title={tx('Plan mating', 'جفت‌گیری')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-field text-fg-fuchsia-700 transition hover:bg-surface-2"><HeartHandshake className="h-4 w-4" /></button>}
        </div>
      </div>

      <div className="panel flex min-h-[150px] flex-1 flex-col p-2.5">
        <PanelHeader phase="registry" icon={<Link2 />} title={tx('Pedigree', 'شجره‌نامه')} action={
          <span className="flex items-center gap-2">
            <Segmented<'h' | 'v'> label={tx('Layout', 'چیدمان')} value={orient} onChange={setO} phase="registry" iconOnly items={[{ v: 'h', l: tx('Horizontal', 'افقی'), icon: <Workflow /> }, { v: 'v', l: tx('Vertical', 'عمودی'), icon: <GitBranch /> }]} />
            <a href={`#/horses/${horse.id}/pedigree`} className="whitespace-nowrap text-[11px] font-semibold text-fg-sky-700 hover:underline">{tx('Full', 'کامل')} →</a>
          </span>} />
        <div className="relative min-h-0 flex-1"><MiniPedigree horse={horse} orient={orient} /></div>
      </div>
    </div>
  );
}
