import { kitText, kitIsRtl, kitNumberTag, type EngineLocale } from "./domain/engineText";
import React from "react";
import type { PlatformClient, VariantEvidenceStatus } from "../contracts/platform";
import { useDomainResource } from "./domain/useDomainResource";
import "./ArabianPairingPanel.css";

/** Presentational evidence panel shared by native skins; the server alone
 * authorizes, resolves and calculates evidence. Never infer genotype in the UI.
 */
export function ArabianPairingPanel({ platform, sireId, damId, locale, principalScope }: {
  platform: PlatformClient; sireId: number; damId: number; locale: EngineLocale; principalScope: string;
}) {
  const L = (en: string, fa: string) => kitText(locale, en, fa);
  const resource = useDomainResource("arabian-variant-evidence", `${principalScope}:${sireId}:${damId}`,
    signal => platform.breeding.pairingEvidence(sireId, damId, { signal }));
  const report = resource.state.phase === "ready" || resource.state.phase === "reloading" ? resource.state.data : null;
  const failed = resource.state.phase === "error" || resource.state.phase === "forbidden" || resource.state.phase === "unavailable";
  const labels: Record<VariantEvidenceStatus, string> = {
    missing: L("No reviewed result", "نتیجهٔ بررسی‌شده‌ای ثبت نشده"),
    unverified: L("Review required", "نیازمند بررسی"),
    uninterpreted: L("Result is inconclusive", "نتیجه قابل تفسیر نیست"),
    conflict: L("Results disagree", "نتایج با هم سازگار نیستند"),
    resolved: L("Reviewed genotype", "ژنوتیپ بررسی‌شده"),
  };
  const percent = (value: number) => new Intl.NumberFormat(kitNumberTag(locale), { style: "percent", maximumFractionDigits: 1 }).format(value);
  return <section className="registry-variant-evidence" dir={kitIsRtl(locale) ? "rtl" : "ltr"} aria-label={L("Arabian variant evidence", "شواهد واریانت‌های اسب عرب")}>
    <header><h3>{L("Genetic evidence for this pairing", "شواهد ژنتیکی این جفت")}</h3><p>{L("Each estimate concerns one specified variant and one conception. Missing evidence stays unknown.", "هر برآورد مربوط به یک واریانت مشخص و یک لقاح است. نبودِ شواهد به معنی نامشخص‌بودن نتیجه است.")}</p></header>
    {!report && !failed && <p role="status">{L("Loading reviewed evidence…", "در حال دریافت شواهد بررسی‌شده…")}</p>}
    {resource.state.phase === "reloading" && <p role="status">{L("Refreshing evidence; the previous result is shown below.", "در حال تازه‌سازی شواهد؛ نتیجهٔ قبلی در زیر نمایش داده می‌شود.")}</p>}
    {failed && <div role="alert"><p>{L("Genetic evidence could not be loaded. The pedigree comparison remains available.", "دریافت شواهد ژنتیکی ناموفق بود. مقایسهٔ تبارنامه همچنان در دسترس است.")}</p><button type="button" onClick={resource.retry}>{L("Try again", "تلاش دوباره")}</button></div>}
    {report && <>
      {report.syntheticEvidence && <p className="registry-variant-demo" role="note">{L("Fictional demonstration evidence. No actual laboratory result is claimed.", "این شواهد برای نمایش ساخته شده‌اند و نتیجهٔ واقعی آزمایشگاه نیستند.")}</p>}
      <div className="registry-variant-grid">{report.variants.map(variant => <article key={variant.variant} className="registry-variant-card">
        <header><strong><bdi>{variant.variant}</bdi></strong><a href={variant.source} target="_blank" rel="noopener noreferrer">{L("Test scope", "دامنهٔ آزمون")}</a></header>
        <dl className="registry-variant-parents"><div><dt>{L("Sire", "پدر")} <bdi>#{sireId}</bdi></dt><dd>{labels[variant.parentA.status]}</dd></div><div><dt>{L("Dam", "مادر")} <bdi>#{damId}</bdi></dt><dd>{labels[variant.parentB.status]}</dd></div></dl>
        {variant.probabilities ? <div className="registry-variant-probabilities" aria-label={L("Genotype probabilities per conception", "احتمال ژنوتیپ در هر لقاح")}>
          {[variant.probabilities.zeroVariantCopies,variant.probabilities.oneVariantCopy,variant.probabilities.twoVariantCopies].map((value,index) => <div key={index}><b>{percent(value)}</b><small>{index === 0 ? L("0 copies", "۰ نسخه") : index === 1 ? L("1 copy", "۱ نسخه") : L("2 copies", "۲ نسخه")}</small></div>)}
        </div> : <p className="registry-variant-unknown">{L("Insufficient evidence for an estimate", "شواهد کافی برای برآورد وجود ندارد")}</p>}
      </article>)}</div>
      {Object.values(report.excludedEvidence).some(parent => Object.values(parent).some(value => value > 0)) && <p className="registry-variant-note">{L("Only current, explicitly mapped, reviewed records contribute. Unmapped, withdrawn, expired or changed evidence is excluded.", "فقط رکوردهای بررسی‌شده با نگاشت مشخص و معتبر در محاسبه به کار می‌روند. شواهد بدون نگاشت، پس‌گرفته‌شده، منقضی یا تغییرکرده کنار گذاشته می‌شوند.")}</p>}
      <footer>{L("These are genotype probabilities, not a health guarantee or breeding approval. OAAM1 covers only the tested variant and does not rule out other forms of OAAM. Review original reports with an equine genetics specialist.", "این اعداد احتمال ژنوتیپ‌اند؛ تضمین سلامت یا تأیید جفت‌گیری نیستند. OAAM1 فقط واریانت آزموده‌شده را پوشش می‌دهد و سایر شکل‌های OAAM را رد نمی‌کند. گزارش‌های اصلی را با متخصص ژنتیک اسب بررسی کنید.")}</footer>
    </>}
  </section>;
}
