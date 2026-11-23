import { uiText } from "../../shared/uiLocale";
import { toAsciiDigits } from "../../shared/numerals";
export { toAsciiDigits } from "../../shared/numerals";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeRequestRecord,
  HorseRecord,
  HorseSubmission,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
  PersonSummary,
  RegistryDateInput,
} from "../../contracts/platform";
import { hasPlatformPermission, supportsPlatformFeature } from "../../frontend-kit";
import { useI18n } from "../i18n";
import { parseRegistryDate } from "../../registry/dates";
import { SubmissionEvidencePanel } from "./SubmissionEvidencePanel";
import { forgetSubmissionDraft, readSubmissionDraft, rememberSubmissionDraft, setSubmissionDraftPrincipal } from "./submissionDraftMemory";
import "../styles/heritage.submission.css";

/**
 * Master-Ai plan T11: the public new-horse submission workflow.
 *
 * Owners register a horse without SQL and without an editor re-typing it:
 * native-only names are fine (Latin is optional), parents are picked from the
 * EXISTING registry through search or explicitly marked unresolved (never
 * auto-created from free text), and the request travels the
 * draft -> pending -> needs_changes -> approved/rejected state machine with a
 * per-client idempotency key so a double click cannot double-submit.
 *
 * R143-C02 (Master-AI plan): the page is a RESUMABLE workflow with explicit
 * steps — identity -> parents -> people & evidence -> review. Drafts can save
 * at every step (and must save before file/evidence work). The stepper survives
 * in-tab navigation through account-bound memory; private content is never
 * written to browser storage. The
 * parent step offers IN-PLACE registry lookup (search results you can click)
 * instead of copying a numeric id from another tab. Unresolved parent claims
 * are preserved as source assertions — the workflow never invents canonical
 * horses.
 */

interface ParentPick {
  mode: "id" | "unresolved" | "none";
  horse_id: string;
  unresolved_name: string;
  unresolved_note: string;
}

interface SubmissionFormState {
  name_native: string;
  name_latin: string;
  register_no: string;
  microchip_no: string;
  passport_no: string;
  passport_issuer: string;
  passport_issue_value: string;
  passport_issue_precision: RegistryDateInput["precision"];
  passport_issue_calendar: RegistryDateInput["calendar"];
  passport_expiry_value: string;
  passport_expiry_precision: RegistryDateInput["precision"];
  passport_expiry_calendar: RegistryDateInput["calendar"];
  uel_no: string;
  life_number: string;
  foreign_registration_no: string;
  foreign_registration_issuer: string;
  birth_name: string;
  previous_names: string;
  life_status: NonNullable<HorseSubmission["life_status"]>;
  height_cm: string;
  markings: string;
  birth_year: string;
  birth_date_value: string;
  birth_date_precision: string;
  birth_date_calendar: string;
  death_date_value: string;
  death_date_precision: RegistryDateInput["precision"];
  death_date_calendar: RegistryDateInput["calendar"];
  birth_place_desc: string;
  birth_city: string;
  birth_province: string;
  keeping_city: string;
  keeping_province: string;
  breed_desc: string;
  sex_desc: string;
  color_desc: string;
  main_strain_desc: string;
  sub_strain_desc: string;
  description: string;
  reviewer_note: string;
  breeder_person_id: string;
  current_owner_person_id: string;
}

const EMPTY_FORM: SubmissionFormState = {
  name_native: "", name_latin: "", register_no: "", microchip_no: "", birth_year: "",
  passport_no: "", passport_issuer: "", passport_issue_value: "", passport_issue_precision: "day", passport_issue_calendar: "gregorian",
  passport_expiry_value: "", passport_expiry_precision: "day", passport_expiry_calendar: "gregorian",
  uel_no: "", life_number: "", foreign_registration_no: "", foreign_registration_issuer: "", birth_name: "", previous_names: "",
  life_status: "unknown", height_cm: "", markings: "",
  birth_date_value: "", birth_date_precision: "year", birth_date_calendar: "gregorian",
  death_date_value: "", death_date_precision: "year", death_date_calendar: "gregorian",
  birth_place_desc: "", birth_city: "", birth_province: "", keeping_city: "", keeping_province: "",
  breed_desc: "", sex_desc: "", color_desc: "", main_strain_desc: "",
  sub_strain_desc: "", description: "", reviewer_note: "", breeder_person_id: "", current_owner_person_id: "",
};

const EMPTY_PARENT: ParentPick = { mode: "none", horse_id: "", unresolved_name: "", unresolved_note: "" };

// R143-C03: Persian (۰-۹) and Arabic-Indic (٠-٩) digits are normalized to
// ASCII BEFORE validation/filtering. The old /[^0-9]/g stripper silently
// deleted Persian keystrokes, so an owner typing «۱۴۰۰» into the birth-year
// field got an empty value instead of 1400.
const digitsOnly = (value: string) => toAsciiDigits(value).replace(/[^0-9]/g, "");
export const normalizeRegistrationDateValue = (value: string) => toAsciiDigits(value.trim()).replace(/[\/／]/g, "-");

interface UnsavedDraft {
  form: SubmissionFormState;
  father: ParentPick;
  mother: ParentPick;
  fatherIsNative: boolean;
  motherIsNative: boolean;
  activeDraftId: string | null;
  step: number;
  idempotencyKey: string;
  pendingCreate: { submission: HorseSubmission; evidence?: Record<string, unknown>; key: string } | null;
  privateEvidence?: Record<string, unknown>;
  /** R148 Task 5: the content_revision the restored form loaded at. */
  draftRevision?: number | null;
}

const STEP_COUNT = 4;
const mintIdempotencyKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

type SubmissionPageProps = {
  platform: PlatformClient; platformMeta: PlatformMetaResponse | null; user: PlatformUser | null;
  permissions: PlatformPermission[]; navigate: (path: string) => void;
};

export function HorseSubmissionPage(props: SubmissionPageProps) {
  return <HorseSubmissionForm key={props.user?.id ?? "anonymous"} {...props} />;
}

function HorseSubmissionForm({
  platform,
  platformMeta,
  user,
  permissions,
  navigate,
}: SubmissionPageProps) {
  const { t, n, locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));

  const initialDraft = useRef(readSubmissionDraft<UnsavedDraft>(user?.id ?? null));
  const [form, setForm] = useState<SubmissionFormState>(() => ({ ...EMPTY_FORM, ...initialDraft.current?.form }));
  const [father, setFather] = useState<ParentPick>(() => ({ ...EMPTY_PARENT, ...initialDraft.current?.father }));
  const [mother, setMother] = useState<ParentPick>(() => ({ ...EMPTY_PARENT, ...initialDraft.current?.mother }));
  const [fatherIsNative, setFatherIsNative] = useState(initialDraft.current?.fatherIsNative ?? false);
  const [motherIsNative, setMotherIsNative] = useState(initialDraft.current?.motherIsNative ?? false);
  const [mine, setMine] = useState<ChangeRequestRecord[]>([]);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  // R143-C03: after a successful submit the page shows the explicit
  // "register another horse" confirmation instead of silently reusing the
  // (now pending) request as the edit target.
  const [justSubmitted, setJustSubmitted] = useState(false);
  // R143-C02: the resumable workflow step (0 = identity .. 3 = review).
  const [step, setStep] = useState(initialDraft.current?.step ?? 0);
  const [dirty, setDirty] = useState(Boolean(initialDraft.current));
  const [idempotencyKey, setIdempotencyKey] = useState(initialDraft.current?.idempotencyKey ?? mintIdempotencyKey());
  const pendingCreate = useRef(initialDraft.current?.pendingCreate ?? null);
  // R148 Task 5: tracks the content_revision the currently-open draft form was
  // loaded at; sent as expected_content_revision on every draft edit.
  const draftRevisionRef = useRef<number | null>(initialDraft.current?.draftRevision ?? null);
  const privateEvidence = useRef<Record<string, unknown>>(initialDraft.current?.privateEvidence ?? {});
  const commandBusy = useRef(false);
  const evidenceBusyRef = useRef(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const handleEvidenceBusy = React.useCallback((value: boolean) => { evidenceBusyRef.current = value; setEvidenceBusy(value); }, []);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSubmissionDraftPrincipal(user?.id ?? null); }, [user?.id]);
  const [viewEvidenceRequestId, setViewEvidenceRequestId] = useState<string | null>(null);

  const changesAvailable = supportsPlatformFeature(platformMeta, "change_requests");
  const canCreate = Boolean(user && hasPlatformPermission(permissions, "change.create"));
  const canReadMine = Boolean(user && hasPlatformPermission(permissions, "change.read_own"));

  // Draft round-trip: after needs_changes the submitter edits this draft in place.
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialDraft.current?.activeDraftId ?? null);

  // R143-C03: restore unsaved form state (from a parent/person lookup
  // navigation) BEFORE the mine() response can hydrate an older draft — the
  // restore wins, otherwise typed-but-unsaved data would be clobbered.
  // restoredUnsavedRef records whether a saved unsaved draft EXISTED, so the
  // server-draft hydrate still runs on a normal first visit.
  const restoredUnsavedRef = useRef(Boolean(initialDraft.current));
  const markEdited = () => { restoredUnsavedRef.current = true; setDirty(true); setJustSubmitted(false); };

  useEffect(() => {
    // The two select defaults (precision/calendar) are not user input —
    // an untouched form is empty even though they carry "year"/"gregorian".
    const touched = Object.entries(form)
      .filter(([key]) => !key.endsWith("_precision") && !key.endsWith("_calendar") && key !== "life_status")
      .some(([, value]) => String(value).trim() !== "");
    const parentsTouched = father.mode !== "none" || mother.mode !== "none";
    const isEmpty = activeDraftId == null && !parentsTouched && !touched && form.life_status === "unknown";
    if (isEmpty) forgetSubmissionDraft(user?.id ?? null);
    else rememberSubmissionDraft(user?.id ?? null,
      { form, father, mother, fatherIsNative, motherIsNative, activeDraftId, step, idempotencyKey, pendingCreate: pendingCreate.current, privateEvidence: privateEvidence.current, draftRevision: draftRevisionRef.current } satisfies UnsavedDraft);
  }, [form, father, mother, fatherIsNative, motherIsNative, activeDraftId, step, idempotencyKey, busy, user?.id]);

  const resetForm = () => {
    setForm(EMPTY_FORM); setFather(EMPTY_PARENT); setMother(EMPTY_PARENT);
    setFatherIsNative(false); setMotherIsNative(false);
    setActiveDraftId(null);
    draftRevisionRef.current = null;
    setStep(0);
    restoredUnsavedRef.current = true;
    pendingCreate.current = null;
    privateEvidence.current = {};
    setIdempotencyKey(mintIdempotencyKey());
    setDirty(false);
    forgetSubmissionDraft(user?.id ?? null);
  };

  const hydrateForm = (submission: HorseSubmission, evidence?: Record<string, unknown> | null) => {
    privateEvidence.current = evidence ?? {};
    setForm({
      name_native: submission.name_native ?? "",
      name_latin: submission.name_latin ?? "",
      register_no: submission.register_no ?? "",
      microchip_no: submission.microchip_no ?? "",
      passport_no: submission.passport_no ?? "", passport_issuer: submission.passport_issuer ?? "",
      passport_issue_value: submission.passport_issue_date?.value ?? "", passport_issue_precision: submission.passport_issue_date?.precision ?? "day", passport_issue_calendar: submission.passport_issue_date?.calendar ?? "gregorian",
      passport_expiry_value: submission.passport_expiry?.value ?? "", passport_expiry_precision: submission.passport_expiry?.precision ?? "day", passport_expiry_calendar: submission.passport_expiry?.calendar ?? "gregorian",
      uel_no: submission.uel_no ?? "", life_number: submission.life_number ?? "", foreign_registration_no: submission.foreign_registration_no ?? "", foreign_registration_issuer: submission.foreign_registration_issuer ?? "",
      birth_name: submission.birth_name ?? "", previous_names: submission.previous_names?.join("\n") ?? "", life_status: submission.life_status ?? "unknown",
      height_cm: submission.height_cm == null ? "" : String(submission.height_cm), markings: submission.markings ?? "",
      birth_year: submission.birth_year != null ? String(submission.birth_year) : "",
      birth_date_value: submission.birth_date?.value ?? "",
      birth_date_precision: submission.birth_date?.precision ?? "year",
      birth_date_calendar: submission.birth_date?.calendar ?? "gregorian",
      death_date_value: submission.death_date?.value ?? "",
      death_date_precision: submission.death_date?.precision ?? "year",
      death_date_calendar: submission.death_date?.calendar ?? "gregorian",
      birth_place_desc: submission.birth_place_desc ?? "",
      birth_city: submission.birth_city ?? "",
      birth_province: submission.birth_province ?? "",
      keeping_city: submission.keeping_city ?? "",
      keeping_province: submission.keeping_province ?? "",
      breed_desc: submission.breed_desc ?? "",
      sex_desc: submission.sex_desc ?? "",
      color_desc: submission.color_desc ?? "",
      main_strain_desc: submission.main_strain_desc ?? "",
      sub_strain_desc: submission.sub_strain_desc ?? "",
      description: submission.description ?? "",
      reviewer_note: typeof evidence?.reviewer_note === "string" ? evidence.reviewer_note : "",
      breeder_person_id: submission.breeder_person_id != null ? String(submission.breeder_person_id) : "",
      current_owner_person_id: submission.current_owner_person_id != null ? String(submission.current_owner_person_id) : "",
    });
    setFather(submission.father_horse_id != null
      ? { ...EMPTY_PARENT, mode: "id", horse_id: String(submission.father_horse_id) }
      : submission.father_unresolved
        ? { ...EMPTY_PARENT, mode: "unresolved", unresolved_name: submission.father_unresolved.name_native ?? submission.father_unresolved.name_latin ?? "", unresolved_note: submission.father_unresolved.note ?? "" }
        : EMPTY_PARENT);
    setFatherIsNative(Boolean(submission.father_unresolved?.name_native));
    setMother(submission.mother_horse_id != null
      ? { ...EMPTY_PARENT, mode: "id", horse_id: String(submission.mother_horse_id) }
      : submission.mother_unresolved
        ? { ...EMPTY_PARENT, mode: "unresolved", unresolved_name: submission.mother_unresolved.name_native ?? submission.mother_unresolved.name_latin ?? "", unresolved_note: submission.mother_unresolved.note ?? "" }
        : EMPTY_PARENT);
    setMotherIsNative(Boolean(submission.mother_unresolved?.name_native));
  };

  const mineGeneration = useRef(0);
  const reloadMine = React.useCallback((hydrate = false) => {
    const generation = ++mineGeneration.current;
    if (!changesAvailable || !canReadMine) { setMine([]); return; }
    platform.changes.mine().then((value) => {
      if (!mounted.current || generation !== mineGeneration.current) return;
      const submissions = value.requests.filter((request) => request.request_type === "create_horse");
      setMine(submissions);
      setListError("");
      // R143-C03: never hydrate an older server draft over data the owner
      // just restored from an interrupted lookup session (a saved unsaved
      // draft wins; a normal first visit still hydrates the server draft).
      const draft = submissions.find((request) => request.status === "draft");
      if (hydrate && draft?.submission && !restoredUnsavedRef.current) {
        setActiveDraftId(draft.id);
        draftRevisionRef.current = Number.isFinite(draft.content_revision) ? draft.content_revision! : null;
        hydrateForm(draft.submission, draft.evidence);
        setDirty(false);
        restoredUnsavedRef.current = true;
      }
    }).catch((cause) => { if (mounted.current && generation === mineGeneration.current) setListError((cause as Error).message); });
  }, [platform, changesAvailable, canReadMine]);

  useEffect(() => { reloadMine(true); }, [reloadMine]);

  const birthYearError = (rawYear: string): string | null => {
    if (!rawYear.trim()) return null;
    const year = Number(toAsciiDigits(rawYear.trim()));
    if (!Number.isSafeInteger(year) || year < 1500 || year > new Date().getUTCFullYear() + 1) {
      // R143-C03: a year like ۱۴۰۲ is a plausible Solar Hijri year (≈2023
      // Gregorian) — the registry stores Gregorian years, so reject it with
      // an honest bilingual hint instead of a bare "not valid".
      if (Number.isSafeInteger(year) && year >= 1100 && year <= 1500) {
        return L(`Birth year ${year} looks like a Solar Hijri year (≈ ${year + 621} Gregorian). This field expects a Gregorian year — for exact dates use the date field with the Solar Hijri calendar below.`, `سال تولد ${year} ظاهراً هجری شمسی است (≈ ${year + 621} میلادی). این فیلد سال میلادی می‌پذیرد — برای تاریخ دقیق از فیلد تاریخ با تقویم هجری شمسی استفاده کنید.`);
      }
      return L("Birth year is not valid.", "سال تولد معتبر نیست.");
    }
    return null;
  };

  const parentStepError = (label: "father" | "mother", pick: ParentPick): string | null => {
    if (pick.mode === "id") {
      const id = Number(toAsciiDigits(pick.horse_id.trim()));
      if (!Number.isSafeInteger(id) || id <= 0) return L(`The selected ${label === "father" ? "sire" : "dam"} number is not valid.`, `شماره ${label === "father" ? "پدر" : "مادر"} معتبر نیست.`);
    } else if (pick.mode === "unresolved") {
      if (!pick.unresolved_name.trim()) return L(`The unresolved ${label === "father" ? "sire" : "dam"} needs a name.`, `نام ${label === "father" ? "پدر" : "مادر"} نامشخص الزامی است.`);
    }
    return null;
  };

  const buildSubmission = (): { submission: HorseSubmission } | { error: string } => {
    if (!form.name_native.trim() && !form.name_latin.trim()) {
      return { error: L("Enter at least one name (native or Latin).", "حداقل یک نام (فارسی یا لاتین) وارد کنید.") };
    }
    const submission: HorseSubmission = { life_status: form.life_status };
    if (form.name_native.trim()) submission.name_native = form.name_native.trim();
    if (form.name_latin.trim()) submission.name_latin = form.name_latin.trim();
    if (form.register_no.trim()) submission.register_no = toAsciiDigits(form.register_no.trim());
    if (form.microchip_no.trim()) submission.microchip_no = toAsciiDigits(form.microchip_no.trim());
    if (form.passport_no.trim() && form.passport_issuer.trim().length < 2) return { error: L("Enter the issuing authority for this passport.", "مرجع صادرکننده این گذرنامه را وارد کنید.") };
    if (form.foreign_registration_no.trim() && form.foreign_registration_issuer.trim().length < 2) return { error: L("Enter the issuing authority for the foreign registration number.", "مرجع صادرکننده شماره ثبت خارجی را وارد کنید.") };
    for (const key of ["passport_no", "uel_no", "life_number", "foreign_registration_no"] as const) {
      if (form[key].trim()) submission[key] = toAsciiDigits(form[key].trim());
    }
    for (const key of ["passport_issuer", "foreign_registration_issuer", "birth_name", "markings"] as const) {
      if (form[key].trim()) submission[key] = form[key].trim();
    }
    const names = [...new Set(form.previous_names.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    if (names.length > 30 || names.some(value => value.length > 200)) return { error: L("Enter up to 30 previous names, each at most 200 characters.", "حداکثر ۳۰ نام قبلی، هرکدام تا ۲۰۰ نویسه وارد کنید.") };
    submission.previous_names = names;
    if (form.height_cm.trim()) {
      const height = Number(toAsciiDigits(form.height_cm).replace(/٫/g, "."));
      if (!Number.isFinite(height) || height < 30 || height > 250) return { error: L("Height must be between 30 and 250 centimetres.", "قد باید بین ۳۰ و ۲۵۰ سانتی‌متر باشد.") };
      submission.height_cm = height;
    }
    for (const [field, prefix] of [["passport_issue_date", "passport_issue"], ["passport_expiry", "passport_expiry"]] as const) {
      if (form[`${prefix}_value`].trim()) submission[field] = { value: normalizeRegistrationDateValue(form[`${prefix}_value`]), precision: form[`${prefix}_precision`], calendar: form[`${prefix}_calendar`] };
    }
    const yearError = birthYearError(form.birth_year);
    if (yearError) return { error: yearError };
    if (form.birth_year.trim()) submission.birth_year = Number(toAsciiDigits(form.birth_year.trim()));
    // T12: the typed birth date keeps its precision and calendar — a year-only
    // date is stored as a year, never an invented January 1.
    if (form.birth_date_value.trim()) {
      submission.birth_date = {
        value: normalizeRegistrationDateValue(form.birth_date_value),
        precision: form.birth_date_precision as RegistryDateInput["precision"],
        calendar: form.birth_date_calendar as RegistryDateInput["calendar"],
      };
    }
    if (form.life_status === "dead" && form.death_date_value.trim()) submission.death_date = { value: normalizeRegistrationDateValue(form.death_date_value), precision: form.death_date_precision, calendar: form.death_date_calendar };
    for (const [label, date, maximum] of [[L("Birth date", "تاریخ تولد"), submission.birth_date, new Date().getUTCFullYear() + 1], [L("Death date", "تاریخ تلف"), submission.death_date, new Date().getUTCFullYear()], [L("Passport issue date", "تاریخ صدور گذرنامه"), submission.passport_issue_date, 2300], [L("Passport expiry date", "تاریخ انقضای گذرنامه"), submission.passport_expiry, 2300]] as const) {
      if (date && !parseRegistryDate(date, maximum).ok) return { error: L(`${label}: enter a valid date for the selected calendar and precision.`, `${label}: تاریخ معتبر با تقویم و دقت انتخاب‌شده وارد کنید.`) };
    }
    for (const [key, value] of Object.entries({
      birth_place_desc: form.birth_place_desc, birth_city: form.birth_city, birth_province: form.birth_province,
      keeping_city: form.keeping_city, keeping_province: form.keeping_province,
      breed_desc: form.breed_desc, sex_desc: form.sex_desc,
      color_desc: form.color_desc, main_strain_desc: form.main_strain_desc, sub_strain_desc: form.sub_strain_desc, description: form.description,
    })) if (value.trim()) (submission as Record<string, unknown>)[key] = value.trim();
    for (const [label, pick] of [["father", father] as const, ["mother", mother] as const]) {
      const stepError = parentStepError(label, pick);
      if (stepError) return { error: stepError };
      if (pick.mode === "id") {
        (submission as Record<string, unknown>)[`${label}_horse_id`] = Number(toAsciiDigits(pick.horse_id.trim()));
      } else if (pick.mode === "unresolved") {
        const assertion: Record<string, unknown> = {};
        assertion[label === "father" ? (fatherIsNative ? "name_native" : "name_latin") : (motherIsNative ? "name_native" : "name_latin")] =
          label === "father" ? father.unresolved_name.trim() : mother.unresolved_name.trim();
        if (pick.unresolved_note.trim()) assertion.note = pick.unresolved_note.trim();
        (submission as Record<string, unknown>)[`${label}_unresolved`] = assertion;
      }
    }
    for (const [key, value] of Object.entries({ breeder_person_id: form.breeder_person_id, current_owner_person_id: form.current_owner_person_id })) {
      if (!value.trim()) continue;
      const id = Number(toAsciiDigits(value.trim()));
      if (!Number.isSafeInteger(id) || id <= 0) return { error: L("A person reference is not a valid registry number.", "شماره فرد معتبر نیست.") };
      (submission as Record<string, unknown>)[key] = id;
    }
    return { submission };
  };

  const acknowledgeSubmit = () => {
    resetForm();
    setJustSubmitted(true);
    setMessage(L("Submission sent for review.", "درخواست برای بررسی ارسال شد."));
  };

  // Always create a draft first. A lost create response retains its original
  // payload/key; a retry recovers that same draft before applying newer edits.
  // Files and the final submit therefore always belong to a known request.
  const save = async (submit: boolean): Promise<string | null> => {
    if (!canCreate || commandBusy.current || evidenceBusyRef.current) return null;
    const built = buildSubmission();
    if ("error" in built) { setStep(0); setErrorText(built.error); return null; }
    commandBusy.current = true;
    setBusy(true); setMessage(""); setErrorText("");
    restoredUnsavedRef.current = true;
    let requestId = activeDraftId;
    try {
      const submission = built.submission;
      const evidence = { ...privateEvidence.current, reviewer_note: form.reviewer_note.trim() || null };
      if (!requestId) {
        pendingCreate.current ??= { submission, evidence, key: idempotencyKey };
        const intent = pendingCreate.current;
        const created = await platform.changes.create({ request_type: "create_horse", submission: intent.submission, evidence: intent.evidence, idempotency_key: intent.key, submit: false });
        if (!mounted.current) return null;
        requestId = created.request.id;
        if (created.request.status !== "draft") {
          if (submit && (created.request.status === "pending" || created.request.status === "approved")) { acknowledgeSubmit(); reloadMine(); return requestId; }
          throw new Error(L("This request has already left draft status. Open its current status from your submissions.", "این درخواست دیگر پیش‌نویس نیست. وضعیت فعلی آن را در درخواست‌های خود ببینید."));
        }
        setActiveDraftId(requestId);
        draftRevisionRef.current = Number.isFinite(created.request.content_revision) ? created.request.content_revision! : null;
        pendingCreate.current = null;
        setIdempotencyKey(mintIdempotencyKey());
        if (JSON.stringify(intent.submission) !== JSON.stringify(submission) || JSON.stringify(intent.evidence) !== JSON.stringify(evidence)) {
          const edited = await platform.changes.update(requestId, { expected_content_revision: draftRevisionRef.current!, submission, evidence });
          draftRevisionRef.current = Number.isFinite(edited.request.content_revision) ? edited.request.content_revision! : draftRevisionRef.current;
        }
      } else {
        // R148 Task 5: the draft edit contract — the revision this form loaded
        // at must still be current, or the server answers 409
        // content_revision_conflict with the current version.
        if (draftRevisionRef.current == null) {
          throw new Error(L("This draft was opened before its current version. Refresh the page to load the latest draft, then save again.", "این پیش‌نویس پیش از نسخه فعلی آن باز شده است. صفحه را تازه‌سازی کنید تا آخرین پیش‌نویس بارگذاری شود، سپس دوباره ذخیره کنید."));
        }
        const edited = await platform.changes.update(requestId, { expected_content_revision: draftRevisionRef.current, submission, evidence });
        draftRevisionRef.current = Number.isFinite(edited.request.content_revision) ? edited.request.content_revision! : draftRevisionRef.current;
      }
      if (!mounted.current) return null;
      if (submit) {
        const submitted = await platform.changes.submit(requestId);
        if (!mounted.current) return null;
        if (submitted.request.status !== "pending" && submitted.request.status !== "approved") throw new Error(L("The request has not entered review. Check its current status before retrying.", "درخواست هنوز وارد مرحله بررسی نشده است. پیش از تلاش دوباره وضعیت فعلی را بررسی کنید."));
        acknowledgeSubmit();
      } else {
        privateEvidence.current = evidence;
        setDirty(false);
        setMessage(L("Draft saved to your account.", "پیش‌نویس در حساب شما ذخیره شد."));
      }
      reloadMine();
      return requestId;
    } catch (cause) {
      if (!mounted.current) return null;
      // A successful final submission may have lost its HTTP response. Read
      // the actual server state before leaving a pending request as editable.
      if (submit && requestId) {
        try {
          const refreshed = await platform.changes.mine();
          if (!mounted.current) return null;
          const recorded = refreshed.requests.find(request => request.id === requestId);
          if (recorded && (recorded.status === "pending" || recorded.status === "approved")) {
            setMine(refreshed.requests.filter(request => request.request_type === "create_horse"));
            acknowledgeSubmit();
            return requestId;
          }
        } catch { /* Keep the exact draft and retry identity below. */ }
      }
      setErrorText(cause instanceof Error ? cause.message : L("The save could not be confirmed. Your input is preserved in this tab; retry the save.", "ذخیره تأیید نشد. اطلاعات در این برگه حفظ شده است؛ دوباره ذخیره کنید."));
      return null;
    } finally { commandBusy.current = false; if (mounted.current) setBusy(false); }
  };

  const withdraw = async () => {
    if (!activeDraftId || commandBusy.current || evidenceBusyRef.current) return;
    commandBusy.current = true;
    setBusy(true); setMessage(""); setErrorText("");
    try {
      await platform.changes.withdraw(activeDraftId);
      if (!mounted.current) return;
      resetForm();
      setMessage(L("Submission withdrawn.", "درخواست پس گرفته شد."));
      reloadMine();
    } catch (cause) { if (mounted.current) setErrorText((cause as Error).message); } finally { commandBusy.current = false; if (mounted.current) setBusy(false); }
  };

  // R143-C02: step navigation — Next validates the current step honestly and
  // blocks with the same bilingual error text the reviewer would raise.
  const validateStep = (index: number): string | null => {
    if (index === 0) {
      if (!form.name_native.trim() && !form.name_latin.trim()) {
        return L("Enter at least one name (native or Latin).", "حداقل یک نام (فارسی یا لاتین) وارد کنید.");
      }
      const built = buildSubmission();
      return "error" in built ? built.error : null;
    }
    if (index === 1) {
      return parentStepError("father", father) ?? parentStepError("mother", mother);
    }
    if (index === 2) {
      for (const value of [form.breeder_person_id, form.current_owner_person_id]) {
        if (!value.trim()) continue;
        const id = Number(toAsciiDigits(value.trim()));
        if (!Number.isSafeInteger(id) || id <= 0) return L("A person reference is not a valid registry number.", "شماره فرد معتبر نیست.");
      }
    }
    return null;
  };

  const goToStep = (index: number) => {
    if (busy || evidenceBusy) return;
    setMessage(""); setErrorText("");
    if (index > step) {
      for (let cursor = step; cursor < index; cursor += 1) {
        const problem = validateStep(cursor);
        if (problem) { setStep(cursor); setErrorText(problem); return; }
      }
    }
    setStep(index);
  };

  const nextStep = () => {
    if (busy || evidenceBusy) return;
    const problem = validateStep(step);
    if (problem) { setErrorText(problem); return; }
    setErrorText("");
    setStep((value) => Math.min(STEP_COUNT - 1, value + 1));
  };

  const statusLabel = (request: ChangeRequestRecord) => {
    const status = request.review_status ?? request.status;
    return workflowStatus(status, locale);
  };

  const STEPS: Array<readonly [string, string]> = [
    [L("Identity", "هویت"), L("Names, numbers, birth", "نام‌ها، شماره‌ها، تولد")],
    [L("Parents", "والدین"), L("Sire and dam of the horse", "پدر و مادر اسب")],
    [L("People & evidence", "افراد و شواهد"), L("Breeder, owner, notes", "پرورش‌دهنده، مالک، یادداشت‌ها")],
    [L("Review", "بازبینی"), L("Check and submit", "بررسی و ارسال")],
  ];

  const stepChips = <nav className="submission-steps" aria-label={L("Registration steps", "مراحل ثبت")}>
    {STEPS.map(([title, hint], index) => <button
      key={title} type="button"
      className={`submission-step${index === step ? " current" : ""}${index < step ? " done" : ""}`}
      aria-current={index === step ? "step" : undefined}
      disabled={busy || evidenceBusy}
      title={hint}
      onClick={() => goToStep(index)}>
      <b>{n(index + 1)}</b><span>{title}</span>
    </button>)}
  </nav>;

  // R143-C02: in-place parent lookup — search the registry while filling the
  // form instead of copying a number from another tab. Results come from the
  // same public search the browse page uses; nothing is created implicitly.
  const parentHorseLookup = (label: "father" | "mother", pick: ParentPick, setPick: React.Dispatch<React.SetStateAction<ParentPick>>) =>
    <ParentHorseLookup platform={platform} locale={locale} n={n} L={L} navigate={navigate} label={label} pick={pick} setPick={setPick} />;

  const parentFields = (label: "father" | "mother", pick: typeof father, setPick: React.Dispatch<React.SetStateAction<typeof father>>, isNative: boolean, setNative: (value: boolean) => void) => {
    const title = label === "father" ? L("Sire", "پدر") : L("Dam", "مادر");
    return <fieldset className="submission-parent">
      <legend>{title}</legend>
      <div className="submission-parent-modes">
        <label><input type="radio" name={`${label}-mode`} checked={pick.mode === "none"} onChange={() => setPick(EMPTY_PARENT)} />{L("Unknown / not stated", "نامشخص / ذکر نشده")}</label>
        <label><input type="radio" name={`${label}-mode`} checked={pick.mode === "id"} onChange={() => setPick({ ...EMPTY_PARENT, mode: "id" })} />{L("Existing registry horse", "اسب موجود در سامانه")}</label>
        <label><input type="radio" name={`${label}-mode`} checked={pick.mode === "unresolved"} onChange={() => setPick({ ...EMPTY_PARENT, mode: "unresolved" })} />{L("Unresolved (source assertion)", "نامشخص (استناد منبع)")}</label>
      </div>
      {pick.mode === "id" && parentHorseLookup(label, pick, setPick)}
      {pick.mode === "unresolved" && <div className="submission-parent-unresolved">
        <input dir="auto" placeholder={L("Name as written in the source", "نام مطابق منبع")} value={pick.unresolved_name} onChange={(event) => setPick({ ...pick, unresolved_name: event.target.value })} />
        <label className="submission-native-toggle"><input type="checkbox" checked={isNative} onChange={(event) => setNative(event.target.checked)} />{L("The name is in Persian script", "نام با خط فارسی است")}</label>
        <textarea dir="auto" placeholder={L("Where does this come from? (studbook page, breeder statement…)", "منبع این اطلاعات چیست؟ (صفحه کتاب ثبت، اظهار پرورش‌دهنده…)") } value={pick.unresolved_note} onChange={(event) => setPick({ ...pick, unresolved_note: event.target.value })} />
      </div>}
    </fieldset>;
  };

  const reviewRows = useMemo<Array<readonly [string, string]>>(() => {
    const rows: Array<readonly [string, string]> = [];
    const add = (label: string, value: string) => { if (value.trim()) rows.push([label, value]); };
    add(L("Name (Persian)", "نام (فارسی)"), form.name_native);
    add(L("Name (Latin)", "نام لاتین"), form.name_latin);
    add(L("Registry number", "شماره ثبت"), form.register_no);
    add(L("Microchip", "میکروچیپ"), form.microchip_no);
    add(L("Birth name", "نام بدو تولد"), form.birth_name);
    add(L("Previous names", "نام‌های قبلی"), form.previous_names);
    add(L("Passport number", "شماره گذرنامه"), form.passport_no);
    add(L("Passport issuer", "صادرکننده گذرنامه"), form.passport_issuer);
    add(L("Passport issue date", "تاریخ صدور گذرنامه"), form.passport_issue_value ? `${form.passport_issue_value} · ${L(form.passport_issue_calendar === "solar_hijri" ? "Solar Hijri" : "Gregorian", form.passport_issue_calendar === "solar_hijri" ? "هجری شمسی" : "میلادی")}` : "");
    add(L("Passport expiry date", "تاریخ انقضای گذرنامه"), form.passport_expiry_value ? `${form.passport_expiry_value} · ${L(form.passport_expiry_calendar === "solar_hijri" ? "Solar Hijri" : "Gregorian", form.passport_expiry_calendar === "solar_hijri" ? "هجری شمسی" : "میلادی")}` : "");
    add("UELN", form.uel_no);
    add(L("Life number", "شماره مادام‌العمر"), form.life_number);
    add(L("Foreign registration number", "شماره ثبت خارجی"), form.foreign_registration_no);
    add(L("Foreign registry issuer", "مرجع ثبت خارجی"), form.foreign_registration_issuer);
    add(L("Height (cm)", "قد (سانتی‌متر)"), form.height_cm);
    add(L("Markings", "نشانه‌های ظاهری"), form.markings);
    add(L("Life status", "وضعیت حیات"), lifeStatusLabel(form.life_status, locale));
    if (form.life_status === "dead") add(L("Death date", "تاریخ تلف"), form.death_date_value ? `${form.death_date_value} (${precisionLabel(form.death_date_precision, locale)} · ${L(form.death_date_calendar === "solar_hijri" ? "Solar Hijri" : "Gregorian", form.death_date_calendar === "solar_hijri" ? "هجری شمسی" : "میلادی")})` : "");
    add(L("Birth year", "سال تولد"), form.birth_year);
    add(L("Birth date", "تاریخ تولد"),
      form.birth_date_value ? `${form.birth_date_value} (${precisionLabel(form.birth_date_precision, locale)} · ${L(form.birth_date_calendar === "solar_hijri" ? "Solar Hijri" : "Gregorian", form.birth_date_calendar === "solar_hijri" ? "هجری شمسی" : "میلادی")})` : "");
    add(L("Birth place", "محل تولد"), form.birth_place_desc);
    add(L("Birth city / province", "شهر / استان تولد"), [form.birth_city, form.birth_province].filter(Boolean).join(" / "));
    add(L("Keeping city / province", "شهر / استان نگهداری"), [form.keeping_city, form.keeping_province].filter(Boolean).join(" / "));
    add(L("Sex", "جنسیت"), form.sex_desc);
    add(L("Color", "رنگ"), form.color_desc);
    add(L("Breed", "نژاد"), form.breed_desc);
    add(L("Main strain", "شاخه اصلی"), form.main_strain_desc);
    add(L("Sub strain", "شاخه فرعی"), form.sub_strain_desc);
    add(L("Breeder person no.", "شماره پرورش‌دهنده"), form.breeder_person_id);
    add(L("Current owner person no.", "شماره مالک فعلی"), form.current_owner_person_id);
    add(L("Public profile description", "توضیح عمومی پرونده"), form.description);
    add(L("Private notes for the reviewer", "یادداشت خصوصی برای بررسی‌کننده"), form.reviewer_note);
    for (const [label, pick, isNative] of [["father", father, fatherIsNative], ["mother", mother, motherIsNative]] as const) {
      const title = label === "father" ? L("Sire", "پدر") : L("Dam", "مادر");
      if (pick.mode === "id" && pick.horse_id) rows.push([title, `${L("Registry horse", "اسب سامانه")} #${pick.horse_id}`]);
      if (pick.mode === "unresolved" && pick.unresolved_name.trim()) {
        rows.push([title, `${L("Unresolved source assertion", "استناد منبع نامشخص")}: ${pick.unresolved_name}${pick.unresolved_note.trim() ? ` — ${pick.unresolved_note}` : ""}${isNative ? ` (${L("Persian script", "خط فارسی")})` : ""}`]);
      }
    }
    return rows;
  }, [form, father, mother, fatherIsNative, motherIsNative, locale]);

  const field = (label: string, key: keyof SubmissionFormState, options: { dir?: "ltr" | "rtl" | "auto"; maxLength?: number; inputMode?: "text" | "numeric" | "decimal"; placeholder?: string } = {}) => <label>{label}<input dir={options.dir ?? "auto"} maxLength={options.maxLength ?? 200} inputMode={options.inputMode} placeholder={options.placeholder} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>;
  const dateField = (label: string, prefix: "birth_date" | "death_date" | "passport_issue" | "passport_expiry") => <RegistrationDateField label={label} value={form[`${prefix}_value`]} precision={form[`${prefix}_precision`] as RegistryDateInput["precision"]} calendar={form[`${prefix}_calendar`] as RegistryDateInput["calendar"]} onChange={value => setForm(current => ({ ...current, [`${prefix}_value`]: value.value, [`${prefix}_precision`]: value.precision, [`${prefix}_calendar`]: value.calendar }))} />;

  const identityStep = <>
    <section className="submission-field-group">
      <h3>{L("Names & identity", "نام‌ها و هویت")}</h3>
      <p>{L("At least one name is required. Leave unknown details blank.", "حداقل یک نام لازم است. اطلاعات نامشخص را خالی بگذارید.")}</p>
      <div>{field(L("Name (Persian)", "نام (فارسی)"), "name_native", { dir: "rtl" })}{field(L("Name (Latin, optional)", "نام لاتین (اختیاری)"), "name_latin", { dir: "ltr" })}</div>
      <div>{field(L("Birth name (if different)", "نام بدو تولد (اگر متفاوت است)"), "birth_name")}<label>{L("Previous names — one per line", "نام‌های قبلی — هر نام در یک خط")}<textarea dir="auto" rows={2} maxLength={6030} value={form.previous_names} onChange={event => setForm(current => ({ ...current, previous_names: event.target.value }))} /></label></div>
      <div>{field(L("Registry number", "شماره ثبت"), "register_no", { dir: "ltr", maxLength: 120 })}{field(L("Microchip", "میکروچیپ"), "microchip_no", { dir: "ltr", maxLength: 120 })}</div>
    </section>
    <section className="submission-field-group">
      <h3>{L("Passport & external identifiers", "گذرنامه و شناسه‌های دیگر")}</h3>
      <p>{L("Record the issuing authority along with each passport or foreign registration number.", "مرجع صادرکننده را همراه شماره گذرنامه یا ثبت خارجی وارد کنید.")}</p>
      <div>{field(L("Passport number", "شماره گذرنامه"), "passport_no", { dir: "ltr", maxLength: 120 })}{field(L("Passport issuer", "مرجع صادرکننده گذرنامه"), "passport_issuer")}</div>
      {dateField(L("Passport issue date (optional)", "تاریخ صدور گذرنامه (اختیاری)"), "passport_issue")}
      {dateField(L("Passport expiry date (optional)", "تاریخ انقضای گذرنامه (اختیاری)"), "passport_expiry")}
      <div>{field("UELN", "uel_no", { dir: "ltr", maxLength: 120 })}{field(L("Life number", "شماره مادام‌العمر"), "life_number", { dir: "ltr", maxLength: 120 })}</div>
      <div>{field(L("Foreign registration number", "شماره ثبت خارجی"), "foreign_registration_no", { dir: "ltr", maxLength: 120 })}{field(L("Foreign registry issuer", "مرجع ثبت خارجی"), "foreign_registration_issuer")}</div>
    </section>
    <section className="submission-field-group">
      <h3>{L("Birth & location", "تولد و محل نگهداری")}</h3>
      <div><label>{L("Birth year (Gregorian, optional)", "سال تولد (میلادی، اختیاری)")}<input inputMode="numeric" dir="ltr" maxLength={4} value={form.birth_year} onChange={event => setForm(current => ({ ...current, birth_year: digitsOnly(event.target.value) }))} /><small>{L("For a Solar Hijri year, use the dated field and select its calendar below.", "برای سال هجری شمسی، از فیلد تاریخ با تقویم شمسی استفاده کنید.")}</small></label>{field(L("Birth place", "محل تولد"), "birth_place_desc")}</div>
      {dateField(L("Birth date (optional; retain its recorded precision)", "تاریخ تولد (اختیاری؛ با دقت ثبت‌شده)"), "birth_date")}
      <div>{field(L("Birth city", "شهر تولد"), "birth_city")}{field(L("Birth province", "استان تولد"), "birth_province")}</div>
      <div>{field(L("Current keeping city", "شهر نگهداری فعلی"), "keeping_city")}{field(L("Current keeping province", "استان نگهداری فعلی"), "keeping_province")}</div>
    </section>
    <section className="submission-field-group">
      <h3>{L("Description & life status", "مشخصات و وضعیت حیات")}</h3>
      <div><label>{L("Sex", "جنسیت")}<select value={form.sex_desc} onChange={event => setForm(current => ({ ...current, sex_desc: event.target.value }))}><option value="">{L("Unknown / not recorded", "نامشخص / ثبت نشده")}</option><option value="male">{L("Male / stallion", "نر / سیلمی")}</option><option value="female">{L("Female / mare", "ماده / مادیان")}</option><option value="gelding">{L("Gelding", "اخته")}</option>{form.sex_desc && !["male","female","gelding"].includes(form.sex_desc) && <option value={form.sex_desc}>{form.sex_desc}</option>}</select></label>{field(L("Color (recorded appearance)", "رنگ (ظاهر ثبت‌شده)"), "color_desc", { maxLength: 80 })}</div>
      <div>{field(L("Breed", "نژاد"), "breed_desc", { maxLength: 120 })}<label>{L("Life status", "وضعیت حیات")}<select value={form.life_status} onChange={event => setForm(current => ({ ...current, life_status: event.target.value as SubmissionFormState["life_status"] }))}>{(["unknown","alive","dead","missing"] as const).map(value => <option key={value} value={value}>{lifeStatusLabel(value, locale)}</option>)}</select></label></div>
      {form.life_status === "dead" && <>{dateField(L("Death date (optional; retain its recorded precision)", "تاریخ تلف (اختیاری؛ با دقت ثبت‌شده)"), "death_date")}<p className="submission-step-hint">{L("Leave the death date blank when unknown. A year or month is kept at that precision; an exact day is never inferred.", "اگر تاریخ تلف نامعلوم است خالی بگذارید. سال یا ماه با همان دقت حفظ می‌شود؛ روز دقیق حدس زده نمی‌شود.")}</p></>}
      <div>{field(L("Main strain", "شاخه اصلی"), "main_strain_desc")}{field(L("Sub strain", "شاخه فرعی"), "sub_strain_desc")}</div>
      {field(L("Height at withers (cm, optional)", "قد تا جدوگاه (سانتی‌متر، اختیاری)"), "height_cm", { inputMode: "decimal", dir: "ltr", maxLength: 6 })}
      <label>{L("Distinctive markings", "نشانه‌های ظاهری متمایز")}<textarea dir="auto" rows={3} maxLength={2000} value={form.markings} onChange={event => setForm(current => ({ ...current, markings: event.target.value }))} /></label>
    </section>
  </>;

  const peopleStep = <>
    <PersonLookup platform={platform} label={L("Breeder (optional)", "پرورش‌دهنده (اختیاری)")} value={form.breeder_person_id} onChange={value => { markEdited(); setForm(current => ({ ...current, breeder_person_id: value })); }} />
    <PersonLookup platform={platform} label={L("Current owner (optional)", "مالک فعلی (اختیاری)")} value={form.current_owner_person_id} onChange={value => { markEdited(); setForm(current => ({ ...current, current_owner_person_id: value })); }} />
    <p className="submission-step-hint">{L("Selecting a person records a proposed relationship. Registry review and access authorization are separate decisions.", "انتخاب فرد، یک رابطه پیشنهادی را ثبت می‌کند. بررسی ثبت و اعطای دسترسی تصمیم‌های جداگانه‌اند.")}</p>
    <label>{L("Public profile description (optional)", "توضیح عمومی پرونده (اختیاری)")}<textarea dir="auto" maxLength={4000} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /><small>{L("This description may appear on the horse's profile after approval. Keep private information out of it.", "این توضیح ممکن است پس از پذیرش در پرونده اسب نمایش داده شود. اطلاعات خصوصی را در آن ننویسید.")}</small></label>
    <label>{L("Private notes for the reviewer (source context, unresolved parents)", "یادداشت خصوصی برای بررسی‌کننده (منابع، والدین نامشخص)")}<textarea dir="auto" maxLength={4000} rows={4} value={form.reviewer_note} onChange={event => setForm(current => ({ ...current, reviewer_note: event.target.value }))} /></label>
    {activeDraftId ? <SubmissionEvidencePanel key={activeDraftId} platform={platform} requestId={activeDraftId} onBusyChange={handleEvidenceBusy} disabled={busy || evidenceBusy} /> : <section className="submission-evidence"><h3>{L("Attach private supporting documents", "افزودن مدارک پشتیبان خصوصی")}</h3><p>{L("Save this draft to your account first. Then attach passport scans, identity photos or reports to this specific request.", "ابتدا پیش‌نویس را در حساب خود ذخیره کنید؛ سپس گذرنامه، عکس شناسایی یا گزارش را به همین درخواست پیوست کنید.")}</p><button type="button" disabled={busy || evidenceBusy} onClick={() => void save(false)}>{L("Save draft to attach files", "ذخیره پیش‌نویس و افزودن پیوست")}</button></section>}
  </>;

  const reviewStep = <>
    <dl className="submission-review-grid">
      {reviewRows.map(([label, value]) => <div key={label} className="submission-review-row">
        <dt>{label}</dt><dd dir="auto">{value}</dd>
      </div>)}
      {reviewRows.length === 0 && <div className="submission-review-row"><dt>{L("Nothing entered yet", "هنوز چیزی وارد نشده")}</dt><dd /></div>}
    </dl>
    {activeDraftId && <SubmissionEvidencePanel key={`review:${activeDraftId}`} platform={platform} requestId={activeDraftId} readOnly />}
    <p className="submission-step-hint">{L("Review the details above, then submit for registry review or keep editing. Submission does not itself establish official identity, ownership or parentage.", "جزئیات بالا را بازبینی کنید؛ سپس برای بررسی ارسال کنید یا به ویرایش ادامه دهید. ارسال درخواست به‌تنهایی تأیید رسمی هویت، مالکیت یا نسب نیست.")}</p>
  </>;

  const onFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < STEP_COUNT - 1) { nextStep(); return; }
    void save(true);
  };

  return <main className="page heritage-desk-page submission-page">
    <section className="premium-page-head heritage-desk-head" data-h-surface-role="major">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule" />{L("New-horse submission", "ثبت اسب جدید")}</div>
        <h1>{L("Register a horse", "ثبت یک اسب")}</h1>
        <p>{L("Submit a new horse for registry review. Pick its parents from the existing registry or record them as unresolved source assertions — parent profiles are never created automatically.", "اسب جدید را برای بررسی ثبت ارائه کنید. والدین را از سامانه موجود انتخاب کنید یا به‌عنوان استناد منبع نامشخص ثبت کنید — پرونده والدین هرگز خودکار ساخته نمی‌شود.")}</p>
      </div>
    </section>

    {!changesAvailable
      ? <div className="desk-dormant-note">{t("desk.unsupported")}</div>
      : !user
        ? <div className="desk-auth-note"><span>{t("desk.signInBody")}</span><button onClick={() => navigate("/login")}>{t("desk.signIn")}</button></div>
        : !canCreate
          ? <div className="desk-dormant-note">{t("desk.noPermission")}</div>
          : <section className="heritage-desk-grid submission-grid">
            <article data-h-surface-role="panel" className="desk-panel h-glass-1 submission-form-panel">
              <header><span><small>{L("Submission", "درخواست")}</small><h2>{activeDraftId ? L("Edit your draft", "ویرایش پیش‌نویس") : L("Horse details", "مشخصات اسب")}</h2></span></header>
              {stepChips}
              <div className="submission-save-state"><strong>{busy ? L("Saving…", "در حال ذخیره…") : dirty ? L("Unsaved changes", "تغییرات ذخیره‌نشده") : activeDraftId ? L("Saved draft", "پیش‌نویس ذخیره‌شده") : L("New record", "پرونده جدید")}</strong><span>{L("Save to your account before refreshing or signing out. Unsaved input stays only in this tab.", "پیش از تازه‌سازی صفحه یا خروج، در حساب خود ذخیره کنید. اطلاعات ذخیره‌نشده فقط در این برگه می‌ماند.")}</span></div>
              {/* Capture protects new input from a late draft hydrate without
                  rerendering a controlled field before its change is read. */}
              <form className="desk-change-form submission-form" onSubmit={onFormSubmit}
                onInputCapture={event => { if (!(event.target as HTMLElement).closest(".submission-evidence")) restoredUnsavedRef.current = true; }}
                onChangeCapture={event => { if (!(event.target as HTMLElement).closest(".submission-evidence")) restoredUnsavedRef.current = true; }}
                onChange={event => { if (!(event.target as HTMLElement).closest(".submission-evidence")) markEdited(); }}>
                <fieldset className="submission-fields" disabled={busy || evidenceBusy}>
                {step === 0 && identityStep}
                {step === 1 && <>
                  {parentFields("father", father, setFather, fatherIsNative, setFatherIsNative)}
                  {parentFields("mother", mother, setMother, motherIsNative, setMotherIsNative)}
                </>}
                {step === 2 && peopleStep}
                {step === 3 && reviewStep}
                </fieldset>
                <div className="submission-actions">
                  {step > 0 && <button type="button" onClick={() => goToStep(step - 1)} disabled={busy || evidenceBusy}>{L("Back", "قبلی")}</button>}
                  {step < STEP_COUNT - 1 && <button type="button" className="primary" onClick={nextStep} disabled={busy || evidenceBusy}>{L("Next", "بعدی")}</button>}
                  <button type="button" onClick={() => void save(false)} disabled={busy || evidenceBusy}>{L("Save as draft", "ذخیره پیش‌نویس")}</button>
                  {step === STEP_COUNT - 1 && <button type="submit" className="primary" disabled={busy || evidenceBusy}>{busy ? L("Working…", "در حال انجام…") : L("Submit for review", "ارسال برای بررسی")}</button>}
                  {activeDraftId && <button type="button" className="reject" onClick={() => void withdraw()} disabled={busy || evidenceBusy}>{L("Withdraw", "پس‌گرفتن")}</button>}
                  {justSubmitted && !busy && <button type="button" onClick={() => { setJustSubmitted(false); setMessage(""); }}>{L("Register another horse", "ثبت اسب دیگر")}</button>}
                </div>
              </form>
              {message && <div className="submission-message" role="status">{message}{justSubmitted && ` ${L("The form is clear — you can register the next horse now.", "فرم خالی است — می‌توانید اسب بعدی را همین حالا ثبت کنید.")}`}</div>}
              {errorText && <div className="desk-error" role="alert">{errorText}</div>}
            </article>

            <article data-h-surface-role="panel" className="desk-panel h-glass-1 submission-list-panel">
              <header><span><small>{L("Your submissions", "درخواست‌های شما")}</small><h2>{L("My horse submissions", "درخواست‌های ثبت اسب من")}</h2></span></header>
              {listError && <div className="desk-error">{listError}</div>}
              <div className="desk-claim-list">
                {mine.length ? mine.slice(0, 12).map((request) => <div key={request.id} className="submission-record">
                  <button disabled={busy || evidenceBusy} onClick={() => (request.canonical_horse_id != null ? navigate(`/horse/${request.canonical_horse_id}`) : request.status === "draft" && request.submission ? (restoredUnsavedRef.current = true, pendingCreate.current = null, setIdempotencyKey(mintIdempotencyKey()), setActiveDraftId(request.id), draftRevisionRef.current = Number.isFinite(request.content_revision) ? request.content_revision! : null, hydrateForm(request.submission, request.evidence), setDirty(false), setStep(0), setJustSubmitted(false)) : undefined)}>
                    <span><strong dir="auto">{request.submission?.name_native || request.submission?.name_latin || request.summary || "—"}</strong>
                      <small>
                        {(request.review_status ?? request.status) === "approved" && request.canonical_horse_id != null ? `#${n(request.canonical_horse_id)} · ` : ""}
                        {(request.submission?.register_no ? `${request.submission.register_no} · ` : "") + statusLabel(request)}
                      </small>
                    </span>
                    <b className={`claim-status status-${request.status === "draft" && request.review_outcome === "needs_changes" ? "needs-changes" : request.status}`}>{statusLabel(request)}</b>
                  </button>
                  {request.review_note && <div className="submission-review-note" dir="auto">{request.review_note}</div>}
                  <button className="submission-open-evidence" type="button" onClick={() => setViewEvidenceRequestId(value => value === request.id ? null : request.id)}>{L("View private attachments", "مشاهده پیوست‌های خصوصی")}</button>
                  {viewEvidenceRequestId === request.id && <SubmissionEvidencePanel key={`saved:${request.id}`} platform={platform} requestId={request.id} readOnly />}
                </div>) : <div className="desk-empty">{L("No horse submissions yet.", "هنوز درخواستی ثبت نشده است.")}</div>}
              </div>
            </article>
          </section>}
  </main>;
}

function precisionLabel(value: string, locale: string): string {
  return locale === "fa" ? ({ year: "فقط سال", month: "سال و ماه", day: "روز دقیق" } as Record<string, string>)[value] ?? value : ({ year: "Year only", month: "Year and month", day: "Exact day" } as Record<string, string>)[value] ?? value;
}

function lifeStatusLabel(value: string, locale: string): string {
  return locale === "fa" ? ({ unknown: "نامشخص", alive: "زنده", dead: "تلف‌شده", missing: "مفقود" } as Record<string, string>)[value] ?? value : ({ unknown: "Unknown", alive: "Alive", dead: "Deceased", missing: "Missing" } as Record<string, string>)[value] ?? value;
}

function RegistrationDateField({ label, value, precision, calendar, onChange }: {
  label: string; value: string; precision: RegistryDateInput["precision"]; calendar: RegistryDateInput["calendar"];
  onChange: (value: RegistryDateInput) => void;
}) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  return <fieldset className="submission-date-field"><legend>{label}</legend>
    <label><small>{L("Recorded date", "تاریخ ثبت‌شده")}</small><input dir="ltr" aria-label={label} maxLength={10} placeholder={precision === "year" ? "YYYY" : precision === "month" ? "YYYY-MM" : "YYYY-MM-DD"} value={value} onChange={event => onChange({ value: normalizeRegistrationDateValue(event.target.value), precision, calendar })} /></label>
    <label><small>{L("Precision", "دقت")}</small><select aria-label={`${label} · ${L("precision", "دقت")}`} value={precision} onChange={event => onChange({ value, precision: event.target.value as RegistryDateInput["precision"], calendar })}>{(["year","month","day"] as const).map(item => <option key={item} value={item}>{precisionLabel(item, locale)}</option>)}</select></label>
    <label><small>{L("Calendar", "تقویم")}</small><select aria-label={`${label} · ${L("calendar", "تقویم")}`} value={calendar} onChange={event => onChange({ value, precision, calendar: event.target.value as RegistryDateInput["calendar"] })}><option value="gregorian">{L("Gregorian", "میلادی")}</option><option value="solar_hijri">{L("Solar Hijri", "هجری شمسی")}</option></select></label>
  </fieldset>;
}

function PersonLookup({ platform, label, value, onChange }: {
  platform: PlatformClient; label: string; value: string; onChange: (value: string) => void;
}) {
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const [manualId, setManualId] = useState("");
  const chosen = Number(value);
  const displayName = (person: Pick<PersonSummary,"name_native"|"name_latin">) => (locale === "fa" ? person.name_native || person.name_latin : person.name_latin || person.name_native) ?? L("Unnamed person", "فرد بدون نام");
  useEffect(() => {
    setSelectedName("");
    if (!Number.isSafeInteger(chosen) || chosen <= 0) return;
    const controller = new AbortController();
    platform.people.get(chosen, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setSelectedName(displayName(response.person)); }).catch(() => { /* The selected ID remains explicit if its public display name cannot load. */ });
    return () => controller.abort();
  }, [platform, chosen, locale]);
  useEffect(() => {
    const needle = query.trim();
    setPeople([]); setFailed(false);
    if (needle.length < 2 || value) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      platform.people.list({ q: needle, limit: 8 }, { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setPeople(response.people); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [platform, query, value]);
  return <fieldset className="submission-person-lookup"><legend>{label}</legend>
    {value ? <div className="submission-lookup-chosen"><span><strong dir="auto">{selectedName || L("Selected person", "فرد انتخاب‌شده")}</strong> · #{n(chosen)}</span><button type="button" onClick={() => { onChange(""); setQuery(""); }}>{L("Change", "تغییر")}</button></div> : <>
      <label>{L("Search by name", "جست‌وجو بر اساس نام")}<input type="search" dir="auto" aria-label={`${label} · ${L("search by name", "جست‌وجوی نام")}`} value={query} maxLength={120} onChange={event => setQuery(event.target.value)} /></label>
      {loading && <small role="status">{L("Searching people…", "در حال جست‌وجوی افراد…")}</small>}
      {failed && <small role="alert">{L("People could not be loaded. Edit the search to retry.", "فهرست افراد بارگذاری نشد. برای تلاش دوباره، جست‌وجو را تغییر دهید.")}</small>}
      {!loading && !failed && people.length > 0 && <ul className="submission-lookup-results">{people.map(person => <li key={person.id}><button type="button" onClick={() => { setSelectedName(displayName(person)); onChange(String(person.id)); setPeople([]); setQuery(""); }}><b dir="auto">{displayName(person)}</b><small>#{n(person.id)}</small></button></li>)}</ul>}
      {!loading && !failed && query.trim().length >= 2 && !people.length && <small>{L("No person found. Leave the link unknown and explain the relationship in your private reviewer notes.", "فردی پیدا نشد. پیوند را خالی بگذارید و رابطه را در یادداشت خصوصی بررسی‌کننده توضیح دهید.")}</small>}
      <details><summary>{L("Enter a known internal person ID", "ورود شناسه داخلی فرد شناخته‌شده")}</summary><label>{L("Internal person ID", "شناسه داخلی فرد")}<input inputMode="numeric" dir="ltr" value={manualId} onChange={event => setManualId(digitsOnly(event.target.value))} /></label><button type="button" disabled={!Number.isSafeInteger(Number(manualId)) || Number(manualId) <= 0} onClick={() => { onChange(manualId); setManualId(""); }}>{L("Use this ID", "انتخاب این شناسه")}</button></details>
    </>}
  </fieldset>;
}

function workflowStatus(status: string, locale: string): string {
  if (locale !== "fa") return status;
  return ({
    draft: "پیش‌نویس", pending: "در انتظار بررسی", approved: "تأییدشده", rejected: "ردشده",
    withdrawn: "پس‌گرفته‌شده", needs_changes: "نیازمند اصلاح",
  } as Record<string, string>)[status] ?? status;
}

/** R143-C02: in-place registry search for a parent pick — a real component
 * (hooks live here, not inside the parent's conditional render tree). */
function ParentHorseLookup({ platform, locale, n, L, navigate, label, pick, setPick }: {
  platform: PlatformClient;
  locale: string;
  n: (value: number) => string;
  L: (en: string, fa: string) => string;
  navigate: (path: string) => void;
  label: "father" | "mother";
  pick: ParentPick;
  setPick: React.Dispatch<React.SetStateAction<ParentPick>>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HorseRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [manualId, setManualId] = useState("");
  useEffect(() => {
    const trimmed = query.trim();
    setResults(null); setSearchError(false);
    if (trimmed.length < 2) { setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      setSearching(true);
      platform.search.horses(trimmed, { limit: 8, signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setResults(value.results); })
        .catch(() => { if (!controller.signal.aborted) setSearchError(true); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, platform]);
  const chosen = pick.horse_id ? Number(pick.horse_id) : null;
  return <div className="submission-parent-id">
    {chosen != null && <div className="submission-lookup-chosen">
      {L("Chosen registry horse", "اسب انتخاب‌شده")}: <b>#{n(chosen)}</b>
      <button type="button" onClick={() => setPick({ ...pick, horse_id: "" })}>{L("Change", "تغییر")}</button>
    </div>}
    {chosen == null && <>
      <input dir="auto" aria-label={label === "father" ? L("Search for the sire", "جست‌وجوی پدر") : L("Search for the dam", "جست‌وجوی مادر")} placeholder={L("Search the registry by name…", "جست‌وجوی نام در سامانه…")} value={query} onChange={(event) => setQuery(event.target.value)} />
      {searching && <small className="submission-lookup-status" role="status">{L("Searching…", "در حال جست‌وجو…")}</small>}
      {searchError && <small className="submission-lookup-status" role="alert">{L("The registry search could not be completed. Change the query to retry.", "جست‌وجوی سامانه کامل نشد. برای تلاش دوباره عبارت جست‌وجو را تغییر دهید.")}</small>}
      {results != null && results.length > 0 && <ul className="submission-lookup-results">
        {results.map((horse) => <li key={horse.id}>
          <button type="button" onClick={() => { setPick({ ...pick, horse_id: String(horse.id) }); setQuery(""); setResults(null); }}>
            <b dir="auto">{locale === "fa" && horse.name_native ? horse.name_native : horse.name_latin ?? horse.name_native}</b>
            <small>#{n(horse.id)}{horse.birth_year ? ` · ${n(horse.birth_year)}` : ""}</small>
          </button>
        </li>)}
      </ul>}
      {results != null && results.length === 0 && !searching && <small className="submission-lookup-status">{L("No registry horse matches — you can record the parent as an unresolved source assertion instead.", "هیچ اسبی در سامانه مطابقت ندارد — می‌توانید والد را به‌عنوان استناد منبع نامشخص ثبت کنید.")}</small>}
      <label className="submission-native-toggle">{L("Or enter the registry number directly", "یا شماره ثبت را مستقیم وارد کنید")}</label>
      <input inputMode="numeric" dir="ltr" aria-label={label === "father" ? L("Sire internal horse ID", "شناسه داخلی پدر") : L("Dam internal horse ID", "شناسه داخلی مادر")} placeholder={L("Internal horse ID", "شناسه داخلی اسب")} value={manualId} onChange={event => setManualId(digitsOnly(event.target.value))} />
      <button type="button" disabled={!Number.isSafeInteger(Number(manualId)) || Number(manualId) <= 0} onClick={() => { setPick({ ...pick, horse_id: manualId }); setManualId(""); }}>{L("Use this ID", "انتخاب این شناسه")}</button>
      <a href="/browse" onClick={(event) => { event.preventDefault(); navigate("/browse"); }}>{L("Explore the registry", "مشاهده فهرست اسب‌ها")}</a>
    </>}
  </div>;
}
