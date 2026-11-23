import { UI_LOCALES, UI_LOCALE_INFO, parseUiLocale, uiText, type UiLocale } from "../../shared/uiLocale";
/** Native select: complete keyboard, touch and screen-reader behavior, no popup clipping.
 * Flags are decorative examples, not a claim that a language belongs to one country.
 */
export function LanguageSelector({ locale, onChange, showFlags = true }: { locale: UiLocale; onChange: (value: UiLocale) => void; showFlags?: boolean }) {
  const info = UI_LOCALE_INFO[locale];
  const label = uiText(locale, "Interface language", "زبان رابط کاربری");
  return <label className="h122-language-selector" title={`${label} · ${info.name}`}>
    <span className="h122-language-display" aria-hidden="true">{showFlags && <span>{info.flag}</span>}<b>{locale.toUpperCase()}</b><span className="h122-language-caret">⌄</span></span>
    <select aria-label={label} value={locale} onChange={event => onChange(parseUiLocale(event.currentTarget.value, locale))}>
      {UI_LOCALES.map(value => <option key={value} value={value} lang={value}>
        {showFlags ? `${UI_LOCALE_INFO[value].flag} ` : ""}{UI_LOCALE_INFO[value].name} · {value.toUpperCase()}
      </option>)}
    </select>
  </label>;
}
