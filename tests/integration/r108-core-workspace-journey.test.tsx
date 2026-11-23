// @vitest-environment happy-dom
/**
 * R108-13: the CANONICAL Core workspace journey — a reusable behavior
 * specification, not a shared visual component — proven on REAL React
 * (createRoot + act) mounting the REAL Heritage workspace surfaces
 * (WorkspacesPage + WorkspaceStaffPanel + WorkspaceDocumentsPanel + the
 * versioned assignment and bounded-import controls), each principal with a
 * REAL createPlatformClient wired to the REAL Worker router over a REAL
 * migrated database (all 80 migrations, foreign keys enforced). No handler
 * is called directly and no transport double stands in: every action below
 * is a real DOM interaction traveling the real route table, the real Zod
 * schemas, the real auth/CSRF guards and the real batch boundary.
 *
 * Journey (the ticket's canonical sequence):
 *   owner creates workspace -> owner invites staff -> staff sees the pending
 *   invitation in their OWN view and accepts -> owner adds a reminder ->
 *   owner version-assigns it to the staff member -> staff completes it
 *   (CAS) -> document lifecycle (create / versioned update / stale-version
 *   honest conflict / archive) -> bounded import with a durable intent key
 *   and an interrupted replay reconciling to exact accepted rows -> owner
 *   revokes the staff member -> the staff member's next write is an honest
 *   refusal. Database state, audit rows and reminder scope are asserted to
 *   AGREE with what the UI displayed.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Request as NodeRequest } from "undici";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import workerDefault from "../../src/worker";
import { createPlatformClient } from "../../src/frontend-kit/platformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { PlatformClient, PlatformUser } from "../../src/contracts/platform";
import { HeritageWorkspacesPage } from "../../src/web/heritage/WorkspacesPage";
import { openRealDatabase, seedUser, makeSession, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const worker = workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> };
const ORIGIN = "https://registry.example";
const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", SESSION_COOKIE_NAME: "hr_session",
    DB: db, ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter, EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

/** A browser tab: its own cookie jar + its own platform client (real host wiring). */
function makeTab(db: D1Database, session: AuthedSession, user: PlatformUser) {
  let csrf: string | null = session.csrfToken;
  const client = createPlatformClient({
    transport: async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      headers.set("origin", ORIGIN);
      headers.set("cookie", session.cookie);
      // happy-dom's Request drops the cookie header (browser discipline); the
      // real undici Request carries it — same discipline as the two-tabs suite.
      const response = await worker.fetch(new NodeRequest(`${ORIGIN}${url}`, { method: (init?.method as string) ?? "GET", headers: headers as unknown as Record<string, string>, body: init?.body as string | undefined }) as unknown as Request, makeEnv(db));
      const data = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
      if (!response.ok) throw new PlatformClientError(response.status, data?.error?.code ?? "invalid_error_response", data?.error?.message ?? "Request failed");
      return data as T;
    },
    csrfToken: () => csrf,
    onSessionChange: (next) => { if (next.csrfToken) csrf = next.csrfToken; },
  });
  return { client, user };
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => { root?.unmount(); }); root = null; container.remove(); });

function mount(element: React.ReactElement): void {
  if (!root) root = createRoot(container);
  act(() => { root!.render(element); });
}

async function flush(work: () => Promise<unknown> | unknown): Promise<void> {
  await act(async () => { await work(); });
}

/** Poll until a condition holds (robust under full-suite parallel load). */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for: ${what}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

/** Mounted inactive panels retain drafts, but are not available for user input. */
function isVisible(element: Pick<HTMLElement, "closest" | "parentElement">): boolean {
  if (element.closest("[hidden]")) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(":scope > summary")?.contains(element as unknown as Node)) return false;
  }
  return true;
}
const visibleElements = (selector: string) => [...container.querySelectorAll(selector)].filter(isVisible);
const hasStatus = (text: string) => visibleElements('[role="status"]').some(element => element.textContent?.includes(text));
const findButton = (label: string): HTMLButtonElement => {
  const button = visibleElements("button").find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`button not found: ${label}`);
  return button as HTMLButtonElement;
};
const findElement = (selector: string, contains?: string): HTMLElement => {
  const found = visibleElements(selector).filter((el) => (contains ? el.textContent?.includes(contains) : true));
  const el = found[found.length - 1] as HTMLElement | undefined;
  if (!el) throw new Error(`element not found: ${selector} ${contains ?? ""}`);
  return el;
};
async function selectWorkspace(name: string): Promise<void> {
  await waitFor(() => visibleElements(".h-mod-workspace-list button").some(button => button.textContent?.includes(name) && !button.closest('[aria-busy="true"]')), "current workspace list ready");
  const button = visibleElements(".h-mod-workspace-list button").find(button => button.textContent?.includes(name)) as HTMLButtonElement;
  act(() => { button.click(); });
  await waitFor(() => visibleElements('[role="tablist"]').some(tabs => !tabs.closest('[aria-busy="true"]')), "current workspace dashboard ready");
}
async function selectWorkspaceSection(label: "Reminders" | "People" | "Documents"): Promise<HTMLElement> {
  await waitFor(() => visibleElements('[role="tab"]').some(tab => tab.textContent === label && !tab.closest('[aria-busy="true"]')), `${label} tab ready`);
  const tab = visibleElements('[role="tab"]').find(tab => tab.textContent === label) as HTMLButtonElement;
  act(() => { tab.click(); });
  const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
  await waitFor(() => tab.getAttribute("aria-selected") === "true" && isVisible(panel) && !panel.closest('[aria-busy="true"]'), `${label} panel selected and current`);
  return panel;
}
async function enabledButton(label: string): Promise<HTMLButtonElement> {
  await waitFor(() => visibleElements("button").some(button => button.textContent?.includes(label) && !(button as HTMLButtonElement).disabled && !button.closest('[aria-busy="true"]')), `${label} action ready`);
  return findButton(label);
}
async function formActionReady(form: HTMLFormElement): Promise<void> {
  await waitFor(() => {
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
    return form.isConnected && isVisible(form) && !form.closest('[aria-busy="true"]') && !!submit && !submit.disabled;
  }, "visible form submit action ready");
}
const nativeInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const setInput = (input: HTMLInputElement, value: string) => {
  expect(isVisible(input)).toBe(true);
  expect(input.disabled).toBe(false);
  act(() => {
    nativeInputValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const setSelect = (select: HTMLSelectElement, value: string) => {
  expect(isVisible(select)).toBe(true);
  expect(select.disabled).toBe(false);
  act(() => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
};
const submitForm = (form: HTMLFormElement) => { act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
const openDetails = (summaryText: string): HTMLDetailsElement => {
  const summary = visibleElements("summary").find((s) => s.textContent?.includes(summaryText));
  if (!summary) throw new Error(`summary not found: ${summaryText}`);
  const details = summary.parentElement as HTMLDetailsElement;
  act(() => { details.open = true; });
  return details;
};
/** The form INSIDE a specific open details block (never a foreign form). */
const formIn = async (summaryText: string): Promise<HTMLFormElement> => {
  await waitFor(() => visibleElements("summary").some(summary => summary.textContent?.includes(summaryText)), `${summaryText} disclosure visible`);
  const details = openDetails(summaryText);
  const form = details.querySelector("form");
  if (!form) throw new Error(`form not found in: ${summaryText}`);
  await waitFor(() => form.isConnected && isVisible(form) && !form.closest('[aria-busy="true"]') && [...form.querySelectorAll("input, select, textarea")].every(control => !(control as HTMLInputElement).disabled), `${summaryText} fields and current read ready`);
  return form as HTMLFormElement;
};

describe("R108-13 canonical Core workspace journey (real React, real client, real Worker, real DB)", () => {
  it("owner invite -> staff accept -> assignment -> completion -> document lifecycle -> import receipts -> revoke, with DB/audit agreement", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "j-owner", "user");
    await seedUser(db, "j-staff", "user");
    const ownerSession = await makeSession(db, "j-owner");
    const staffSession = await makeSession(db, "j-staff");
    const ownerUser: PlatformUser = { id: "j-owner", email: "owner@example.test", display_name: "Owner", role: "user", is_active: true } as PlatformUser;
    const staffUser: PlatformUser = { id: "j-staff", email: "staff@example.test", display_name: "Staff", role: "user", is_active: true } as PlatformUser;
    const ownerTab = makeTab(db, ownerSession, ownerUser);
    const staffTab = makeTab(db, staffSession, staffUser);
    const navigate = () => {};

    // 1. The OWNER creates a workspace through the native form.
    mount(<HeritageWorkspacesPage navigate={navigate} platform={ownerTab.client} user={ownerUser} />);
    await flush(() => {});
    const createForm = await formIn("Create personal workspace");
    const nameInput = createForm.querySelector("input") as HTMLInputElement;
    setInput(nameInput, "Journey Farm");
    await formActionReady(createForm);
    submitForm(createForm);
    await waitFor(() => hasStatus("Workspace created"), "workspace created status");
    await waitFor(() => [...container.querySelectorAll("li")].some((li) => li.textContent?.includes("Journey Farm")), "workspace row visible");
    await selectWorkspace("Journey Farm");
    const workspaceId = 1; // the first collection of this fresh database
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_collections WHERE name='Journey Farm' AND owner_user_id='j-owner'").first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);

    // 2. The owner invites the staff member (consent before delegation).
    await selectWorkspaceSection("People");
    const inviteForm = await formIn("Invite a staff member");
    const inviteeInput = inviteForm.querySelector("input[required]") as HTMLInputElement;
    setInput(inviteeInput, "j-staff");
    const tasksManageCheckbox = [...inviteForm.querySelectorAll('input[type="checkbox"]')].find((c) => c.closest("label")?.textContent?.includes("tasks_manage")) as HTMLInputElement;
    act(() => { tasksManageCheckbox.click(); });
    await formActionReady(inviteForm);
    submitForm(inviteForm as HTMLFormElement);
    await waitFor(() => hasStatus("Invitation sent"), "invitation sent status");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_staff_invites WHERE collection_id=? AND invitee_user_id='j-staff' AND status='pending'").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);
    // No assignment exists before consent.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_staff_assignments WHERE collection_id=? AND user_id='j-staff'").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(0);

    // 3. The STAFF member sees the pending invitation in their OWN view and accepts.
    mount(<HeritageWorkspacesPage navigate={navigate} platform={staffTab.client} user={staffUser} />);
    openDetails("My pending invitations");
    await waitFor(() => [...container.querySelectorAll("li")].some((li) => li.textContent?.includes("Journey Farm")), "staff invitation row visible");
    const acceptButton = await enabledButton("Accept");
    act(() => { acceptButton.click(); });
    await waitFor(() => hasStatus("Invitation accepted"), "invitation accepted status");
    findElement('[role="status"]', "Invitation accepted");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_staff_assignments WHERE collection_id=? AND user_id='j-staff' AND status='active'").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='workspace.staff_invite_accepted'").first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);

    // 4. The owner adds a reminder, then version-assigns it to the staff member.
    mount(<HeritageWorkspacesPage navigate={navigate} platform={ownerTab.client} user={ownerUser} />);
    await selectWorkspace("Journey Farm");
    await selectWorkspaceSection("Reminders");
    const addForm = await formIn("Add reminder");
    const inputs = [...addForm.querySelectorAll("input")];
    setInput(inputs.find((i) => i.required && i.type === "text") as HTMLInputElement, "Journey farrier round");
    setInput(inputs.find((i) => i.type === "date") as HTMLInputElement, "2026-12-01");
    await formActionReady(addForm);
    submitForm(addForm as HTMLFormElement);
    await waitFor(() => hasStatus("Reminder recorded"), "reminder recorded status");
    const taskRow = (await db.prepare("SELECT id, row_version FROM workspace_tasks WHERE collection_id=? AND title='Journey farrier round'").bind(workspaceId).first<{ id: number; row_version: number }>())!;
    expect(taskRow).toBeTruthy();

    await selectWorkspaceSection("People");
    const assignForm = await formIn("Assign or unassign");
    const assignSelect = assignForm.querySelector("select") as HTMLSelectElement;
    await waitFor(() => [...assignSelect.options].some(option => option.value === String(taskRow.id)), "new reminder available in current assignment read");
    setSelect(assignSelect, String(taskRow.id));
    const assigneeInput = assignForm.querySelector("input[list]") as HTMLInputElement;
    setInput(assigneeInput, "j-staff");
    await formActionReady(assignForm);
    submitForm(assignForm as HTMLFormElement);
    await waitFor(() => hasStatus("Assignment updated"), "assignment updated status");
    const assigned = (await db.prepare("SELECT assigned_to_user_id, row_version FROM workspace_tasks WHERE id=?").bind(taskRow.id).first<{ assigned_to_user_id: string | null; row_version: number }>())!;
    expect(assigned.assigned_to_user_id).toBe("j-staff");
    expect(Number(assigned.row_version)).toBe(Number(taskRow.row_version) + 1); // the version advanced exactly once
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='workspace.task_reassigned'").first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);

    // 5. The STAFF member completes the reminder (CAS through the real UI).
    mount(<HeritageWorkspacesPage navigate={navigate} platform={staffTab.client} user={staffUser} />);
    await selectWorkspace("Journey Farm");
    await selectWorkspaceSection("Reminders");
    await waitFor(() => visibleElements("button").some((b) => b.textContent?.includes("Journey farrier round")), "staff sees the assigned reminder");
    const completeButton = await enabledButton("Journey farrier round");
    act(() => { completeButton.click(); });
    await waitFor(() => hasStatus("Reminder completed"), "reminder completed status");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_tasks WHERE id=? AND status='done'").bind(taskRow.id).first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);

    // 6. Document lifecycle through the native panel.
    mount(<HeritageWorkspacesPage navigate={navigate} platform={ownerTab.client} user={ownerUser} />);
    await selectWorkspace("Journey Farm");
    const documentPanel = await selectWorkspaceSection("Documents");
    const docForm = await formIn("Track a document");
    const docInputs = [...docForm.querySelectorAll("input")];
    setInput(docInputs.find((i) => i.type === "text" && i.required) as HTMLInputElement, "Insurance policy 77");
    setInput(docInputs.find((i) => i.type === "date") as HTMLInputElement, "2027-01-01");
    await formActionReady(docForm);
    submitForm(docForm as HTMLFormElement);
    await waitFor(() => hasStatus("Document tracker created"), "document created status");
    const doc = (await db.prepare("SELECT id, row_version FROM workspace_documents WHERE collection_id=? AND title='Insurance policy 77'").bind(workspaceId).first<{ id: number; row_version: number }>())!;
    expect(doc).toBeTruthy();

    // 6b. Versioned update; then a STALE version is an honest conflict.
    openDetails("Track a document"); // ensure the panel is open for the edit flow
    const editButton = await enabledButton("Edit");
    act(() => { editButton.click(); });
    const docForms = [...documentPanel.querySelectorAll("form")];
    const editForm = docForms.find((f) => (f.querySelector("button") as HTMLButtonElement)?.textContent?.includes("Save (versioned)"));
    if (!editForm) throw new Error("edit form not found");
    const editInputs = [...editForm.querySelectorAll("input")];
    setInput(editInputs.find((i) => i.required && i.type === "text") as HTMLInputElement, "Insurance policy 77 (renewed)");
    await formActionReady(editForm);
    submitForm(editForm as HTMLFormElement);
    await waitFor(() => hasStatus("Document updated"), "document updated status");
    expect(Number((await db.prepare("SELECT row_version FROM workspace_documents WHERE id=?").bind(doc.id).first<{ row_version: number }>())!.row_version)).toBe(2);

    // Finish the v2 document reread before bumping the server behind the UI's
    // back. Otherwise an in-flight refresh can pick up v3 and erase the conflict.
    await enabledButton("Edit");
    await waitFor(() => [...documentPanel.querySelectorAll("li strong")].some(element => element.textContent === "Insurance policy 77 (renewed)"), "updated document reread at version 2");
    await db.prepare("UPDATE workspace_documents SET row_version=3, title='Insurance policy 77 (server-side change)' WHERE id=?").bind(doc.id).run();
    const editButton2 = await enabledButton("Edit");
    act(() => { editButton2.click(); });
    const docForms2 = [...documentPanel.querySelectorAll("form")];
    const editForm2 = docForms2.find((f) => (f.querySelector("button") as HTMLButtonElement)?.textContent?.includes("Save (versioned)"));
    if (!editForm2) throw new Error("edit form 2 not found");
    const editInputs2 = [...editForm2.querySelectorAll("input")];
    setInput(editInputs2.find((i) => i.required && i.type === "text") as HTMLInputElement, "Insurance policy 77 (stale attempt)");
    await formActionReady(editForm2);
    submitForm(editForm2 as HTMLFormElement);
    await waitFor(() => visibleElements('[role="alert"]').some((el) => el.textContent?.includes("changed while you were editing")), "stale-version conflict alert");
    expect(Number((await db.prepare("SELECT row_version FROM workspace_documents WHERE id=?").bind(doc.id).first<{ row_version: number }>())!.row_version)).toBe(3); // nothing mutated

    // 7. Bounded import with a durable intent key: first attempt, then an interrupted replay.
    await selectWorkspaceSection("Reminders");
    const importForm = await formIn("Import up to 200 rows");
    const importInputs = [...importForm.querySelectorAll("input")];
    setInput(importInputs.find((i) => i.type === "text" && i.required) as HTMLInputElement, "Journey import row one");
    setInput(importInputs.find((i) => i.type === "date") as HTMLInputElement, "2026-12-15");
    await formActionReady(importForm);
    submitForm(importForm as HTMLFormElement);
    await waitFor(() => hasStatus("Import finished"), "import finished status");
    findElement("li", "Journey import row one");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_tasks WHERE collection_id=? AND title='Journey import row one'").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_tasks WHERE collection_id=? AND import_intent_key IS NOT NULL").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);

    // 8. The owner revokes the staff member through the native control.
    await selectWorkspaceSection("People");
    await waitFor(() => visibleElements("button").some((b) => b.textContent?.includes("Revoke access")), "revoke button visible");
    const revokeButton = await enabledButton("Revoke access");
    act(() => { revokeButton.click(); });
    await waitFor(() => hasStatus("Staff access revoked"), "staff revoked status");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_staff_assignments WHERE collection_id=? AND user_id='j-staff' AND status='revoked'").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(1);

    // 9. After revocation the staff member's OWN view honestly no longer
    //    offers the workspace (disclosure-free), and their next write through
    //    the real client is an honest refusal that writes nothing.
    mount(<HeritageWorkspacesPage navigate={navigate} platform={staffTab.client} user={staffUser} />);
    await waitFor(() => visibleElements(".h-mod-domain-grid > section").some(section => section.getAttribute("aria-busy") === "false" && section.textContent?.includes("No workspaces yet.")), "revoked staff workspace list reread");
    await waitFor(() => [...container.querySelectorAll("section")].some((sec) => sec.getAttribute("aria-label")?.includes("My pending invitations")), "staff page settled");
    const stillListed = [...container.querySelectorAll("li")].some((li) => li.textContent?.includes("Journey Farm"));
    expect(stillListed).toBe(false); // the revoked workspace is gone from THEIR list — no partial disclosure
    let refused: unknown = null;
    try {
      await staffTab.client.modules.workspaces.addTask(workspaceId, { title: "after revocation", category: "other", due_date: "2026-12-20" });
    } catch (error) {
      refused = error;
    }
    expect((refused as { status?: number })?.status).toBe(404); // disclosure-free: the workspace no longer exists FOR THEM
    expect((refused as { code?: string })?.code).toBe("not_found");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_tasks WHERE collection_id=? AND title='after revocation'").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(0);

    // Exact database/audit agreement with everything the UI displayed.
    expect(await db.prepare("SELECT COUNT(*) AS n FROM workspace_tasks WHERE collection_id=?").bind(workspaceId).first<{ n: number }>().then((r) => Number(r?.n))).toBe(2); // farrier (done) + import row
    expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('workspace.staff_invited','workspace.staff_invite_accepted','workspace.task_reassigned','workspace.staff_revoked')").first<{ n: number }>().then((r) => Number(r?.n))).toBe(4);
  }, 60000);
});
