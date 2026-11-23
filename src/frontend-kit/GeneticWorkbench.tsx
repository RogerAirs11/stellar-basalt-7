import React, { useEffect, useRef, useState } from "react";
import type { GeneticDisclosureHistoryResponse, GeneticDisclosureInput, GeneticTestRecord, PlatformClient } from "../contracts/platform";
import type { ArabianVariant, GeneticIntakeInput, GeneticInterpretationInput, GeneticReviewHistoryResponse, PairingReviewInput } from "../contracts/genetics";
import type { GeneticAccessResponse } from "../contracts/professionalAccess";
import { uiText, type UiLocale } from "../shared/uiLocale";
import { AccountSecurityPanel } from "./AccountSecurityPanel";
import "./account-controls.css";

type Props = { platform: PlatformClient; horseId: number; locale: UiLocale; scope: string; onChanged?: () => void };
type Operation = { execute: (signal: AbortSignal) => Promise<string>; repeatable: boolean; publicationTestId?: number };
type RunOperation = (operation: Operation) => void;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const refusal = (error: unknown) => typeof error === "object" && error !== null && "status" in error && Number(error.status) >= 400 && Number(error.status) < 500;
const normalizeDigits = (value: string) => value.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, character => String(character.charCodeAt(0) >= 0x06f0 ? character.charCodeAt(0) - 0x06f0 : character.charCodeAt(0) - 0x0660));
const positive = (value: string) => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));

/** Professional commands are offered only after a current, horse-specific capability read. */
export function GeneticWorkbench(props: Props) {
  return <GeneticWorkbenchForPrincipal key={`${props.scope}:${props.horseId}`} {...props} />;
}

function GeneticWorkbenchForPrincipal({ platform, horseId, locale, scope, onChanged }: Props) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [opened, setOpened] = useState(false);
  const [capabilities, setCapabilities] = useState<GeneticAccessResponse | null>(null);
  const [tests, setTests] = useState<GeneticTestRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [phase, setPhase] = useState<"idle" | "busy" | "rejected" | "uncertain">("idle");
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const [reconciled, setReconciled] = useState(false);
  const alive = useRef(false), flight = useRef(false), generation = useRef(0);
  const readController = useRef<AbortController | null>(null), writeController = useRef<AbortController | null>(null);
  const savedOperation = useRef<Operation | null>(null);
  const load = async () => {
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    const version = ++generation.current;
    setCapabilities(null); setTests(null); setLoading(true); setLoadError(""); setReconciled(false);
    try {
      const access = await platform.modules.genetics.capabilities(horseId, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted || version !== generation.current) return;
      const evidence = access.can_view_private_evidence ? await platform.modules.genetics.horse(horseId, { signal: controller.signal }) : null;
      if (!alive.current || controller.signal.aborted || version !== generation.current) return;
      setCapabilities(access); setTests(evidence?.tests ?? null);
      setPhase(previous => previous === "rejected" ? "idle" : previous);
    } catch (error) {
      if (alive.current && !controller.signal.aborted && version === generation.current) setLoadError(messageOf(error));
    } finally { if (alive.current && !controller.signal.aborted && version === generation.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; readController.current?.abort(); writeController.current?.abort(); }; }, []);
  useEffect(() => { if (opened) void load(); return () => { readController.current?.abort(); }; }, [opened, platform, horseId]); // eslint-disable-line react-hooks/exhaustive-deps
  const execute = async (operation: Operation) => {
    if (flight.current || !alive.current) return;
    flight.current = true; setPhase("busy"); setCommandError(""); setReceipt(""); setReconciled(false);
    const controller = new AbortController(); writeController.current = controller;
    try {
      const receiptText = await operation.execute(controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setReceipt(receiptText); setPhase("idle"); savedOperation.current = null; setRevision(value => value + 1);
      onChanged?.(); await load();
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      setCommandError(messageOf(error)); setPhase(refusal(error) ? "rejected" : "uncertain");
      setTests(null); setCapabilities(null);
      if (refusal(error)) savedOperation.current = null;
    } finally { flight.current = false; }
  };
  const run: RunOperation = operation => {
    if (phase !== "idle" || loading || !capabilities || flight.current) return;
    savedOperation.current = operation; void execute(operation);
  };
  const blocked = phase !== "idle" || loading || capabilities === null;
  const selected = tests?.find(test => String(test.id) === selectedId);
  return <section className="hdb-account-controls hdb-genetic-workbench" data-h-surface-role="panel" aria-label={L("Professional genetic evidence", "مدارک حرفه‌ای ژنتیک")}>
    <header><h2>{L("Professional genetic evidence", "مدارک حرفه‌ای ژنتیک")}</h2><p>{L("Submit reports, review recorded results and record publication decisions within your current assignment for this horse.", "گزارش‌ها را ثبت کنید، نتایج ثبت‌شده را بررسی کنید و تصمیم انتشار را در محدوده مأموریت فعلی خود برای این اسب ثبت کنید.")}</p></header>
    {!opened ? <button type="button" onClick={() => setOpened(true)}>{L("Check my access for this horse", "بررسی دسترسی من برای این اسب")}</button> : <>
      <AccountSecurityPanel platform={platform} locale={locale} scope={scope}/>
      <button type="button" disabled={phase === "busy" || loading} onClick={() => void load()}>{L("Reload access and evidence", "بارگذاری دوباره دسترسی و مدارک")}</button>
      {loading && <p role="status">{L("Checking current access…", "در حال بررسی دسترسی فعلی…")}</p>}
      {loadError && <p role="alert" dir="auto">{loadError}</p>}
      {receipt && <p role="status" className="hdb-account-success">{receipt}</p>}
      {commandError && <p role="alert" dir="auto">{commandError}</p>}
      {phase === "rejected" && <p>{L("The server refused this operation. Reload to check your assignment and the latest record before preparing a new decision.", "سرور این عملیات را نپذیرفت. پیش از آماده‌سازی تصمیم جدید، مأموریت خود و آخرین نسخه رکورد را دوباره بارگذاری کنید.")}</p>}
      {phase === "uncertain" && <div className="hdb-account-warning" role="alert"><p>{L("The response was lost; the operation may have completed. Do not prepare a duplicate submission.", "پاسخ دریافت نشد؛ ممکن است عملیات انجام شده باشد. ارسال تکراری آماده نکنید.")}</p>{savedOperation.current?.repeatable ? <button type="button" disabled={loading} onClick={() => { const saved = savedOperation.current; if (saved?.repeatable) void execute(saved); }}>{L("Retry the same saved operation", "تلاش دوباره برای همان عملیات ذخیره‌شده")}</button> : <><p>{L("Reload the publication history for the same test and inspect the recorded decision before continuing.", "تاریخچه انتشار همان آزمون را بارگذاری کرده و پیش از ادامه تصمیم ثبت‌شده را بررسی کنید.")}</p>{reconciled && <button type="button" onClick={() => { setPhase("idle"); savedOperation.current = null; setCommandError(""); setReconciled(false); }}>{L("I have checked the publication history", "تاریخچه انتشار را بررسی کردم")}</button>}</>}</div>}
      {capabilities && <>
        {!capabilities.can_intake && !capabilities.can_review && !capabilities.can_publish && !capabilities.can_view_private_evidence && <p>{L("No current genetic evidence access is available for this account and horse. Verify in Account security, then reload access. If access is still unavailable, an administrator must review the specific professional assignment.", "در حال حاضر دسترسی مدارک ژنتیک برای این حساب و اسب موجود نیست. در بخش امنیت حساب تأیید کنید، سپس دسترسی را دوباره بارگذاری کنید. اگر دسترسی همچنان موجود نبود، مدیر باید مأموریت حرفه‌ای مشخص را بررسی کند.")}</p>}
        {capabilities.can_intake && <details><summary>{L("Submit a laboratory result", "ثبت نتیجه آزمایشگاه")}</summary><GeneticIntakeForm key={`intake:${revision}`} locale={locale} blocked={blocked} onSubmit={input => run({ repeatable: true, execute: async signal => { const response = await platform.modules.genetics.addTest(horseId, input, { signal }); return L(`Test #${response.test.id} received privately, pending independent review.`, `آزمون #${response.test.id} به‌صورت خصوصی دریافت شد و در انتظار بررسی مستقل است.`); } })} /></details>}
        {tests && <><h3>{L("Evidence available under your assignment", "مدارک در دسترس در محدوده مأموریت شما")}</h3>{tests.length === 0 ? <p>{L("No accessible tests were returned.", "آزمون قابل‌دسترسی برگردانده نشد.")}</p> : <label>{L("Select an evidence record", "انتخاب رکورد مدرک")}<select name="genetic_test_choice" value={selectedId} disabled={blocked} onChange={event => setSelectedId(event.target.value)}><option value="">{L("Choose a test…", "یک آزمون انتخاب کنید…")}</option>{tests.map(test => <option key={test.id} value={test.id}>#{test.id} · {test.test_type}</option>)}</select></label>}</>}
        {selected && <article className="hdb-account-grant" key={`test:${selected.id}:${revision}`}><h3 dir="auto">#{selected.id} · {selected.test_type}</h3><dl><div><dt>{L("Reported result", "نتیجه گزارش‌شده")}</dt><dd dir="auto">{selected.result}</dd></div><div><dt>{L("Laboratory / accession", "آزمایشگاه / شماره پذیرش")}</dt><dd dir="auto">{[selected.lab_name, selected.lab_accession].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt>{L("Test date", "تاریخ آزمون")}</dt><dd dir="auto">{selected.tested_at || "—"}</dd></div><div><dt>{L("Recorded interpretation", "تفسیر ثبت‌شده")}</dt><dd dir="auto">{selected.result_interpretation || "—"}</dd></div><div><dt>{L("Private notes", "یادداشت‌های خصوصی")}</dt><dd dir="auto">{selected.notes || "—"}</dd></div></dl>
          <p>{Number(selected.verified) === 1 ? L("Record reviewed by the platform; this is not an issuer attestation or clinical diagnosis.", "رکورد در سامانه بررسی شده است؛ این بررسی گواهی مرجع یا تشخیص بالینی نیست.") : L("This record is not verified.", "این رکورد تأیید نشده است.")}</p>
          {capabilities.can_review && <><GeneticReviewForm locale={locale} test={selected} blocked={blocked} run={run} platform={platform} /><PairingReviewForm locale={locale} test={selected} blocked={blocked} run={run} platform={platform} /><ReviewHistory platform={platform} testId={selected.id} locale={locale} /></>}
        </article>}
        {capabilities.can_publish && <><label>{L("Exact test ID for publication review", "شناسه دقیق آزمون برای بررسی انتشار")}<input name="publication_test_id" inputMode="numeric" value={selectedId} disabled={blocked && phase !== "uncertain"} onChange={event => setSelectedId(normalizeDigits(event.target.value))} dir="ltr" /></label>{positive(selectedId) && <PublicationForm key={`publication:${selectedId}:${revision}`} platform={platform} horseId={horseId} testId={Number(selectedId)} locale={locale} blocked={blocked} run={run} onLoaded={() => { if (savedOperation.current?.publicationTestId === Number(selectedId)) setReconciled(true); }} />}</>}
      </>}
    </>}
  </section>;
}

function GeneticIntakeForm({ locale, blocked, onSubmit }: { locale: Props["locale"]; blocked: boolean; onSubmit: (input: GeneticIntakeInput) => void }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [fields, setFields] = useState({ test_type: "", test_category: "disease" as GeneticIntakeInput["test_category"], result: "", result_interpretation: "", lab_name: "", lab_accession: "", tested_at: "", notes: "" });
  const update = (field: keyof typeof fields, value: string) => setFields(current => ({ ...current, [field]: value }));
  return <form className="hdb-account-form" onSubmit={event => { event.preventDefault(); if (!blocked && fields.test_type.trim().length >= 2 && fields.result.trim()) onSubmit({ ...fields, test_type: fields.test_type.trim(), result: fields.result.trim(), tested_at: fields.tested_at || null, operation_id: crypto.randomUUID() }); }}><fieldset disabled={blocked}><legend>{L("Private evidence intake", "دریافت خصوصی مدارک")}</legend>
    <p>{L("Copy the assay and result exactly from the report. Submission does not verify or publish the result; a different assigned reviewer must review it.", "آزمون و نتیجه را دقیقاً از گزارش وارد کنید. ثبت، نتیجه را تأیید یا منتشر نمی‌کند؛ بررسی باید توسط بررسی‌کننده دیگری با مأموریت مشخص انجام شود.")}</p>
    <label>{L("Assay / test name", "نام آزمون")}<input name="intake_test_type" required minLength={2} maxLength={60} value={fields.test_type} onChange={event => update("test_type", event.target.value)} dir="auto" /></label>
    <label>{L("Category", "دسته")}<select name="intake_category" value={fields.test_category} onChange={event => update("test_category", event.target.value)}>{([["disease", "Health variant", "واریانت سلامت"], ["coat_color", "Coat color", "رنگ پوشش"], ["parentage", "Parentage", "والدین"], ["diversity", "Diversity", "تنوع"], ["other", "Other", "سایر"]] as const).map(([value, en, fa]) => <option key={value} value={value}>{L(en, fa)}</option>)}</select></label>
    <label>{L("Exact reported result", "نتیجه دقیق گزارش‌شده")}<input name="intake_result" required maxLength={60} value={fields.result} onChange={event => update("result", event.target.value)} dir="auto" /></label>
    <div className="hdb-account-columns"><label>{L("Laboratory name", "نام آزمایشگاه")}<input name="intake_lab" maxLength={200} value={fields.lab_name} onChange={event => update("lab_name", event.target.value)} dir="auto" /></label><label>{L("Laboratory accession", "شماره پذیرش آزمایشگاه")}<input name="intake_accession" maxLength={120} value={fields.lab_accession} onChange={event => update("lab_accession", event.target.value)} dir="auto" /></label></div>
    <label>{L("Test date (optional)", "تاریخ آزمون (اختیاری)")}<input name="intake_date" type="date" value={fields.tested_at} onChange={event => update("tested_at", event.target.value)} dir="ltr" /></label>
    <label>{L("Interpretation printed in the report (optional)", "تفسیر چاپ‌شده در گزارش (اختیاری)")}<textarea name="intake_interpretation" maxLength={500} value={fields.result_interpretation} onChange={event => update("result_interpretation", event.target.value)} dir="auto" /></label>
    <label>{L("Private notes / report reference", "یادداشت خصوصی / مرجع گزارش")}<textarea name="intake_notes" maxLength={2000} value={fields.notes} onChange={event => update("notes", event.target.value)} dir="auto" /></label>
    <button type="submit">{L("Submit privately for review", "ثبت خصوصی برای بررسی")}</button>
  </fieldset></form>;
}

function GeneticReviewForm({ platform, locale, test, blocked, run }: { platform: PlatformClient; locale: Props["locale"]; test: GeneticTestRecord; blocked: boolean; run: RunOperation }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [status, setStatus] = useState<GeneticInterpretationInput["result_status"]>(test.result_status ?? "recorded_uninterpreted");
  const [verification, setVerification] = useState<GeneticInterpretationInput["verification"]>("unchanged");
  const [evidence, setEvidence] = useState(""), [reason, setReason] = useState(""), [note, setNote] = useState(""), [acknowledge, setAcknowledge] = useState(false);
  const own = test.review_eligibility?.own_submission === true, unknownOrigin = test.review_eligibility?.legacy_origin_unknown === true;
  const eligible = Boolean(test.review_eligibility) && (!own || verification === "withdraw") && (verification !== "confirm_record" || (evidence.trim().length >= 3 && (!unknownOrigin || acknowledge))) && Number.isSafeInteger(test.row_version) && Number(test.row_version) > 0;
  return <details><summary>{L("Review recorded interpretation", "بررسی تفسیر ثبت‌شده")}</summary><form className="hdb-account-form" onSubmit={event => {
    event.preventDefault(); if (blocked || !eligible || reason.trim().length < 10) return;
    const input: GeneticInterpretationInput = { operation_id: crypto.randomUUID(), expected_version: test.row_version!, result_status: own ? test.result_status ?? "recorded_uninterpreted" : status, verification, evidence_ref: evidence.trim() || null, legacy_origin_acknowledged: acknowledge, reason: reason.trim(), note: note.trim() || null };
    run({ repeatable: true, execute: async signal => { const response = await platform.modules.genetics.interpret(test.id, input, { signal }); const accepted = L(`Review saved for test #${test.id}, revision ${response.review.row_version}.`, `بررسی آزمون #${test.id} با ویرایش ${response.review.row_version} ذخیره شد.`); return response.review.publication_withdrawn ? `${accepted} ${L("Previous publication was withdrawn. Publishing this result again requires a fresh decision.", "انتشار قبلی پس گرفته شد. انتشار دوباره این نتیجه به تصمیم تازه نیاز دارد.")}` : accepted; } });
  }}><fieldset disabled={blocked}><legend>{L("Evidence review", "بررسی مدارک")}</legend>
    {own && <p className="hdb-account-warning">{L("You submitted this evidence. An independent reviewer must make positive review decisions. You may withdraw verification if needed.", "این مدرک را خودتان ثبت کرده‌اید. تصمیم مثبت بررسی باید توسط بررسی‌کننده مستقل گرفته شود. در صورت نیاز می‌توانید تأیید را پس بگیرید.")}</p>}
    <label>{L("Recorded genotype interpretation", "تفسیر ژنوتیپ ثبت‌شده")}<select name="genetic_result_status" disabled={own} value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="recorded_uninterpreted">{L("Uninterpreted report", "گزارش تفسیرنشده")}</option><option value="clear">{L("Target variant absent", "واریانت هدف یافت نشد")}</option><option value="carrier">{L("One variant copy", "یک نسخه واریانت")}</option><option value="affected">{L("Risk-associated genotype", "ژنوتیپ مرتبط با خطر")}</option></select></label>
    <label>{L("Verification decision", "تصمیم تأیید")}<select name="genetic_verification" value={verification} onChange={event => setVerification(event.target.value as typeof verification)}><option value="unchanged">{L("Keep verification unchanged", "بدون تغییر تأیید")}</option><option value="confirm_record" disabled={own}>{L("Confirm independent record review", "تأیید بررسی مستقل رکورد")}</option><option value="withdraw">{L("Withdraw verification", "پس‌گرفتن تأیید")}</option></select></label>
    <label>{L("Evidence reference", "مرجع مدرک")}<input name="genetic_review_evidence" required={verification === "confirm_record"} minLength={verification === "confirm_record" ? 3 : undefined} maxLength={200} value={evidence} onChange={event => setEvidence(event.target.value)} dir="auto" /></label>
    {unknownOrigin && verification === "confirm_record" && <label className="hdb-account-check"><input type="checkbox" name="legacy_origin_acknowledged" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} />{L("The original submitter is unknown. I checked the source independently and acknowledge that the original submission cannot be attributed.", "ثبت‌کننده اولیه مشخص نیست. من منبع را مستقل بررسی کرده‌ام و می‌پذیرم که ثبت اولیه قابل انتساب نیست.")}</label>}
    <label>{L("Review reason (at least 10 characters)", "دلیل بررسی (حداقل ۱۰ نویسه)")}<textarea name="genetic_review_reason" required minLength={10} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} dir="auto" /></label>
    <label>{L("Interpretation note (optional)", "یادداشت تفسیر (اختیاری)")}<textarea name="genetic_review_note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} dir="auto" /></label>
    <p>{L("A reviewed genotype is evidence about this exact assay. It does not establish a clinical diagnosis or an issuer's attestation.", "ژنوتیپ بررسی‌شده مدرکی درباره همین آزمون مشخص است. تشخیص بالینی یا گواهی مرجع را اثبات نمی‌کند.")}</p>
    <button type="submit" disabled={!eligible || reason.trim().length < 10}>{L("Save review decision", "ذخیره تصمیم بررسی")}</button>
  </fieldset></form></details>;
}

function PairingReviewForm({ platform, locale, test, blocked, run }: { platform: PlatformClient; locale: Props["locale"]; test: GeneticTestRecord; blocked: boolean; run: RunOperation }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [assay, setAssay] = useState<ArabianVariant>(test.pairing_review?.assay_key ?? "SCID");
  const [state, setState] = useState<"accepted" | "withdrawn">("accepted"), [reason, setReason] = useState(""), [expires, setExpires] = useState(""), [acknowledge, setAcknowledge] = useState(false);
  const own = test.review_eligibility?.own_submission === true, unknownOrigin = test.review_eligibility?.legacy_origin_unknown === true;
  const eligible = Boolean(test.review_eligibility) && Number.isSafeInteger(test.row_version) && Number(test.row_version) > 0 && (state === "withdrawn" || (Number(test.verified) === 1 && !own && (!unknownOrigin || acknowledge)));
  return <details><summary>{L("Review exact assay mapping for pairing", "بررسی نگاشت دقیق آزمون برای جفت‌گیری")}</summary><form className="hdb-account-form" onSubmit={event => {
    event.preventDefault(); if (blocked || !eligible || reason.trim().length < 10) return;
    const input: PairingReviewInput = { operation_id: crypto.randomUUID(), assay_key: assay, expected_version: test.pairing_review?.row_version ?? 0, expected_test_version: test.row_version!, expected_test_type: test.test_type, expected_result: test.result, state, expires_at: expires ? new Date(expires).toISOString() : null, reason: reason.trim(), legacy_origin_acknowledged: acknowledge };
    run({ repeatable: true, execute: async signal => { await platform.modules.genetics.reviewPairing(test.id, input, { signal }); return L(`Pairing evidence decision saved for test #${test.id}.`, `تصمیم مدرک جفت‌گیری برای آزمون #${test.id} ذخیره شد.`); } });
  }}><fieldset disabled={blocked}><legend>{L("Exact variant mapping", "نگاشت واریانت مشخص")}</legend>
    <p>{L("Accept only an independently reviewed, verified report for this exact variant. OAAM1 covers only its identified HOX deletion; it does not cover every OAAM cause.", "فقط گزارش تأییدشده با بررسی مستقل برای همین واریانت مشخص را بپذیرید. OAAM1 فقط حذف مشخص HOX را پوشش می‌دهد و شامل همه علت‌های OAAM نیست.")}</p>
    <label>{L("Variant", "واریانت")}<select name="pairing_assay" value={assay} onChange={event => setAssay(event.target.value as ArabianVariant)}>{["SCID", "CA", "LFS", "OAAM1"].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>{L("Mapping decision", "تصمیم نگاشت")}<select name="pairing_state" value={state} onChange={event => setState(event.target.value as typeof state)}><option value="accepted" disabled={own || Number(test.verified) !== 1}>{L("Accept for this exact variant", "پذیرش برای همین واریانت مشخص")}</option><option value="withdrawn">{L("Withdraw pairing evidence", "پس‌گرفتن مدرک جفت‌گیری")}</option></select></label>
    {state === "accepted" && (own || Number(test.verified) !== 1) && <p className="hdb-account-warning">{L("Acceptance needs a verified record and an independent reviewer.", "پذیرش به رکورد تأییدشده و بررسی‌کننده مستقل نیاز دارد.")}</p>}
    {unknownOrigin && state === "accepted" && <label className="hdb-account-check"><input name="pairing_legacy_ack" type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} />{L("I independently checked the source and acknowledge that the original submitter is unknown.", "من منبع را مستقل بررسی کرده‌ام و می‌پذیرم که ثبت‌کننده اولیه مشخص نیست.")}</label>}
    <label>{L("Expires in your local timezone (optional)", "انقضا در منطقه زمانی دستگاه (اختیاری)")}<input name="pairing_expiry" type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} dir="ltr" /></label>
    <label>{L("Mapping reason (at least 10 characters)", "دلیل نگاشت (حداقل ۱۰ نویسه)")}<textarea name="pairing_reason" required minLength={10} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} dir="auto" /></label>
    <button type="submit" disabled={!eligible || reason.trim().length < 10}>{L("Save pairing evidence decision", "ذخیره تصمیم مدرک جفت‌گیری")}</button>
  </fieldset></form></details>;
}

function ReviewHistory({ platform, testId, locale }: { platform: PlatformClient; testId: number; locale: Props["locale"] }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [history, setHistory] = useState<GeneticReviewHistoryResponse | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async () => { controller.current?.abort(); const request = new AbortController(); controller.current = request; setHistory(null); setError(""); setLoading(true); try { const result = await platform.modules.genetics.reviewHistory(testId, { signal: request.signal }); if (!request.signal.aborted) setHistory(result); } catch (error) { if (!request.signal.aborted) setError(messageOf(error)); } finally { if (!request.signal.aborted) setLoading(false); } };
  return <details><summary>{L("Review history", "تاریخچه بررسی")}</summary><button type="button" disabled={loading} onClick={() => void load()}>{L("Load review history", "بارگذاری تاریخچه بررسی")}</button>{loading && <p role="status">{L("Loading history…", "در حال بارگذاری تاریخچه…")}</p>}{error && <p role="alert" dir="auto">{error}</p>}{history && <><p>{history.truncated ? L(`Showing the latest ${history.limit} decisions; older decisions are omitted.`, `آخرین ${history.limit} تصمیم نمایش داده می‌شود؛ تصمیم‌های قدیمی‌تر نمایش داده نشده‌اند.`) : L("All returned review decisions are shown below.", "همه تصمیم‌های بررسی برگردانده‌شده در زیر نمایش داده می‌شوند.")}</p>{history.decisions.length === 0 && <p>{L("No recorded review decisions.", "تصمیم بررسی ثبت‌شده‌ای وجود ندارد.")}</p>}{history.decisions.map(decision => <article key={decision.operation_id}><h4>{decision.action === "pairing_review" ? L("Pairing evidence", "مدرک جفت‌گیری") : L("Interpretation", "تفسیر")}</h4><p dir="auto">{decision.actor_user_id} · {decision.created_at}</p><pre dir="auto">{decision.decision_json}</pre></article>)}</>}</details>;
}

function PublicationForm({ platform, horseId, testId, locale, blocked, run, onLoaded }: { platform: PlatformClient; horseId: number; testId: number; locale: Props["locale"]; blocked: boolean; run: RunOperation; onLoaded: () => void }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [history, setHistory] = useState<GeneticDisclosureHistoryResponse | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [basis, setBasis] = useState<GeneticDisclosureInput["basis"]>("owner_consent"), [evidence, setEvidence] = useState(""), [purpose, setPurpose] = useState(""), [reason, setReason] = useState("");
  const [publish, setPublish] = useState(false), [confirm, setConfirm] = useState(false);
  const request = useRef<AbortController | null>(null), onLoadedRef = useRef(onLoaded); onLoadedRef.current = onLoaded;
  const load = async () => { request.current?.abort(); const controller = new AbortController(); request.current = controller; setHistory(null); setError(""); setLoading(true); try { const result = await platform.modules.genetics.disclosureHistory(testId, { signal: controller.signal }); if (controller.signal.aborted) return; if (result.test.horse_id !== horseId) throw new Error(L("This test belongs to a different horse. Use its own access workspace.", "این آزمون متعلق به اسب دیگری است. از فضای دسترسی همان اسب استفاده کنید.")); setHistory(result); setPublish(result.effective.disclosed); setConfirm(false); onLoadedRef.current(); } catch (error) { if (!controller.signal.aborted) setError(messageOf(error)); } finally { if (!controller.signal.aborted) setLoading(false); } };
  useEffect(() => { void load(); return () => request.current?.abort(); }, [testId, horseId, platform]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="hdb-account-grant"><h3>{L(`Publication review for test #${testId}`, `بررسی انتشار آزمون #${testId}`)}</h3><button type="button" disabled={loading} onClick={() => void load()}>{L("Reload publication history", "بارگذاری دوباره تاریخچه انتشار")}</button>{loading && <p role="status">{L("Loading publication history…", "در حال بارگذاری تاریخچه انتشار…")}</p>}{error && <p role="alert" dir="auto">{error}</p>}{history && <>
    <p>{history.effective.disclosed ? L("A publication decision is currently active.", "در حال حاضر تصمیم انتشار فعال است.") : L("This health result is not currently disclosed by a publication decision.", "این نتیجه سلامت در حال حاضر بر اساس تصمیم انتشار افشا نمی‌شود.")}</p>
    <form className="hdb-account-form" onSubmit={event => { event.preventDefault(); if (blocked || loading || !confirm || reason.trim().length < 3 || (publish && Number(history.test.verified) !== 1)) return; const input: GeneticDisclosureInput = { public_disclosed: publish, expected_decision_version: history.effective.latest_version ?? 0, basis, evidence_ref: evidence.trim() || null, purpose: purpose.trim() || null, reason: reason.trim() }; run({ repeatable: false, publicationTestId: testId, execute: async signal => { const response = await platform.modules.genetics.setDisclosure(testId, input, { signal }); return response.test.public_disclosed ? L(`Publication decision recorded for test #${testId}.`, `تصمیم انتشار آزمون #${testId} ثبت شد.`) : L(`Publication withdrawn for test #${testId}.`, `انتشار آزمون #${testId} پس گرفته شد.`); } }); }}><fieldset disabled={blocked || loading}>
      <label>{L("Publication decision", "تصمیم انتشار")}<select name="genetic_publication" value={publish ? "publish" : "withdraw"} onChange={event => { setPublish(event.target.value === "publish"); setConfirm(false); }}><option value="withdraw">{L("Keep private / withdraw publication", "خصوصی نگه‌داشتن / پس‌گرفتن انتشار")}</option><option value="publish" disabled={Number(history.test.verified) !== 1}>{L("Publish the reviewed health result", "انتشار نتیجه سلامت بررسی‌شده")}</option></select></label>
      <label>{L("Publication basis", "مبنای انتشار")}<select name="publication_basis" value={basis} onChange={event => setBasis(event.target.value as typeof basis)}><option value="owner_consent">{L("Owner consent", "رضایت مالک")}</option><option value="staff_publication">{L("Authorized registry publication", "انتشار مجاز ثبت")}</option><option value="official_basis">{L("Documented official basis", "مبنای رسمی مستند")}</option></select></label>
      <label>{L("Supporting evidence reference", "مرجع مدرک پشتیبان")}<input name="publication_evidence" required={basis !== "staff_publication"} minLength={basis !== "staff_publication" ? 3 : undefined} maxLength={200} value={evidence} onChange={event => setEvidence(event.target.value)} dir="auto" /></label>
      <label>{L("Purpose", "هدف")}<input name="publication_purpose" maxLength={500} value={purpose} onChange={event => setPurpose(event.target.value)} dir="auto" /></label>
      <label>{L("Decision reason", "دلیل تصمیم")}<textarea name="publication_reason" required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} dir="auto" /></label>
      <label className="hdb-account-check"><input name="publication_confirm" type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />{publish ? L("I checked the evidence and authorize this health result to become public.", "مدارک را بررسی کرده‌ام و اجازه عمومی شدن این نتیجه سلامت را می‌دهم.") : L("I checked this decision and its recorded basis.", "این تصمیم و مبنای ثبت‌شده آن را بررسی کرده‌ام.")}</label>
      <button type="submit" disabled={!confirm || reason.trim().length < 3}>{L("Record publication decision", "ثبت تصمیم انتشار")}</button>
    </fieldset></form>
    <details><summary>{L("Publication decision history", "تاریخچه تصمیم انتشار")}</summary>{history.decisions.length === 0 ? <p>{L("No decision log exists for this legacy state yet.", "هنوز تصمیمی برای این وضعیت قدیمی ثبت نشده است.")}</p> : history.decisions.map(decision => <article key={decision.id}><h4>{decision.decision === "publish" ? L("Publish", "انتشار") : L("Withdraw", "پس‌گرفتن")}</h4><p dir="auto">{decision.created_at} · {decision.actor_user_id}</p><p dir="auto">{decision.reason}</p>{decision.evidence_ref && <p dir="auto">{decision.evidence_ref}</p>}</article>)}</details>
  </>}</div>;
}
