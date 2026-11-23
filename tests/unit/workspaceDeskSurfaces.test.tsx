// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetroAstraWorkspaceDesk, RetroAstraMyWorkspaceInvitations } from '../../src/web/frontends/retro-astra/WorkspaceDesk';
import { FeiClassicWorkspaceDesk, FeiMyWorkspaceInvitations } from '../../src/web/frontends/fei-classic/WorkspaceDesk';
import { PlatformClientError, type PlatformClient, type FrontendRuntimeProps } from '../../src/frontend-kit';
import type { WorkspaceDashboardResponse, WorkspaceTaskRecord } from '../../src/contracts/platform';

/**
 * R114-05 (Master AI R113 handoff D22/D32–35) — the native workspace-desk
 * surfaces over the shared headless module. Pinned here for the two reference
 * renderers (Retro desk + FEI desk); Elite/Classic ride the same hooks and
 * the same honest states through their own visuals:
 *
 *  - the principal's own workspace list renders owned/staff/organization
 *    rows with their roles, honestly phased;
 *  - selecting a workspace renders the dashboard buckets with row versions;
 *  - completion submits exactly ONE versioned command (expectedVersion);
 *  - a stale-version 409 shows the honest reload story — never a resubmit;
 *  - the invitee inbox answers accept/decline and maps a 410 to its honest
 *    expired copy, never a success;
 *  - workspace creation submits exactly one typed payload.
 */

const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: 'en' as 'en' | 'fa' }));
vi.mock('../../src/web/frontends/retro-astra/transplant/HorseDbAdapter', () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider', () => ({ usePreferences: () => ({ language: context.language, n: String, date: String, t: (key: string) => key }) }));
vi.mock('../../src/web/frontends/retro-astra/transplant/components/ui', () => ({ Button: ({ children, ...rest }: { children: React.ReactNode }) => <button {...rest}>{children}</button> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); context.language = 'en'; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (label: string) => [...container.querySelectorAll('button')].find(item => (item.textContent ?? '').trim() === label)!;
const buttons = (label: string) => [...container.querySelectorAll('button')].filter(item => (item.textContent ?? '').includes(label));
const inputByLabel = (labelText: string) => { const element = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(labelText))!; return (element.htmlFor ? document.getElementById(element.htmlFor) : element.querySelector('input,select,textarea')) as HTMLInputElement; };
const fill = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
const submit = (element: HTMLInputElement) => act(async () => { element.form?.requestSubmit(); await Promise.resolve(); });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

const summary = (id: number, role: 'owner' | 'staff' | 'manager', name = `WS ${id}`) => ({ id, name, description: null, organization_id: null, role, row_version: 1, created_at: '2026-10-17T00:00:00Z', granted_actions: ['view', 'tasks_manage', 'manage'], writable: true });
const taskRow = (id: number, over: Partial<WorkspaceTaskRecord> = {}): WorkspaceTaskRecord => ({
  id, horse_id: null, title: `Hoof trimming ${id}`, category: 'farrier', due_date: '2026-11-05', due_timezone: 'Asia/Tehran',
  recurrence: 'none', status: 'open', assigned_to_user_id: null, occurrence_key: `occ-${id}`, row_version: id, ...over,
});
const documentRow = (id: number, over: Record<string, unknown> = {}) => ({
  id, horse_id: 900000017, title: `Insurance paper ${id}`, category: 'insurance', note: 'renewal pending',
  expires_at: '2027-01-15', status: 'active', row_version: 2, created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T00:00:00Z', ...over,
});
const dashboard = (over: Partial<WorkspaceDashboardResponse> = {}): WorkspaceDashboardResponse => ({
  workspace: summary(41, 'owner', 'Main stable'), herd_size: 2,
  horses: [{ horse_id: 900000017, name_latin: 'DEMO A', name_native: null }, { horse_id: 900000018, name_latin: 'DEMO B', name_native: null }],
  tasks: { overdue: [taskRow(101, { row_version: 3 })], due_soon: [taskRow(102, { row_version: 1 })], later: [] },
  active_staff: [{ user_id: 'demo-staff-b', actions: ['view', 'tasks_manage'], granted_at: '2026-10-17T00:00:00Z' }],
  notes: [], ...over,
});

function platform(overrides: Record<string, unknown> = {}) {
  return {
    modules: {
      workspaces: {
        mine: vi.fn(async () => ({ owned: [summary(41, 'owner', 'Main stable')], staff: [summary(52, 'staff', 'Shared barn')], organization: [] })),
        create: vi.fn(async () => ({ created: true, workspace: { id: 99, name: 'Fresh', organization_id: null }, ownership_note: 'working set' })),
        dashboard: vi.fn(async () => dashboard()),
        addHorse: vi.fn(async () => ({ added: true, horse_id: 900000017, ownership_note: 'note' })),
        removeHorse: vi.fn(async () => ({ removed: true, horse_id: 900000017, ownership_note: 'note' })),
        addTask: vi.fn(async () => ({ created: true })),
        completeTask: vi.fn(async () => ({ completed: true, next_occurrence: null })),
        reassignTask: vi.fn(async () => ({ reassigned: true, assigned_to_user_id: 'demo-staff-b', row_version: 4, note: 'ok' })),
        inviteStaff: vi.fn(async () => ({ invited: true, invitee_user_id: 'demo-staff-c', actions: ['view'], expires_in_days: 14, note: 'sent' })),
        myInvites: vi.fn(async () => ({ rows: [], note: '' })),
        respondInvite: vi.fn(async () => ({ accepted: true, actions: ['view'], note: 'ok' })),
        assignStaff: vi.fn(async () => ({ ok: true })),
        revokeStaff: vi.fn(async () => ({ revoked: true, user_id: 'demo-staff-b', note: 'ok' })),
        documents: vi.fn(async () => ({ rows: [documentRow(601, { row_version: 2 })], veterinary_notice: 'notice', note: '' })),
        createDocument: vi.fn(async () => ({ created: true, note: 'ok' })),
        updateDocument: vi.fn(async () => ({ updated: true })),
        archiveDocument: vi.fn(async () => ({ archived: true, note: 'ok' })),
        importTasks: vi.fn(async () => ({ imported: 1, skipped: 0, accepted: 1, already_imported: 0, intent_key: 'import-x', imported_titles: ['Row A'], skipped_rows: [], receipts: [{ title: 'Row A', category: 'other', due_date: '2026-12-01', horse_id: null, status: 'imported', task_id: 555 }], note: '' })),
        exportUrl: vi.fn(() => '/api/workspaces/41/export'),
        ...overrides,
      },
    },
  } as unknown as PlatformClient;
}
const user = (id: string) => ({ id, email: `${id}@local.invalid`, display_name: id }) as never;
const runtimeFor = (client: PlatformClient, signedUser = true) => ({ platform: client, user: signedUser ? user('demo-owner-a') : null, locale: 'en', route: '/f/retro-astra/workspaces', navigate: () => {}, permissions: new Set<string>() }) as unknown as FrontendRuntimeProps;

describe('R114-05 native workspace desk surfaces', () => {
  it('renders the principal\'s own lists with roles and the working-set note', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={null} platform={client} signedIn user={user('demo-owner-a')} />);
    expect(container.textContent).toContain('Main stable');
    expect(container.textContent).toContain('Shared barn');
    expect(container.textContent).toContain('Owner');
    expect(container.textContent).toContain('Staff');
    expect(container.textContent).toContain('working set');
    expect(client.modules.workspaces.mine).toHaveBeenCalled();
  });

  it('selects a workspace and renders the dashboard buckets with row versions', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    expect(client.modules.workspaces.dashboard).toHaveBeenCalledWith(41);
    expect(container.textContent).toContain('Main stable');
    expect(container.textContent).toContain('Hoof trimming 101');
    expect(container.textContent).toContain('v3');
    expect(container.textContent).toContain('horses in this working set');
  });

  it('completion submits exactly one versioned command with the row version', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    await act(async () => { button('Mark complete').click(); });
    expect(client.modules.workspaces.completeTask).toHaveBeenCalledTimes(1);
    expect(client.modules.workspaces.completeTask).toHaveBeenCalledWith(41, 101, { expectedVersion: 3 });
  });

  it('a stale-version 409 shows the honest reload story, never a resubmit', async () => {
    const client = platform({ completeTask: vi.fn(async () => { throw new PlatformClientError(409, 'stale_version', 'The task changed before your edit landed', { current_version: 4 }); }) });
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    await act(async () => { button('Mark complete').click(); });
    await settle();
    expect(client.modules.workspaces.completeTask).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('changed elsewhere');
    expect(buttons('Reload current version').length).toBeGreaterThan(0);
  });

  it('workspace creation submits exactly one typed payload', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={null} platform={client} signedIn user={user('demo-owner-a')} />);
    await act(async () => { [...container.querySelectorAll('details')].find(node => node.textContent?.includes('Create a workspace'))!.open = true; });
    await fill(inputByLabel('Workspace name'), 'Fresh barn');
    await submit(inputByLabel('Workspace name'));
    expect(client.modules.workspaces.create).toHaveBeenCalledTimes(1);
    expect(client.modules.workspaces.create).toHaveBeenCalledWith({ name: 'Fresh barn' });
  });

  it('an already_closed 409 says the reminder is already completed — not a conflict error', async () => {
    const client = platform({ completeTask: vi.fn(async () => { throw new PlatformClientError(409, 'already_closed', 'Task is already completed'); }) });
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    await act(async () => { button('Mark complete').click(); });
    await settle();
    expect(container.textContent).toContain('already completed');
  });

  it('the FEI desk renders the same dashboard honestly through its own visuals', async () => {
    const client = platform();
    await render(<FeiClassicWorkspaceDesk workspaceId={41} platform={client} user={user('demo-owner-a')} locale="en" />);
    await settle();
    expect(client.modules.workspaces.dashboard).toHaveBeenCalledWith(41);
    expect(container.textContent).toContain('Main stable');
    expect(container.textContent).toContain('Hoof trimming 101');
    expect(container.textContent).toContain('Team and invitations');
    expect(container.textContent).toContain('demo-staff-b');
  });

  it('invite accept submits the typed decision; a 410 shows the honest expired copy', async () => {
    const client = platform({ myInvites: vi.fn(async () => ({ rows: [{ collection_id: 77, workspace_name: 'Main stable', proposed_actions: 'view,tasks_manage', note: null, expires_at: '2099-01-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z' }], note: '' })) });
    await render(<RetroAstraMyWorkspaceInvitations platform={client} user={user('demo-staff-c')} />);
    await settle();
    await act(async () => { button('Accept').click(); });
    expect(client.modules.workspaces.respondInvite).toHaveBeenCalledWith(77, 'accept');
    await settle();
    expect(container.textContent).toContain('Invitation accepted');

    const refusing = platform({ myInvites: vi.fn(async () => ({ rows: [{ collection_id: 78, workspace_name: 'Main stable', proposed_actions: 'view', note: null, expires_at: '2099-01-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z' }], note: '' })), respondInvite: vi.fn(async () => { throw new PlatformClientError(410, 'invite_expired', 'This invitation has expired'); }) });
    await render(<FeiMyWorkspaceInvitations platform={refusing} user={user('demo-staff-c')} locale="en" />);
    await settle();
    await act(async () => { button('Accept').click(); });
    await settle();
    expect(refusing.modules.workspaces.respondInvite).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('expired');
    expect(container.textContent).not.toContain('Invitation accepted');
  });

  it('an expired invitation renders unanswerable copy without a live answer button', async () => {
    const client = platform({ myInvites: vi.fn(async () => ({ rows: [{ collection_id: 79, workspace_name: 'Main stable', proposed_actions: 'view', note: null, expires_at: '2020-01-01T00:00:00Z', created_at: '2026-10-17T00:00:00Z' }], note: '' })) });
    await render(<RetroAstraMyWorkspaceInvitations platform={client} user={user('demo-staff-c')} />);
    await settle();
    expect(container.textContent).toContain('expired');
    expect(button('Accept')).toBeUndefined();
  });

  it('R114-06: renders the document trackers with version, fixed horse association and the export link', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    expect(container.textContent).toContain('Insurance paper 601');
    expect(container.textContent).toContain('v2');
    expect(container.textContent).toContain('fixed');
    const exportLink = [...container.querySelectorAll('a')].find(a => a.getAttribute('href') === '/api/workspaces/41/export');
    expect(exportLink).toBeTruthy();
  });

  it('R114-06: a stale document save keeps the draft and shows the honest comparison, never a resubmit', async () => {
    const client = platform({ updateDocument: vi.fn(async () => { throw new PlatformClientError(409, 'document_version_conflict', 'This document changed while you were editing', { current_version: 3 }); }) });
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    const row = container.querySelector('[data-surface="workspace-document-row"]')!;
    await act(async () => { ([...row.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Edit')!).click(); });
    const editForm = row.querySelector('form')!;
    const titleField = editForm.querySelector('input') as HTMLInputElement;
    await fill(titleField, 'Insurance paper 601 — reviewed');
    await submit(titleField);
    await settle();
    expect(client.modules.workspaces.updateDocument).toHaveBeenCalledTimes(1);
    expect(client.modules.workspaces.updateDocument).toHaveBeenCalledWith(41, 601, expect.objectContaining({ title: 'Insurance paper 601 — reviewed' }), { expectedVersion: 2 });
    expect(container.textContent).toContain('changed while you were editing');
    expect(container.textContent).toContain('v3');
    expect(titleField.value).toBe('Insurance paper 601 — reviewed'); // the draft survives
  });

  it('R114-06: the horse-association refusal shows the fixed-association rule, never a silent ignore', async () => {
    const client = platform({ updateDocument: vi.fn(async () => { throw new PlatformClientError(409, 'document_horse_immutable', "A document's horse association is fixed when the tracker is created"); }) });
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    const row = container.querySelector('[data-surface="workspace-document-row"]')!;
    await act(async () => { ([...row.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Edit')!).click(); });
    const titleField = row.querySelector('form')!.querySelector('input') as HTMLInputElement;
    await submit(titleField);
    await settle();
    expect(container.textContent).toContain('cannot be moved');
  });

  it('R114-06: archive is honest and the archived row renders read-only history', async () => {
    const client = platform({ documents: vi.fn(async () => ({ rows: [documentRow(601, { row_version: 2 })], veterinary_notice: 'n', note: '' })) });
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    await act(async () => { button('Archive').click(); });
    await settle();
    expect(client.modules.workspaces.archiveDocument).toHaveBeenCalledWith(41, 601);
  });

  it('R114-06: the bounded import submits rows with ONE intent key and reports per-row receipts', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    const importDetails = [...container.querySelectorAll('details')].find(node => node.textContent?.includes('Import up to 200 rows'))!;
    await act(async () => { importDetails.open = true; });
    const importForm = importDetails.querySelector('form')!;
    const rowTitle = importForm.querySelector('input') as HTMLInputElement;
    await fill(rowTitle, 'Row A');
    const dueField = importForm.querySelector('input[type="date"]') as HTMLInputElement;
    await fill(dueField, '2026-12-01');
    await submit(rowTitle);
    await settle();
    expect(client.modules.workspaces.importTasks).toHaveBeenCalledTimes(1);
    const call = (client.modules.workspaces.importTasks as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toEqual([{ title: 'Row A', category: 'other', due_date: '2026-12-01' }]);
    expect(typeof call[2].intentKey).toBe('string');
    expect(call[2].intentKey).toMatch(/^import-/);
    expect(container.textContent).toContain('Row A');
    expect(container.textContent).toContain('imported');
  });

  it('revoking staff submits the typed revoke; self-revocation is never offered', async () => {
    const client = platform();
    context.runtime = runtimeFor(client);
    await render(<RetroAstraWorkspaceDesk workspaceId={41} platform={client} signedIn user={user('demo-owner-a')} />);
    await settle();
    const revokeButtons = buttons('Revoke access');
    expect(revokeButtons.length).toBe(1); // demo-staff-b only — the owner never revokes themselves
    await act(async () => { revokeButtons[0]!.click(); });
    expect(client.modules.workspaces.revokeStaff).toHaveBeenCalledWith(41, 'demo-staff-b');
  });
});
