import React, { useState } from "react";
import {
  usePrincipalScope,
  useHorseCredentialStories,
  useAttestationVerification,
  useIssuerDirectory,
  useCredentialStoryCommands,
  runSnapshotReview,
  type PlatformClient,
  type PlatformUser,
  type CredentialStoryRow, kitText } from "../../../frontend-kit";

/**
 * R117-16 (Master AI R117 handoff D24) — Classic Registry's compact NATIVE
 * credential desk (host layer, iframe boundary intact) over the ONE shared
 * headless credential-stories controller: the PUBLIC read projection for a
 * chosen horse, the PUBLIC verification states (current / expired / revoked /
 * superseded / source_changed — a revocation or expiry changes the VISIBLE
 * current status without ever rewriting the recorded snapshot), the
 * member-scoped issue form, the owner-scoped revoke/supersede and the PRIVATE
 * snapshot review. No demo badge implies real federation, ownership or
 * laboratory approval; issuers on the synthetic instance are explicitly
 * fictional with narrow approved scopes.
 */

const panel: React.CSSProperties = { border: "1px solid #92400e", background: "#fffbeb", padding: "12px", margin: "10px 0", borderRadius: "4px" };
const label: React.CSSProperties = { display: "block", margin: "8px 0", fontSize: "14px" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: "6px", marginTop: "4px", border: "1px solid #92400e", borderRadius: "3px", boxSizing: "border-box" };
const button: React.CSSProperties = { padding: "8px 14px", background: "#92400e", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer", marginTop: "8px" };
const buttonGhost: React.CSSProperties = { ...button, background: "#fff", color: "#92400e", border: "1px solid #92400e" };
const alertBox: React.CSSProperties = { ...panel, borderColor: "#b91c1c", background: "#fef2f2" };
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #fde68a", flexWrap: "wrap" };

const VERIFY_STATE_LABEL: Record<string, [string, string]> = {
  current: ["Current — sources unchanged since issuance", "معتبر — منابع از زمان صدور تغییر نکرده‌اند"],
  expired: ["Expired — the validity window has passed; the recorded snapshot is preserved", "منقضی — پنجره اعتبار گذشته است؛ تصویر ثبت‌شده حفظ می‌شود"],
  revoked: ["Revoked by the issuer; the recorded snapshot is preserved", "لغوشده توسط مرجع؛ تصویر ثبت‌شده حفظ می‌شود"],
  superseded: ["Superseded by a newer attestation of the same record", "جایگزین‌شده توسط تأیید جدیدتر همان رکورد"],
  source_changed: ["Source record changed after issuance — the attested snapshot no longer matches", "رکورد منبع بعد از صدور تغییر کرده — تصویر تأییدشده دیگر منطبق نیست"],
  snapshot_tampered: ["Snapshot digest mismatch — the stored evidence fails its own integrity check", "عدم تطابق چکیده تصویر — شواهد ذخیره‌شده در بررسی یکپارچگی خودش مردود است"],
  unbound_legacy: ["Legacy record without a bound snapshot; requires review", "رکورد قدیمی بدون تصویر پیوند‌شده؛ نیازمند بررسی"],
};

export function ClassicRegistryCredentialDesk({ platform, user, locale = "en" }: { platform: PlatformClient | null; user?: PlatformUser | null; locale?: "en" | "fa" | "ar" }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const scope = usePrincipalScope(user ?? null, null);
  const [horseInput, setHorseInput] = useState("");
  const [horseId, setHorseId] = useState<number | null>(null);
  const { stories, retry } = useHorseCredentialStories({ platform, scope, horseId });
  const { directory } = useIssuerDirectory({ platform, scope });
  const commands = useCredentialStoryCommands(scope);
  const [issuerId, setIssuerId] = useState("");
  const [recordKind, setRecordKind] = useState<"genetic_test" | "horse_identity">("genetic_test");
  const [recordId, setRecordId] = useState("");
  const [statement, setStatement] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  return <div data-surface="credential-stories">
    <p style={panel}>{L("Issuer credentials demonstrate narrow approved scopes with immutable server-derived snapshots. On this synthetic instance every issuer is explicitly fictional — no badge here implies real federation, ownership or laboratory approval.", "اعتبارنامه‌های مرجع محدوده‌های تأییدشده محدود را با تصاویر تغییرناپذیر برگرفته از سرور نشان می‌دهند. در این نمونه ساختگی همه مراجع صراحتاً خیالی‌اند — هیچ نشان اینجا به معنای فدراسیون واقعی، مالکیت یا تأیید آزمایشگاهی نیست.")}</p>

    <section style={panel} data-surface="credential-read">
      <h2>{L("Read a horse's issuer credentials", "خواندن اعتبارنامه‌های مرجع یک اسب")}</h2>
      <label style={label}>{L("Horse ID", "شناسه اسب")}<input style={input} inputMode="numeric" value={horseInput} placeholder="900000017" onChange={event => setHorseInput(event.target.value)} /></label>
      <button style={buttonGhost} onClick={() => setHorseId(Number.isSafeInteger(Number(horseInput)) && Number(horseInput) > 0 ? Number(horseInput) : null)}>{L("Show credentials", "نمایش اعتبارنامه‌ها")}</button>
      {horseId == null ? <p>{L("Enter a horse ID to read its public credential rows.", "شناسه یک اسب را وارد کنید تا ردیف‌های عمومی اعتبارنامه‌های آن را ببینید.")}</p> : null}
      {horseId != null && stories.phase === "loading" ? <p role="status">{L("Loading credentials…", "در حال بارگذاری اعتبارنامه‌ها…")}</p> : null}
      {horseId != null && (stories.phase === "forbidden" || stories.phase === "unavailable" || stories.phase === "error") ? <div style={alertBox} role="alert"><p>{L("Credentials could not be loaded. An error is not evidence that none exist.", "بارگذاری اعتبارنامه‌ها ناموفق بود. خطا به معنی نبودِ آنها نیست.")}</p><p dir="auto">{stories.reason}</p><button style={buttonGhost} onClick={retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
      {horseId != null && stories.phase === "empty" ? <p>{L("No issuer credential is recorded for this horse yet. Registry data is platform-reviewed at most — reviewed is not issuer-attested.", "هنوز اعتبارنامه‌ای از مرجع بیرونی برای این اسب ثبت نشده است. داده‌ها حداکثر بررسی سامانه‌اند — بررسی سامانه همان تأیید مرجع نیست.")}</p> : null}
      {horseId != null && (stories.phase === "ready" || stories.phase === "reloading") && stories.rows.length ? <div data-surface="credential-rows">{stories.rows.map(row => <ClassicCredentialRow key={row.id} platform={platform} row={row} locale={locale} user={user ?? null} commands={commands} onChanged={retry} />)}</div> : null}
    </section>

    {platform && user ? <section style={panel} data-surface="credential-issue">
      <h2>{L("Attest under an issuer (member-scoped)", "صدور تأیید به نام یک مرجع (محدود به عضو)")}</h2>
      <p>{L("You may attest only under an issuer that granted you an active membership, and only within its narrow approved scope — the server refuses anything else.", "فقط مرجعی که به شما عضویت فعال داده و فقط در محدوده تأییدشده محدود آن می‌توانید تأیید صادر کنید — سرور هر چیز دیگر را رد می‌کند.")}</p>
      <label style={label}>{L("Issuer", "مرجع")}<select style={input} value={issuerId} onChange={event => setIssuerId(event.target.value)}>
        <option value="">{L("Choose an issuer…", "یک مرجع انتخاب کنید…")}</option>
        {(directory.phase === "ready" || directory.phase === "reloading") ? directory.issuers.map(issuer => <option key={issuer.id} value={issuer.id}>{locale !== "en" && issuer.name_native ? issuer.name_native : issuer.name}</option>) : null}
      </select></label>
      <label style={label}>{L("Record kind", "نوع رکورد")}<select style={input} value={recordKind} onChange={event => setRecordKind(event.target.value as "genetic_test" | "horse_identity")}>
        <option value="genetic_test">{L("Reviewed genetic test", "آزمون ژنتیکی بررسی‌شده")}</option>
        <option value="horse_identity">{L("Horse identity", "هویت اسب")}</option>
      </select></label>
      <label style={label}>{L(recordKind === "horse_identity" ? "Horse id" : "Genetic test id", recordKind === "horse_identity" ? "شناسه اسب" : "شناسه آزمون ژنتیکی")}<input style={input} inputMode="numeric" value={recordId} onChange={event => setRecordId(event.target.value)} placeholder={recordKind === "horse_identity" ? String(horseId ?? 900000017) : "980000008"} /></label>
      <label style={label}>{L("Statement (optional)", "اظهار (اختیاری)")}<input style={input} dir="auto" maxLength={2000} value={statement} onChange={event => setStatement(event.target.value)} /></label>
      <label style={label}>{L("Expires at (optional, future instant with timezone)", "اعتبار تا (اختیاری، زمان آینده با منطقه زمانی)")}<input style={input} value={expiresAt} placeholder="2026-12-31T00:00:00Z" onChange={event => setExpiresAt(event.target.value)} /></label>
      <button style={button} disabled={commands.issue.state.phase === "submitting" || !issuerId || !recordId.trim()} onClick={() => { void commands.issue.run(async () => {
        const result = await platform.modules.attestations.issue(issuerId, { record_kind: recordKind, record_id: recordId.trim(), statement: statement.trim() || null, expires_at: expiresAt.trim() || null });
        setStatement(""); setExpiresAt(""); retry(); return result;
      }, { successMessage: L("Credential issued with an immutable server-derived snapshot.", "اعتبارنامه با تصویر برگرفته از سرور و تغییرناپذیر صادر شد.") }); }}>{L("Issue credential", "صدور اعتبارنامه")}</button>
      {commands.issue.state.phase === "rejected" ? <div style={alertBox} role="alert">{L("The issuer refused this issuance — membership, narrow scope, record or evidence rules.", "مرجع این صدور را رد کرد — عضویت، محدوده محدود، رکورد یا قواعد شواهد.")}</div> : null}
    </section> : null}
  </div>;
}

/** ONE public credential row: verify panel + owner actions + private snapshot review. */
function ClassicCredentialRow({ platform, row, locale, user, commands, onChanged }: {
  platform: PlatformClient | null; row: CredentialStoryRow; locale: "en" | "fa" | "ar"; user: PlatformUser | null;
  commands: ReturnType<typeof useCredentialStoryCommands>; onChanged: () => void;
}) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [snapshot, setSnapshot] = useState<{ phase: "idle" } | { phase: "granted"; digest: string } | { phase: "refused" }>({ phase: "idle" });
  const { verification, retry: retryVerify } = useAttestationVerification({ platform, scope: `credential:${row.id}`, attestationId: verifyOpen ? row.id : null });
  const effective = row.effective_status || row.status;
  return <div style={{ borderTop: "1px solid #fde68a", padding: "8px 0" }} data-surface="credential-row" data-attestation-id={row.id}>
    <div style={rowStyle}>
      <span><strong dir="auto">{locale !== "en" && row.issuer.name_native ? row.issuer.name_native : row.issuer.name}</strong>
        <small> · {row.issuer.kind} · {row.record_kind} #{row.record_id} · {effective}{row.expires_at ? ` · ${L("valid until", "اعتبار تا")} ${row.expires_at.slice(0, 10)}` : ""} · {L("issued", "صدور")} {row.issued_at.slice(0, 10)}</small></span>
      <span>
        <button style={buttonGhost} onClick={() => setVerifyOpen(value => !value)}>{verifyOpen ? L("Hide verification", "پنهان‌کردن راستی‌آزمایی") : L("Verify", "راستی‌آزمایی")}</button>
        {user ? <button style={buttonGhost} onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? L("Hide owner actions", "پنهان‌کردن اقدامات مالک") : L("Owner actions", "اقدامات مالک")}</button> : null}
        {user ? <button style={buttonGhost} onClick={async () => { setSnapshot({ phase: "idle" }); const outcome = await runSnapshotReview(platform!, row.id); setSnapshot(outcome.phase === "granted" ? { phase: "granted", digest: String((outcome.review.snapshot as Record<string, unknown>).content_digest ?? "") } : { phase: "refused" }); }}>{L("Review snapshot (private)", "بازبینی تصویر (خصوصی)")}</button> : null}
      </span>
    </div>
    <p><small>{L("Public metadata only — the statement and scope stay private to authorized review.", "فقط فراداده عمومی — اظهار و محدوده برای بررسی مجاز خصوصی می‌ماند.")}</small></p>
    {verifyOpen ? <div style={{ marginTop: "8px" }} data-surface="credential-verify">
      {verification.phase === "loading" ? <p role="status">{L("Verifying…", "در حال راستی‌آزمایی…")}</p> : null}
      {verification.phase === "not_found" || verification.phase === "forbidden" || verification.phase === "unavailable" || verification.phase === "error" ? <div role="alert"><p>{L("Verification is unavailable right now.", "راستی‌آزمایی الان در دسترس نیست.")}</p>{verification.phase !== "not_found" ? <p dir="auto">{verification.reason}</p> : null}<button style={buttonGhost} onClick={retryVerify}>{L("Retry", "تلاش دوباره")}</button></div> : null}
      {(verification.phase === "ready" || verification.phase === "reloading") ? <div>
        <p><b>{L("State", "وضعیت")}:</b> {VERIFY_STATE_LABEL[verification.verification.verification_state] ? L(...VERIFY_STATE_LABEL[verification.verification.verification_state]!) : verification.verification.verification_state} · <b>{L("Effective", "مؤثر")}:</b> {verification.verification.effective_status}{verification.verification.snapshot ? <> · <b>{L("Digest", "چکیده")}:</b> <code>{verification.verification.snapshot.content_digest.slice(0, 16)}…</code></> : null}</p>
        {verification.verification.source_detail ? <p><b>{L("Changed sources", "منابع تغییرکرده")}:</b> {(verification.verification.source_detail.changed_tables ?? []).join(", ")}</p> : null}
        <p dir="auto"><small>{verification.verification.note}</small></p>
      </div> : null}
    </div> : null}
    {actionsOpen && user && platform ? <div style={{ marginTop: "8px" }} data-surface="credential-owner-actions">
      <p>{L("Revocation and supersession are issuer-owner (or platform content-manager) commands. A reason is required; the recorded snapshot is never rewritten.", "لغو و جایگزینی فرمان مالک مرجع (یا مدیر محتوای سامانه) است. دلیل الزامی است؛ تصویر ثبت‌شده هرگز بازنویسی نمی‌شود.")}</p>
      <label style={label}>{L("Reason", "دلیل")}<input style={input} dir="auto" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label style={label}>{L("Replacement statement (for supersede)", "اظهار جایگزین (برای جایگزینی)")}<input style={input} dir="auto" maxLength={2000} value={replacement} onChange={event => setReplacement(event.target.value)} /></label>
      <button style={buttonGhost} disabled={commands.revoke.state.phase === "submitting" || reason.trim().length < 3 || row.status !== "active"} onClick={() => { void commands.revoke.run(async () => {
        const result = await platform.modules.attestations.revoke(row.id, { reason: reason.trim() });
        setReason(""); onChanged(); return result;
      }, { successMessage: L("Credential revoked — the current status changed; the snapshot is preserved.", "اعتبارنامه لغو شد — وضعیت فعلی تغییر کرد؛ تصویر حفظ می‌شود.") }); }}>{L("Revoke", "لغو")}</button>
      <button style={buttonGhost} disabled={commands.supersede.state.phase === "submitting" || reason.trim().length < 3 || replacement.trim().length < 1 || row.status !== "active"} onClick={() => { void commands.supersede.run(async () => {
        const result = await platform.modules.attestations.supersede(row.id, { reason: reason.trim(), replacement: { record_kind: row.record_kind, record_id: row.record_id, statement: replacement.trim() } });
        setReason(""); setReplacement(""); onChanged(); return result;
      }, { successMessage: L("Superseded — a replacement was issued; the history stays visible.", "جایگزین شد — اعتبارنامه جدید صادر شد؛ تاریخچه قابل مشاهده می‌ماند.") }); }}>{L("Supersede with replacement", "جایگزینی با نسخه جدید")}</button>
      {commands.revoke.state.phase === "rejected" || commands.supersede.state.phase === "rejected" ? <p role="alert">{L("The command was refused — authority, state or version rules. The recorded history is unchanged.", "فرمان رد شد — قواعد اختیار، وضعیت یا نسخه. تاریخچه ثبت‌شده تغییر نکرد.")}</p> : null}
    </div> : null}
    {snapshot.phase !== "idle" ? <div style={{ marginTop: "8px" }} data-surface="credential-snapshot-review">
      {snapshot.phase === "granted" ? <p><small>{L("Private snapshot review: authorized — full bytes stay private; digest", "بازبینی خصوصی تصویر: مجاز — بایت‌های کامل خصوصی می‌مانند؛ چکیده")} <code>{snapshot.digest.slice(0, 16)}…</code></small></p> : <p role="alert"><small>{L("Refused — only platform content managers or the issuer's active owner may review the full snapshot.", "رد شد — فقط مدیران محتوای سامانه یا مالک فعال مرجع می‌توانند تصویر کامل را بازبینی کنند.")}</small></p>}
    </div> : null}
  </div>;
}
