// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileGovernance } from '../../src/web/frontends/retro-astra/transplant/pages/ProfileGovernance';
import { GovernanceDesk } from '../../src/web/frontends/retro-astra/transplant/pages/GovernanceDesk';
import { PlatformClientError, type FrontendRuntimeProps } from '../../src/frontend-kit';
const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: 'en' as 'en' | 'fa' }));
vi.mock('../../src/web/frontends/retro-astra/transplant/HorseDbAdapter', () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider', () => ({ usePreferences: () => ({ language: context.language, n: (value: number) => String(value), date: (value: string) => value, t: (key: string) => key, text: (value: string) => value }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); context.language = 'en'; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const makeRuntime = (id: string, platform: unknown, permissions = ['claim.create', 'claim.read_own', 'change.create', 'change.read_own']) => ({ user: { id, display_name: id }, permissions, platform, platformMeta: { featureCatalog: { authentication: { available: false } } } }) as unknown as FrontendRuntimeProps;
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
const draft = () => container.querySelector<HTMLTextAreaElement>('textarea')!;
function fill(value: string) { act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft(), value); draft().dispatchEvent(new Event('input', { bubbles: true })); }); }
const claim = (id: number, horse_id: number) => ({ id, horse_id, status: 'pending', created_at: '2026-10-17T12:00:00Z' });

describe('R112 Retro profile review requests', () => {
  it('submits actual evidence once and cannot publish old success after A → B → A', async () => {
    const write = deferred<unknown>(); const create = vi.fn(() => write.promise);
    const platform = { claims: { mine: async () => ({ claims: [] }), create }, changes: { mine: async () => ({ requests: [] }) } };
    context.runtime = makeRuntime('A', platform); await render(<ProfileGovernance horseId={17} />); fill('Certificate and owner consent dated today.');
    act(() => { button('Submit for review').click(); container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(create).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledWith(17, { note: 'Certificate and owner consent dated today.' });
    context.runtime = makeRuntime('B', platform); await render(<ProfileGovernance horseId={17} />); expect(draft().value).toBe('');
    context.runtime = makeRuntime('A', platform); await render(<ProfileGovernance horseId={17} />); fill('New A draft');
    await act(async () => { write.resolve({ claim: claim(1, 17) }); });
    expect(container.textContent).not.toContain('Your request was submitted'); expect(draft().value).toBe('New A draft');
  });
  it('preserves evidence after a rejected request and only clears on confirmed acceptance', async () => {
    const create = vi.fn().mockRejectedValueOnce(new PlatformClientError(422, 'VALIDATION', 'More evidence is needed')).mockResolvedValue({ claim: claim(3, 17) });
    const platform = { claims: { mine: async () => ({ claims: [] }), create }, changes: { mine: async () => ({ requests: [] }) } };
    context.runtime = makeRuntime('A', platform); await render(<ProfileGovernance horseId={17} />); fill('Keep this request evidence.');
    await act(async () => { button('Submit for review').click(); });
    expect(draft().value).toBe('Keep this request evidence.'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('not accepted');
    await act(async () => { button('Submit for review').click(); });
    expect(draft().value).toBe(''); expect(container.textContent).toContain('Your request was submitted');
  });
  it('does not show a failed request list as empty and filters requests by horse', async () => {
    const platform = { claims: { mine: async () => { throw new Error('Read unavailable'); } }, changes: { mine: async () => ({ requests: [{ id: 8, horse_id: 18, summary: 'Other horse private correction', status: 'pending', created_at: '2026-10-17T12:00:00Z' }] }) } };
    context.runtime = makeRuntime('A', platform); await render(<ProfileGovernance horseId={17} />);
    expect(container.textContent).toContain('could not be loaded'); expect(container.textContent).not.toContain('No requests for this horse'); expect(container.textContent).not.toContain('Other horse private correction');
  });
  it('locks unknown writes until a completed reread and explicit review of current requests', async () => {
    const reread = deferred<unknown>(); let reads = 0;
    const create = vi.fn(async () => { throw new Error('Connection lost after submit'); });
    const platform = { claims: { mine: () => ++reads === 1 ? Promise.resolve({ claims: [] }) : reread.promise, create }, changes: { mine: async () => ({ requests: [] }) } };
    context.runtime = makeRuntime('A', platform); await render(<ProfileGovernance horseId={17} />); fill('Keep this uncertain evidence.');
    await act(async () => { button('Submit for review').click(); }); expect(button('Submit for review').disabled).toBe(true);
    await act(async () => { button('Refresh records').click(); }); expect(button('Submit for review').disabled).toBe(true);
    await act(async () => { reread.resolve({ claims: [claim(44, 17)] }); });
    expect(container.textContent).toContain('#44'); expect(button('Submit for review').disabled).toBe(true);
    await act(async () => { button('I have checked the latest requests').click(); });
    expect(button('Submit for review').disabled).toBe(false); expect(draft().value).toBe('Keep this uncertain evidence.'); expect(create).toHaveBeenCalledTimes(1);
  });
  it('records correction text and clears a draft on a horse change', async () => {
    const create = vi.fn(async () => ({ request: { id: 1 } }));
    const platform = { claims: { mine: async () => ({ claims: [] }) }, changes: { mine: async () => ({ requests: [] }), create } };
    context.runtime = makeRuntime('A', platform, ['change.create', 'change.read_own']); await render(<ProfileGovernance horseId={17} />); fill('Correct the source birth date.');
    await act(async () => { button('Submit for review').click(); });
    expect(create).toHaveBeenCalledWith({ horse_id: 17, request_type: 'update_horse', summary: 'Correct the source birth date.' });
    fill('Only for horse17'); await render(<ProfileGovernance horseId={18} />); expect(draft().value).toBe('');
  });
  it('reports processed, remaining and failed maintenance counts without claiming a drained queue', async () => {
    vi.stubGlobal('confirm', () => true);
    const platform = { admin: { maintenance: { reindex: async () => ({ processed: 12, failed: 2, remaining: 37 }) } } };
    context.runtime = makeRuntime('admin', platform, ['maintenance.run']); await render(<GovernanceDesk />);
    await act(async () => { button('Rebuild search').click(); });
    expect([...container.querySelectorAll('.maintenance-counts dd')].map(item => item.textContent)).toEqual(['12', '37', '2']);
    expect(container.textContent).toContain('batch processed'); expect(container.textContent).not.toContain('maintenance completed');
  });
});
