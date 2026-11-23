// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassicRegistryFrontend from '../../src/web/frontends/classic-registry/entry';
import { PlatformClientError, type FrontendRuntimeProps, type PlatformClient } from '../../src/frontend-kit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const fill = (value: string) => act(() => {
  const input = container.querySelector('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
function makePlatform() {
  return { modules: { directory: {
    managedProfile: vi.fn(async () => { throw new PlatformClientError(403, 'representation_required', 'Current representation required'); }),
    myClaims: vi.fn(async () => ({ claims: [] })),
  }, organizations: {
    managed: vi.fn(async () => { throw new PlatformClientError(403, 'membership_required', 'Current membership required'); }),
  } } } as unknown as PlatformClient;
}
function runtime(platform: PlatformClient, route: string, locale: 'en' | 'fa' = 'en', navigate: FrontendRuntimeProps['navigate'] = vi.fn()): FrontendRuntimeProps {
  return { route, locale, navigate, platform, user: null, permissions: [], setLocale: vi.fn(), health: null, platformMeta: null, assets: {} as FrontendRuntimeProps['assets'] };
}

describe('R113 Classic host editor entry screens', () => {
  it.each([
    { path: 'directory-profile', label: 'Person ID', target: '7', kind: 'person', denied: 'Cannot manage this profile.' },
    { path: 'organization-profile', label: 'Organization ID', target: '11', kind: 'organization', denied: 'Cannot manage this organization.' },
  ])('opens a real $kind ID without mounting a null-target loader', async ({ path, label, target, kind, denied }) => {
    const platform = makePlatform(), navigations = vi.fn();
    function Harness() {
      const [route, setRoute] = useState(`/f/classic-registry/${path}`);
      return <ClassicRegistryFrontend {...runtime(platform, route, 'en', next => { navigations(next); setRoute(next); })} />;
    }
    await render(<Harness />);
    const input = container.querySelector('input')!;
    expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(label);
    expect(container.querySelector('button[type="submit"]')?.getAttribute('disabled')).not.toBeNull();
    expect(container.textContent).not.toContain('Loading');
    expect(container.querySelector('iframe')).toBeNull();
    expect(platform.modules.directory.managedProfile).not.toHaveBeenCalled();
    expect(platform.modules.organizations.managed).not.toHaveBeenCalled();
    expect(platform.modules.directory.myClaims).not.toHaveBeenCalled();
    fill(target); await submit();
    expect(navigations).toHaveBeenCalledExactlyOnceWith(`/f/classic-registry/${path}/${target}`);
    const read = kind === 'person' ? platform.modules.directory.managedProfile : platform.modules.organizations.managed;
    expect(read).toHaveBeenCalled(); expect(vi.mocked(read).mock.calls[0]![0]).toBe(Number(target));
    expect(container.textContent).toContain(denied);
    expect(container.textContent).not.toContain('Loading');
  });

  it('rejects invalid form values even on direct submit and retains a valid Persian draft during locale changes', async () => {
    const platform = makePlatform(), navigate = vi.fn();
    const props = runtime(platform, '/f/classic-registry/directory-profile', 'en', navigate);
    await render(<ClassicRegistryFrontend {...props} />);
    for (const value of ['', '0', '-1', '1.5', '1e3', '42/edit', '9007199254740992']) {
      fill(value); await submit(); expect(navigate).not.toHaveBeenCalled();
      expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    }
    fill('۷'); await render(<ClassicRegistryFrontend {...props} locale="fa" />);
    expect(container.querySelector('label')?.textContent).toBe('شناسه شخص');
    expect(container.querySelector('input')!.value).toBe('۷');
    await submit(); expect(navigate).toHaveBeenCalledExactlyOnceWith('/f/classic-registry/directory-profile/7');
    expect(platform.modules.directory.managedProfile).not.toHaveBeenCalled();
  });

  it('rejects malformed direct editor links before editor reads or donor mounting', async () => {
    const platform = makePlatform();
    for (const route of ['/directory-profile/0', '/directory-profile/9007199254740992', '/directory-profile/abc', '/organization-profile/3/edit', '/organization-profile/-1']) {
      await render(<ClassicRegistryFrontend {...runtime(platform, `/f/classic-registry${route}`, 'fa')} />);
      expect(container.textContent).toContain('نشانی نامعتبر');
      expect(container.querySelector('iframe')).toBeNull();
      expect(container.querySelector('form')).toBeNull();
    }
    expect(platform.modules.directory.managedProfile).not.toHaveBeenCalled();
    expect(platform.modules.organizations.managed).not.toHaveBeenCalled();
  });
});
