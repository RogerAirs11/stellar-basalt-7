import { memo, useEffect, useMemo, useState } from 'react';
import { Link2, Minus, Plus, Sparkles, GitBranch, Orbit, Table2, AlignVerticalJustifyEnd } from 'lucide-react';
import { COLOUR_HEX, COLOUR_L, px, type Colour, type Horse } from '../data';
import { useI18n } from '../i18n';
import { buildPedigree, flatten, layoutTree, positionLabel, repeatedKeys, type LNode, type PNode } from '../genetics';
import { go, useElementSize, useMedia } from '../lib';
import { useLineageVersion } from '../live';
import { Segmented } from './ui';
import { cn } from '../utils/cn';

type View = 'tree' | 'vertical' | 'fan' | 'table';
type Mode = 'line' | 'coat';
interface Props { horse: Horse; depth?: number; compact?: boolean; controls?: boolean; fill?: boolean; meta?: React.ReactNode; dense?: boolean; minNode?: number }

const MALE = '#5984ca';
const FEMALE = '#cf656e';
const sexHex = (n: PNode) => (n.sex === 'U' ? '#84909b' : n.sex === 'M' ? MALE : FEMALE);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** shared hover / selection highlight logic */
function useHighlight(nodes: PNode[], active: number | null) {
  return useMemo(() => {
    const lineage = new Set<number>();
    const same = new Set<number>();
    if (active == null) return { lineage, same, has: false };
    const a = nodes.find((n) => n.id === active);
    if (!a) return { lineage, same, has: false };
    nodes.forEach((n) => {
      if (n.id === a.id || (!a.key.startsWith('U') && !a.isRoot && n.key === a.key)) same.add(n.id);
    });
    same.forEach((id) => {
      let c = id;
      while (c >= 1) { lineage.add(c); c = Math.floor(c / 2); }
    });
    return { lineage, same, has: true };
  }, [nodes, active]);
}

export function Pedigree({ horse, depth: d0 = 4, compact = false, controls = false, fill = false, meta, dense = false, minNode = 90 }: Props) {
  const { rtl, tx, tr, n } = useI18n();
  const wide = useMedia('(min-width:1024px)');
  const [view, setView] = useState<View>('tree');
  const [depthSel, setDepthSel] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? Math.min(d0, 3) : d0));
  const [mode, setMode] = useState<Mode>('line');
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [replay, setReplay] = useState(0);
  const [wrapRef, cw, ch] = useElementSize<HTMLDivElement>();

  const vFit = cw ? Math.floor(Math.log2(Math.max(1, (cw - 18) / 64))) : 4; // 2^d leaves must each stay ≥ ~58px wide
  const maxD = view === 'vertical' ? clamp(vFit, 2, 4) : view === 'tree' ? 5 : 7;
  const fitDepth = (() => { if (!cw) return d0; let d = d0; while (d > 1 && (cw - 4 - d * 16) / (d + 1) < minNode) d--; return d; })();
  const depth = compact ? fitDepth : Math.min(depthSel, maxD);
  const lineage = useLineageVersion(); // ancestor rows may land after mount
  const root = useMemo(() => buildPedigree(horse, depth), [horse, depth, lineage]);
  const nodes = useMemo(() => flatten(root), [root]);
  const repeats = useMemo(() => repeatedKeys(root), [root]);
  const active = hover ?? sel;
  const hl = useHighlight(nodes, active);
  const byPN = useMemo(() => new Map(nodes.map((x) => [x.id, x])), [nodes]);
  const selNode = active != null ? byPN.get(active) : null;

  useEffect(() => { setSel(null); setHover(null); setReplay((r) => r + 1); }, [horse.id, depth, view]);

  const stepMs = compact ? 90 : 120;
  const stateOf = (id: number): 'idle' | 'focus' | 'path' | 'dim' => (!hl.has ? 'idle' : hl.same.has(id) ? 'focus' : hl.lineage.has(id) ? 'path' : 'dim');

  /* ---------- horizontal / vertical tree ---------- */
  const orient = view === 'vertical' ? 'v' : 'h';
  const dims = useMemo(() => {
    const leaves = Math.pow(2, depth);
    if (compact) {
      const gapX = cw < 480 ? 14 : 18;
      const nodeW = clamp((cw - 4 - depth * gapX) / (depth + 1), Math.max(104, minNode), 260);
      if (cw < 480) return { nodeW, nodeH: clamp(nodeW * 0.5, 52, 68), gapX, gapY: 8 };
      return dense ? { nodeW, nodeH: clamp(nodeW * 0.24, 36, 46), gapX, gapY: 4 } : { nodeW, nodeH: clamp(nodeW * 0.26, 42, 58), gapX, gapY: 5 };
    }
    const aw = Math.max(0, (cw - 24) * zoom);
    const ah = Math.max(0, (ch - 24) * zoom);
    if (orient === 'h') {
      const gapX = 28, gapY = depth >= 5 ? 5 : 8;
      return { nodeW: clamp((aw - depth * gapX) / (depth + 1), 176, 340), nodeH: clamp((ah + gapY) / leaves - gapY, 46, 110), gapX, gapY };
    }
    const gapX = 6;
    const nodeW = clamp((aw + gapX) / leaves - gapX, 66, 160);
    const nodeH = clamp((ah - depth * 26) / (depth + 1), 46, 66);
    const gapY = clamp((ah - (depth + 1) * nodeH) / depth, 24, 56);
    return { nodeW, nodeH, gapX, gapY };
  }, [cw, ch, zoom, depth, orient, compact, dense, minNode]);

  const layout = useMemo(() => layoutTree(root, { ...dims, rtl, orient }), [root, dims, rtl, orient]);
  const ox = compact ? 0 : Math.max(12, (cw - layout.width) / 2);
  const oy = compact ? 0 : orient === 'v' ? Math.max(14, (ch - layout.height) * 0.42) : Math.max(12, (ch - layout.height) / 2);

  const treeBox = (
    <div key={replay + horse.id + view} className="relative" style={{ width: compact ? layout.width : Math.max(cw, layout.width + 24), height: compact ? layout.height : Math.max(ch, layout.height + 24) }}>
      <div className="absolute" style={{ left: ox, top: oy, width: layout.width, height: layout.height }} onMouseLeave={() => setHover(null)}>
        <svg className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height} fill="none">
          {layout.edges.map((e) => {
            const on = hl.has && hl.lineage.has(e.child.node.id) && hl.lineage.has(e.parent.node.id);
            return (
              <path key={e.parent.node.id} d={e.d} pathLength={1} className="draw-path" strokeLinecap="round"
                style={{ animationDelay: `${(e.parent.node.gen - 1) * stepMs}ms`, stroke: on ? 'var(--color-gold-500)' : sexHex(e.parent.node), strokeWidth: on ? 3.2 : compact ? 1.5 : 2, opacity: on ? 1 : hl.has ? 0.14 : 0.62, transition: 'opacity .3s, stroke-width .3s' }} />
            );
          })}
          {orient === 'v' && layout.nodes.filter((l) => l.node.parents).map((l) => {
            const cx = l.x + dims.nodeW / 2, b = l.y + dims.nodeH, r = Math.min(6, dims.gapY / 4);
            const on = hl.has && hl.lineage.has(l.node.id);
            return <path key={'t' + l.node.id} d={`M${cx} ${b} V${b + dims.gapY / 2 - r}`} pathLength={1} className="draw-path" strokeLinecap="round" style={{ stroke: on ? 'var(--color-gold-500)' : 'var(--color-od-navy-400)', strokeWidth: on ? 3.2 : 2, opacity: on ? 1 : hl.has ? 0.14 : 0.62, transition: 'opacity .3s, stroke-width .3s', animationDelay: `${l.node.gen * stepMs}ms` }} />;
          })}
        </svg>
        {layout.nodes.map((l) => (
          <NodeCard key={l.node.id} l={l} w={dims.nodeW} h={dims.nodeH} vertical={orient === 'v'} compact={compact} mode={mode} horse={horse}
            repeatCount={repeats.get(l.node.key) || 0} state={stateOf(l.node.id)} selected={sel === l.node.id} delay={l.node.gen * stepMs}
            onHover={setHover} onSelect={compact ? (l.node.horseId && !l.node.isRoot ? () => go('/horses/' + l.node.horseId) : undefined) : (id) => setSel((s) => (s === id ? null : id))} />
        ))}
      </div>
    </div>
  );

  const body =
    view === 'fan' && !compact ? <FanChart root={root} depth={depth} mode={mode} horse={horse} repeats={repeats} stateOf={stateOf} hover={setHover} select={(id) => setSel((s) => (s === id ? null : id))} sel={sel} key={replay + horse.id + 'fan'} />
      : view === 'table' && !compact ? <ClassicTable root={root} depth={depth} mode={mode} horse={horse} repeats={repeats} stateOf={stateOf} hover={setHover} select={(id) => setSel((s) => (s === id ? null : id))} sel={sel} key={replay + horse.id + 'tbl'} />
        : treeBox;

  return (
    <div className={cn(!compact && 'panel flex flex-col overflow-hidden', fill && 'lg:min-h-0 lg:flex-1')}>
      {controls && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-2/60 px-2.5 py-2">
          <Segmented<View> label="View" value={view} onChange={(v) => { setView(v); if (v === 'vertical') setDepthSel((d) => Math.min(d, 3)); }} phase="registry" items={[
            { v: 'tree', l: tx('Tree', 'درخت'), icon: <GitBranch /> },
            { v: 'vertical', l: tx('Vertical', 'عمودی'), icon: <AlignVerticalJustifyEnd /> },
            { v: 'fan', l: tx('Fan', 'بادبزنی'), icon: <Orbit /> },
            { v: 'table', l: tx('Stud-book', 'جدول'), icon: <Table2 /> },
          ]} />
          <Segmented<string> label="Generations" value={String(depth)} onChange={(v) => setDepthSel(+v)} phase="registry" items={(view === 'vertical' ? [2, 3, 4] : [3, 4, 5, 6, 7]).filter((g) => g <= maxD).map((g) => ({ v: String(g), l: `${n(g)} ${tx('gen', 'نسل')}` }))} />
          <Segmented<Mode> label="Colour by" value={mode} onChange={setMode} phase="registry" items={[{ v: 'line', l: tx('Sex', 'جنس') }, { v: 'coat', l: tx('Coat', 'رنگ') }]} />
          {meta && <div className="ms-auto hidden items-center gap-5 xl:flex">{meta}</div>}
          <div className={cn('flex items-center gap-0.5', !meta && 'ms-auto')}>
            {(view === 'tree' || view === 'vertical') && (
              <>
                <button onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.15).toFixed(2)))} className="grid h-8 w-8 place-items-center rounded-lg text-fg-navy-600 transition hover:bg-navy-900/5" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
                <span className="w-10 text-center text-xs font-semibold tabular-nums text-fg-navy-500">{n(Math.round(zoom * 100))}%</span>
                <button onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)))} className="grid h-8 w-8 place-items-center rounded-lg text-fg-navy-600 transition hover:bg-navy-900/5" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
              </>
            )}
          </div>
        </div>
      )}

      <div
        ref={wrapRef}
        className={cn('thin-scroll relative w-full', compact ? 'overflow-x-auto' : 'overflow-auto bg-surface-2/60 bg-[radial-gradient(circle_at_1px_1px,rgba(11,27,61,0.07)_1px,transparent_0)] [background-size:20px_20px]', fill && !compact && 'lg:min-h-0 lg:flex-1')}
        style={!compact && !(fill && wide) ? { height: fill ? '66vh' : 540 } : undefined}
      >
        {body}
      </div>

      {controls && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 min-h-[48px] border-t border-line bg-surface px-3 py-2 text-xs">
          {selNode && selNode.name ? (
            <>
              <span className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full text-sm font-bold text-white" style={{ background: sexHex(selNode) }}>{selNode.sex === 'U' ? '—' : selNode.sex === 'M' ? '♂' : '♀'}</span>
                <span><b className="font-display text-sm text-fg-navy-900">{tr(selNode.name)}</b><span className="ms-2 text-fg-navy-500">{positionLabel(selNode.id, tx)}</span></span>
              </span>
              <Meta k={tx('Foaled', 'متولد')} v={n(String(selNode.year ?? ''))} />
              <Meta k={tx('Colour', 'رنگ')} v={selNode.colour ? tr(COLOUR_L[selNode.colour]) : '—'} dot={selNode.colour ? COLOUR_HEX[selNode.colour] : undefined} />
              <Meta k={tx('Generation', 'نسل')} v={n(selNode.gen)} />
              {repeats.get(selNode.key) ? <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-100 px-2.5 py-1 font-semibold text-fg-gold-700 ring-1 ring-gold-300"><Link2 className="h-3 w-3" />{tx(`Linebred · ${repeats.get(selNode.key)}×`, `خط‌پرورشی · ${n(repeats.get(selNode.key)!)} بار`)}</span> : null}
            </>
          ) : (
            <span className="flex items-center gap-2 text-fg-navy-500"><Sparkles className="h-3.5 w-3.5 text-fg-gold-500" />{tx('Hover to trace a bloodline · click an ancestor for details', 'برای ردیابی خط خونی نشانگر ببرید · برای جزئیات کلیک کنید')}</span>
          )}
          <span className="ms-auto flex flex-wrap items-center gap-3.5 text-fg-navy-600">
            {mode === 'line' ? (
              <>
                <Leg c={MALE} l={tx('Sire / male', 'پدر / نر')} />
                <Leg c={FEMALE} l={tx('Dam / female', 'مادر / ماده')} />
              </>
            ) : (
              (['grey', 'bay', 'chestnut', 'black'] as Colour[]).map((c) => <Leg key={c} c={COLOUR_HEX[c]} l={tr(COLOUR_L[c])} />)
            )}
            <span className="flex items-center gap-1.5 font-semibold text-fg-gold-700"><span className="grid h-4 w-4 place-items-center rounded-full bg-gold-500 text-white"><Link2 className="h-2.5 w-2.5" /></span>{tx(`Linebred in view (${repeats.size})`, `خط‌پرورشی در نما (${n(repeats.size)})`)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

const Leg = ({ c, l }: { c: string; l: string }) => <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: c }} />{l}</span>;
const Meta = ({ k, v, dot }: { k: string; v: string; dot?: string }) => (
  <span className="flex items-center gap-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-navy-400">{k}</span><span className="flex items-center gap-1 font-semibold text-fg-navy-800">{dot && <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: dot }} />}{v}</span></span>
);

/* =====================================================================
   Node card (tree views)
   ===================================================================== */
interface NodeProps {
  l: LNode; w: number; h: number; vertical: boolean; compact: boolean; mode: Mode; horse: Horse; repeatCount: number;
  state: 'idle' | 'focus' | 'path' | 'dim'; selected: boolean; delay: number; onHover: (id: number | null) => void; onSelect?: (id: number) => void;
}

const NodeCard = memo(function NodeCard({ l, w, h, vertical, compact, mode, horse, repeatCount, state, selected, delay, onHover, onSelect }: NodeProps) {
  const { tr, tx, n } = useI18n();
  const node = l.node;
  const unknown = !node.name;
  const isRoot = !!node.isRoot;
  const accent = isRoot ? 'var(--color-od-gold-400)' : unknown ? 'var(--color-line)' : mode === 'coat' && node.colour ? COLOUR_HEX[node.colour] : sexHex(node);
  const bg = isRoot ? undefined : unknown ? undefined : mode === 'coat' && node.colour ? `${COLOUR_HEX[node.colour]}26` : node.sex === 'U' ? 'var(--color-surface-2)' : node.sex === 'M' ? 'var(--tint-male)' : 'var(--tint-female)';
  const big = !vertical && h >= 56 && w >= 150;
  const showAvatar = !vertical && h >= 34 && w >= 128;
  const av = big ? Math.min(h - 16, 46) : isRoot ? Math.min(h - 8, 30) : 22;
  const label = unknown ? tx('Unknown', 'نامشخص') : tr(node.name!);
  const avail = w - (vertical ? 12 : 16) - 4 - (showAvatar && !unknown ? av + 8 : 0) - (repeatCount > 0 && !isRoot ? 22 : 0);
  const maxFs = vertical ? 12 : node.gen <= 1 ? 17 : 15;
  const fitName = (wantSub: boolean) => {
    for (let f = maxFs; f >= (vertical ? 8.5 : 10); f -= vertical ? 0.5 : 1) {
      const cpl = Math.max(1, avail / (f * 0.56));
      const lines = Math.ceil((label.length * 1.1) / cpl);
      const room = Math.floor((h - 8 - (wantSub ? (f - 2) * 1.25 : 0)) / (f * 1.12));
      const longest = Math.max(...label.split(/\s+/).map((x) => x.length));
      if (lines <= Math.max(1, room) && longest * f * 0.6 <= avail) return f;
    }
    return vertical ? 8.5 : 10;
  };
  let sub = (vertical ? h >= 42 : h >= 30) && !unknown && node.year != null && node.colour != null;
  let fs = fitName(sub);
  if (sub && fs <= (vertical ? 9 : 11) && h < 50) { sub = false; fs = fitName(false); }
  if (sub && !unknown) {
    const subLen = String(node.year).length + 3 + tr(COLOUR_L[node.colour!]).length;
    if (subLen * Math.max(10, fs - 3) * 0.58 > avail) { sub = false; fs = fitName(false); }
  }

  return (
    <button
      type="button"
      onMouseEnter={() => onHover(node.id)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect?.(node.id)}
      className={cn(
        'group absolute overflow-hidden border text-start outline-none transition-all duration-300', vertical ? 'rounded-md' : 'rounded-lg',
        vertical ? 'flex flex-col items-center justify-center px-1 text-center' : 'flex items-center gap-2 px-2',
        isRoot ? 'border-gold-400 bg-gradient-to-br from-navy-700 to-navy-950 text-white shadow-lg shadow-navy-900/30' : unknown ? 'border-dashed border-line bg-surface/40 text-od-navy-300' : 'border-line text-fg-navy-900 shadow-sm hover:shadow-md',
        repeatCount > 0 && !isRoot && 'ring-2 ring-gold-400 ring-offset-1 ring-offset-transparent',
        state === 'focus' && 'z-20 scale-[1.05] !border-gold-400 shadow-xl shadow-gold-500/30',
        state === 'path' && 'z-10 !border-gold-300',
        state === 'dim' && 'opacity-30',
        selected && 'ring-2 ring-gold-500 ring-offset-2',
        onSelect && 'cursor-pointer',
      )}
      style={{
        left: l.x, top: l.y, width: w, height: h, background: bg,
        [vertical ? 'borderTopWidth' : 'borderInlineStartWidth']: unknown ? undefined : vertical ? 3 : 4,
        [vertical ? 'borderTopColor' : 'borderInlineStartColor']: unknown ? undefined : accent,
        animation: `node-in .5s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms both`,
      }}
      title={unknown ? undefined : tr(node.name!)}
    >
      {isRoot && showAvatar && <img src={px(horse.photo, 120, 120)} alt="" className="shrink-0 rounded-md object-cover ring-1 ring-gold-300/70" style={{ width: av, height: av, objectPosition: horse.pos }} />}
      {!isRoot && !unknown && showAvatar && (
        <span className="grid shrink-0 place-items-center rounded-full font-bold ring-1 ring-black/10" style={{ width: av, height: av, background: node.colour ? COLOUR_HEX[node.colour] : '#ccc', color: node.colour === 'grey' ? '#49525e' : '#ffffffcc', fontSize: av * 0.5 }}>
          {node.sex === 'U' ? '—' : node.sex === 'M' ? '♂' : '♀'}
        </span>
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block break-words font-bold leading-[1.12]" style={{ fontSize: fs, display: '-webkit-box', WebkitLineClamp: vertical ? 2 : Math.max(1, Math.floor((h - 8 - (sub ? (fs - 2) * 1.25 : 0)) / (fs * 1.12))), WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{label}</span>
        {sub && !unknown && (
          <span className={cn('block whitespace-nowrap', isRoot ? 'text-od-gold-200' : 'text-fg-navy-500')} style={{ fontSize: Math.max(10, fs - 3) }}>
            {n(String(node.year))} · {tr(COLOUR_L[node.colour!])}
          </span>
        )}
        {big && !isRoot && node.gen <= 2 && !unknown && h >= 66 && (
          <span className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>{positionLabel(node.id, tx)}</span>
        )}
      </span>
      {repeatCount > 0 && !isRoot && <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gold-500 text-white"><Link2 className="h-2.5 w-2.5" /></span>}
      {compact && null}
    </button>
  );
});

/* =====================================================================
   Fan chart
   ===================================================================== */
interface AltProps {
  root: PNode; depth: number; mode: Mode; horse: Horse; repeats: Map<string, number>;
  stateOf: (id: number) => 'idle' | 'focus' | 'path' | 'dim'; hover: (id: number | null) => void; select: (id: number) => void; sel: number | null;
}

function FanChart({ root, depth, mode, horse, repeats, stateOf, hover, select, sel }: AltProps) {
  const { tr, tx, n } = useI18n();
  const R = 520, r0 = 78, pad = 10;
  const rw = (R - r0) / depth;
  const W = 2 * R + pad * 2, H = R + pad * 2 + 6;
  const cx = R + pad, cy = R + pad;
  const all = flatten(root);
  const P = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full min-h-[320px] w-full" preserveAspectRatio="xMidYMax meet" onMouseLeave={() => hover(null)}>
      <defs><clipPath id="fanroot"><circle cx={cx} cy={cy} r={r0 - 6} /></clipPath></defs>
      {all.filter((x) => !x.isRoot).map((x) => {
        const g = x.gen, idx = x.id - Math.pow(2, g), cnt = Math.pow(2, g);
        const a0 = Math.PI + (idx / cnt) * Math.PI, a1 = Math.PI + ((idx + 1) / cnt) * Math.PI, am = (a0 + a1) / 2;
        const ri = r0 + (g - 1) * rw, ro = ri + rw - 2;
        const unknown = !x.name;
        const fill = unknown ? 'var(--color-surface-2)' : mode === 'coat' && x.colour ? COLOUR_HEX[x.colour] : sexHex(x);
        const op = unknown ? 1 : mode === 'coat' ? 0.9 : 0.18 + (depth - g) * 0.06 + 0.1;
        const st = stateOf(x.id);
        const rep = repeats.get(x.key);
        const rm = (ri + ro) / 2;
        const deg = (am * 180) / Math.PI;
        const rot = Math.cos(am) < 0 ? deg - 180 : deg;
        const arc = (rm * (a1 - a0));
        const fs = clamp(Math.min(rw * 0.2, arc * 0.5, 18), 8, 18);
        const maxCh = Math.max(4, Math.floor((rw - 8) / (fs * 0.56)));
        const label = unknown ? '' : tr(x.name!);
        const first = label.split(' ')[0];
        const txt = label.length <= maxCh ? label : first.length <= maxCh ? first : '';
        const dark = mode === 'coat' && (x.colour === 'bay' || x.colour === 'black' || x.colour === 'chestnut');
        return (
          <g key={x.id} onMouseEnter={() => hover(x.id)} onClick={() => select(x.id)} style={{ cursor: 'pointer', animation: `node-in .5s ${g * 130 + idx * 8}ms both`, transformOrigin: `${cx}px ${cy}px`, opacity: st === 'dim' ? 0.3 : 1, transition: 'opacity .3s' }}>
            <path
              d={`M${P(ro, a0)} A${ro} ${ro} 0 0 1 ${P(ro, a1)} L${P(ri, a1)} A${ri} ${ri} 0 0 0 ${P(ri, a0)} Z`}
              fill={fill} fillOpacity={op}
              stroke={st === 'focus' ? 'var(--color-gold-500)' : st === 'path' ? 'var(--color-od-gold-400)' : rep ? 'var(--color-od-gold-400)' : 'var(--color-surface)'} strokeWidth={st === 'focus' ? 3.5 : st === 'path' ? 2.5 : rep ? 2.5 : 1.5}
            />
            {!unknown && (
              <text transform={`translate(${(cx + rm * Math.cos(am)).toFixed(1)} ${(cy + rm * Math.sin(am)).toFixed(1)}) rotate(${rot.toFixed(1)})`} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={700} fill={dark ? '#fff' : 'var(--ink)'} style={{ pointerEvents: 'none' }}>
                {txt}
              </text>
            )}
            {rep && !unknown && <circle cx={cx + ro * Math.cos(am) * 0.985} cy={cy + ro * Math.sin(am) * 0.985} r={Math.min(7, arc * 0.2)} fill="#a78b61" />}
            <title>{unknown ? tx('Unknown', 'نامشخص') : x.year != null ? `${tr(x.name!)} · ${n(String(x.year))}` : tr(x.name!)}</title>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r0 - 2} fill="var(--color-navy-900)" stroke="var(--color-od-gold-400)" strokeWidth="3" />
      <image href={px(horse.photo, 240, 240)} x={cx - r0 + 6} y={cy - r0 + 6} width={(r0 - 6) * 2} height={(r0 - 6) * 2} clipPath="url(#fanroot)" preserveAspectRatio="xMidYMid slice" />
      <text x={cx} y={cy - 12} textAnchor="middle" fontSize="17" fontWeight={700} fill="#fff" stroke="rgba(0,0,0,.6)" strokeWidth="4" paintOrder="stroke">{tr(horse.name)}</text>
      {sel != null && null}
    </svg>
  );
}

/* =====================================================================
   Classic stud-book table
   ===================================================================== */
function ClassicTable({ root, depth, mode, horse, repeats, stateOf, hover, select, sel }: AltProps) {
  const { tr, tx, n } = useI18n();
  const all = flatten(root);
  const byId = new Map(all.map((x) => [x.id, x]));
  const leaves = Math.pow(2, depth);
  const rows: { id: number; span: number }[][] = [];
  for (let r = 0; r < leaves; r++) {
    const cells: { id: number; span: number }[] = [];
    for (let g = 0; g <= depth; g++) {
      const span = Math.pow(2, depth - g);
      if (r % span === 0) cells.push({ id: Math.pow(2, g) + r / span, span });
    }
    rows.push(cells);
  }
  return (
    <table className="h-full w-full min-w-[640px] table-fixed border-separate border-spacing-[3px] p-1" onMouseLeave={() => hover(null)} style={{ minHeight: leaves * 30 }}>
      <thead>
        <tr className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">
          <th className="w-[15%] text-start">{tx('Subject', 'اسب')}</th>
          {Array.from({ length: depth }, (_, g) => <th key={g} className="text-start">{g === 0 ? tx('Parents', 'والدین') : g === 1 ? tx('Grandparents', 'نیاکان نسل ۲') : `${tx('Gen', 'نسل')} ${n(g + 1)}`}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, ri) => (
          <tr key={ri}>
            {cells.map(({ id, span }) => {
              const x = byId.get(id)!;
              const st = stateOf(id);
              const unknown = !x.name;
              const accent = x.isRoot ? 'var(--color-od-gold-400)' : unknown ? 'var(--color-line)' : mode === 'coat' && x.colour ? COLOUR_HEX[x.colour] : sexHex(x);
              const bg = x.isRoot ? 'var(--ink)' : unknown ? 'transparent' : mode === 'coat' && x.colour ? `${COLOUR_HEX[x.colour]}30` : x.sex === 'U' ? 'var(--color-surface-2)' : x.sex === 'M' ? 'var(--tint-male)' : 'var(--tint-female)';
              const rep = repeats.get(x.key);
              return (
                <td key={id} rowSpan={span} onMouseEnter={() => hover(id)} onClick={() => select(id)}
                  className={cn('relative cursor-pointer overflow-hidden rounded-md border px-2 align-middle transition-all duration-300', unknown ? 'border-dashed border-line text-od-navy-300' : 'border-line', x.isRoot && 'text-white', st === 'focus' && '!border-gold-400 shadow-lg shadow-gold-500/25', st === 'path' && '!border-gold-300', st === 'dim' && 'opacity-30', sel === id && 'ring-2 ring-gold-500', rep && !x.isRoot && 'ring-2 ring-gold-400')}
                  style={{ background: bg, borderInlineStartWidth: unknown ? 1 : 4, borderInlineStartColor: unknown ? undefined : accent, animation: `enter .5s ${x.gen * 110}ms both` }}>
                  <div className="flex items-center gap-2 py-0.5">
                    {x.isRoot && <img src={px(horse.photo, 120, 120)} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" style={{ objectPosition: horse.pos }} />}
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className={cn('truncate font-bold', x.gen <= 1 ? 'text-[14px]' : x.gen <= 3 ? 'text-[13px]' : 'text-[11px]')}>{unknown ? tx('Unknown', 'نامشخص') : tr(x.name!)}</div>
                      {!unknown && span >= 2 && x.year != null && x.colour != null && <div className={cn('truncate text-[11px]', x.isRoot ? 'text-od-gold-200' : 'text-fg-navy-500')}>{n(String(x.year))} · {tr(COLOUR_L[x.colour])}</div>}
                    </div>
                    {rep && !x.isRoot && <Link2 className="h-3.5 w-3.5 shrink-0 text-fg-gold-600" />}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/* =====================================================================
   MiniPedigree — a compact tree with EQUAL-SIZE nodes that always fills the box it is given.
   Horizontal: the subject on the left, ancestors fanning out to the right.
   Vertical: the subject as the base node, ancestors stacked above it.
   Depth, node size and ONE shared type size are derived from the measured box and from the
   real rendered width of every name (canvas text measurement), so nothing is ever cut off
   or broken mid-word.
   ===================================================================== */
let _cv: CanvasRenderingContext2D | null | undefined;
const canvasCtx = () => { if (_cv === undefined) { try { _cv = document.createElement('canvas').getContext('2d'); } catch { _cv = null; } } return _cv; };
/** lines `text` needs at font-size f inside `inner` px; Infinity when a single word is wider than the box */
function linesFor(text: string, f: number, inner: number, family: string, weight = 600): number {
  const words = text.split(/\s+/).filter(Boolean);
  const c = canvasCtx();
  if (!c) return Math.max(...words.map((w) => w.length)) * f * 0.66 > inner ? Infinity : Math.ceil((text.length * 1.1) / Math.max(1, inner / (f * 0.6)));
  c.font = `${weight} ${f}px ${family}`;
  const sp = c.measureText(' ').width;
  let lines = 1, cur = 0;
  for (const w of words) {
    const ww = c.measureText(w).width;
    if (ww > inner) return Infinity;
    if (!cur) cur = ww; else if (cur + sp + ww <= inner) cur += sp + ww; else { lines++; cur = ww; }
  }
  return lines;
}

function MiniTree({ horse, orient = 'h', maxDepth = 3 }: { horse: Horse; orient?: 'h' | 'v'; maxDepth?: number }) {
  const { tr, tx, n, rtl, lang } = useI18n();
  const [ref, W, H] = useElementSize<HTMLDivElement>();
  const [hot, setHot] = useState<number | null>(null);
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    let on = true;
    const bump = () => on && setFontTick((t) => t + 1);
    document.fonts?.ready.then(bump);
    document.fonts?.addEventListener?.('loadingdone', bump);
    return () => { on = false; document.fonts?.removeEventListener?.('loadingdone', bump); };
  }, []);
  const v = orient === 'v';
  const GX = 12, GY = 4, VGX = 3, VGY = 16, STUB = 14;
  const measured = W > 0 && H > 0;
  const lineage = useLineageVersion(); // ancestor rows may land after mount

  const plan = useMemo(() => {
    if (!measured) return null;
    const family = getComputedStyle(document.body).fontFamily;
    const geom = (d: number) => {
      if (v) {
        const cols = Math.pow(2, d);
        const w = (W - (cols - 1) * VGX) / cols;
        const h = Math.min(60, (H - d * VGY) / (d + 1));
        return { w, h, slot: 0, ok: w >= 54 && h >= 30 };
      }
      const slot = H / Math.pow(2, d);
      const w = (W - STUB - (d - 1) * GX) / d;
      return { w, h: Math.min(42, slot - GY), slot, ok: w >= 68 && slot - GY >= 25 };
    };
    const names = (d: number) => {
      const out = flatten(buildPedigree(horse, d)).filter((x) => !x.isRoot).map((x) => (x.name ? tr(x.name) : tx('Unknown', 'نامشخص')));
      if (v) out.push(tr(horse.name));
      return out;
    };
    const size = (labels: string[], g: { w: number; h: number }) => {
      const inner = (g.w - (v ? 9 : 17)) * 0.97;
      const pick = (sub: boolean) => { for (let f = 11; f >= 8; f -= 0.5) if (labels.every((l) => linesFor(l, f, inner, family, v ? 500 : 600) * f * 1.14 + (sub ? f * 1.1 : 0) <= g.h - 6)) return f; return 0; };
      let sub = g.h >= 34, f = pick(sub);
      if (sub && f < 9.5) { sub = false; f = pick(false); }
      return { f, sub };
    };
    for (let d = maxDepth; d >= 1; d--) {
      const g = geom(d);
      if (!g.ok) continue;
      const r = size(names(d), g);
      if (r.f) return { depth: d, g, ...r };
    }
    const g = geom(1);
    return { depth: 1, g, f: 8, sub: false };
  }, [horse, orient, W, H, lang, maxDepth, measured, v, fontTick, lineage]); // eslint-disable-line react-hooks/exhaustive-deps

  const depth = plan?.depth ?? 1;
  const g = plan?.g ?? { w: 80, h: 28, slot: 30 };
  const root = useMemo(() => buildPedigree(horse, depth), [horse, depth, lineage]);
  const nodes = useMemo(() => flatten(root).filter((x) => !x.isRoot), [root]);
  const repeats = useMemo(() => repeatedKeys(root), [root]);

  const used = v ? (depth + 1) * g.h + depth * VGY : 0;
  const oy = v ? Math.max(0, (H - used) / 2) : 0;
  const mirror = (x: number) => (rtl ? W - x - g.w : x);
  const pos = (nd: PNode) => {
    const i = nd.id - Math.pow(2, nd.gen);
    const span = Math.pow(2, depth - nd.gen);
    if (v) {
      const left = i * span * (g.w + VGX), right = (i * span + span - 1) * (g.w + VGX) + g.w;
      return { x: mirror((left + right) / 2 - g.w / 2), y: oy + (depth - nd.gen) * (g.h + VGY) };
    }
    return { x: mirror(STUB + (nd.gen - 1) * (g.w + GX)), y: (i * span + span / 2) * g.slot - g.h / 2 };
  };
  const P0 = new Map(nodes.map((nd) => [nd.id, pos(nd)]));
  const rootBox = v ? { x: W / 2 - g.w / 2, y: oy + depth * (g.h + VGY) } : null;
  const dot = { x: rtl ? W - STUB / 2 : STUB / 2, y: H / 2 };
  const edges = nodes.map((nd) => {
    const p = P0.get(nd.id)!;
    const cid = Math.floor(nd.id / 2);
    let d: string;
    if (v) {
      const c = cid === 1 ? rootBox! : P0.get(cid)!;
      const sx = c.x + g.w / 2, sy = c.y, ex = p.x + g.w / 2, ey = p.y + g.h, my = (sy + ey) / 2;
      d = `M${sx} ${sy} C${sx} ${my} ${ex} ${my} ${ex} ${ey}`;
    } else {
      const c = cid === 1 ? null : P0.get(cid)!;
      const sx = c ? (rtl ? c.x : c.x + g.w) : dot.x, sy = c ? c.y + g.h / 2 : dot.y, ex = rtl ? p.x + g.w : p.x, ey = p.y + g.h / 2, mx = (sx + ex) / 2;
      d = `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`;
    }
    return { id: nd.id, gen: nd.gen, d, color: sexHex(nd) };
  });
  const labels = nodes.map((nd) => (nd.name ? tr(nd.name) : tx('Unknown', 'نامشخص')));
  const f = plan?.f ?? 9, sub = plan?.sub ?? false;
  const pad = v ? 'px-[3px]' : 'px-1.5';
  const weight = v ? 'font-medium' : 'font-semibold';

  return (
    <div ref={ref} className={cn('absolute inset-y-0', v ? '-inset-x-1.5' : 'inset-x-0')} onMouseLeave={() => setHot(null)}>
      {measured && plan && (
        <div key={`${horse.id}-${orient}-${depth}`} className="relative h-full w-full">
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H} fill="none" aria-hidden>
            {edges.map((e) => (
              <path key={e.id} d={e.d} pathLength={1} className="draw-path" strokeLinecap="round" style={{ stroke: e.color, strokeWidth: hot === e.id ? 2 : 1.4, opacity: hot === null ? 0.55 : hot === e.id ? 0.95 : 0.2, animationDelay: `${(e.gen - 1) * 90}ms`, transition: 'opacity .2s, stroke-width .2s' }} />
            ))}
            {!v && <circle cx={dot.x} cy={dot.y} r="3.2" style={{ fill: 'var(--color-od-gold-400)' }} />}
          </svg>
          {rootBox && (
            <div className={cn('absolute flex flex-col justify-center overflow-hidden rounded-md border-2 text-start leading-[1.12] text-white', pad)} style={{ left: rootBox.x, top: rootBox.y, width: g.w, height: g.h, fontSize: f, background: 'var(--color-navy-800)', borderColor: 'var(--color-od-gold-400)', animation: 'node-in .4s cubic-bezier(.22,1,.36,1) both' }}>
              <span className={cn('block break-words', weight)}>{tr(horse.name)}</span>
              {sub && <span className="block text-od-gold-200" style={{ fontSize: Math.max(8, f - 1.5) }}>{n(horse.birth.slice(0, 4))}</span>}
            </div>
          )}
          {nodes.map((nd, k) => {
            const p = P0.get(nd.id)!;
            const unknown = !nd.name;
            const rep = !unknown && repeats.has(nd.key);
            return (
              <button
                key={nd.id}
                type="button"
                data-mini=""
                title={unknown ? undefined : nd.year != null ? `${labels[k]} · ${nd.year}` : labels[k]}
                disabled={!nd.horseId}
                onMouseEnter={() => setHot(nd.id)}
                onFocus={() => setHot(nd.id)}
                onBlur={() => setHot(null)}
                onClick={() => nd.horseId && go('/horses/' + nd.horseId)}
                className={cn('absolute flex flex-col justify-center overflow-hidden rounded-md border border-line text-start leading-[1.12] outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-od-gold-300', pad, nd.horseId ? 'cursor-pointer hover:brightness-95' : 'cursor-default', unknown ? 'border-dashed text-fg-navy-400' : v ? 'border-t-[3px] text-fg-navy-900' : 'border-s-[3px] text-fg-navy-900')}
                style={{
                  left: p.x, top: p.y, width: g.w, height: g.h, fontSize: f,
                  background: unknown ? 'transparent' : nd.sex === 'U' ? 'var(--color-surface-2)' : nd.sex === 'M' ? 'var(--tint-male)' : 'var(--tint-female)',
                  [v ? 'borderTopColor' : 'borderInlineStartColor']: unknown ? undefined : sexHex(nd),
                  animation: `node-in .4s cubic-bezier(.22,1,.36,1) ${nd.gen * 80}ms both`,
                }}
              >
                <span className={cn('block break-words', weight)}>{labels[k]}</span>
                {sub && !unknown && nd.year != null && <span className="block text-fg-navy-500" style={{ fontSize: Math.max(8, f - 1.5) }}>{n(String(nd.year))}</span>}
                {rep && <span className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-od-gold-400" title={tx('Linebred ancestor', 'نیای خط‌پرورشی')} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


/* =====================================================================
   StairPedigree — the vertical preview: an outline tree.
   The horse first, then the sire line, then the dam line, each generation stepped in a little.
   Every row is the same size, rows are as tall as the box allows, names sit on one line with the
   birth year on the right, and the connectors are square elbows — the most compact way to show
   three generations in a narrow column while keeping every name readable.
   ===================================================================== */
function StairPedigree({ horse, maxDepth = 3 }: { horse: Horse; maxDepth?: number }) {
  const { tr, tx, n, rtl, lang } = useI18n();
  const [ref, W, H] = useElementSize<HTMLDivElement>();
  const [hot, setHot] = useState<number | null>(null);
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    let on = true;
    const bump = () => on && setFontTick((t) => t + 1);
    document.fonts?.ready.then(bump);
    document.fonts?.addEventListener?.('loadingdone', bump);
    return () => { on = false; document.fonts?.removeEventListener?.('loadingdone', bump); };
  }, []);
  const IND = 14, GAP = 2.5, MAXROW = 36, MINROW = 18;
  const measured = W > 0 && H > 0;
  const lineage = useLineageVersion(); // ancestor rows may land after mount

  const plan = useMemo(() => {
    if (!measured) return null;
    const family = getComputedStyle(document.body).fontFamily;
    for (let d = maxDepth; d >= 1; d--) {
      const rows = Math.pow(2, d + 1) - 1;
      const rowH = Math.min(MAXROW, (H - (rows - 1) * GAP) / rows);
      const w = W - d * IND;
      if (rowH < MINROW || w < 128) continue;
      const labels = flatten(buildPedigree(horse, d)).map((x) => (x.name ? tr(x.name) : tx('Unknown', 'نامشخص')));
      for (let f = Math.min(12, Math.floor(rowH * 0.56 * 2) / 2); f >= 9; f -= 0.5) {
        if (labels.every((l) => linesFor(l, f, w - 14 - 34, family) === 1)) return { depth: d, rowH, w, f };
      }
      if (rowH >= 30 && labels.every((l) => linesFor(l, 9.5, w - 14 - 34, family) * 9.5 * 1.15 <= rowH - 4)) return { depth: d, rowH, w, f: 9.5 };
    }
    const w = W - IND;
    return { depth: 1, rowH: Math.min(MAXROW, (H - 2 * GAP) / 3), w, f: 9 };
  }, [horse, W, H, lang, maxDepth, measured, fontTick, lineage]); // eslint-disable-line react-hooks/exhaustive-deps

  const depth = plan?.depth ?? 1;
  const rowH = plan?.rowH ?? 24, w = plan?.w ?? 200, f = plan?.f ?? 10;
  const root = useMemo(() => buildPedigree(horse, depth), [horse, depth, lineage]);
  const order = useMemo(() => { const out: PNode[] = []; const walk = (x: PNode) => { out.push(x); x.parents?.forEach(walk); }; walk(root); return out; }, [root]);
  const repeats = useMemo(() => repeatedKeys(root), [root]);
  const rowOf = new Map(order.map((x, i) => [x.id, i]));
  const X = (gen: number) => (rtl ? W - gen * IND - w : gen * IND);
  const Y = (id: number) => rowOf.get(id)! * (rowH + GAP);
  const chain = new Set<number>();
  for (let c = hot ?? 0; c >= 2; c = Math.floor(c / 2)) chain.add(c);

  const edges = order.filter((x) => !x.isRoot).map((nd) => {
    const pid = Math.floor(nd.id / 2);
    const px0 = X(Math.floor(Math.log2(pid))), pY = Y(pid);
    const tx0 = rtl ? px0 + w - IND / 2 : px0 + IND / 2;
    const cy = Y(nd.id) + rowH / 2;
    const ex = rtl ? X(nd.gen) + w : X(nd.gen);
    const sire = nd.id % 2 === 0;
    const from = sire ? pY + rowH : Y(nd.id - 1) + rowH / 2; // dam continues the trunk from the sire's row
    const r = 4, dir = rtl ? -1 : 1;
    return { id: nd.id, gen: nd.gen, color: sexHex(nd), d: `M${tx0} ${from} V${cy - r} Q${tx0} ${cy} ${tx0 + dir * r} ${cy} H${ex}` };
  });

  return (
    <div ref={ref} className="absolute inset-0" onMouseLeave={() => setHot(null)}>
      {measured && plan && (
        <div key={`${horse.id}-${depth}`} className="relative h-full w-full">
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H} fill="none" aria-hidden>
            {edges.map((e) => (
              <path key={e.id} d={e.d} pathLength={1} className="draw-path" strokeLinecap="round" style={{ stroke: e.color, strokeWidth: chain.has(e.id) ? 2 : 1.4, opacity: hot === null ? 0.6 : chain.has(e.id) ? 1 : 0.18, animationDelay: `${(e.gen - 1) * 90}ms`, transition: 'opacity .2s, stroke-width .2s' }} />
            ))}
          </svg>
          {order.map((nd) => {
            const unknown = !nd.name;
            const label = unknown ? tx('Unknown', 'نامشخص') : tr(nd.name!);
            const rep = !unknown && repeats.has(nd.key);
            const style: React.CSSProperties = { left: X(nd.gen), top: Y(nd.id), width: w, height: rowH, fontSize: f, animation: `node-in .4s cubic-bezier(.22,1,.36,1) ${nd.gen * 80}ms both` };
            const body = (
              <>
                <span className="min-w-0 flex-1 break-words font-semibold leading-[1.12]">{label}</span>
                {!unknown && nd.year != null && <span className={cn('shrink-0 tabular-nums', nd.isRoot ? 'text-od-gold-200' : 'text-fg-navy-500')} style={{ fontSize: Math.max(8.5, f - 1.5) }}>{n(String(nd.year))}</span>}
                {rep && <span className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-od-gold-400" title={tx('Linebred ancestor', 'نیای خط‌پرورشی')} />}
              </>
            );
            if (nd.isRoot)
              return <div key={nd.id} className="absolute flex items-center gap-1.5 overflow-hidden rounded-md border-2 px-2 text-white" style={{ ...style, background: 'var(--color-navy-800)', borderColor: 'var(--color-od-gold-400)' }}>{body}</div>;
            return (
              <button
                key={nd.id}
                type="button"
                data-mini=""
                title={unknown ? undefined : `${label} · ${nd.year}`}
                disabled={!nd.horseId}
                onMouseEnter={() => setHot(nd.id)}
                onFocus={() => setHot(nd.id)}
                onBlur={() => setHot(null)}
                onClick={() => nd.horseId && go('/horses/' + nd.horseId)}
                className={cn('absolute flex items-center gap-1.5 overflow-hidden rounded-md border border-line px-2 text-start outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-od-gold-300', nd.horseId ? 'cursor-pointer hover:brightness-95' : 'cursor-default', unknown ? 'border-dashed text-fg-navy-400' : 'border-s-[3px] text-fg-navy-900')}
                style={{ ...style, background: unknown ? 'transparent' : nd.sex === 'U' ? 'var(--color-surface-2)' : nd.sex === 'M' ? 'var(--tint-male)' : 'var(--tint-female)', borderInlineStartColor: unknown ? undefined : sexHex(nd) }}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact pedigree for narrow boxes: a horizontal fan, or a vertical outline */
export function MiniPedigree({ horse, orient = 'h', maxDepth = 3 }: { horse: Horse; orient?: 'h' | 'v'; maxDepth?: number }) {
  return orient === 'v' ? <StairPedigree horse={horse} maxDepth={maxDepth} /> : <MiniTree horse={horse} orient="h" maxDepth={maxDepth} />;
}
