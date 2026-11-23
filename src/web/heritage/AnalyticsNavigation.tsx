import { useId } from "react";
import { ContextNavigation } from "./Navigation";
import type { AnalyticsSection } from "./analyticsNavigation";
type Item = { id: string; label: string };
/**
 * One mounted set of buttons, inline on phones and nested under Analytics in
 * the desktop sidebar. No ARIA tree role: these are ordinary navigation buttons,
 * not a tree widget with an unimplemented arrow-key interaction contract.
 */
export function AnalyticsNavigation({ sections, views, section, view, onSection, onView, label, viewLabel }: {
  sections: readonly { id: AnalyticsSection; label: string }[];
  views: Readonly<Record<Exclude<AnalyticsSection, "all">, readonly Item[]>>;
  section: AnalyticsSection; view: string;
  onSection: (id: AnalyticsSection) => void; onView: (id: string) => void;
  label: string; viewLabel: string;
}) {
  const id = useId();
  return <ContextNavigation slot="h102-analytics-context">
    <nav className="h122-analysis-nav" aria-label={label}>
      {sections.map(item => <div className="h122-analysis-group" key={item.id} data-current={section === item.id}>
        <button type="button" className="h122-analysis-section" aria-pressed={section === item.id}
          aria-controls={section === item.id && item.id !== "all" ? `${id}-${item.id}` : undefined}
          onClick={() => onSection(item.id)}>
          <span>{item.label}</span>{item.id !== "all" && <span className="h122-analysis-caret" aria-hidden="true">{section === item.id ? "−" : "+"}</span>}
        </button>
        {item.id !== "all" && section === item.id && <div className="h122-analysis-views" id={`${id}-${item.id}`} role="group" aria-label={`${item.label} · ${viewLabel}`}>
          {views[item.id].map(child => <div className="h122-analysis-leaf" key={child.id}><button type="button" key={child.id} aria-pressed={view === child.id}
            className="h122-analysis-view" onClick={() => onView(child.id)}>{child.label}</button>{item.id === "overview" && child.id === "intelligence" && view === child.id && <div id="h102-analytics-premium-context" className="h122-analysis-tertiary-slot"/>}</div>)}
        </div>}
      </div>)}
    </nav>
  </ContextNavigation>;
}
