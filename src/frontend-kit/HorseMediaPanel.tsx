import { kitText, kitIsRtl, kitNumberTag, kitDigits, type EngineLocale } from "./domain/engineText";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { HorseMediaListResponse, HorseMediaRecord, PlatformClient, PlatformUser } from "../contracts/platform";
import { usePrincipalScope, useScopedState } from "./domain/principalScope";
import { isPlatformClientError } from "./errors";
import "./HorseMediaPanel.css";

/** One current-principal command workflow, styled by each frontend's own tokens.
 * Publication consent is distinct from editorial review. All authority and
 * optimistic concurrency checks remain on the server. */
export function HorseMediaPanel({ horseId, platform, user, permissions, locale, appearance = "core" }: {
  horseId: number; platform: PlatformClient; user: PlatformUser | null; permissions: readonly string[];
  locale: EngineLocale; appearance?: "core" | "fei" | "equidata" | "retro";
}) {
  const L = (en: string, fa: string) => kitText(locale, en, fa);
  const number = (value: number) => new Intl.NumberFormat(kitNumberTag(locale)).format(value);
  const count = (value: number | null | undefined) => value == null ? "—" : number(value);
  const principal = usePrincipalScope(user, permissions);
  const scope = `${principal}|horse:${horseId}`;
  const lifetime = useMemo(() => ({ controller: new AbortController(), busy: false }), [scope, platform]);
  const current = useRef(lifetime); current.current = lifetime;
  useEffect(() => {
    // React StrictMode deliberately replays setup/cleanup. A replay must get
    // a fresh controller, while a departed principal's requests stay aborted.
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);
  const isCurrent = () => current.current === lifetime && !lifetime.controller.signal.aborted;
  const [media, setMedia] = useScopedState<HorseMediaListResponse | null>(scope, null);
  const [busy, setBusy] = useScopedState<string | null>(scope, null);
  const [message, setMessage] = useScopedState(scope, "");
  const [loadError, setLoadError] = useScopedState(scope, "");
  const [horseActions, setHorseActions] = useScopedState<string[]>(scope, []);
  const [uploadKind, setUploadKind] = useScopedState<"photo" | "document">(scope, "photo");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useScopedState<{ id: string; consent: "private" | "shared_public"; version: number; key: string; conflict: boolean } | null>(scope, null);
  const [accessLinks, setAccessLinks] = useScopedState<Record<string, { grantId: string; url: string; expiresAt: string }>>(scope, {});
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!user) { setHorseActions([]); return () => controller.abort(); }
    platform.modules.access.horseActions(horseId, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setHorseActions(value.actions); })
      .catch(() => { if (!controller.signal.aborted) setHorseActions([]); });
    return () => controller.abort();
  }, [scope, platform, horseId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    platform.modules.media.list(horseId, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setMedia(value); })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [scope, horseId, platform, loadAttempt]);
  const canUpload = Boolean(user) && horseActions.includes("upload_media");
  const photos = media?.media.filter(item => item.media_type === "photo") ?? [];
  const documents = media?.media.filter(item => item.media_type === "document") ?? [];
  const begin = (id: string) => { if (!isCurrent() || lifetime.busy) return false; lifetime.busy = true; setBusy(id); setMessage(""); return true; };
  const end = () => { lifetime.busy = false; if (isCurrent()) setBusy(null); };
  const refresh = async () => {
    const value = await platform.modules.media.list(horseId, { signal: lifetime.controller.signal });
    if (isCurrent()) setMedia(value);
  };
  const refreshVisible = async () => {
    if (!begin("refresh")) return;
    try { await refresh(); if (isCurrent()) setLoadError(""); }
    catch { if (isCurrent()) setLoadError("refresh_failed"); }
    finally { end(); }
  };
  const failure = (error: unknown, visibility = false) => {
    if (!isCurrent()) return;
    setMessage(isPlatformClientError(error) && error.status === 409
      ? visibility ? L("This file changed. Your visibility request is saved below; review the current status before retrying.", "وضعیت فایل تغییر کرده است. درخواست شما در پایین حفظ شده؛ پیش از تلاش دوباره، وضعیت فعلی را بررسی کنید.")
        : L("This file changed. Review its current status before trying again.", "وضعیت فایل تغییر کرده است. پیش از تلاش دوباره، وضعیت فعلی آن را بررسی کنید.")
      : L("The action could not be confirmed. Check the current status and retry if needed.", "انجام درخواست تأیید نشد. وضعیت فعلی را بررسی کنید و در صورت نیاز دوباره تلاش کنید."));
  };
  const forgetAccessLink = (id: string) => setAccessLinks(previous => {
    const next = { ...previous }; delete next[id]; return next;
  });
  const changePublication = async (item: HorseMediaRecord, consent: "private" | "shared_public", retry = false) => {
    if (!begin(item.id)) return;
    const intent = retry && draft && !draft.conflict ? draft : { id: item.id, consent, version: item.row_version, key: crypto.randomUUID(), conflict: false };
    setDraft(intent);
    try {
      await platform.modules.media.setPublication(item.id, consent, { expectedVersion: intent.version, idempotencyKey: intent.key, signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      setDraft(null);
      if (consent === "private") forgetAccessLink(item.id);
      setMessage(consent === "shared_public"
        ? L("Photo published. Visitors can now view it.", "عکس منتشر شد و اکنون برای بازدیدکنندگان قابل مشاهده است.")
        : L("Publication withdrawn. This file is private and its previous access links are revoked.", "انتشار لغو شد. فایل خصوصی است و پیوندهای دسترسی قبلی آن لغو شده‌اند."));
      await refresh();
    } catch (error) {
      if (isCurrent() && isPlatformClientError(error) && error.status === 409) {
        setDraft({ ...intent, conflict: true });
        await refresh().catch(() => undefined);
      }
      failure(error, true);
    } finally { end(); }
  };
  const review = async (item: HorseMediaRecord, decision: "platform_reviewed" | "rejected") => {
    if (!begin(item.id)) return;
    try {
      await platform.modules.media.verify(item.id, decision, null, { expectedVersion: item.row_version, signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      if (decision === "rejected") forgetAccessLink(item.id);
      setMessage(decision === "rejected"
        ? L("Review rejected. The file is private and its previous access links are revoked.", "بررسی رد شد. فایل خصوصی است و پیوندهای دسترسی قبلی آن لغو شده‌اند.")
        : L("Review saved. Publication still needs the uploader's separate consent.", "بررسی ثبت شد. انتشار همچنان به رضایت جداگانه بارگذار نیاز دارد."));
      await refresh();
    } catch (error) {
      if (isCurrent() && isPlatformClientError(error) && error.status === 409) await refresh().catch(() => undefined);
      failure(error);
    } finally { end(); }
  };
  const createAccessLink = async (item: HorseMediaRecord) => {
    if (!begin(item.id)) return;
    try {
      const result = await platform.modules.media.access(item.id, { signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      // Keep private bearer URLs only in this principal's in-memory view.
      setAccessLinks(previous => ({ ...previous, [item.id]: { grantId: result.grant_id, url: result.url, expiresAt: result.expires_at } }));
      setMessage(L("Temporary link created. Anyone with this link can open the file until it expires or you revoke it.", "پیوند موقت ساخته شد. هرکس این پیوند را داشته باشد می‌تواند تا زمان انقضا یا لغو آن، فایل را باز کند."));
    } catch (error) { failure(error); } finally { end(); }
  };
  const revokeAccessLink = async (item: HorseMediaRecord) => {
    const link = accessLinks[item.id];
    if (!link || !begin(item.id)) return;
    try {
      await platform.modules.media.revokeAccess(item.id, link.grantId, { signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      forgetAccessLink(item.id);
      setMessage(L("This temporary link is revoked.", "این پیوند موقت لغو شد."));
    } catch (error) { failure(error); } finally { end(); }
  };
  const upload = async (file: File) => {
    if (!canUpload || !begin("upload")) return;
    try {
      const allowed = uploadKind === "photo" ? ["image/jpeg", "image/png", "image/gif", "image/webp"] : ["application/pdf", "image/jpeg", "image/png"];
      if (!allowed.includes(file.type)) { setMessage(L("Choose a supported file. Convert AVIF to JPEG, PNG or WebP first.", "یک فایل پشتیبانی‌شده انتخاب کنید. ابتدا AVIF را به JPEG، PNG یا WebP تبدیل کنید.")); return; }
      if (file.size > 3 * 1024 * 1024 || file.size === 0) { setMessage(L("Choose a non-empty file up to 3 MB.", "یک فایل غیرخالی با حجم حداکثر ۳ مگابایت انتخاب کنید.")); return; }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (!isCurrent()) return;
      await platform.modules.media.upload(horseId, { media_type: uploadKind, role: uploadKind === "photo" ? "gallery" : "other",
        file_name: file.name.slice(0, 200), mime_type: file.type, data_base64: dataBase64 }, { signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      setMessage(L("Uploaded privately. A photo needs staff review and your explicit publication before visitors can see it.", "فایل به‌صورت خصوصی بارگذاری شد. نمایش عمومی عکس به بررسی کارشناسان و سپس انتخاب شما برای انتشار نیاز دارد."));
      await refresh();
    } catch (error) { failure(error); } finally { end(); }
  };
  const reviewLabel = (item: HorseMediaRecord) => item.verification === "federation_verified"
    ? L("Reviewed by platform staff", "بررسی‌شده توسط کارشناسان سامانه")
    : item.verification === "rejected" ? L("Rejected — private", "ردشده — خصوصی")
    : item.verification === "owner_submitted" ? L("Owner submitted", "ارسال‌شده توسط مالک")
    : L("Awaiting review", "در انتظار بررسی");
  const retryItem = draft ? media?.media.find(item => item.id === draft.id) : null;
  const reviewButtons = (item: HorseMediaRecord) => permissions.includes("horse.edit") && <>
    {item.verification !== "federation_verified" && <button className="registry-media-action ghost" disabled={busy !== null} onClick={() => void review(item, "platform_reviewed")}>{L("Approve review", "تأیید بررسی")}</button>}
    {item.verification !== "rejected" && <button className="registry-media-action ghost" disabled={busy !== null} onClick={() => void review(item, "rejected")}>{L("Reject review", "رد بررسی")}</button>}
  </>;
  const privateAccess = (item: HorseMediaRecord) => !item.public_visible && user && <div className="registry-media-access">
    {accessLinks[item.id] ? <>
      <label>{L("Temporary private link", "پیوند موقت خصوصی")}<input type="text" dir="ltr" readOnly value={new URL(accessLinks[item.id]!.url, platform.modules.media.fileUrl(item.id).startsWith("http") ? platform.modules.media.fileUrl(item.id) : window.location.origin).href} onFocus={event => event.currentTarget.select()}/></label>
      <p><small>{L("Expires", "انقضا")}: {new Intl.DateTimeFormat(kitNumberTag(locale), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(accessLinks[item.id]!.expiresAt))}</small></p>
      <button className="registry-media-action ghost" disabled={busy !== null} onClick={() => void revokeAccessLink(item)}>{L("Revoke this link", "لغو این پیوند")}</button>
    </> : <button className="registry-media-action ghost" disabled={busy !== null} onClick={() => void createAccessLink(item)}>{L("Create 15-minute access link", "ساخت پیوند دسترسی ۱۵ دقیقه‌ای")}</button>}
  </div>;
  return <section className={`registry-media-panel registry-media-${appearance}`} dir={kitIsRtl(locale) ? "rtl" : "ltr"} aria-label={L("Photos and private documents", "عکس‌ها و مدارک خصوصی")} aria-busy={busy !== null}>
    <header className="registry-media-head"><div>
      <span className="registry-media-kicker">{L("PHOTOS & DOCUMENTS", "عکس‌ها و مدارک")}</span>
      <h2>{L("Photos and private documents", "عکس‌ها و مدارک خصوصی")}</h2>
      <p>{L("Photos become public only after review and the uploader's explicit consent. Documents remain private. Staff review is not an issuer attestation.", "عکس‌ها تنها پس از بررسی و رضایت صریح بارگذار منتشر می‌شوند. مدارک خصوصی می‌مانند. بررسی کارشناسان سامانه به معنی گواهی مرجع صادرکننده نیست.")}</p>
    </div><div className="registry-media-stats">
      <span><b>{count(media?.counts?.photos)}</b><small>{L("photos you can view", "عکس قابل مشاهده")}</small></span>
      <span><b>{count(media?.counts?.documents)}</b><small>{L("documents you can view", "مدرک قابل مشاهده")}</small></span>
      <button className="registry-media-action ghost" disabled={busy !== null} onClick={() => void refreshVisible()}>{busy === "refresh" ? L("Refreshing…", "در حال تازه‌سازی…") : L("Refresh media", "تازه‌سازی رسانه")}</button>
    </div></header>
    {loadError && <div role="alert" className="registry-media-message"><p>{L("Photos and documents could not be loaded.", "بارگذاری عکس‌ها و مدارک ناموفق بود.")}</p><button className="registry-media-action" onClick={() => setLoadAttempt(value => value + 1)}>{L("Retry", "تلاش دوباره")}</button></div>}
    {!media && !loadError && <p role="status">{L("Loading photos and documents…", "در حال بارگذاری عکس‌ها و مدارک…")}</p>}
    {media && photos.length === 0 && <p className="registry-media-message">{L("No photos are available to you yet.", "هنوز عکسی برای مشاهده شما در دسترس نیست.")}</p>}
    <div className="registry-media-gallery">
      {photos.map(photo => <figure key={photo.id} className="registry-media-card">
        <a className="registry-media-preview" href={platform.modules.media.fileUrl(photo.id)} target="_blank" rel="noreferrer">
          <img src={platform.modules.media.fileUrl(photo.id)} alt={photo.caption || L("Horse photo", "عکس اسب")} loading="lazy" onError={event => { event.currentTarget.hidden = true; }}/>
          <span>{L("Open photo", "مشاهده عکس")}</span>
        </a>
        <figcaption><b dir="auto">{photo.caption || photo.file_name}</b><span className={photo.public_visible ? "registry-media-visibility visible" : "registry-media-visibility"}>{photo.public_visible ? L("Public", "عمومی") : L("Private", "خصوصی")}</span><small>{reviewLabel(photo)}</small></figcaption>
        <div className="registry-media-card-actions">
          {photo.can_publish && !photo.public_visible && <button className="registry-media-action" disabled={busy !== null} onClick={() => void changePublication(photo, "shared_public")}>{L("Publish photo", "انتشار عکس")}</button>}
          {photo.can_withdraw && <button className="registry-media-action ghost" disabled={busy !== null} onClick={() => void changePublication(photo, "private")}>{L("Withdraw publication", "لغو انتشار")}</button>}
          {reviewButtons(photo)}
          {busy === photo.id && <small role="status">{L("Saving…", "در حال ذخیره…")}</small>}
          {privateAccess(photo)}
        </div>
      </figure>)}
    </div>
    {documents.length > 0 && <ul className="registry-media-docs">{documents.map(doc => <li key={doc.id}><a href={platform.modules.media.fileUrl(doc.id)} target="_blank" rel="noreferrer" className="registry-media-doc-link"><b dir="auto">{doc.file_name}</b><small>{L("Private document", "مدرک خصوصی")} · {reviewLabel(doc)}</small></a><div className="registry-media-card-actions">{reviewButtons(doc)}</div>{privateAccess(doc)}</li>)}</ul>}
    {canUpload && <div className="registry-media-actions registry-media-upload">
      <label>{L("File use", "کاربرد فایل")}<select value={uploadKind} disabled={busy !== null} onChange={event => setUploadKind(event.target.value as "photo" | "document")}><option value="photo">{L("Gallery photo", "عکس گالری")}</option><option value="document">{L("Private document", "مدرک خصوصی")}</option></select></label>
      <input ref={fileRef} type="file" accept={uploadKind === "photo" ? "image/jpeg,image/png,image/gif,image/webp" : "application/pdf,image/jpeg,image/png"} hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }}/>
      <button className="registry-media-action" disabled={busy !== null} onClick={() => fileRef.current?.click()}>{busy === "upload" ? L("Uploading…", "در حال بارگذاری…") : L("Choose and upload file", "انتخاب و بارگذاری فایل")}</button><small>{L("Up to 3 MB. Uploads start private.", "حداکثر ۳ مگابایت. فایل‌ها ابتدا خصوصی هستند.")}</small>
    </div>}
    {message && <p className="registry-media-message" dir="auto" role="status">{message}</p>}
    {draft && retryItem && <div className="registry-media-message registry-media-retry"><p>{L("Saved request:", "درخواست حفظ‌شده:")} {draft.consent === "shared_public" ? L("Publish this photo", "انتشار این عکس") : L("Withdraw publication", "لغو انتشار")} — <b dir="auto">{retryItem.file_name}</b></p><button className="registry-media-action" disabled={busy !== null || (draft.consent === "shared_public" ? !retryItem.can_publish : !retryItem.can_withdraw)} onClick={() => void changePublication(retryItem, draft.consent, true)}>{L("Retry visibility change", "تلاش دوباره برای تغییر نمایش")}</button><button className="registry-media-action ghost" disabled={busy !== null} onClick={() => setDraft(null)}>{L("Dismiss saved request", "بستن درخواست حفظ‌شده")}</button></div>}
    <div className="registry-media-actions"><a className="registry-media-action ghost" href={platform.modules.registryExtras.certificateUrl(horseId, locale === "fa" ? "fa" : "en")} target="_blank" rel="noreferrer">{L("Printable registry information", "خلاصه اطلاعات ثبت برای چاپ")}</a></div>
  </section>;
}
