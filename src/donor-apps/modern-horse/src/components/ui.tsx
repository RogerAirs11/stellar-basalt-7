import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Dna, FileSearch, FileUp, Lock, PenLine, ShieldCheck, UsersRound, Globe } from 'lucide-react';
import { TRUST_L, TRUST_ORDER, type TrustLevel } from '../records';
import { useCountUp, useInView } from '../lib';
import { useI18n } from '../i18n';
import { PHASE, type PhaseKey } from '../theme';
import { cn } from '../utils/cn';

/* ---------- Logo: roundel emblem + wordmark ---------- */
const HEAD = {
  // mane (accent), head silhouette, forelock, jaw, eye, nostril — authored on a 100 × 130 grid, facing right
  mane: 'M40 24C22 28 10 46 11 68C12 86 14 106 16 130L48 130C40 110 34 96 30 80C27 68 29 58 33 48C36 42 38 34 40 24Z',
  maneLines: ['M35 32C25 40 19 54 19 70C19 88 21 108 23 124', 'M39 44C31 54 27 66 28 80C29 96 31 110 33 124', 'M37 24C29 22 21 26 17 34'],
  head: 'M22 130C20 104 22 78 31 58C35 49 37 38 38 28L41 5C46 10 50 18 52 28C60 27 66 33 72 43C77 51 84 58 90 66C93 71 92 78 87 81C83 84 78 83 75 80C71 77 65 77 59 73C54 71 49 74 48 82C48 94 56 112 64 130Z',
  forelock: 'M50 26C54 31 56 38 54 46',
  jaw: 'M54 47C59 56 61 64 62 71',
  nostril: 'M83 71C85 72 87 74 87 76',
  mouth: 'M74 80C78 80 81 79 84 77',
  ear: 'M44 14C47 18 49 23 50 28',
};
const LAUREL = (side: 1 | -1) => Array.from({ length: 9 }, (_, i) => {
  const a = (90 + side * (11 + i * 11.6)) * (Math.PI / 180);
  const R = 41.5;
  const cx = 60 + R * Math.cos(a), cy = 60 + R * Math.sin(a);
  const rot = (a * 180) / Math.PI;
  return { cx, cy, rot, i };
});

export function Emblem({ size = 40, detail = false, className }: { size?: number; detail?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  const sc = detail ? 0.54 : 0.64;
  const tx = 60 - 52 * sc, ty = detail ? 18 : 11;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} aria-hidden fill="none">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-od-gold-200)' }} /><stop offset=".5" style={{ stopColor: 'var(--color-od-gold-300)' }} /><stop offset="1" style={{ stopColor: 'var(--color-gold-600)' }} />
        </linearGradient>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-od-gold-300)' }} /><stop offset="1" style={{ stopColor: 'var(--color-gold-600)' }} />
        </linearGradient>
        <radialGradient id={`f${id}`} cx=".5" cy=".32" r=".85">
          <stop offset="0" style={{ stopColor: 'var(--color-navy-600)' }} /><stop offset="1" style={{ stopColor: 'var(--color-navy-900)' }} />
        </radialGradient>
        <linearGradient id={`h${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dfe6e2" />
        </linearGradient>
        <clipPath id={`c${id}`}><circle cx="60" cy="60" r={detail ? 46.5 : 51} /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" stroke={`url(#g${id})`} strokeWidth={detail ? 2.4 : 3.4} />
      {detail && <circle cx="60" cy="60" r="54.4" stroke="var(--color-od-gold-300)" strokeWidth=".6" opacity=".75" />}
      <circle cx="60" cy="60" r={detail ? 53.6 : 54} fill={`url(#f${id})`} />
      {detail && Array.from({ length: 72 }, (_, i) => { const a = (i / 72) * Math.PI * 2, r1 = 49.6, r2 = i % 6 === 0 ? 52.4 : 51.2; return <line key={i} x1={60 + r1 * Math.cos(a)} y1={60 + r1 * Math.sin(a)} x2={60 + r2 * Math.cos(a)} y2={60 + r2 * Math.sin(a)} stroke="var(--color-od-gold-300)" strokeWidth={i % 6 === 0 ? 0.9 : 0.5} opacity={i % 6 === 0 ? 0.8 : 0.4} />; })}
      {detail && <circle cx="60" cy="60" r="47.6" stroke={`url(#g${id})`} strokeWidth=".9" opacity=".9" />}
      <g clipPath={`url(#c${id})`}>
        <g transform={`translate(${tx} ${ty}) scale(${sc})`}>
          <path d={HEAD.mane} fill={`url(#m${id})`} />
          {HEAD.maneLines.map((d, i) => <path key={i} d={d} stroke="var(--color-navy-900)" strokeWidth="1.6" strokeLinecap="round" opacity=".42" />)}
          <path d={HEAD.head} fill={`url(#h${id})`} />
          <path d={HEAD.ear} stroke="var(--color-navy-700)" strokeWidth="1.8" strokeLinecap="round" opacity=".45" />
          <path d={HEAD.jaw} stroke="var(--color-navy-700)" strokeWidth="1.6" strokeLinecap="round" opacity=".35" />
          <path d={HEAD.forelock} stroke="var(--color-gold-600)" strokeWidth="2.4" strokeLinecap="round" />
          <path d={HEAD.mouth} stroke="var(--color-navy-700)" strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
          <path d={HEAD.nostril} stroke="var(--color-navy-800)" strokeWidth="2.4" strokeLinecap="round" opacity=".75" />
          <ellipse cx="60" cy="40" rx="3.6" ry="2.7" fill="var(--color-navy-900)" transform="rotate(14 60 40)" />
          <circle cx="61" cy="39" r="1" fill="#fff" />
        </g>
      </g>
      {detail && (
        <g>
          {[1, -1].map((side) => (
            <g key={side}>
              <path d={`M${60 + 41.5 * Math.cos(((90 + side * 8) * Math.PI) / 180)} ${60 + 41.5 * Math.sin(((90 + side * 8) * Math.PI) / 180)} A41.5 41.5 0 0 ${side === 1 ? 1 : 0} ${60 + 41.5 * Math.cos(((90 + side * 112) * Math.PI) / 180)} ${60 + 41.5 * Math.sin(((90 + side * 112) * Math.PI) / 180)}`} stroke={`url(#m${id})`} strokeWidth=".9" />
              {LAUREL(side as 1 | -1).map((l) => [-1, 1].map((o) => (
                <ellipse key={`${l.i}${o}`} cx={l.cx + o * 2.1 * Math.cos((l.rot * Math.PI) / 180)} cy={l.cy + o * 2.1 * Math.sin((l.rot * Math.PI) / 180)} rx="1.5" ry="3.3" transform={`rotate(${l.rot + o * side * 38 - 0} ${l.cx + o * 2.1 * Math.cos((l.rot * Math.PI) / 180)} ${l.cy + o * 2.1 * Math.sin((l.rot * Math.PI) / 180)})`} fill={`url(#m${id})`} opacity={0.95} />
              )))}
            </g>
          ))}
          <path d="M60 99.4l1.9 2.9-1.9 2.9-1.9-2.9z" fill={`url(#g${id})`} />
        </g>
      )}
    </svg>
  );
}

export function HorseMark({ className = 'h-7 w-7' }: { className?: string }) {
  return <Emblem size={28} className={className} />;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  const { tx } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <Emblem size={42} className="shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,.25)]" />
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className="gold-text text-[10px] font-bold uppercase tracking-[0.36em]">{tx('Iran National', 'ایران')}</div>
          <div className="mt-1.5 font-display text-[16px] font-semibold tracking-wide sb-fg">{tx('Equine Platform', 'پلتفرم ملی اسب')}</div>
          <div className="mt-1.5 h-px w-full bg-gradient-to-r from-od-gold-300/70 via-od-gold-300/20 to-transparent" />
        </div>
      )}
    </div>
  );
}

/* ---------- Count up ---------- */
export function CountUp({ value, decimals = 0, suffix = '', duration = 1600 }: { value: number; decimals?: number; suffix?: string; duration?: number }) {
  const { n } = useI18n();
  const [ref, inView] = useInView<HTMLSpanElement>();
  const v = useCountUp(value, inView, duration, decimals);
  return (
    <span ref={ref}>
      {n(v, decimals)}
      {suffix}
    </span>
  );
}

/* ---------- Animated tick ---------- */
export function Tick({ className = 'h-5 w-5', tone = 'green' }: { className?: string; tone?: 'green' | 'gold' | 'grey' }) {
  const bg = tone === 'green' ? 'bg-emerald-500' : tone === 'gold' ? 'bg-gold-500' : 'bg-navy-200';
  return (
    <span className={cn('inline-grid shrink-0 place-items-center rounded-full text-white animate-pop', bg, className)}>
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.500l4.500 4.500L19 7.500" className="check-path" />
      </svg>
    </span>
  );
}

/* ---------- Pills ---------- */
const tones = {
  green: 'bg-emerald-100/70 text-fg-emerald-800 ring-emerald-200',
  gold: 'bg-gold-100/80 text-fg-gold-700 ring-gold-200',
  navy: 'bg-navy-100/70 text-fg-navy-700 ring-navy-200',
  red: 'bg-red-100/70 text-fg-red-800 ring-red-200',
  amber: 'bg-amber-100/70 text-fg-amber-800 ring-amber-200',
  blue: 'bg-blue-100/70 text-fg-blue-800 ring-blue-200',
  sky: 'bg-sky-100/70 text-fg-sky-800 ring-sky-200',
  violet: 'bg-violet-100/70 text-fg-violet-800 ring-violet-200',
  fuchsia: 'bg-fuchsia-100/70 text-fg-fuchsia-800 ring-fuchsia-200',
  indigo: 'bg-indigo-100/70 text-fg-indigo-800 ring-indigo-200',
  teal: 'bg-teal-100/70 text-fg-teal-800 ring-teal-200',
  slate: 'bg-slate-200/70 text-fg-slate-700 ring-slate-300',
  rose: 'bg-rose-100/70 text-fg-rose-800 ring-rose-200',
  dark: 'bg-white/10 text-white ring-white/20',
};
export type Tone = keyof typeof tones;
export function Pill({ children, tone = 'navy', className, icon }: { children: ReactNode; tone?: Tone; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-sans text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function VerifiedStatus({ status }: { status: 'verified' | 'partial' | 'pending' }) {
  const { tx } = useI18n();
  if (status === 'verified') return <Pill tone="green" icon={<Check className="h-3 w-3" strokeWidth={3} />}>{tx('Verified', 'تأیید شده')}</Pill>;
  if (status === 'partial') return <Pill tone="amber">{tx('Partially verified', 'تأیید جزئی')}</Pill>;
  return <Pill tone="navy">{tx('Pending', 'در انتظار')}</Pill>;
}

/* ---------- Avatar / Image ---------- */
export function Avatar({ src, name, size = 48, className }: { src?: string; name: string; size?: number; className?: string }) {
  const [err, setErr] = useState(false);
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  if (src && !err)
    return <img src={src} alt={name} onError={() => setErr(true)} loading="lazy" className={cn('shrink-0 rounded-full object-cover ring-2 ring-surface', className)} style={{ width: size, height: size }} />;
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-navy-700 to-navy-900 text-xs font-semibold text-od-gold-200 ring-2 ring-surface', className)} style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}

export function Img({ src, alt, className, pos }: { src: string; alt: string; className?: string; pos?: string }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);
  return (
    <div className={cn('relative overflow-hidden bg-gradient-to-br from-navy-100 to-navy-50', className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        style={{ objectPosition: pos }}
        className={cn('h-full w-full object-cover transition-all duration-700', loaded ? 'scale-100 opacity-100' : 'scale-105 opacity-0')}
      />
    </div>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('panel', className)}>{children}</div>;
}

export function PanelHeader({ icon, title, action, phase = 'home', sub }: { icon: ReactNode; title: ReactNode; action?: ReactNode; phase?: PhaseKey; sub?: ReactNode }) {
  return (
    <div className="ph mb-2.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span data-ico="" className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5', PHASE[phase].soft, PHASE[phase].text)}>{icon}</span>
        <div className="min-w-0 leading-tight">
          <h3 className="ph-title truncate text-[13px] font-bold text-fg-navy-900">{title}</h3>
          {sub && <div className="truncate text-[11px] text-fg-navy-500">{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Kpi({ icon, label, value, hint, phase = 'home', className }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; phase?: PhaseKey; className?: string }) {
  return (
    <div className={cn('panel flex items-center gap-2.5 p-2.5', className)}>
      <span data-ico="" className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]', PHASE[phase].soft, PHASE[phase].text)}>{icon}</span>
      <div className="min-w-0">
        <div className="kpi-label truncate text-[11px] font-semibold uppercase tracking-wider text-fg-navy-500">{label}</div>
        <div className="kpi-value font-display text-xl font-semibold leading-tight text-fg-navy-900">{value}</div>
        {hint && <div className="truncate text-xs text-fg-navy-500">{hint}</div>}
      </div>
    </div>
  );
}

/* ---------- Form bits ---------- */
export function Select({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; label: string; className?: string }) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-line bg-field py-2 pe-8 ps-3 text-sm font-medium text-fg-navy-800 outline-none transition hover:border-fg-navy-400/50 focus:border-gold-400 focus:ring-4 focus:ring-gold-400/15"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
    </label>
  );
}

export function Chip({ active, onClick, children, icon, phase = 'registry' }: { active: boolean; onClick: () => void; children: ReactNode; icon?: ReactNode; phase?: PhaseKey }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300',
        active ? cn(PHASE[phase].soft, PHASE[phase].text, PHASE[phase].border, 'shadow-sm') : 'border-line bg-field text-fg-navy-600 hover:bg-surface-2',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-fg-navy-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-navy-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-line bg-field px-3 py-2 text-sm text-fg-navy-900 outline-none transition placeholder:text-fg-navy-400 hover:border-fg-navy-400/50 focus:border-gold-400 focus:ring-4 focus:ring-gold-400/20';

/* ---------- Segmented view switcher ---------- */
export function Segmented<T extends string>({ value, onChange, items, phase = 'registry', label, iconOnly }: { value: T; onChange: (v: T) => void; items: { v: T; l: string; icon?: ReactNode }[]; phase?: PhaseKey; label: string; iconOnly?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          title={i.l}
          aria-label={i.l}
          aria-pressed={value === i.v}
          onClick={() => onChange(i.v)}
          className={cn('flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-semibold transition-all duration-300 [&>svg]:h-4 [&>svg]:w-4', value === i.v ? cn('bg-field shadow-sm', PHASE[phase].text) : 'text-fg-navy-500 hover:text-fg-navy-800')}
        >
          {i.icon}
          {!iconOnly && <span className={i.icon ? 'max-md:hidden' : ''}>{i.l}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Pager ---------- */
export function Pager({ page, pages, total, size, sizes, onPage, onSize, phase = 'registry' }: { page: number; pages: number; total: number; size: number; sizes: number[]; onPage: (p: number) => void; onSize: (s: number) => void; phase?: PhaseKey }) {
  const { n, tx } = useI18n();
  const from = total ? page * size + 1 : 0;
  const to = Math.min(total, (page + 1) * size);
  const nums: (number | '…')[] = [];
  for (let i = 0; i < pages; i++) if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-fg-navy-600">
      <div className="flex items-center gap-3">
        <span><b className="text-fg-navy-900">{n(from)}–{n(to)}</b> {tx('of', 'از')} <b className="text-fg-navy-900">{n(total)}</b></span>
        <label className="flex items-center gap-1.5">
          <span className="max-sm:hidden">{tx('Per page', 'در هر صفحه')}</span>
          <select value={size} onChange={(e) => onSize(+e.target.value)} className="rounded-lg border border-line bg-field px-1.5 py-1 text-xs font-semibold outline-none">{sizes.map((x) => <option key={x} value={x}>{n(x)}</option>)}</select>
        </label>
      </div>
      <div className="flex items-center gap-1">
        <button disabled={page === 0} onClick={() => onPage(page - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface font-bold transition hover:bg-surface-2 disabled:opacity-40" aria-label="Previous"><span className="rtl:rotate-180">‹</span></button>
        {/* R159 phone: numbered page buttons collapse below sm — prev/next + the range text stay */}
        <span className="flex items-center gap-1 max-sm:hidden">
        {nums.map((x, i) => x === '…' ? <span key={i} className="px-1">…</span> : (
          <button key={i} onClick={() => onPage(x)} aria-current={x === page} className={cn('h-8 min-w-8 rounded-lg px-2 font-semibold transition', x === page ? cn(PHASE[phase].solid, 'shadow') : 'border border-line bg-surface hover:bg-surface-2')}>{n(x + 1)}</button>
        ))}
        </span>
        <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface font-bold transition hover:bg-surface-2 disabled:opacity-40" aria-label="Next"><span className="rtl:rotate-180">›</span></button>
      </div>
    </div>
  );
}

/* ---------- Sex badge ---------- */
export function SexDot({ sex, className }: { sex: 'stallion' | 'mare' | 'gelding' | undefined; className?: string }) {
  const c = sex === 'stallion' ? 'bg-blue-100 text-fg-blue-600' : sex === 'mare' ? 'bg-rose-100 text-fg-rose-600' : 'bg-slate-200 text-fg-slate-600';
  const g = sex === 'stallion' ? '♂' : sex === 'mare' ? '♀' : sex === 'gelding' ? '⚲' : '—';
  return <span className={cn('inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold leading-none', c, className)}>{g}</span>;
}

/* ---------- Rating stars ---------- */
export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-fg-gold-500" aria-label={String(value)}>
      {[1, 2, 3, 4, 5].map((i) => <svg key={i} viewBox="0 0 20 20" className="h-3 w-3" fill={value >= i - 0.5 ? 'currentColor' : 'var(--color-line)'}><path d="M10 1.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L1.400 7.800l6-.8z" /></svg>)}
    </span>
  );
}

/* ---------- Split explorer (list + detail) ---------- */
export function Split({ list, detail, hasSel, onBack, listW = 'lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]' }: { list: ReactNode; detail: ReactNode; hasSel: boolean; onBack: () => void; listW?: string }) {
  const { tx } = useI18n();
  return (
    <div className={cn('grid min-h-0 gap-3 lg:h-full', listW)}>
      <div className={cn('thin-scroll min-h-0 lg:overflow-y-auto lg:pe-1', hasSel && 'max-lg:hidden')}>{list}</div>
      <div className={cn('thin-scroll min-h-0 lg:overflow-y-auto', !hasSel && 'max-lg:hidden')}>
        <button onClick={onBack} className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg-navy-700 lg:hidden"><span className="rtl:rotate-180">‹</span> {tx('Back to list', 'بازگشت به فهرست')}</button>
        {detail}
      </div>
    </div>
  );
}

/* ---------- Trust badges (six scoped levels) ---------- */
const TRUST_STYLE: Record<TrustLevel, { cls: string; icon: ReactNode; bar: string }> = {
  self: { cls: 'border-dashed border-slate-400 bg-slate-100 text-fg-slate-600', icon: <PenLine />, bar: 'bg-slate-400' },
  uploaded: { cls: 'border-amber-300 bg-amber-100/80 text-fg-amber-800', icon: <FileUp />, bar: 'bg-amber-500' },
  reviewed: { cls: 'border-blue-300 bg-blue-100/80 text-fg-blue-800', icon: <FileSearch />, bar: 'bg-blue-500' },
  official: { cls: 'border-emerald-400 bg-emerald-100 text-fg-emerald-800', icon: <ShieldCheck />, bar: 'bg-emerald-500' },
  dna: { cls: 'border-fuchsia-300 bg-fuchsia-100/80 text-fg-fuchsia-800', icon: <Dna />, bar: 'bg-fuchsia-500' },
  conflict: { cls: 'border-red-400 bg-red-100 text-fg-red-800', icon: <AlertTriangle />, bar: 'bg-red-500' },
};
export const trustBar = (l: TrustLevel) => TRUST_STYLE[l].bar;
export const trustIcon = (l: TrustLevel) => TRUST_STYLE[l].icon;
export function TrustBadge({ level, compact, long, className }: { level: TrustLevel; compact?: boolean; long?: boolean; className?: string }) {
  const { tr } = useI18n();
  const s = TRUST_STYLE[level], t = TRUST_L[level];
  return (
    <span title={`${tr(t.l)} — ${tr(t.hint)}`} className={cn('trust-badge inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-sans text-[11px] font-semibold [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0', s.cls, compact && 'trust-compact px-1.5', className)}>
      {s.icon}
      {!compact && tr(long ? t.l : t.short)}
    </span>
  );
}
export function TrustLegend({ cols = true }: { cols?: boolean }) {
  const { tr } = useI18n();
  return (
    <ul className={cn('grid gap-2', cols && 'sm:grid-cols-2 xl:grid-cols-3')}>
      {TRUST_ORDER.map((l) => (
        <li key={l} className="flex items-start gap-2.5 rounded-xl bg-surface-2/70 p-2.5">
          <TrustBadge level={l} compact className="mt-0.5 !h-6 !w-6 !justify-center !rounded-full" />
          <div className="min-w-0 leading-tight"><div className="text-[13px] font-bold">{tr(TRUST_L[l].l)}</div><div className="mt-0.5 text-[11px] text-fg-navy-500">{tr(TRUST_L[l].hint)}</div></div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- visibility pill ---------- */
export function VisPill({ vis }: { vis: 'public' | 'restricted' | 'private' }) {
  const { tx } = useI18n();
  const m = { public: ['bg-emerald-100/70 text-fg-emerald-800', <Globe key="g" />, tx('Public', 'عمومی')], restricted: ['bg-amber-100/70 text-fg-amber-800', <UsersRound key="u" />, tx('Authorised', 'مجازان')], private: ['bg-slate-200/80 text-fg-slate-700', <Lock key="l" />, tx('Private', 'خصوصی')] } as const;
  const [cls, ic, l] = m[vis];
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold [&>svg]:h-3 [&>svg]:w-3', cls)}>{ic}{l}</span>;
}

/* ---------- meter ---------- */
export function Meter({ value, color = 'bg-sky-500', h = 'h-1.5' }: { value: number; color?: string; h?: string }) {
  return <span className={cn('block overflow-hidden rounded-full bg-surface-2', h)}><span className={cn('block h-full origin-left rounded-full rtl:origin-right', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%`, animation: 'grow-x 1s both' }} /></span>;
}

export function Notice({ tone = 'blue', icon, title, children, className }: { tone?: 'blue' | 'amber' | 'red' | 'green' | 'slate'; icon?: ReactNode; title?: ReactNode; children?: ReactNode; className?: string }) {
  const c = { blue: 'border-blue-300 bg-blue-100/50 text-fg-blue-900', amber: 'border-amber-300 bg-amber-100/60 text-fg-amber-900', red: 'border-red-300 bg-red-100/60 text-fg-red-900', green: 'border-emerald-300 bg-emerald-100/50 text-fg-emerald-900', slate: 'border-slate-300 bg-slate-100/70 text-fg-slate-800' }[tone];
  return <div className={cn('flex items-start gap-2.5 rounded-xl border p-2.5 text-xs leading-relaxed [&>svg]:mt-0.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0', c, className)}>{icon}<div className="min-w-0">{title && <div className="text-[13px] font-bold">{title}</div>}{children}</div></div>;
}

/* ---------- a small printer's ornament: hairline · diamond · hairline ---------- */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" className={cn('h-3 w-28 text-fg-gold-500', className)} aria-hidden fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M0 6H45M75 6H120" />
      <path d="M60 1.5 64.5 6 60 10.5 55.5 6z" fill="currentColor" stroke="none" />
      <circle cx="50" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="70" cy="6" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
