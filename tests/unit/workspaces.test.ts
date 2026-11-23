import { describe, expect, it } from "vitest";
import {
  WORKSPACE_STAFF_ACTIONS,
  VETERINARY_NOTICE,
  parseStaffActions,
  assignmentGrants,
  csvSafeCell,
  csvRow,
  addDays,
  taskOccurrenceKey,
  nextOccurrence,
  bucketTasks,
} from "../../src/workspaces/domain";
import { initialTaskKey } from "../../src/workspaces/taskIdentity";
import {
  createWorkspace,
  createWorkspaceTask,
  completeWorkspaceTask,
  assignWorkspaceStaff,
  revokeWorkspaceStaff,
  addWorkspaceHorse,
  exportWorkspaceCsv,
  deleteWorkspace,
} from "../../src/api/modules/workspaces";
import { HttpError } from "../../src/api/http";
import { openRealDatabase, seedUser, makeSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P14 — farm workspace collections and delegated daily work.
 *
 * Acceptance pinned:
 *  - a horse in two private collections does not change its ownership
 *    assertion (no handler writes horse_people / horse_access_grants);
 *  - staff sees only granted data; revoked access disappears on the NEXT
 *    request (live re-authorization);
 *  - recurring task creation is idempotent across scheduler retries;
 *  - export obeys privacy and cannot execute spreadsheet formulas from user
 *    text (formula-injection defense).
 */

// ---------------------------------------------------------------------------
// 1. Domain helpers.
// ---------------------------------------------------------------------------

describe("P14 domain helpers", () => {
  it("parses staff action grants with an explicit allowlist", () => {
    expect(parseStaffActions("view,tasks_manage")).toEqual({ ok: true, actions: ["view", "tasks_manage"] });
    expect(parseStaffActions("view, view ,export").ok).toBe(true);
    expect(parseStaffActions("view,*").ok).toBe(false);
    expect(parseStaffActions("").ok).toBe(false);
    expect([...WORKSPACE_STAFF_ACTIONS]).toEqual(["view", "tasks_manage", "export"]);
  });

  it("assignmentGrants honors live status (revoked grants nothing)", () => {
    expect(assignmentGrants({ actions: "view,export", status: "active" }, "export")).toBe(true);
    expect(assignmentGrants({ actions: "view,export", status: "active" }, "tasks_manage")).toBe(false);
    expect(assignmentGrants({ actions: "view,export", status: "revoked" }, "view")).toBe(false);
  });

  it("CSV formula-injection defense: =, +, -, @, tab and CR cells are neutralized", () => {
    expect(csvSafeCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvSafeCell("+1|cmd")).toBe("'+1|cmd");
    expect(csvSafeCell("-2+3")).toBe("'-2+3");
    expect(csvSafeCell("@import")).toBe("'@import");
    expect(csvSafeCell("\tTAB")).toBe("'\tTAB");
    expect(csvSafeCell("plain text")).toBe("plain text");
    expect(csvSafeCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvRow(["=cmd", "normal"])).toBe("'=cmd,normal");
  });

  it("date arithmetic is calendar-exact across month/year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-03", 90)).toBe("2027-01-01");
  });

  it("occurrence keys are deterministic (scheduler retry = same key)", () => {
    expect(taskOccurrenceKey("c7:Farrier", "2026-11-01", 0)).toBe("task:c7:Farrier:2026-11-01:i0");
    expect(taskOccurrenceKey("c7:Farrier", "2026-11-01", 0)).toBe(taskOccurrenceKey("c7:Farrier", "2026-11-01", 0));
    expect(taskOccurrenceKey("c7:Farrier", "2026-11-01", 1)).not.toBe(taskOccurrenceKey("c7:Farrier", "2026-11-01", 0));
  });

  it("nextOccurrence is mechanical interval arithmetic only", () => {
    expect(nextOccurrence({ recurrence: "none", recurrence_interval_days: null, due_date: "2026-10-01" })).toBeNull();
    expect(nextOccurrence({ recurrence: "custom_days", recurrence_interval_days: 30, due_date: "2026-10-01" })).toEqual({ dueDate: "2026-10-31", intervalDays: 30 });
    expect(nextOccurrence({ recurrence: "custom_days", recurrence_interval_days: 31, due_date: "2026-10-01" })).toEqual({ dueDate: "2026-11-01", intervalDays: 31 });
    expect(nextOccurrence({ recurrence: "custom_days", recurrence_interval_days: 0, due_date: "2026-10-01" })).toBeNull();
    expect(nextOccurrence({ recurrence: "custom_days", recurrence_interval_days: 9999, due_date: "2026-10-01" })).toBeNull();
  });

  it("bucketTasks splits open tasks into overdue / due-soon / later", () => {
    const tasks = [
      { due_date: "2026-09-01", status: "open" },
      { due_date: "2026-10-02", status: "open" },
      { due_date: "2026-12-01", status: "open" },
      { due_date: "2026-09-01", status: "done" }, // done tasks never appear
    ];
    const buckets = bucketTasks(tasks, "2026-10-01", 7);
    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.dueSoon).toHaveLength(1);
    expect(buckets.later).toHaveLength(1);
  });

  it("the veterinary notice is explicit: reminders, never medical instructions", () => {
    expect(VETERINARY_NOTICE).toContain("not medical advice");
    expect(VETERINARY_NOTICE).toContain("qualified person");
  });
});

// ---------------------------------------------------------------------------
// 2. Handler boundaries (mocked D1).
// ---------------------------------------------------------------------------

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  collection?: Record<string, unknown> | null;
  assignment?: Record<string, unknown> | null;
  horse?: Record<string, unknown> | null;
  member?: Record<string, unknown> | null;
  task?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  membership?: Record<string, unknown> | null;
  horses?: Array<Record<string, unknown>>;
  updateChanges?: number;
  insertChanges?: number;
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string, args: unknown[]): unknown => {
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    // R97: authorizeWorkspace now proves the ACTING principal, the workspace
    // role and (for writes) the plan state INSIDE one correlated query against
    // workspace_collections AS wc. Model it faithfully from the same script:
    // an active principal, the personal-owner match, an action-scoped active
    // staff assignment, or an owner/manager org membership permits; anything
    // else is the same 404 the production query returns.
    if (sql.includes("SELECT wc.id FROM workspace_collections wc")) {
      const s = script.session as { id?: string; is_active?: number } | null | undefined;
      const c = script.collection as { id?: number; owner_user_id?: string; organization_id?: number | null } | null | undefined;
      if (!s || !c || Number(s.is_active ?? 1) !== 1) return null;
      if (c.organization_id == null && c.owner_user_id === s.id) return { id: c.id };
      const actionLike = args.find((a): a is string => typeof a === "string" && a.startsWith("%,") && a.endsWith(",%"));
      const action = actionLike ? actionLike.slice(2, -2) : null; // manage carries no staff branch at all
      const a = script.assignment as { actions?: string; status?: string } | null | undefined;
      if (action && a && a.status === "active" && typeof a.actions === "string"
        && a.actions.replace(/\s/g, "").split(",").filter(Boolean).includes(action)) return { id: c.id };
      const m = script.membership as { role?: string } | null | undefined;
      if (c.organization_id != null && m && (m.role === "owner" || m.role === "manager")) return { id: c.id };
      return null;
    }
    if (sql.includes("FROM workspace_collections WHERE id=? AND deleted_at IS NULL")) return script.collection ?? null;
    if (sql.includes("FROM workspace_staff_assignments WHERE collection_id=? AND user_id=?")) return script.assignment ?? null;
    if (sql.includes("FROM horses WHERE id=? AND deleted_at IS NULL")) return script.horse ?? null;
    if (sql.includes("FROM workspace_collection_members WHERE collection_id=? AND horse_id=?")) return script.member ?? null;
    if (sql.includes("FROM workspace_tasks WHERE id=? AND collection_id=?")) return script.task ?? null;
    if (sql.includes("FROM users WHERE id=? AND is_active=1")) return script.user ?? null;
    if (sql.includes("FROM organization_memberships WHERE user_id=?")) return script.membership ?? null;
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("JOIN horses h ON h.id=wcm.horse_id")) return { results: script.horses ?? [] };
    return { results: [] };
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => answerFirst(sql, args),
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: script.updateChanges ?? 1 } }; },
  });
  let autoIncrement = 500;
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      autoIncrement += 1;
      return statements.map((statement, index) => ({
        results: [], success: true,
        meta: { changes: index === 0 ? (script.insertChanges ?? script.updateChanges ?? 1) : 1, last_row_id: autoIncrement },
      }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const ownerSession = {
  session_id: "s-1", csrf_token: "csrf-1", expires_at: new Date(Date.now() + 3600_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "owner-1", email: "owner@example.com", display_name: "Owner", role: "user", is_active: 1,
};
const staffSession = { ...ownerSession, id: "staff-1", email: "staff@example.com" };

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };
const ORIGIN = "https://registry.example";

function request(body: unknown, path: string, method = "POST", session = ownerSession): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

describe("P14 handlers", () => {
  it("createWorkspaceTask: idempotent occurrence insert (ON CONFLICT DO NOTHING) + veterinary notice", async () => {
    const db = makeDb({ session: ownerSession, collection: { id: 7, owner_user_id: "owner-1", organization_id: null } });
    const response = await createWorkspaceTask(
      request({ title: "Farrier visit", category: "farrier", due_date: "2026-11-01" }, "/api/workspaces/7/tasks"),
      { ...env, DB: db }, 7,
    );
    expect(response.status).toBe(201);
    const insert = db.__writes.find((w) => w.sql.includes("INSERT INTO workspace_tasks"));
    expect(insert?.sql).toContain("ON CONFLICT(occurrence_key) DO NOTHING");
    // R97: a FRESH task's identity key covers the FULL intent (collection,
    // actor, horse, title, category, due date AND timezone, recurrence,
    // interval, assignee) — the old (collection, horse, category, title)
    // family key survives only to replay true legacy rows. The same reminder
    // for a DIFFERENT horse, zone or assignee is a different intent.
    expect(insert?.args[9]).toBe(await initialTaskKey({
      collectionId: 7, actorUserId: "owner-1", horseId: null, title: "Farrier visit", category: "farrier",
      dueDate: "2026-11-01", dueTimezone: "Asia/Tehran", recurrence: "none", recurrenceIntervalDays: null, assignedToUserId: null,
    }));
    expect(String(insert?.args[9])).toMatch(/^task:initial:[0-9a-f]{64}$/);
    expect(db.__writes.some((w) => w.sql.includes("horse_people"))).toBe(false);
    expect(db.__writes.some((w) => w.sql.includes("horse_access_grants"))).toBe(false);

    const vetDb = makeDb({ session: ownerSession, collection: { id: 7, owner_user_id: "owner-1", organization_id: null } });
    const vetResponse = await createWorkspaceTask(
      request({ title: "Vet appointment", category: "veterinary_appointment", due_date: "2026-11-01" }, "/api/workspaces/7/tasks"),
      { ...env, DB: vetDb }, 7,
    );
    const vetBody = await vetResponse.json() as { veterinary_notice?: string };
    expect(vetBody.veterinary_notice).toBe(VETERINARY_NOTICE);
  });

  it("createWorkspaceTask: a replayed identical reminder reports idempotent_replay, no duplicate (REAL database)", async () => {
    // R95-N08: the idempotency decision now lives INSIDE the atomic batch
    // (occurrence_key + marker), so the replay proof runs on a real database
    // with every migration applied — same doctrine as the R95-N01 rewrite.
    const db = await openRealDatabase();
    await seedUser(db, "owner-1", "user");
    const owner = await makeSession(db, "owner-1");
    const created = await createWorkspace(
      new Request("https://registry.example/api/workspaces", { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken, origin: "https://registry.example" }, body: JSON.stringify({ name: "Replay herd" }) }),
      { SESSION_COOKIE_NAME: "hr_session", DB: db }, 
    );
    const workspaceId = ((await created.json() as { workspace: { id: number } })).workspace.id;
    const taskRequest = () => new Request(`https://registry.example/api/workspaces/${workspaceId}/tasks`, { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken, origin: "https://registry.example" }, body: JSON.stringify({ title: "Farrier visit", category: "farrier", due_date: "2026-11-01" }) });
    const first = await createWorkspaceTask(taskRequest(), { SESSION_COOKIE_NAME: "hr_session", DB: db }, workspaceId);
    expect(first.status).toBe(201);
    const second = await createWorkspaceTask(taskRequest(), { SESSION_COOKIE_NAME: "hr_session", DB: db }, workspaceId);
    const body = await second.json() as { idempotent_replay: boolean };
    expect(body.idempotent_replay).toBe(true);
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM workspace_tasks").first<{ n: number }>();
    expect(Number(rows?.n)).toBe(1);
  });

  it("view-only staff cannot create tasks (action-scoped authorization)", async () => {
    const db = makeDb({
      session: staffSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      assignment: { actions: "view,export", status: "active" },
    });
    await expect(createWorkspaceTask(
      request({ title: "Farrier visit", category: "farrier", due_date: "2026-11-01" }, "/api/workspaces/7/tasks"),
      { ...env, DB: db }, 7,
    )).rejects.toThrow(HttpError);
  });

  it("tasks_manage staff CAN create tasks", async () => {
    const db = makeDb({
      session: staffSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      assignment: { actions: "view,tasks_manage", status: "active" },
    });
    const response = await createWorkspaceTask(
      request({ title: "Trim", category: "farrier", due_date: "2026-11-05" }, "/api/workspaces/7/tasks"),
      { ...env, DB: db }, 7,
    );
    expect(response.status).toBe(201);
  });

  it("a REVOKED staff assignment loses access immediately (live re-check)", async () => {
    const db = makeDb({
      session: staffSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      assignment: { actions: "view,tasks_manage", status: "revoked" },
    });
    await expect(createWorkspaceTask(
      request({ title: "Trim", category: "farrier", due_date: "2026-11-05" }, "/api/workspaces/7/tasks"),
      { ...env, DB: db }, 7,
    )).rejects.toThrow(HttpError);
  });

  it("completing a recurring task materializes the next occurrence in the SAME batch, idempotently", async () => {
    const db = makeDb({
      session: ownerSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      task: { id: 12, status: "open", recurrence: "custom_days", recurrence_interval_days: 30, due_date: "2026-10-01", title: "Farrier", row_version: 1, occurrence_index: 0 },
    });
    const response = await completeWorkspaceTask(
      request({ expected_version: 1 }, "/api/workspaces/7/tasks/12/complete"),
      { ...env, DB: db }, 7, 12,
    );
    const body = await response.json() as { completed: boolean; next_occurrence: { due_date: string } | null };
    expect(body.completed).toBe(true);
    expect(body.next_occurrence?.due_date).toBe("2026-10-31");
    const nextInsert = db.__writes.find((w) => w.sql.includes("INSERT INTO workspace_tasks(collection_id,horse_id,title,category,due_date,recurrence"));
    expect(nextInsert).toBeTruthy();
    expect(nextInsert?.sql).toContain("ON CONFLICT(occurrence_key) DO NOTHING");
    expect(nextInsert?.args[0]).toBe("2026-10-31");
    // R95: the materialized next occurrence is keyed by its PARENT completion —
    // deterministic per parent, so a retried completion cannot duplicate it.
    expect(nextInsert?.args[1]).toBe("task-parent:12:next");
    // Same-batch: the UPDATE and the next-occurrence INSERT landed together.
    const update = db.__writes.find((w) => w.sql.includes("SET status='done'"));
    expect(update).toBeTruthy();
  });

  it("addWorkspaceHorse writes ONLY the membership table (never ownership)", async () => {
    const db = makeDb({
      session: ownerSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      horse: { id: 55 },
    });
    const response = await addWorkspaceHorse(request({ horse_id: 55 }, "/api/workspaces/7/horses"), { ...env, DB: db }, 7 as never);
    void response;
    const insert = db.__writes.find((w) => w.sql.includes("INSERT INTO workspace_collection_members"));
    expect(insert?.sql).toContain("ON CONFLICT(collection_id,horse_id) DO NOTHING");
    expect(db.__writes.some((w) => w.sql.includes("horse_people"))).toBe(false);
    expect(db.__writes.some((w) => w.sql.includes("horse_access_grants"))).toBe(false);
    expect(db.__writes.some((w) => w.sql.includes("INSERT INTO horses"))).toBe(false);
  });

  it("assignWorkspaceStaff validates the action list and refuses self-assignment", async () => {
    const db = makeDb({
      session: ownerSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      user: { id: "staff-1" },
    });
    await expect(assignWorkspaceStaff(
      request({ user_id: "staff-1", actions: "view,admin" }, "/api/workspaces/7/staff"),
      { ...env, DB: db }, 7 as never,
    )).rejects.toThrow(HttpError);

    const selfDb = makeDb({ session: ownerSession, collection: { id: 7, owner_user_id: "owner-1", organization_id: null } });
    await expect(assignWorkspaceStaff(
      request({ user_id: "owner-1", actions: "view" }, "/api/workspaces/7/staff"),
      { ...env, DB: selfDb }, 7 as never,
    )).rejects.toThrow(HttpError);
  });

  it("revokeWorkspaceStaff marks revoked with an audit event", async () => {
    const db = makeDb({ session: ownerSession, collection: { id: 7, owner_user_id: "owner-1", organization_id: null } });
    const response = await revokeWorkspaceStaff(
      request({}, "/api/workspaces/7/staff/staff-1/revoke"),
      { ...env, DB: db }, 7 as never, "staff-1",
    );
    const body = await response.json() as { revoked: boolean };
    expect(body.revoked).toBe(true);
    expect(db.__writes.some((w) => w.args.includes("workspace.staff_revoked"))).toBe(true);
  });

  it("exportWorkspaceCsv: registry-safe fields only, formula cells neutralized, no contact/genetics", async () => {
    const db = makeDb({
      session: ownerSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      assignment: { actions: "export", status: "active" },
      horses: [
        { id: 1, name_latin: "=SUM(A1)", name_native: "plain", sex: "m", birth_date: "2020-01-01", color: "bay", breed: "Arabian" },
      ],
    });
    const response = await exportWorkspaceCsv(request({}, "/api/workspaces/7/export", "GET", staffSession), { ...env, DB: db }, 7 as never);
    const csv = await response.text();
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(csv).toContain("horse_id,name_latin");
    expect(csv).toContain("'=SUM(A1)"); // formula neutralized
    expect(csv).not.toMatch(/(^|,|\n)=SUM/); // no cell ever STARTS with a formula character
    expect(csv.toLowerCase()).not.toContain("email");
    expect(csv.toLowerCase()).not.toContain("phone");
    expect(csv.toLowerCase()).not.toContain("genetic");
  });

  it("export is REFUSED for staff without the export action (privacy)", async () => {
    const db = makeDb({
      session: staffSession,
      collection: { id: 7, owner_user_id: "owner-1", organization_id: null },
      assignment: { actions: "view", status: "active" },
    });
    await expect(exportWorkspaceCsv(request({}, "/api/workspaces/7/export", "GET", staffSession), { ...env, DB: db }, 7 as never))
      .rejects.toThrow(HttpError);
  });

  it("deleteWorkspace soft-deletes the collection, never horses", async () => {
    const db = makeDb({ session: ownerSession, collection: { id: 7, owner_user_id: "owner-1", organization_id: null } });
    const response = await deleteWorkspace(request({}, "/api/workspaces/7", "DELETE"), { ...env, DB: db }, 7 as never);
    const body = await response.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
    const softDelete = db.__writes.find((w) => w.sql.includes("UPDATE workspace_collections AS wc SET deleted_at"));
    expect(softDelete).toBeTruthy();
    // R97: the archive write carries the mutation-time authority arm inside
    // the SAME statement (allowExpiredProtection — a protective archive stays
    // available even after plan expiry).
    expect(softDelete?.sql).toContain("users principal");
    expect(db.__writes.some((w) => /DELETE FROM horses/.test(w.sql))).toBe(false);
  });
});
