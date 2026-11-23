import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'fa';
export type L = { en: string; fa: string };
export const L = (en: string, fa: string): L => ({ en, fa });

const faDigits = '۰۱۲۳۴۵۶۷۸۹';
export const toFaDigits = (s: string) => s.replace(/\d/g, (d) => faDigits[+d]);

interface I18n {
  lang: Lang;
  rtl: boolean;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** inline bilingual string */
  tx: (en: string, fa: string) => string;
  /** localized object */
  tr: (l: L) => string;
  /** localized number */
  n: (v: number | string, decimals?: number) => string;
  /** localized date (Jalali in Farsi) */
  date: (iso: string, style?: 'short' | 'long' | 'year' | 'month') => string;
  cal: 'jalali' | 'greg';
  toggleCal: () => void;
  place: (p: number) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // R162: first visit must match the platform default. Heritage boots Farsi
  // (parseUiLocale fallback "fa"); the donor used to hard-default to English,
  // so a visitor arriving from the Farsi core saw an English interface. The
  // donor's own saved choice wins; otherwise inherit the shell's locale.
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('lang');
    if (saved === 'fa' || saved === 'en') return saved;
    const shell = localStorage.getItem('registry-locale');
    if (shell === 'fa' || shell === 'en') return shell;
    return 'fa';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    localStorage.setItem('lang', lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const [calPref, setCalPref] = useState<'jalali' | 'greg' | null>(() => (localStorage.getItem('cal') as 'jalali' | 'greg' | null) || null);
  const cal: 'jalali' | 'greg' = calPref ?? (lang === 'fa' ? 'jalali' : 'greg');

  const value = useMemo<I18n>(() => {
    const fa = lang === 'fa';
    return {
      lang,
      rtl: fa,
      setLang,
      toggle: () => setLangState((l) => (l === 'en' ? 'fa' : 'en')),
      cal,
      toggleCal: () => setCalPref((c) => { const n = (c ?? (lang === 'fa' ? 'jalali' : 'greg')) === 'jalali' ? 'greg' : 'jalali'; localStorage.setItem('cal', n); return n; }),
      tx: (en, f) => (fa ? f : en),
      tr: (l) => (fa ? l.fa : l.en),
      n: (v, decimals) => {
        if (typeof v === 'string') return fa ? toFaDigits(v) : v;
        const opts = decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : undefined;
        return v.toLocaleString(fa ? 'fa-IR' : 'en-US', opts);
      },
      date: (iso, style = 'short') => {
        if (!iso) return '—';
        const d = new Date(iso + 'T12:00:00');
        if (isNaN(d.getTime())) return '—';
        const locale = (fa ? 'fa-IR' : 'en-GB') + '-u-ca-' + (cal === 'jalali' ? 'persian' : 'gregory');
        const opts: Intl.DateTimeFormatOptions =
          style === 'year'
            ? { year: 'numeric' }
            : style === 'month'
              ? { month: 'short' }
              : style === 'long'
                ? { day: 'numeric', month: 'long', year: 'numeric' }
                : { day: '2-digit', month: 'short', year: 'numeric' };
        return new Intl.DateTimeFormat(locale, opts).format(d);
      },
      place: (p) => {
        if (fa) {
          const names = ['', 'اول', 'دوم', 'سوم'];
          return names[p] || `${toFaDigits(String(p))}ام`;
        }
        const s = ['th', 'st', 'nd', 'rd'];
        const v = p % 100;
        return p + (s[(v - 20) % 10] || s[v] || s[0]);
      },
    };
  }, [lang, setLang, cal]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}
