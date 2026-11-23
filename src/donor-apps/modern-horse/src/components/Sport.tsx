import { useState } from 'react';
import { DISCIPLINE_L, RIDERS, type PerfYear, type Result } from '../data';
import { resultMeta } from '../records';
import { useI18n } from '../i18n';
import { useInView } from '../lib';
import { cn } from '../utils/cn';

const placeStyle = (p: number) =>
  p === 1
    ? 'bg-gradient-to-br from-od-gold-300 to-gold-500 text-white shadow-md shadow-gold-500/30'
    : p === 2
      ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-white'
      : p === 3
        ? 'bg-gradient-to-br from-amber-600 to-amber-800 text-white'
        : 'bg-surface-2 text-fg-navy-500 ring-1 ring-line';

/** Timeline row: date · event · placing */
export function ResultRow({ r, index = 0, compact = false, meta = false }: { r: Result; index?: number; compact?: boolean; meta?: boolean }) {
  const { tr, date, place, tx } = useI18n();
  const m = meta ? resultMeta(r) : null;
  const rider = RIDERS.find((x) => x.id === r.rider);
  return (
    <div className="group relative flex items-center gap-2.5 rounded-xl p-2 transition hover:bg-surface-2" style={{ animation: `enter .5s cubic-bezier(.22,1,.36,1) ${index * 80}ms both` }}>
      <div className="relative flex w-3 shrink-0 self-stretch justify-center">
        <span className="absolute inset-y-[-8px] w-px bg-line group-first:top-1/2 group-last:bottom-1/2" />
        <span className={cn('relative top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-4 ring-surface', r.place <= 3 ? 'bg-gold-500' : 'bg-navy-400')} />
      </div>
      <div className={cn('shrink-0 text-[11px] font-semibold leading-tight text-fg-navy-500', compact ? 'w-12' : 'w-24 sm:w-28 sm:text-xs')}>{compact ? <><span className="block text-sm font-bold text-fg-navy-800">{date(r.date).split(' ')[0]}</span>{date(r.date, 'month')} {date(r.date, 'year')}</> : date(r.date)}</div>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px] font-bold text-fg-navy-900', compact ? 'line-clamp-2 leading-tight' : 'truncate')}>{tr(r.name)}</div>
        <div className="truncate text-[11px] text-fg-navy-500">
          {tr(DISCIPLINE_L[r.discipline])}{!compact && <> · {tr(r.venue)}</>}
          {rider && !compact && <span className="hidden sm:inline"> · {tx('Rider', 'سوارکار')}: {tr(rider.name)}</span>}
        </div>
        {m && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold"><ResStatusPill status={m.status} source={m.source} /><span className="font-medium text-navy-400">{tx('matched by', 'تطبیق با')} {m.matchedBy === 'microchip' ? tx('microchip', 'میکروچیپ') : m.matchedBy === 'passport' ? tx('passport', 'پاسپورت') : tx('name only', 'فقط نام')}</span></div>}
      </div>
      <span className={cn('grid h-7 min-w-[2.6rem] place-items-center rounded-full px-2.5 text-[11px] font-bold', placeStyle(r.place))}>{place(r.place)}</span>
    </div>
  );
}

/** Animated grouped bar chart */
export function PerformanceChart({ data }: { data: PerfYear[] }) {
  const { n, tx } = useI18n();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.starts)) + 1;
  return (
    <div ref={ref}>
      <div className="mb-4 flex items-center gap-4 text-xs text-fg-navy-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-navy-800" />{tx('Starts', 'شرکت')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gold-400" />{tx('Podiums', 'سکو')}</span>
      </div>
      <div className="relative flex h-44 items-end justify-around gap-2 border-b border-line px-1">
        {[0.25, 0.5, 0.75].map((g) => (
          <span key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />
        ))}
        {data.map((d, i) => (
          <div key={d.year} className="relative flex h-full flex-1 items-end justify-center gap-1.5" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {[
              { v: d.starts, c: 'from-navy-700 to-navy-900' },
              { v: d.podiums, c: 'from-od-gold-300 to-gold-500' },
            ].map((b, j) => (
              <div
                key={j}
                className={cn('relative w-5 origin-bottom rounded-t-lg bg-gradient-to-t transition-opacity sm:w-6', b.c, hover !== null && hover !== i && 'opacity-40')}
                style={{ height: `${(b.v / max) * 100}%`, transform: inView ? 'scaleY(1)' : 'scaleY(0)', transition: `transform 1s cubic-bezier(.22,1,.36,1) ${i * 130 + j * 80}ms, opacity .3s` }}
              />
            ))}
            {hover === i && (
              <div className="absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg bg-navy-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
                {n(d.starts)} {tx('starts', 'شرکت')} · {n(d.podiums)} {tx('podiums', 'سکو')}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-around text-xs font-medium text-fg-navy-500">
        {data.map((d) => (
          <span key={d.year} className="flex-1 text-center">{n(String(d.year))}</span>
        ))}
      </div>
    </div>
  );
}

export function ResStatusPill({ status, source }: { status: 'verified' | 'imported' | 'pending'; source?: string }) {
  const { tx } = useI18n();
  const m = {
    verified: ['bg-emerald-100 text-fg-emerald-800 ring-emerald-200', tx('Verified by organiser / federation', 'تأییدشده توسط برگزارکننده / فدراسیون')],
    imported: ['bg-sky-100 text-fg-sky-800 ring-sky-200', `${tx('Imported from', 'دریافت‌شده از')} ${source ?? ''}`],
    pending: ['bg-amber-100 text-fg-amber-800 ring-amber-200', tx('Pending verification', 'در انتظار تأیید')],
  }[status];
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', m[0])}>{m[1]}</span>;
}
