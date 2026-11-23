// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryDesk } from '../../src/web/frontends/retro-astra/transplant/pages/DirectoryDesk';
import { ServiceDesk } from '../../src/web/frontends/retro-astra/transplant/pages/ServiceDesk';
import { PlatformClientError, type FrontendRuntimeProps, type PlatformClient } from '../../src/frontend-kit';
const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: 'en' as 'en' | 'fa' }));
vi.mock('../../src/web/frontends/retro-astra/transplant/HorseDbAdapter', () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider', () => ({ usePreferences: () => ({ language: context.language, n: String, date: String, t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (patch: Record<string, unknown> = {}) => ({ id: 71, provider_person_id: 7, category: 'veterinarian', status: 'new', row_version: 1, created_at: '2026-10-17T10:00:00Z', updated_at: '2026-10-17T10:00:00Z', is_requester_view: true, note: 'Private request note', contact: { display_name: 'Private requester', email: 'private@example.test', via: 'consented' }, ...patch });
const professional = { person_id: 7, name_latin: 'Demo professional', service_categories: ['veterinarian'], languages: 'English', city: 'Tehran' };
const profile = { person: professional, credentials: [], active_credentials: [], credentials_note: 'Recorded entries only.' };
let container: HTMLDivElement, root: Root;
beforeEach(() => { localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); context.language = 'en'; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
const field = (label: string) => document.getElementById([...container.querySelectorAll('label')].find(item => item.textContent === label)!.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
const fill = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
function runtime(services: Record<string, unknown> = {}) {
  context.runtime = { user: { id: 'A' }, permissions: [], platform: { modules: { directory: { person: vi.fn(async () => profile), persons: vi.fn(async () => ({ persons: [professional], next_cursor: null })) }, serviceRequests: { mine: vi.fn(async () => ({ requests: [row()] })), inbox: vi.fn(async () => ({ requests: [row({ is_requester_view: false })] })), detail: vi.fn(async () => ({ request: row() })), ...services } } } as unknown as PlatformClient } as unknown as FrontendRuntimeProps;
}

describe('R113 native Retro service integration', () => {
  it('uses real directory reads, validates target IDs and submits an actual inquiry once with the explicit consent value', async () => {
    const write = deferred<unknown>(), create = vi.fn(() => write.promise); runtime({ create });
    await render(<DirectoryDesk personId="0" />); expect(context.runtime.platform.modules.directory.person).not.toHaveBeenCalled(); expect(container.textContent).toContain('ID is invalid');
    await render(<DirectoryDesk personId="7" />); fill(field('Private inquiry note'), 'Please arrange a service discussion.');
    act(() => { button('Send inquiry').click(); container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]).toEqual([{ provider_person_id: 7, category: 'veterinarian', note: 'Please arrange a service discussion.', share_contact: false, city: null, province_code: null, horse_id: null }, { idempotencyKey: expect.any(String) }]);
    context.language = 'fa'; await render(<DirectoryDesk personId="7" />); expect(field('یادداشت خصوصی درخواست').value).toContain('Please arrange');
    await act(async () => { write.resolve({ created: true, request: { id: 71, provider_person_id: 7, category: 'veterinarian', share_contact: false }, request_digest: 'digest' }); });
    expect(field('یادداشت خصوصی درخواست').value).toBe(''); expect(container.querySelector('a[href="#/services/71"]')).not.toBeNull();
  });
  it('keeps unknown request recovery visible after denied detail and requires a successful reread plus inspection', async () => {
    let denied = false; const detail = vi.fn(async () => { if (denied) throw new PlatformClientError(403, 'forbidden', 'Read denied'); return { request: row() }; });
    const setStatus = vi.fn(async () => { throw new Error('Lost reply'); }); runtime({ detail, setStatus });
    await render(<ServiceDesk requestId="71" />); await act(async () => { button('Withdrawn').click(); }); expect(setStatus).toHaveBeenCalledTimes(1);
    denied = true; await act(async () => { button('Read current request').click(); }); expect(container.querySelector('.retro-service-recovery')).not.toBeNull(); expect(container.textContent).not.toContain('private@example.test'); expect(button('I have checked the current request')).toBeUndefined();
    denied = false; await act(async () => { button('Read current request').click(); }); expect(button('Withdrawn').disabled).toBe(true); await act(async () => { button('I have checked the current request').click(); }); expect(button('Withdrawn').disabled).toBe(false);
  });
  it('sends the actual report reason, prevents duplicates and masks old detail on a principal change', async () => {
    const write = deferred<unknown>(), report = vi.fn(() => write.promise); runtime({ report });
    await render(<ServiceDesk requestId="71" />); fill(field('Report reason (5–500 characters)'), 'Repeated unsolicited service contact.');
    act(() => { button('Submit report').click(); button('Submit report').click(); }); expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith(71, { reason: 'Repeated unsolicited service contact.' });
    context.runtime = { ...context.runtime, user: { ...context.runtime.user!, id: 'B' }, platform: { ...context.runtime.platform, modules: { ...context.runtime.platform.modules, serviceRequests: { ...context.runtime.platform.modules.serviceRequests, mine: async () => ({ requests: [] }), detail: async () => { throw new PlatformClientError(403, 'forbidden', 'New account has no access'); } } } } };
    await render(<ServiceDesk requestId="71" />); await act(async () => { write.resolve({ reported: true, report_id: 99 }); }); expect(container.textContent).not.toContain('Private requester'); expect(container.textContent).not.toContain('Repeated unsolicited'); expect(container.textContent).not.toContain('Action completed');
  });
});
