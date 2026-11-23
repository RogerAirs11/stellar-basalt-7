import { cn } from '../utils/cn';

export function Spark({ data, color = '#4880a8', h = 36, className }: { data: number[]; color?: string; h?: number; className?: string }) {
  const w = 120;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 4 - ((v - min) / Math.max(1e-6, max - min)) * (h - 10)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('w-full', className)} style={{ height: h }} preserveAspectRatio="none" aria-hidden>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={color} opacity=".12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="draw-path" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

export function Donut({ parts, size = 92, label }: { parts: { v: number; c: string }[]; size?: number; label?: string }) {
  const total = parts.reduce((t, p) => t + p.v, 0) || 1;
  let acc = 0;
  const stops = parts.map((p) => { const a = (acc / total) * 100; acc += p.v; return `${p.c} ${a}% ${(acc / total) * 100}%`; }).join(', ');
  return (
    <div className="relative shrink-0 rounded-full" style={{ width: size, height: size, background: `conic-gradient(${stops})` }}>
      <div className="absolute inset-[22%] grid place-items-center rounded-full bg-surface text-center text-[11px] font-bold leading-tight text-fg-navy-800">{label}</div>
    </div>
  );
}

export function HBar({ label, value, max, color = 'bg-sky-500', suffix = '', right }: { label: string; value: number; max: number; color?: string; suffix?: string; right?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <span className="truncate font-medium text-fg-navy-700">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className={cn('block h-full origin-left rounded-full rtl:origin-right', color)} style={{ width: `${(value / max) * 100}%`, animation: 'grow-x 1s both' }} /></span>
      <b className="w-14 text-end tabular-nums text-fg-navy-800">{right ?? `${value}${suffix}`}</b>
    </div>
  );
}
