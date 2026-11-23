import { state, api, modal, closeModal, toast, esc, attr, fa, t } from '../core.js';

// A closed dialog is not a cancelled HTTP command. Keep its lock for this session.
let authority = null;
let requests = new Map();
export function resetHorseRequests() { authority = state.auth; requests = new Map(); }
export function refreshHorseRequestPresentation() { const request = currentScope().get(document.getElementById('modal')?.dataset.horseRequest); if (request && document.getElementById('modal')?.open) draw(request); }
const L = (en, persian) => fa() ? persian : en;
function currentScope() { if (authority !== state.auth) resetHorseRequests(); return requests; }
function isCurrent(request) { return request.authority === state.auth && request.bucket === requests; }
function visible(request) { return document.getElementById('modal')?.dataset.horseRequest === request.key; }
function receiptId(result, kind) { const id = result?.[kind === 'claim' ? 'claim' : 'request']?.id; return typeof id === 'string' && id.length > 0 || Number.isSafeInteger(id) && id > 0 ? id : null; }
function capture(form, request) {
  for (const key of ['note', 'field_name', 'proposed_value']) {
    const control = form.elements.namedItem(key);
    if (control) request.draft[key] = control.value;
  }
}

export function openHorseRequest(kind, horseId, horseName = '') {
  if (!Number.isSafeInteger(horseId) || horseId < 1) return;
  const bucket = currentScope(), key = `${kind}:${horseId}`;
  let request = bucket.get(key);
  if (!request || request.phase === 'accepted') {
    request = { authority: state.auth, bucket, key, kind, horseId, horseName, phase: 'idle', message: '', draft: { note: '', field_name: '', proposed_value: '' }, recovery: 'none', rows: [], readEpoch: 0, intentKey: null };
    bucket.set(key, request);
  }
  draw(request, true);
}

function statusLabel(status) { return ({ pending: L('Pending review', 'در انتظار بررسی'), approved: L('Approved', 'تأییدشده'), rejected: L('Rejected', 'ردشده'), withdrawn: L('Withdrawn', 'بازپس‌گیری‌شده'), draft: L('Draft', 'پیش‌نویس') })[status] || status; }
function feedback(request) {
  const { phase, recovery, rows } = request;
  if (phase === 'submitting') return `<p class="notice" role="status">${esc(L('Submitting your request…', 'در حال ثبت درخواست…'))}</p>`;
  if (phase === 'rejected') return `<div class="notice bad" role="alert"><strong>${esc(L('The request was not accepted. Your draft is preserved.', 'درخواست پذیرفته نشد. پیش‌نویس شما حفظ شده است.'))}</strong><p dir="auto">${esc(request.message)}</p></div>`;
  if (phase !== 'unknown') return '';
  return `<div class="notice bad" role="alert"><strong>${esc(L('The result is unknown. Read the latest requests before trying again.', 'نتیجه نامشخص است. پیش از تلاش دوباره، آخرین درخواست‌ها را بخوانید.'))}</strong><p dir="auto">${esc(request.message)}</p><div class="cluster"><button type="button" class="btn" data-action="horse-request-refresh" data-key="${attr(request.key)}" ${recovery === 'reading' ? 'disabled' : ''}>${esc(recovery === 'reading' ? L('Reading…', 'در حال خواندن…') : L('Read latest requests', 'خواندن آخرین درخواست‌ها'))}</button>${recovery === 'ready' ? `<button type="button" class="btn" data-action="horse-request-ack" data-key="${attr(request.key)}">${esc(L('I have checked the latest requests', 'آخرین درخواست‌ها را بررسی کردم'))}</button>` : ''}</div>${recovery === 'failed' ? `<p>${esc(L('The reread failed. Submission remains locked.', 'خواندن دوباره ناموفق بود. ثبت درخواست همچنان قفل است.'))}</p>` : ''}${recovery === 'ready' ? `<div class="classic-request-history"><h3>${esc(L('Current requests for this horse', 'درخواست‌های فعلی برای این اسب'))}</h3>${rows.length ? `<ul>${rows.map(row => `<li><bdi>#${esc(row.id)}</bdi> · ${esc(statusLabel(row.status))}${row.summary ? `<p dir="auto">${esc(row.summary)}</p>` : ''}${row.review_note ? `<p dir="auto">${esc(row.review_note)}</p>` : ''}</li>`).join('')}</ul>` : `<p>${esc(L('No requests were returned for this horse. An absent record is not proof that the earlier write cannot still complete.', 'درخواستی برای این اسب برگردانده نشد. نبود رکورد تضمین نمی‌کند که درخواست قبلی بعداً ثبت نشود.'))}</p>`}</div>` : ''}</div>`;
}

function draw(request, opening = false) {
  if (!isCurrent(request) || !opening && !visible(request)) return;
  const locked = request.phase === 'submitting' || request.phase === 'unknown';
  const claim = request.kind === 'claim';
  const formId = claim ? 'claim-form' : 'change-form';
  modal(claim ? t('submitClaim') : t('requestChange'), `<form id="${formId}" class="stack classic-horse-request" data-request-key="${attr(request.key)}"><p class="notice"><bdi>#${request.horseId}</bdi> <span dir="auto">${esc(request.horseName)}</span></p><p>${esc(L('Supply your own explanation and supporting evidence. Submission requests a review; it does not itself confirm a record change.', 'توضیح و مدارک پشتیبان خود را وارد کنید. ثبت درخواست برای بررسی است و به‌تنهایی تغییر رکورد را تأیید نمی‌کند.'))}</p><div class="field"><label for="horse-request-note">${esc(claim ? L('Ownership evidence', 'مدرک مالکیت') : L('What needs correcting?', 'چه اطلاعاتی باید اصلاح شود؟'))}</label><textarea id="horse-request-note" name="note" required minlength="${claim ? 1 : 3}" maxlength="2000" rows="4" dir="auto" ${locked ? 'disabled' : ''}>${esc(request.draft.note)}</textarea></div>${claim ? '' : `<div class="form-grid"><div class="field"><label for="horse-request-field">${esc(L('Field name (optional)', 'نام فیلد (اختیاری)'))}</label><input id="horse-request-field" name="field_name" maxlength="120" value="${attr(request.draft.field_name)}" dir="ltr" ${locked ? 'disabled' : ''}></div><div class="field"><label for="horse-request-value">${esc(t('proposedValue'))}</label><input id="horse-request-value" name="proposed_value" maxlength="2000" value="${attr(request.draft.proposed_value)}" dir="auto" ${locked ? 'disabled' : ''}></div></div>`}${feedback(request)}</form>`, `<button type="button" class="btn" data-action="close-modal">${esc(t('cancel'))}</button><button class="btn btn-primary" data-action="${claim ? 'submit-claim' : 'submit-change'}" data-id="${request.horseId}" ${locked ? 'disabled' : ''}>${esc(t('submit'))}</button>`);
  const dialog = document.getElementById('modal'); dialog.dataset.horseRequest = request.key; dialog.setAttribute('aria-busy', String(request.phase === 'submitting'));
  const form = document.getElementById(formId);
  form.addEventListener('input', () => { if (isCurrent(request) && request.phase !== 'submitting' && request.phase !== 'unknown') capture(form, request); });
}

export async function submitHorseRequest(form) {
  const request = currentScope().get(form?.dataset.requestKey);
  if (!request || !isCurrent(request) || ['submitting', 'unknown', 'accepted'].includes(request.phase) || !form.reportValidity()) return;
  capture(form, request);
  const note = request.draft.note.trim();
  if (note.length < (request.kind === 'claim' ? 1 : 3) || note.length > 2000) return;
  request.phase = 'submitting'; request.message = ''; request.recovery = 'none';
  const claim = request.kind === 'claim';
  if (!claim && !request.intentKey) request.intentKey = crypto.randomUUID();
  const input = claim ? { horse_id: request.horseId, evidence: { note } } : { horse_id: request.horseId, request_type: 'update_horse', summary: note, idempotency_key: request.intentKey, items: request.draft.field_name.trim() ? [{ field_name: request.draft.field_name.trim(), proposed_value: request.draft.proposed_value }] : [] };
  draw(request);
  try {
    const result = await api(claim ? '/api/claims' : '/api/change-requests', { method: 'POST', json: input });
    if (!isCurrent(request)) return;
    const id = receiptId(result, request.kind); if (id === null) throw new Error(L('The response did not contain a request receipt.', 'پاسخ شامل رسید درخواست نبود.'));
    request.phase = 'accepted'; request.draft = { note: '', field_name: '', proposed_value: '' };
    if (visible(request)) { closeModal(); toast(`${L('Request submitted for review.', 'درخواست برای بررسی ثبت شد.')} #${id}`); }
  } catch (error) {
    if (!isCurrent(request)) return;
    request.phase = Number(error?.status) >= 400 && Number(error?.status) < 500 && error?.code !== 'session_superseded' ? 'rejected' : 'unknown';
    request.message = error instanceof Error ? error.message : String(error);
    if (request.phase === 'rejected') request.intentKey = null;
    draw(request);
  }
}

export async function horseRequestAction(action, element) {
  const request = currentScope().get(element?.dataset.key);
  if (!request || !isCurrent(request) || request.phase !== 'unknown') return;
  if (action === 'horse-request-ack') {
    if (request.recovery !== 'ready') return;
    request.phase = 'idle'; request.recovery = 'none'; request.message = ''; draw(request); return;
  }
  if (action !== 'horse-request-refresh' || request.recovery === 'reading') return;
  const epoch = ++request.readEpoch;
  request.recovery = 'reading'; draw(request);
  try {
    const result = await api(request.kind === 'claim' ? '/api/claims/mine' : '/api/change-requests/mine');
    if (!isCurrent(request) || epoch !== request.readEpoch) return;
    const rows = request.kind === 'claim' ? result?.claims : result?.requests;
    if (!Array.isArray(rows)) throw new Error('The latest request list could not be verified.');
    request.rows = rows.filter(row => Number(row.horse_id) === request.horseId); request.recovery = 'ready';
  } catch (error) {
    if (!isCurrent(request) || epoch !== request.readEpoch) return;
    request.recovery = 'failed'; request.message = error instanceof Error ? error.message : String(error);
  }
  draw(request);
}
