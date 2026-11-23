// @vitest-environment happy-dom
/** Real React views with delayed transport doubles; separate from local-HTTP browser evidence. */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeopleDesk } from '../../src/web/frontends/retro-astra/transplant/pages/ReadDesks';
import { GovernanceDesk } from '../../src/web/frontends/retro-astra/transplant/pages/GovernanceDesk';
import type { FrontendRuntimeProps } from '../../src/frontend-kit';

const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: 'en' as 'en' | 'fa' }));
vi.mock('../../src/web/frontends/retro-astra/transplant/HorseDbAdapter', () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider', () => ({ usePreferences: () => ({ language: context.language, n: (value: number) => String(value), date: (value: string) => value, t: (key: string) => key, text: (value: string) => value }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); context.language = 'en'; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const person = (id: number, name: string) => ({ id, name_latin: name, owner_count: 1, breeder_count: 0, importer_count: 0, horse_count: 1 });
const makeRuntime = (id: string, platform: unknown, permissions: string[] = []) => ({ user: { id, display_name: id }, permissions, platform, platformMeta: { featureCatalog: { authentication: { available: false } } } }) as unknown as FrontendRuntimeProps;
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!;

describe('R111 Retro desk request ownership', () => {
  it('discards old A and B list responses after A → B → A', async () => {
    const requests: ReturnType<typeof deferred<{ people: ReturnType<typeof person>[] }>>[] = [];
    const platform = { people: { list: () => { const request = deferred<{ people: ReturnType<typeof person>[] }>(); requests.push(request); return request.promise; } } };
    context.runtime = makeRuntime('A', platform); await render(<PeopleDesk />);
    context.runtime = makeRuntime('B', platform); await render(<PeopleDesk />);
    context.runtime = makeRuntime('A', platform); await render(<PeopleDesk />);
    expect(requests).toHaveLength(3);
    await act(async () => { requests[2]!.resolve({ people: [person(3, 'Current A response')] }); });
    expect(container.textContent).toContain('Current A response');
    await act(async () => { requests[0]!.resolve({ people: [person(1, 'Old A response')] }); requests[1]!.resolve({ people: [person(2, 'Old B response')] }); });
    expect(container.textContent).toContain('Current A response');
    expect(container.textContent).not.toContain('Old A response');
    expect(container.textContent).not.toContain('Old B response');
  });

  it('shows a request error instead of claiming that a failed list is empty', async () => {
    const platform = { people: { list: async () => { throw new Error('Network unavailable'); } } };
    context.runtime = makeRuntime('A', platform); await render(<PeopleDesk />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(container.textContent).not.toContain('No people match');
    expect(button('Try again')).toBeDefined();
  });

  it('does not reopen a person after closing their still-loading profile', async () => {
    const detail = deferred<unknown>();
    const platform = { people: { list: async () => ({ people: [person(1, 'Person One')] }), get: () => detail.promise } };
    context.runtime = makeRuntime('A', platform); await render(<PeopleDesk />);
    await act(async () => { button('Open').click(); });
    await act(async () => { button('Close profile').click(); });
    await act(async () => { detail.resolve({ person: person(1, 'Late profile'), horses: [], truncated: false }); });
    expect(container.textContent).not.toContain('Late profile');
    expect(container.textContent).not.toContain('Close profile');
  });

  it('allows creation from a fresh desk and suppresses duplicate submits and stale success', async () => {
    const write = deferred<unknown>(); const create = vi.fn(() => write.promise);
    const platform = { admin: { horses: { create } } };
    context.runtime = makeRuntime('A', platform, ['horse.create']); await render(<GovernanceDesk />);
    const name = container.querySelector<HTMLInputElement>('input[dir="ltr"]')!;
    expect(name).not.toBeNull();
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'New synthetic horse'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(button('Create record').disabled).toBe(false);
    act(() => { button('Create record').click(); button('Create record').click(); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Saving');
    context.runtime = makeRuntime('B', platform, ['horse.create']); await render(<GovernanceDesk />);
    expect(container.querySelector<HTMLInputElement>('input[dir="ltr"]')!.value).toBe('');
    await act(async () => { write.resolve({ horse: { id: 100, name_latin: 'New synthetic horse', row_version: 1 } }); });
    expect(container.textContent).not.toContain('Horse record created');
    expect(container.querySelector<HTMLInputElement>('input[dir="ltr"]')!.value).toBe('');
  });
});
