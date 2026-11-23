// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetroAstraProfileEditor } from '../../src/web/frontends/retro-astra/ProfileEditor';
import { RetroAstraOrganizationEditor } from '../../src/web/frontends/retro-astra/OrganizationEditor';
import { GovernanceDesk } from '../../src/web/frontends/retro-astra/transplant/pages/GovernanceDesk';
import { PlatformClientError, type PlatformClient, type FrontendRuntimeProps } from '../../src/frontend-kit';
const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: 'en' as 'en' | 'fa' }));
vi.mock('../../src/web/frontends/retro-astra/transplant/HorseDbAdapter', () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider', () => ({ usePreferences: () => ({ language: context.language, n: String, date: String, t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); context.language = 'en'; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
const field = (label: string) => { const element = [...container.querySelectorAll('label')].find(item => item.textContent === label)!; return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; };
const fill = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
function platform(directory: Record<string, unknown> = {}) { return { modules: { directory: { managedProfile: vi.fn(async () => { throw new PlatformClientError(403, 'directory_claim_required', 'Representation is required'); }), myClaims: vi.fn(async () => ({ claims: [] })), ...directory }, organizations: { managed: vi.fn(async () => { throw new PlatformClientError(403, 'membership_required', 'Current membership required'); }) } } } as unknown as PlatformClient; }
const receipt = (id: number, person_id = 7) => ({ claim: { id, claim_type: 'person', person_id, status: 'pending' }, note: 'Queued for review' });

describe('R113 native Retro editor and reviewer workflows', () => {
  it('shows real person/organization entry forms instead of null-target loaders and accepts Persian digits', async () => {
    const client = platform();
    await render(<RetroAstraProfileEditor personId={null} platform={client} scope="A" invalidTarget />);
    expect(container.textContent).toContain('record ID is invalid'); expect(container.textContent).not.toContain('Loading profile');
    expect(client.modules.directory.managedProfile).not.toHaveBeenCalled();
    fill(field('Person ID'), '۷'); await act(async () => { button('Open record').click(); }); expect(location.hash).toBe('#/directory-profile/7');
    fill(field('Person ID'), '0'); expect(button('Open record').disabled).toBe(true);
    await render(<RetroAstraOrganizationEditor organizationId={null} platform={client} scope="A" />);
    expect(field('Organization ID')).toBeTruthy(); expect(client.modules.organizations.managed).not.toHaveBeenCalled();
  });
  it('keeps a claim reachable after denied management, submits its real target once and clears only on acceptance', async () => {
    const write = deferred<unknown>(), submitClaim = vi.fn(() => write.promise); const client = platform({ submitClaim });
    await render(<RetroAstraProfileEditor personId={7} platform={client} scope="A" />);
    expect(container.textContent).toContain('cannot manage'); fill(field('Evidence for this request'), 'I represent this person under the attached mandate.');
    act(() => { button('Submit representation request').click(); container.querySelector('.retro-claim-panel form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(submitClaim).toHaveBeenCalledTimes(1); expect(submitClaim).toHaveBeenCalledWith({ claim_type: 'person', person_id: 7, evidence_note: 'I represent this person under the attached mandate.' });
    expect(field('Evidence for this request').value).not.toBe('');
    await act(async () => { write.resolve(receipt(19)); }); expect(field('Evidence for this request').value).toBe(''); expect(container.textContent).toContain('#19');
  });
  it('keeps unknown claims locked through pending and failed rereads, then requires explicit acknowledgement', async () => {
    const read = deferred<unknown>(); const myClaims = vi.fn().mockResolvedValueOnce({ claims: [] }).mockImplementationOnce(() => read.promise).mockRejectedValueOnce(new Error('Still unavailable')).mockResolvedValue({ claims: [receipt(21).claim] });
    const submitClaim = vi.fn(async () => { throw new Error('Lost response'); }); const client = platform({ myClaims, submitClaim });
    await render(<RetroAstraProfileEditor personId={7} platform={client} scope="A" />); fill(field('Evidence for this request'), 'Preserve the evidence through uncertainty.');
    await act(async () => { button('Submit representation request').click(); }); expect(container.textContent).toContain('result is unknown');
    await act(async () => { button('Read latest requests').click(); }); expect(button('Submit representation request').disabled).toBe(true); expect(button('I have checked the latest requests')).toBeUndefined();
    await act(async () => { read.reject(new Error('Reread unavailable')); }); expect(button('I have checked the latest requests')).toBeUndefined();
    await act(async () => { button('Read latest requests').click(); }); expect(button('Submit representation request').disabled).toBe(true); expect(button('I have checked the latest requests')).toBeUndefined();
    await act(async () => { button('Read latest requests').click(); }); expect(container.textContent).toContain('#21'); expect(button('Submit representation request').disabled).toBe(true);
    await act(async () => { button('I have checked the latest requests').click(); }); expect(button('Submit representation request').disabled).toBe(false); expect(field('Evidence for this request').value).toBe('Preserve the evidence through uncertainty.'); expect(submitClaim).toHaveBeenCalledTimes(1);
  });
  it('masks evidence and late receipt after a target or A → B → A principal change', async () => {
    const write = deferred<unknown>(); const client = platform({ submitClaim: () => write.promise });
    await render(<RetroAstraProfileEditor personId={7} platform={client} scope="A" />); fill(field('Evidence for this request'), 'Old A private evidence.'); act(() => button('Submit representation request').click());
    await render(<RetroAstraProfileEditor personId={8} platform={client} scope="B" />); expect(field('Evidence for this request').value).toBe('');
    await render(<RetroAstraProfileEditor personId={7} platform={client} scope="A" />); fill(field('Evidence for this request'), 'New A evidence.');
    await act(async () => { write.resolve(receipt(123)); }); expect(container.textContent).not.toContain('#123'); expect(field('Evidence for this request').value).toBe('New A evidence.');
  });
  it('submits an organization representation request with the organization target and retains a rejected draft', async () => {
    context.language = 'fa'; const submitClaim = vi.fn(async () => { throw new PlatformClientError(422, 'invalid', 'More evidence needed'); }); const client = platform({ submitClaim });
    await render(<RetroAstraOrganizationEditor organizationId={12} platform={client} scope="A" />); fill(field('مدرک پشتیبان درخواست'), 'مدارک مربوط به نمایندگی این سازمان');
    await act(async () => { button('ثبت درخواست نمایندگی').click(); }); expect(submitClaim).toHaveBeenCalledWith({ claim_type: 'organization', organization_id: 12, evidence_note: 'مدارک مربوط به نمایندگی این سازمان' }); expect(field('مدرک پشتیبان درخواست').value).toContain('سازمان'); expect(container.textContent).toContain('پذیرفته نشد');
  });
  it('shows actual evidence/proposed values and submits the entered reviewer reason exactly once', async () => {
    const write = deferred<unknown>(); const reviewClaim = vi.fn(() => write.promise);
    const claims = [{ id: 'claim-1', horse_id: 17, person_id: 7, status: 'pending', claimant: 'Demo owner', evidence: { note: 'Signed mandate supplied by owner.' }, created_at: '2026-10-17' }];
    const changes = [{ id: 'change-1', horse_id: 17, status: 'pending', request_type: 'update_horse', summary: 'Birth date correction', evidence: { source: 'Historic register' }, items: [{ field_name: 'birth_year', old_value: 2019, proposed_value: 2020 }] }];
    context.runtime = { user: { id: 'admin' }, permissions: ['claim.review', 'change.review'], platformMeta: { featureCatalog: { authentication: { available: false } } }, platform: { admin: { claims: async () => ({ claims }), changeRequests: async () => ({ requests: changes }), reviewClaim } } } as unknown as FrontendRuntimeProps;
    await render(<GovernanceDesk />); expect(container.textContent).toContain('Signed mandate supplied'); expect(container.textContent).toContain('2019'); expect(container.textContent).toContain('2020');
    const card = container.querySelector<HTMLDetailsElement>('.retro-review-request')!; card.open = true;
    fill(field('Review decision'), 'rejected'); fill(field('Reason for this decision'), 'The mandate lacks the owner signature.');
    act(() => { button('Save review').click(); card.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(reviewClaim).toHaveBeenCalledTimes(1); expect(reviewClaim).toHaveBeenCalledWith('claim-1', 'rejected', 'The mandate lacks the owner signature.');
    await act(async () => { write.reject(new PlatformClientError(422, 'invalid_review', 'Review rejected')); }); expect(field('Reason for this decision').value).toBe('The mandate lacks the owner signature.');
  });
});
