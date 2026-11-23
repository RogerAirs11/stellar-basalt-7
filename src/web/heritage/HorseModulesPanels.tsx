import { type UiLocale, uiText, engineUiLocale} from "../../shared/uiLocale";
import React, { useEffect, useState } from "react";
import type {
  CompetitionResultRecord,
  HorseBreedingsResponse,
  HorseGeneticsResponse,
  HorseRacingResponse,
  HorseRecord,
  PlatformClient,
  PlatformMetaResponse,
  EvidenceSummaryResponse,
  PlatformUser,
} from "../../contracts/platform";
import { useI18n } from "../i18n";
import { localizedDigits } from "./presentationLocale";
import { displaySeasonOrPartial } from "../../genetics/seasonDisplay";
import { VerifyIcon } from "./icons";
import { usePrincipalScope } from "../../frontend-kit/domain/principalScope";
import { useHorseCredentialStories, useAttestationVerification, useIssuerDirectory, useCredentialStoryCommands, runSnapshotReview } from "../../frontend-kit";
import type { CredentialStoryRow } from "../../contracts/platform";
import { HorseMediaPanel } from "../../frontend-kit/HorseMediaPanel";
import { BreedingCorrectionEditor } from "./BreedingCorrectionEditor";
import { GeneticWorkbench } from "../shared/GeneticWorkbench";
import { AccountSecuritySessionNotice } from "../shared/AccountSecurityPanel";

// R47b horse-profile module panels: competitions, genetics+breedings, media and
// the registry certificate. Demo-provenance data is always visibly labeled.

function horseDisplayName(horse: { name_latin?: string | null; name_native?: string | null }, locale: UiLocale): string {
  if (locale === "fa" && horse.name_native) return horse.name_native;
  return horse.name_latin || horse.name_native || "";
}

const DISCIPLINE_LABEL: Record<string, [string, string]> = {
  show_jumping: ["Show jumping", "پرش با مانع"],
  dressage: ["Dressage", "درساژ"],
  endurance: ["Endurance", "استقامت"],
  racing: ["Racing", "اسپرینت"],
  eventing: ["Eventing", "سه‌روزه"],
  halter: ["Halter show", "نمایش (هالتر)"],
  freestyle: ["Freestyle", "نمایش آزاد"],
};
const TIER_LABEL: Record<string, [string, string]> = {
  local: ["Local", "محلی"],
  regional: ["Regional", "استانی"],
  national: ["National", "کشوری"],
  international: ["International", "بین‌المللی"],
};
const TEST_LABEL: Record<string, [string, string]> = {
  SCID: ["SCID (severe combined immunodeficiency)", "SCID (نقص ایمنی ترکیبی شدید)"],
  CA: ["Cerebellar abiotrophy", "آتروفی مخچه (CA)"],
  LFS: ["Lavender foal syndrome", "سندرم کره‌ی اسطوخودوسی (LFS)"],
  OLWS: ["Overo lethal white syndrome", "سندرم سفید کشنده اوورو"],
  HYPP: ["Hyperkalemic periodic paralysis", "فلج دوره‌ای هیپرکالمیک"],
  GBED: ["Glycogen branching enzyme deficiency", "نقص آنزیم شاخه‌ساز گلیکوژن"],
};

export function HorseCompetitionPanel({ horseId, navigate, platform }: { horseId: number; navigate: (path: string) => void; platform: PlatformClient }) {
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [data, setData] = useState<{ summary: { starts: number; wins: number; podium: number; eliminations: number }; results: CompetitionResultRecord[] } | null>(null);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed("");
    platform.modules.competitions.horseHistory(horseId, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((error) => { if (!controller.signal.aborted) setFailed(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [horseId, platform, attempt]);
  // F04 (R75): a failed load is an honest error card with a retry — never a
  // silently hidden panel (the audit's "error is never empty" doctrine).
  if (failed) return <section className="h-mod-panel h-mod-competitions" data-h-surface-role="panel">
    <header className="h-mod-head"><div><span className="h-mod-kicker">{L("COMPETITION RECORD", "سوابق مسابقات")}</span><h2>{L("Competition history", "تاریخچه مسابقات")}</h2></div></header>
    <div role="alert" className="h-mod-message"><p>{L("Competition record could not be loaded. An error is not evidence that no records exist.", "بارگذاری سوابق مسابقات ناموفق بود. خطا به معنی نبودِ سوابق نیست.")}</p><p dir="auto">{failed}</p><button className="h-mod-action" onClick={() => setAttempt(value => value + 1)}>{L("Retry", "تلاش دوباره")}</button></div>
  </section>;
  if (!data) return <section className="h-mod-panel" data-h-surface-role="panel"><div className="h-mod-loading">{L("Loading competition record…", "در حال بارگذاری سوابق مسابقات…")}</div></section>;
  const hasDemo = data.results.some((r) => r.provenance === "demo");
  const placementBadge = (row: CompetitionResultRecord) => {
    if (Number(row.is_eliminated) === 1) return <span className="h-mod-place eliminated">{L("Eliminated", "حذف")}</span>;
    if (Number(row.is_withdrawn) === 1) return <span className="h-mod-place withdrawn">{L("Withdrawn", "انصراف")}</span>;
    if (row.placement == null) return <span className="h-mod-place">—</span>;
    if (row.placement === 1) return <span className="h-mod-place gold">🥇 {localizedDigits(1, locale)}</span>;
    if (row.placement === 2) return <span className="h-mod-place silver">🥈 {localizedDigits(2, locale)}</span>;
    if (row.placement === 3) return <span className="h-mod-place bronze">🥉 {localizedDigits(3, locale)}</span>;
    return <span className="h-mod-place">{localizedDigits(row.placement, locale)}</span>;
  };
  return <section className="h-mod-panel h-mod-competitions" data-h-surface-role="panel">
    <header className="h-mod-head">
      <div>
        <span className="h-mod-kicker">{L("COMPETITION RECORD", "سوابق مسابقات")}</span>
        <h2>{L("Competition history", "تاریخچه مسابقات")}</h2>
        <p>{L("Registered starts, placements and riders for this horse.", "شروع‌های ثبت‌شده، مقام‌ها و سوارکاران این اسب.")}</p>
      </div>
      <div className="h-mod-stats">
        <span><b>{localizedDigits(data.summary.starts, locale)}</b><small>{L("starts", "شروع")}</small></span>
        <span className="tone-gold"><b>{localizedDigits(data.summary.wins, locale)}</b><small>{L("wins", "پیروزی")}</small></span>
        <span><b>{localizedDigits(data.summary.podium, locale)}</b><small>{L("podium", "سکو")}</small></span>
        <span><b>{localizedDigits(data.summary.eliminations, locale)}</b><small>{L("elim.", "حذف")}</small></span>
      </div>
    </header>
    {hasDemo && <p className="h-mod-provenance">{L("Illustrative demonstration data — the federation has not entered official results yet.", "داده‌های نمایشی — فدراسیون هنوز نتایج رسمی را ثبت نکرده است.")}</p>}
    {data.results.length === 0
      ? <div className="h-mod-empty">{L("No competition record for this horse yet.", "هنوز سابقه مسابقه‌ای برای این اسب ثبت نشده است.")}</div>
      : <div className="h-mod-table-wrap"><table className="h-mod-table">
          <thead><tr><th>{L("Date", "تاریخ")}</th><th>{L("Event", "رویداد")}</th><th>{L("Discipline", "رشته")}</th><th>{L("Class", "رده")}</th><th>{L("Rider", "سوارکار")}</th><th>{L("Result", "نتیجه")}</th><th>{L("Score", "امتیاز")}</th></tr></thead>
          <tbody>{data.results.map((row) => <tr key={row.id}>
            <td className="h-mod-date" dir="auto">{localizedDigits(row.event_date ?? "—", locale)}</td>
            <td dir="auto"><button className="h-mod-link" onClick={() => navigate(`/competitions?id=${row.competition_id}`)}>{row.competition_name}</button><small>{TIER_LABEL[row.tier ?? "regional"]?.[locale === "fa" ? 1 : 0] ?? row.tier}{row.city ? ` · ${row.city}` : ""}</small></td>
            <td dir="auto">{DISCIPLINE_LABEL[row.discipline ?? ""]?.[locale === "fa" ? 1 : 0] ?? row.discipline}</td>
            <td dir="auto">{row.class_name ?? "—"}</td>
            <td dir="auto">{row.rider_name ?? "—"}{row.rider_club ? <small>{row.rider_club}</small> : null}</td>
            <td>{placementBadge(row)}</td>
            <td dir="auto">{row.score ?? "—"}</td>
          </tr>)}</tbody>
        </table></div>}
  </section>;
}

// R140-G: the racing surface — the federation racing system's (asbdavani)
// served history for this horse. Every row is provenance-stamped
// (source: asbdavani, level: imported-unverified) and rows attach ONLY
// through the identity crosswalk (registry_horse_id), never by name.
export function HorseRacingPanel({ horseId, platform }: { horseId: number; platform: PlatformClient }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [data, setData] = useState<HorseRacingResponse | null>(null);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed("");
    platform.modules.racing.horse(horseId, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((error) => { if (!controller.signal.aborted) setFailed(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [horseId, platform, attempt]);
  if (failed) return <section className="h-mod-panel h-mod-racing" data-h-surface-role="panel">
    <header className="h-mod-head"><div><span className="h-mod-kicker">{L("RACING RECORD", "سوابق اسب‌دوانی")}</span><h2>{L("Racing history", "تاریخچه اسب‌دوانی")}</h2></div></header>
    <div role="alert" className="h-mod-message"><p>{L("Racing record could not be loaded. An error is not evidence that no records exist.", "بارگذاری سوابق اسب‌دوانی ناموفق بود. خطا به معنی نبودِ سوابق نیست.")}</p><p dir="auto">{failed}</p><button className="h-mod-action" onClick={() => setAttempt(value => value + 1)}>{L("Retry", "تلاش دوباره")}</button></div>
  </section>;
  if (!data) return <section className="h-mod-panel" data-h-surface-role="panel"><div className="h-mod-loading">{L("Loading racing record…", "در حال بارگذاری سوابق اسب‌دوانی…")}</div></section>;
  const rankBadge = (rank: number | null) => {
    if (rank == null) return <span className="h-mod-place">—</span>;
    if (rank === 1) return <span className="h-mod-place gold">{localizedDigits(1, locale)}</span>;
    if (rank === 2) return <span className="h-mod-place silver">{localizedDigits(2, locale)}</span>;
    if (rank === 3) return <span className="h-mod-place bronze">{localizedDigits(3, locale)}</span>;
    return <span className="h-mod-place">{localizedDigits(rank, locale)}</span>;
  };
  const raceDate = (iso: string | null) => {
    if (!iso) return "—";
    const date = iso.slice(0, 10);
    return localizedDigits(date, locale);
  };
  return <section className="h-mod-panel h-mod-racing" data-h-surface-role="panel">
    <header className="h-mod-head">
      <div>
        <span className="h-mod-kicker">{L("RACING RECORD", "سوابق اسب‌دوانی")}</span>
        <h2>{L("Racing history", "تاریخچه اسب‌دوانی")}</h2>
        <p>{L("Starts, placings and riders from the federation's official racing system.", "شروع‌ها، مقام‌ها و سوارکاران از سامانه رسمی اسب‌دوانی فدراسیون.")}</p>
      </div>
      <div className="h-mod-stats">
        <span><b>{localizedDigits(data.summary.starts, locale)}</b><small>{L("starts", "شروع")}</small></span>
        <span className="tone-gold"><b>{localizedDigits(data.summary.wins, locale)}</b><small>{L("wins", "پیروزی")}</small></span>
        <span><b>{localizedDigits(data.summary.second_places, locale)}</b><small>{L("second", "دوم")}</small></span>
        <span><b>{localizedDigits(data.summary.third_places, locale)}</b><small>{L("third", "سوم")}</small></span>
      </div>
    </header>
    <p className="h-mod-provenance">
      {L("Source: the federation racing system (asbdavani) — imported, not yet independently verified. Rows attach through the identity crosswalk, never by name.", "منبع: سامانه رسمی اسب‌دوانی فدراسیون (اسبدوانی) — واردات‌شده، هنوز به‌طور مستقل تأیید نشده. ردیف‌ها از طریق تطبیق هویت پیوند خورده‌اند، هرگز صرفاً با نام.")}
    </p>
    {data.results.length === 0
      ? <div className="h-mod-empty">{L("No racing record is linked to this registry horse yet. Linking grows as the federation identity crosswalk is extended.", "هنوز سابقه اسب‌دوانی به این اسب ثبت‌شده پیوند نخورده است. با گسترش تطبیق هویت فدراسیون، این پیوند بیشتر می‌شود.")}</div>
      : <div className="h-mod-table-wrap"><table className="h-mod-table">
          <thead><tr><th>{L("Date", "تاریخ")}</th><th>{L("Race", "مسابقه")}</th><th>{L("Distance", "مسافت")}</th><th>{L("Rank", "رتبه")}</th><th>{L("Rider", "سوارکار")}</th><th>{L("Weight", "وزن")}</th><th>{L("Rating", "امتیاز")}</th></tr></thead>
          <tbody>{data.results.map((row) => <tr key={row.racehorse_id}>
            <td className="h-mod-date" dir="auto">{raceDate(row.week_date)}</td>
            <td dir="auto"><span>{row.plan_name || row.race_id}</span><small>{row.location ?? "—"}{row.round_no != null ? ` · ${L("round", "دور")} ${localizedDigits(row.round_no, locale)}` : ""}</small></td>
            <td dir="auto">{row.distance_m != null ? `${localizedDigits(row.distance_m, locale)} ${L("m", "متر")}` : "—"}</td>
            <td>{rankBadge(row.rank)}</td>
            <td dir="auto">{row.rider_name ?? "—"}</td>
            <td dir="auto">{row.carried_weight != null ? localizedDigits(String(row.carried_weight), locale) : "—"}</td>
            <td dir="auto">{row.entrance_rating != null ? localizedDigits(row.entrance_rating, locale) : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
  </section>;
}

type HorseGeneticsPanelProps = { horseId: number; navigate: (path: string) => void; platform: PlatformClient; user?: PlatformUser | null; permissions?: readonly string[] };
export function HorseGeneticsPanel(props: HorseGeneticsPanelProps) {
  const scope = usePrincipalScope(props.user, props.permissions);
  return <HorseGeneticsPanelForPrincipal key={`${scope}:${props.horseId}`} {...props} scope={scope}/>;
}
function HorseGeneticsPanelForPrincipal(props: HorseGeneticsPanelProps & { scope: string }) {
  const { locale } = useI18n();
  const [revision, setRevision] = useState(0);
  return <><AccountSecuritySessionNotice platform={props.platform} locale={locale}/><HorseGeneticsReadPanel {...props} revision={revision}/>{props.user && <GeneticWorkbench platform={props.platform} horseId={props.horseId} locale={locale} scope={props.scope} onChanged={() => setRevision(value => value + 1)}/>}</>;
}
function HorseGeneticsReadPanel({ horseId, navigate, platform, user, permissions = [], revision }: HorseGeneticsPanelProps & { revision: number }) {
  const principalScope = usePrincipalScope(user, permissions);
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [genetics, setGenetics] = useState<HorseGeneticsResponse | null>(null);
  const [breedings, setBreedings] = useState<HorseBreedingsResponse | null>(null);
  const [geneticsError, setGeneticsError] = useState("");
  const [breedingsError, setBreedingsError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setGenetics(null);
    setBreedings(null);
    setGeneticsError("");
    setBreedingsError("");
    // F04 (R75): each section surfaces its own failure honestly. The genetic
    // panel used to swallow load errors (catch(() => {})) which hid real
    // outages as "no tests recorded".
    platform.modules.genetics.horse(horseId, { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setGenetics(value); }).catch((error) => { if (!controller.signal.aborted) setGeneticsError(error instanceof Error ? error.message : String(error)); });
    platform.modules.breedings.horse(horseId, { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setBreedings(value); }).catch((error) => { if (!controller.signal.aborted) setBreedingsError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [horseId, platform, attempt, principalScope, revision]);
  const retry = () => setAttempt(value => value + 1);
  if (geneticsError) return <section className="h-mod-panel h-mod-genetics" data-h-surface-role="panel">
    <header className="h-mod-head"><div><span className="h-mod-kicker">{L("GENETICS & REPRODUCTION", "ژنتیک و تولیدمثل")}</span><h2>{L("Genetic panel and breeding record", "پنل ژنتیکی و سوابق تولیدمثل")}</h2></div></header>
    <div role="alert" className="h-mod-message"><p>{L("Genetic tests could not be loaded. An error is not evidence that no tests exist.", "بارگذاری آزمون‌های ژنتیکی ناموفق بود. خطا به معنی نبودِ آزمون نیست.")}</p><p dir="auto">{geneticsError}</p><button className="h-mod-action" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div>
    {breedingsError && <div role="alert" className="h-mod-message"><p>{L("Breeding records could not be loaded either.", "بارگذاری سوابق تولیدمثل هم ناموفق بود.")}</p><p dir="auto">{breedingsError}</p></div>}
  </section>;
  if (!genetics) return <section className="h-mod-panel" data-h-surface-role="panel"><div className="h-mod-loading">{L("Loading genetic panel…", "در حال بارگذاری پنل ژنتیکی…")}</div></section>;
  const diseases = genetics.tests.filter((t) => t.test_category === "disease");
  const coats = genetics.tests.filter((t) => t.test_category === "coat_color");
  const hasDemo = genetics.tests.some((t) => t.provenance === "demo");
  // Master-Ai plan T04 (F02): badges come from the server's catalog-validated
  // result_status — the client never re-diagnoses raw result strings.
  const testBadge = (status?: string) =>
    status === "clear" || status === "carrier" || status === "affected" ? status : "neutral";
  return <section className="h-mod-panel h-mod-genetics" data-h-surface-role="panel">
    <header className="h-mod-head">
      <div>
        <span className="h-mod-kicker">{L("GENETICS & REPRODUCTION", "ژنتیک و تولیدمثل")}</span>
        <h2>{L("Genetic panel and breeding record", "پنل ژنتیکی و سوابق تولیدمثل")}</h2>
        <p>{L("Disease markers, coat loci and registered coverings for this horse.", "نشانگرهای بیماری، لوکوس‌های رنگ و جفت‌گیری‌های ثبت‌شده این اسب.")}</p>
      </div>
      <div className="h-mod-stats">
        <span><b>{localizedDigits(genetics.summary.tested, locale)}</b><small>{L("tests", "آزمون")}</small></span>
        <span className="tone-ok"><b>{localizedDigits(genetics.summary.clear, locale)}</b><small>{L("Target variant absent", "واریانت هدف یافت نشد")}</small></span>
        <span className="tone-warn"><b>{localizedDigits(genetics.summary.carriers, locale)}</b><small>{L("carriers", "حامل")}</small></span>
        {genetics.summary.affected > 0 && <span className="tone-danger"><b>{localizedDigits(genetics.summary.affected, locale)}</b><small>{L("Risk-associated genotype", "ژنوتیپ مرتبط با خطر")}</small></span>}
      </div>
    </header>
    <p className="h-mod-provenance">{L("Genotype evidence only; not a clinical diagnosis, whole-horse health clearance, or a substitute for veterinary review.", "این اطلاعات تنها شواهد ژنوتیپی است؛ تشخیص بالینی یا گواهی سلامت اسب نیست.")}</p>
    {hasDemo && <p className="h-mod-provenance">{L("Illustrative demonstration panels — no real laboratory claim is implied.", "پنل‌های نمایشی — هیچ ادعای واقعی دربارهٔ آزمایشگاه مطرح نیست.")}</p>}
    {genetics.tests.length === 0
      ? <div className="h-mod-empty">{L("No genetic test is recorded for this horse yet.", "هنوز آزمون ژنتیکی برای این اسب ثبت نشده است.")}</div>
      : <div className="h-mod-genetics-grid">
        {diseases.length > 0 && <div className="h-mod-genetics-group">
          <h3>{L("Disease markers", "نشانگرهای بیماری")}</h3>
          <ul className="h-mod-tests">{diseases.map((test) => <li key={test.id} className={`h-mod-test ${testBadge(test.result_status)}`}>
            <div className="h-mod-test-name"><b>{TEST_LABEL[test.test_type]?.[locale === "fa" ? 1 : 0] ?? test.test_type}</b>{Number(test.verified) === 1 && <small className="h-mod-verified"><VerifyIcon size={12}/> {L("Platform-reviewed", "بررسی شده در سامانه")}</small>}</div>
            <span className="h-mod-test-result">{test.result}</span>
            {test.result_status === "recorded_uninterpreted" && <small className="h-mod-test-meta">{L("Recorded laboratory result — shown as reported, not interpreted by this registry", "نتیجه همان‌گونه که در گزارش ثبت شده نمایش داده می‌شود و سامانه آن را تفسیر نمی‌کند")}</small>}
            <small className="h-mod-test-meta" dir="auto">{[test.lab_name, test.tested_at].filter(Boolean).join(" · ")}</small>
          </li>)}</ul>
        </div>}
        {coats.length > 0 && <div className="h-mod-genetics-group">
          <h3>{L("Coat colour loci", "لوکوس‌های رنگ")}</h3>
          <ul className="h-mod-tests">{coats.map((test) => <li key={test.id} className="h-mod-test neutral">
            <div className="h-mod-test-name"><b>{test.test_type}</b></div>
            <span className="h-mod-test-result">{test.result}</span>
            {test.locus_quarantine && <small className="h-mod-test-meta">{L(`Legacy locus identifier — quarantined pending reviewed mapping to ${test.locus_quarantine.suggested}`, `نام قدیمی لوکوس — تا بازبینی و نگاشت به ${test.locus_quarantine.suggested} قرنطینه است`)}</small>}
          </li>)}</ul>
        </div>}
      </div>}
    <p className="h-mod-provenance">{L("Structured assay documents (full laboratory reports attached to each test) and the historical-gelding breeding policy are pending a registry policy decision.", "سند آزمون ساختاریافته (گزارش کامل آزمایشگاه پیوست هر آزمون) و سیاست تولیدمثل نریان‌های اختهٔ تاریخی در انتظار تصمیم سیاستی ثبت اسب است.")}</p>
      {breedingsError && <div role="alert" className="h-mod-message"><p>{L("Breeding records could not be loaded; try again to see this section.", "سوابق تولیدمثل بارگذاری نشد؛ برای نمایش این بخش دوباره تلاش کنید.")}</p><p dir="auto">{breedingsError}</p><button className="h-mod-action" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div>}
    {breedings && !breedings.as_sire.length && !breedings.as_dam.length && !breedings.birth_record && <p className="h-mod-empty">{L("No breeding record is available for this horse.", "سابقهٔ تولیدمثلی برای این اسب ثبت نشده است.")}</p>}
    {breedings && (breedings.as_sire.length > 0 || breedings.as_dam.length > 0 || breedings.birth_record) && <div className="h-mod-breedings">
      <h3>{L("Reproduction summary", "خلاصه تولیدمثل")}</h3>
      <div className="h-mod-stats">
        {breedings.as_sire.length > 0 && <span><b>{localizedDigits(breedings.as_sire.length, locale)}</b><small>{L("coverings as sire", "جفت‌گیری به‌عنوان پدر")}</small></span>}
        {breedings.as_dam.length > 0 && <span><b>{localizedDigits(breedings.as_dam.length, locale)}</b><small>{L("coverings as dam", "جفت‌گیری به‌عنوان مادر")}</small></span>}
        {breedings.birth_record && <span className="tone-ok"><b>{L("recorded birth", "تولد ثبت‌شده")}</b><small>{L("from registered pedigree", "از تبارنامه ثبت‌شده")}</small></span>}
      </div>

      <details className="h-mod-breedings-detail"><summary>{L("Show covering records", "نمایش سوابق جفت‌گیری")}</summary>
        <ul>{[...breedings.as_sire, ...breedings.as_dam].slice(0, 60).map((row) => <li key={`${row.id}-${row.sire_id}`}>
          <button onClick={() => row.foal_id && navigate(`/horse/${row.foal_id}`)} disabled={!row.foal_id}>
            <b dir="auto">{row.sire_id == null ? L("Unavailable sire", "پدر در دسترس نیست") : horseDisplayName(row.sire_id === horseId ? genetics.horse : {name_latin:row.sire_name,name_native:row.sire_name_native},locale) || `#${row.sire_id}`}</b>
            <span>×</span>
            <b dir="auto">{row.dam_id == null ? L("Unavailable dam", "مادر در دسترس نیست") : horseDisplayName(row.dam_id === horseId ? genetics.horse : {name_latin:row.dam_name,name_native:row.dam_name_native},locale) || `#${row.dam_id}`}</b>
            <small>→ {row.foal_id != null && row.foal_name ? <em dir="auto">{row.foal_name}</em> : L("Foal unavailable", "کره در دسترس نیست")} · {row.season ? displaySeasonOrPartial(row.season, locale === "fa" ? "fa" : "en") : ""} · {row.provenance === "derived" ? L("derived from pedigree", "استخراج از تبارنامه") : row.outcome}</small>
          </button>
          {permissions.includes("horse.edit") && <BreedingCorrectionEditor key={`${principalScope}:${row.id}:${row.row_version}`} record={row} horseId={horseId} platform={platform} locale={locale} saved={retry}/>}
        </li>)}</ul>
      </details>
    </div>}
  </section>;
}

export function HorseMediaGallery({ horse, platform, user, permissions }: { horse: HorseRecord; platform: PlatformClient; user: PlatformUser | null; permissions: readonly string[] }) {
  const { locale } = useI18n();
  return <HorseMediaPanel horseId={horse.id} platform={platform} user={user} permissions={permissions} locale={engineUiLocale(locale)} appearance="core"/>;
}

// Master-Ai plan T05 (finding F03): public issuer-attestation view. Shows WHO
// attested WHAT, WHEN, in WHICH scope — and the limitations that travel with
// every attestation. A platform review and an issuer attestation are distinct
// concepts and must never be conflated in the UI.

const RECORD_KIND_LABEL: Record<string, [string, string]> = {
  genetic_test: ["Genetic test", "آزمون ژنتیکی"],
  media: ["Media item", "رسانه"],
  competition_result: ["Competition result", "نتیجه مسابقه"],
  horse_identity: ["Horse identity", "هویت اسب"],
};

const VERIFICATION_STATE_LABEL: Record<string, [string, string]> = {
  current: ["Current — sources unchanged since issuance", "معتبر — منابع از زمان صدور تغییر نکرده‌اند"],
  expired: ["Expired — the validity window has passed; the recorded snapshot is preserved", "منقضی — پنجره اعتبار گذشته است؛ تصویر ثبت‌شده حفظ می‌شود"],
  revoked: ["Revoked by the issuer; the recorded snapshot is preserved", "لغوشده توسط مرجع؛ تصویر ثبت‌شده حفظ می‌شود"],
  superseded: ["Superseded by a newer attestation of the same record", "جایگزین‌شده توسط تأیید جدیدتر همان رکورد"],
  source_changed: ["Source record changed after issuance — the attested snapshot no longer matches", "رکورد منبع بعد از صدور تغییر کرده — تصویر تأییدشده دیگر منطبق نیست"],
  snapshot_tampered: ["Snapshot digest mismatch — the stored evidence fails its own integrity check", "عدم تطابق چکیده تصویر — شواهد ذخیره‌شده در بررسی یکپارچگی خودش مردود است"],
  unbound_legacy: ["Legacy record without a bound snapshot; requires review", "رکورد قدیمی بدون تصویر پیوند‌شده؛ نیازمند بررسی"],
};

export function HorseAttestationsPanel({ horseId, platform, user, platformMeta }: { horseId: number; platform: PlatformClient; user?: PlatformUser | null; platformMeta?: PlatformMetaResponse | null }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const scope = usePrincipalScope(user ?? null, null);
  const { stories, retry } = useHorseCredentialStories({ platform, scope, horseId });
  const { directory } = useIssuerDirectory({ platform, scope });
  const commands = useCredentialStoryCommands(scope);
  // R145-C04: the deliberately limited public evidence summary rides the same
  // verification panel — honest lifecycle counts, never private presence.
  const [summary, setSummary] = useState<EvidenceSummaryResponse | null>(null);
  useEffect(() => {
    let live = true;
    platform.horses.evidenceSummary(horseId).then((row) => { if (live) setSummary(row); }).catch(() => { if (live) setSummary(null); });
    return () => { live = false; };
  }, [platform, horseId]);
  const [issuerId, setIssuerId] = useState("");
  const [recordKind, setRecordKind] = useState<"genetic_test" | "horse_identity">("genetic_test");
  const [recordId, setRecordId] = useState("");
  const [statement, setStatement] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [showForm, setShowForm] = useState(false);
  return <section className="h-mod-panel" data-h-surface-role="panel" data-surface="credential-stories">
    <header className="h-mod-head">
      <div>
        <span className="h-mod-kicker">{L("VERIFICATION", "راستی‌آزمایی")}</span>
        <h2>{L("Issuer credentials", "اعتبارنامه‌های مرجع")}</h2>
        {/* R145-C06 (Master-AI plan): provenance-driven wording. The "every
            issuer is fictional" statement is only TRUE on the isolated demo
            dataset; on real data it was a hard-coded claim that mislabeled
            real issuers. The label now follows the platform's own demo flag. */}
        <p>{platformMeta?.demoAdminLoginAvailable
          ? L("Statements issued by named external issuers within a narrow approved scope. On this demo dataset every issuer is explicitly fictional — no badge here implies real federation, ownership or laboratory approval.", "اظهارات صادره از مراجع مشخص در محدوده تأییدشده محدود. در این نمونه نمایشی همه مراجع صراحتاً خیالی‌اند — هیچ نشان اینجا به معنای فدراسیون واقعی، مالکیت یا تأیید آزمایشگاهی نیست.")
          : L("Statements issued by named external issuers within a narrow approved scope. No badge here implies approval beyond the named issuer's own recorded scope — platform review is never issuer attestation.", "اظهارات صادره از مراجع مشخص در محدوده تأییدشده محدود. هیچ نشان اینجا بیش از محدوده ثبت‌شده خودِ مرجع معنا ندارد — بررسی سامانه هرگز تأیید مرجع نیست.")}</p>
      </div>
      <div className="h-mod-stats"><span><b>{localizedDigits(stories.phase === "ready" || stories.phase === "reloading" ? stories.rows.length : 0, locale)}</b><small>{L("credentials", "اعتبارنامه")}</small></span></div>
    </header>
    {summary ? <p className="h-mod-test-meta">{L(
      `Public evidence: ${summary.media.reviewed ?? 0} platform-reviewed media · ${summary.media.uploaded ?? 0} uploaded · ${summary.attestations.active ?? 0} active attestations (${summary.attestations.revoked ?? 0} revoked, ${summary.attestations.superseded ?? 0} superseded) · ${Object.values(summary.genetics_published).reduce((a, b) => a + b, 0)} published genetic result(s). Reviewed is never issuer-attested.`,
      `شواهد عمومی: ${summary.media.reviewed ?? 0} رسانه بررسی‌شده توسط سامانه · ${summary.media.uploaded ?? 0} بارگذاری‌شده · ${summary.attestations.active ?? 0} تأیید فعال (${summary.attestations.revoked ?? 0} لغوشده، ${summary.attestations.superseded ?? 0} جایگزین‌شده) · ${Object.values(summary.genetics_published).reduce((a, b) => a + b, 0)} نتیجه ژنتیکی منتشرشده. بررسی سامانه هرگز تأیید مرجع نیست.`)}</p> : null}
    {stories.phase === "loading" ? <div className="h-mod-loading">{L("Loading credentials…", "در حال بارگذاری اعتبارنامه‌ها…")}</div> : null}
    {stories.phase === "forbidden" || stories.phase === "unavailable" || stories.phase === "error" ? <div role="alert" className="h-mod-message"><p>{L("Credentials could not be loaded. An error is not evidence that none exist.", "بارگذاری اعتبارنامه‌ها ناموفق بود. خطا به معنی نبودِ آنها نیست.")}</p><p dir="auto">{stories.reason}</p><button className="h-mod-action" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div> : null}
    {stories.phase === "empty" ? <div className="h-mod-empty">
      {L("No issuer credential is recorded for this horse yet. Registry data shown on this profile is platform-reviewed at most — reviewed is not issuer-attested.", "هنوز اعتبارنامه‌ای از مرجع بیرونی برای این اسب ثبت نشده است. داده‌های این پرونده حداکثر توسط کارشناسان سامانه بررسی شده است — بررسی سامانه همان تأیید مرجع نیست.")}
    </div> : null}
    {(stories.phase === "ready" || stories.phase === "reloading") && stories.rows.length > 0 ? <ul className="h-mod-tests">
      {stories.rows.map(row => <HeritageCredentialRow key={row.id} row={row} platform={platform} locale={locale} user={user ?? null} commands={commands} onChanged={retry} />)}
    </ul> : null}
    {(stories.phase === "ready" || stories.phase === "reloading") && stories.truncated ? <p className="h-mod-test-meta">{L("Showing the newest credentials only.", "فقط جدیدترین اعتبارنامه‌ها نمایش داده می‌شود.")}</p> : null}
    {user ? <div data-surface="credential-issue" style={{ marginTop: "12px" }}>
      <button className="h-mod-action" onClick={() => setShowForm(value => !value)}>{showForm ? L("Hide the issue form", "پنهان‌کردن فرم صدور") : L("Attest under an issuer", "صدور تأیید به نام یک مرجع")}</button>
      {showForm ? <div className="h-mod-message" data-surface="credential-issue-form" style={{ marginTop: "8px" }}>
        <p>{L("You may attest only under an issuer that granted you an active membership, and only within its narrow approved scope — the server refuses anything else.", "فقط مرجعی که به شما عضویت فعال داده و فقط در محدوده تأییدشده محدود آن می‌توانید تأیید صادر کنید — سرور هر چیز دیگر را رد می‌کند.")}</p>
        <label><small>{L("Issuer", "مرجع")}</small>
          <select value={issuerId} onChange={event => setIssuerId(event.target.value)}>
            <option value="">{L("Choose an issuer…", "یک مرجع انتخاب کنید…")}</option>
            {(directory.phase === "ready" || directory.phase === "reloading") ? directory.issuers.map(issuer => <option key={issuer.id} value={issuer.id}>{locale === "fa" && issuer.name_native ? issuer.name_native : issuer.name}</option>) : null}
          </select></label>
        <label><small>{L("Record kind", "نوع رکورد")}</small>
          <select value={recordKind} onChange={event => setRecordKind(event.target.value as "genetic_test" | "horse_identity")}>
            <option value="genetic_test">{L("Reviewed genetic test", "آزمون ژنتیکی بررسی‌شده")}</option>
            <option value="horse_identity">{L("Horse identity", "هویت اسب")}</option>
          </select></label>
        <label><small>{L(recordKind === "horse_identity" ? "Horse id" : "Genetic test id", recordKind === "horse_identity" ? "شناسه اسب" : "شناسه آزمون ژنتیکی")}</small>
          <input value={recordId} inputMode="numeric" onChange={event => setRecordId(event.target.value)} placeholder={recordKind === "horse_identity" ? String(horseId) : "980000008"} /></label>
        <label><small>{L("Statement (optional)", "اظهار (اختیاری)")}</small>
          <input dir="auto" maxLength={2000} value={statement} onChange={event => setStatement(event.target.value)} /></label>
        <label><small>{L("Expires at (optional, future instant with timezone)", "اعتبار تا (اختیاری، زمان آینده با منطقه زمانی)")}</small>
          <input value={expiresAt} placeholder="2026-12-31T00:00:00Z" onChange={event => setExpiresAt(event.target.value)} /></label>
        <button className="h-mod-action" disabled={commands.issue.state.phase === "submitting" || !issuerId || !recordId.trim()} onClick={() => { void commands.issue.run(async () => {
          const result = await platform.modules.attestations.issue(issuerId, {
            record_kind: recordKind, record_id: recordId.trim(),
            statement: statement.trim() || null,
            expires_at: expiresAt.trim() || null,
          });
          setStatement(""); setExpiresAt(""); retry(); return result;
        }, { successMessage: L("Credential issued with an immutable server-derived snapshot.", "اعتبارنامه با تصویر برگرفته از سرور و تغییرناپذیر صادر شد.") }); }}>{L("Issue credential", "صدور اعتبارنامه")}</button>
        {commands.issue.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The issuer refused this issuance — membership, narrow scope, record or evidence rules.", "مرجع این صدور را رد کرد — عضویت، محدوده محدود، رکورد یا قواعد شواهد.")}</p> : null}
      </div> : null}
    </div> : null}
    <p className="h-mod-provenance">{L("Verification levels in this registry: owner-declared < imported-unverified < platform-reviewed < issuer-attested. None of them is a universal guarantee of a horse's quality.", "سطوح راستی‌آزمایی: اظهار مالک < داده مهاجرت‌یافته < بررسی سامانه < تأیید مرجع. هیچ‌یک تضمین کلی کیفیت اسب نیست.")}</p>
  </section>;
}

/** ONE public credential row with the verify panel, the owner-scoped
 * revoke/supersede actions and the private snapshot review. */
function HeritageCredentialRow({ row, platform, locale, user, commands, onChanged }: {
  row: CredentialStoryRow; platform: PlatformClient; locale: UiLocale; user: PlatformUser | null;
  commands: ReturnType<typeof useCredentialStoryCommands>; onChanged: () => void;
}) {
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [snapshot, setSnapshot] = useState<{ phase: "idle" } | { phase: "granted"; digest: string; capturedAt: string } | { phase: "refused"; reason: string }>({ phase: "idle" });
  const { verification, retry: retryVerify } = useAttestationVerification({ platform, scope: `credential:${row.id}`, attestationId: verifyOpen ? row.id : null });
  const effective = row.effective_status || row.status;
  return <li className={`h-mod-test ${effective === "active" ? "tone-ok" : "neutral"}`} data-surface="credential-row" data-attestation-id={row.id}>
    <div className="h-mod-test-name">
      <b dir="auto">{locale === "fa" && row.issuer.name_native ? row.issuer.name_native : row.issuer.name}</b>
      <small className="h-mod-test-meta">{row.issuer.kind}{row.issuer.status !== "active" ? ` · ${row.issuer.status}` : ""}</small>
    </div>
    <span className="h-mod-test-result">{RECORD_KIND_LABEL[row.record_kind]?.[locale === "fa" ? 1 : 0] ?? row.record_kind} · {localizedDigits(row.record_id, locale)}</span>
    <small className="h-mod-test-meta" dir="auto">{[row.issued_at?.slice(0, 10), row.expires_at ? `${L("valid until", "اعتبار تا")} ${row.expires_at.slice(0, 10)}` : null, effective !== "active" ? L(effective, effective === "revoked" ? "لغوشده" : effective === "superseded" ? "جایگزین‌شده" : effective === "expired" ? "منقضی" : effective) : null].filter(Boolean).join(" · ")}</small>
    <small className="h-mod-test-meta" dir="auto">{L("Public metadata only — the statement and scope stay private to authorized review.", "فقط فراداده عمومی — اظهار و محدوده برای بررسی مجاز خصوصی می‌ماند.")}</small>
    {row.limitations ? <small className="h-mod-test-meta">{locale === "fa" ? row.limitations.fa : row.limitations.en}</small> : null}
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
      <button className="h-mod-action" onClick={() => setVerifyOpen(value => !value)}>{verifyOpen ? L("Hide verification", "پنهان‌کردن راستی‌آزمایی") : L("Verify", "راستی‌آزمایی")}</button>
      {user ? <button className="h-mod-action" onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? L("Hide owner actions", "پنهان‌کردن اقدامات مالک") : L("Owner actions", "اقدامات مالک")}</button> : null}
      {user ? <button className="h-mod-action" onClick={async () => { setSnapshot({ phase: "idle" }); const outcome = await runSnapshotReview(platform, row.id); setSnapshot(outcome.phase === "granted" ? { phase: "granted", digest: String((outcome.review.snapshot as Record<string, unknown>).content_digest ?? ""), capturedAt: String((outcome.review.snapshot as Record<string, unknown>).created_at ?? "") } : { phase: "refused", reason: outcome.reason }); }}>{L("Review snapshot (private)", "بازبینی تصویر (خصوصی)")}</button> : null}
    </div>
    {verifyOpen ? <div data-surface="credential-verify" style={{ marginTop: "8px" }}>
      {verification.phase === "loading" ? <small className="h-mod-test-meta">{L("Verifying…", "در حال راستی‌آزمایی…")}</small> : null}
      {verification.phase === "not_found" || verification.phase === "forbidden" || verification.phase === "unavailable" || verification.phase === "error" ? <div role="alert"><small className="h-mod-test-meta">{L("Verification is unavailable right now.", "راستی‌آزمایی الان در دسترس نیست.")}</small>{verification.phase !== "not_found" ? <small className="h-mod-test-meta" dir="auto">{verification.reason}</small> : null}<button className="h-mod-action" onClick={retryVerify}>{L("Retry", "تلاش دوباره")}</button></div> : null}
      {(verification.phase === "ready" || verification.phase === "reloading") ? <div>
        <small className="h-mod-test-meta"><b>{L("State", "وضعیت")}:</b> {VERIFICATION_STATE_LABEL[verification.verification.verification_state]?.[locale === "fa" ? 1 : 0] ?? verification.verification.verification_state}</small>
        <small className="h-mod-test-meta"><b>{L("Effective status", "وضعیت مؤثر")}:</b> {verification.verification.effective_status}</small>
        {verification.verification.snapshot ? <small className="h-mod-test-meta"><b>{L("Snapshot digest", "چکیده تصویر")}:</b> <code>{verification.verification.snapshot.content_digest.slice(0, 16)}…</code> · {L("captured", "ثبت‌شده")} {verification.verification.snapshot.captured_at.slice(0, 10)}</small> : null}
        {verification.verification.source_detail ? <small className="h-mod-test-meta"><b>{L("Changed sources", "منابع تغییرکرده")}:</b> {(verification.verification.source_detail.changed_tables ?? []).join(", ")}</small> : null}
        <small className="h-mod-test-meta" dir="auto">{verification.verification.note}</small>
      </div> : null}
    </div> : null}
    {actionsOpen && user ? <div data-surface="credential-owner-actions" style={{ marginTop: "8px" }}>
      <p className="h-mod-test-meta">{L("Revocation and supersession are issuer-owner (or platform content-manager) commands. A reason is required; the recorded snapshot is never rewritten.", "لغو و جایگزینی فرمان مالک مرجع (یا مدیر محتوای سامانه) است. دلیل الزامی است؛ تصویر ثبت‌شده هرگز بازنویسی نمی‌شود.")}</p>
      <label><small>{L("Reason", "دلیل")}</small><input dir="auto" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label style={{ marginTop: "6px" }}><small>{L("Replacement statement (for supersede)", "اظهار جایگزین (برای جایگزینی)")}</small><input dir="auto" maxLength={2000} value={replacement} onChange={event => setReplacement(event.target.value)} /></label>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
        <button className="h-mod-action" disabled={commands.revoke.state.phase === "submitting" || reason.trim().length < 3 || row.status !== "active"} onClick={() => { void commands.revoke.run(async () => {
          const result = await platform.modules.attestations.revoke(row.id, { reason: reason.trim() });
          setReason(""); onChanged(); return result;
        }, { successMessage: L("Credential revoked — the current status changed; the snapshot is preserved.", "اعتبارنامه لغو شد — وضعیت فعلی تغییر کرد؛ تصویر حفظ می‌شود.") }); }}>{L("Revoke", "لغو")}</button>
        <button className="h-mod-action" disabled={commands.supersede.state.phase === "submitting" || reason.trim().length < 3 || replacement.trim().length < 1 || row.status !== "active"} onClick={() => { void commands.supersede.run(async () => {
          const result = await platform.modules.attestations.supersede(row.id, { reason: reason.trim(), replacement: { record_kind: row.record_kind, record_id: row.record_id, statement: replacement.trim() } });
          setReason(""); setReplacement(""); onChanged(); return result;
        }, { successMessage: L("Superseded — a replacement was issued; the history stays visible.", "جایگزین شد — اعتبارنامه جدید صادر شد؛ تاریخچه قابل مشاهده می‌ماند.") }); }}>{L("Supersede with replacement", "جایگزینی با نسخه جدید")}</button>
      </div>
      {commands.revoke.state.phase === "rejected" || commands.supersede.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The command was refused — authority, state or version rules. The recorded history is unchanged.", "فرمان رد شد — قواعد اختیار، وضعیت یا نسخه. تاریخچه ثبت‌شده تغییر نکرد.")}</p> : null}
    </div> : null}
    {snapshot.phase !== "idle" ? <div data-surface="credential-snapshot-review" style={{ marginTop: "8px" }}>
      {snapshot.phase === "granted" ? <small className="h-mod-test-meta"><b>{L("Private snapshot review", "بازبینی خصوصی تصویر")}:</b> {L("authorized — full bytes stay private; digest", "مجاز — بایت‌های کامل خصوصی می‌مانند؛ چکیده")} <code>{snapshot.digest.slice(0, 16)}…</code> · {snapshot.capturedAt.slice(0, 10)}</small> : <small className="h-mod-test-meta" role="alert">{L("Refused — only platform content managers or the issuer's active owner may review the full snapshot.", "رد شد — فقط مدیران محتوای سامانه یا مالک فعال مرجع می‌توانند تصویر کامل را بازبینی کنند.")}</small>}
    </div> : null}
  </li>;
}
