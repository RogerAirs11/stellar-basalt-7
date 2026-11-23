import { api } from './core.js';
import { PlatformClientError } from './service-domain.js';

/** Adapt Classic's CSRF/session-aware transport to the shared domain error model. */
export async function serviceApi(path, options) {
  try { return await api(path, options); }
  catch (error) {
    if (error instanceof PlatformClientError || !Number.isInteger(error?.status)) throw error;
    throw new PlatformClientError(error.status, error.code || 'http_error', error.message, error.details);
  }
}
export const serviceRequestsApi = {
  mine: options => serviceApi('/api/service-requests/mine', options),
  inbox: options => serviceApi('/api/service-requests/inbox', options),
  detail: (id, options) => serviceApi(`/api/service-requests/${id}`, options),
  create: (input, options) => serviceApi('/api/service-requests', { ...options, method: 'POST', headers: { 'Idempotency-Key': options.idempotencyKey }, json: input }),
  reconcileIntent: (key, options) => serviceApi(`/api/service-requests/intents/${encodeURIComponent(key)}`, options),
  setStatus: (id, status, options) => serviceApi(`/api/service-requests/${id}/status`, { ...options, method: 'POST', json: { status, expected_version: options.expectedVersion } }),
  withdrawConsent: id => serviceApi(`/api/service-requests/${id}/consent`, { method: 'POST', json: {} }),
  redactNote: id => serviceApi(`/api/service-requests/${id}/redact`, { method: 'POST', json: {} }),
  block: id => serviceApi(`/api/service-requests/${id}/block`, { method: 'POST', json: {} }),
  providerBlock: (id, input) => serviceApi(`/api/service-requests/${id}/provider-block`, { method: 'POST', json: input ?? {} }),
  report: (id, input) => serviceApi(`/api/service-requests/${id}/report`, { method: 'POST', json: input }),
};

export function preserveServiceFocus(root, draw) {
  const previous = root.contains(document.activeElement) ? document.activeElement : null;
  const id = previous?.id;
  const selection = previous && typeof previous.selectionStart === 'number' ? [previous.selectionStart, previous.selectionEnd, previous.selectionDirection] : null;
  draw();
  const current = id ? document.getElementById(id) : null;
  if (current && root.contains(current) && !current.disabled) {
    current.focus({ preventScroll: true });
    if (selection && current.setSelectionRange) { try { current.setSelectionRange(...selection); } catch { /* Selects and nontext inputs have no caret. */ } }
  }
}

export const serviceId = value => { const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN; return Number.isSafeInteger(id) && id > 0 ? id : null; };
