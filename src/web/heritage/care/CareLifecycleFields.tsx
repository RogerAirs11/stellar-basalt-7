import React from "react";
import type { ClinicalEventInput, ClinicalLifecycleContext, ReproductiveEpisodeInput, StoredReproductiveMaterial } from "../../../contracts/platform";
import { useI18n } from "../../i18n";
import { CareDate, CareField, CareSelect, nullableValue, textValue, useCareText, type CareOption } from "./CareControls";

type CareText = (en: string, fa: string) => string;
export type ClinicalContextKind = "ordinary" | ClinicalLifecycleContext["kind"];
function compatibleClinicalContext(event: ClinicalEventInput["event_type"], kind: ClinicalContextKind) {
  return kind === "ordinary" || (kind === "record_review" ? ["diagnosis", "allergy", "other"] : ["examination", "diagnosis", "procedure", "other"]).includes(event);
}
function sourceStatement(data: FormData, sourceName: string, reasonName: string, L: CareText) {
  const evidence_ref = textValue(data, sourceName); const justification = textValue(data, reasonName);
  if (evidence_ref.length < 3 || evidence_ref.length > 240 || justification.length < 8 || justification.length > 1000) throw new Error(L("An exception needs a source reference (3–240 characters) and an explanation (8–1000 characters).", "برای مورد استثنا، مرجع منبع با ۳ تا ۲۴۰ نویسه و توضیح با ۸ تا ۱۰۰۰ نویسه لازم است."));
  return { evidence_ref, justification };
}
export function clinicalContextInput(data: FormData, event: ClinicalEventInput["event_type"], kind: ClinicalContextKind, L: CareText): ClinicalLifecycleContext | null {
  if (!compatibleClinicalContext(event, kind)) throw new Error(L("The selected event type cannot use this lifecycle context. Correct the event type or explicitly choose an ordinary event.", "نوع رویداد انتخاب‌شده با این زمینه سازگار نیست. نوع رویداد را اصلاح کنید یا صریحاً رویداد عادی را انتخاب کنید."));
  return kind === "ordinary" ? null : { kind, ...sourceStatement(data, "lifecycle_evidence_ref", "lifecycle_justification", L) };
}
export function ClinicalContextFields({ event, kind, onChange, initial }: { event: ClinicalEventInput["event_type"]; kind: ClinicalContextKind; onChange: (kind: ClinicalContextKind) => void; initial?: ClinicalLifecycleContext | null }) {
  const L = useCareText();
  return <section className="care-field-wide care-repeatable"><header><h4>{L("Event context", "زمینه رویداد")}</h4></header><p>{L("Use an exception only for an attributed professional statement with a source. It is not verification and cannot make a vaccination or medication event valid after death.", "مورد استثنا فقط برای اظهار مستند و منتسب به متخصص است. این ثبت به معنی تأیید نیست و واکسیناسیون یا تجویز دارو پس از مرگ را معتبر نمی‌کند.")}</p><div className="care-form-grid">
    <CareSelect name="lifecycle_context_kind" label={L("Physical event or sourced exception", "رویداد فیزیکی یا استثنای مستند")} value={kind} onChange={value => onChange(value as ClinicalContextKind)} options={[["ordinary", "Ordinary physical event", "رویداد فیزیکی عادی"], ["postmortem", "Postmortem examination / procedure", "معاینه / اقدام پس از مرگ"], ["record_review", "Review of existing records", "بررسی سوابق موجود"]]} />
    {!compatibleClinicalContext(event, kind) && <p className="care-notice care-notice-error" role="alert">{L("This context is incompatible with the selected event type. Change one explicitly before saving.", "این زمینه با نوع رویداد انتخاب‌شده سازگار نیست. پیش از ذخیره، یکی را صریحاً تغییر دهید.")}</p>}
    {kind !== "ordinary" && <><CareField name="lifecycle_evidence_ref" label={L("Context source reference", "مرجع منبع زمینه")} value={initial?.evidence_ref} required minLength={3} maxLength={240} /><CareField name="lifecycle_justification" label={L("Professional explanation of this context", "توضیح متخصص درباره این زمینه")} value={initial?.justification} required minLength={8} maxLength={1000} multiline /></>}
  </div></section>;
}

export type StoredMaterialDraft = Omit<StoredReproductiveMaterial, "donor_horse_id"> & { key: string; donor_horse_id: number | null };
export function storedMaterialInput(data: FormData, rows: StoredMaterialDraft[], horseId: number, sire: number | null, recipient: number | null, method: ReproductiveEpisodeInput["method"], L: CareText): StoredReproductiveMaterial[] {
  if (rows.length > 3) throw new Error(L("At most three stored material entries are allowed.", "حداکثر سه مورد ماده ذخیره‌شده مجاز است."));
  const seen = new Set<string>();
  return rows.map(row => {
    const valid = row.material === "semen"
      ? row.donor_horse_id !== null && row.donor_horse_id === sire && ["artificial_insemination", "embryo_transfer", "icsi"].includes(method)
      : row.donor_horse_id === horseId && recipient !== null && (row.material === "embryo" ? ["embryo_transfer", "icsi"].includes(method) : method === "icsi");
    if (!valid) throw new Error(L("Stored semen needs the selected sire and AI, embryo transfer or ICSI. A stored embryo needs the genetic dam, a recipient and transfer/ICSI; an oocyte needs the genetic dam, a recipient and ICSI.", "اسپرم ذخیره‌شده به پدر انتخاب‌شده و روش تلقیح مصنوعی، انتقال جنین یا ICSI نیاز دارد. جنین ذخیره‌شده به مادر ژنتیکی، گیرنده و انتقال یا ICSI؛ اووسیت به مادر ژنتیکی، گیرنده و ICSI نیاز دارد."));
    const identity = `${row.donor_horse_id}:${row.material}`;
    if (seen.has(identity)) throw new Error(L("The same donor and material cannot be listed twice.", "یک اهداکننده و نوع ماده را نمی‌توان دو بار ثبت کرد."));
    seen.add(identity);
    return { donor_horse_id: row.donor_horse_id!, material: row.material, collected_on: nullableValue(data, `material-date-${row.key}`), ...sourceStatement(data, `material-source-${row.key}`, `material-justification-${row.key}`, L) };
  });
}
export function StoredMaterialFields({ rows, onChange, horseId, sireId }: { rows: StoredMaterialDraft[]; onChange: (rows: StoredMaterialDraft[]) => void; horseId: number; sireId: number | null }) {
  const L = useCareText(); const { n } = useI18n();
  const update = (key: string, patch: Partial<StoredMaterialDraft>) => onChange(rows.map(row => row.key === key ? { ...row, ...patch } : row));
  return <section className="care-field-wide care-repeatable"><header><h4>{L("Documented stored material", "ماده ذخیره‌شده مستند")}</h4><span>{n(rows.length)} / {n(3)}</span></header><p>{L("Add only if stored semen, embryos or oocytes were used. Name the donor explicitly and cite the collection/use evidence. Dates remain unknown when not documented. This is a professional statement, not certification; it does not override the recipient's lifecycle or change parentage.", "فقط در صورت استفاده از اسپرم، جنین یا اووسیت ذخیره‌شده اضافه کنید. اهداکننده را صریحاً مشخص و شواهد جمع‌آوری یا استفاده را ذکر کنید. تاریخ بدون سند نامعلوم می‌ماند. این اظهار متخصص است، نه گواهی؛ وضعیت حیات گیرنده یا تبار را تغییر نمی‌دهد.")}</p>
    {rows.map((row, index) => {
      const donors: CareOption[] = [["", "Choose the named donor", "انتخاب اهداکننده نام‌برده"], [String(horseId), `Genetic dam #${n(horseId)}`, `مادر ژنتیکی #${n(horseId)}`]];
      if (sireId !== null && sireId !== horseId) donors.push([String(sireId), `Selected sire #${n(sireId)}`, `پدر انتخاب‌شده #${n(sireId)}`]);
      if (row.donor_horse_id !== null && row.donor_horse_id !== horseId && row.donor_horse_id !== sireId) donors.push([String(row.donor_horse_id), `Previously recorded donor #${n(row.donor_horse_id)} — check current roles`, `اهداکننده قبلی #${n(row.donor_horse_id)}؛ نقش فعلی را بررسی کنید`]);
      return <fieldset className="care-repeat-row" key={row.key}><legend>{L("Stored material", "ماده ذخیره‌شده")} {n(index + 1)}</legend><div className="care-form-grid">
        <CareSelect name={`material-kind-${row.key}`} label={L("Material type", "نوع ماده")} value={row.material} onChange={value => update(row.key, { material: value as StoredReproductiveMaterial["material"] })} options={[["semen", "Semen (selected genetic sire)", "اسپرم (پدر ژنتیکی انتخاب‌شده)"], ["embryo", "Embryo (profile genetic dam)", "جنین (مادر ژنتیکی پروفایل)"], ["oocyte", "Oocyte (profile genetic dam)", "اووسیت (مادر ژنتیکی پروفایل)"]]} />
        <CareSelect name={`material-donor-${row.key}`} label={L("Named donor", "اهداکننده نام‌برده")} value={row.donor_horse_id === null ? "" : String(row.donor_horse_id)} onChange={value => update(row.key, { donor_horse_id: value ? Number(value) : null })} options={donors} />
        <CareDate name={`material-date-${row.key}`} label={L("Documented collection date", "تاریخ جمع‌آوری مستند")} value={row.collected_on} />
        <CareField name={`material-source-${row.key}`} label={L("Collection / use source reference", "مرجع جمع‌آوری / استفاده")} value={row.evidence_ref} required minLength={3} maxLength={240} />
        <CareField name={`material-justification-${row.key}`} label={L("Professional explanation of stored material use", "توضیح متخصص درباره استفاده از ماده ذخیره‌شده")} value={row.justification} required minLength={8} maxLength={1000} multiline />
      </div><button type="button" className="care-text-button" onClick={() => onChange(rows.filter(item => item.key !== row.key))}>{L("Remove this stored material entry", "حذف این مورد ماده ذخیره‌شده")}</button></fieldset>;
    })}
    <button type="button" disabled={rows.length >= 3} onClick={() => onChange([...rows, { key: crypto.randomUUID(), donor_horse_id: null, material: "semen", collected_on: null, evidence_ref: "", justification: "" }])}>{L("Add stored material source", "افزودن منبع ماده ذخیره‌شده")}</button>
  </section>;
}
