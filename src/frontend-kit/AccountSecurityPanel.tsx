import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PlatformClient } from "../contracts/platform";
import type { MfaBeginResponse, MfaCommandResponse, MfaFactorCommandInput, MfaStatus } from "../contracts/mfa";
import { uiText, type UiLocale } from "../shared/uiLocale";
import "./account-controls.css";

type Props = { platform: PlatformClient; locale: UiLocale; scope: string };
const normalizeCode = (value: string) => value.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, character => String(character.charCodeAt(0) >= 0x06f0 ? character.charCodeAt(0) - 0x06f0 : character.charCodeAt(0) - 0x0660)).replace(/\D/g, "").slice(0, 6);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const isRefusal = (error: unknown) => typeof error === "object" && error !== null && "status" in error && Number(error.status) >= 400 && Number(error.status) < 500;

// Public, memory-only feedback survives the deliberate private-principal unmount
// when the SDK cannot confirm a cookie-changing security operation. It contains
// no user identity, credentials, enrollment data or account security snapshot.
let securityNotice: "pending" | "unconfirmed" | null = null;
let securityNoticeTicket = 0;
const securityNoticeListeners = new Set<() => void>();
const publishSecurityNotice = (notice: typeof securityNotice, ticket?: number) => {
  if (ticket !== undefined && ticket !== securityNoticeTicket) return;
  securityNotice = notice; securityNoticeListeners.forEach(listener => listener());
};
const subscribeSecurityNotice = (listener: () => void) => { securityNoticeListeners.add(listener); return () => { securityNoticeListeners.delete(listener); }; };
export function AccountSecuritySessionNotice({ platform, locale }: Pick<Props, "platform" | "locale">) {
  const notice = useSyncExternalStore(subscribeSecurityNotice, () => securityNotice, () => null);
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [checking, setChecking] = useState(false), [error, setError] = useState("");
  const checkFlight = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!notice) return null;
  return <section className="hdb-account-controls" aria-label={L("Account security update", "به‌روزرسانی امنیت حساب")}><p role={notice === "pending" ? "status" : "alert"}>{notice === "pending" ? L("Updating account security… Please wait before changing accounts.", "در حال به‌روزرسانی امنیت حساب… پیش از تغییر حساب منتظر بمانید.") : L("The security update or your current session could not be confirmed. Check account status, then reopen security settings to inspect the current authenticator before continuing.", "تغییر امنیت یا نشست فعلی شما تأیید نشد. وضعیت حساب را بررسی کنید، سپس تنظیمات امنیت را دوباره باز کرده و پیش از ادامه برنامه احراز هویت فعلی را بررسی کنید.")}</p>{notice === "unconfirmed" && <button type="button" disabled={checking} onClick={() => { if (checkFlight.current) return; checkFlight.current = true; setChecking(true); setError(""); void platform.auth.me().then(() => { securityNoticeTicket++; publishSecurityNotice(null); }).catch(error => { if (alive.current) setError(messageOf(error)); }).finally(() => { checkFlight.current = false; if (alive.current) setChecking(false); }); }}>{checking ? L("Checking account status…", "در حال بررسی وضعیت حساب…") : L("Check account status", "بررسی وضعیت حساب")}</button>}{error && <p role="alert" dir="auto">{error}</p>}</section>;
}

/** No enrollment key, password, one-time code or recovery code is persisted in browser storage. */
export function AccountSecurityPanel(props: Props) {
  return <AccountSecurityForPrincipal key={props.scope} {...props} />;
}

function AccountSecurityForPrincipal({ platform, locale }: Props) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [opened, setOpened] = useState(false), [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [enrollment, setEnrollment] = useState<MfaBeginResponse["enrollment"] | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null), [codesSaved, setCodesSaved] = useState(false);
  const [challenge, setChallenge] = useState(""), [activation, setActivation] = useState("");
  const [password, setPassword] = useState(""), [currentCode, setCurrentCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState(""), [recoveryCode, setRecoveryCode] = useState("");
  const [now, setNow] = useState(Date.now()), [formRevision, setFormRevision] = useState(0);
  const alive = useRef(false), flight = useRef(false), generation = useRef(0);
  const reader = useRef<AbortController | null>(null), writer = useRef<AbortController | null>(null);
  const clearInputs = () => { setChallenge(""); setActivation(""); setPassword(""); setCurrentCode(""); setRecoveryPassword(""); setRecoveryCode(""); setFormRevision(value => value + 1); };
  const load = async () => {
    if (flight.current) return;
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller;
    const version = ++generation.current;
    setLoading(true); setStatus(null); setError(""); clearInputs(); setRecoveryCodes(null); setCodesSaved(false);
    try {
      const result = await platform.auth.mfa.status({ signal: controller.signal });
      if (!alive.current || controller.signal.aborted || version !== generation.current) return;
      setStatus(result); setNow(Date.now()); setUncertain(false);
      if (securityNotice === "unconfirmed") { securityNoticeTicket++; publishSecurityNotice(null); }
      setEnrollment(current => current && current.id === result.pending_enrollment?.id && Date.parse(current.expires_at) > Date.now() ? current : null);
    } catch (error) { if (alive.current && !controller.signal.aborted && version === generation.current) { setError(messageOf(error)); setEnrollment(null); } }
    finally { if (alive.current && !controller.signal.aborted && version === generation.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; reader.current?.abort(); writer.current?.abort(); }; }, []);
  useEffect(() => { if (opened) void load(); return () => reader.current?.abort(); }, [opened, platform]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const future = [status?.verified_until, status?.recovery_replacement_until, enrollment?.expires_at].filter((value): value is string => Boolean(value)).map(Date.parse).filter(value => value > Date.now());
    if (!future.length) return;
    const timer = setTimeout(() => { setNow(Date.now()); if (enrollment && Date.parse(enrollment.expires_at) <= Date.now()) { setEnrollment(null); setActivation(""); setNotice(L("The setup key expired. Cancel the pending setup and start again.", "کلید راه‌اندازی منقضی شد. راه‌اندازی در انتظار را لغو کرده و دوباره شروع کنید.")); } }, Math.min(60_000, Math.min(...future) - Date.now() + 25));
    return () => clearTimeout(timer);
  }, [status?.verified_until, status?.recovery_replacement_until, enrollment, now, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async <T extends MfaCommandResponse>(execute: (signal: AbortSignal) => Promise<T>, after: (result: T) => void, acceptedMessage: string) => {
    if (flight.current || !alive.current || busy || loading || uncertain || !status?.available || status.policy === "disabled") return;
    flight.current = true; setBusy(true); setError(""); setNotice(""); clearInputs(); setRecoveryCodes(null); setCodesSaved(false);
    const noticeTicket = ++securityNoticeTicket; publishSecurityNotice("pending", noticeTicket);
    const controller = new AbortController(); writer.current = controller;
    try {
      const result = await execute(controller.signal);
      publishSecurityNotice(null, noticeTicket);
      if (!alive.current || controller.signal.aborted) return;
      setStatus(result.status); setNow(Date.now()); setNotice(acceptedMessage); after(result);
    } catch (error) {
      const sessionUnconfirmed = !isRefusal(error) || (typeof error === "object" && error !== null && "status" in error && [401, 403].includes(Number(error.status)));
      publishSecurityNotice(sessionUnconfirmed ? "unconfirmed" : null, noticeTicket);
      if (!alive.current || controller.signal.aborted) return;
      setError(messageOf(error));
      if (!isRefusal(error)) { setEnrollment(null); setUncertain(true); setStatus(null); }
      else if (typeof error === "object" && error !== null && "status" in error && [401, 409].includes(Number(error.status))) { setEnrollment(null); setStatus(null); }
    } finally { flight.current = false; if (alive.current && !controller.signal.aborted) setBusy(false); }
  };
  const blocked = busy || loading || uncertain;
  const replacing = Boolean(status?.recovery_replacement_until && Date.parse(status.recovery_replacement_until) > now);
  const verified = Boolean(status?.verified_until && Date.parse(status.verified_until) > now);
  const available = status?.available && status.policy !== "disabled";
  const formatDate = (value: string) => {
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date) : value;
  };
  return <section className="hdb-account-controls hdb-account-security" data-h-surface-role="panel" aria-label={L("Account security", "امنیت حساب")}>
    <header><h2>{L("Account security", "امنیت حساب")}</h2><p>{L("Manage your authenticator and verify your account before sensitive work.", "برنامه احراز هویت خود را مدیریت کرده و پیش از کارهای حساس، حساب خود را تأیید کنید.")}</p></header>
    {!opened ? <button type="button" onClick={() => setOpened(true)}>{L("Open security settings", "باز کردن تنظیمات امنیت")}</button> : <>
      <button type="button" disabled={busy || loading} onClick={() => void load()}>{L("Reload security status", "بارگذاری دوباره وضعیت امنیت")}</button>
      {loading && <p role="status">{L("Checking account security…", "در حال بررسی امنیت حساب…")}</p>}
      {error && <p role="alert" dir="auto">{error}</p>}
      {notice && <p role="status" className="hdb-account-success">{notice}</p>}
      {uncertain && <p role="alert" className="hdb-account-warning">{L("The response was lost. The security change may have completed. Reload security status before trying another action; do not reuse a submitted one-time code.", "پاسخ دریافت نشد. ممکن است تغییر امنیتی انجام شده باشد. پیش از اقدام دوباره وضعیت امنیت را بارگذاری کنید؛ کد یک‌بارمصرف ارسال‌شده را دوباره استفاده نکنید.")}</p>}
      {status && <>
        <dl><div><dt>{L("Authenticator", "برنامه احراز هویت")}</dt><dd>{status.enrolled ? L("Enabled", "فعال") : L("Not enabled", "فعال نیست")}</dd></div><div><dt>{L("Sensitive-action verification", "تأیید عملیات حساس")}</dt><dd>{verified ? L(`Verified until ${formatDate(status.verified_until!)}`, `تأییدشده تا ${formatDate(status.verified_until!)}`) : L("A fresh authenticator check is needed", "بررسی تازه با برنامه احراز هویت لازم است")}</dd></div>{status.enrolled && <div><dt>{L("Unused recovery codes", "کدهای بازیابی استفاده‌نشده")}</dt><dd>{status.recovery_codes_remaining}</dd></div>}</dl>
        {!available && <p className="hdb-account-warning">{L("Authenticator security is unavailable in this environment. No setup or verification can be completed here until the administrator enables the service.", "امنیت برنامه احراز هویت در این محیط در دسترس نیست. تا زمانی که مدیر سرویس را فعال نکند، راه‌اندازی یا تأیید در اینجا انجام نمی‌شود.")}</p>}
        {available && <>
          {replacing && <p className="hdb-account-warning" role="status">{L(`Recovery only allows replacement of your authenticator until ${formatDate(status.recovery_replacement_until!)}. It does not authorize sensitive operations. Set up a new authenticator now.`, `بازیابی فقط تا ${formatDate(status.recovery_replacement_until!)} اجازه جایگزینی برنامه احراز هویت را می‌دهد و مجوز عملیات حساس نیست. اکنون برنامه جدید را راه‌اندازی کنید.`)}</p>}
          {status.enrolled && !replacing && <form className="hdb-account-inline" onSubmit={event => { event.preventDefault(); if (challenge.length !== 6) return; const code = challenge; void run(signal => platform.auth.mfa.challenge({ code }, { signal }), () => {}, L("Authenticator check completed. Return to your workflow and reload current access before continuing.", "بررسی با برنامه احراز هویت انجام شد. به کار خود برگردید و پیش از ادامه، دسترسی فعلی را تازه‌سازی کنید.")); }}><label>{L("Current authenticator code", "کد فعلی برنامه احراز هویت")}<input name="mfa_challenge" value={challenge} onChange={event => setChallenge(normalizeCode(event.target.value))} required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" disabled={blocked} dir="ltr" /></label><button type="submit" disabled={blocked || challenge.length !== 6}>{L("Verify for sensitive actions", "تأیید برای عملیات حساس")}</button></form>}
          {status.pending_enrollment && <div className="hdb-account-stack"><h3>{L("Pending authenticator setup", "راه‌اندازی در انتظار برنامه احراز هویت")}</h3>{enrollment && enrollment.id === status.pending_enrollment.id ? <>
            <p>{L("Add this private key to your authenticator app, then enter a code from that app. The key is shown only in this open setup.", "این کلید خصوصی را به برنامه احراز هویت اضافه کنید، سپس کد همان برنامه را وارد کنید. کلید فقط در همین راه‌اندازی باز نمایش داده می‌شود.")}</p>
            <label>{L("Manual setup key", "کلید راه‌اندازی دستی")}<input name="mfa_setup_secret" value={enrollment.secret} readOnly autoComplete="off" spellCheck={false} dir="ltr" /></label>
            {enrollment.otpauth_uri.startsWith("otpauth://totp/") && <a href={enrollment.otpauth_uri}>{L("Open in an installed authenticator app", "باز کردن در برنامه احراز هویت نصب‌شده")}</a>}
            <p className="hdb-account-note">{L(`This setup expires at ${formatDate(enrollment.expires_at)}.`, `این راه‌اندازی در ${formatDate(enrollment.expires_at)} منقضی می‌شود.`)}</p>
            <form className="hdb-account-inline" onSubmit={event => { event.preventDefault(); if (activation.length !== 6 || Date.parse(enrollment.expires_at) <= Date.now()) return; const input = { enrollment_id: enrollment.id, code: activation, expected_factor_version: status.factor_version }; void run(signal => platform.auth.mfa.activate(input, { signal }), response => { setEnrollment(null); setRecoveryCodes(response.recovery_codes); }, L("Authenticator enabled. Save your new recovery codes now.", "برنامه احراز هویت فعال شد. کدهای بازیابی جدید خود را اکنون ذخیره کنید.")); }}><label>{L("Code from the new authenticator", "کد برنامه احراز هویت جدید")}<input name="mfa_activation" value={activation} onChange={event => setActivation(normalizeCode(event.target.value))} required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" disabled={blocked} dir="ltr" /></label><button type="submit" disabled={blocked || activation.length !== 6}>{L("Activate authenticator", "فعال‌سازی برنامه احراز هویت")}</button></form>
          </> : <p>{L("A setup is pending, but its private key is unavailable in this page. Cancel it and start again to obtain a new key.", "یک راه‌اندازی در انتظار است، اما کلید خصوصی آن در این صفحه موجود نیست. آن را لغو کرده و برای دریافت کلید جدید دوباره شروع کنید.")}</p>}
            <button type="button" disabled={blocked} onClick={() => { const input = { enrollment_id: status.pending_enrollment!.id, expected_factor_version: status.factor_version }; void run(signal => platform.auth.mfa.cancelEnrollment(input, { signal }), () => setEnrollment(null), L("Pending setup cancelled.", "راه‌اندازی در انتظار لغو شد.")); }}>{L("Cancel pending setup", "لغو راه‌اندازی در انتظار")}</button>
          </div>}
          {!status.pending_enrollment && <details open={!status.enrolled || replacing}><summary>{status.enrolled ? L("Replace authenticator", "جایگزینی برنامه احراز هویت") : L("Set up an authenticator", "راه‌اندازی برنامه احراز هویت")}</summary><form className="hdb-account-form" onSubmit={event => { event.preventDefault(); if (!password || (status.enrolled && !replacing && currentCode.length !== 6)) return; const input = { current_password: password, ...(currentCode ? { current_code: currentCode } : {}), expected_factor_version: status.factor_version }; void run(signal => platform.auth.mfa.beginEnrollment(input, { signal }), response => setEnrollment(response.enrollment), L("Setup started. Add the private key and verify the new authenticator.", "راه‌اندازی شروع شد. کلید خصوصی را اضافه کرده و برنامه جدید را تأیید کنید.")); }}><fieldset disabled={blocked}>
            <label>{L("Current account password", "گذرواژه فعلی حساب")}<input name="mfa_setup_password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
            {status.enrolled && !replacing && <label>{L("Current authenticator code", "کد فعلی برنامه احراز هویت")}<input name="mfa_replace_code" value={currentCode} onChange={event => setCurrentCode(normalizeCode(event.target.value))} required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" dir="ltr" /></label>}
            <button type="submit" disabled={!password || (status.enrolled && !replacing && currentCode.length !== 6)}>{L("Start authenticator setup", "شروع راه‌اندازی برنامه احراز هویت")}</button>
          </fieldset></form></details>}
          {recoveryCodes && <div className="hdb-account-warning" role="region" aria-label={L("New recovery codes", "کدهای بازیابی جدید")}><h3>{L("Save these recovery codes once", "این کدهای بازیابی را اکنون ذخیره کنید")}</h3><p>{L("Store them in a secure password manager or another private place. Each code can be used once and only starts authenticator replacement. These codes will not be shown again after leaving or reloading this panel.", "کدها را در مدیر گذرواژه امن یا جای خصوصی دیگری ذخیره کنید. هر کد یک‌بار قابل استفاده است و فقط جایگزینی برنامه احراز هویت را آغاز می‌کند. پس از خروج یا بارگذاری دوباره این بخش، کدها دوباره نمایش داده نمی‌شوند.")}</p><pre dir="ltr">{recoveryCodes.join("\n")}</pre><label className="hdb-account-check"><input name="mfa_codes_saved" type="checkbox" checked={codesSaved} onChange={event => setCodesSaved(event.target.checked)} />{L("I saved the recovery codes privately", "کدهای بازیابی را به‌صورت خصوصی ذخیره کردم")}</label><button type="button" disabled={!codesSaved} onClick={() => { setRecoveryCodes(null); setCodesSaved(false); }}>{L("Hide saved recovery codes", "پنهان کردن کدهای بازیابی ذخیره‌شده")}</button></div>}
          {status.enrolled && !replacing && <>
            <details><summary>{L("Lost access to your authenticator?", "دسترسی به برنامه احراز هویت را از دست داده‌اید؟")}</summary><p>{L("Use one unused recovery code and your current password. You must then replace and activate your authenticator before sensitive work can resume.", "از یک کد بازیابی استفاده‌نشده و گذرواژه فعلی استفاده کنید. سپس باید پیش از ادامه کار حساس، برنامه احراز هویت را جایگزین و فعال کنید.")}</p><form className="hdb-account-form" onSubmit={event => { event.preventDefault(); if (!recoveryPassword || !recoveryCode.trim()) return; const input = { current_password: recoveryPassword, recovery_code: recoveryCode.trim() }; void run(signal => platform.auth.mfa.recover(input, { signal }), () => setEnrollment(null), L("Recovery accepted for authenticator replacement only. Set up your replacement now.", "بازیابی فقط برای جایگزینی برنامه احراز هویت پذیرفته شد. اکنون جایگزین را راه‌اندازی کنید.")); }}><fieldset disabled={blocked}><label>{L("Current account password", "گذرواژه فعلی حساب")}<input name="mfa_recovery_password" type="password" autoComplete="current-password" required value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} /></label><label>{L("Unused recovery code", "کد بازیابی استفاده‌نشده")}<input name="mfa_recovery_code" autoComplete="off" spellCheck={false} required value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} dir="ltr" /></label><button type="submit" disabled={!recoveryPassword || !recoveryCode.trim()}>{L("Begin recovery and replacement", "شروع بازیابی و جایگزینی")}</button></fieldset></form></details>
            <FactorActionForm key={`rotate:${formRevision}`} locale={locale} blocked={blocked} action="rotate" onSubmit={input => void run(signal => platform.auth.mfa.rotateRecoveryCodes({ ...input, expected_factor_version: status.factor_version }, { signal }), response => setRecoveryCodes(response.recovery_codes), L("Recovery codes replaced. Previous codes no longer work. Save the new codes now.", "کدهای بازیابی جایگزین شدند. کدهای قبلی دیگر کار نمی‌کنند. کدهای جدید را اکنون ذخیره کنید."))} />
            <FactorActionForm key={`disable:${formRevision}`} locale={locale} blocked={blocked} action="disable" onSubmit={input => void run(signal => platform.auth.mfa.disable({ ...input, expected_factor_version: status.factor_version }, { signal }), () => setEnrollment(null), L("Authenticator disabled. If required by policy, sensitive work stays blocked until an authenticator is enabled again.", "برنامه احراز هویت غیرفعال شد. اگر سیاست سامانه الزام کند، کار حساس تا فعال‌سازی دوباره برنامه مسدود می‌ماند."))} />
          </>}
        </>}
        <details><summary>{L("Recent security events", "رویدادهای امنیتی اخیر")}</summary>{status.recent_events.length ? <ul>{status.recent_events.map(event => <li key={event.id}><span dir="auto">{securityEventLabel(event.event_type, locale)}</span> · <time dateTime={event.created_at}>{formatDate(event.created_at)}</time></li>)}</ul> : <p>{L("No recent security events were returned.", "رویداد امنیتی اخیری برگردانده نشد.")}</p>}</details>
      </>}
    </>}
  </section>;
}

function FactorActionForm({ locale, blocked, action, onSubmit }: { locale: UiLocale; blocked: boolean; action: "rotate" | "disable"; onSubmit: (input: Omit<MfaFactorCommandInput, "expected_factor_version">) => void }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [password, setPassword] = useState(""), [code, setCode] = useState(""), [confirmed, setConfirmed] = useState(false);
  return <details><summary>{action === "rotate" ? L("Replace recovery codes", "جایگزینی کدهای بازیابی") : L("Disable authenticator", "غیرفعال کردن برنامه احراز هویت")}</summary><form className="hdb-account-form" onSubmit={event => { event.preventDefault(); if (blocked || !password || code.length !== 6 || !confirmed) return; const input = { current_password: password, current_code: code }; setPassword(""); setCode(""); setConfirmed(false); onSubmit(input); }}><fieldset disabled={blocked}>
    <label>{L("Current account password", "گذرواژه فعلی حساب")}<input name={`mfa_${action}_password`} type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><label>{L("Current authenticator code", "کد فعلی برنامه احراز هویت")}<input name={`mfa_${action}_code`} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={event => setCode(normalizeCode(event.target.value))} dir="ltr" /></label>
    <label className="hdb-account-check"><input name={`mfa_${action}_confirm`} type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{action === "rotate" ? L("I understand that all previous recovery codes will stop working", "می‌دانم که همه کدهای بازیابی قبلی از کار می‌افتند") : L("I understand that disabling removes this authenticator and may block sensitive work", "می‌دانم که غیرفعال‌سازی این برنامه را حذف می‌کند و ممکن است کار حساس را مسدود کند")}</label><button type="submit" disabled={!password || code.length !== 6 || !confirmed}>{action === "rotate" ? L("Replace recovery codes now", "جایگزینی کدهای بازیابی اکنون") : L("Disable this authenticator", "غیرفعال کردن این برنامه احراز هویت")}</button>
  </fieldset></form></details>;
}

function securityEventLabel(value: string, locale: UiLocale): string {
  const labels: Record<string, [string, string]> = {
    enrollment_started: ["Authenticator setup started", "راه‌اندازی برنامه احراز هویت شروع شد"],
    enrollment_cancelled: ["Authenticator setup cancelled", "راه‌اندازی برنامه احراز هویت لغو شد"],
    factor_activated: ["Authenticator activated", "برنامه احراز هویت فعال شد"],
    factor_replaced: ["Authenticator replaced", "برنامه احراز هویت جایگزین شد"],
    step_up_verified: ["Authenticator verified", "برنامه احراز هویت بررسی شد"],
    recovery_code_used: ["Recovery authorized factor replacement", "بازیابی، جایگزینی برنامه را مجاز کرد"],
    recovery_codes_rotated: ["Recovery codes replaced", "کدهای بازیابی جایگزین شدند"],
    factor_disabled: ["Authenticator disabled", "برنامه احراز هویت غیرفعال شد"],
  };
  const key = value.replace(/^mfa[._]/, "");
  return labels[key] ? uiText(locale, ...labels[key]) : value;
}
