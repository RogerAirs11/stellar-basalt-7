import { state, fa, esc, attr, date, num } from '../core.js';
import { ServiceRequestComposer, principalScopeKey, SERVICE_CATEGORIES, IRAN_PROVINCES, PROVINCE_CODE_SCHEME, serviceCategoryLabel, provinceLabel, formatDirectoryLanguages, mutationIntentCopy } from '../service-domain.js';
import { serviceApi, serviceRequestsApi, preserveServiceFocus, serviceId } from '../serviceApi.js';

const L = (en, persian) => fa() ? persian : en;
const button = (label, action, disabled = false) => `<button type="button" id="classic-directory-${action}" class="btn" data-directory-action="${action}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
const name = person => (fa() ? person.name_native || person.name_latin : person.name_latin || person.name_native) || `#${person.person_id}`;
const options = (values, selected, label, key) => values.map(value => `<option value="${attr(value[key])}" ${value[key] === selected ? 'selected' : ''}>${esc(label(value[key], state.locale))}</option>`).join('');
const field = (id, label, control, wide = false) => `<div class="field${wide ? ' span-all' : ''}"><label for="${id}">${esc(label)}</label>${control}</div>`;
const emptyFilters = () => ({ name: '', category: '', province: '', cursor: 0 });
let authority = null, sequence = 0, readController = null, surface = null, view = null;
let filters = emptyFilters(), query = emptyFilters();
const composers = new Map();

export function resetDirectoryWorkbench() {
  sequence += 1; readController?.abort(); readController = null;
  for (const entry of composers.values()) { entry.unsubscribe(); entry.store.dispose(); }
  composers.clear(); authority = null; surface = null; view = null; filters = emptyFilters(); query = emptyFilters();
}
function ensureAuthority() { if (authority !== state.auth) { resetDirectoryWorkbench(); authority = state.auth; } }
function ensureComposer(person) {
  if (!state.auth.user) return null;
  if (!composers.has(person.person_id)) {
    const owner = authority;
    const store = new ServiceRequestComposer(serviceRequestsApi, principalScopeKey(owner.user, owner.permissions), person.person_id, () => owner === state.auth);
    const entry = { store, draft: { category: person.service_categories[0] || '', horse: '', province: '', city: '', note: '', share: false }, confirmDiscard: false, confirmedId: null, unsubscribe: () => {} };
    composers.set(person.person_id, entry);
    entry.unsubscribe = store.subscribe(() => {
      const snapshot = store.getSnapshot();
      if (snapshot.intent.phase === 'confirmed' && entry.confirmedId !== snapshot.intent.requestId) {
        entry.confirmedId = snapshot.intent.requestId; entry.draft.note = ''; entry.draft.share = false; entry.confirmDiscard = false;
      }
      if (surface?.isConnected && owner === state.auth && view?.id === person.person_id) draw(surface);
    });
    store.start();
  }
  return composers.get(person.person_id);
}
function readNotice() {
  if (view.phase === 'loading') return `<p class="notice" role="status">${esc(L('Reading published profiles…', 'در حال خواندن نمایه‌های منتشرشده…'))}</p>`;
  if (view.phase === 'error') return `<div class="notice bad" role="alert"><strong>${esc(L('The profile data could not be read. This is not an empty result.', 'خواندن اطلاعات نمایه انجام نشد. این نتیجه به معنی خالی بودن نیست.'))}</strong><p dir="auto">${esc(view.error)}</p>${button(L('Try again', 'تلاش دوباره'), 'retry')}</div>`;
  return '';
}
function locationMarkup(person) {
  return esc(person.province_needs_review ? L('Location needs confirmation', 'محل نیازمند تأیید است') : [person.province_code ? provinceLabel(person.province_code, state.locale) : '', person.city || ''].filter(Boolean).join(' · ') || '—');
}
function filtersMarkup() {
  return `<form id="classic-directory-filters" class="form-grid classic-directory-filters" role="search">
    ${field('classic-directory-name', L('Professional name', 'نام متخصص'), `<input id="classic-directory-name" name="name" value="${attr(filters.name)}" maxlength="120" dir="auto">`)}
    ${field('classic-directory-category', L('Service category', 'دسته خدمت'), `<select id="classic-directory-category" name="category"><option value="">${esc(L('All services', 'همه خدمات'))}</option>${options(SERVICE_CATEGORIES, filters.category, serviceCategoryLabel, 'id')}</select>`)}
    ${field('classic-directory-province', L('Province', 'استان'), `<select id="classic-directory-province" name="province"><option value="">${esc(L('All provinces', 'همه استان‌ها'))}</option>${options(IRAN_PROVINCES, filters.province, provinceLabel, 'code')}</select>`)}
    <div class="cluster span-all"><button class="btn btn-primary" type="submit">${esc(L('Search professionals', 'جست‌وجوی متخصصان'))}</button>${button(L('Clear filters', 'پاک کردن فیلترها'), 'clear')}</div>
  </form>`;
}
function directoryMarkup() {
  const result = view.phase === 'ready' ? view.data : null;
  return `<section class="panel"><div class="panel-body">${filtersMarkup()}${readNotice()}${result ? `<div class="classic-service-cards">${result.persons.map(person => `<article class="classic-service-card"><h2 dir="auto">${esc(name(person))}</h2><p>${esc(person.service_categories.map(category => serviceCategoryLabel(category, state.locale)).join(' · ') || L('Services not specified', 'خدمات مشخص نشده است'))}</p><p dir="auto">${locationMarkup(person)}</p><a class="btn" href="#/directory/${person.person_id}">${esc(L('View professional', 'مشاهده متخصص'))}</a></article>`).join('') || `<p class="empty">${esc(L('No published profiles match these filters.', 'نمایه منتشرشده‌ای با این فیلترها یافت نشد.'))}</p>`}</div><div class="classic-service-toolbar">${button(L('First page', 'صفحه اول'), 'first', query.cursor === 0)}<span>${num(result.persons.length)} ${esc(L('profiles on this page', 'نمایه در این صفحه'))}</span>${button(L('Next page', 'صفحه بعد'), 'next', result.next_cursor === null)}</div>` : ''}</div></section>`;
}
function credentialMarkup(credential) {
  const period = { expired: L('Expired credential; retained as history', 'مدرک منقضی‌شده؛ حفظ‌شده در سابقه'), revoked: L('Revoked', 'لغوشده'), within_recorded_dates: L('Within the recorded dates', 'در بازه تاریخ‌های ثبت‌شده'), not_yet_valid: L('Recorded start date is in the future', 'تاریخ شروع ثبت‌شده در آینده است') };
  return `<article class="classic-service-card"><h3>${esc(serviceCategoryLabel(credential.role, state.locale))}</h3><p dir="auto">${esc(credential.issuer_name)}</p><p>${esc(credential.verification_state === 'unverified' ? L('Unverified / self-declared', 'تأییدنشده / خوداظهاری') : credential.verification_level)}</p><p>${esc(period[credential.recorded_period_status] || L('Review the recorded dates', 'تاریخ‌های ثبت‌شده را بررسی کنید'))}${credential.expires_at ? ` · ${date(credential.expires_at)}` : ''}</p></article>`;
}
function validDraft(entry, person) {
  const draft = entry.draft;
  return person.service_categories.includes(draft.category) && draft.note.trim().length >= 10 && draft.note.trim().length <= 500 && (!draft.horse || serviceId(draft.horse) !== null);
}
function composerMarkup(person) {
  if (!state.auth.user) return `<section class="panel"><div class="panel-body"><p>${esc(L('Sign in to send a private inquiry.', 'برای ارسال درخواست خصوصی وارد شوید.'))}</p><a class="btn" href="#/account">${esc(L('Sign in', 'ورود'))}</a></div></section>`;
  const entry = composers.get(person.person_id), draft = entry.draft, snapshot = entry.store.getSnapshot();
  const busy = snapshot.command.phase === 'submitting' || snapshot.intent.reconciling;
  const command = snapshot.command;
  return `<section class="panel"><div class="panel-head"><h2>${esc(L('Send a private service inquiry', 'ارسال درخواست خصوصی خدمت'))}</h2></div><div class="panel-body">
    <p>${esc(L('This is a lead, not a confirmed appointment. Write 10–500 characters and leave sensitive medical information out.', 'این درخواست اولیه است و نوبت قطعی نیست. بین ۱۰ تا ۵۰۰ نویسه بنویسید و اطلاعات پزشکی حساس وارد نکنید.'))}</p>
    ${command.phase === 'submitting' ? `<p class="notice" role="status">${esc(L('Sending…', 'در حال ارسال…'))}</p>` : ['failed', 'rejected'].includes(command.phase) ? `<p class="notice bad" role="alert" dir="auto">${esc(command.message)}</p>` : ''}
    ${snapshot.intent.phase === 'confirmed' ? `<p class="notice good" role="status">${esc(mutationIntentCopy('confirmed', state.locale))} <a href="#/services/${snapshot.intent.requestId}">${esc(L('View request', 'مشاهده درخواست'))} <bdi>#${snapshot.intent.requestId}</bdi></a></p>` : ''}
    ${snapshot.intent.phase === 'expired' ? `<p class="notice" role="alert">${esc(mutationIntentCopy('expired', state.locale))}</p>` : ''}
    ${snapshot.intent.record && snapshot.intent.phase === 'unknown' ? `<div class="notice" role="alert"><p>${esc(mutationIntentCopy(snapshot.intent.unknownReason, state.locale))}</p><div class="cluster">${button(snapshot.intent.reconciling ? L('Checking…', 'در حال بررسی…') : L('Check with server', 'بررسی با سرور'), 'reconcile', busy)}${snapshot.canReplay ? button(L('Retry the exact same inquiry', 'تلاش دوباره برای همان درخواست'), 'replay') : ''}${button(mutationIntentCopy('clear', state.locale), 'confirm-discard', busy)}<a class="btn" href="#/services">${esc(L('Review my requests', 'بررسی درخواست‌های من'))}</a></div>${entry.confirmDiscard ? `<p>${esc(mutationIntentCopy('clearWarning', state.locale))}</p><div class="cluster">${button(L('Clear recovery record', 'پاک کردن سابقه بازیابی'), 'discard', busy)}${button(L('Keep recovery record', 'نگه داشتن سابقه بازیابی'), 'cancel-discard')}</div>` : ''}</div>` : ''}
    ${!snapshot.intent.durable ? `<p class="notice">${esc(L('This device cannot retain recovery information. Check My service requests before sending again after leaving this page.', 'این دستگاه نمی‌تواند اطلاعات بازیابی را نگه دارد. پس از خروج از این صفحه، قبل از ارسال دوباره درخواست‌های من را بررسی کنید.'))}</p>` : ''}
    ${!person.service_categories.length ? `<p class="notice">${esc(L('This profile has no published service categories available for an inquiry.', 'این نمایه دسته خدمت منتشرشده‌ای برای درخواست ندارد.'))}</p>` : ''}
    <form id="classic-service-inquiry"><fieldset class="form-grid classic-inquiry-fields" ${snapshot.canSubmit ? '' : 'disabled'}><legend>${esc(L('Inquiry details', 'جزئیات درخواست'))}</legend>
      ${field('classic-inquiry-category', L('Requested service', 'خدمت درخواستی'), `<select id="classic-inquiry-category" name="category" required>${person.service_categories.map(category => `<option value="${attr(category)}" ${category === draft.category ? 'selected' : ''}>${esc(serviceCategoryLabel(category, state.locale))}</option>`).join('')}</select>`)}
      ${field('classic-inquiry-horse', L('Horse ID (optional)', 'شناسه اسب (اختیاری)'), `<input id="classic-inquiry-horse" name="horse" value="${attr(draft.horse)}" inputmode="numeric" pattern="[0-9]*" dir="ltr">`)}
      ${field('classic-inquiry-province', L('Province (optional)', 'استان (اختیاری)'), `<select id="classic-inquiry-province" name="province"><option value="">${esc(L('Not specified', 'مشخص نشده'))}</option>${options(IRAN_PROVINCES, draft.province, provinceLabel, 'code')}</select>`)}
      ${field('classic-inquiry-city', L('City (optional)', 'شهر (اختیاری)'), `<input id="classic-inquiry-city" name="city" value="${attr(draft.city)}" maxlength="120" dir="auto">`)}
      ${field('classic-inquiry-note', L('Private inquiry note', 'یادداشت خصوصی درخواست'), `<textarea id="classic-inquiry-note" name="note" required minlength="10" maxlength="500" rows="4" dir="auto">${esc(draft.note)}</textarea>`, true)}
      <label class="check span-all classic-service-check"><input type="checkbox" name="share" ${draft.share ? 'checked' : ''}><span>${esc(L('Share my account contact details with the current managers of this professional for this request.', 'اطلاعات تماس حساب من برای این درخواست با مدیران فعلی این متخصص به اشتراک گذاشته شود.'))}</span></label>
      <div class="cluster span-all"><button id="classic-inquiry-submit" class="btn btn-primary" type="submit" ${snapshot.canSubmit && validDraft(entry, person) ? '' : 'disabled'}>${esc(L('Send inquiry', 'ارسال درخواست'))}</button></div>
    </fieldset></form>
  </div></section>`;
}
function detailMarkup() {
  const data = view.phase === 'ready' ? view.data : null;
  if (!data) return `<section class="panel"><div class="panel-body">${readNotice()}</div></section>`;
  const person = data.person;
  return `<section class="panel"><div class="panel-head"><h2 dir="auto">${esc(name(person))}</h2></div><div class="panel-body"><dl class="classic-service-facts"><div><dt>${esc(L('Services', 'خدمات'))}</dt><dd>${esc(person.service_categories.map(category => serviceCategoryLabel(category, state.locale)).join(' · ') || '—')}</dd></div><div><dt>${esc(L('Location', 'محل'))}</dt><dd dir="auto">${locationMarkup(person)}</dd></div><div><dt>${esc(L('Languages', 'زبان‌ها'))}</dt><dd dir="auto">${esc(formatDirectoryLanguages(person.languages, state.locale))}</dd></div><div><dt>${esc(L('Availability', 'زمان دسترسی'))}</dt><dd dir="auto">${esc(person.availability_text || '—')}</dd></div></dl><h3>${esc(L('Recorded credentials', 'مدارک ثبت‌شده'))}</h3><p>${esc(L('A listed credential is not independent proof of qualification.', 'ثبت یک مدرک به‌تنهایی اثبات مستقل صلاحیت نیست.'))}</p><div class="classic-service-cards">${data.credentials.map(credentialMarkup).join('') || `<p>${esc(L('No credential entries are recorded for this profile.', 'مدرکی برای این نمایه ثبت نشده است.'))}</p>`}</div><p class="muted" dir="auto">${esc(data.credentials_note)}</p></div></section>${composerMarkup(person)}`;
}
function draw(root) {
  if (!root.isConnected || surface !== root || authority !== state.auth || !view) return;
  preserveServiceFocus(root, () => { root.innerHTML = `<div class="classic-service-page"><header class="page-head"><div><h1>${esc(view.id ? L('Professional profile', 'نمایه متخصص') : L('Find a professional', 'یافتن متخصص'))}</h1><p>${esc(L('Profiles published with consent. Private contact is shared only through a service request.', 'نمایه‌هایی که با رضایت منتشر شده‌اند. اطلاعات تماس خصوصی فقط از مسیر درخواست خدمت به اشتراک گذاشته می‌شود.'))}</p></div><div class="cluster">${view.id ? `<a class="btn" href="#/directory">${esc(L('All professionals', 'همه متخصصان'))}</a>` : ''}<a class="btn" href="#/services">${esc(L('My service requests', 'درخواست‌های خدمت من'))}</a></div></header>${view.id ? detailMarkup() : directoryMarkup()}</div>`; });
}
async function load(root) {
  readController?.abort(); const controller = new AbortController(); readController = controller;
  const turn = ++sequence, owner = authority, id = view.id;
  const current = () => turn === sequence && owner === state.auth && surface === root && root.isConnected;
  view = { id, phase: 'loading', data: null }; draw(root);
  try {
    const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
    const value = await serviceApi(id ? `/api/directory/persons/${id}` : `/api/directory/persons?${params}`, { signal: controller.signal });
    if (!current()) return;
    if (id ? !value?.person || value.person.person_id !== id || !Array.isArray(value.person.service_categories) || !Array.isArray(value.credentials) : !Array.isArray(value?.persons) || !('next_cursor' in value)) throw new Error(L('The server returned an incomplete directory response.', 'سرور پاسخ ناقصی برای فهرست برگرداند.'));
    view = { id, phase: 'ready', data: value }; if (id) ensureComposer(value.person); draw(root);
  } catch (error) { if (current()) { view = { id, phase: 'error', error: error.message, data: null }; draw(root); } }
}

export async function renderDirectory(root) {
  ensureAuthority(); surface = root;
  const raw = state.route.params.id, id = raw ? serviceId(raw) : null;
  if (raw && id === null) { root.innerHTML = `<p class="notice bad" role="alert">${esc(L('Invalid professional ID.', 'شناسه متخصص نامعتبر است.'))} <a href="#/directory">${esc(L('Back to professionals', 'بازگشت به متخصصان'))}</a></p>`; view = null; return; }
  view = { id, phase: 'loading', data: null };
  root.addEventListener('input', event => {
    const input = event.target, form = input.closest('form'); if (!form || authority !== state.auth) return;
    if (form.id === 'classic-directory-filters' && input.name in filters) filters[input.name] = input.value;
    const entry = composers.get(view?.id);
    if (form.id === 'classic-service-inquiry' && entry && input.name in entry.draft && entry.store.getSnapshot().canSubmit) {
      entry.draft[input.name] = input.name === 'share' ? input.checked : input.value;
      const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = !validDraft(entry, view.data.person);
    }
  });
  root.addEventListener('change', event => { if (event.target.matches('select,input[type="checkbox"]')) event.target.dispatchEvent(new Event('input', { bubbles: true })); });
  root.addEventListener('submit', async event => {
    const form = event.target; if (!['classic-directory-filters', 'classic-service-inquiry'].includes(form.id)) return; event.preventDefault();
    if (authority !== state.auth || !form.reportValidity()) return;
    if (form.id === 'classic-directory-filters') { query = { ...filters, name: filters.name.trim(), cursor: 0 }; await load(root); return; }
    const entry = composers.get(view?.id); if (!entry || !entry.store.getSnapshot().canSubmit || !validDraft(entry, view.data.person)) return;
    const draft = entry.draft;
    await entry.store.create({ provider_person_id: view.id, category: draft.category, note: draft.note.trim(), share_contact: draft.share, horse_id: draft.horse ? serviceId(draft.horse) : null, city: draft.city.trim() || null, province_code: draft.province || null, ...(draft.province ? { province_code_scheme: PROVINCE_CODE_SCHEME } : {}) });
  });
  root.addEventListener('click', async event => {
    const control = event.target.closest('[data-directory-action]'); if (!control || control.disabled || authority !== state.auth) return;
    const action = control.dataset.directoryAction, entry = composers.get(view?.id);
    if (action === 'retry') await load(root);
    else if (action === 'clear') { filters = emptyFilters(); query = emptyFilters(); await load(root); }
    else if (action === 'first') { query.cursor = 0; await load(root); }
    else if (action === 'next' && view.data?.next_cursor !== null) { query.cursor = view.data.next_cursor; await load(root); }
    else if (entry) {
      if (action === 'reconcile') await entry.store.reconcile();
      else if (action === 'replay') await entry.store.retryExact();
      else if (action === 'confirm-discard') { entry.confirmDiscard = true; draw(root); }
      else if (action === 'cancel-discard') { entry.confirmDiscard = false; draw(root); }
      else if (action === 'discard' && entry.confirmDiscard) { entry.store.discard(); entry.confirmDiscard = false; draw(root); }
    }
  });
  await load(root);
}
