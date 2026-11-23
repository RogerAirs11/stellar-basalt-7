import { type UiLocale, uiText, engineUiLocale} from "../../shared/uiLocale";
import React, { useEffect, useRef, useState } from "react";
import type {
  BreedingPairingAnalysisResponse,
  BreedingOptimizerResponse,
  ClaimRecord,
  HorseRecord,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../../contracts/platform";
import { ArabianPairingPanel, usePrincipalScope, hasPlatformPermission, InfoTip, supportsPlatformFeature } from "../../frontend-kit";
import { useI18n } from "../i18n";
import { analysisMethodLabel,confidenceGradeLabel,localizedAnalysisText,localizedCodeLabel } from "./presentationLocale";

function relationshipKindLabel(kind:string,locale:string){
  const fa=locale==="fa";
  const labels:Record<string,[string,string]>={
    same_horse:["the same horse","یک اسب"],
    direct_ancestor:["direct ancestor and descendant","نیای مستقیم و نواده"],
    direct_descendant:["direct descendant and ancestor","نوادهٔ مستقیم و نیا"],
    full_sibling:["full siblings","خواهر و برادر تنی"],
    half_sibling:["half siblings","ناتنی"],
    related:["relatives","خویشاوند"],
    no_common_ancestor:["unrelated (no common ancestor recorded)","بدون نیای مشترک ثبت‌شده"],
  };
  const pair=labels[kind]??[kind,kind];
  return fa?pair[1]:pair[0];
}

function horseName(horse: Pick<HorseRecord,"id"|"name_latin"|"name_native">, locale: UiLocale) {
  return locale === "fa" ? (horse.name_native || horse.name_latin || `#${horse.id}`) : (horse.name_latin || horse.name_native || `#${horse.id}`);
}

function isFemale(value?: string | null) {
  const text = (value || "").toLowerCase();
  return text.includes("mare") || text.includes("female") || text.includes("filly") || text.includes("مادیان") || text.includes("ماده");
}

function HeritagePairingScience({projection}:{projection:NonNullable<BreedingPairingAnalysisResponse["diversityProjection"]>}){const {locale,n}=useI18n();const L=(en:string,fa:string)=>uiText(locale, en, fa);const pct=(v:number,d=1)=>new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US",{maximumFractionDigits:d}).format(v)+"%";return <details className="breeding-science-ledger"><summary>{L("Full projected diversity ledger","جزئیات کامل تنوع پیش‌بینی‌شده")}</summary><div className="breeding-science-grid"><span><small>{L("Known / expected positions","جایگاه معلوم / مورد انتظار")}</small><b>{n(projection.projectedKnownAncestorPositions)} / {n(projection.projectedExpectedAncestorPositions)}</b></span><span className="tone-sire"><small>{L("Sire unique ancestors","نیاکان یکتای پدر")}</small><b>{n(projection.sireUniqueRecordedAncestors)}</b></span><span className="tone-dam"><small>{L("Dam unique ancestors","نیاکان یکتای مادر")}</small><b>{n(projection.damUniqueRecordedAncestors)}</b></span><span className="tone-warn"><small>{L("Top-10 concentration","تمرکز ۱۰ برتر")}</small><b>{pct(projection.projectedTop10RecordedPathWeightSharePercent)}</b></span><span><small>{L("Depth","عمق")}</small><b>G{n(projection.depth)}</b></span><span><small>{L("Algorithm","الگوریتم")}</small><b>{projection.provenance.algorithmVersion}</b></span></div><p>{projection.confidence.reasons.map(reason=>localizedAnalysisText(reason,locale)).join(" · ")}</p></details>}
function HeritageOptimizerScience({result}:{result:BreedingOptimizerResponse}){const {locale,n}=useI18n();const L=(en:string,fa:string)=>uiText(locale, en, fa);const pct=(v:number,d=2)=>new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US",{maximumFractionDigits:d}).format(v)+"%";return <details className="optimizer-science-ledger"><summary>{L("Scoring ledger, objectives & warnings","جزئیات امتیازدهی، اهداف و هشدارها")}</summary><div className="breeding-science-grid"><span><small>{L("Fixed role / horse","نقش / اسب ثابت")}</small><b>{localizedCodeLabel(result.fixedRole,locale)} · #{n(result.fixedHorseId)}</b></span><span><small>{L("Evaluated candidates","نامزد ارزیابی‌شده")}</small><b>{n(result.evaluatedCandidates)}</b></span><span><small>{L("Depth","عمق")}</small><b>G{n(result.depth)}</b></span><span className="tone-danger"><small>{L("COI ceiling","سقف COI")}</small><b>{pct(result.objectives.coiCeilingPercent)}</b></span><span><small>{L("Weights COI/diversity/concentration/DPI","وزن‌ها COI/تنوع/تمرکز/DPI")}</small><b>{result.objectives.lowProjectedCoiWeight}/{result.objectives.ancestorDiversityWeight}/{result.objectives.lowConcentrationWeight}/{result.objectives.candidateDiversityPreservationWeight}</b></span><span><small>{L("Avoid ancestors","پرهیز از نیاکان")}</small><b>{result.objectives.avoidAncestorIds.length?result.objectives.avoidAncestorIds.map(x=>`#${n(x)}`).join(" · "):"—"}</b></span><span><small>{L("Strict exclusion","حذف قطعی")}</small><b>{result.objectives.excludeAvoidedAncestors?L("yes","بله"):L("no","خیر")}</b></span></div>{result.eligibilityWarnings?.map((warning,index)=><p className="breeding-warning" key={`eligibility-${index}`}>⚠ {localizedAnalysisText(warning,locale)}</p>)}{result.excludedCandidates?.length?<div className="optimizer-exclusions"><strong>{L("Excluded candidates","نامزدهای حذف‌شده")}</strong>{result.excludedCandidates.map(item=><p key={`${item.candidateId}-${item.code}`}><b>#{n(item.candidateId)}</b> · {localizedCodeLabel(item.code,locale)} · {localizedAnalysisText(item.message,locale)}</p>)}</div>:null}<div className="optimizer-breakdown">{result.ranked.map(row=><article key={row.candidate.id} className={row.rank===1?"rank-best":row.rank<=3?"rank-top":""}><header><b>#{n(row.rank)} · <span dir="auto">{horseName(row.candidate,locale)}</span></b><span>{L("raw","خام")} {n(row.score)} · {L("adjusted","تعدیل")} {n(row.confidenceAdjustedScore)}</span></header><div><span>{L("Top-5 concentration","تمرکز ۵ برتر")} <b>{row.projectedTop5RecordedPathWeightSharePercent==null?"—":pct(row.projectedTop5RecordedPathWeightSharePercent)}</b></span><span>{L("Completeness","کامل‌بودن")} <b>{row.projectedPedigreeCompletenessPercent==null?"—":pct(row.projectedPedigreeCompletenessPercent)}</b></span><span>{L("Shared ancestors","نیاکان مشترک")} <b>{row.sharedRecordedAncestorsBetweenParents==null?"—":n(row.sharedRecordedAncestorsBetweenParents)}</b></span><span>S/D <b>#{n(row.sireId)} / #{n(row.damId)}</b></span></div><div className="optimizer-score-components">{row.scoreComponents.map(c=><span key={c.code}><small>{localizedCodeLabel(c.code,locale)}</small><b>{c.normalizedScore==null?"—":n(c.normalizedScore)}</b><em>{c.appliedWeight.toFixed(3)} / {c.nominalWeight.toFixed(3)}</em></span>)}</div>{row.avoidedAncestorsPresent.length?<p className="breeding-warning">⚠ {L("Avoided ancestors present","نیاکان مورد پرهیز حاضرند")}: {row.avoidedAncestorsPresent.map(x=>`#${n(x)}`).join(" · ")}</p>:null}{row.warnings.map((warning,index)=><p className="breeding-warning" key={index}>⚠ {localizedAnalysisText(warning,locale)}</p>)}</article>)}</div><footer>{analysisMethodLabel(result.provenance.method,locale)} · {result.provenance.algorithmVersion}<br/>{localizedAnalysisText(result.provenance.caveat,locale)}</footer></details>}

export function HeritageBreedingPanel({horse,navigate,platform,platformMeta,user,permissions=[]}:{horse:HorseRecord;navigate:(path:string)=>void;platform:PlatformClient;platformMeta:PlatformMetaResponse|null;user?:PlatformUser|null;permissions?:readonly PlatformPermission[]}) {
  const principalScope = usePrincipalScope(user, permissions);
  const { t, n, locale } = useI18n();
  const percent=(value:number,digits=0)=>new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value)+"%";
  const available = supportsPlatformFeature(platformMeta,"breeding_analysis",{minVersion:"0.1.0",maxMajor:0});
  const [query,setQuery]=useState("");
  const [options,setOptions]=useState<HorseRecord[]>([]);
  const [partner,setPartner]=useState<HorseRecord|null>(null);
  const [result,setResult]=useState<BreedingPairingAnalysisResponse|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [optimizerQuery,setOptimizerQuery]=useState("");
  const [optimizerOptions,setOptimizerOptions]=useState<HorseRecord[]>([]);
  const [optimizerCandidates,setOptimizerCandidates]=useState<HorseRecord[]>([]);
  const [optimizerResult,setOptimizerResult]=useState<BreedingOptimizerResponse|null>(null);
  const [optimizerBusy,setOptimizerBusy]=useState(false);
  const [currentRole,setCurrentRole]=useState<"sire"|"dam">(()=>isFemale(horse.sex_desc)?"dam":"sire");
  const horseIsDam=currentRole==="dam";
  const analysisAbort=useRef<AbortController|null>(null);
  const optimizerAbort=useRef<AbortController|null>(null);
  useEffect(()=>{setBusy(false);analysisAbort.current?.abort();return()=>analysisAbort.current?.abort();},[horse.id,partner?.id,currentRole,principalScope]);
  useEffect(()=>{setOptimizerBusy(false);optimizerAbort.current?.abort();return()=>optimizerAbort.current?.abort();},[horse.id,currentRole,principalScope,optimizerCandidates.map(row=>row.id).join(",")]);

  useEffect(()=>{
    setCurrentRole(isFemale(horse.sex_desc)?"dam":"sire");
    setPartner(null);setQuery("");setOptions([]);setResult(null);setError("");setOptimizerQuery("");setOptimizerOptions([]);setOptimizerCandidates([]);setOptimizerResult(null);
  },[horse.id,horse.sex_desc]);

  useEffect(()=>{
    if(!available||partner||query.trim().length<2){setOptions([]);return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>platform.search.horses(query,{limit:8,signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setOptions(value.results.filter(item=>item.id!==horse.id));}).catch(()=>{}),140);
    return()=>{clearTimeout(timer);controller.abort();};
  },[available,horse.id,partner,platform,query]);

  const choose=(candidate:HorseRecord)=>{setPartner(candidate);setQuery(horseName(candidate,locale));setOptions([]);setResult(null);setError("");};
  useEffect(()=>{
    if(!available||optimizerQuery.trim().length<2){setOptimizerOptions([]);return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>platform.search.horses(optimizerQuery,{limit:8,signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setOptimizerOptions(value.results.filter(item=>item.id!==horse.id&&!optimizerCandidates.some(x=>x.id===item.id)));}).catch(()=>{}),140);
    return()=>{clearTimeout(timer);controller.abort();};
  },[available,horse.id,optimizerCandidates,optimizerQuery,platform]);
  const addOptimizerCandidate=(candidate:HorseRecord)=>{if(optimizerCandidates.length>=12||optimizerCandidates.some(x=>x.id===candidate.id))return;setOptimizerCandidates(list=>[...list,candidate]);setOptimizerQuery("");setOptimizerOptions([]);setOptimizerResult(null);};
  const optimize=async()=>{
    if(!optimizerCandidates.length)return;
    optimizerAbort.current?.abort(); const controller=new AbortController();optimizerAbort.current=controller;
    setOptimizerBusy(true);setOptimizerResult(null);setError("");
    try{const value=await platform.breeding.optimize({fixedHorseId:horse.id,fixedRole:currentRole,candidateIds:optimizerCandidates.map(x=>x.id),depth:8},{signal:controller.signal});if(!controller.signal.aborted)setOptimizerResult(value);}
    catch(error){if(!controller.signal.aborted)setError((error as Error).message);}
    finally{if(!controller.signal.aborted)setOptimizerBusy(false);}
  };
  const analyze=async()=>{
    if(!partner)return;
    analysisAbort.current?.abort();const controller=new AbortController();analysisAbort.current=controller;
    setBusy(true);setError("");setResult(null);
    try{
      const sireId=horseIsDam?partner.id:horse.id, damId=horseIsDam?horse.id:partner.id;
      const value=await platform.breeding.pairingAnalysis(sireId,damId,{depth:8},{signal:controller.signal});
      if(!controller.signal.aborted)setResult(value);
    }catch(error){if(!controller.signal.aborted)setError((error as Error).message);}
    finally{if(!controller.signal.aborted)setBusy(false);}
  };

  return <section className="heritage-breeding-panel compare-section h-glass-1" data-h-surface-role="panel">
    <div className="section-title"><div><span>{t("breeding.eyebrow")}</span><h2>{t("breeding.title")}</h2><p>{t("breeding.lede")}</p></div><b className={`capability-state ${available?"live":"dormant"}`}>{available?t("desk.live"):t("desk.dormant")}</b></div>
    {!available?<div className="desk-dormant-note">{t("breeding.unavailable")}</div>:<>
      <div className="breeding-pair-grid">
        <article className={`breeding-parent ${horseIsDam?"dam":"sire"}`}><small>{horseIsDam?t("breeding.dam"):t("breeding.sire")}</small><strong dir="auto">{horseName(horse,locale)}</strong><span>#{n(horse.id)}</span><em>{t("breeding.current")}</em><div className="breeding-role-choice"><button type="button" aria-pressed={!horseIsDam} className={!horseIsDam?"active sire":"sire"} onClick={()=>{setCurrentRole("sire");setResult(null);setOptimizerResult(null);setError("")}}>{t("breeding.sire")}</button><button type="button" aria-pressed={horseIsDam} className={horseIsDam?"active dam":"dam"} onClick={()=>{setCurrentRole("dam");setResult(null);setOptimizerResult(null);setError("")}}>{t("breeding.dam")}</button></div></article>
        <div className="breeding-cross">×</div>
        <div className={`breeding-partner ${horseIsDam?"sire":"dam"}`}><small>{horseIsDam?t("breeding.sire"):t("breeding.dam")}</small><div className="breeding-search"><input dir="auto" value={query} onChange={e=>{setQuery(e.target.value);setPartner(null);setResult(null);setError("");}} placeholder={t("breeding.search")}/>{options.length>0&&<div className="picker-options">{options.map(option=><button key={option.id} onClick={()=>choose(option)}><strong dir="auto">{horseName(option,locale)}</strong><span>#{n(option.id)}{option.birth_year?` · ${option.birth_year}`:""}</span></button>)}</div>}</div>{partner&&<button className="breeding-analyze" disabled={busy} onClick={analyze}>{busy?t("breeding.analyzing"):t("breeding.analyze")}</button>}</div>
      </div>
      {error&&<div className="desk-error">{error}</div>}
      {result&&<div className={`breeding-result status-${result.status}`}>
        <div className="breeding-primary-result"><small>{t("breeding.projected")}</small><strong>{result.projectedOffspringInbreedingPercent==null?"—":percent(result.projectedOffspringInbreedingPercent,2)}</strong><span>{t("breeding.pedigreeCoi")}</span></div>
        {result.verdict&&<div className={`breeding-verdict v-${result.verdict.classification}${result.verdict.closeMatingWarning?" close-warning":""}`}>
          <b>{localizedAnalysisText(result.verdict.classificationLabel,locale)}<InfoTip label={uiText(locale, "Mating verdict", "حکم تلاقی")} text={uiText(locale, "This label shows how closely related the parents are: outcross means mostly unrelated, linebreeding is moderate relation, and close inbreeding means very close parents. When recorded ancestry is too sparse, an insufficient-ancestry notice replaces the comparative label.", "این برچسب نشان می‌دهد والدین چقدر به هم خویشاوندند: اوت‌کراس یعنی تقریباً بی‌ربط، لاین‌بریدینگ خویشاوندی متوسط، و هم‌خونی نزدیک یعنی والدین خیلی نزدیک‌اند. اگر تبار ثبت‌شده کافی نباشد، به‌جای برچسب مقایسه‌ای «تبار ناکافی» نمایش داده می‌شود.")}/></b>
          {result.verdict.closeMatingWarning&&result.verdict.closeMatingWarningText&&<span role="alert">⚠ {localizedAnalysisText(result.verdict.closeMatingWarningText,locale)}</span>}
          {result.verdict.relationshipKind&&result.verdict.relationshipKind!=="related"&&result.verdict.relationshipKind!=="no_common_ancestor"&&<small>{locale==="fa"?`نوع خویشاوندی ثبت‌شدهٔ والدین: ${relationshipKindLabel(result.verdict.relationshipKind,locale)}`:`Recorded parent relationship: ${relationshipKindLabel(result.verdict.relationshipKind,locale)}`}</small>}
        </div>}
        {result.coiByDepth&&result.coiByDepth.length>1&&<div className="breeding-coi-trend"><small>{uiText(locale, "COI by generation depth (completeness of each estimate)", "روند COI بر اساس عمق نسل‌ها (کامل‌بودن هر برآورد)")}<InfoTip label="COI" text={uiText(locale, "Coefficient of inbreeding: how likely the foal is to inherit two identical copies of a gene, one from each parent. Higher means more inbreeding. Each row uses a deeper generation count; a number that grows with depth means more hidden relatedness inside the pedigree.", "ضریب هم‌خونی: برآورد احتمال آن‌که کره دو نسخهٔ یکسان یک ژن را از هر دو والد بگیرد. هرچه بیشتر، هم‌خونی بیشتر. عدد هر ردیف بر اساس عمق نسل‌های محاسبه‌شده است؛ اگر با عمق بیشتر رقم بزرگ‌تر شود، یعنی خویشاوندی واقعی بیشتری در عمق تبارنامه پنهان است.")}/></small><div>{result.coiByDepth.map(point=><span key={point.depth}><b>{point.inbreedingPercent==null?"—":percent(point.inbreedingPercent,2)}</b><em>G{n(point.depth)}</em><i>{point.pedigreeCompletenessPercent==null?"":percent(point.pedigreeCompletenessPercent,0)}</i></span>)}</div></div>}
        {result.ancestorLoss&&<div className="breeding-avk"><span><small>{uiText(locale, "Sire AVK", "AVK پدر")}</small><b>{result.ancestorLoss.sireAvkPercent==null?"—":percent(result.ancestorLoss.sireAvkPercent,1)}</b></span><span><small>{uiText(locale, "Dam AVK", "AVK مادر")}</small><b>{result.ancestorLoss.damAvkPercent==null?"—":percent(result.ancestorLoss.damAvkPercent,1)}</b></span><span><small>{uiText(locale, "Foal AVK", "AVK فرزند فرضی")}</small><b>{result.ancestorLoss.projectedFoalAvkPercent==null?"—":percent(result.ancestorLoss.projectedFoalAvkPercent,1)}</b></span><small>{uiText(locale, "Ancestor-loss coefficient over 5 generations; the usual norm is at least 85%.", "ضریب از‌دست‌رفتگی نیاکان در ۵ نسل؛ هنجار معمول ≥۸۵٪")}</small></div>}
        <div className="breeding-metrics"><div><small>{t("breeding.relationship")}<InfoTip label={uiText(locale, "Relationship coefficient", "ضریب خویشاوندی")} text={uiText(locale, "How genetically similar the two parents are; 0% means unrelated, 100% would be the same horse.", "چقدر والدین از نظر ژنتیکی شبیه هم هستند؛ ۰٪ یعنی بی‌ربط و ۱۰۰٪ یعنی همان یک اسب!")}/></small><strong>{result.parentalRelationshipPercent==null?"—":percent(result.parentalRelationshipPercent,2)}</strong></div><div><small>{t("breeding.kinship")}<InfoTip label={uiText(locale, "Kinship", "خویشاوندی")} text={uiText(locale, "Half of the relationship coefficient: the chance a random gene copy is identical in both parents.", "نیمِ ضریب خویشاوندی: احتمال آن‌که یک ژن تصادفی از هر دو والد یکسان باشد.")}/></small><strong>{result.parentalKinshipPercent==null?"—":percent(result.parentalKinshipPercent,2)}</strong></div><div className="sire"><small>{t("breeding.sireCoverage")}<InfoTip label={uiText(locale, "Pedigree completeness", "کامل‌بودن تبار")} text={uiText(locale, "How much of the father-side ancestry is actually recorded; a low share means inbreeding numbers can look lower than reality.", "چند درصد از اجداد پدر در سوابق ثبت شده‌اند؛ اگر کم باشد، اعداد هم‌خونی ممکن است کم‌تر از واقع نشان داده شوند.")}/></small><strong>{percent(result.sirePedigreeCompletenessPercent)}</strong></div><div className="dam"><small>{t("breeding.damCoverage")}<InfoTip label={uiText(locale, "Pedigree completeness", "کامل‌بودن تبار")} text={uiText(locale, "How much of the mother-side ancestry is actually recorded; a low share means inbreeding numbers can look lower than reality.", "چند درصد از اجداد مادر در سوابق ثبت شده‌اند؛ اگر کم باشد، اعداد هم‌خونی ممکن است کم‌تر از واقع نشان داده شوند.")}/></small><strong>{percent(result.damPedigreeCompletenessPercent)}</strong></div></div>{result.diversityProjection&&<div className={`breeding-diversity confidence-${result.diversityProjection.confidence.grade}`}><header><span>{uiText(locale, "Projected offspring pedigree diversity", "پیش‌بینی تنوع تبارنامه‌ای فرزند")}</span><b>{result.diversityProjection.confidence.grade}</b></header><div><span><small>{uiText(locale, "Projected completeness", "کامل‌بودن پیش‌بینی‌شده")}</small><strong>{percent(result.diversityProjection.projectedPedigreeCompletenessPercent,1)}</strong></span><span><small>{uiText(locale, "Unique recorded ancestors", "نیاکان یکتای ثبت‌شده")}</small><strong>{n(result.diversityProjection.projectedUniqueRecordedAncestors)}</strong></span><span><small>{uiText(locale, "Repeated positions", "جایگاه تکراری")}</small><strong>{n(result.diversityProjection.projectedRepeatedAncestorPositions)}</strong></span><span><small>{uiText(locale, "Ancestor diversity", "تنوع نیاکان")}</small><strong>{percent(result.diversityProjection.projectedAncestorDiversityPercent,1)}</strong></span><span><small>{uiText(locale, "Shared parent ancestry", "نیاکان مشترک والدین")}</small><strong>{n(result.diversityProjection.sharedRecordedAncestorsBetweenParents)}</strong></span><span><small>{uiText(locale, "Top-5 concentration", "تمرکز ۵ نیای برتر")}</small><strong>{percent(result.diversityProjection.projectedTop5RecordedPathWeightSharePercent,1)}</strong></span></div><details><summary>{uiText(locale, "Projected ancestor contributions", "سهم نیاکان پیش‌بینی‌شده")}</summary>{result.diversityProjection.topProjectedAncestorContributions.map(a=><button key={a.horse.id} onClick={()=>navigate(`/horse/${a.horse.id}`)}><b dir="auto">{horseName(a.horse,locale)}</b><span>{percent(a.shareOfRecordedPathWeightPercent,2)}{a.fromSire&&a.fromDam?` · ${uiText(locale, "both parents", "هر دو والد")}`:""}</span></button>)}<p>{localizedAnalysisText(result.diversityProjection.provenance.interpretation,locale)}</p></details><HeritagePairingScience projection={result.diversityProjection}/></div>}
        {result.commonAncestors.length>0&&<div className="breeding-common"><header><span>{t("breeding.common")}</span><small>{n(result.commonAncestors.length)}</small></header>{result.commonAncestors.map(item=><button key={item.horse.id} onClick={()=>navigate(`/horse/${item.horse.id}`)}><strong dir="auto">{horseName(item.horse,locale)}</strong><span>G{n(item.fromDepth)} ↔ G{n(item.toDepth)}</span></button>)}</div>}
        {result.status!=="ok"&&<p className="breeding-warning">⚠ {t("breeding.integrity")}</p>}
        <ArabianPairingPanel platform={platform} sireId={result.sireId} damId={result.damId} locale={engineUiLocale(locale)} principalScope={principalScope}/>
        <footer>ⓘ {t("breeding.note")} · {t("analytics.algorithm")} {result.provenance.algorithmVersion}</footer>
      </div>}
      <div className="breeding-optimizer h-glass-2"><header><div><small>{uiText(locale, "PEDIGREE DECISION OPTIMIZER", "بهینه‌ساز تصمیم تبارنامه‌ای")}</small><h3>{uiText(locale, "Rank multiple candidates for this horse", "مقایسه چند نامزد برای این اسب")}</h3><p>{uiText(locale, "Candidates are ranked only by explainable recorded-pedigree objectives; this is not genetic merit or performance prediction.", "نامزدها فقط با شاخص‌های تبارنامهٔ ثبت‌شده رتبه‌بندی می‌شوند؛ امتیاز ژنتیکی یا پیش‌بینی عملکرد نیست.")}</p></div><button className="breeding-analyze" disabled={!optimizerCandidates.length||optimizerBusy} onClick={optimize}>{optimizerBusy?(uiText(locale, "Ranking…", "در حال رتبه‌بندی…")):(uiText(locale, "Rank candidates", "رتبه‌بندی نامزدها"))}</button></header><div className="breeding-optimizer-search"><input dir="auto" value={optimizerQuery} onChange={e=>setOptimizerQuery(e.target.value)} placeholder={uiText(locale, "Search candidate name or HorseNo…", "نام یا شماره نامزد را جست‌وجو کنید…")}/>{optimizerOptions.length>0&&<div className="picker-options">{optimizerOptions.map(option=><button key={option.id} onClick={()=>addOptimizerCandidate(option)}><strong dir="auto">{horseName(option,locale)}</strong><span>#{n(option.id)}</span></button>)}</div>}</div><div className="breeding-optimizer-chips">{optimizerCandidates.map(candidate=><button key={candidate.id} onClick={()=>{setOptimizerCandidates(list=>list.filter(x=>x.id!==candidate.id));setOptimizerResult(null)}}><span dir="auto">{horseName(candidate,locale)}</span><small>#{n(candidate.id)}</small><b>×</b></button>)}</div>{optimizerResult&&<div className="breeding-optimizer-results">{optimizerResult.eligibilityWarnings?.map((warning,index)=><p className="breeding-warning" key={`optimizer-warning-${index}`}>⚠ {localizedAnalysisText(warning,locale)}</p>)}{!optimizerResult.ranked.length&&optimizerResult.excludedCandidates?.length?<div className="desk-empty">{uiText(locale, "No candidates remained eligible after role, COI, and pedigree exclusions.", "هیچ نامزدی پس از محدودیت‌های نقش/COI/تبارنامه واجد شرایط نماند.")}</div>:null}<div className="optimizer-head"><span>{uiText(locale, "Rank", "رتبه")}</span><span>{uiText(locale, "Candidate", "نامزد")}</span><span>{uiText(locale, "Adjusted score", "امتیاز تعدیل‌شده")}</span><span>COI</span><span>{uiText(locale, "Diversity", "تنوع")}</span><span>DPI</span><span>{uiText(locale, "Data quality", "کیفیت داده")}</span></div>{optimizerResult.ranked.map(row=><button className={row.rank===1?"rank-best":row.rank<=3?"rank-top":""} key={row.candidate.id} onClick={()=>navigate(`/horse/${row.candidate.id}`)}><b>#{n(row.rank)}</b><span dir="auto"><strong>{horseName(row.candidate,locale)}</strong><small>#{n(row.candidate.id)}</small></span><strong className="metric-score">{n(row.confidenceAdjustedScore)}</strong><span className="metric-coi">{row.projectedOffspringInbreedingPercent==null?"—":percent(row.projectedOffspringInbreedingPercent,2)}</span><span className="metric-diversity">{row.projectedAncestorDiversityPercent==null?"—":percent(row.projectedAncestorDiversityPercent,1)}</span><span className="metric-dpi">{row.candidateDiversityPreservationIndex==null?"—":n(row.candidateDiversityPreservationIndex)}</span><em className={`confidence-${row.confidenceGrade}`}>{confidenceGradeLabel(row.confidenceGrade,locale)}</em></button>)}<footer>{localizedAnalysisText(optimizerResult.provenance.interpretation,locale)}<br/>{localizedAnalysisText(optimizerResult.provenance.caveat,locale)}</footer><HeritageOptimizerScience result={optimizerResult}/></div>}</div>
    </>}
  </section>;
}

export function HeritageClaimPanel({horse,platform,platformMeta,user,permissions}:{horse:HorseRecord;platform:PlatformClient;platformMeta:PlatformMetaResponse|null;user:PlatformUser|null;permissions:PlatformPermission[]}) {
  const {t,n,locale}=useI18n();
  const available=supportsPlatformFeature(platformMeta,"owner_claims");
  const canRead=Boolean(user&&hasPlatformPermission(permissions,"claim.read_own"));
  const canCreate=Boolean(user&&hasPlatformPermission(permissions,"claim.create"));
  const [claim,setClaim]=useState<ClaimRecord|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    if(!available||!canRead){setClaim(null);return;}
    platform.claims.mine().then(value=>setClaim(value.claims.find(item=>item.horse_id===horse.id)??null)).catch(()=>{});
  },[available,canRead,horse.id,platform]);

  const create=async()=>{setBusy(true);setMessage("");try{const value=await platform.claims.create(horse.id,{source:"heritage-registry",locale});setClaim(value.claim);setMessage(t("claims.created"));}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}};

  return <article className="heritage-claim-panel h-glass-2" data-h-surface-role="panel">
    <div><small>{t("claims.eyebrow")}</small><h3>{t("claims.title")}</h3><p>{t("claims.body")}</p></div>
    {!available?<span className="claim-state dormant">{t("desk.dormant")}</span>:claim?<div className="existing-claim"><span>{t("claims.current")}</span><strong className={`claim-status status-${claim.status.toLowerCase()}`}>{claim.status}</strong><small>#{n(horse.id)}</small></div>:!user?<span className="claim-state auth">{t("claims.signIn")}</span>:!canCreate?<span className="claim-state dormant">{t("desk.noPermission")}</span>:<button className="claim-create" disabled={busy} onClick={create}>{busy?t("claims.creating"):t("claims.create")}</button>}
    {message&&<small className="claim-message">{message}</small>}
  </article>;
}
