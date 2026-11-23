import { createContext, useContext, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useStoredState } from '../lib/hooks';
import { translate, type Language, type MessageKey, type MessageParams } from '../i18n/messages';
import { localizeDomain } from '../i18n/domain';
import { defaultPreferences, isPreferences, themeVariables, type ColorMode, type PaletteId, type Preferences } from './config';

interface PreferencesContextValue {
  preferences: Preferences;
  setPreferences: Dispatch<SetStateAction<Preferences>>;
  language: Language;
  rtl: boolean;
  mode: ColorMode;
  setLanguage: (language: Language) => void;
  setPalette: (palette: PaletteId) => void;
  toggleMode: () => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  text: (value: string) => string;
  n: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  money: (value: number) => string;
}
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children, hostLocale, onSetHostLocale }: { children: ReactNode; hostLocale?: 'fa' | 'en' | 'ar'; onSetHostLocale?: (locale: 'fa' | 'en' | 'ar') => void }) {
  const [preferences, setPreferences] = useStoredState('retroastra.presentation.preferences.v1', defaultPreferences, isPreferences);
  // R32 host integration: when RetroAstra runs inside the Horse DB shell the
  // host's EN/FA toggle is authoritative and syncs live; the stored local
  // preference remains the source of truth for standalone usage.
  const effectiveLanguage: Language = hostLocale ?? preferences.language;
  useEffect(() => {
    if (hostLocale && preferences.language !== hostLocale) setPreferences(previous => ({ ...previous, language: hostLocale }));
  }, [hostLocale, preferences.language, setPreferences]);
  const { palette, modes } = preferences;
  const mode = modes[palette];
  const language = effectiveLanguage;
  const variables = useMemo(() => themeVariables({ ...preferences, language: effectiveLanguage }), [preferences, effectiveLanguage]);
  useEffect(() => {
    // Keep presentation state inside the donor root. The host document belongs to the active Horse DB shell.
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', String(variables['--leather' as keyof typeof variables]));
  }, [variables]);
  // Named families use installed/local fonts with system fallbacks. Changing
  // presentation never sends a request to a third-party font service.
  const value = useMemo<PreferencesContextValue>(() => {
    const locale = language === 'fa' ? 'fa-IR' : language === 'ar' ? 'ar-u-nu-arab' : 'en-GB';
    const n = (number: number, options: Intl.NumberFormatOptions = {}) => new Intl.NumberFormat(locale, options).format(number);
    return {
      preferences, setPreferences, language, rtl: language === 'fa' || language === 'ar', mode,
      setLanguage: next => { if (onSetHostLocale) onSetHostLocale(next); else setPreferences(previous => ({ ...previous, language: next })); },
      setPalette: next => setPreferences(previous => ({ ...previous, palette: next })),
      toggleMode: () => setPreferences(previous => ({ ...previous, modes: { ...previous.modes, [previous.palette]: previous.modes[previous.palette] === 'light' ? 'dark' : 'light' } })),
      t: (key, params = {}) => translate(language, key, Object.fromEntries(Object.entries(params).map(([name, item]) => [name, typeof item === 'number' ? n(item) : item]))),
      text: value => localizeDomain(value, language), n,
      date: (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, options).format(parsed) : '—'; },
      money: value => n(value, { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }),
    };
  }, [preferences, language, mode, setPreferences, onSetHostLocale, hostLocale]);
  // R66-Astra: mirror the content direction onto the document element while
  // this frontend owns the page — native scrollbars, scroll-start and iOS
  // viewport behaviour follow the chosen language; restored on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const previousDir = root.getAttribute('dir');
    const previousLang = root.getAttribute('lang');
    root.setAttribute('dir', language === 'fa' || language === 'ar' ? 'rtl' : 'ltr');
    root.setAttribute('lang', language);
    return () => {
      if (previousDir === null) root.removeAttribute('dir'); else root.setAttribute('dir', previousDir);
      if (previousLang === null) root.removeAttribute('lang'); else root.setAttribute('lang', previousLang);
    };
  }, [language]);
  return <PreferencesContext.Provider value={value}><div className="preferences-root" data-palette={palette} data-mode={mode} data-language={language} data-english-font={preferences.englishFont} data-persian-font={preferences.persianFont} dir={language === 'fa' || language === 'ar' ? 'rtl' : 'ltr'} style={variables}>{children}</div></PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('PreferencesProvider is required.');
  return context;
}