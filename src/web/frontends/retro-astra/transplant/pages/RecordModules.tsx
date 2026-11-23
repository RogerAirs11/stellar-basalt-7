import type { ReactNode } from "react";
import { HorseMediaPanel, useDomainResource, usePrincipalScope, loadHorseRecordModules, type RecordSection, type CompetitionResultRecord } from "../../../../../frontend-kit";
import { useHorseDbAdapter } from "../HorseDbAdapter";
import { usePreferences } from "../preferences/PreferencesProvider";
import { Button, EmptyState } from "../components/ui";
import { DeskResourceNotice } from "../components/DeskFeedback";
import { GeneticWorkbench } from "../../../../../frontend-kit";
import { AccountSecuritySessionNotice } from "../../../../../frontend-kit";

/** Typed canonical data, rendered only with Retro Astra's own components/styles. */
export function RecordModules({ horseId }: { horseId: number }) {
  const { runtime } = useHorseDbAdapter();
  const { language, n } = usePreferences();
  const fa = language === "fa";
  const label = (en: string, native: string) => fa ? native : en;
  const principal = usePrincipalScope(runtime.user, runtime.permissions);
  const resource = useDomainResource('retro-profile-records', `${principal}|horse:${horseId}`, signal => loadHorseRecordModules(runtime.platform, horseId, signal));
  const state = resource.state.phase === 'ready' || resource.state.phase === 'reloading' ? resource.state.data : null;
  const retry = resource.retry;
  const media = <HorseMediaPanel horseId={horseId} platform={runtime.platform} user={runtime.user} permissions={runtime.permissions} locale={language} appearance="retro"/>;
  const genetics = <><AccountSecuritySessionNotice platform={runtime.platform} locale={language}/>{runtime.user && <GeneticWorkbench platform={runtime.platform} horseId={horseId} locale={language} scope={principal} onChanged={retry}/>}</>;
  const section = <T,>(value: RecordSection<T>, render: (data: T) => ReactNode) => value.error !== null
    ? <div role="alert" className="performance-disclaimer"><p>{label("This section could not be loaded.", "\u0628\u0627\u0631\u06af\u0630\u0627\u0631\u06cc \u0627\u06cc\u0646 \u0628\u062e\u0634 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f.")}</p><details><summary>{label("Error details", "جزئیات خطا")}</summary><p dir="auto">{value.error}</p></details><Button small onClick={retry}>{label("Retry", "\u062a\u0644\u0627\u0634 \u062f\u0648\u0628\u0627\u0631\u0647")}</Button></div>
    : render(value.data);
  const provenance = (value: string) => ({
    demo: label("Demonstration data", "\u062f\u0627\u062f\u0647 \u0646\u0645\u0627\u06cc\u0634\u06cc"),
    user: label("User supplied", "\u062b\u0628\u062a \u06a9\u0627\u0631\u0628\u0631"),
    federation: label("Source marked: federation", "\u0645\u0646\u0628\u0639 \u062b\u0628\u062a\u200c\u0634\u062f\u0647: \u0641\u062f\u0631\u0627\u0633\u06cc\u0648\u0646"),
    derived: label("Derived record", "\u0631\u06a9\u0648\u0631\u062f \u0627\u0633\u062a\u062e\u0631\u0627\u062c\u200c\u0634\u062f\u0647"),
  } as Record<string, string>)[value] ?? label("Source not specified", "\u0645\u0646\u0628\u0639 \u0646\u0627\u0645\u0634\u062e\u0635");
  const placement = (row: CompetitionResultRecord) => Number(row.is_eliminated) === 1
    ? label("Eliminated", "\u062d\u0630\u0641") : Number(row.is_withdrawn) === 1
      ? label("Withdrawn", "\u0627\u0646\u0635\u0631\u0627\u0641") : row.placement != null ? n(row.placement) : row.placement_text || "\u2014";
  const empty = (en: string, native: string) => <EmptyState title={label(en, native)} description={label("No published records were returned for this horse.", "\u0631\u06a9\u0648\u0631\u062f \u0645\u0646\u062a\u0634\u0631\u0634\u062f\u0647\u200c\u0627\u06cc \u0628\u0631\u0627\u06cc \u0627\u06cc\u0646 \u0627\u0633\u0628 \u0648\u062c\u0648\u062f \u0646\u062f\u0627\u0631\u062f.")}/>;
  if (!state) return <>{media}{genetics}<DeskResourceNotice state={resource.state} retry={retry}/></>;
  return <>{media}{genetics}<DeskResourceNotice state={resource.state} retry={retry}/><div className="performance-section">
    <div className="section-heading"><h2>{label("Competition, genetic and breeding records", "سوابق مسابقه، ژنتیک و پرورش")}</h2></div>
    <section className="family-connections"><h3>{label("Competition record", "\u0633\u0648\u0627\u0628\u0642 \u0645\u0633\u0627\u0628\u0642\u0627\u062a")}</h3>
      {section(state.competitions, data => data.results.length ? <div className="table-scroll"><table className="season-table"><thead><tr><th>{label("Date", "\u062a\u0627\u0631\u06cc\u062e")}</th><th>{label("Competition", "\u0645\u0633\u0627\u0628\u0642\u0647")}</th><th>{label("Result", "\u0646\u062a\u06cc\u062c\u0647")}</th><th>{label("Source", "\u0645\u0646\u0628\u0639")}</th></tr></thead><tbody>{data.results.map(row => <tr key={row.id}><td>{row.event_date || "\u2014"}</td><td dir="auto">{row.competition_name || "\u2014"}</td><td>{placement(row)}</td><td>{provenance(row.provenance)}</td></tr>)}</tbody></table></div> : empty("No competition record", "\u0628\u062f\u0648\u0646 \u0633\u0627\u0628\u0642\u0647 \u0645\u0633\u0627\u0628\u0642\u0647"))}
    </section>
    <section className="family-connections"><h3>{label("Recorded genetic tests", "\u0622\u0632\u0645\u0627\u06cc\u0634\u200c\u0647\u0627\u06cc \u0698\u0646\u062a\u06cc\u06a9 \u062b\u0628\u062a\u200c\u0634\u062f\u0647")}</h3>
      {section(state.genetics, data => data.tests.length ? <div className="table-scroll"><table className="season-table"><thead><tr><th>{label("Test", "\u0622\u0632\u0645\u0627\u06cc\u0634")}</th><th>{label("Reported result", "\u0646\u062a\u06cc\u062c\u0647 \u062b\u0628\u062a\u200c\u0634\u062f\u0647")}</th><th>{label("Source", "\u0645\u0646\u0628\u0639")}</th></tr></thead><tbody>{data.tests.map(row => <tr key={row.id}><td dir="auto">{row.test_type}</td><td dir="auto">{row.result}</td><td>{provenance(row.provenance)}</td></tr>)}</tbody></table></div> : empty("No genetic tests", "\u0628\u062f\u0648\u0646 \u0622\u0632\u0645\u0627\u06cc\u0634 \u0698\u0646\u062a\u06cc\u06a9"))}
      <p className="performance-disclaimer">{label("Reported laboratory data, not a diagnosis or mating recommendation.", "\u062f\u0627\u062f\u0647 \u0622\u0632\u0645\u0627\u06cc\u0634\u06af\u0627\u0647\u06cc \u062b\u0628\u062a\u200c\u0634\u062f\u0647\u061b \u0646\u0647 \u062a\u0634\u062e\u06cc\u0635 \u0648 \u0646\u0647 \u062a\u0648\u0635\u06cc\u0647 \u062c\u0641\u062a\u200c\u06af\u06cc\u0631\u06cc.")}</p>
    </section>
    <section className="family-connections"><h3>{label("Breeding records", "\u0633\u0648\u0627\u0628\u0642 \u062a\u0648\u0644\u06cc\u062f\u0645\u062b\u0644")}</h3>
      {section(state.breedings, data => {
        const rows = [...data.as_sire.map(record => ({ role: label("Sire", "\u067e\u062f\u0631"), record })), ...data.as_dam.map(record => ({ role: label("Dam", "\u0645\u0627\u062f\u0631"), record }))];
        return <>{rows.length ? <div className="table-scroll"><table className="season-table"><thead><tr><th>{label("Role", "\u0646\u0642\u0634")}</th><th>{label("Foal", "\u06a9\u0631\u0647")}</th><th>{label("Recorded season", "\u0641\u0635\u0644 \u062b\u0628\u062a\u200c\u0634\u062f\u0647")}</th><th>{label("Source", "\u0645\u0646\u0628\u0639")}</th></tr></thead><tbody>{rows.map(({role,record}) => <tr key={`${role}-${record.id}`}><td>{role}</td><td>{record.foal_id != null ? <a href={`#/horses/${record.foal_id}`}>{record.foal_name || `#${record.foal_id}`}</a> : "\u2014"}</td><td>{record.season == null ? "\u2014" : n(record.season)}</td><td>{provenance(record.provenance)}</td></tr>)}</tbody></table></div> : empty("No breeding events", "\u0628\u062f\u0648\u0646 \u0633\u0627\u0628\u0642\u0647 \u062a\u0648\u0644\u06cc\u062f\u0645\u062b\u0644")}
          {data.birth_record && <p>{label("Recorded birth pairing", "\u0648\u0627\u0644\u062f\u06cc\u0646 \u062b\u0628\u062a\u200c\u0634\u062f\u0647")}: {data.birth_record.sire_id != null ? <a href={`#/horses/${data.birth_record.sire_id}`}>{data.birth_record.sire_name || `#${data.birth_record.sire_id}`}</a> : <span>{label("Unavailable sire", "پدر در دسترس نیست")}</span>} / {data.birth_record.dam_id != null ? <a href={`#/horses/${data.birth_record.dam_id}`}>{data.birth_record.dam_name || `#${data.birth_record.dam_id}`}</a> : <span>{label("Unavailable dam", "مادر در دسترس نیست")}</span>}</p>}</>;
      })}
    </section>
    <section className="family-connections"><h3>{label("Registry extract", "خلاصه اطلاعات ثبت")}</h3>
      <p><a className="button button--secondary" href={runtime.platform.modules.registryExtras.certificateUrl(horseId, language === 'fa' ? 'fa' : 'en')} target="_blank" rel="noopener noreferrer">{label("View registry extract", "\u0645\u0634\u0627\u0647\u062f\u0647 \u062e\u0644\u0627\u0635\u0647 \u0631\u062c\u06cc\u0633\u062a\u0631\u06cc")}</a></p>
    </section>
  </div></>;
}
