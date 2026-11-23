import { api, state, esc, attr, num } from "../core.js";

/** Native Classic media controls. The API owns every authority/consent rule.
 * In-memory drafts and URLs belong to this exact mounted principal, never
 * to localStorage or another account. */
export function mountHorseMedia(container, horseId) {
  if (!container) return () => {};
  const principal = state.auth;
  const locale = state.locale;
  const L = (en, fa) => locale === "fa" ? fa : en;
  const controller = new AbortController();
  const live = () => container.isConnected && state.auth === principal && !controller.signal.aborted;
  const observer = new MutationObserver(() => { if (!container.isConnected) destroy(); });
  observer.observe(document.body, { childList: true, subtree: true });
  let result = null, busy = false, message = "", error = false, canUpload = false, purpose = "photo", draft = null;
  const accessLinks = new Map();
  const fileUrl = id => `/api/media/file/${encodeURIComponent(id)}`;
  const button = (label, action, id = "", extra = "") => `<button type="button" class="btn ${extra}" data-media-action="${action}" data-media-id="${attr(id)}" ${busy ? "disabled" : ""}>${esc(label)}</button>`;
  const reviewLabel = item => item.verification === "federation_verified" ? L("Reviewed by platform staff", "بررسی‌شده توسط کارشناسان سامانه")
    : item.verification === "rejected" ? L("Rejected — private", "ردشده — خصوصی")
    : item.verification === "owner_submitted" ? L("Owner submitted", "ارسال‌شده توسط مالک") : L("Awaiting review", "در انتظار بررسی");
  function controls(item) {
    const publication = `${item.can_publish && !item.public_visible ? button(L("Publish photo", "انتشار عکس"), "publish", item.id, "btn-primary") : ""}${item.can_withdraw ? button(L("Withdraw publication", "لغو انتشار"), "withdraw", item.id) : ""}`;
    const review = principal.permissions.includes("horse.edit") ? `${item.verification !== "federation_verified" ? button(L("Approve review", "تأیید بررسی"), "review", item.id) : ""}${item.verification !== "rejected" ? button(L("Reject review", "رد بررسی"), "reject", item.id) : ""}` : "";
    const link = accessLinks.get(item.id);
    const access = !item.public_visible && principal.user ? link
      ? `<div class="classic-media-access"><label>${esc(L("Temporary private link", "پیوند موقت خصوصی"))}<input type="text" dir="ltr" readonly value="${attr(new URL(link.url, location.origin).href)}"></label><p class="muted">${esc(L("Expires", "انقضا"))}: ${esc(new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(link.expires_at)))}</p>${button(L("Revoke this link", "لغو این پیوند"), "revoke", item.id)}</div>`
      : button(L("Create 15-minute access link", "ساخت پیوند دسترسی ۱۵ دقیقه‌ای"), "access", item.id) : "";
    return `<div class="classic-media-controls">${publication}${review}${access}</div>`;
  }
  function draw() {
    if (!live()) return;
    const items = result?.media ?? [], photos = items.filter(item => item.media_type === "photo"), documents = items.filter(item => item.media_type === "document");
    container.setAttribute("aria-busy", String(busy));
    container.innerHTML = `<section class="panel classic-media-panel" aria-label="${attr(L("Photos and private documents", "عکس‌ها و مدارک خصوصی"))}"><header class="panel-head"><h2 class="panel-title">${esc(L("Photos and private documents", "عکس‌ها و مدارک خصوصی"))}</h2>${button(L("Refresh media", "تازه‌سازی رسانه"), "reload")}</header><div class="panel-body">
      <p class="muted">${esc(L("Photos become public only after review and the uploader's explicit consent. Documents remain private. Staff review is not an issuer attestation.", "عکس‌ها تنها پس از بررسی و رضایت صریح بارگذار منتشر می‌شوند. مدارک خصوصی می‌مانند. بررسی کارشناسان سامانه به معنی گواهی مرجع صادرکننده نیست."))}</p>
      ${result ? `<p class="muted">${num(result.counts.photos)} ${esc(L("photos you can view", "عکس قابل مشاهده"))} · ${num(result.counts.documents)} ${esc(L("documents you can view", "مدرک قابل مشاهده"))}</p>` : !error ? `<p role="status">${esc(L("Loading photos and documents…", "در حال بارگذاری عکس‌ها و مدارک…"))}</p>` : ""}
      ${error ? `<div role="alert" class="notice">${esc(L("Photos and documents could not be loaded.", "بارگذاری عکس‌ها و مدارک ناموفق بود."))} ${button(L("Retry", "تلاش دوباره"), "reload")}</div>` : ""}
      ${result && !photos.length ? `<p>${esc(L("No photos are available to you yet.", "هنوز عکسی برای مشاهده شما در دسترس نیست."))}</p>` : ""}
      <div class="classic-media-gallery">${photos.map(item => `<figure><a class="classic-media-preview" href="${fileUrl(item.id)}" target="_blank" rel="noreferrer"><img src="${fileUrl(item.id)}" alt="${attr(item.caption || L("Horse photo", "عکس اسب"))}" loading="lazy"><span>${esc(L("Open photo", "مشاهده عکس"))}</span></a><figcaption><b dir="auto">${esc(item.caption || item.file_name)}</b><span>${esc(item.public_visible ? L("Public", "عمومی") : L("Private", "خصوصی"))}</span><small>${esc(reviewLabel(item))}</small></figcaption>${controls(item)}</figure>`).join("")}</div>
      ${documents.length ? `<ul class="classic-media-documents">${documents.map(item => `<li><a href="${fileUrl(item.id)}" target="_blank" rel="noreferrer" dir="auto"><b>${esc(item.file_name)}</b></a><p class="muted">${esc(L("Private document", "مدرک خصوصی"))} · ${esc(reviewLabel(item))}</p>${controls(item)}</li>`).join("")}</ul>` : ""}
      ${canUpload ? `<div class="classic-media-upload"><label>${esc(L("File use", "کاربرد فایل"))}<select name="media-purpose" ${busy ? "disabled" : ""}><option value="photo" ${purpose === "photo" ? "selected" : ""}>${esc(L("Gallery photo", "عکس گالری"))}</option><option value="document" ${purpose === "document" ? "selected" : ""}>${esc(L("Private document", "مدرک خصوصی"))}</option></select></label><input type="file" name="media-file" hidden accept="${purpose === "photo" ? "image/jpeg,image/png,image/gif,image/webp" : "application/pdf,image/jpeg,image/png"}">${button(L("Choose and upload file", "انتخاب و بارگذاری فایل"), "choose", "", "btn-primary")}<small>${esc(L("Up to 3 MB. Uploads start private.", "حداکثر ۳ مگابایت. فایل‌ها ابتدا خصوصی هستند."))}</small></div>` : ""}
      ${message ? `<p class="notice" role="status" dir="auto">${esc(message)}</p>` : ""}
      ${draft ? `<div class="notice"><p>${esc(L("Saved request", "درخواست حفظ‌شده"))}: ${esc(draft.consent === "shared_public" ? L("Publish this photo", "انتشار این عکس") : L("Withdraw publication", "لغو انتشار"))} — <b dir="auto">${esc(items.find(item => item.id === draft.id)?.file_name ?? "")}</b></p>${button(L("Retry visibility change", "تلاش دوباره برای تغییر نمایش"), "retry", draft.id)} ${button(L("Dismiss saved request", "بستن درخواست حفظ‌شده"), "dismiss")}</div>` : ""}
      <div class="cluster"><a class="btn" href="/api/horses/${horseId}/certificate.svg?lang=${locale}" target="_blank" rel="noreferrer">${esc(L("Printable registry information", "خلاصه اطلاعات ثبت برای چاپ"))}</a></div>
    </div></section>`;
    for (const img of container.querySelectorAll(".classic-media-preview img")) img.addEventListener("error", () => { img.hidden = true; }, { once: true });
  }
  async function refresh() {
    const value = await api(`/api/horses/${horseId}/media`, { signal: controller.signal });
    if (!live()) return;
    result = value; error = false;
  }
  async function reload() {
    error = false; busy = true; draw();
    try { await refresh(); } catch { if (live()) error = true; }
    finally { busy = false; draw(); }
  }
  function failure(cause, visibility = false) {
    message = cause?.status === 409
      ? visibility ? L("This file changed. Your visibility request is saved; review the current status before retrying.", "وضعیت فایل تغییر کرده است. درخواست شما حفظ شده؛ پیش از تلاش دوباره، وضعیت فعلی را بررسی کنید.")
        : L("This file changed. Review its current status before trying again.", "وضعیت فایل تغییر کرده است. پیش از تلاش دوباره، وضعیت فعلی آن را بررسی کنید.")
      : L("The action could not be confirmed. Check the current status and retry if needed.", "انجام درخواست تأیید نشد. وضعیت فعلی را بررسی کنید و در صورت نیاز دوباره تلاش کنید.");
  }
  async function command(action, item) {
    if (busy || !live()) return;
    if (action === "dismiss") { draft = null; draw(); return; }
    if (action === "reload") { await reload(); return; }
    if (!item) return;
    busy = true; message = "";
    const publication = ["publish", "withdraw", "retry"].includes(action);
    if (publication) {
      const consent = action === "retry" ? draft?.consent : action === "publish" ? "shared_public" : "private";
      if (!consent || !(consent === "shared_public" ? item.can_publish : item.can_withdraw)) { busy = false; draw(); return; }
      if (!(action === "retry" && draft && !draft.conflict)) draft = { id: item.id, consent, version: item.row_version, key: crypto.randomUUID(), conflict: false };
    }
    draw();
    try {
      if (publication) {
        const consent = draft.consent;
        await api(`/api/media/${encodeURIComponent(item.id)}/publication`, { method: "POST", signal: controller.signal, headers: { "Idempotency-Key": draft.key }, json: { consent_state: consent, expected_version: draft.version } });
        if (!live()) return;
        draft = null;
        if (consent === "private") accessLinks.delete(item.id);
        message = consent === "shared_public" ? L("Photo published. Visitors can now view it.", "عکس منتشر شد و اکنون برای بازدیدکنندگان قابل مشاهده است.") : L("Publication withdrawn. This file is private and its previous access links are revoked.", "انتشار لغو شد. فایل خصوصی است و پیوندهای دسترسی قبلی آن لغو شده‌اند.");
        await refresh();
      } else if (action === "review" || action === "reject") {
        await api(`/api/admin/media/${encodeURIComponent(item.id)}/verify`, { method: "POST", signal: controller.signal, json: { decision: action === "reject" ? "rejected" : "platform_reviewed", expected_version: item.row_version } });
        if (!live()) return;
        if (action === "reject") accessLinks.delete(item.id);
        message = action === "reject" ? L("Review rejected. The file is private and its previous access links are revoked.", "بررسی رد شد. فایل خصوصی است و پیوندهای دسترسی قبلی آن لغو شده‌اند.") : L("Review saved. Publication still needs the uploader's separate consent.", "بررسی ثبت شد. انتشار همچنان به رضایت جداگانه بارگذار نیاز دارد.");
        await refresh();
      } else if (action === "access") {
        const link = await api(`/api/media/${encodeURIComponent(item.id)}/access`, { method: "POST", signal: controller.signal });
        if (!live()) return;
        accessLinks.set(item.id, link);
        message = L("Temporary link created. Anyone with this link can open the file until it expires or you revoke it.", "پیوند موقت ساخته شد. هرکس این پیوند را داشته باشد می‌تواند تا زمان انقضا یا لغو آن، فایل را باز کند.");
      } else if (action === "revoke") {
        const link = accessLinks.get(item.id);
        if (!link) return;
        await api(`/api/media/${encodeURIComponent(item.id)}/access/${encodeURIComponent(link.grant_id)}`, { method: "DELETE", signal: controller.signal });
        if (!live()) return;
        accessLinks.delete(item.id); message = L("This temporary link is revoked.", "این پیوند موقت لغو شد.");
      }
    } catch (cause) {
      if (!live()) return;
      if (cause.status === 409) {
        if (publication && draft) draft.conflict = true;
        await refresh().catch(() => undefined);
      }
      failure(cause, publication);
    } finally { busy = false; draw(); }
  }
  async function upload(file) {
    if (!canUpload || busy || !live()) return;
    const allowed = purpose === "photo" ? ["image/jpeg", "image/png", "image/gif", "image/webp"] : ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) { message = L("Choose a supported file. Convert AVIF to JPEG, PNG or WebP first.", "یک فایل پشتیبانی‌شده انتخاب کنید. ابتدا AVIF را به JPEG، PNG یا WebP تبدیل کنید."); draw(); return; }
    if (!file.size || file.size > 3 * 1024 * 1024) { message = L("Choose a non-empty file up to 3 MB.", "یک فایل غیرخالی با حجم حداکثر ۳ مگابایت انتخاب کنید."); draw(); return; }
    busy = true; message = L("Uploading…", "در حال بارگذاری…"); draw();
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      if (!live()) return;
      await api(`/api/horses/${horseId}/media`, { method: "POST", signal: controller.signal, json: { media_type: purpose, role: purpose === "photo" ? "gallery" : "other", file_name: file.name.slice(0, 200), mime_type: file.type, data_base64: data } });
      if (!live()) return;
      message = L("Uploaded privately. A photo needs staff review and your explicit publication before visitors can see it.", "فایل به‌صورت خصوصی بارگذاری شد. نمایش عمومی عکس به بررسی کارشناسان و سپس انتخاب شما برای انتشار نیاز دارد.");
      await refresh();
    } catch (cause) { if (live()) failure(cause); } finally { busy = false; draw(); }
  }
  function onClick(event) {
    const control = event.target.closest("[data-media-action]");
    if (!control || !container.contains(control) || !live() || busy) return;
    const action = control.dataset.mediaAction;
    if (action === "choose") { container.querySelector('input[name="media-file"]')?.click(); return; }
    void command(action, result?.media.find(item => item.id === control.dataset.mediaId));
  }
  function onChange(event) {
    if (!live() || busy) return;
    if (event.target.name === "media-purpose") { purpose = event.target.value === "document" ? "document" : "photo"; draw(); }
    if (event.target.name === "media-file") { const file = event.target.files?.[0]; if (file) void upload(file); }
  }
  function destroy() { controller.abort(); observer.disconnect(); container.removeEventListener("click", onClick); container.removeEventListener("change", onChange); accessLinks.clear(); draft = null; }
  container.addEventListener("click", onClick); container.addEventListener("change", onChange);
  void reload();
  if (principal.user) void api(`/api/horses/${horseId}/actions`, { signal: controller.signal }).then(value => { if (live()) { canUpload = value.actions.includes("upload_media"); draw(); } }).catch(() => undefined);
  return destroy;
}
