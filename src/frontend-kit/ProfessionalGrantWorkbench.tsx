import React, { useEffect, useRef, useState } from "react";
import type { PlatformClient, ProfessionalGrantCreateInput, ProfessionalGrantRecord } from "../contracts/platform";
import { PROFESSIONAL_KINDS, PROFESSIONAL_KIND_PERMISSIONS, type ProfessionalGrantPermission, type ProfessionalKind } from "../contracts/professionalAccess";
import { uiText, type UiLocale } from "../shared/uiLocale";
import "./account-controls.css";

type Props = { platform: PlatformClient; locale: UiLocale; scope: string; canRead: boolean; canManage: boolean };
const digits = (value: string) => value.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, character => String(character.charCodeAt(0) >= 0x06f0 ? character.charCodeAt(0) - 0x06f0 : character.charCodeAt(0) - 0x0660));
const positiveId = (value: string) => /^[1-9][0-9]*$/.test(digits(value.trim())) && Number.isSafeInteger(Number(digits(value.trim())));
const isRefusal = (error: unknown) => typeof error === "object" && error !== null && "status" in error && Number(error.status) >= 400 && Number(error.status) < 500;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const kindLabels: Record<ProfessionalKind, [string, string]> = {
  veterinarian: ["Veterinarian", "دامپزشک"], laboratory: ["Laboratory", "آزمایشگاه"], farrier: ["Farrier", "نعل‌بند"],
  physiotherapist: ["Physiotherapist", "فیزیوتراپیست"], dentist: ["Dentist", "دندان‌پزشک"], nutritionist: ["Nutritionist", "متخصص تغذیه"], federation_official: ["Federation official", "مسئول فدراسیون"],
};
const permissionLabels: Record<ProfessionalGrantPermission, [string, string]> = {
  private_health_read: ["Read private health records", "خواندن سوابق خصوصی سلامت"],
  clinical_write: ["Write clinical records", "ثبت سوابق بالینی"],
  sample_submit: ["Submit care samples", "ثبت نمونه‌های مراقبتی"],
  evidence_review: ["Review care evidence", "بررسی مدارک مراقبتی"],
  official_attestation: ["Submit official attestations", "ثبت گواهی رسمی"],
  private_file_export: ["Export permitted private files", "خروجی فایل‌های خصوصی مجاز"],
  genetic_evidence_read: ["Read private genetic evidence", "خواندن مدارک خصوصی ژنتیک"],
  genetic_intake: ["Submit genetic evidence", "ثبت مدارک ژنتیک"],
  genetic_review: ["Review genetic evidence", "بررسی مدارک ژنتیک"],
  genetic_publish: ["Decide publication of genetic results", "تصمیم درباره انتشار نتایج ژنتیک"],
};

/** Every private row, unfinished grant and continuation belongs to one principal. */
export function ProfessionalGrantWorkbench(props: Props) {
  if (!props.canRead) return null;
  return <GrantWorkbenchForPrincipal key={`${props.scope}:${props.canManage}`} {...props} />;
}

function GrantWorkbenchForPrincipal({ platform, locale, scope, canManage }: Props) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [horseInput, setHorseInput] = useState("");
  const [horseId, setHorseId] = useState<number | null>(null);
  return <section className="hdb-account-controls hdb-professional-grants" data-h-surface-role="panel" aria-label={L("Professional access", "دسترسی حرفه‌ای")}>
    <header><h2>{L("Professional access", "دسترسی حرفه‌ای")}</h2><p>{L("Review or assign a named professional's access to one horse. Each permission, assignment and validity period is recorded separately.", "دسترسی یک متخصص مشخص به یک اسب را بررسی یا تعیین کنید. هر مجوز، مأموریت و دوره اعتبار جداگانه ثبت می‌شود.")}</p></header>
    {canManage && <p className="hdb-account-note">{L("Creating or revoking access requires recent verification in Account security. Complete that verification, then reload the current grants before continuing.", "ایجاد یا لغو دسترسی به تأیید تازه در بخش امنیت حساب نیاز دارد. پس از تأیید، مجوزهای فعلی را دوباره بارگذاری کنید و سپس ادامه دهید.")}</p>}
    <form className="hdb-account-inline" onSubmit={event => { event.preventDefault(); if (positiveId(horseInput)) setHorseId(Number(digits(horseInput.trim()))); }}>
      <label>{L("Horse ID", "شناسه اسب")}<input name="grant_horse_id" inputMode="numeric" value={horseInput} onChange={event => setHorseInput(digits(event.target.value))} required dir="ltr" /></label>
      <button type="submit" disabled={!positiveId(horseInput)}>{L("Open access register", "باز کردن دفتر دسترسی")}</button>
    </form>
    {horseId !== null && <HorseGrants key={`${scope}:${horseId}`} platform={platform} locale={locale} horseId={horseId} canManage={canManage} />}
  </section>;
}

function HorseGrants({ platform, locale, horseId, canManage }: Pick<Props, "platform" | "locale" | "canManage"> & { horseId: number }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [rows, setRows] = useState<ProfessionalGrantRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const alive = useRef(false);
  const actionFlight = useRef(false);
  const readVersion = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const reload = async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const version = ++readVersion.current;
    setRows(null); setLoading(true); setLoadError(""); setReconciled(false);
    try {
      const result = await platform.modules.professionalGrants.list({ horse_id: horseId, signal: controller.signal });
      if (!alive.current || controller.signal.aborted || version !== readVersion.current) return;
      setRows(result.grants); setReconciled(true);
    } catch (error) {
      if (alive.current && !controller.signal.aborted && version === readVersion.current) setLoadError(errorMessage(error));
    } finally {
      if (alive.current && !controller.signal.aborted && version === readVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true; void reload();
    return () => { alive.current = false; readVersion.current++; readController.current?.abort(); writeController.current?.abort(); };
    // The parent keys this component by principal and horse. Runtime changes also invalidate reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, horseId]);
  const run = async (execute: (signal: AbortSignal) => Promise<string>, created: boolean) => {
    if (actionFlight.current || !alive.current || busy || uncertain || loading || rows === null || !canManage) return;
    actionFlight.current = true; setBusy(true); setCommandError(""); setReceipt(""); setReconciled(false);
    const controller = new AbortController(); writeController.current = controller;
    try {
      const message = await execute(controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setReceipt(message);
      if (created) setFormRevision(value => value + 1);
      await reload();
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      setCommandError(errorMessage(error));
      if (!isRefusal(error)) setUncertain(true);
      // A rejected authority or an ambiguous write makes displayed access stale.
      setRows(null); setReconciled(false);
    } finally {
      actionFlight.current = false;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  };
  const blocked = busy || loading || rows === null || uncertain;
  const date = (value: string) => {
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed) : value;
  };
  const phase = (row: ProfessionalGrantRecord) => row.revoked_at ? L("Revoked", "لغوشده") : Date.parse(row.valid_from) > Date.now() ? L("Scheduled", "زمان‌بندی‌شده") : row.valid_until && Date.parse(row.valid_until) <= Date.now() ? L("Expired", "منقضی‌شده") : L("Within validity period", "در دوره اعتبار");
  return <div className="hdb-account-stack" aria-busy={busy || loading}>
    <div className="hdb-account-inline"><h3>{L(`Horse #${horseId}`, `اسب #${horseId}`)}</h3><button type="button" disabled={busy || loading} onClick={() => void reload()}>{L("Reload current grants", "بارگذاری دوباره مجوزهای فعلی")}</button></div>
    <p className="hdb-account-note">{L("Shows up to the 200 most recent grants for this horse, including revoked and expired grants. Dates below are UTC. A grant still depends on an active account or organization membership.", "تا ۲۰۰ مجوز اخیر این اسب، شامل مجوزهای لغوشده و منقضی، نمایش داده می‌شود. تاریخ‌های زیر بر اساس UTC هستند. مجوز همچنان به حساب فعال یا عضویت فعال در سازمان وابسته است.")}</p>
    {receipt && <p className="hdb-account-success" role="status">{receipt}</p>}
    {commandError && <p role="alert" dir="auto">{commandError}</p>}
    {uncertain && <div className="hdb-account-warning" role="alert"><p>{L("The response was lost. The previous change may already have completed. Reload the register and inspect the recipient, permissions and references before allowing another change.", "پاسخ دریافت نشد. ممکن است تغییر قبلی انجام شده باشد. پیش از اجازه تغییر دوباره، دفتر را تازه‌سازی کرده و دریافت‌کننده، مجوزها و مراجع را بررسی کنید.")}</p>{reconciled && rows !== null && <button type="button" onClick={() => { setUncertain(false); setCommandError(""); setReconciled(false); }}>{L("I have checked the current grants", "مجوزهای فعلی را بررسی کردم")}</button>}</div>}
    {loading && <p role="status">{L("Loading current access…", "در حال بارگذاری دسترسی فعلی…")}</p>}
    {loadError && <p role="alert" dir="auto">{L("Access register could not be loaded. ", "دفتر دسترسی بارگذاری نشد. ")}{loadError}</p>}
    {rows !== null && rows.length === 0 && <p>{L("No grants were returned for this horse.", "مجوزی برای این اسب برگردانده نشد.")}</p>}
    {rows !== null && <div className="hdb-account-grant-list">{rows.map(row => <article key={row.id} className="hdb-account-grant">
      <header><h4 dir="auto">{row.grantee_user_id ? `${L("User", "کاربر")}: ${row.grantee_user_id}` : `${L("Organization", "سازمان")}: #${row.grantee_organization_id}`}</h4><span>{phase(row)}</span></header>
      <dl><div><dt>{L("Grant ID", "شناسه مجوز")}</dt><dd dir="ltr">{row.id}</dd></div><div><dt>{L("Profession", "حرفه")}</dt><dd>{L(...kindLabels[row.professional_kind])}</dd></div><div><dt>{L("Permissions", "مجوزها")}</dt><dd><ul>{row.permission_list.map(permission => <li key={permission}>{permissionLabels[permission as ProfessionalGrantPermission] ? L(...permissionLabels[permission as ProfessionalGrantPermission]) : permission}</li>)}</ul></dd></div><div><dt>{L("Professional authority reference", "مرجع صلاحیت حرفه‌ای")}</dt><dd dir="auto">{row.authority_ref}</dd></div><div><dt>{L("Assignment reference", "مرجع مأموریت")}</dt><dd dir="auto">{row.assignment_ref}</dd></div><div><dt>{L("Basis", "مبنای مجوز")}</dt><dd>{row.basis === "owner_consent" ? L("Owner consent", "رضایت مالک") : row.basis === "institution_assignment" ? L("Institution assignment", "مأموریت سازمانی") : L("Administrator grant", "مجوز مدیر")}{row.basis_ref && <span dir="auto"> — {row.basis_ref}</span>}</dd></div><div><dt>{L("Validity (UTC)", "اعتبار (UTC)")}</dt><dd>{date(row.valid_from)} — {row.valid_until ? date(row.valid_until) : L("No end date", "بدون تاریخ پایان")}</dd></div>{row.revoked_at && <div><dt>{L("Revocation", "لغو مجوز")}</dt><dd>{date(row.revoked_at)} <span dir="auto">{row.revoke_reason}</span></dd></div>}</dl>
      {canManage && !row.revoked_at && <RevokeGrant locale={locale} blocked={blocked} onRevoke={reason => void run(async signal => { const result = await platform.modules.professionalGrants.revoke(row.id, { reason }, { signal }); if (!result.revoked) throw new Error(L("Revocation was not confirmed. Reload the register.", "لغو مجوز تأیید نشد. دفتر را دوباره بارگذاری کنید.")); return L(`Grant ${row.id} revoked.`, `مجوز ${row.id} لغو شد.`); }, false)} />}
    </article>)}</div>}
    {canManage && <details><summary>{L("Assign professional access", "تعیین دسترسی حرفه‌ای")}</summary><GrantForm key={formRevision} locale={locale} horseId={horseId} blocked={blocked} onCreate={input => void run(async signal => { const result = await platform.modules.professionalGrants.create(input, { signal }); return L(`Grant ${result.grant.id} created.`, `مجوز ${result.grant.id} ایجاد شد.`); }, true)} /></details>}
  </div>;
}

function RevokeGrant({ locale, blocked, onRevoke }: { locale: Props["locale"]; blocked: boolean; onRevoke: (reason: string) => void }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [reason, setReason] = useState("");
  return <form className="hdb-account-inline" onSubmit={event => { event.preventDefault(); if (!blocked && reason.trim().length >= 3) onRevoke(reason.trim()); }}><label>{L("Reason for revocation", "دلیل لغو مجوز")}<input name="revocation_reason" value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} disabled={blocked} dir="auto" /></label><button type="submit" disabled={blocked || reason.trim().length < 3}>{L("Revoke this grant", "لغو این مجوز")}</button></form>;
}

function GrantForm({ locale, horseId, blocked, onCreate }: { locale: Props["locale"]; horseId: number; blocked: boolean; onCreate: (input: ProfessionalGrantCreateInput) => void }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [recipientType, setRecipientType] = useState<"user" | "organization">("user");
  const [recipient, setRecipient] = useState("");
  const [kind, setKind] = useState<ProfessionalKind>("veterinarian");
  const [permissions, setPermissions] = useState<ProfessionalGrantPermission[]>([]);
  const [basis, setBasis] = useState<ProfessionalGrantCreateInput["basis"]>("admin_grant");
  const [authority, setAuthority] = useState(""); const [assignment, setAssignment] = useState(""); const [basisRef, setBasisRef] = useState("");
  const [from, setFrom] = useState(""); const [until, setUntil] = useState(""); const [error, setError] = useState("");
  const needsRead = permissions.includes("genetic_review") && !permissions.includes("genetic_evidence_read");
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); if (blocked) return; setError("");
    if (!recipient.trim() || (recipientType === "organization" && !positiveId(recipient))) { setError(L("Enter an exact active user ID or organization ID.", "شناسه دقیق کاربر فعال یا سازمان را وارد کنید.")); return; }
    if (!permissions.length) { setError(L("Choose at least one permission.", "حداقل یک مجوز انتخاب کنید.")); return; }
    if (authority.trim().length < 3 || assignment.trim().length < 3 || (basis !== "admin_grant" && basisRef.trim().length < 3)) { setError(L("Provide the authority, assignment and required consent or institution evidence references.", "مراجع صلاحیت، مأموریت و مدرک رضایت یا سازمان را در صورت نیاز وارد کنید.")); return; }
    const start = from ? new Date(from) : null; const end = until ? new Date(until) : null;
    if ((start && !Number.isFinite(start.getTime())) || (end && (!Number.isFinite(end.getTime()) || end.getTime() <= (start?.getTime() ?? Date.now())))) { setError(L("The end date must be after the start date, or after now when no start date is set.", "تاریخ پایان باید پس از تاریخ شروع باشد؛ اگر تاریخ شروع مشخص نیست، باید پس از زمان فعلی باشد.")); return; }
    onCreate({ horse_id: horseId, ...(recipientType === "user" ? { grantee_user_id: recipient.trim() } : { grantee_organization_id: Number(digits(recipient.trim())) }), professional_kind: kind, permissions: [...permissions], authority_ref: authority.trim(), assignment_ref: assignment.trim(), basis, basis_ref: basisRef.trim() || null, valid_from: start?.toISOString() ?? null, valid_until: end?.toISOString() ?? null });
  };
  return <form className="hdb-account-form" onSubmit={submit}><fieldset disabled={blocked}><legend>{L(`New access for horse #${horseId}`, `دسترسی جدید برای اسب #${horseId}`)}</legend>
    <p>{L("Verify the professional's identity, authority and assignment before creating a grant. Account roles and subscription plans do not prove professional authority.", "پیش از ساخت مجوز، هویت، صلاحیت و مأموریت متخصص را بررسی کنید. نقش حساب و طرح اشتراک، صلاحیت حرفه‌ای را اثبات نمی‌کنند.")}</p>
    <div className="hdb-account-columns"><label>{L("Recipient type", "نوع دریافت‌کننده")}<select name="grant_recipient_type" value={recipientType} onChange={event => { setRecipientType(event.target.value as typeof recipientType); setRecipient(""); }}><option value="user">{L("One user", "یک کاربر")}</option><option value="organization">{L("One organization", "یک سازمان")}</option></select></label><label>{recipientType === "user" ? L("Exact user ID", "شناسه دقیق کاربر") : L("Exact organization ID", "شناسه دقیق سازمان")}<input name="grant_recipient" required maxLength={120} value={recipient} onChange={event => setRecipient(recipientType === "organization" ? digits(event.target.value) : event.target.value)} inputMode={recipientType === "organization" ? "numeric" : "text"} dir="ltr" /></label></div>
    <label>{L("Profession", "حرفه")}<select name="grant_profession" value={kind} onChange={event => { const next = event.target.value as ProfessionalKind; setKind(next); setPermissions(current => current.filter(permission => PROFESSIONAL_KIND_PERMISSIONS[next].includes(permission))); }}>{PROFESSIONAL_KINDS.map(value => <option key={value} value={value}>{L(...kindLabels[value])}</option>)}</select></label>
    <fieldset className="hdb-account-permission-options"><legend>{L("Explicit permissions", "مجوزهای مشخص")}</legend>{PROFESSIONAL_KIND_PERMISSIONS[kind].map(permission => <label key={permission}><input type="checkbox" name="grant_permission" value={permission} checked={permissions.includes(permission)} onChange={event => setPermissions(current => event.target.checked ? [...current, permission] : current.filter(value => value !== permission))} />{L(...permissionLabels[permission])}</label>)}</fieldset>
    {needsRead && <p className="hdb-account-warning">{L("Genetic review also requires a current private genetic evidence reading grant for this horse. Add it here only if needed; an existing separate grant can provide it. Submission and publication are separate permissions.", "بررسی ژنتیک به مجوز معتبر خواندن مدارک خصوصی ژنتیک این اسب نیز نیاز دارد. فقط در صورت نیاز آن را اینجا اضافه کنید؛ یک مجوز جداگانه موجود نیز کافی است. ثبت و انتشار، مجوزهای جداگانه هستند.")}</p>}
    <label>{L("Professional authority reference", "مرجع صلاحیت حرفه‌ای")}<input name="grant_authority" required minLength={3} maxLength={200} value={authority} onChange={event => setAuthority(event.target.value)} dir="auto" /></label>
    <label>{L("Assignment reference", "مرجع مأموریت")}<input name="grant_assignment" required minLength={3} maxLength={200} value={assignment} onChange={event => setAssignment(event.target.value)} dir="auto" /></label>
    <label>{L("Basis for access", "مبنای دسترسی")}<select name="grant_basis" value={basis} onChange={event => setBasis(event.target.value as typeof basis)}><option value="admin_grant">{L("Administrator grant", "مجوز مدیر")}</option><option value="owner_consent">{L("Owner consent", "رضایت مالک")}</option><option value="institution_assignment">{L("Institution assignment", "مأموریت سازمانی")}</option></select></label>
    <label>{basis === "admin_grant" ? L("Supporting reference (optional)", "مرجع پشتیبان (اختیاری)") : L("Consent / institution evidence reference", "مرجع مدرک رضایت / سازمان")}<input name="grant_basis_ref" required={basis !== "admin_grant"} minLength={basis === "admin_grant" ? undefined : 3} maxLength={200} value={basisRef} onChange={event => setBasisRef(event.target.value)} dir="auto" /></label>
    <p className="hdb-account-note">{L("Enter dates in your device's local timezone; they will be saved as UTC. Leave the start empty for immediate access and the end empty for no scheduled expiry.", "تاریخ‌ها را بر اساس منطقه زمانی دستگاه وارد کنید؛ به UTC ذخیره می‌شوند. شروع خالی یعنی دسترسی فوری و پایان خالی یعنی بدون انقضای زمان‌بندی‌شده.")}</p>
    <div className="hdb-account-columns"><label>{L("Starts (optional)", "شروع (اختیاری)")}<input name="grant_valid_from" type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} dir="ltr" /></label><label>{L("Ends (optional)", "پایان (اختیاری)")}<input name="grant_valid_until" type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} dir="ltr" /></label></div>
    {error && <p role="alert">{error}</p>}<button type="submit" disabled={!permissions.length}>{L("Create this grant", "ایجاد این مجوز")}</button>
  </fieldset></form>;
}
