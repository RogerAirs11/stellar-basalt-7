import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { L } from './i18n';

/* =====================================================================
   Appearance = colour SCHEME (hue family) × MODE (light / dark / system).
   The two settings are independent: every scheme exists in both modes.
   ===================================================================== */
export type Mode = 'light' | 'dark' | 'system';
/** Interface STYLE: 'modern' = data-rich app look · 'classic' = quiet, editorial, hand-set look. Independent of scheme and mode. */
export type Style = 'modern' | 'classic';
export type SchemeKey = 'rosewood' | 'teal' | 'azure' | 'forest' | 'royal' | 'lagoon' | 'bordeaux' | 'amethyst' | 'graphite';
type HS = [number, number];
export interface Scheme { key: SchemeKey; name: L; theory: L; brand: HS; accent: HS; comp: HS }

export const SCHEMES: Scheme[] = [
  { key: 'rosewood', name: L('Rosewood & Sage', 'رز‌وود و مریم‌گلی'), theory: L('Soft, warm · dusty rose, champagne gold, sage — gentle and elegant', 'نرم و گرم · رز غبارآلود، طلای شامپاینی و سبز مریم‌گلی'), brand: [350, 26], accent: [37, 50], comp: [150, 20] },
  { key: 'teal', name: L('Teal & Orange', 'سبزآبی و نارنجی'), theory: L('Complementary · deep teal and burnt orange, with a cool slate', 'مکمل · سبزآبی عمیق و نارنجی سوخته، با خاکستری سرد'), brand: [190, 46], accent: [24, 62], comp: [212, 20] },
  { key: 'azure', name: L('Azure & Amber', 'آبی و کهربایی'), theory: L('Complementary + triad accent · blue, amber, teal', 'مکمل + تأکید سه‌گانه · آبی، کهربایی، سبزآبی'), brand: [213, 50], accent: [36, 70], comp: [172, 44] },
  { key: 'forest', name: L('Forest & Gold', 'جنگل و طلا'), theory: L('Split-complementary · green, gold, terracotta', 'مکمل‌های مجاور · سبز، طلایی، آجری'), brand: [158, 44], accent: [40, 54], comp: [12, 56] },
  { key: 'royal', name: L('Royal Navy', 'سرمه‌ای سلطنتی'), theory: L('Complementary · blue and gold', 'مکمل · آبی و طلایی'), brand: [221, 52], accent: [40, 54], comp: [352, 52] },
  { key: 'lagoon', name: L('Lagoon & Coral', 'تالاب و مرجانی'), theory: L('Complementary · teal and coral', 'مکمل · سبزآبی و مرجانی'), brand: [188, 58], accent: [10, 66], comp: [42, 60] },
  { key: 'bordeaux', name: L('Bordeaux & Sage', 'شرابی و مریم‌گلی'), theory: L('Complementary · wine and sage', 'مکمل · شرابی و سبز مریم‌گلی'), brand: [346, 46], accent: [152, 34], comp: [40, 56] },
  { key: 'amethyst', name: L('Amethyst & Saffron', 'آمتیست و زعفرانی'), theory: L('Split-complementary · violet, saffron, teal', 'مکمل‌های مجاور · بنفش، زعفرانی، سبزآبی'), brand: [268, 40], accent: [42, 78], comp: [172, 46] },
  { key: 'graphite', name: L('Graphite & Copper', 'گرافیت و مس'), theory: L('Neutral + warm accent · slate and copper', 'خنثی + تأکید گرم · خاکستری و مس'), brand: [208, 15], accent: [22, 62], comp: [200, 44] },
];

const SH = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const B_L = [96, 91, 82, 69, 55, 44, 35, 27, 20, 15, 9];
const B_S = [20, 22, 26, 29, 34, 44, 50, 53, 55, 57, 58];
const A_L = [95, 87, 75, 65, 55, 49, 40, 31, 24, 17, 10];
const A_S = [70, 62, 63, 63, 62, 50, 53, 53, 55, 55, 55];

function hsl(h: number, s: number, l: number) {
  s = Math.max(0, Math.min(100, s)) / 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}
const ramp = (h: number, s: number, Ls: number[], Ss: number[]) => Ls.map((l, i) => hsl(h, (Ss[i] * s) / 52, l));

/** Every CSS variable for a scheme in a given mode. */
export function buildVars(sc: Scheme, dark: boolean, style: Style = 'modern'): Record<string, string> {
  const v: Record<string, string> = {};
  const [bh, bs] = sc.brand, [ah, as_] = sc.accent, [ch, cs] = sc.comp;
  const nav = ramp(bh, bs, B_L, B_S), acc = ramp(ah, as_, A_L, A_S), cmp = ramp(ch, cs, A_L, A_S);
  const set = (k: string, val: string) => { v[k] = val; };

  // static "on-dark" tints — identical in both modes (used as text/bg on permanently dark surfaces)
  SH.forEach((s, i) => { if (s <= 400) { set(`--color-od-navy-${s}`, nav[i]); set(`--color-od-gold-${s}`, acc[i]); set(`--color-od-comp-${s}`, cmp[i]); } });

  if (!dark) {
    SH.forEach((s, i) => {
      set(`--color-navy-${s}`, nav[i]); set(`--color-gold-${s}`, acc[i]); set(`--color-comp-${s}`, cmp[i]);
      if (s >= 500) { set(`--color-fg-navy-${s}`, nav[i]); set(`--color-fg-gold-${s}`, acc[i]); set(`--color-fg-comp-${s}`, cmp[i]); }
      if (s === 300 || s === 400) set(`--color-fg-navy-${s}`, nav[i]);
    });
    // page → panel → inset → field : four steps, each a touch lighter and a few degrees warmer
    set('--color-canvas', hsl(bh - 5, 11, 88)); set('--color-surface', hsl(bh, 12, 97)); set('--color-surface-2', hsl(bh + 7, 10, 92.5)); set('--color-line', hsl(bh + 3, 10, 80.5));
    set('--color-sidebar', nav[9]); set('--color-sidebar-2', nav[10]);
    set('--tint-male', 'color-mix(in oklab, #3b82f6 9%, var(--color-surface))'); set('--tint-female', 'color-mix(in oklab, #f43f5e 9%, var(--color-surface))');
    set('--color-field', hsl(bh + 2, 18, 99.8)); set('--shadow-rgb', '11 27 61'); set('--hl', 'rgba(255,255,255,.75)');
  } else {
    // pale tints (backgrounds, borders, rings) become deep tinted surfaces
    const nt = [12, 15.5, 20, 27], at = [12.5, 16.5, 22, 30];
    SH.forEach((s, i) => {
      if (i < 4) { set(`--color-navy-${s}`, hsl(bh, 15, nt[i])); set(`--color-gold-${s}`, hsl(ah, 36, at[i])); set(`--color-comp-${s}`, hsl(ch, 34, at[i])); }
      else { set(`--color-gold-${s}`, acc[i]); set(`--color-comp-${s}`, cmp[i]); }
    });
    ([[400, 60, 14], [500, 46, 28], [600, 38, 36], [700, 31, 40], [800, 26, 42], [900, 21, 44], [950, 7, 40]] as const).forEach(([s, l, sat]) => set(`--color-navy-${s}`, hsl(bh, sat, l)));
    ([[300, 10, 44], [400, 10, 53]] as const).forEach(([s, sat, l]) => set(`--color-fg-navy-${s}`, hsl(bh, sat, l)));
    ([[500, 10, 62], [600, 10, 70], [700, 10, 78], [800, 11, 86], [900, 12, 94], [950, 14, 97]] as const).forEach(([s, sat, l]) => set(`--color-fg-navy-${s}`, hsl(bh, sat, l)));
    ([[500, 40, 56], [600, 42, 62], [700, 44, 68], [800, 46, 75], [900, 48, 83], [950, 50, 90]] as const).forEach(([s, sat, l]) => set(`--color-fg-comp-${s}`, hsl(ch, Math.min(100, (sat * cs) / 52), l)));
    ([[500, 55, 60], [600, 58, 64], [700, 60, 70], [800, 62, 76], [900, 64, 84], [950, 66, 90]] as const).forEach(([s, sat, l]) => set(`--color-fg-gold-${s}`, hsl(ah, Math.min(100, (sat * as_) / 52), l)));
    set('--color-canvas', hsl(bh - 5, 13, 7.5)); set('--color-surface', hsl(bh, 12, 11.5)); set('--color-surface-2', hsl(bh + 7, 11, 16)); set('--color-line', hsl(bh + 3, 10, 25));
    set('--color-sidebar', hsl(bh - 3, 22, 5.5)); set('--color-sidebar-2', hsl(bh - 3, 24, 3.5));
    set('--tint-male', 'color-mix(in oklab, #3b82f6 16%, var(--color-surface))'); set('--tint-female', 'color-mix(in oklab, #f43f5e 16%, var(--color-surface))');
    set('--color-field', hsl(bh + 2, 12, 19.5)); set('--shadow-rgb', '0 0 0'); set('--hl', 'rgba(255,255,255,.04)');
  }
  // sidebar tokens (dark navy panel in Modern)
  set('--sb-bg1', v['--color-sidebar']); set('--sb-bg2', v['--color-sidebar-2']); set('--sb-fg', '#ffffff'); set('--sb-fg2', nav[2]); set('--sb-fg3', nav[4]);
  set('--sb-hover', 'rgba(255,255,255,.06)'); set('--sb-active', 'rgba(255,255,255,.1)'); set('--sb-line', 'rgba(255,255,255,.1)'); set('--sb-chip', 'rgba(255,255,255,.06)'); set('--sb-accent', acc[3]); set('--sb-card', 'rgba(255,255,255,.05)');

  if (style === 'classic') {
    // warm paper (light) or warm charcoal (dark); hairlines; a single quiet ink
    if (!dark) {
      set('--color-canvas', hsl(38, 24, 93.6)); set('--color-surface', hsl(40, 40, 97.8)); set('--color-surface-2', hsl(36, 22, 91)); set('--color-line', hsl(34, 15, 80)); set('--color-field', hsl(42, 60, 99.7));
      set('--tint-male', 'color-mix(in oklab, #5b7fb0 8%, var(--color-surface))'); set('--tint-female', 'color-mix(in oklab, #b66a7d 9%, var(--color-surface))');
      set('--shadow-rgb', '70 50 30'); set('--hl', 'rgba(255,255,255,.55)');
      set('--sb-bg1', hsl(37, 24, 90.2)); set('--sb-bg2', hsl(36, 24, 88)); set('--color-sidebar', hsl(37, 24, 90.2)); set('--color-sidebar-2', hsl(36, 24, 88));
      set('--sb-fg', hsl(bh, 26, 13)); set('--sb-fg2', hsl(bh, 14, 27)); set('--sb-fg3', hsl(bh, 8, 43)); set('--sb-hover', 'rgba(90,62,30,.065)'); set('--sb-active', 'transparent');
      set('--sb-line', hsl(34, 15, 77)); set('--sb-chip', 'transparent'); set('--sb-accent', acc[6]); set('--sb-card', 'rgba(90,62,30,.05)');
    } else {
      set('--color-canvas', hsl(30, 9, 8.5)); set('--color-surface', hsl(30, 8, 12)); set('--color-surface-2', hsl(30, 8, 16)); set('--color-line', hsl(30, 7, 26)); set('--color-field', hsl(30, 8, 19.5));
      set('--tint-male', 'color-mix(in oklab, #5b7fb0 15%, var(--color-surface))'); set('--tint-female', 'color-mix(in oklab, #b66a7d 16%, var(--color-surface))');
      set('--shadow-rgb', '0 0 0'); set('--hl', 'rgba(255,255,255,.03)');
      set('--sb-bg1', hsl(30, 9, 6.5)); set('--sb-bg2', hsl(30, 9, 5)); set('--color-sidebar', hsl(30, 9, 6.5)); set('--color-sidebar-2', hsl(30, 9, 5));
      set('--sb-fg', '#f3ede3'); set('--sb-fg2', hsl(30, 10, 72)); set('--sb-fg3', hsl(30, 8, 52)); set('--sb-hover', 'rgba(255,255,255,.05)'); set('--sb-active', 'transparent');
      set('--sb-line', 'rgba(255,255,255,.1)'); set('--sb-chip', 'transparent'); set('--sb-accent', acc[3]); set('--sb-card', 'rgba(255,255,255,.04)');
    }
    // one quiet ink instead of a rainbow of area colours: people, breeding, admin and services share the brand ramp
    const keys = Object.keys(v);
    for (const h of ['indigo', 'violet', 'fuchsia', 'teal']) for (const k of keys) {
      const m = k.match(/^--color-(fg-|od-)?navy-(\d+)$/);
      if (m) set(`--color-${m[1] ?? ''}${h}-${m[2]}`, v[k]);
    }
  }
  set('--ink', `var(--color-fg-navy-900)`);
  // the Registry area ("sky") always wears the brand colour of the active scheme
  SH.forEach((s) => {
    if (v[`--color-navy-${s}`]) set(`--color-sky-${s}`, v[`--color-navy-${s}`]);
    if (v[`--color-fg-navy-${s}`]) set(`--color-fg-sky-${s}`, v[`--color-fg-navy-${s}`]);
    if (v[`--color-od-navy-${s}`]) set(`--color-od-sky-${s}`, v[`--color-od-navy-${s}`]);
  });
  return v;
}

const KEY_S = 'eq-scheme', KEY_M = 'eq-mode';
const readScheme = (): SchemeKey => { try { const s = localStorage.getItem(KEY_S) as SchemeKey; return SCHEMES.some((x) => x.key === s) ? s : 'teal'; } catch { return 'teal'; } };
const KEY_ST = 'eq-style';
const readStyle = (): Style => { try { return localStorage.getItem(KEY_ST) === 'classic' ? 'classic' : 'modern'; } catch { return 'modern'; } };
const readMode = (): Mode => { try { const m = localStorage.getItem(KEY_M) as Mode; return m === 'dark' || m === 'system' ? m : 'light'; } catch { return 'light'; } };
const sysDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const isDark = (m: Mode) => (m === 'system' ? sysDark() : m === 'dark');

export function applyAppearance(scheme: SchemeKey, mode: Mode, style: Style = 'modern') {
  const sc = SCHEMES.find((s) => s.key === scheme) || SCHEMES[0];
  const dark = isDark(mode);
  const el = document.documentElement;
  const vars = buildVars(sc, dark, style);
  for (const k in vars) el.style.setProperty(k, vars[k]);
  el.classList.toggle('dark', dark);
  el.dataset.scheme = scheme;
  el.dataset.style = style;
  el.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--color-sidebar']);
}
/** call once before first render so there is no flash */
/* ---------- display scale: makes common laptop windows fit without the user touching browser zoom ---------- */
export type Density = 'auto' | 'compact' | 'comfort';
const KEY_D = 'eq-density';
const readDensity = (): Density => { try { const d = localStorage.getItem(KEY_D) as Density; return d === 'compact' || d === 'comfort' ? d : 'auto'; } catch { return 'auto'; } };
export function zoomFor(d: Density, w: number, h: number): number {
  if (w < 1024) return 1; // phones & tablets are designed at 100%
  if (d === 'compact') return 0.88;
  if (d === 'comfort') return 1;
  if (w >= 1800) return 1;
  // 13″ MacBook at the default scale shows ≈ 1440×780, at "More space" ≈ 1680×900; 14″/16″ are taller
  if (h < 640) return 0.82;
  if (h < 700) return 0.86;
  if (h < 760) return 0.9;
  if (h < 800) return 0.92;
  if (h < 880) return 0.96;
  return 1;
}
export function applyDensity(d: Density) { document.documentElement.style.setProperty('--ui-zoom', String(zoomFor(d, window.innerWidth, window.innerHeight))); }

/** call once before first render so there is no flash */
export const initAppearance = () => { applyAppearance(readScheme(), readMode(), readStyle()); applyDensity(readDensity()); };

interface Ctx { scheme: SchemeKey; mode: Mode; style: Style; dark: boolean; density: Density; zoom: number; setScheme: (s: SchemeKey) => void; setMode: (m: Mode) => void; setStyle: (s: Style) => void; setDensity: (d: Density) => void }
const C = createContext<Ctx | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeS] = useState<SchemeKey>(readScheme);
  const [mode, setModeS] = useState<Mode>(readMode);
  const [style, setStyleS] = useState<Style>(readStyle);
  const [density, setDensityS] = useState<Density>(readDensity);
  const [sys, setSys] = useState(sysDark);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMq = () => setSys(!!mq?.matches);
    mq?.addEventListener('change', onMq);
    const onRs = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onRs);
    return () => { mq?.removeEventListener('change', onMq); window.removeEventListener('resize', onRs); };
  }, []);
  useEffect(() => { applyAppearance(scheme, mode, style); }, [scheme, mode, style, sys]);
  useEffect(() => { applyDensity(density); }, [density, vp]);
  const v = useMemo<Ctx>(() => ({
    scheme, mode, style, density, dark: mode === 'system' ? sys : mode === 'dark', zoom: zoomFor(density, vp.w, vp.h),
    setScheme: (s) => { try { localStorage.setItem(KEY_S, s); } catch { /* ignore */ } setSchemeS(s); },
    setMode: (m) => { try { localStorage.setItem(KEY_M, m); } catch { /* ignore */ } setModeS(m); },
    setStyle: (st) => { try { localStorage.setItem(KEY_ST, st); } catch { /* ignore */ } setStyleS(st); },
    setDensity: (d) => { try { localStorage.setItem(KEY_D, d); } catch { /* ignore */ } setDensityS(d); },
  }), [scheme, mode, style, density, sys, vp]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

export function useAppearance() {
  const c = useContext(C);
  if (!c) throw new Error('AppearanceProvider missing');
  return c;
}

/** swatch colours for previews */
export const swatch = (sc: Scheme) => ({ brand: hsl(sc.brand[0], (sc.brand[1] * 62) / 52, 30), brand2: hsl(sc.brand[0], (sc.brand[1] * 55) / 52, 20), accent: hsl(sc.accent[0], (sc.accent[1] * 60) / 52, 52), comp: hsl(sc.comp[0], (sc.comp[1] * 60) / 52, 52) });
