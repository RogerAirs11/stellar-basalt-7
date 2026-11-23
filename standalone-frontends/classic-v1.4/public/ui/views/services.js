import { state, fa, esc, attr, num, date } from '../core.js';
import { ServiceRequestWorkbench, serviceRequestStatusLabel, serviceTransitionsFor, serviceCategoryLabel } from '../service-domain.js';
import { serviceRequestsApi, preserveServiceFocus, serviceId } from '../serviceApi.js';

let authority = null, store = null, unsubscribe = null, surface = null;
let confirm = null;
const reports = new Map();
const safetyOpen = new Set();
const L = (en, persian) => fa() ? persian : en;
const button = (label, action, id = '', disabled = false, extra = '') => `<button type="button" id="classic-service-${action}-${attr(id || 'root')}" class="btn" data-service-action="${action}" data-id="${attr(id)}" ${disabled ? 'disabled' : ''} ${extra}>${esc(label)}</button>`;
const data = value => value.phase === 'ready' || value.phase === 'reloading' ? value.data : null;
export function resetServiceWorkbench() { unsubscribe?.(); store?.dispose(); authority = null; store = null; unsubscribe = null; surface = null; confirm = null; reports.clear(); safetyOpen.clear(); }
function ensureStore() {
  if (authority !== state.auth) resetServiceWorkbench();
  if (!store) {
    authority = state.auth; const owner = authority;
    store = new ServiceRequestWorkbench(serviceRequestsApi, () => owner === state.auth);
    const stopDrawing = store.subscribe(() => { if (surface?.isConnected && authority === state.auth) draw(surface); });
    const refresh = () => { if (owner === state.auth && document.visibilityState === 'visible') void store.reload(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    unsubscribe = () => { stopDrawing(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
    store.start();
  }
  return store;
}
export function serviceResourceMarkup(resource, retryAction) {
  if (resource.phase === 'loading' || resource.phase === 'reloading') return `<p class="notice" role="status">${esc(L('Reading current records…', 'در حال خواندن سوابق فعلی…'))}</p>`;
  if (resource.phase === 'empty') return `<p class="empty">${esc(L('No requests are available in this inbox.', 'درخواستی در این صندوق وجود ندارد.'))}</p>`;
  if (!['forbidden', 'unavailable', 'error'].includes(resource.phase)) return '';
  return `<div class="notice bad" role="alert"><strong>${esc(resource.phase === 'forbidden' ? L('Your current account cannot read these records.', 'حساب فعلی شما نمی‌تواند این سوابق را بخواند.') : L('The records could not be read. This is not an empty result.', 'خواندن سوابق انجام نشد. این نتیجه به معنی خالی بودن نیست.'))}</strong><p dir="auto">${esc(resource.reason)}</p>${button(L('Try again', 'تلاش دوباره'), retryAction)}</div>`;
}
function commandMarkup(command) {
  if (!command || command.state.phase === 'idle') return '';
  const value = command.state;
  if (value.phase === 'submitting') return `<p class="notice" role="status">${esc(L('Saving…', 'در حال ذخیره…'))}</p>`;
  if (value.phase === 'accepted') return `<p class="notice good" role="status">${esc(L('Change recorded. Notification delivery is not guaranteed.', 'تغییر ثبت شد. تحویل اعلان تضمین نشده است.'))}</p>`;
  return `<div class="notice bad" role="alert"><strong>${esc(value.phase === 'failed' ? L('The result could not be confirmed.', 'نتیجه تأیید نشد.') : value.status === 409 ? L('The request changed. Read it before continuing.', 'درخواست تغییر کرده است. پیش از ادامه آن را بخوانید.') : L('The change was not accepted.', 'تغییر پذیرفته نشد.'))}</strong><p dir="auto">${esc(value.message)}</p></div>`;
}
function recoveryMarkup(snapshot) {
  return Object.entries(snapshot.commands).filter(([, command]) => command.state.phase === 'failed' || command.state.phase === 'rejected' && command.state.status === 409).map(([id, command]) => `<section class="panel classic-service-recovery" aria-label="${attr(L('Request recovery', 'بازیابی درخواست'))}"><div class="panel-head"><h2>${esc(L('Check request', 'بررسی درخواست'))} <bdi>#${id}</bdi></h2></div><div class="panel-body">${commandMarkup(command)}<p>${esc(L('Actions stay locked until a successful reread and your explicit inspection.', 'اقدامات تا خواندن موفق و بررسی صریح شما قفل می‌مانند.'))}</p>${command.recovery === 'failed' ? `<p role="alert" dir="auto">${esc(L('The reread failed. Actions remain locked.', 'خواندن دوباره ناموفق بود. اقدامات قفل می‌مانند.'))} ${esc(command.recoveryReason || '')}</p>` : ''}<div class="cluster">${button(command.recovery === 'reading' ? L('Reading…', 'در حال خواندن…') : L('Read current request', 'خواندن درخواست فعلی'), 'reconcile', id, command.recovery === 'reading')}${command.recovery === 'ready' ? button(L('I have checked the current request', 'درخواست فعلی را بررسی کردم'), 'acknowledge', id) : ''}<a class="btn" href="#/services/${id}">${esc(L('Open request', 'باز کردن درخواست'))}</a></div></div></section>`).join('');
}
function safetyMarkup(request) {
  const reason = reports.get(request.id) || '', locked = !store.canAct(request.id);
  return `<details class="classic-service-safety" data-id="${request.id}" ${safetyOpen.has(request.id) ? 'open' : ''}><summary>${esc(L('Report or block', 'گزارش یا مسدود کردن'))}</summary><form id="classic-service-report-${request.id}" class="classic-service-report form-grid" data-id="${request.id}"><div class="field span-all"><label for="classic-service-reason-${request.id}">${esc(L('Report reason (5–500 characters)', 'دلیل گزارش (۵ تا ۵۰۰ نویسه)'))}</label><textarea id="classic-service-reason-${request.id}" name="reason" data-report-reason="${request.id}" required minlength="5" maxlength="500" rows="3" dir="auto" ${locked ? 'disabled' : ''}>${esc(reason)}</textarea></div><div class="cluster span-all"><button type="submit" class="btn" ${locked || reason.trim().length < 5 ? 'disabled' : ''}>${esc(L('Submit report', 'ارسال گزارش'))}</button></div></form><p>${esc(request.is_requester_view ? L('Blocking prevents new inquiries from your account to this professional. Existing requests remain in your history.', 'مسدود کردن، ارسال درخواست تازه از حساب شما به این متخصص را متوقف می‌کند. درخواست‌های قبلی در سابقه شما می‌مانند.') : L('Blocking prevents new inquiries from this requester to the professional you manage. It does not close this request.', 'مسدود کردن، درخواست‌های تازه این درخواست‌کننده به متخصص تحت مدیریت شما را متوقف می‌کند. این درخواست بسته نمی‌شود.'))}</p>${confirm?.id === request.id && confirm.action === 'block' ? `<div class="notice" role="group" aria-label="${attr(L('Confirm block', 'تأیید مسدود کردن'))}"><p>${esc(L('Apply this block? There is no unblock control in this screen.', 'این مسدودسازی اعمال شود؟ در این صفحه کنترل رفع مسدودی وجود ندارد.'))}</p><div class="cluster">${button(L('Confirm block', 'تأیید مسدود کردن'), 'block-apply', request.id, locked)}${button(L('Cancel', 'انصراف'), 'privacy-cancel', request.id, locked)}</div></div>` : button(request.is_requester_view ? L('Block this professional', 'مسدود کردن این متخصص') : L('Block this requester', 'مسدود کردن این درخواست‌کننده'), 'confirm-block', request.id, locked)}</details>`;
}
function detailMarkup(snapshot) {
  if (snapshot.selectedId === null) return '';
  const request = snapshot.detail.phase === 'ready' ? snapshot.detail.data : null;
  return `<section class="panel"><div class="panel-head"><h2>${esc(L('Request details', 'جزئیات درخواست'))} <bdi>#${snapshot.selectedId}</bdi></h2><a class="btn btn-small" href="#/services">${esc(L('Back to requests', 'بازگشت به درخواست‌ها'))}</a></div><div class="panel-body">${serviceResourceMarkup(snapshot.detail, 'detail-retry')}${request ? `<div class="classic-service-detail"><div class="spread"><h3>${esc(serviceCategoryLabel(request.category, state.locale))}</h3><span class="badge">${esc(serviceRequestStatusLabel(request.status, state.locale))}</span></div><dl class="classic-service-facts"><div><dt>${esc(L('Provider', 'ارائه‌دهنده'))}</dt><dd><a href="#/directory/${request.provider_person_id}"><bdi>#${request.provider_person_id}</bdi></a></dd></div><div><dt>${esc(L('View', 'نما'))}</dt><dd>${esc(request.is_requester_view ? L('Sent by you', 'ارسال‌شده توسط شما') : L('Received by your professional', 'دریافت‌شده برای متخصص شما'))}</dd></div><div><dt>${esc(L('Updated', 'آخرین تغییر'))}</dt><dd><time datetime="${attr(request.updated_at)}">${date(request.updated_at)}</time></dd></div>${request.city ? `<div><dt>${esc(L('City', 'شهر'))}</dt><dd dir="auto">${esc(request.city)}</dd></div>` : ''}</dl><div class="classic-service-private"><h3>${esc(L('Private request note', 'یادداشت خصوصی درخواست'))}</h3><p dir="auto">${esc(request.note ?? L('Not available in the current view.', 'در نمای فعلی در دسترس نیست.'))}</p></div><div class="classic-service-private"><h3>${esc(L('Contact sharing', 'اشتراک اطلاعات تماس'))}</h3><p>${request.contact ? `<span dir="auto">${esc(request.contact.display_name)}</span> · <bdi>${esc(request.contact.email)}</bdi>` : esc(L('Contact information is not shared in this view.', 'اطلاعات تماس در این نما به اشتراک گذاشته نشده است.'))}</p></div><p class="muted">${esc(L('This is an inquiry, not a confirmed appointment or a notification delivery receipt.', 'این درخواست اولیه است و نوبت قطعی یا رسید تحویل اعلان نیست.'))}</p><div class="cluster">${serviceTransitionsFor(request.status, request.is_requester_view ? 'requester' : 'provider').map(status => button(serviceRequestStatusLabel(status, state.locale), 'transition', request.id, !store.canAct(request.id), `data-status="${status}"`)).join('')}</div>${commandMarkup(store.commandFor(request.id))}${safetyMarkup(request)}${request.is_requester_view ? `<details class="classic-service-privacy"><summary>${esc(L('Privacy controls', 'کنترل‌های حریم خصوصی'))}</summary><p>${esc(L('These changes are one-way for this request. Already delivered messages cannot be recalled.', 'این تغییرات برای این درخواست برگشت‌ناپذیر است. پیام‌های تحویل‌شده پس گرفته نمی‌شوند.'))}</p><div class="cluster">${button(L('Withdraw contact sharing', 'لغو اشتراک تماس'), 'confirm-consent', request.id, !store.canAct(request.id))}${button(L('Redact private note', 'حذف یادداشت خصوصی'), 'confirm-redact', request.id, !store.canAct(request.id))}</div>${confirm?.id === request.id && confirm.action !== 'block' ? `<div class="notice" role="group" aria-label="${attr(L('Confirm privacy change', 'تأیید تغییر حریم خصوصی'))}"><p>${esc(confirm.action === 'consent' ? L('Stop sharing your contact information on this request?', 'اشتراک اطلاعات تماس شما در این درخواست متوقف شود؟') : L('Permanently remove the private note from this request?', 'یادداشت خصوصی این درخواست برای همیشه حذف شود؟'))}</p><div class="cluster">${button(L('Confirm change', 'تأیید تغییر'), 'privacy-apply', request.id, !store.canAct(request.id))}${button(L('Cancel', 'انصراف'), 'privacy-cancel')}</div></div>` : ''}</details>` : ''}</div>` : ''}</div></section>`;
}
function draw(root) {
  if (!root.isConnected || authority !== state.auth) return;
  const snapshot = store.getSnapshot();
  preserveServiceFocus(root, () => {
    root.innerHTML = `<div class="classic-service-page"><header class="page-head"><div><h1>${esc(L('Service requests', 'درخواست‌های خدمت'))}</h1><p>${esc(L('Private inquiries you sent and requests for professionals you currently manage. No appointment or delivery is guaranteed.', 'درخواست‌های خصوصی ارسالی و درخواست‌های متخصصانی که اکنون مدیریت می‌کنید. نوبت یا تحویل پیام تضمین نشده است.'))}</p></div><a class="btn" href="#/directory">${esc(L('Find a professional', 'یافتن متخصص'))}</a></header><div class="classic-service-toolbar" role="group" aria-label="${attr(L('Request inbox', 'صندوق درخواست‌ها'))}">${button(L('My requests', 'درخواست‌های من'), 'mine', '', false, `aria-pressed="${snapshot.view === 'mine'}"`)}${button(L('Provider inbox', 'صندوق ارائه‌دهنده'), 'inbox', '', false, `aria-pressed="${snapshot.view === 'inbox'}"`)}${button(L('Refresh', 'به‌روزرسانی'), 'reload', '', ['loading', 'reloading'].includes(snapshot.list.phase))}</div>${recoveryMarkup(snapshot)}${detailMarkup(snapshot)}<section class="panel"><div class="panel-head"><h2>${esc(snapshot.view === 'mine' ? L('Requests you sent', 'درخواست‌های ارسالی شما') : L('Requests for your professionals', 'درخواست‌های متخصصان شما'))}</h2></div><div class="panel-body">${serviceResourceMarkup(snapshot.list, 'reload')}<div class="classic-service-cards">${(data(snapshot.list) || []).map(request => `<article class="classic-service-card"><div class="spread"><h3>${esc(serviceCategoryLabel(request.category, state.locale))}</h3><span class="badge">${esc(serviceRequestStatusLabel(request.status, state.locale))}</span></div><p>${esc(L('Request', 'درخواست'))} <bdi>#${request.id}</bdi> · ${esc(L('Provider', 'ارائه‌دهنده'))} <bdi>#${request.provider_person_id}</bdi></p>${request.city ? `<p dir="auto">${esc(request.city)}</p>` : ''}<a class="btn" href="#/services/${request.id}">${esc(L('View request', 'مشاهده درخواست'))}</a></article>`).join('')}</div></div></section></div>`;
    const privacy = root.querySelector('.classic-service-privacy'); if (privacy && confirm?.id === snapshot.selectedId && confirm.action !== 'block') privacy.open = true;
  });
}

export async function renderServices(root) {
  if (!state.auth.user) { root.innerHTML = `<div class="panel"><div class="panel-head"><h1>${esc(L('Service requests', 'درخواست‌های خدمت'))}</h1></div><div class="panel-body"><p>${esc(L('Sign in to view your private requests.', 'برای مشاهده درخواست‌های خصوصی وارد شوید.'))}</p><a class="btn" href="#/account">${esc(L('Sign in', 'ورود'))}</a></div></div>`; return; }
  const workbench = ensureStore(); surface = root;
  const rawId = state.route.params.id, id = rawId ? serviceId(rawId) : null;
  if (rawId && id === null) { root.innerHTML = `<div class="notice bad" role="alert">${esc(L('Invalid request ID.', 'شناسه درخواست نامعتبر است.'))}<a class="btn" href="#/services">${esc(L('Back to requests', 'بازگشت به درخواست‌ها'))}</a></div>`; surface = null; return; }
  if (workbench.getSnapshot().selectedId !== id) workbench.select(id);
  root.addEventListener('input', event => {
    const field = event.target.closest('[data-report-reason]'); if (!field || authority !== state.auth) return;
    const id = Number(field.dataset.reportReason); reports.set(id, field.value);
    const submit = field.form.querySelector('[type=submit]'); if (submit) submit.disabled = !workbench.canAct(id) || field.value.trim().length < 5;
  });
  root.addEventListener('toggle', event => { const panel = event.target; if (panel.matches('.classic-service-safety')) { const id = Number(panel.dataset.id); if (panel.open) safetyOpen.add(id); else safetyOpen.delete(id); } }, true);
  root.addEventListener('submit', async event => {
    const form = event.target; if (!form.matches('.classic-service-report')) return; event.preventDefault();
    const id = Number(form.dataset.id), reason = reports.get(id) || '';
    if (authority !== state.auth || !form.reportValidity() || !workbench.canAct(id) || reason.trim().length < 5) return;
    const owner = authority, accepted = await workbench.report(id, reason);
    if (accepted && owner === state.auth) { reports.delete(id); draw(root); }
  });
  root.addEventListener('click', async event => {
    const control = event.target.closest('[data-service-action]'); if (!control || control.disabled || authority !== state.auth) return;
    const action = control.dataset.serviceAction, targetId = Number(control.dataset.id);
    if (action === 'mine' || action === 'inbox') { workbench.setView(action); confirm = null; location.hash = '#/services'; }
    else if (action === 'reload') await workbench.reload();
    else if (action === 'detail-retry') workbench.select(workbench.getSnapshot().selectedId);
    else if (action === 'transition') await workbench.transition(targetId, control.dataset.status);
    else if (action === 'reconcile') await workbench.reconcile(targetId);
    else if (action === 'acknowledge') workbench.acknowledge(targetId);
    else if (action === 'confirm-consent' || action === 'confirm-redact') { confirm = { id: targetId, action: action === 'confirm-consent' ? 'consent' : 'redact' }; draw(root); }
    else if (action === 'confirm-block') { confirm = { id: targetId, action: 'block' }; safetyOpen.add(targetId); draw(root); }
    else if (action === 'block-apply' && confirm?.id === targetId && confirm.action === 'block') {
      const detail = workbench.getSnapshot().detail; if (detail.phase !== 'ready' || detail.data.id !== targetId) return;
      const owner = authority, accepted = detail.data.is_requester_view ? await workbench.block(targetId) : await workbench.providerBlock(targetId);
      if (accepted && owner === state.auth) { confirm = null; draw(root); }
    }
    else if (action === 'privacy-cancel') { confirm = null; draw(root); }
    else if (action === 'privacy-apply' && confirm?.id === targetId) { const accepted = confirm.action === 'consent' ? await workbench.withdrawConsent(targetId) : await workbench.redactNote(targetId); if (accepted && authority === state.auth) { confirm = null; draw(root); } }
  });
  draw(root);
}
