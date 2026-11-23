// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrimaryNavigation as EliteNavigation } from '../../src/web/frontends/equidata-elite/Navigation';
import { PrimaryNavigation as FeiNavigation } from '../../src/web/frontends/fei-classic/Navigation';
import { EquiDataProfileEditor } from '../../src/web/frontends/equidata-elite/ProfileEditor';
import { FeiClassicProfileEditor } from '../../src/web/frontends/fei-classic/ProfileEditor';
import { EquiDataOrganizationEditor } from '../../src/web/frontends/equidata-elite/OrganizationEditor';
import { FeiClassicOrganizationEditor } from '../../src/web/frontends/fei-classic/OrganizationEditor';
import { PlatformClientError, navigationGroups, type PlatformClient, type PlatformUser } from '../../src/frontend-kit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); localStorage.clear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const mount = async (node: React.ReactElement) => { await act(async () => { root.render(node); }); };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const button = (text: RegExp) => Array.from(container.querySelectorAll('button')).find(node => text.test(node.textContent ?? ''))!;
function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
const USER: PlatformUser = { id:'r112-editor-user',email:'editor@example.test',display_name:'Editor',role:'user' };
function profilePlatform(outcome: 'success' | 'unknown' = 'success') {
  const submitClaim = vi.fn(async (input: Record<string, unknown>) => { if (outcome === 'unknown') throw new Error('Connection interrupted'); return { claim: { id:81,status:'pending',...input },note:'Recorded for review' }; });
  const platform = { modules: { directory: {
    managedProfile: vi.fn(async () => { throw new PlatformClientError(403, 'forbidden', 'Representation is required'); }),
    myClaims: vi.fn(async () => ({ claims:[] })), submitClaim,
  } } } as unknown as PlatformClient;
  return { platform, submitClaim };
}
for (const [skin, Navigation, Profile, Organization] of [
  ['equidata-elite', EliteNavigation, EquiDataProfileEditor, EquiDataOrganizationEditor],
  ['fei-classic', FeiNavigation, FeiClassicProfileEditor, FeiClassicOrganizationEditor],
] as const) describe(`${skin}: R112 navigation and native editors`, () => {
  // R116: the Elite row is adaptive (headless mounts render every canonical
  // destination as a measured tab; the toggle relabels to "More"); the FEI
  // PrimaryNavigation now uses the same adaptive canonical inventory in R117.
  const ADAPTIVE = true;
  it('keeps its primary row contract, exposes the complete canonical catalog, restores focus on Escape, and preserves modified clicks', async () => {
    const navigate = vi.fn();
    await mount(<Navigation locale="en" route={`/f/${skin}/market`} navigate={navigate}/>);
    const primary = container.querySelector('nav')!;
    const expectedLinks = navigationGroups(skin, `/f/${skin}/market`, 'en').flatMap(group => group.links);
    if (ADAPTIVE) expect(primary.querySelectorAll('a')).toHaveLength(expectedLinks.length);
    else expect(primary.querySelectorAll('a')).toHaveLength(3);
    const toggle = button(ADAPTIVE ? /^More/ : /^Sections/);
    act(() => toggle.click());
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    const panel = container.querySelector('[class$="sections-panel"]')!;
    expect(panel.querySelectorAll('a')).toHaveLength(expectedLinks.length);
    const market = panel.querySelector<HTMLAnchorElement>('a[aria-current="page"]')!;
    expect(market.getAttribute('href')).toBe(`/f/${skin}/market`);
    const modified = new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});
    act(() => market.dispatchEvent(modified));
    expect(modified.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    act(() => search.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(container.querySelector('[class$="sections-panel"]')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
  it('supports Persian section search, navigation dismissal, and outside-click dismissal', async () => {
    const navigate = vi.fn();
    await mount(<Navigation locale="fa" route="/" navigate={navigate}/>);
    act(() => button(ADAPTIVE ? /^بیشتر/ : /^بخش‌ها/).click());
    change(container.querySelector('input')!, 'بازار');
    const panel = container.querySelector('[class$="sections-panel"]')!;
    expect(panel.textContent).toContain('بازار اسب');
    const link = panel.querySelector<HTMLAnchorElement>(`a[href="/f/${skin}/market"]`)!;
    act(() => link.click());
    expect(navigate).toHaveBeenCalledWith(`/f/${skin}/market`);
    expect(container.querySelector('[class$="sections-panel"]')).toBeNull();
    act(() => button(ADAPTIVE ? /^بیشتر/ : /^بخش‌ها/).click());
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));
    expect(container.querySelector('[class$="sections-panel"]')).toBeNull();
  });
  it('keeps claims usable on denied profiles and sends the real person ID and explicit evidence exactly once', async () => {
    const { platform, submitClaim } = profilePlatform();
    await mount(<Profile personId={41} platform={platform} user={USER} locale="en"/>);
    await settle();
    expect(container.textContent).toContain('cannot manage this profile yet');
    const evidence = container.querySelector('textarea')!;
    change(evidence,'I am the authorized representative, with supporting records.');
    const send = button(/^Submit representation request$/);
    expect(send.disabled).toBe(false);
    await act(async () => { send.click(); send.click(); });
    await settle();
    expect(submitClaim).toHaveBeenCalledTimes(1);
    expect(submitClaim.mock.calls[0]![0]).toEqual({ claim_type:'person',person_id:41,evidence_note:'I am the authorized representative, with supporting records.' });
    expect(container.textContent).toContain('Request recorded');
    expect(button(/^Submit representation request$/).disabled).toBe(true);
  });
  it('locks an unknown claim result, provides an explicit reread, and clears evidence when the principal changes', async () => {
    const { platform, submitClaim } = profilePlatform('unknown');
    await mount(<Profile personId={41} platform={platform} user={USER} locale="en"/>);
    await settle();
    change(container.querySelector('textarea')!,'Sensitive representation evidence for this account.');
    await act(async () => button(/^Submit representation request$/).click());
    await settle();
    expect(container.textContent).toContain('The result is not yet known');
    expect(button(/^Submit representation request$/).disabled).toBe(true);
    expect(button(/^Read my claims again$/)).toBeTruthy();
    expect(button(/^Clear this attempt after checking$/).disabled).toBe(true);
    expect(submitClaim).toHaveBeenCalledTimes(1);
    await mount(<Profile personId={41} platform={platform} user={{...USER,id:'other-user'}} locale="en"/>);
    await settle();
    expect(container.querySelector('textarea')!.value).toBe('');
    expect(container.textContent).not.toContain('The result is not yet known');
  });
  it('provides real record selection without perpetual loading and renders Persian labels', async () => {
    const { platform } = profilePlatform();
    await mount(<Profile personId={null} platform={platform} user={USER} locale="fa"/>);
    expect(container.textContent).toContain('برای شروع یک شخص انتخاب کنید');
    expect(container.textContent).not.toContain('بارگذاری نمایه');
    change(container.querySelector('input')!,'۴۱');
    await act(async () => button(/^باز کردن سابقه$/).click());
    await settle();
    expect(platform.modules.directory.managedProfile).toHaveBeenCalledWith(41);
    expect(container.textContent).toContain('درخواست نمایندگی شخص');
  });
  it('accepts comma-separated organization specialties without erasing the separator while typing', async () => {
    const stored = {id:12,slug:'stable',kind:'stable',status:'active',name_latin:'Stable',name_native:null,row_version:4,description:'Stable description',service_categories:['boarding'],specialties:['endurance'],service_areas:['IR-08'],opening_hours:{},province_code:'IR-08',province_code_raw:'IR-08',province_code_scheme:'IR-3166-2:2024',province_needs_review:false,city:'Tehran',contact_preference:'platform_message',publication_consent:false,published_at:null};
    const upsertProfile = vi.fn(async (_id: number, _input: unknown) => ({profile:stored,publication:'unpublished'}));
    const platform = {modules:{organizations:{managed:vi.fn(async()=>({organization:stored,permissions:{edit:true,initial_publication:true,private_contact:false}})),upsertProfile}}} as unknown as PlatformClient;
    await mount(<Organization organizationId={12} platform={platform} user={USER} locale="en"/>);
    await settle();
    const field = Array.from(container.querySelectorAll('label')).find(label=>label.textContent?.startsWith('Specialties'))!;
    const input = field.querySelector('input')!;
    act(()=>input.focus());
    change(input,'endurance, ');
    expect(input.value).toBe('endurance, ');
    change(input,'endurance, jumping');
    await act(async()=>button(/^Save organization$/).click());
    await settle();
    expect(upsertProfile).toHaveBeenCalledTimes(1);
    expect(upsertProfile.mock.calls[0]![1]).toMatchObject({specialties:['endurance','jumping'],expected_version:4});
  });
});

describe('R112 native editor route catalog', () => {
  it('highlights the exact profile/organization editor on deep links and preserves FEI analysis aliases', () => {
    for (const skin of ['equidata-elite', 'fei-classic'] as const) {
      for (const [route,id] of [['directory-profile/990000003','profile-management'],['organization-profile/970004001','organization-management']] as const) {
        const active=navigationGroups(skin,`/f/${skin}/${route}`).flatMap(group=>group.links).filter(link=>link.active);
        expect(active.map(link=>link.id)).toEqual([id]);
      }
    }
    for (const [route,id] of [['analytics','analytics'],['timeline','rankings'],['places','rankings']] as const) {
      expect(navigationGroups('fei-classic',`/f/fei-classic/${route}`).flatMap(group=>group.links).filter(link=>link.active).map(link=>link.id)).toEqual([id]);
    }
  });
});
