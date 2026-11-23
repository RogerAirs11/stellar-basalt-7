import { AssistantPanel, type AssistantPageContext } from '../../../../../frontend-kit';
import { retroText } from '../i18n/messages';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';
import type { Route } from '../lib/hooks';

/**
 * R37 parity: full-page AI research desk inside the Retro Astra workspace.
 * Uses the shared AssistantPanel (conversation storage, streaming, entity
 * links, diagnostics) themed with the donor's paper-and-ink material tokens.
 * The host's bottom-right launcher keeps working everywhere as before.
 */
export function Assistant({ route }: { route: Route }) {
  const { runtime } = useHorseDbAdapter();
  const { language } = usePreferences();
  const fa = language === 'fa';
  const pageContext: AssistantPageContext = {
    route: route.id && /^\d+$/.test(route.id) ? `#/horses/${route.id}` : '#/assistant',
    ...(route.id && /^\d+$/.test(route.id) ? { horseId: Number(route.id) } : {}),
  };
  return <div className="retro-assistant-page">
    <div className="page-heading">
      <div>
        <span className="eyebrow">HORSE DB</span>
        <h1>{retroText(language, 'AI research desk', 'میز پژوهش هوش مصنوعی')}</h1>
        <p>{fa
          ? 'گفت‌وگوی پژوهشی مبتنی بر داده‌های رسمی Horse DB؛ نام اسب‌ها به پروندهٔ آن‌ها وصل می‌شود.'
          : 'Registry-grounded research chat; horse names link straight to their records.'}</p>
      </div>
    </div>
    <AssistantPanel platform={runtime.platform} locale={language} fullPage pageContext={pageContext} />
  </div>;
}
