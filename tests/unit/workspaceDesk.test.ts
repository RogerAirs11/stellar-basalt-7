import { describe, expect, it } from "vitest";
import {
  classifyDocumentCommandFailure,
  classifyWorkspaceAnswerFailure,
  newImportIntentKey,
  normalizeMyWorkspaceInvites,
  normalizeWorkspaceTasks,
  normalizeWorkspacesMine,
  workspacePermissions,
} from "../../src/frontend-kit/domain/workspaceDesk";
import { WORKSPACE_DESK } from "../../src/frontend-kit/domain/locale";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { pick } from "../../src/frontend-kit/domain/locale";
import type { WorkspaceInviteRecord, WorkspaceDashboardResponse, WorkspaceTaskRecord, WorkspacesMineResponse } from "../../src/contracts/platform";

/**
 * R114-05 (Master AI R113 handoff D22/D32–35) — the ONE headless
 * workspace-desk module shared by all five frontends. Pinning it here pins
 * every native surface (Core page + Retro/FEI/Elite/Classic desks):
 *
 *  1. Mine lists normalize owned/staff/organization without fabrication.
 *  2. Task buckets flatten each open reminder exactly once; invalid rows
 *     stay visible as needing review, never hidden.
 *  3. Permissions derive VISIBILITY from the server's live granted actions —
 *     never client-guessed authority.
 *  4. Invitation normalization marks only unexpired rows actionable.
 *  5. Answer refusals map to their honest causes: 410 expired, 404 gone,
 *     409 invite_not_acceptable vs already-answered, else unknown.
 *  6. The copy keeps a workspace a WORKING SET, never an ownership claim,
 *     bilingual (EN+FA).
 */

const task = (id: number, over: Partial<WorkspaceTaskRecord> = {}): WorkspaceTaskRecord => ({
  id, horse_id: null, title: `Reminder ${id}`, category: "other", due_date: "2026-11-0" + ((id % 9) + 1), due_timezone: "Asia/Tehran",
  recurrence: "none", status: "open", assigned_to_user_id: null, occurrence_key: `occ-${id}`, row_version: id, ...over,
});

describe("R114-05 mine-list normalization", () => {
  it("normalizes owned, staff and organization lists", () => {
    const summary = (id: number, role: "owner" | "staff" | "manager") => ({ id, name: `WS ${id}`, description: null, organization_id: null, role, row_version: 1, created_at: "2026-10-17T00:00:00Z" });
    const data: WorkspacesMineResponse = { owned: [summary(1, "owner")], staff: [summary(2, "staff")], organization: [summary(3, "manager")] };
    const lists = normalizeWorkspacesMine(data);
    expect(lists.owned).toHaveLength(1);
    expect(lists.staff[0].role).toBe("staff");
    expect(lists.organization[0].id).toBe(3);
  });

  it("a missing organization list stays empty — never fabricated", () => {
    const lists = normalizeWorkspacesMine({ owned: [], staff: [] });
    expect(lists.owned).toEqual([]);
    expect(lists.organization).toEqual([]);
    expect(normalizeWorkspacesMine(null)).toEqual({ owned: [], staff: [], organization: [] });
  });
});

describe("R114-05 task-bucket normalization", () => {
  it("flattens each open reminder exactly once and indexes by id", () => {
    const dashboard: WorkspaceDashboardResponse = {
      workspace: null, herd_size: 0, horses: [],
      tasks: { overdue: [task(1)], due_soon: [task(2), task(3)], later: [task(4)] },
      active_staff: [], notes: [],
    };
    const buckets = normalizeWorkspaceTasks(dashboard.tasks);
    expect(buckets.all.map(row => row.id)).toEqual([1, 2, 3, 4]);
    expect(buckets.byId.get(3)?.title).toBe("Reminder 3");
    expect(buckets.open).toHaveLength(4);
  });

  it("keeps completed rows out of the open list but visible in all", () => {
    const buckets = normalizeWorkspaceTasks({ overdue: [task(1, { status: "completed" })], due_soon: [], later: [task(2)] });
    expect(buckets.all).toHaveLength(2);
    expect(buckets.open.map(row => row.id)).toEqual([2]);
  });

  it("invalid date rows stay visible as needing review, never hidden", () => {
    const buckets = normalizeWorkspaceTasks({ overdue: [], due_soon: [], later: [], invalid: [task(9)] });
    expect(buckets.invalid).toHaveLength(1);
    expect(buckets.all).toHaveLength(0);
  });

  it("absent task buckets normalize to empty lists", () => {
    const buckets = normalizeWorkspaceTasks(undefined);
    expect(buckets.all).toEqual([]);
    expect(buckets.open).toEqual([]);
    expect(buckets.byId.size).toBe(0);
  });
});

describe("R114-05 permission visibility", () => {
  it("derives task/manage visibility from the server's live granted actions", () => {
    expect(workspacePermissions({ id: 1, name: "x", description: null, organization_id: null, role: "owner", row_version: 1, created_at: "", granted_actions: ["view", "tasks_manage", "manage"] }))
      .toEqual({ mayTask: true, mayManage: true, readOnly: false });
    expect(workspacePermissions({ id: 1, name: "x", description: null, organization_id: null, role: "staff", row_version: 1, created_at: "", granted_actions: ["view", "tasks_manage"] }))
      .toEqual({ mayTask: true, mayManage: false, readOnly: false });
    expect(workspacePermissions({ id: 1, name: "x", description: null, organization_id: null, role: "staff", row_version: 1, created_at: "", granted_actions: ["view"] }))
      .toEqual({ mayTask: false, mayManage: false, readOnly: false });
  });

  it("writable:false is the honest read-only plan state", () => {
    const view = workspacePermissions({ id: 1, name: "x", description: null, organization_id: null, role: "owner", row_version: 1, created_at: "", granted_actions: ["view", "tasks_manage", "manage"], writable: false });
    expect(view.readOnly).toBe(true);
  });

  it("a null workspace grants nothing", () => {
    expect(workspacePermissions(null)).toEqual({ mayTask: false, mayManage: false, readOnly: false });
  });
});

describe("R114-05 my-invitations normalization", () => {
  const invite = (over: Partial<WorkspaceInviteRecord> = {}): WorkspaceInviteRecord => ({
    collection_id: 55, workspace_name: "DEMO Fictional Stable", proposed_actions: "view,tasks_manage", note: "Welcome",
    expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-17T00:00:00Z", ...over,
  });

  it("an unexpired invitation is actionable", () => {
    const rows = normalizeMyWorkspaceInvites([invite()]);
    expect(rows[0].actionable).toBe(true);
    expect(rows[0].workspace_name).toBe("DEMO Fictional Stable");
    expect(rows[0].proposed_actions).toBe("view,tasks_manage");
  });

  it("an expired invitation is NOT actionable — no answer button deserves to render", () => {
    const rows = normalizeMyWorkspaceInvites([invite({ expires_at: "2020-01-01T00:00:00Z" })]);
    expect(rows[0].actionable).toBe(false);
  });

  it("a missing note stays null, never an empty string posing as one", () => {
    const rows = normalizeMyWorkspaceInvites([invite({ note: null })]);
    expect(rows[0].note).toBeNull();
  });
});

describe("R114-05 honest answer classification", () => {
  it("410 maps to expired", () => {
    const failure = classifyWorkspaceAnswerFailure(new PlatformClientError(410, "invite_expired", "This invitation has expired"));
    expect(failure.kind).toBe("expired");
  });

  it("404 maps to gone", () => {
    const failure = classifyWorkspaceAnswerFailure(new PlatformClientError(404, "not_found", "No invitation for you on this workspace"));
    expect(failure.kind).toBe("gone");
  });

  it("409 invite_not_acceptable maps to not_acceptable (inviter authority or capacity changed)", () => {
    const failure = classifyWorkspaceAnswerFailure(new PlatformClientError(409, "invite_not_acceptable", "The invitation could not be accepted"));
    expect(failure.kind).toBe("not_acceptable");
  });

  it("409 already_responded maps to already_answered", () => {
    const failure = classifyWorkspaceAnswerFailure(new PlatformClientError(409, "already_responded", "This invitation is already declined"));
    expect(failure.kind).toBe("already_answered");
  });

  it("anything else stays unknown — never a success", () => {
    expect(classifyWorkspaceAnswerFailure(new PlatformClientError(500, "boom", "Network failed")).kind).toBe("unknown");
    expect(classifyWorkspaceAnswerFailure(new Error("offline")).kind).toBe("unknown");
    expect(classifyWorkspaceAnswerFailure("nonsense").kind).toBe("unknown");
  });
});

describe("R114-06 document command classification", () => {
  it("409 document_version_conflict maps to version_conflict with the CURRENT version for comparison", () => {
    const failure = classifyDocumentCommandFailure(new PlatformClientError(409, "document_version_conflict", "This document changed while you were editing", { current_version: 4 }));
    expect(failure.kind).toBe("version_conflict");
    if (failure.kind === "version_conflict") expect(failure.currentVersion).toBe(4);
  });

  it("409 document_horse_immutable maps to the fixed-association rule", () => {
    const failure = classifyDocumentCommandFailure(new PlatformClientError(409, "document_horse_immutable", "A document's horse association is fixed"));
    expect(failure.kind).toBe("horse_immutable");
  });

  it("409 document_archived maps to read-only history", () => {
    const failure = classifyDocumentCommandFailure(new PlatformClientError(409, "document_archived", "Archived documents are read-only history"));
    expect(failure.kind).toBe("archived");
  });

  it("anything else stays unknown — never a success", () => {
    expect(classifyDocumentCommandFailure(new PlatformClientError(403, "not_allowed", "no")).kind).toBe("unknown");
    expect(classifyDocumentCommandFailure(new Error("offline")).kind).toBe("unknown");
  });
});

describe("R114-06 import intent keys", () => {
  it("mints one durable key per import session — each key is unique and prefixed", () => {
    const first = newImportIntentKey();
    const second = newImportIntentKey();
    expect(first).toMatch(/^import-/);
    expect(second).toMatch(/^import-/);
    expect(first).not.toEqual(second);
  });
});

describe("R114-05 shared copy discipline", () => {
  it("carries the working-set honesty in both languages", () => {
    expect(pick(WORKSPACE_DESK.deskNote, "en")).toContain("working set");
    expect(pick(WORKSPACE_DESK.deskNote, "fa")).toContain("مالکیت");
  });

  it("version-conflict and recurrence copy stay honest", () => {
    expect(pick(WORKSPACE_DESK.versionConflict, "en")).toContain("nothing was written twice");
    expect(pick(WORKSPACE_DESK.completeSuccess, "en")).toContain("exactly once");
    expect(pick(WORKSPACE_DESK.forbiddenDashboard, "en")).toContain("no longer current");
  });

  it("every entry is bilingual with distinct EN/FA text", () => {
    for (const [key, entry] of Object.entries(WORKSPACE_DESK)) {
      expect(entry.en, `${key}.en`).toBeTruthy();
      expect(entry.fa, `${key}.fa`).toBeTruthy();
      expect(entry.en, `${key} EN/FA distinct`).not.toEqual(entry.fa);
    }
  });

  it("R114-06 document + import copy carries the honest discipline", () => {
    expect(pick(WORKSPACE_DESK.documentConflict, "en")).toContain("your draft is kept");
    expect(pick(WORKSPACE_DESK.archivedReadOnly, "en")).toContain("read-only history");
    expect(pick(WORKSPACE_DESK.alreadyImportedLabel, "en")).toContain("previous attempt of this import");
  });
});
