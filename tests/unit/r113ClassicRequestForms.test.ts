// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Native Classic modules intentionally have no separate TypeScript declarations.
// @ts-expect-error Native JavaScript module.
import { state, modal } from '../../standalone-frontends/classic-v1.4/public/ui/core.js';
// @ts-expect-error Native JavaScript module.
import { openHorseRequest, submitHorseRequest, horseRequestAction, resetHorseRequests, refreshHorseRequestPresentation } from '../../standalone-frontends/classic-v1.4/public/ui/views/horseRequests.js';
// @ts-expect-error Native JavaScript module.
import { dispatchModalForm } from '../../standalone-frontends/classic-v1.4/public/ui/modalForms.js';
vi.mock('../../standalone-frontends/classic-v1.4/public/ui/sound.js', () => ({ playCue: () => {} }));
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Open</button><dialog id="modal"><div id="modal-body"></div></dialog><div id="toast-stack"></div>';
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  state.locale = 'en'; state.auth = { user: { id: 'A' }, csrfToken: 'csrf-test', permissions: ['claim.create', 'change.create'] }; resetHorseRequests();
  fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
const form = () => document.querySelector<HTMLFormElement>('.classic-horse-request')!;
const fill = (name: string, value: string) => { const control = form().elements.namedItem(name) as HTMLInputElement; control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); };
const action = (name: string) => document.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
const submitButton = () => document.querySelector<HTMLButtonElement>('.modal-foot button[type="submit"]')!;

describe('R113 native Classic dialogs and horse request guards', () => {
  it('names dialogs, associates legacy sibling labels and dispatches real validated forms', async () => {
    modal('Review a record', '<form id="review-form"><div class="field"><label>Reason</label><input name="reason" required></div></form>', '<button data-action="submit-review" data-id="17" data-kind="claim">Save</button>');
    const dialog = document.querySelector('dialog')!; expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Review a record');
    const label = dialog.querySelector('label')!; expect(label.control).toBe(dialog.querySelector('input'));
    expect(submitButton().getAttribute('form')).toBe('review-form'); expect(submitButton().hasAttribute('data-action')).toBe(false);
    const admin = vi.fn(); const currentForm = dialog.querySelector('form')!;
    await dispatchModalForm(currentForm, { admin }); expect(admin).not.toHaveBeenCalled();
    dialog.querySelector('input')!.value = 'Owner mandate reviewed'; await dispatchModalForm(currentForm, { admin }); expect(admin).toHaveBeenCalledWith('submit-review', currentForm); expect(currentForm.dataset.id).toBe('17');
  });
  it('sends real text evidence once, keeps pending state on reopen and clears only after a receipt', async () => {
    const write = deferred<Response>(); fetcher.mockReturnValue(write.promise);
    openHorseRequest('claim', 17, 'Demo horse'); fill('note', 'Signed owner mandate reviewed today.');
    const original = form(); const pending = submitHorseRequest(original); await submitHorseRequest(original);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ horse_id: 17, evidence: { note: 'Signed owner mandate reviewed today.' } }); expect(submitButton().disabled).toBe(true);
    document.querySelector('dialog')!.close(); openHorseRequest('claim', 17, 'Demo horse'); expect(submitButton().disabled).toBe(true); expect((form().elements.namedItem('note') as HTMLTextAreaElement).value).toContain('Signed owner');
    write.resolve(json({ claim: { id: 'claim-17' }, workflowEffect: 'review_only', canonicalApplied: false }, 201)); await pending; expect(document.querySelector('dialog')!.open).toBe(false);
    openHorseRequest('claim', 17, 'Demo horse'); expect((form().elements.namedItem('note') as HTMLTextAreaElement).value).toBe('');
  });
  it('retains unknown drafts through failed/pending rereads and requires an explicit completed-read acknowledgement', async () => {
    const read = deferred<Response>(); fetcher.mockResolvedValueOnce(json({ error: { message: 'Response lost' } }, 503)).mockReturnValueOnce(read.promise).mockResolvedValueOnce(json({ error: { message: 'Read failed' } }, 503)).mockResolvedValue(json({ requests: [{ id: 'change-17', horse_id: 17, status: 'pending', summary: 'Existing request' }] }));
    openHorseRequest('change', 17, 'Demo horse'); fill('note', 'Correct the recorded birth year.'); fill('field_name', 'birth_year'); fill('proposed_value', '2020'); await submitHorseRequest(form());
    const firstPayload = JSON.parse(fetcher.mock.calls[0]![1].body); expect(firstPayload.idempotency_key).toBeTruthy(); expect(document.body.textContent).toContain('result is unknown');
    const reread = horseRequestAction('horse-request-refresh', action('horse-request-refresh')); expect(submitButton().disabled).toBe(true); expect(action('horse-request-ack')).toBeNull();
    read.reject(new Error('Connection still unavailable')); await reread; expect(document.body.textContent).toContain('Submission remains locked'); expect(action('horse-request-ack')).toBeNull();
    await horseRequestAction('horse-request-refresh', action('horse-request-refresh')); expect(action('horse-request-ack')).toBeNull();
    await horseRequestAction('horse-request-refresh', action('horse-request-refresh')); expect(document.body.textContent).toContain('change-17'); expect(submitButton().disabled).toBe(true);
    await horseRequestAction('horse-request-ack', action('horse-request-ack')); expect(submitButton().disabled).toBe(false); expect((form().elements.namedItem('note') as HTMLTextAreaElement).value).toBe('Correct the recorded birth year.'); expect(fetcher.mock.calls.filter(([, request]) => request?.method === 'POST')).toHaveLength(1);
  });
  it('preserves rejected drafts, localizes an open dialog, and never closes an unrelated replacement dialog on late success', async () => {
    fetcher.mockResolvedValueOnce(json({ error: { code: 'invalid_claim', message: 'Need supporting evidence' } }, 422));
    openHorseRequest('claim', 17); fill('note', 'Keep the evidence draft.'); await submitHorseRequest(form()); expect(submitButton().disabled).toBe(false); expect(document.body.textContent).toContain('not accepted');
    state.locale = 'fa'; refreshHorseRequestPresentation(); expect(document.body.textContent).toContain('مدرک مالکیت'); expect((form().elements.namedItem('note') as HTMLTextAreaElement).value).toBe('Keep the evidence draft.');
    const write = deferred<Response>(); fetcher.mockReturnValueOnce(write.promise); const pending = submitHorseRequest(form());
    modal('Another record', '<p id="replacement">Unrelated work</p>'); write.resolve(json({ claim: { id: 'claim-other' } }, 201)); await pending;
    expect(document.querySelector('dialog')!.open).toBe(true); expect(document.getElementById('replacement')?.textContent).toBe('Unrelated work'); expect(document.getElementById('toast-stack')!.textContent).toBe('');
  });
  it('retires old completions across A → B → A without leaking the old evidence or receipt', async () => {
    const write = deferred<Response>(); fetcher.mockReturnValue(write.promise);
    openHorseRequest('claim', 17); fill('note', 'Private old A evidence'); const pending = submitHorseRequest(form());
    state.auth = { user: { id: 'B' }, permissions: [] }; resetHorseRequests(); state.auth = { user: { id: 'A' }, permissions: [] }; resetHorseRequests(); openHorseRequest('claim', 17); fill('note', 'New current evidence');
    write.resolve(json({ claim: { id: 'stale-receipt' } }, 201)); await pending;
    expect((form().elements.namedItem('note') as HTMLTextAreaElement).value).toBe('New current evidence'); expect(document.body.textContent).not.toContain('stale-receipt'); expect(submitButton().disabled).toBe(false);
  });
});
