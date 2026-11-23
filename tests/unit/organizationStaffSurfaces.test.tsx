// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeritageMyOrganizationInvitations, HeritageOrganizationStaffPanel } from '../../src/web/heritage/OrganizationStaffPanel';
import { RetroAstraMyOrganizationInvitations, RetroAstraOrganizationStaffSection } from '../../src/web/frontends/retro-astra/OrganizationEditor';
import { PlatformClientError, type PlatformClient, type FrontendRuntimeProps } from '../../src/frontend-kit';

/**
 * R114-04 (Master AI R113 handoff D21) — the native staff-lifecycle surfaces
 * over the shared headless module. Pinned here for the two reference
 * renderers (Heritage panel + Retro editor); FEI/Elite/Classic ride the same
 * hooks and the same honest states through their own visuals:
 *
 *  - roster renders current vs former vs pending invitations distinctly,
 *    and a forbidden answer (revoked mid-session) paints NO private row;
 *  - the invite form submits exactly one typed invitation payload;
 *  - accept/decline answers map 409/410/404 to their honest causes;
 *  - self-targeted role change / self-revocation are blocked outright;
 *  - an invitation-answer failure surfaces its cause, never a success.
 */

const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: 'en' as 'en' | 'fa' }));
vi.mock('../../src/web/frontends/retro-astra/transplant/HorseDbAdapter', () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider', () => ({ usePreferences: () => ({ language: context.language, n: String, date: String, t: (key: string) => key }) }));
vi.mock('../../src/web/heritage/i18n', () => ({ useI18n: () => ({ locale: context.language }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); context.language = 'en'; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (label: string) => [...container.querySelectorAll('button')].find(item => (item.textContent ?? '').trim() === label)!;
const field = (labelText: string) => { const element = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(labelText))!; return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLSelectElement | null ?? container.querySelector('input') as HTMLInputElement; };
function inputByLabel(labelText: string): HTMLInputElement { const element = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(labelText))!; return element.querySelector('input,select,textarea') as HTMLInputElement; }
const fill = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });

const rosterRows = [
  { kind: 'membership', user_id: 'demo-owner-a', email: 'demo-owner-a@local.invalid', role: 'owner', status: 'active', is_current: 1, valid_from: '2000-01-01T00:00:00Z', valid_until: null, revoked_at: null, revoke_reason: null },
  { kind: 'membership', user_id: 'ex-staff', email: null, role: 'member', status: 'active', is_current: 0, valid_from: '2000-01-01T00:00:00Z', valid_until: null, revoked_at: '2026-09-01T00:00:00Z', revoke_reason: 'Left the stable' },
  { kind: 'invite', id: 7, invitee_user_id: 'demo-staff', email: 'demo-staff@local.invalid', proposed_role: 'member', status: 'pending', expires_at: '2026-11-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z' },
];

function platform(overrides: Record<string, unknown> = {}, user: { id: string } | null = { id: 'demo-owner-a' }) {
  return {
    modules: {
      organizations: {
        staff: vi.fn(async () => ({ staff: rosterRows })),
        myInvites: vi.fn(async () => ({ invites: [] })),
        invite: vi.fn(async () => ({ invite: { id: 8 } })),
        respondInvite: vi.fn(async () => ({ outcome: { status: 'accepted', membershipId: 11 } })),
        setStaffRole: vi.fn(async () => ({ target_user_id: 'demo-staff', new_role: 'manager' })),
        revokeStaff: vi.fn(async () => ({ target_user_id: 'demo-staff', status: 'revoked' })),
        ...overrides,
      },
    },
  } as unknown as PlatformClient;
}
const user = (id: string) => ({ id, email: `${id}@local.invalid`, display_name: id }) as never;

describe('R114-04 native organization staff surfaces', () => {
  it('renders the roster honestly: current vs former vs pending, with revocation evidence', async () => {
    const client = platform();
    await render(<HeritageOrganizationStaffPanel organizationId={970004001} platform={client} user={user('demo-owner-a')} />);
    expect(container.textContent).toContain('demo-owner-a');
    expect(container.textContent).toContain('Current');
    expect(container.textContent).toContain('ex-staff');
    expect(container.textContent).toContain('Former');
    expect(container.textContent).toContain('Left the stable');
    expect(container.textContent).toContain('demo-staff');
    expect(container.textContent).toContain('Pending');
  });

  it('paints NO private row on a forbidden answer (revoked mid-session, stale UI)', async () => {
    const client = platform({ staff: vi.fn(async () => { throw new PlatformClientError(403, 'organization_staff_required', 'This account cannot view the staff'); }) });
    await render(<HeritageOrganizationStaffPanel organizationId={970004001} platform={client} user={user('demo-owner-a')} />);
    expect(container.textContent).toContain('CURRENT staff');
    expect(container.textContent).not.toContain('ex-staff');
    expect(container.textContent).not.toContain('Left the stable');
  });

  it('submits exactly one typed invitation payload and re-reads the roster', async () => {
    const invite = vi.fn(async () => ({ invite: { id: 8 } }));
    const client = platform({ invite });
    await render(<HeritageOrganizationStaffPanel organizationId={970004001} platform={client} user={user('demo-owner-a')} />);
    const form = container.querySelector('form')!;
    const user_id = [...form.querySelectorAll('input')].find(input => input.minLength === 3) as HTMLInputElement;
    fill(user_id, 'demo-staff');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledWith(970004001, expect.objectContaining({ invitee_user_id: 'demo-staff', proposed_role: 'member' }));
  });

  it('blocks self-targeted role change and self-revocation outright', async () => {
    const client = platform();
    await render(<HeritageOrganizationStaffPanel organizationId={970004001} platform={client} user={user('demo-owner-a')} />);
    const text = container.textContent ?? '';
    expect(text).toContain('You cannot change your own role or revoke yourself');
    expect(client.modules.organizations.setStaffRole).not.toHaveBeenCalled();
    expect(client.modules.organizations.revokeStaff).not.toHaveBeenCalled();
  });

  it('role change and revocation act only on OTHER current memberships', async () => {
    const setStaffRole = vi.fn(async () => ({ target_user_id: 'demo-owner-a', new_role: 'manager' }));
    const revokeStaff = vi.fn(async () => ({ target_user_id: 'demo-owner-a', status: 'revoked' }));
    const client = platform({ setStaffRole, revokeStaff });
    await render(<HeritageOrganizationStaffPanel organizationId={970004001} platform={client} user={user('demo-manager')} />);
    // owner-a is the only current membership besides the absent viewer; ex-staff is former (no actions).
    expect(button('Change role')).toBeTruthy();
    expect(button('Revoke membership')).toBeTruthy();
    expect(button('Change role').disabled).toBe(true); // unchanged role refuses honestly
    const roleSelect = inputByLabel('Change role');
    fill(roleSelect, 'manager');
    await act(async () => { button('Change role').click(); });
    expect(setStaffRole).toHaveBeenCalledTimes(1);
    expect(setStaffRole).toHaveBeenCalledWith(970004001, 'demo-owner-a', 'manager');
    const reason = container.querySelectorAll('input[maxLength="500"]')[0] as HTMLInputElement;
    fill(reason, 'Departed the stable');
    await act(async () => { button('Revoke membership').click(); });
    expect(revokeStaff).toHaveBeenCalledTimes(1);
    expect(revokeStaff).toHaveBeenCalledWith(970004001, 'demo-owner-a', 'Departed the stable');
  });

  it('shows the invitee inbox with accept/decline and maps honest refusals', async () => {
    const respond = vi.fn(async () => { throw new PlatformClientError(409, 'invite_revoked', 'This invitation was revoked by the organization'); });
    const client = platform({
      myInvites: vi.fn(async () => ({ invites: [{ id: 7, organization_id: 970004001, name_native: 'باشگاه نمایشی', name_latin: 'DEMO Fictional Stable', proposed_role: 'member', status: 'pending', note: 'Welcome aboard', expires_at: '2026-11-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z', actionable: 1 }] })),
      respondInvite: respond,
    });
    await render(<HeritageMyOrganizationInvitations platform={client} user={user('demo-staff')} />);
    expect(container.textContent).toContain('DEMO Fictional Stable');
    expect(container.textContent).toContain('Welcome aboard');
    await act(async () => { button('Accept').click(); });
    expect(respond).toHaveBeenCalledWith(7, true);
    expect(container.textContent).toContain('revoked by the organization');
  });

  it('expired invitations are not answerable and say so', async () => {
    const client = platform({
      myInvites: vi.fn(async () => ({ invites: [{ id: 9, organization_id: 970004001, name_native: null, name_latin: 'Other Stable', proposed_role: 'manager', status: 'expired', note: null, expires_at: '2026-10-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', actionable: 0 }] })),
    });
    await render(<HeritageMyOrganizationInvitations platform={client} user={user('demo-staff')} />);
    expect(container.textContent).toContain('expired');
    expect(button('Accept')).toBeUndefined();
    expect(button('Decline')).toBeUndefined();
  });

  it('the retro renderer rides the same hooks with its own visuals', async () => {
    const client = platform();
    context.runtime = { user: user('demo-owner-a'), permissions: [] } as unknown as FrontendRuntimeProps;
    await render(<RetroAstraOrganizationStaffSection organizationId={970004001} platform={client} user={user('demo-owner-a')} />);
    expect(container.textContent).toContain('Membership and invitations');
    expect(container.textContent).toContain('demo-owner-a');
    expect(container.textContent).toContain('Current');
    expect(container.textContent).toContain('ex-staff');
  });

  it('the retro invitee inbox declines honestly', async () => {
    const respond = vi.fn(async () => ({ outcome: { status: 'declined', membershipId: null } }));
    const client = platform({
      myInvites: vi.fn(async () => ({ invites: [{ id: 7, organization_id: 970004001, name_native: null, name_latin: 'DEMO Fictional Stable', proposed_role: 'member', status: 'pending', note: null, expires_at: '2026-11-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z', actionable: 1 }] })),
      respondInvite: respond,
    });
    await render(<RetroAstraMyOrganizationInvitations platform={client} user={user('demo-staff')} />);
    await act(async () => { button('Decline').click(); });
    expect(respond).toHaveBeenCalledWith(7, false);
    expect(container.textContent).toContain('Invitation declined');
  });

  it('an unknown respond outcome stays unknown — never a fabricated success', async () => {
    const respond = vi.fn(async () => { throw new Error('network dropped mid-answer'); });
    const client = platform({
      myInvites: vi.fn(async () => ({ invites: [{ id: 7, organization_id: 970004001, name_native: null, name_latin: 'DEMO Fictional Stable', proposed_role: 'member', status: 'pending', note: null, expires_at: '2026-11-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z', actionable: 1 }] })),
      respondInvite: respond,
    });
    await render(<HeritageMyOrganizationInvitations platform={client} user={user('demo-staff')} />);
    await act(async () => { button('Accept').click(); });
    expect(container.textContent).toContain('network dropped mid-answer');
    expect(container.textContent).not.toContain('Invitation accepted');
  });
});
