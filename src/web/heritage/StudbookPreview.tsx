import { uiText } from "../../shared/uiLocale";
import { horseSexKind, horseSexLabel } from "../../frontend-kit/horseDisplay";
import React from "react";
import type { HorseRecord } from "../../contracts/platform";
import { useI18n } from "../i18n";

type Props = {
  horses: HorseRecord[];
  total: number;
  offset: number;
  loading?: boolean;
  onOpenHorse?: (horseNo: number) => void;
};

const FA_BREED: Record<string, string> = {
  arabian: "عرب",
  arab: "عرب",
  "arabian horse": "عرب",
  "partbred arabian": "دورگه عرب",
  "half arabian": "نیمه‌عرب",
  thoroughbred: "تروبرد",
};

const FA_COLOR: Record<string, string> = {
  bay: "کهر",
  "dark bay": "کهر تیره",
  chestnut: "کرنگ",
  gray: "خاکستری",
  grey: "خاکستری",
  black: "سیاه",
  white: "سفید",
  roan: "ابرش",
  palomino: "طلایی",
};

function sexClass(value?: string | null): "male" | "female" | "neutral" {
  const kind=horseSexKind(value);
  return kind === "male" || kind === "female" ? kind : "neutral";
}
function faSex(value?: string | null): string { return horseSexLabel(value,"fa"); }

function faSexMark(value?: string | null): string {
  const kind = sexClass(value);
  return kind === "female" ? "م" : kind === "male" ? "ن" : "·";
}

function localizedValue(value: string | null | undefined, kind: "breed" | "color"): string {
  if (!value) return "—";
  const map = kind === "breed" ? FA_BREED : FA_COLOR;
  return map[value.trim().toLowerCase()] || value;
}

function faParent(horse: HorseRecord, relation: "sire" | "dam"): string {
  if (relation === "sire") return horse.father_name_native || horse.father_name || (horse.father_id ? String(horse.father_id) : "—");
  return horse.mother_name_native || horse.mother_name || (horse.mother_id ? String(horse.mother_id) : "—");
}

function breeder(horse: HorseRecord): string {
  return horse.breeder_name_native || horse.breeder_name || "—";
}

function latinName(horse: HorseRecord): string {
  return horse.name_latin || "—";
}

function nativeName(horse: HorseRecord): string {
  return horse.name_native || horse.name_latin || `#${horse.id}`;
}

function identityNumber(horse: HorseRecord): string {
  return horse.life_number || horse.uel_no || horse.horse_sr_no || "—";
}

function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, digit => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function printStudbook() {
  const body = document.body;
  body.classList.add("studbook-print-active");
  const cleanup = () => body.classList.remove("studbook-print-active");
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1200);
}

function StudbookRecord({ horse, onOpenHorse }: { horse: HorseRecord; onOpenHorse?: (horseNo: number) => void }) {
  const kind = sexClass(horse.sex_desc);
  const openProps = onOpenHorse ? { role: "button" as const, tabIndex: 0, onClick: () => onOpenHorse(horse.id), onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") onOpenHorse(horse.id); } } : {};
  return <article className={`studbook-record sex-${kind}`} {...openProps}>
    <div className="studbook-record-main">
      <div className="studbook-identity">
        <strong className="studbook-name-fa" dir="rtl">{nativeName(horse)}</strong>
        <strong className="studbook-name-en" dir="ltr">{latinName(horse)}</strong>
      </div>
      <div className="studbook-facts">
        <div><small>محل تولد</small><b dir="auto">{horse.birth_place_desc || "—"}</b></div>
        <div><small>رنگ</small><b dir="auto">{localizedValue(horse.color_desc, "color")}</b></div>
        <div><small>سال تولد</small><b>{horse.birth_year ? toFaDigits(horse.birth_year) : "—"}</b></div>
        <div><small>نژاد</small><b dir="auto">{localizedValue(horse.breed_desc, "breed")}</b></div>
      </div>
      <div className="studbook-parents">
        <div className="studbook-parent sire"><small>پدر</small><b dir="auto">{faParent(horse, "sire")}</b><em>{horse.father_id ? toFaDigits(horse.father_id) : ""}</em></div>
        <div className="studbook-parent dam"><small>مادر</small><b dir="auto">{faParent(horse, "dam")}</b><em>{horse.mother_id ? toFaDigits(horse.mother_id) : ""}</em></div>
      </div>
      <div className="studbook-refs">
        <div><small>پرورش‌دهنده</small><span dir="auto">{breeder(horse)}</span></div>
        <div><small>شماره UELN</small><span dir="ltr">{identityNumber(horse)}</span></div>
        <div><small>شماره ثبت</small><span dir="ltr">{horse.register_no || "—"}</span></div>
      </div>
    </div>
    <aside className="studbook-index">
      <span className="studbook-sex-mark"><i>{faSexMark(horse.sex_desc)}</i></span>
      <span className="studbook-sex-word">{faSex(horse.sex_desc)}</span>
      <span className="studbook-horse-label">شماره اسب</span>
      <span className="studbook-horse-no">{toFaDigits(horse.id)}</span>
    </aside>
  </article>;
}

export function StudbookPreview({ horses, total, offset, loading = false, onOpenHorse }: Props) {
  const { locale } = useI18n();
  const pageHorses = horses.slice(0, 22);
  const right = pageHorses.slice(0, 11);
  const left = pageHorses.slice(11, 22);
  const pageNumber = Math.floor(offset / 22) + 1;
  const first = total > 0 ? offset + 1 : 0;
  const last = Math.min(offset + pageHorses.length, total);

  return <section className="studbook-preview-shell" aria-label={uiText(locale, "Printed studbook preview", "پیش‌نمایش دفتر چاپی")}>
    <div className="studbook-preview-toolbar">
      <div><strong>{uiText(locale, "V8 printed studbook preview", "پیش‌نمایش چاپی V8")}</strong><span>{uiText(locale, "22 horses per page · live data from the current registry filter", "۲۲ اسب در هر صفحه · دادهٔ زنده از فیلتر فعلی سامانه ثبت")}</span></div>
      <button type="button" className="ghost studbook-print-button" onClick={printStudbook}><span aria-hidden="true">⎙</span>{uiText(locale, "Print / Save PDF", "چاپ / ذخیره PDF")}</button>
    </div>
    <div className="studbook-preview-stage">
      <div className="studbook-print-sheet" dir="rtl">
        <header className="studbook-page-header">
          <div className="studbook-page-number">صفحه {toFaDigits(pageNumber)}</div>
          <div className="studbook-title-block"><small>دفتر رسمی ثبت نژاد · نسخه چاپی فارسی</small><h2>دفتر ثبت اسب عرب</h2><p>بخش الف · ثبت اصلی · آرایش فشرده و خوانا</p></div>
          <div className="studbook-edition"><b>جلد ۱</b><span>نسخه پیش‌نمایش</span></div>
        </header>
        <div className="studbook-page-meta"><strong>رکوردهای {toFaDigits(first)} تا {toFaDigits(last)}</strong><span><i className="male"/>سیلمی <i className="female"/>مادیان</span></div>
        <div className="studbook-columns">
          <div className="studbook-column right">{right.map(horse => <StudbookRecord key={horse.id} horse={horse} onOpenHorse={onOpenHorse} />)}</div>
          <div className="studbook-column left">{left.map(horse => <StudbookRecord key={horse.id} horse={horse} onOpenHorse={onOpenHorse} />)}</div>
        </div>
        <footer className="studbook-page-footer"><span>نسخه فارسی · صفحه {toFaDigits(pageNumber)}</span><span>{toFaDigits(pageHorses.length)} رکورد در این صفحه · از مجموع {toFaDigits(total)}</span></footer>
        {loading && <div className="studbook-loading">در حال به‌روزرسانی صفحه…</div>}
      </div>
    </div>
  </section>;
}
