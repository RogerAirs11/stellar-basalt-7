import { uiNumberTag } from "../../shared/uiLocale";
import { ContextNavigation } from "./Navigation";
import { type UiLocale, uiText, isUiRtl } from "../../shared/uiLocale";
import { AnalyticsNavigation } from "./AnalyticsNavigation";
import { analyticsLocation, readAnalyticsLocation, type AnalyticsSection } from "./analyticsNavigation";
import React, { useEffect, useMemo, useState } from "react";
import type { PlatformClient, RegistryAnalyticsHorseRank, RegistryAnalyticsPersonRank, RegistryAnalyticsResponse } from "../../contracts/platform";
import { useI18n } from "../i18n";
import { localizedAnalysisText, localizedDigits, localizedPercent } from "./presentationLocale";
import { useHeritageMobileDock, type HeritageDockLayer } from "./MobileDock";
import { revealHeritageContent } from "./viewTransition";

type Props = { platform: PlatformClient; navigate: (path: string) => void };
type Tone = "accent" | "good" | "info" | "warn" | "danger" | "sire" | "dam" | "neutral";
type StatsSectionId = AnalyticsSection;
type StatsScopedSectionId = Exclude<StatsSectionId,"all">;

const COVERAGE_LABELS: Record<string, string> = {
  nativeName: "stats.coverage.nativeName",
  registration: "stats.coverage.registration",
  microchip: "stats.coverage.microchip",
  birthYear: "stats.coverage.birthYear",
  birthPlace: "stats.coverage.birthPlace",
  breed: "stats.coverage.breed",
  sex: "stats.coverage.sex",
  color: "stats.coverage.color",
  mainStrain: "stats.coverage.mainStrain",
  dnaRecord: "stats.coverage.dnaRecord",
  passport: "stats.coverage.passport",
  bothParents: "stats.coverage.bothParents",
  anyParent: "stats.coverage.anyParent",
  owner: "stats.coverage.owner",
  breeder: "stats.coverage.breeder",
  importer: "stats.coverage.importer",
  passportReceiver: "stats.coverage.passportReceiver",
};

function toneForPercent(value: number): Tone {
  if (value >= 90) return "good";
  if (value >= 70) return "info";
  if (value >= 50) return "warn";
  return "danger";
}


function localizeAnalyticsLabel(label: string, locale: UiLocale) {
  if (locale !== "fa") return label;
  const sex: Record<string,string> = { male:"نر", female:"ماده", stallion:"سیلمی", mare:"مادیان", colt:"کره نر", filly:"کره ماده", gelding:"اخته", unknown:"نامشخص" };
  return sex[label.trim().toLowerCase()] || localizedDigits(label,locale);
}
function decadeLabel(decade:number, locale:UiLocale, n:(value:number)=>string){
  return locale==="fa"?`دهه ${n(decade)}`:`${decade}s`;
}

function displayHorseName(row: RegistryAnalyticsHorseRank, locale: UiLocale) {
  return locale === "fa" ? row.name_native || row.name_latin || `#${row.id}` : row.name_latin || row.name_native || `#${row.id}`;
}

function displayPersonName(row: RegistryAnalyticsPersonRank, locale: UiLocale) {
  return locale === "fa" ? row.name_native || row.name_latin || `#${row.id}` : row.name_latin || row.name_native || `#${row.id}`;
}

function RegistryStatsDock({sectionDefs,subtabDefs,activeSection,activeSubtab,chooseSection,chooseSubtab,ariaLabel}:{sectionDefs:Array<{id:StatsSectionId;label:string}>;subtabDefs:Record<StatsScopedSectionId,Array<{id:string;label:string}>>;activeSection:StatsSectionId;activeSubtab:string;chooseSection:(id:StatsSectionId)=>void;chooseSubtab:(id:string)=>void;ariaLabel:string}) {
  const layers=useMemo<HeritageDockLayer[]>(()=>{
    const result:HeritageDockLayer[]=[{id:"stats-sections",level:"secondary",ariaLabel,items:sectionDefs.map(item=>({id:item.id,label:item.label,active:activeSection===item.id,onActivate:()=>chooseSection(item.id),revealTarget:".stats-workspace-context"}))}];
    if(activeSection!=="all")result.push({id:"stats-views",level:"tertiary",ariaLabel,items:subtabDefs[activeSection].map(item=>({id:item.id,label:item.label,active:activeSubtab===item.id,onActivate:()=>chooseSubtab(item.id),revealTarget:".stats-workspace-context"}))});
    return result;
  },[activeSection,activeSubtab,ariaLabel,chooseSection,chooseSubtab,sectionDefs,subtabDefs]);
  useHeritageMobileDock("registry-stats",layers);
  return null;
}

/** R162: known analytics server error details localized for Farsi readers.
 * Unknown messages stay raw (dir=auto) so nothing is ever invented. */
const ANALYTICS_ERROR_FA: Record<string,string> = {
  "This analytics snapshot does not have a verified public-only cohort; rebuild and verify its audience policy before publication": "این تصویر آماری هنوز برای انتشار عمومی تأیید نشده است؛ پس از بازسازی و تأیید سیاست مخاطبان در دسترس قرار می‌گیرد.",
  "Registry analytics are stale for the current canonical data revision; rebuild derived analytics before presenting them as current": "آمار سامانه برای نسخه فعلی داده‌ها کهنه است؛ ابتدا آمار مشتق‌شده باید بازسازی شود.",
  "Registry analytics snapshot has not been built yet": "تصویر آماری هنوز ساخته نشده است.",
  "Registry analytics snapshot is unavailable; rebuild derived analytics for this database revision": "تصویر آماری در دسترس نیست؛ آمار مشتق‌شده برای این نسخه داده بازسازی شود.",
};

export function RegistryStatsPage({ platform, navigate }: Props) {
  const { t, n, locale } = useI18n();
  const percent = (value: number, digits = 0) => localizedPercent(value,locale,digits,digits);
  const [analytics, setAnalytics] = useState<RegistryAnalyticsResponse | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [activeSection, setActiveSection] = useState<StatsSectionId>(() => readAnalyticsLocation(location.search).section);
  // R69: every sub-category now has an "All views" tab and it is the default selection.
  const [activeSubtabs,setActiveSubtabs]=useState<Record<StatsScopedSectionId,string>>(() => {
    const initial = readAnalyticsLocation(location.search);
    return {overview:"all",pedigree:"all",breeding:"all",population:"all",people:"all",quality:"all", ...(initial.section === "all" ? {} : { [initial.section]: initial.view })};
  });
  useEffect(() => {
    const sync = () => {
      const next = readAnalyticsLocation(location.search);
      setActiveSection(next.section);
      if (next.section !== "all") setActiveSubtabs(previous => ({ ...previous, [next.section]: next.view }));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    let live = true;
    setError("");
    platform.analytics.registry().then(value => { if (live) setAnalytics(value); }).catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [platform, retry]);



  if (error) return <main className="stats-page"><div className="stats-load-card is-error"><strong>{t("stats.unavailable")}</strong><p>{t("stats.loadError", "Statistics could not be loaded. Your selection has been kept.")}</p><p dir="auto" className="stats-load-reason">{locale === "fa" ? (ANALYTICS_ERROR_FA[error] ?? error) : error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{t("common.retry", "Try again")}</button></div></main>;
  if (!analytics) return <main className="stats-page"><div className="stats-load-card"><i/><div><strong>{t("stats.loading")}</strong><span>{t("stats.loadingBody")}</span></div></div></main>;

  const parentage = analytics.parentage;
  const people = analytics.people;
  const quality = analytics.quality;
  const completeness = [...analytics.pedigree.completeness].sort((a,b) => a.depth - b.depth);
  const decades = analytics.birthDecades.filter(row => row.count > 0).slice(-14);
  const decadeMax = Math.max(1, ...decades.map(row => row.count));
  const recentCoverage = analytics.dataCoverage?.byBirthDecade.filter(row => row.decade >= 1950).slice(-8) ?? [];
  const topBreeds = analytics.topBreeds.slice(0, 8);
  const topPlaces = analytics.topBirthPlaces.slice(0, 8);
  const topColors = analytics.topColors?.slice(0, 8) ?? [];
  const topStrains = analytics.topMainStrains?.slice(0, 8) ?? [];
  const progenyHistogram = analytics.progeny.histogram ?? [];
  const progenyMax = Math.max(1, ...progenyHistogram.map(x => x.count));
  const snapshotDate = new Date(analytics.generatedAt).toLocaleString(uiNumberTag(locale), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const openIssueRate = quality ? (quality.openIssues / Math.max(1, analytics.horseCount)) * 100 : 0;

  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const sectionDefs:Array<{id:StatsSectionId;label:string}>=[
    {id:"all",label:L("ALL","همه")},{id:"overview",label:t("stats.nav.overview")},{id:"pedigree",label:t("stats.nav.pedigree")},{id:"breeding",label:t("stats.nav.breeding")},
    {id:"population",label:t("stats.nav.population")},{id:"people",label:t("stats.nav.people")},{id:"quality",label:t("stats.nav.quality")},
  ];
  const subtabDefs:Record<StatsScopedSectionId,Array<{id:string;label:string}>>={
    overview:[{id:"all",label:L("All views","همه نماها")},{id:"snapshot",label:L("Snapshot","نمای کلی")},{id:"intelligence",label:L("Intelligence","هوشمندی")}],
    pedigree:[{id:"all",label:L("All views","همه نماها")},{id:"coverage",label:L("Coverage & integrity","پوشش و یکپارچگی")},{id:"influence",label:L("Representation","نمایندگی تبار")}],
    breeding:[{id:"all",label:L("All views","همه نماها")},{id:"distribution",label:L("Distribution","توزیع")},{id:"leaders",label:L("Leading parents","والدین برتر")}],
    population:[{id:"all",label:L("All views","همه نماها")},{id:"demography",label:L("Demography","جمعیت‌شناسی")},{id:"classification",label:L("Classification","طبقه‌بندی")}],
    people:[{id:"all",label:L("All views","همه نماها")},{id:"summary",label:L("Summary","خلاصه")},{id:"rankings",label:L("Rankings","رتبه‌بندی")}],
    quality:[{id:"all",label:L("All views","همه نماها")},{id:"coverage",label:L("Field coverage","پوشش فیلدها")},{id:"findings",label:L("Findings","یافته‌ها")},{id:"era",label:L("Coverage by era","پوشش زمانی")}],
  };
  const subtabCopy:Record<StatsScopedSectionId,Record<string,{title:string;body:string}>>={
    overview:{
      snapshot:{title:t("stats.overview.title"),body:L("Registry-scale snapshot: records, people, parentage, chronology and analytical eligibility.","نمای کلی در مقیاس سامانه ثبت: رکوردها، افراد، والدین، زمان و قابلیت تحلیل.")},
      intelligence:{title:L("Premium registry intelligence","تحلیل پیشرفتهٔ سامانه ثبت"),body:L("Trust-aware analytical validity, concentration, generation intervals, lineage reach and method notes.","اعتبار تحلیلی، تمرکز، فاصله نسلی، گستره تبار و روش‌شناسی با آگاهی از کیفیت داده.")},
    },
    pedigree:{
      coverage:{title:L("Pedigree coverage & integrity","پوشش و یکپارچگی تبارنامه"),body:t("stats.pedigree.body")},
      influence:{title:L("Ancestor representation","نمایندگی اجداد"),body:L("Which recorded ancestors occupy the most positions across the cycle-clean pedigree cohort.","کدام اجداد ثبت‌شده بیشترین جایگاه را در گروه تبارنامه‌ای بدون چرخه دارند.")},
    },
    breeding:{
      distribution:{title:L("Breeding distribution","توزیع تولیدمثل"),body:t("stats.breeding.body")},
      leaders:{title:L("Leading recorded parents","والدین ثبت‌شده برتر"),body:L("Rank sire and dam representation by recorded offspring without treating popularity as genetic merit.","رتبه‌بندی حضور پدران و مادران بر پایه فرزندان ثبت‌شده، بدون تعبیر محبوبیت به شایستگی ژنتیکی.")},
    },
    population:{
      demography:{title:L("Population demography","جمعیت‌شناسی"),body:t("stats.population.body")},
      classification:{title:L("Population classification","طبقه‌بندی جمعیت"),body:L("Browse recorded breed, color and main-strain composition as registry descriptors.","ترکیب ثبت‌شده نژاد، رنگ و سویه اصلی را به‌عنوان توصیف‌گرهای سامانه ثبت بررسی کنید.")},
    },
    people:{
      summary:{title:L("People & role structure","افراد و ساختار نقش‌ها"),body:t("stats.people.body")},
      rankings:{title:L("People rankings","رتبه‌بندی افراد"),body:L("Compare owner, breeder, importer and passport-receiver link counts by registry role.","تعداد پیوندهای مالک، پرورش‌دهنده، واردکننده و گیرنده گذرنامه را بر پایه نقش سامانه ثبت مقایسه کنید.")},
    },
    quality:{
      coverage:{title:L("Field coverage","پوشش فیلدها"),body:t("stats.quality.body")},
      findings:{title:L("Quality findings","یافته‌های کیفیت"),body:L("Inspect open issue severity and quality pressure without mixing it into population statistics.","شدت مسائل باز و فشار کیفیت را مستقل از آمار جمعیت بررسی کنید.")},
      era:{title:L("Coverage by era","پوشش بر پایه دوره"),body:L("See how field completeness changes across recorded birth eras and historical cohorts.","تغییر کامل‌بودن فیلدها را در دوره‌های تولد ثبت‌شده و گروه‌های تاریخی مشاهده کنید.")},
    },
  };
  for(const section of Object.keys(subtabCopy) as StatsScopedSectionId[]){
    subtabCopy[section].all={title:L("All views","همه نماها"),body:L("Every view of this section is expanded into one continuous scroll.","همه نماهای این بخش در یک پیمایش پیوسته باز می‌شوند.")};
  }
  const activeSubtab=activeSection==="all"?"all":activeSubtabs[activeSection];
  const activeViewCopy=activeSection==="all"
    ? {title:L("All registry statistics","همه آمار سامانه ثبت"),body:L("Classic continuous mode: every statistics workspace is expanded into one scrollable analytical document.","حالت پیوسته کلاسیک: همه فضاهای آماری در یک سند تحلیلی پیمایشی باز می‌شوند.")}
    : (subtabCopy[activeSection][activeSubtab]??{title:sectionDefs.find(item=>item.id===activeSection)?.label??"",body:""});
  const activeSectionLabel=sectionDefs.find(item=>item.id===activeSection)?.label??"";
  const activeSubtabLabel=activeSection==="all"?null:(subtabDefs[activeSection].find(item=>item.id===activeSubtab)?.label??activeViewCopy.title);
  const setLocation = (section: StatsSectionId, view: string) => {
    const path = analyticsLocation(location.search, section, view);
    if (`${location.pathname}${location.search}` !== path) history.pushState({}, "", path);
  };
  const chooseSection = (id: StatsSectionId) => {
    setActiveSection(id); setLocation(id, id === "all" ? "all" : activeSubtabs[id]);
    revealHeritageContent(".stats-workspace-context");
  };
  const chooseSubtab = (id: string) => {
    if (activeSection === "all") return;
    setActiveSubtabs(previous => ({...previous, [activeSection]: id}));
    setLocation(activeSection, id); revealHeritageContent(".stats-workspace-context");
  };

  return <main className="stats-page">
    <RegistryStatsDock sectionDefs={sectionDefs} subtabDefs={subtabDefs} activeSection={activeSection} activeSubtab={activeSubtab} chooseSection={chooseSection} chooseSubtab={chooseSubtab} ariaLabel={t("stats.sections")} />
    <section className="stats-hero" data-h-surface-role="major">
      <div className="stats-hero-copy"><span className="section-kicker">{t("stats.eyebrow")}</span><h1>{t("stats.title")}</h1></div>
      <div className="stats-hero-number"><div className="stats-hero-number-main"><small>{t("stats.horses")}</small><strong>{n(analytics.horseCount)}</strong><span>{t("stats.canonicalRecords")}</span></div></div>
      <p className="stats-hero-lede">{t("stats.lede")}</p>
      <div className="stats-provenance"><span className="data-chip tone-good">● {t("stats.snapshotReady")}</span><span>{t("stats.snapshot")} · {snapshotDate}</span><span>{locale==="fa"?`نسخه ${localizedDigits(analytics.algorithmVersion,locale)}`:`v${analytics.algorithmVersion}`}</span></div>
    </section>

    <AnalyticsNavigation sections={sectionDefs} views={subtabDefs} section={activeSection} view={activeSubtab}
      onSection={chooseSection} onView={chooseSubtab} label={t("stats.sections")} viewLabel={L("Section views", "نماهای بخش")}/>


    <section className={`stats-workspace-context section-${activeSection}`} data-view-transition-anchor data-h-surface-role="major">
      <div className="workspace-route-trail" role="group" aria-label={L("Current statistics path","مسیر آمار فعال")}><span className="route-node">{L("Statistics","آمار")}</span><i className="route-link" aria-hidden="true"/><span className={`route-node${activeSubtabLabel?"":" is-current"}`}>{activeSectionLabel}</span>{activeSubtabLabel&&<><i className="route-link" aria-hidden="true"/><span className="route-node is-current">{activeSubtabLabel}</span></>}</div>
      <StatsSectionHead kicker={activeSectionLabel} title={activeViewCopy.title} body={activeViewCopy.body}/>

    </section>

    <section className={`stats-section stats-tab-stage section-${activeSection}`} data-h-surface-role="panel" id={`stats-${activeSection}`} key={`${activeSection}-${activeSubtab}`}>
      {(activeSection==="all"||(activeSection==="overview"&&(activeSubtab==="all"||activeSubtab==="snapshot")))&&<>
        <div className="stats-kpi-grid">
          <Kpi tone="accent" label={t("stats.horses")} value={n(analytics.horseCount)} detail={t("stats.kpi.horses")}/>
          <Kpi tone="info" label={t("stats.people")} value={people ? n(people.peopleCount) : "—"} detail={people ? `${n(people.ownerCount)} ${t("stats.owners")} · ${n(people.breederCount)} ${t("stats.breeders")}` : t("stats.notAvailable")}/>
          <Kpi tone="sire" label={t("stats.parentageBoth")} value={parentage ? percent(parentage.bothParentsPercent) : "—"} detail={parentage ? n(parentage.bothParents) : t("stats.notAvailable")}/>
          <Kpi tone="good" label={t("stats.analyticsEligible")} value={n(analytics.pedigree.analyticsEligibleHorseCount)} detail={`${percent((analytics.horseCount > 0 ? analytics.pedigree.analyticsEligibleHorseCount/analytics.horseCount : 0)*100)} ${t("stats.ofRegistry")}`}/>
          <Kpi tone={openIssueRate < 2 ? "good" : "warn"} label={t("stats.openQuality")} value={quality ? n(quality.openIssues) : "—"} detail={quality ? `${percent(openIssueRate,1)} ${t("stats.issueRate")}` : t("stats.notAvailable")}/>
        </div>
        <div className="stats-overview-grid"><article className="stats-card stats-birth-arc"><CardTitle title={t("stats.birthArc")} meta={t("stats.recordedBirths")}/><div className="stats-decade-bars">{decades.map(row => <span key={row.decade} title={`${decadeLabel(row.decade,locale,n)}: ${n(row.count)}`}><b style={{height:`${Math.max(2,(row.count/decadeMax)*100)}%`}}/><small>{locale === "fa" ? `دهه ${n(row.decade)}` : `${String(row.decade).slice(-2)}s`}</small></span>)}</div><footer>{analytics.birthYearSummary?.earliest != null ? localizedDigits(analytics.birthYearSummary.earliest,locale) : "—"} → {analytics.birthYearSummary?.latest != null ? localizedDigits(analytics.birthYearSummary.latest,locale) : "—"} · {t("stats.medianYear")} {analytics.birthYearSummary?.median != null ? localizedDigits(analytics.birthYearSummary.median,locale) : "—"}</footer></article><article className="stats-card"><CardTitle title={t("stats.parentage.title")} meta={t("stats.parentage.meta")}/>{parentage ? <div className="stats-composition"><Composition tone="sire" label={t("stats.parentageBoth")} value={parentage.bothParents} percent={parentage.bothParentsPercent}/><Composition tone="warn" label={t("stats.parentageOne")} value={parentage.oneParent} percent={parentage.oneParentPercent}/><Composition tone="neutral" label={t("stats.parentageNone")} value={parentage.noParents} percent={parentage.noParentsPercent}/></div> : <Empty/>}</article></div>
      </>}
      {(activeSection==="all"||(activeSection==="overview"&&(activeSubtab==="all"||activeSubtab==="intelligence")))&&<PremiumRegistryIntelligence analytics={analytics} navigate={navigate} expandAll={activeSection==="all"||activeSubtab==="all"}/>}

      {(activeSection==="all"||(activeSection==="pedigree"&&(activeSubtab==="all"||activeSubtab==="coverage")))&&<div className="stats-pedigree-layout"><article className="stats-card"><CardTitle title={t("stats.pedigree.coverageDepth")} meta={t("stats.cycleCleanOnly")}/><div className="stats-depth-grid">{completeness.map(item => <div className="stats-depth" key={item.depth}><div className={`stats-ring tone-${toneForPercent(item.averagePercent)}`} style={{"--value":`${item.averagePercent}%`} as React.CSSProperties}><strong>{percent(item.averagePercent)}</strong><small>{locale==="fa"?`${t("generation.gen")} ${n(item.depth)}`:`G${n(item.depth)}`}</small></div><span>{t("stats.average")}</span><em>{t("stats.median")} {percent(item.medianPercent)}</em><small>{n(item.halfOrBetterCount)} {t("stats.halfBetter")}</small></div>)}</div></article><article className="stats-card stats-integrity-card"><CardTitle title={t("stats.integrity.title")} meta={t("stats.integrity.meta")}/><div className="stats-integrity-numbers"><Kpi tone="good" label={t("stats.analyticsEligible")} value={n(analytics.pedigree.analyticsEligibleHorseCount)} detail={t("stats.cycleClean")}/><Kpi tone="danger" label={t("stats.cycleNodes")} value={n(analytics.pedigree.cycleNodeCount)} detail={t("stats.actualCycleNodes")}/><Kpi tone="warn" label={t("stats.cycleAffected")} value={n(analytics.pedigree.cycleContaminatedHorseCount)} detail={t("stats.reachesCycle")}/></div><p className="stats-method-note">ⓘ {localizedAnalysisText(analytics.pedigree.cyclePolicy || analytics.pedigree.representationInterpretation,locale)}</p></article></div>}
      {(activeSection==="all"||(activeSection==="pedigree"&&(activeSubtab==="all"||activeSubtab==="influence")))&&<RankingGrid title={t("stats.representedAncestors")} items={analytics.pedigree.topRepresentedAncestorsDepth4.slice(0,10)} locale={locale} n={n} unit={t("stats.pedigreePositions")} onOpen={id => navigate(`/horse/${id}`)} tone="accent"/>}

      {(activeSection==="all"||(activeSection==="breeding"&&(activeSubtab==="all"||activeSubtab==="distribution")))&&<div className="stats-breeding-grid"><article className="stats-card"><CardTitle title={t("stats.progenyDistribution")} meta={`${t("stats.p99")} ${n(analytics.progeny.percentiles.p99)}+`}/><div className="stats-histogram">{progenyHistogram.map(row => <span key={row.label}><b style={{height:`${Math.max(row.count?3:0,(row.count/progenyMax)*100)}%`}}/><strong>{n(row.count)}</strong><small>{localizedDigits(row.label,locale)}</small></span>)}</div><footer>{n(analytics.progeny.horsesWithRecordedOffspring)} {t("stats.withOffspring")} · {t("stats.max")} {n(analytics.progeny.percentiles.max)}</footer></article><article className="stats-card"><CardTitle title={t("stats.activity.title")} meta={t("stats.activity.meta")}/>{analytics.activity ? <div className="stats-activity-grid">{(["active","deceased","imported","stallions","sport","sportCard"] as const).map((key,index) => <div className={`data-tile tone-${(["good","neutral","info","sire","accent","warn"] as Tone[])[index]}`} key={key}><small>{t(`stats.activity.${key}`)}</small><strong>{n(analytics.activity![key].count)}</strong><span>{percent(analytics.activity![key].percent,1)}</span></div>)}</div> : <Empty/>}</article></div>}
      {(activeSection==="all"||(activeSection==="breeding"&&(activeSubtab==="all"||activeSubtab==="leaders")))&&<div className="stats-ranking-columns"><RankingGrid title={t("stats.topSires")} items={analytics.progeny.topSires.slice(0,10)} locale={locale} n={n} unit={t("stats.children")} onOpen={id=>navigate(`/horse/${id}`)} tone="sire"/><RankingGrid title={t("stats.topDams")} items={analytics.progeny.topDams.slice(0,10)} locale={locale} n={n} unit={t("stats.children")} onOpen={id=>navigate(`/horse/${id}`)} tone="dam"/></div>}

      {(activeSection==="all"||(activeSection==="population"&&(activeSubtab==="all"||activeSubtab==="demography")))&&<div className="stats-category-grid stats-category-demography"><SexDistributionCard title={t("stats.sexDistribution")} items={analytics.sexDistribution} n={n}/><CategoryCard title={t("stats.topPlaces")} items={topPlaces} n={n} tone="info"/></div>}
      {(activeSection==="all"||(activeSection==="population"&&(activeSubtab==="all"||activeSubtab==="classification")))&&<div className="stats-category-grid"><CategoryCard title={t("stats.topBreeds")} items={topBreeds} n={n} tone="accent"/>{topColors.length > 0 && <CategoryCard title={t("stats.topColors")} items={topColors} n={n} tone="dam"/>}{topStrains.length > 0 && <CategoryCard title={t("stats.topStrains")} items={topStrains} n={n} tone="sire"/>}</div>}

      {(activeSection==="all"||(activeSection==="people"&&(activeSubtab==="all"||activeSubtab==="summary")))&&(people?<div className="stats-kpi-grid stats-kpi-people"><Kpi tone="info" label={t("stats.people")} value={n(people.peopleCount)} detail={t("stats.peopleRecorded")}/><Kpi tone="accent" label={t("stats.owners")} value={n(people.ownerCount)} detail={`${n(people.horsesWithOwner)} ${t("stats.linkedHorses")}`}/><Kpi tone="good" label={t("stats.breeders")} value={n(people.breederCount)} detail={`${n(people.horsesWithBreeder)} ${t("stats.linkedHorses")}`}/><Kpi tone="warn" label={t("stats.importers")} value={n(people.importerCount)} detail={`${n(people.horsesWithImporter)} ${t("stats.linkedHorses")}`}/><Kpi tone="dam" label={t("stats.passportReceivers")} value={n(people.passportReceiverCount)} detail={`${n(people.horsesWithPassportReceiver)} ${t("stats.linkedHorses")}`}/></div>:<Empty/>)}
      {(activeSection==="all"||(activeSection==="people"&&(activeSubtab==="all"||activeSubtab==="rankings")))&&(people?<div className="stats-ranking-columns"><PersonRanking title={t("stats.topOwners")} items={people.topOwners.slice(0,10)} locale={locale} n={n} unit={t("stats.horses")} onOpen={id=>navigate(`/person/${id}`)} tone="info"/><PersonRanking title={t("stats.topBreeders")} items={people.topBreeders.slice(0,10)} locale={locale} n={n} unit={t("stats.horses")} onOpen={id=>navigate(`/person/${id}`)} tone="good"/><PersonRanking title={t("stats.topImporters")} items={people.topImporters.slice(0,10)} locale={locale} n={n} unit={t("stats.horses")} onOpen={id=>navigate(`/person/${id}`)} tone="warn"/><PersonRanking title={t("stats.topPassportReceivers")} items={people.topPassportReceivers.slice(0,10)} locale={locale} n={n} unit={t("stats.horses")} onOpen={id=>navigate(`/person/${id}`)} tone="dam"/></div>:<Empty/>)}

      {(activeSection==="all"||(activeSection==="quality"&&(activeSubtab==="all"||activeSubtab==="coverage")))&&<article className="stats-card"><CardTitle title={t("stats.coverage.title")} meta={t("stats.coverage.meta")}/>{analytics.dataCoverage ? <div className="stats-coverage-list" dir={(isUiRtl(locale) ? "rtl" : "ltr")}>{analytics.dataCoverage.fields.map(item => <div className="stats-coverage-row" dir={(isUiRtl(locale) ? "rtl" : "ltr")} key={item.key}><span dir={(isUiRtl(locale) ? "rtl" : "ltr")}>{t(COVERAGE_LABELS[item.key] || item.key)}</span><i><b className={`tone-${toneForPercent(item.percent)}`} style={{width:`${Math.min(100,item.percent)}%`}}/></i><strong>{percent(item.percent,1)}</strong><small>{n(item.count)}</small></div>)}</div> : <Empty/>}</article>}
      {(activeSection==="all"||(activeSection==="quality"&&(activeSubtab==="all"||activeSubtab==="coverage")))&&<article className="stats-card" data-surface="registry-completeness"><CardTitle title={t("stats.completeness.title")} meta={t("stats.completeness.meta")}/>{analytics.completeness ? <div className="stats-completeness" data-completeness-snapshot={analytics.completeness.snapshotTime} dir={(isUiRtl(locale) ? "rtl" : "ltr")}>{analytics.completeness.measures.map(measure => <div className="stats-completeness-measure" key={measure.key} dir={(isUiRtl(locale) ? "rtl" : "ltr")}><div className="stats-completeness-head" dir={(isUiRtl(locale) ? "rtl" : "ltr")}><strong dir={(isUiRtl(locale) ? "rtl" : "ltr")}>{t(`stats.completeness.${measure.key}`,measure.label)}</strong><em className={`tone-${toneForPercent(measure.coveragePercent)}`}>{percent(measure.coveragePercent,1)}</em><small>{n(measure.coveredRecords)} / {n(measure.totalRecords)}</small></div><div className="stats-completeness-components" dir={(isUiRtl(locale) ? "rtl" : "ltr")}>{measure.components?.map(component => <div className="stats-completeness-row" dir={(isUiRtl(locale) ? "rtl" : "ltr")} key={component.key} title={component.missingDefinition}><span dir={(isUiRtl(locale) ? "rtl" : "ltr")}>{component.label}</span><i><b className={`tone-${toneForPercent(component.coveragePercent)}`} style={{width:`${Math.min(100,component.coveragePercent)}%`}}/></i><strong>{percent(component.coveragePercent,1)}</strong><small>{n(component.coveredRecords)}</small></div>)}</div></div>)}<p className="stats-method-note" dir={(isUiRtl(locale) ? "rtl" : "ltr")}>ⓘ {localizedAnalysisText(analytics.completeness.interpretation,locale)}</p><p className="stats-method-note" dir={(isUiRtl(locale) ? "rtl" : "ltr")}>ⓘ {t("stats.completeness.snapshot")} {String(analytics.completeness.snapshotTime)}</p></div> : <Empty/>}</article>}
      {(activeSection==="all"||(activeSection==="quality"&&(activeSubtab==="all"||activeSubtab==="findings")))&&<article className="stats-card"><CardTitle title={t("stats.quality.openFindings")} meta={quality ? n(quality.openIssues) : "—"}/>{quality ? <><div className="stats-quality-severity">{quality.severities.map(item => <div className={`data-tile tone-${item.label === "error" ? "danger" : item.label === "warning" ? "warn" : "info"}`} key={item.label}><small>{t(`stats.severity.${item.label}`,item.label)}</small><strong>{n(item.count)}</strong></div>)}</div><div className="stats-issue-list">{quality.topIssueCodes.slice(0,8).map(item => <div key={item.label}><span>{t(`stats.issue.${item.label}`,item.label.replaceAll("_"," "))}</span><strong>{n(item.count)}</strong></div>)}</div></> : <Empty/>}</article>}
      {(activeSection==="all"||(activeSection==="quality"&&(activeSubtab==="all"||activeSubtab==="era")))&&(recentCoverage.length > 0 ? <article className="stats-card stats-era-quality"><CardTitle title={t("stats.coverageEra.title")} meta={t("stats.coverageEra.meta")}/><div className="stats-era-table"><header><span>{t("stats.decade")}</span><span>{t("stats.coverage.nativeName")}</span><span>{t("stats.coverage.registration")}</span><span>{t("stats.coverage.birthPlace")}</span><span>{t("stats.coverage.bothParents")}</span></header>{recentCoverage.map(row => <div key={row.decade}><strong>{decadeLabel(row.decade,locale,n)}</strong><MetricCell value={row.nativeNamePercent}/><MetricCell value={row.registrationPercent}/><MetricCell value={row.birthPlacePercent}/><MetricCell value={row.bothParentsPercent}/></div>)}</div></article>:<Empty/>)}
    </section>

    <footer className="stats-footer"><strong>{t("stats.provenance")}</strong><span>{localizedAnalysisText(analytics.provenance.interpretation,locale)}</span><code>{analytics.sourceRevision.slice(0,24)}…</code></footer>
  </main>;
}

function StatsSectionHead({kicker,title,body}:{kicker:string;title:string;body:string}) { return <div className="stats-section-head"><span>{kicker}</span><h2>{title}</h2><p>{body}</p></div>; }
function CardTitle({title,meta}:{title:string;meta?:string}) { return <header className="stats-card-title"><strong>{title}</strong>{meta && <small>{meta}</small>}</header>; }
function Empty(){ const {t}=useI18n(); return <div className="stats-empty">{t("stats.notAvailable")}</div>; }
function Kpi({tone,label,value,detail}:{tone:Tone;label:string;value:string;detail:string}) { return <article className={`stats-kpi tone-${tone}`}><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>; }
function Composition({tone,label,value,percent}:{tone:Tone;label:string;value:number;percent:number}) { const {n,locale}=useI18n(); const pct=localizedPercent(percent,locale,1,1); return <div className="stats-composition-row"><span className={`data-dot tone-${tone}`}/><b>{label}</b><i><em className={`tone-${tone}`} style={{width:`${percent}%`}}/></i><strong>{pct}</strong><small>{n(value)}</small></div>; }
function MetricCell({value}:{value:number}) { const {locale}=useI18n(); const pct=localizedPercent(value,locale,0); return <span className={`stats-era-cell tone-${toneForPercent(value)}`}><i style={{width:`${value}%`}}/><b>{pct}</b></span>; }

function CategoryCard({title,items,n,tone}:{title:string;items:Array<{label:string;count:number}>;n:(value:number)=>string;tone:Tone}) { const {locale}=useI18n(); const max=Math.max(1,...items.map(item=>item.count)); const dir=(isUiRtl(locale) ? "rtl" : "ltr"); return <article className={`stats-card stats-category-card tone-${tone}`}><CardTitle title={title}/><div>{items.map((item,index)=><div className="stats-category-row" dir={dir} key={`${item.label}-${index}`}><span dir={dir}>{localizeAnalyticsLabel(item.label,locale)}</span><i><b className={`tone-${tone}`} style={{width:`${Math.max(item.count?3:0,(item.count/max)*100)}%`}}/></i><strong dir={dir}>{n(item.count)}</strong></div>)}</div></article>; }
function sexTone(label:string):Tone { const value=label.toLowerCase(); if(value.includes("filly")||value.includes("mare")||value.includes("female"))return "dam"; if(value.includes("colt")||value.includes("stallion")||value.includes("male"))return "sire"; if(value.includes("geld"))return "neutral"; return "warn"; }
function SexDistributionCard({title,items,n}:{title:string;items:Array<{label:string;count:number}>;n:(value:number)=>string}) { const {locale}=useI18n(); const max=Math.max(1,...items.map(item=>item.count)); const total=Math.max(1,items.reduce((sum,item)=>sum+item.count,0)); const dir=(isUiRtl(locale) ? "rtl" : "ltr"); const pct=(v:number)=>localizedPercent(v,locale,1,1); return <article className="stats-card stats-category-card tone-info"><CardTitle title={title}/><div>{items.map((item,index)=>{const tone=sexTone(item.label);return <div className="stats-category-row stats-sex-row" dir={dir} key={`${item.label}-${index}`}><span dir={dir}><i className={`data-dot tone-${tone}`}/><b>{localizeAnalyticsLabel(item.label,locale)}</b></span><i><b className={`tone-${tone}`} style={{width:`${Math.max(item.count?3:0,(item.count/max)*100)}%`}}/></i><strong dir={dir}><b>{n(item.count)}</b><small>{pct((item.count/total)*100)}</small></strong></div>})}</div></article>; }

function ReferencePopulationBenchmarks({rows}:{rows:NonNullable<RegistryAnalyticsResponse["premium"]>["referencePopulations"]}){
  const {locale,n}=useI18n();const L=(en:string,fa:string)=>uiText(locale, en, fa);const pct=(v:number|null,d=2)=>v==null?"—":localizedPercent(v,locale,d);
  const dist=(x:{mean:number|null;median:number|null;p10:number|null;p90:number|null},percent=true)=><em>{L("mean","میانگین")} {percent?pct(x.mean):x.mean==null?"—":new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:1}).format(x.mean)} · {L("P10–P90","صدک ۱۰–۹۰")} {percent?`${pct(x.p10)}–${pct(x.p90)}`:`${x.p10==null?"—":new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:1}).format(x.p10)}–${x.p90==null?"—":new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:1}).format(x.p90)}`}</em>;
  return <article className="stats-card reference-population-benchmarks"><CardTitle title={L("Same-breed reference populations","جمعیت‌های مرجع هم‌نژاد")} meta={L("recent · cycle-clean · pedigree-only","اخیر · بدون چرخه · صرفاً تبارنامه‌ای")}/><div className="reference-population-table">{rows?.map(row=><div key={row.key}><span><b dir="auto">{row.label}</b><small>{localizedDigits(row.startYear,locale)}–{localizedDigits(row.endYear,locale)} · {L("population","جمعیت")} {n(row.populationSize)} · {L("sample","نمونه")} {n(row.sampleSize)}</small></span><span className="metric-kinship"><small>{L("Median mean kinship","میانه میانگین خویشاوندی")}</small><strong>{pct(row.meanKinshipPercent.median)}</strong>{dist(row.meanKinshipPercent)}</span><span className="metric-rarity"><small>{L("Ancestor rarity","کمیابی نیاکان")}</small><strong>{pct(row.recordedAncestorRarityIndex.median)}</strong>{dist(row.recordedAncestorRarityIndex)}</span><span className="metric-dpi"><small>{L("Median DPI","میانه شاخص حفظ تنوع")}</small><strong>{row.diversityPreservationIndex.median==null?"—":new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:1}).format(row.diversityPreservationIndex.median)}</strong>{dist(row.diversityPreservationIndex,false)}</span><span className="metric-roots"><small>{L("Direct roots M/F","ریشه مستقیم پ/م")}</small><strong>{n(row.tailMaleDistinctRoots)} / {n(row.tailFemaleDistinctRoots)}</strong><em>{L("recorded direct-line roots","ریشه‌های ثبت‌شده خطوط مستقیم")}</em></span></div>)}</div><p>{rows?.[0]?.interpretation?localizedAnalysisText(rows[0].interpretation,locale):""}</p></article>;
}

function InfluenceSpark({points,locale}:{points:Array<{decade:number;count:number}>;locale:UiLocale}){const max=Math.max(1,...points.map(x=>x.count));return <span className="trajectory-spark" aria-label={uiText(locale, "trajectory", "روند")}>{points.map(x=><i key={x.decade} title={locale==="fa"?`دهه ${localizedDigits(x.decade,locale)} · ${localizedDigits(x.count,locale)}`:`${x.decade}s · ${x.count}`} style={{height:`${Math.max(x.count?8:2,x.count/max*100)}%`}}/>)}</span>}
function InfluenceTrajectoryPanel({data,navigate}:{data:NonNullable<NonNullable<RegistryAnalyticsResponse["premium"]>["influenceTrajectories"]>;navigate:(path:string)=>void}){
  const {locale,n}=useI18n(); const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const group=(kind:"current"|"rising"|"fading",title:string,rows:typeof data.topCurrent)=><section className={`trajectory-${kind}`}><h4>{title}</h4><div>{rows.map(row=><button className={row.momentumPercent>0?"momentum-positive":row.momentumPercent<0?"momentum-negative":"momentum-flat"} key={`${title}-${row.horse.id}`} onClick={()=>navigate(`/horse/${row.horse.id}`)}><span dir="auto"><b>{displayHorseName(row.horse,locale)}</b><small>#{localizedDigits(row.horse.id,locale)} · {L("children","فرزند")} {n(row.directChildren)} · {locale==="fa"?`نسل ۴ ${n(row.uniqueDescendantsDepth4)}`:`G4 ${n(row.uniqueDescendantsDepth4)}`} · {L("positions","جایگاه")} {n(row.representedAncestorPositionsDepth4)}</small></span><InfluenceSpark points={row.byBirthDecade} locale={locale}/><strong>{L("recent","اخیر")} {n(row.recentDescendants)}<small>{L("prior","پیشین")} {n(row.priorPeriodDescendants)}</small></strong><em>{row.momentumPercent>=0?"+":""}{new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:0}).format(row.momentumPercent)}{locale==="fa"?"٪":"%"}</em></button>)}</div></section>;
  return <article className="stats-card influence-trajectories"><CardTitle title={L("Recorded lineage influence trajectories","روند نفوذ ثبت‌شده تبار")} meta={`${localizedDigits(data.priorPeriod[0],locale)}–${localizedDigits(data.priorPeriod[1],locale)} ↔ ${localizedDigits(data.recentPeriod[0],locale)}–${localizedDigits(data.recentPeriod[1],locale)} · ${locale==="fa"?`نسل ${n(data.depth)}`:`G${n(data.depth)}`}`}/><div className="influence-trajectory-groups">{group("current",L("Strongest recent reach","بیشترین گستره اخیر"),data.topCurrent)}{group("rising",L("Rising recorded lines","خطوط ثبت‌شده رو به رشد"),data.rising)}{group("fading",L("Fading recorded lines","خطوط ثبت‌شده رو به کاهش"),data.fading)}</div><p>{localizedAnalysisText(data.interpretation,locale)}</p></article>;
}

function RankingGrid({title,items,locale,n,unit,onOpen,tone}:{title:string;items:RegistryAnalyticsHorseRank[];locale:UiLocale;n:(value:number)=>string;unit:string;onOpen:(id:number)=>void;tone:Tone}) { return <article className={`stats-card stats-ranking-card tone-${tone}`}><CardTitle title={title}/><ol>{items.map((item,index)=><li key={item.id}><button onClick={()=>onOpen(item.id)}><span className={`rank-no tone-${tone}`}>{n(index+1)}</span><span><b dir="auto">{displayHorseName(item,locale)}</b><small>#{localizedDigits(item.id,locale)}{item.birth_year?` · ${localizedDigits(item.birth_year,locale)}`:""}</small></span><strong>{n(item.count)} <em>{unit}</em></strong></button></li>)}</ol></article>; }
function PersonRanking({title,items,locale,n,unit,onOpen,tone}:{title:string;items:RegistryAnalyticsPersonRank[];locale:UiLocale;n:(value:number)=>string;unit:string;onOpen:(id:number)=>void;tone:Tone}) { return <article className={`stats-card stats-ranking-card tone-${tone}`}><CardTitle title={title}/><ol>{items.map((item,index)=><li key={item.id}><button onClick={()=>onOpen(item.id)}><span className={`rank-no tone-${tone}`}>{n(index+1)}</span><span><b dir="auto">{displayPersonName(item,locale)}</b><small>#{localizedDigits(item.id,locale)}</small></span><strong>{n(item.count)} <em>{unit}</em></strong></button></li>)}</ol></article>; }

function PremiumRegistryIntelligence({analytics,navigate,expandAll=false}:{analytics:RegistryAnalyticsResponse;navigate:(path:string)=>void;expandAll?:boolean}) {
  const {locale,n}=useI18n();
  const [premiumTab,setPremiumTab]=useState<"all"|"validity"|"concentration"|"generations"|"lineage"|"method">("validity");
  const visiblePremiumTab=expandAll?"all":premiumTab;
  const p=analytics.premium;if(!p)return null;
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const pct2=(v:number)=>localizedPercent(v,locale,2);
  const metric=(label:string,value:string,note?:string,tone?:Tone)=><div className={`premium-metric${tone?` tone-${tone}`:""}`}><small>{label}</small><strong>{value}</strong>{note&&<span>{note}</span>}</div>;
  const conc=(title:string,x:NonNullable<typeof p>["parentConcentration"]["sires"],tone:Tone)=> <article className={`stats-card premium-concentration tone-${tone}`}><CardTitle title={title} meta={`${n(x.assignments)} ${L("assignments","انتساب")}`}/><div className="premium-metric-grid">{metric(L("Distinct parents","والد یکتا"),n(x.distinctParents),undefined,tone)}{metric(L("Top 1 / 5 / 10 share","سهم ۱ / ۵ / ۱۰"),`${pct2(x.top1SharePercent)} · ${pct2(x.top5SharePercent)} · ${pct2(x.top10SharePercent)}`,undefined,"warn")}{metric(L("HHI / Gini","HHI / جینی"),`${new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:1}).format(x.hhi)} · ${new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:3}).format(x.gini)}`,`${L("Shannon H","آنتروپی شانون")} ${new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:3}).format(x.shannonEntropy)}`,"danger")}{metric(L("Entropy-effective count","تعداد مؤثر آنتروپی"),n(Math.round(x.entropyEffectiveParentCount)),undefined,"good")}{metric(L("Inverse-Simpson count","تعداد مؤثر سیمپسون"),n(Math.round(x.inverseSimpsonEffectiveParentCount)),undefined,"info")}</div></article>;
  const peopleMetric=(label:string,x:NonNullable<NonNullable<typeof p>["peopleConcentration"]>["owners"],tone:Tone)=>{
    const shares=[[L("Top 1","۱ برتر"),x.top1SharePercent],[L("Top 5","۵ برتر"),x.top5SharePercent],[L("Top 10","۱۰ برتر"),x.top10SharePercent]] as const;
    return <div className={`premium-metric premium-people-metric tone-${tone}`}>
      <div className="premium-people-metric-head"><span><small>{label}</small><em>{L("distinct registry people","فرد یکتای سامانه ثبت")}</em></span><strong>{n(x.distinctPeople)}</strong></div>
      <div className="premium-share-ladder">{shares.map(([shareLabel,value])=><span key={shareLabel} style={{"--share":`${Math.max(0,Math.min(100,value))}%`} as React.CSSProperties}><small>{shareLabel}</small><i/><b>{pct2(value)}</b></span>)}</div>
      <div className="premium-metric-facts"><span><small>{L("Entropy effective","مؤثر آنتروپی")}</small><b>{n(Math.round(x.entropyEffectivePeopleCount))}</b></span><span><small>{L("Inv. Simpson","سیمپسون معکوس")}</small><b>{n(Math.round(x.inverseSimpsonEffectivePeopleCount))}</b></span><span><small>HHI</small><b>{localizedDigits(x.hhi,locale)}</b></span><span><small>{L("Gini","جینی")}</small><b>{localizedDigits(x.gini,locale)}</b></span></div>
    </div>;
  };
  const recentMetric=(label:string,value:string,note:string|undefined,tone:Tone)=><div className={`premium-metric premium-recent-metric tone-${tone}`}><small>{label}</small><strong>{value}</strong>{note&&<span><i aria-hidden="true"/> {note}</span>}</div>;
  const fmt1=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:1}).format(v);
  const interval=(label:string,x:NonNullable<typeof p>["generationIntervals"]["sireToOffspring"])=><div className="premium-metric premium-interval-metric tone-info"><small>{label}</small><strong>{x.medianYears==null?"—":fmt1(x.medianYears)}{x.medianYears!=null&&<em>{L("yr","سال")}</em>}</strong><div className="premium-interval-facts"><span><small>{L("Mean","میانگین")}</small><b>{fmt1(x.meanYears)}</b></span><span><small>{L("P10–P90","صدک ۱۰–۹۰")}</small><b>{fmt1(x.p10Years)}–{fmt1(x.p90Years)}</b></span><span><small>{L("N","تعداد")}</small><b>{n(x.count)}</b></span></div></div>;
  const gi=p.generationIntervals;
  const tabs=[
    ["all",L("ALL","همه")],["validity",L("Validity","اعتبار")],["concentration",L("Concentration","تمرکز")],["generations",L("Generation intervals","فاصله نسلی")],["lineage",L("Lineage reach","گستره تبار")],["method",L("Method","روش")],
  ] as const;
  const premiumCopy={
    all:{title:L("All premium intelligence","همه تحلیل پیشرفته"),body:L("Classic continuous view of validity, concentration, generation intervals, lineage reach and method.","نمای پیوسته کلاسیکِ اعتبار، تمرکز، فاصله نسلی، گستره تبار و روش.")},
    validity:{title:L("Analytical validity","اعتبار تحلیلی"),body:L("Eligibility, cycle cleanliness, meaningful coverage and the confidence boundary for downstream metrics.","شرایط ورود، پاکی از چرخه، پوشش معنادار و مرز اطمینان برای شاخص‌های بعدی.")},
    concentration:{title:L("Concentration & effective diversity","تمرکز و تنوع مؤثر"),body:L("Recorded parent and people-link concentration with effective-count context rather than raw popularity alone.","تمرکز والدین و پیوندهای افراد ثبت‌شده همراه با زمینه تعداد مؤثر، نه صرفاً محبوبیت خام.")},
    generations:{title:L("Generation intervals","فاصله‌های نسلی"),body:L("Six parent-to-offspring pathways with robust medians, ranges and historical decade context.","شش مسیر والد به فرزند با میانه‌های مقاوم، بازه‌ها و زمینه تاریخی دهه‌ای.")},
    lineage:{title:L("Lineage reach & representation","گستره و نمایندگی تبار"),body:L("Direct-line survival, reference-population context and recorded influence trajectories.","بقای خطوط مستقیم، زمینه جمعیت مرجع و روندهای نفوذ ثبت‌شده.")},
    method:{title:L("Method, exclusions & provenance","روش، حذف‌ها و منشأ"),body:L("The assumptions, exclusions and detailed concentration history behind the visible summaries.","فرض‌ها، حذف‌ها و تاریخچه دقیق تمرکز که پشت خلاصه‌های قابل مشاهده قرار دارند.")},
  } as const;
  const choosePremiumTab=(id:typeof premiumTab)=>{setPremiumTab(id);revealHeritageContent(".premium-intelligence-head")};
  return <div className="premium-intelligence stats-nested-workspace" data-h-surface-role="panel">
    <div className="workspace-route-trail is-nested" role="group" aria-label={L("Current intelligence path","مسیر هوشمندی فعال")}><span className="route-node">{L("Premium intelligence","تحلیل پیشرفته")}</span><i className="route-link" aria-hidden="true"/><span className="route-node is-current">{premiumCopy[visiblePremiumTab].title}</span></div>
    <div className="premium-intelligence-head"><div><span>{L("PREMIUM INTELLIGENCE","تحلیل پیشرفته")}</span><strong>{premiumCopy[visiblePremiumTab].title}</strong><small>{premiumCopy[visiblePremiumTab].body}</small></div></div>
    {!expandAll&&<ContextNavigation slot="h102-analytics-premium-context"><nav className="stats-tertiary-nav" aria-label={L("Intelligence views","نماهای هوشمندی")}><span className="tab-rail-label"><b>{L("INTELLIGENCE VIEWS","نماهای هوشمندی")}</b><small>{L("Switch analytical lens","لنز تحلیلی را عوض کنید")}</small></span>{tabs.map(([id,label])=><button key={id} className={premiumTab===id?"is-active":""} type="button" aria-pressed={premiumTab===id} onClick={()=>choosePremiumTab(id)}>{label}</button>)}</nav></ContextNavigation>}
    <div className="stats-nested-stage" data-h-surface-role="panel" key={visiblePremiumTab}>
      {(visiblePremiumTab==="all"||visiblePremiumTab==="validity")&&<div className="stats-kpi-grid"><Kpi tone={p.analyticalValidity.birthYear.grade==="high"?"good":"warn"} label={L("Analytical birth-year coverage","پوشش تحلیلی سال تولد")} value={pct2(p.analyticalValidity.birthYear.coveragePercent)} detail={`${n(p.analyticalValidity.birthYear.eligibleRecords)} / ${n(p.analyticalValidity.birthYear.totalRecords)}`}/><Kpi tone={p.analyticalValidity.pedigree.grade==="high"?"good":"warn"} label={L("Cycle-clean pedigree cohort","گروه تبارنامه بدون چرخه")} value={pct2(p.analyticalValidity.pedigree.coveragePercent)} detail={`${n(p.analyticalValidity.pedigree.eligibleRecords)} ${L("eligible","قابل تحلیل")}`}/><Kpi tone="info" label={L("Meaningful DNA records","رکورد DNA معنادار")} value={n(p.analyticalValidity.meaningfulDnaRecords)} detail={L("Coverage only — not genomic analysis","فقط پوشش داده؛ نه تحلیل ژنومی")}/><Kpi tone="danger" label={L("Parent-year conflicts","تعارض سال والد")} value={n(p.analyticalValidity.parentYearConflictCount)} detail={`${L("cycle findings","یافته چرخه")} ${n(p.analyticalValidity.cycleIssueCount)}`}/><Kpi tone="accent" label={L("Equivalent complete generations","نسل کامل معادل")} value={new Intl.NumberFormat(uiNumberTag(locale),{maximumFractionDigits:2}).format(p.pedigreeDiversity?.medianEquivalentCompleteGenerations??0)} detail={`${L("mean","میانگین")} ${p.pedigreeDiversity?.averageEquivalentCompleteGenerations??"—"} · ${L("N","تعداد")} ${n(p.pedigreeDiversity?.eligibleHorseCount??0)} · ${locale==="fa"?`نسل ${n(p.pedigreeDiversity?.depth??0)}`:`G${n(p.pedigreeDiversity?.depth??0)}`}`}/></div>}
      {(visiblePremiumTab==="all"||visiblePremiumTab==="concentration")&&<><div className="stats-overview-grid">{conc(L("Sire concentration","تمرکز پدران"),p.parentConcentration.sires,"sire")}{conc(L("Dam concentration","تمرکز مادران"),p.parentConcentration.dams,"dam")}</div>{p.peopleConcentration&&<article className="stats-card premium-people-concentration premium-readable-section"><CardTitle title={L("Registry people-link concentration","تمرکز پیوندهای افراد سامانه ثبت")} meta={L("role-link structure","ساختار پیوند نقش")}/><div className="premium-metric-grid premium-people-grid">{peopleMetric(L("Owners","مالکان"),p.peopleConcentration.owners,"info")}{peopleMetric(L("Breeders","پرورش‌دهندگان"),p.peopleConcentration.breeders,"good")}{peopleMetric(L("Importers","واردکنندگان"),p.peopleConcentration.importers,"warn")}{peopleMetric(L("Passport receivers","گیرندگان گذرنامه"),p.peopleConcentration.passportReceivers,"dam")}</div><p className="premium-readable-note">{localizedAnalysisText(p.peopleConcentration.interpretation,locale)}</p></article>}{p.parentConcentration.recentCohort&&<article className="stats-card premium-recent premium-readable-section tone-good"><CardTitle title={L("Recent breeding concentration","تمرکز تولیدمثل اخیر")} meta={`${localizedDigits(p.parentConcentration.recentCohort.startYear,locale)}–${localizedDigits(p.parentConcentration.recentCohort.endYear,locale)} · ${n(p.parentConcentration.recentCohort.horses)} ${L("horses","اسب")}`}/><div className="premium-metric-grid premium-recent-grid">{recentMetric(L("Top 10 sire share","سهم ۱۰ پدر برتر"),pct2(p.parentConcentration.recentCohort.sires.top10SharePercent),`HHI ${localizedDigits(p.parentConcentration.recentCohort.sires.hhi,locale)}`,"sire")}{recentMetric(L("Effective sires","پدر مؤثر"),n(Math.round(p.parentConcentration.recentCohort.sires.entropyEffectiveParentCount)),undefined,"sire")}{recentMetric(L("Top 10 dam share","سهم ۱۰ مادر برتر"),pct2(p.parentConcentration.recentCohort.dams.top10SharePercent),`HHI ${localizedDigits(p.parentConcentration.recentCohort.dams.hhi,locale)}`,"dam")}{recentMetric(L("Effective dams","مادر مؤثر"),n(Math.round(p.parentConcentration.recentCohort.dams.entropyEffectiveParentCount)),undefined,"dam")}</div></article>}</>}
      {(visiblePremiumTab==="all"||visiblePremiumTab==="generations")&&<article className="stats-card premium-generation-section premium-readable-section"><CardTitle title={L("Generation intervals","فاصله نسلی")} meta={`${n(gi.plausibleAgeRangeYears[0])}–${n(gi.plausibleAgeRangeYears[1])} ${L("yr validity window","سال بازه معتبر")}`}/><div className="premium-metric-grid premium-generation-grid">{interval(L("Sire → offspring","پدر ← فرزند"),gi.sireToOffspring)}{interval(L("Dam → offspring","مادر ← فرزند"),gi.damToOffspring)}{interval(L("Sire → son","پدر ← پسر"),gi.sireToSon)}{interval(L("Sire → daughter","پدر ← دختر"),gi.sireToDaughter)}{interval(L("Dam → son","مادر ← پسر"),gi.damToSon)}{interval(L("Dam → daughter","مادر ← دختر"),gi.damToDaughter)}</div><details className="premium-interval-history"><summary>{L("By offspring birth decade","بر حسب دهه تولد فرزند")}</summary><div className="premium-decade-table">{gi.byOffspringBirthDecade.map(x=><span className="premium-decade-cell" key={x.decade}><b>{decadeLabel(x.decade,locale,n)}</b><div className="premium-decade-line tone-sire"><em>{L("Sire","پدر")}</em><strong>{fmt1(x.sire.medianYears)}<small>{L("yr median","سال میانه")}</small></strong><span>{L("P10–P90","صدک ۱۰–۹۰")} {fmt1(x.sire.p10Years)}–{fmt1(x.sire.p90Years)}</span></div><div className="premium-decade-line tone-dam"><em>{L("Dam","مادر")}</em><strong>{fmt1(x.dam.medianYears)}<small>{L("yr median","سال میانه")}</small></strong><span>{L("P10–P90","صدک ۱۰–۹۰")} {fmt1(x.dam.p10Years)}–{fmt1(x.dam.p90Years)}</span></div></span>)}</div></details></article>}
      {(visiblePremiumTab==="all"||visiblePremiumTab==="lineage")&&<>{p.lineSurvival&&<article className="stats-card"><CardTitle title={L("Direct-line survival","بقای خطوط مستقیم")} meta={`${localizedDigits(p.lineSurvival.cohort.startYear,locale)}–${localizedDigits(p.lineSurvival.cohort.endYear,locale)} · ${L("count","تعداد")} ${n(p.lineSurvival.cohort.horses)}`}/><div className="premium-metric-grid">{metric(L("Tail-male roots","ریشه خط پدری"),n(p.lineSurvival.tailMale.distinctRecordedRoots),`${L("Top 10 share","سهم ۱۰ برتر")} ${pct2(p.lineSurvival.tailMale.top10SharePercent)}`,"sire")}{metric(L("Tail-female roots","ریشه خط مادری"),n(p.lineSurvival.tailFemale.distinctRecordedRoots),`${L("Top 10 share","سهم ۱۰ برتر")} ${pct2(p.lineSurvival.tailFemale.top10SharePercent)}`,"dam")}</div><div className="premium-root-columns"><div><b>{L("Top tail-male roots","ریشه‌های برتر پدری")}</b><div className="premium-root-list">{p.lineSurvival.tailMale.topRoots.map(r=><button key={`m-${r.id}`} onClick={()=>navigate(`/horse/${r.id}`)}><span dir="auto">{displayHorseName(r,locale)}</span><b>{n(r.count)}</b></button>)}</div></div><div><b>{L("Top tail-female roots","ریشه‌های برتر مادری")}</b><div className="premium-root-list">{p.lineSurvival.tailFemale.topRoots.map(r=><button key={`f-${r.id}`} onClick={()=>navigate(`/horse/${r.id}`)}><span dir="auto">{displayHorseName(r,locale)}</span><b>{n(r.count)}</b></button>)}</div></div></div><p>{localizedAnalysisText(p.lineSurvival.interpretation,locale)}</p></article>}{p.referencePopulations?.length?<ReferencePopulationBenchmarks rows={p.referencePopulations}/>:null}{p.influenceTrajectories?<InfluenceTrajectoryPanel data={p.influenceTrajectories} navigate={navigate}/>:null}</>}
      {(visiblePremiumTab==="all"||visiblePremiumTab==="method")&&<details open className="stats-card premium-method"><summary>{L("Method, exclusions & complete concentration detail","روش، حذف‌ها و جزئیات کامل تمرکز")}</summary><div className="premium-method-body"><p>{localizedAnalysisText(p.analyticalValidity.birthYear.interpretation,locale)}</p>{p.analyticalValidity.birthYear.exclusions.map(x=><p key={x.code}><b>{x.code}</b> · {n(x.count)} · {localizedAnalysisText(x.interpretation,locale)}</p>)}<p>{localizedAnalysisText(p.analyticalValidity.pedigree.interpretation,locale)}</p><div className="premium-decade-table">{p.parentConcentration.byBirthDecade.map(x=><span key={x.decade}><b>{decadeLabel(x.decade,locale,n)}</b><small>{n(x.horses)} {L("horses","اسب")}</small><small>{L("Sire top 10","سهم ۱۰ پدر برتر")} {pct2(x.sires.top10SharePercent)} · HHI {localizedDigits(x.sires.hhi,locale)}</small><small>{L("Dam top 10","سهم ۱۰ مادر برتر")} {pct2(x.dams.top10SharePercent)} · HHI {localizedDigits(x.dams.hhi,locale)}</small></span>)}</div></div></details>}
    </div>
  </div>;
}
