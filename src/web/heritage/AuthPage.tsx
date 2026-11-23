import { HERITAGE_DECORATION } from "../assetCatalog";
import { uiText } from "../../shared/uiLocale";
import React, { useRef, useState } from "react";
import type { PlatformClient, PlatformUser } from "../../contracts/platform";
import { useI18n } from "../i18n";
import { PersonIcon } from "./icons";
import { AccountSecurityPanel, AccountSecuritySessionNotice } from "../shared/AccountSecurityPanel";
import "../styles/heritage.workbenches.css";

// R47b public auth page (client requirement: ورود/ثبت‌نام + SMS).
// Three flows: password login, email registration (verification link surfaced in
// demo mode), and mobile OTP (code surfaced in demo mode — no SMS provider yet).

export type HeritageAuthNotice = "signing-out" | "signout-unconfirmed" | null;

export function HeritageAuthPage({ platform, user, navigate, authNotice, setAuthNotice }: {
  platform: PlatformClient;
  user: PlatformUser | null;
  navigate: (path: string) => void;
  authNotice: HeritageAuthNotice;
  setAuthNotice: (notice: HeritageAuthNotice) => void;
}) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [mode, setMode] = useState<"login" | "register" | "otp">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionStatus, setSessionStatus] = useState("");
  const signingOut = authNotice === "signing-out";
  const controlsBusy = busy || signingOut;
  const flight = useRef(false);
  const mounted = useRef(false);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [notice, setNotice] = useState("");
  const [verifyUrl, setVerifyUrl] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regRole, setRegRole] = useState<"user" | "owner">("owner");



  const run = async (action: () => Promise<void>) => {
    if (flight.current || controlsBusy || !mounted.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setSessionStatus("");
    try { await action(); } catch (e) { if (mounted.current) setError((e as Error).message); } finally { flight.current = false; if (mounted.current) setBusy(false); }
  };

  const signOut = async () => {
    if (flight.current || controlsBusy || !mounted.current) return;
    flight.current = true;
    setError("");
    // This non-private notice belongs to the shell: logout immediately masks
    // authority and remounts this page before its network response arrives.
    setAuthNotice("signing-out");
    try {
      const pending = platform.auth.logout();
      navigate("/login");
      await pending;
      setAuthNotice(null);
    } catch {
      setAuthNotice("signout-unconfirmed");
    } finally {
      flight.current = false;
    }
  };

  const sessionFeedback = <>
    <AccountSecuritySessionNotice platform={platform} locale={locale}/>
    {signingOut && <p role="status" className="h-mod-note">{L("Signing out… Please wait before signing in again.", "در حال خروج… لطفاً پیش از ورود دوباره منتظر بمانید.")}</p>}
    {authNotice === "signout-unconfirmed" && <div>
      <p role="alert" className="h-mod-message error">{L("Sign-out could not be confirmed. Your browser may still have an active session. Check account status to see whether you need to sign out again.", "خروج از حساب تأیید نشد. ممکن است نشست حساب در مرورگر شما همچنان فعال باشد. وضعیت حساب را بررسی کنید تا مشخص شود آیا باید دوباره خارج شوید.")}</p>
      <button type="button" className="h-mod-action ghost" disabled={controlsBusy} onClick={() => void run(async () => {
        const session = await platform.auth.me();
        setAuthNotice(null);
        if (mounted.current && !session.user) setSessionStatus(L("You are signed out. You can sign in again.", "از حساب خارج شده‌اید. می‌توانید دوباره وارد شوید."));
      })}>{busy ? L("Checking account status…", "در حال بررسی وضعیت حساب…") : L("Check account status", "بررسی وضعیت حساب")}</button>
    </div>}
    {sessionStatus && <p role="status" className="h-mod-note">{sessionStatus}</p>}
  </>;

  if (user) {
    const role = ({ user: L("Member", "عضو"), owner: L("Owner / breeder account", "حساب مالک / پرورش‌دهنده"), admin: L("Administrator", "مدیر سامانه"), staff: L("Staff", "کارکنان") } as Record<string, string>)[user.role] ?? user.role;
    return <main className="page heritage-operations-page h-account-page">
      <header className="section-title" data-h-surface-role="major"><div><span>{L("ACCOUNT", "حساب کاربری")}</span><h1>{L("Your account", "حساب شما")}</h1><p>{L("Manage your work, requests and representation from one place.", "کارها، درخواست‌ها و نمایندگی خود را از یک‌جا مدیریت کنید.")}</p></div></header>
      <section data-h-surface-role="panel" aria-label={L("Signed-in account", "حساب واردشده")}>
        <dl className="h-account-details"><div><dt>{L("Name", "نام")}</dt><dd dir="auto">{user.display_name}</dd></div><div><dt>{L("Email", "ایمیل")}</dt><dd dir="ltr">{user.email}</dd></div><div><dt>{L("Account role", "نقش حساب")}</dt><dd>{role}</dd></div></dl>
        <p className="h-mod-state-note">{L("Horse ownership and professional representation are reviewed separately from your account role.", "مالکیت اسب و نمایندگی حرفه‌ای جدا از نقش حساب شما بررسی می‌شوند.")}</p>
        <div className="h-account-actions"><button type="button" onClick={() => navigate("/workspaces")}>{L("My workspaces", "فضاهای کاری من")}</button><button type="button" onClick={() => navigate("/services")}>{L("Service requests", "درخواست‌های خدمات")}</button><button type="button" onClick={() => navigate("/directory/claims")}>{L("Representation & claims", "نمایندگی و درخواست‌ها")}</button><button type="button" onClick={() => navigate("/f/heritage/desk")}>{L("Registry requests", "درخواست‌های سامانه")}</button></div>
        {error && <p role="alert">{error}</p>}
        {sessionFeedback}
        <button type="button" disabled={controlsBusy} onClick={() => void signOut()}>{signingOut ? L("Signing out…", "در حال خروج…") : L("Sign out", "خروج از حساب")}</button>
      </section>
      <AccountSecurityPanel platform={platform} locale={locale} scope={user.id}/>
    </main>;
  }

  return <main className="page h-mod-auth">
    <header className="h-mod-page-head premium-page-head" data-h-surface-role="major">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule"></span>{L("ACCOUNT", "حساب کاربری")}</div>
        <h1>{L("Sign in to the registry", "ورود به سامانه ثبت")}</h1>
        <p>{L("Owners, breeders and federation staff use one account system. Register with email or your mobile number.", "مالکان، پرورش‌دهندگان و کارکنان فدراسیون از یک سامانه حساب استفاده می‌کنند. با ایمیل یا شماره موبایل ثبت‌نام کنید.")}</p>
      </div>
      <div className="h-mod-count browse-count"><small>{L("one account", "یک حساب")}</small><strong><PersonIcon size={26}/></strong><span>{L("for every role", "برای همه نقش‌ها")}</span></div>
      <img className="page-head-ornament" src={HERITAGE_DECORATION.divider} alt=""/>
    </header>
    <div className="h-mod-auth-stage" data-h-surface-role="major">
    <div className="h-mod-auth-card">
      {sessionFeedback}
      <nav className="h-mod-auth-tabs" aria-label={L("Sign-in methods", "روش‌های ورود")}>
        <button type="button" disabled={controlsBusy} aria-pressed={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setNotice(""); setError(""); }}>{L("Sign in", "ورود")}</button>
        <button type="button" disabled={controlsBusy} aria-pressed={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setNotice(""); setError(""); }}>{L("Register", "ثبت‌نام")}</button>
        <button type="button" disabled={controlsBusy} aria-pressed={mode === "otp"} className={mode === "otp" ? "active" : ""} onClick={() => { setMode("otp"); setNotice(""); setError(""); setOtpSent(false); setDemoCode(""); }}>{L("Mobile OTP", "کد پیامکی")}</button>
      </nav>
      {mode === "login" && <form className="h-mod-auth-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await platform.auth.login({ email: loginEmail, password: loginPassword }); }); }}>
        <label>{L("Email", "ایمیل")}<input disabled={controlsBusy} type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required autoComplete="email" dir="auto"/></label>
        <label>{L("Password", "گذرواژه")}<input disabled={controlsBusy} type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required minLength={8} autoComplete="current-password"/></label>
        <button className="h-mod-action" disabled={controlsBusy || !loginEmail || !loginPassword}>{busy ? L("Signing in…", "در حال ورود…") : L("Sign in", "ورود")}</button>
        <p className="h-mod-note">{L("Federation staff accounts are provisioned by the administrator.", "حساب‌های کارکنان فدراسیون توسط مدیر سامانه ایجاد می‌شوند.")}</p>
      </form>}
      {mode === "register" && <form className="h-mod-auth-form" onSubmit={(e) => { e.preventDefault(); void run(async () => {
        const result = await platform.modules.authExt.register({ email: regEmail, password: regPassword, display_name: regName, role: regRole });
        if (result.emailVerification) {
          setVerifyUrl(result.emailVerification.demoTokenUrl ?? "");
          setNotice(result.emailVerification.demoNotice);
        }
      }); }}>
        <label>{L("Display name", "نام نمایشی")}<input disabled={controlsBusy} autoComplete="name" value={regName} onChange={(e) => setRegName(e.target.value)} required minLength={2} dir="auto"/></label>
        <label>{L("Email", "ایمیل")}<input disabled={controlsBusy} autoComplete="email" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required dir="auto"/></label>
        <label>{L("Password (8+ characters)", "گذرواژه (حداقل ۸ نویسه)")}<input disabled={controlsBusy} type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required minLength={8} autoComplete="new-password"/></label>
        <label>{L("I am registering as", "نقش من")}<select disabled={controlsBusy} value={regRole} onChange={(e) => setRegRole(e.target.value as "user" | "owner")}>
          <option value="owner">{L("Horse owner / breeder", "مالک / پرورش‌دهنده اسب")}</option>
          <option value="user">{L("Enthusiast / buyer", "علاقه‌مند / خریدار")}</option>
        </select></label>
        <button className="h-mod-action" disabled={controlsBusy || !regEmail || !regPassword || !regName}>{busy ? L("Creating account…", "در حال ایجاد حساب…") : L("Create account", "ایجاد حساب")}</button>
        {notice && <p className="h-mod-note" dir="auto">{notice}</p>}
        {verifyUrl && <a className="h-mod-action ghost" href={verifyUrl} target="_blank" rel="noreferrer">{L("Verify email now (demo link)", "تأیید ایمیل (لینک نمایشی)")}</a>}
        <p className="h-mod-note">{L("Submitted records are reviewed before publication.", "اطلاعات ارسالی پیش از انتشار بررسی می‌شوند.")}</p>
      </form>}
      {mode === "otp" && <form className="h-mod-auth-form" onSubmit={(e) => { e.preventDefault(); if (otpSent) void run(async () => { await platform.modules.authExt.otpVerify({ phone: otpPhone, code: otpCode }); }); }}>
        <label>{L("Mobile number", "شماره موبایل")}<input disabled={controlsBusy} autoComplete="tel" value={otpPhone} onChange={(e) => { setOtpPhone(e.target.value); setOtpSent(false); setOtpCode(""); setDemoCode(""); setNotice(""); }} placeholder="0912 123 4567" inputMode="tel" required dir="auto"/></label>
        {otpSent && <label>{L("Verification code", "کد تأیید")}<input disabled={controlsBusy} autoComplete="one-time-code" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, c => String(c.charCodeAt(0) >= 0x06f0 ? c.charCodeAt(0) - 0x06f0 : c.charCodeAt(0) - 0x0660)).replace(/\D/g, "").slice(0, 6))} placeholder="123456" inputMode="numeric" required dir="auto"/></label>}
        {otpSent
          ? <button className="h-mod-action" disabled={controlsBusy || otpCode.length !== 6}>{busy ? L("Verifying…", "در حال تأیید…") : L("Verify & sign in", "تأیید و ورود")}</button>
          : <button className="h-mod-action" disabled={controlsBusy || otpPhone.trim().length < 8} onClick={(e) => { e.preventDefault(); void run(async () => { const result = await platform.modules.authExt.otpRequest(otpPhone.trim()); setOtpSent(true); setDemoCode(result.demoCode ?? ""); setNotice(result.demoNotice ?? ""); }); }}>{busy ? L("Sending…", "در حال ارسال…") : L("Send code", "ارسال کد")}</button>}
        {demoCode && <p className="h-mod-demo-code" dir="auto">{L("Demo code", "کد نمایشی")}: <b>{demoCode}</b></p>}
        <p className="h-mod-note">{L("SMS delivery is not wired in this demo, so the code is shown here.", "در این نسخه نمایشی پیامک فعال نیست و کد همین‌جا نمایش داده می‌شود.")}</p>
      </form>}
      {error && <p role="alert" className="h-mod-message error" dir="auto">{error}</p>}
    </div>
    </div>
  </main>;
}
