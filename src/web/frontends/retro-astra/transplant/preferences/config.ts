import type { CSSProperties } from 'react';
import type { Language, MessageKey } from '../i18n/messages';

export type PaletteId = 'oakfield' | 'oxford' | 'mulberry' | 'teal';
export type ColorMode = 'light' | 'dark';
export type EnglishFont = 'library' | 'editorial' | 'workbench';
export type PersianFont = 'vazirmatn' | 'estedad' | 'naskh';
export type Density = 'adaptive' | 'compact' | 'comfortable';

interface Palette {
  id: PaletteId;
  name: MessageKey;
  description: MessageKey;
  hue: number;
  saturation: number;
  paperHue: number;
  metalHue: number;
  swatches: readonly [string, string, string];
}

export const palettes: readonly Palette[] = [
  { id: 'oakfield', name: 'oakfield', description: 'oakfieldTheory', hue: 143, saturation: 27, paperHue: 43, metalHue: 39, swatches: ['#385b42', '#ede3c7', '#c4a66c'] },
  { id: 'oxford', name: 'oxford', description: 'oxfordTheory', hue: 216, saturation: 32, paperHue: 42, metalHue: 36, swatches: ['#354f70', '#eee6d6', '#c89b58'] },
  { id: 'mulberry', name: 'mulberry', description: 'mulberryTheory', hue: 332, saturation: 24, paperHue: 32, metalHue: 152, swatches: ['#704652', '#ece0d2', '#91aa9b'] },
  { id: 'teal', name: 'teal', description: 'tealTheory', hue: 177, saturation: 30, paperHue: 44, metalHue: 24, swatches: ['#315f5e', '#e7e5d4', '#c09472'] },
];

export const englishFonts: Record<EnglishFont, { label: MessageKey; ui: string; display: string; query: string }> = {
  library: { label: 'libraryFont', ui: "'DM Sans', Arial, sans-serif", display: "'Lora', Georgia, serif", query: 'family=DM+Sans:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;1,400' },
  editorial: { label: 'editorialFont', ui: "'Source Sans 3', Arial, sans-serif", display: "'Cormorant Garamond', Georgia, serif", query: 'family=Source+Sans+3:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500' },
  workbench: { label: 'workbenchFont', ui: "'Inter', Arial, sans-serif", display: "'Bitter', Georgia, serif", query: 'family=Inter:wght@400;500;600;700&family=Bitter:ital,wght@0,400;0,500;0,600;1,400' },
};
export const persianFonts: Record<PersianFont, { label: MessageKey; ui: string; display: string; query: string }> = {
  vazirmatn: { label: 'vazirmatnFont', ui: "'Vazirmatn', Tahoma, sans-serif", display: "'Vazirmatn', Tahoma, sans-serif", query: 'family=Vazirmatn:wght@400;500;600;700' },
  estedad: { label: 'estedadFont', ui: "'Estedad', Tahoma, sans-serif", display: "'Estedad', Tahoma, sans-serif", query: 'family=Estedad:wght@400;500;600;700' },
  naskh: { label: 'naskhFont', ui: "'Vazirmatn', Tahoma, sans-serif", display: "'Noto Naskh Arabic', Tahoma, serif", query: 'family=Vazirmatn:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600;700' },
};

/** R123: Arabic joins Farsi in the RTL + Arabic-script font track. */
export function isRtlLang(language: Language): boolean {
  return language === 'fa' || language === 'ar';
}

export interface Preferences {
  version: 3;
  language: Language;
  palette: PaletteId;
  modes: Record<PaletteId, ColorMode>;
  englishFont: EnglishFont;
  persianFont: PersianFont;
}

export const defaultPreferences: Preferences = {
  version: 3, language: 'en', palette: 'oakfield',
  modes: { oakfield: 'light', oxford: 'light', mulberry: 'light', teal: 'light' },
  englishFont: 'library', persianFont: 'vazirmatn',
};

export function isPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Preferences>;
  return item.version === 3 && ['en', 'fa', 'ar'].includes(item.language ?? '') &&
    palettes.some(palette => palette.id === item.palette) && Object.prototype.hasOwnProperty.call(englishFonts, item.englishFont ?? '') &&
    Object.prototype.hasOwnProperty.call(persianFonts, item.persianFont ?? '') && Boolean(item.modes) &&
    palettes.every(palette => ['light', 'dark'].includes(item.modes?.[palette.id] ?? ''));
}

export function themeVariables(preferences: Preferences): CSSProperties {
  const palette = palettes.find(item => item.id === preferences.palette)!;
  const dark = preferences.modes[palette.id] === 'dark';
  const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;
  const { hue: h, saturation: s, paperHue: p, metalHue: m } = palette;
  const font = isRtlLang(preferences.language) ? persianFonts[preferences.persianFont] : englishFonts[preferences.englishFont];
  return {
    '--theme-hue': h, '--theme-paper-hue': p,
    '--font-ui': font.ui, '--font-display': font.display,
    '--font-note': isRtlLang(preferences.language) ? persianFonts[preferences.persianFont].display : "'Caveat', Georgia, serif",
    '--font-mono': isRtlLang(preferences.language) ? persianFonts[preferences.persianFont].ui : "'Courier New', monospace",
    '--font-english-ui': englishFonts[preferences.englishFont].ui,
    '--font-english-display': englishFonts[preferences.englishFont].display,
    '--font-persian-ui': persianFonts[preferences.persianFont].ui,
    '--font-persian-display': persianFonts[preferences.persianFont].display,
    '--canvas': hsl(p, dark ? 11 : 33, dark ? 15 : 84),
    '--surface': hsl(p, dark ? 12 : 42, dark ? 19 : 90),
    '--surface-raised': hsl(p, dark ? 12 : 52, dark ? 23 : 95),
    '--surface-inset': hsl(p, dark ? 11 : 27, dark ? 13 : 82),
    '--surface-header': hsl(p, dark ? 13 : 36, dark ? 23 : 85),
    '--paper': hsl(p, dark ? 12 : 46, dark ? 19 : 90),
    '--paper-light': hsl(p, dark ? 12 : 52, dark ? 22 : 95),
    '--paper-edge': hsl(p, dark ? 13 : 23, dark ? 34 : 64),
    '--ink': hsl(p, dark ? 23 : 18, dark ? 87 : 21),
    '--ink-strong': hsl(h, dark ? 17 : 24, dark ? 91 : 23),
    '--ink-muted': hsl(p, dark ? 14 : 17, dark ? 69 : 32),
    '--ink-faint': hsl(p, dark ? 12 : 15, dark ? 65 : 33),
    '--line': hsl(p, dark ? 12 : 26, dark ? 37 : 66),
    '--line-soft': hsl(p, dark ? 10 : 30, dark ? 29 : 77),
    '--accent': hsl(h, dark ? 29 : s, dark ? 72 : 30),
    '--accent-hover': hsl(h, dark ? 30 : s, dark ? 82 : 37),
    '--accent-soft': hsl(h, dark ? 16 : 23, dark ? 25 : 85),
    '--enamel-top': hsl(h, s, dark ? 36 : 47),
    '--enamel-mid': hsl(h, s, dark ? 27 : 35),
    '--enamel-bottom': hsl(h, s, dark ? 20 : 27),
    '--leather': hsl(h, s, dark ? 14 : 29),
    '--leather-light': hsl(h, s, dark ? 22 : 35),
    '--leather-dark': hsl(h, s, dark ? 11 : 22),
    '--leather-ink': hsl(p, 42, 89), '--leather-muted': hsl(h, 15, 76),
    '--gold': hsl(m, dark ? 43 : 51, dark ? 66 : 34),
    '--gold-ink': hsl(m, dark ? 43 : 51, dark ? 70 : 26),
    '--gold-soft': hsl(m, dark ? 22 : 47, dark ? 28 : 80),
    '--brass-light': hsl(m, dark ? 33 : 60, dark ? 52 : 81),
    '--brass-mid': hsl(m, dark ? 34 : 43, dark ? 36 : 65),
    '--brass-dark': hsl(m, dark ? 24 : 37, dark ? 26 : 43),
    '--brass-ink': hsl(m, 30, dark ? 92 : 26),
    '--sire': dark ? '#a5cbdc' : '#3f667c', '--sire-soft': dark ? '#2b3d42' : '#dce6df', '--sire-border': dark ? '#627e88' : '#9db2b3',
    '--dam': dark ? '#e9b29a' : '#945a41', '--dam-soft': dark ? '#493731' : '#eddbc4', '--dam-border': dark ? '#946f5c' : '#c19b7c',
    '--danger': dark ? '#efa18b' : '#9b4936', '--focus': hsl(h, dark ? 44 : 35, dark ? 74 : 40),
    '--highlight': dark ? '#ffffff14' : '#fff9e5', '--lowlight': dark ? '#00000045' : '#977b4c38',
    '--shadow-color': dark ? '#00000050' : '#59472a28', '--wood-shade': dark ? '#141917b0' : '#c4a26b18',
    '--hero-shade': dark ? '#14241fb0' : 'transparent',
    colorScheme: dark ? 'dark' : 'light',
  } as CSSProperties;
}