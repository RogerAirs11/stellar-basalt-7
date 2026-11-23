// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Classic JavaScript has no separate declarations.
import { state } from '../../standalone-frontends/classic-v1.4/public/ui/core.js';
// @ts-expect-error Native Classic JavaScript has no separate declarations.
import { renderDirectory, resetDirectoryWorkbench } from '../../standalone-frontends/classic-v1.4/public/ui/views/directory.js';
// @ts-expect-error Native Classic JavaScript has no separate declarations.
import { renderServices, resetServiceWorkbench } from '../../standalone-frontends/classic-v1.4/public/ui/views/services.js';
vi.mock('../../standalone-frontends/classic-v1.4/public/ui/sound.js', () => ({ playCue: () => {} }));
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const professional = { person_id: 7, name_latin: 'Test professional', name_native: 'متخصص آزمایشی', service_categories: ['veterinarian'], city: 'Tehran', province_code: null, languages: 'English', availability_text: 'By inquiry' };
const profile = { person: professional, credentials: [], active_credentials: [], credentials_note: 'Recorded credentials only.' };
const row = (patch: Record<string, unknown> = {}) => ({ id: 71, provider_person_id: 7, category: 'veterinarian', province_code: null, city: 'Tehran', horse_id: null, status: 'new', row_version: 1, created_at: '2026-10-17T10:00:00Z', updated_at: '2026-10-17T10:00:00Z', is_requester_view: true, note: 'Private inquiry note', contact: { display_name: 'Requester', email: 'private@example.test', via: 'consented' }, ...patch });
const receipt = (id = 71) => ({ created: true, request: { id, provider_person_id: 7, category: 'veterinarian', share_contact: false }, request_digest: 'test-receipt-digest' });
let root: HTMLDivElement, fetcher: ReturnType<typeof vi.fn>;
const fresh = () => { const next = document.createElement('div'); root.replaceWith(next); root = next; return root; };
const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-directory-action="${name}"],[data-service-action="${name}"]`)!;
const fill = (id: string, value: string) => { const field = document.getElementById(id) as HTMLInputElement; field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); };
const send = () => root.querySelector('form#classic-service-inquiry')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
beforeEach(() => {
  root = document.createElement('div'); document.body.appendChild(root); localStorage.clear();
  state.locale = 'en'; state.auth = { user: { id: 'A' }, csrfToken: 'csrf', permissions: [] }; state.route = { name: 'directory', params: { id: '7' } };
  resetDirectoryWorkbench(); resetServiceWorkbench(); fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { resetDirectoryWorkbench(); resetServiceWorkbench(); root.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('R113 native Classic service integration', () => {
  it('submits one actual inquiry, retains its draft during a locale rebuild and clears it only after a receipt', async () => {
    const write = deferred<Response>(); fetcher.mockImplementation((path: string) => path.startsWith('/api/directory/') ? Promise.resolve(json(profile)) : write.promise);
    await renderDirectory(root); fill('classic-inquiry-note', 'Please discuss this horse service.'); send(); send();
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(writes).toHaveLength(1);
    const body = JSON.parse(writes[0]![1].body); expect(body).toMatchObject({ provider_person_id: 7, category: 'veterinarian', note: 'Please discuss this horse service.', share_contact: false }); expect(writes[0]![1].headers.get('Idempotency-Key')).toBeTruthy();
    state.locale = 'fa'; await renderDirectory(fresh()); expect((document.getElementById('classic-inquiry-note') as HTMLTextAreaElement).value).toBe(body.note); expect((document.getElementById('classic-inquiry-submit') as HTMLButtonElement).disabled).toBe(true);
    write.resolve(json(receipt(), 201)); await vi.waitFor(() => expect(root.textContent).toContain('سرور ثبت این درخواست را تأیید کرد'));
    expect((document.getElementById('classic-inquiry-note') as HTMLTextAreaElement).value).toBe(''); expect(root.querySelector('a[href="#/services/71"]')).not.toBeNull();
  });
  it('keeps uncertain creation locked through failed lookup and replays only its exact original key and note', async () => {
    let lookup = 0, writes = 0; const pending = deferred<Response>();
    fetcher.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/directory/')) return Promise.resolve(json(profile));
      if (path.includes('/intents/')) { lookup++; return lookup === 1 ? pending.promise : Promise.resolve(json({ state: 'unknown' })); }
      if (init?.method === 'POST') { writes++; return Promise.resolve(writes === 1 ? json({ error: { message: 'Lost response' } }, 503) : json(receipt(), 201)); }
      throw new Error(path);
    });
    await renderDirectory(root); fill('classic-inquiry-note', 'Retain this exact original note.'); send(); await vi.waitFor(() => expect(action('reconcile')?.disabled).toBe(false));
    action('reconcile').click(); expect(lookup).toBe(1); expect(action('replay')).toBeNull(); expect((document.getElementById('classic-inquiry-submit') as HTMLButtonElement).disabled).toBe(true);
    pending.reject(new Error('Lookup unavailable')); await vi.waitFor(() => expect(action('reconcile').disabled).toBe(false)); expect(action('replay')).toBeNull();
    action('reconcile').click(); await vi.waitFor(() => expect(action('replay')).not.toBeNull()); action('replay').click(); await vi.waitFor(() => expect(root.querySelector('a[href="#/services/71"]')).not.toBeNull());
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[1]![1].body).toBe(posts[0]![1].body); expect(posts[1]![1].headers.get('Idempotency-Key')).toBe(posts[0]![1].headers.get('Idempotency-Key'));
    expect([...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index)!)).join('')).not.toContain('Retain this exact');
  });
  it('retains a request recovery panel when a denied reread removes its private detail and only unlocks after inspection', async () => {
    let readDenied = false; state.route = { name: 'services', params: { id: '71' } };
    fetcher.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(json({ error: { message: 'Response unknown' } }, 503));
      if (path.endsWith('/mine') || path.endsWith('/inbox')) return Promise.resolve(json({ requests: [row()] }));
      return Promise.resolve(readDenied ? json({ error: { message: 'No current access' } }, 403) : json({ request: row() }));
    });
    await renderServices(root); await vi.waitFor(() => expect(action('transition')).not.toBeNull()); action('transition').click(); action('transition')?.click(); await vi.waitFor(() => expect(action('reconcile')).not.toBeNull());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1); readDenied = true; action('reconcile').click();
    await vi.waitFor(() => expect(root.textContent).toContain('Actions remain locked')); expect(root.textContent).not.toContain('private@example.test'); expect(action('acknowledge')).toBeNull(); expect(root.querySelector('.classic-service-recovery')).not.toBeNull();
    readDenied = false; action('reconcile').click(); await vi.waitFor(() => expect(action('acknowledge')).not.toBeNull()); expect(action('transition').disabled).toBe(true); action('acknowledge').click(); expect(action('transition').disabled).toBe(false);
  });
  it('uses native labeled report forms with the entered reason and preserves unknown lock instead of claiming success', async () => {
    state.route = { name: 'services', params: { id: '71' } }; const write = deferred<Response>();
    fetcher.mockImplementation((path: string, init?: RequestInit) => init?.method === 'POST' ? write.promise : Promise.resolve(json(path.endsWith('/mine') ? { requests: [row({ is_requester_view: false })] } : { request: row({ is_requester_view: false }) })));
    await renderServices(root); await vi.waitFor(() => expect(root.querySelector('.classic-service-report')).not.toBeNull());
    fill('classic-service-reason-71', 'Evidence of repeated abusive requests.'); const form = root.querySelector('form.classic-service-report')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(posts).toHaveLength(1); expect(posts[0]![0]).toBe('/api/service-requests/71/report'); expect(JSON.parse(posts[0]![1].body)).toEqual({ reason: 'Evidence of repeated abusive requests.' });
    write.resolve(json({ error: { message: 'Receipt lost' } }, 503)); await vi.waitFor(() => expect(action('reconcile')).not.toBeNull()); expect(root.textContent).not.toContain('Change recorded'); expect((document.getElementById('classic-service-reason-71') as HTMLTextAreaElement).value).toContain('abusive');
  });
  it('drops old principal drafts and does not paint a delayed receipt into a new A → B → A authority', async () => {
    const write = deferred<Response>(); fetcher.mockImplementation((path: string) => path.startsWith('/api/directory/') ? Promise.resolve(json(profile)) : write.promise);
    await renderDirectory(root); fill('classic-inquiry-note', 'Old A private request.'); send();
    state.auth = { user: { id: 'B' }, permissions: [] }; resetDirectoryWorkbench(); await renderDirectory(fresh());
    state.auth = { user: { id: 'A' }, permissions: [] }; resetDirectoryWorkbench(); await renderDirectory(fresh());
    write.resolve(json(receipt(999), 201)); await Promise.resolve(); await Promise.resolve();
    expect(root.textContent).not.toContain('#999'); expect((document.getElementById('classic-inquiry-note') as HTMLTextAreaElement).value).toBe('');
  });
});
