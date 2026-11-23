import { horseSexKind, horseSexLabel } from "../../../frontend-kit";
import type { ReactNode } from "react";
import type { HorseRecord } from "../../../frontend-kit";
import { horseName, lifecycle, visibleCoverage } from "./adapter";
import { num, t, year, type ClassicLocale } from "./i18n";

export function Icon({ name }: { name: "horse" | "person" | "search" | "tree" | "chart" | "place" | "shield" | "login" | "arrow" | "download" | "home" }) {
  const paths: Record<string, ReactNode> = {
    horse: <><path d="M6 20c.5-3 2-5 5-6l-1-4 3-5 5 2-2 4 2 3-2 6"/><path d="M10 10 6 8 4 11l3 3"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/></>, search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    tree: <><path d="M12 4v5M6 20v-4h12v4M6 16v-4h12v4M12 9v3"/><circle cx="12" cy="3" r="1.5"/><circle cx="6" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/></>,
    chart: <><path d="M4 20V10M10 20V5M16 20v-8M22 20H2"/></>, place: <><path d="M12 22s7-7 7-13a7 7 0 1 0-14 0c0 6 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></>,
    shield: <path d="M12 3 20 6v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Z"/>, login: <><path d="M14 4h6v16h-6M4 12h11M11 8l4 4-4 4"/></>,
    arrow: <path d="m8 5 7 7-7 7"/>, download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></>,
    home: <><path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10.5V19h11v-8.5"/></>,
  };
  return <svg className="fc-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="fc-page-title fei-page-title"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{action&&<div className="fc-title-action fei-page-title-right">{action}</div>}</div>;
}

export function Section({ title, children, tone = "purple", action }: { title: string; children: ReactNode; tone?: "purple" | "orange" | "plain"; action?: ReactNode }) {
  return <section className={`fc-section fei-panel fc-section-${tone}`}><header><h2>{title}</h2>{action}</header><div className="fc-section-body">{children}</div></section>;
}

export function StatePanel({ status, error, empty, locale }: { status: string; error?: string | null; empty?: string; locale: ClassicLocale }) {
  if (status === "loading") return <div className="fc-state"><span className="fc-spinner"/>{t(locale,"Loading canonical Horse DB data…","در حال دریافت اطلاعات…")}</div>;
  if (status === "error") return <div className="fc-state fc-state-error"><b>{t(locale,"Data unavailable","داده در دسترس نیست")}</b><span dir="auto">{error}</span></div>;
  return <div className="fc-state">{empty ?? t(locale,"No records found.","رکوردی یافت نشد.")}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "active" | "dead" | "imported" | "sire" | "dam" | "warning" | "danger" | "purple" }) {
  return <span className={`fc-badge fc-badge-${tone}`}>{children}</span>;
}

/* R64 visual encoding: sex identity chip (coloured dot + label). The dot is
   shown while the shared visual-encoding preference is on — see
   fei-visual-encoding.css + the [data-encoding] mirror in entry.tsx. */
export function SexChip({ sex, locale }: { sex: string; locale: ClassicLocale }) {
  const kind = horseSexKind(sex);
  const cls = kind === "male" ? "fei-sex-stallion" : kind === "female" ? "fei-sex-mare" : kind === "gelding" ? "fei-sex-gelding" : "";
  return <span className={`fei-sex-chip ${cls}`} dir="auto"><bdi>{horseSexLabel(sex, locale)}</bdi></span>;
}

export function HorseStatusBadges({ horse, locale }: { horse: HorseRecord; locale: ClassicLocale }) {
  const life = lifecycle(horse);
  return <div className="fc-badges">
    <Badge tone={life === "active" ? "active" : life === "deceased" ? "dead" : "neutral"}>{life === "active" ? t(locale,"Active","فعال") : life === "deceased" ? t(locale,"Deceased","تلف‌شده") : life === "inactive" ? t(locale,"Inactive","غیرفعال") : t(locale,"Unknown","نامشخص")}</Badge>
    {horse.is_imported===1&&<Badge tone="imported">{t(locale,"Imported","وارداتی")}</Badge>}
    {horse.dna_status&&<Badge tone="purple">DNA: <bdi>{horse.dna_status}</bdi></Badge>}
    {horse.passport_date&&<Badge>{t(locale,"Passport","گذرنامه")}</Badge>}
  </div>;
}

export function HorseRow({ horse, locale, onOpen }: { horse: HorseRecord; locale: ClassicLocale; onOpen: () => void }) {
  const coverage = visibleCoverage(horse);
  return <tr className="fc-click-row" onClick={onOpen} tabIndex={0} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen();}}}>
    <td className="fc-id"><bdi>{horse.id}</bdi></td>
    <td><strong dir="auto">{horseName(horse, locale)}</strong>{locale==="fa"&&horse.name_latin&&<small className="fc-secondary" dir="ltr">{horse.name_latin}</small>}<HorseStatusBadges horse={horse} locale={locale}/></td>
    <td>{horse.register_no?<bdi>{horse.register_no}</bdi>:"—"}</td><td>{horse.sex_desc?<SexChip sex={horse.sex_desc} locale={locale}/>:"—"}</td><td>{horse.breed_desc||"—"}</td><td>{year(horse.birth_year,locale)}</td><td>{horse.birth_place_desc||"—"}</td>
    <td><div className="fc-parent fc-parent-sire"><span>{t(locale,"Sire","پدر")}</span><b dir="auto">{horse.father_name||"—"}</b></div><div className="fc-parent fc-parent-dam"><span>{t(locale,"Dam","مادر")}</span><b dir="auto">{horse.mother_name||"—"}</b></div></td>
    <td><div className="fc-meter"><span style={{width:`${coverage}%`}}/><b>{num(coverage,locale)}%</b></div></td>
  </tr>;
}

export function Metric({ label, value, note, tone="purple" }: { label: string; value: ReactNode; note?: string; tone?: "purple"|"orange"|"blue"|"green"|"gray" }) {
  return <div className={`fc-metric fc-metric-${tone}`}><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</div>;
}
