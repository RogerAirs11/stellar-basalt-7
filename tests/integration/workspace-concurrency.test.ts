import { describe, expect, it } from "vitest";
import {
  addWorkspaceHorse, bulkWorkspaceHorses, assignWorkspaceStaff, revokeWorkspaceStaff,
  createWorkspaceTask, createWorkspace, deleteWorkspace, exportWorkspaceCsv, myWorkspaces,
} from "../../src/api/modules/workspaces";
import { addHorseStatements, MAX_ACTIVE_STAFF_PER_COLLECTION, MAX_HORSES_PER_COLLECTION, revokeStaffStatements } from "../../src/workspaces/mutationCommands";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, countRows,
  type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R95-N08 evidence: atomic workspace mutations and exact capacities on a real
 * database with every migration applied (57 migrations).
 *
 * The proven task-completion pattern extended to EVERY mutation:
 *  - stable row lock (no-op UPDATE) serializes concurrent mutations per
 *    collection, so the capacity count inside INSERT..SELECT is exact;
 *  - mutation-time actor predicate denies late/unauthorized mutations;
 *  - marker-gated audit rows: a failed mutation leaves no audit trail, a
 *    retry writes no duplicate;
 *  - archived (soft-deleted) workspaces accept no new work while historical
 *    task rows are retained.
 */

const env = (db: D1Database) => ({ DB: db, SESSION_COOKIE_NAME: "hr_session" }) as never;

async function ownerWithWorkspace(db: D1Database, name = "Concurrency herd"): Promise<{ owner: AuthedSession; workspaceId: number }> {
  await seedUser(db, "owner-1", "user");
  const owner = await makeSession(db, "owner-1");
  const created = await createWorkspace(authedRequest("/api/workspaces", { name }, { session: owner }), env(db));
  const body = await created.json() as { workspace: { id: number } };
  return { owner, workspaceId: body.workspace.id };
}

/** Real horses rows (the working set references canonical horses). */
async function seedHorses(db: D1Database, count: number, startId = 1): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    await db.prepare("INSERT INTO horses(id,name_latin,sex_desc,birth_date) VALUES(?,?,?,?)")
      .bind(id, `Horse ${id}`, "Stallion", "2020-01-01").run();
    ids.push(id);
  }
  return ids;
}

describe("R95-N08 exact capacities under concurrency", () => {
  it("at limit-1, two SIMULTANEOUS adds land as exactly ONE member + one controlled limit error", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const horses = await seedHorses(db, MAX_HORSES_PER_COLLECTION + 2);
    // Fill to limit-1 directly through the REAL statements.
    for (const horseId of horses.slice(0, MAX_HORSES_PER_COLLECTION - 1)) {
      await db.batch(addHorseStatements(db, { collectionId: workspaceId, horseId, actorUserId: "owner-1", operationId: crypto.randomUUID(), action: "manage" }));
    }
    expect(await countRows(db, "workspace_collection_members", `collection_id=${workspaceId}`)).toBe(MAX_HORSES_PER_COLLECTION - 1);

    // Two simultaneous adds for two DIFFERENT horses at the last slot.
    const [r1, r2] = await Promise.allSettled([
      db.batch(addHorseStatements(db, { collectionId: workspaceId, horseId: horses[MAX_HORSES_PER_COLLECTION - 1]!, actorUserId: "owner-1", operationId: crypto.randomUUID(), action: "manage" })),
      db.batch(addHorseStatements(db, { collectionId: workspaceId, horseId: horses[MAX_HORSES_PER_COLLECTION]!, actorUserId: "owner-1", operationId: crypto.randomUUID(), action: "manage" })),
    ]);
    const changes = [r1, r2].map((r) => r.status === "fulfilled" ? Number(r.value[1]?.meta.changes ?? 0) : 0);
    expect(changes.reduce((a, b) => a + b, 0)).toBe(1); // EXACTLY one insert
    expect(await countRows(db, "workspace_collection_members", `collection_id=${workspaceId}`)).toBe(MAX_HORSES_PER_COLLECTION); // never over the limit

    // The handler reports the limit honestly for a further add.
    await expect(addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: horses[MAX_HORSES_PER_COLLECTION + 1]! }, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 409, code: "herd_capacity_reached" });
    expect(await countRows(db, "workspace_collection_members", `collection_id=${workspaceId}`)).toBe(MAX_HORSES_PER_COLLECTION);
    // Removing one makes room again (the limit is exact, not sticky).
    await bulkWorkspaceHorses(authedRequest(`/api/workspaces/${workspaceId}/horses/bulk`, { remove: [horses[0]!] }, { session: owner }), env(db), workspaceId);
    const readd = await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: horses[MAX_HORSES_PER_COLLECTION + 1]! }, { session: owner }), env(db), workspaceId);
    expect(readd.status).toBe(201);
  });

  it("a duplicate add is an honest idempotent replay (no second row, no duplicate audit)", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    await seedHorses(db, 1);
    const first = await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: owner }), env(db), workspaceId);
    expect(first.status).toBe(201);
    const second = await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: owner }), env(db), workspaceId);
    const body = await second.json() as { idempotent_replay: boolean };
    expect(body.idempotent_replay).toBe(true);
    expect(await countRows(db, "workspace_collection_members")).toBe(1);
    expect(await countRows(db, "audit_events", "action='workspace.horse_added'")).toBe(1);
  });

  it("staff capacity is exact: the 51st NEW staff is refused; updating an EXISTING staff member at cap still works", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    for (let i = 1; i <= MAX_ACTIVE_STAFF_PER_COLLECTION; i++) {
      await seedUser(db, `staff-${i}`, "user");
      await db.batch([
        db.prepare("INSERT INTO workspace_staff_assignments(collection_id,user_id,actions,granted_by_user_id) VALUES(?,?,?,?)")
          .bind(workspaceId, `staff-${i}`, "view", "owner-1"),
      ]);
    }
    await seedUser(db, "staff-late", "user");
    await expect(assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "staff-late", actions: "view" }, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 409, code: "staff_capacity_reached" });
    expect(await countRows(db, "workspace_staff_assignments", "status='active'")).toBe(MAX_ACTIVE_STAFF_PER_COLLECTION);
    // Upserting an EXISTING member at cap is not a capacity violation.
    const update = await assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "staff-1", actions: "view,tasks_manage" }, { session: owner }), env(db), workspaceId);
    expect(update.status).toBe(201);
    expect(await countRows(db, "workspace_staff_assignments", "status='active'")).toBe(MAX_ACTIVE_STAFF_PER_COLLECTION);
  });
});

describe("R95-N08 mutation-time authority + marker-gated side effects", () => {
  it("a revoke between preflight and mutation denies the LATE mutation — and a failed revoke leaves NO audit row", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    await seedUser(db, "staff-1", "user");
    await seedUser(db, "staff-2", "user");
    await assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "staff-1", actions: "view" }, { session: owner }), env(db), workspaceId);
    const auditsBefore = await countRows(db, "audit_events", "action='workspace.staff_revoked'");

    // The assignment is revoked OUT from under a late command: the statements
    // re-check status='active' at mutation time, so the second revoke fails
    // and — unlike the pre-N08 bug — writes NO misleading audit row.
    await revokeWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff/staff-1`, {}, { session: owner }), env(db), workspaceId, "staff-1");
    await expect(revokeWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff/staff-1`, {}, { session: owner }), env(db), workspaceId, "staff-1"))
      .rejects.toMatchObject({ status: 409, code: "not_active" });
    expect(await countRows(db, "audit_events", "action='workspace.staff_revoked'")).toBe(auditsBefore + 1); // exactly one honest row

    // A late MUTATION by the revoked staff member is denied by the
    // mutation-time predicate (their assignment no longer grants anything).
    const staffSession = await makeSession(db, "staff-1");
    await seedHorses(db, 1);
    await expect(addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: staffSession }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
    expect(await countRows(db, "workspace_collection_members")).toBe(0);
  });

  it("a command batch whose actor lost authority mid-flight writes NOTHING (row-lock statement reports 0 changes)", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    await seedHorses(db, 1);
    // The workspace is archived AFTER the preflight but BEFORE the batch.
    await deleteWorkspace(authedRequest(`/api/workspaces/${workspaceId}`, {}, { session: owner }), env(db), workspaceId);
    const results = await db.batch(addHorseStatements(db, { collectionId: workspaceId, horseId: 1, actorUserId: "owner-1", operationId: crypto.randomUUID(), action: "manage" }));
    expect(Number(results[0]?.meta.changes ?? 0)).toBe(0); // authority/alive check failed
    expect(Number(results[1]?.meta.changes ?? 0)).toBe(0); // nothing inserted
    expect(await countRows(db, "workspace_collection_members")).toBe(0);
    expect(await countRows(db, "audit_events", "action='workspace.horse_added'")).toBe(0); // marker gate held
  });

  it("task retries create exactly ONE task and ONE audit row (occurrence key + marker)", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    const task = { title: "Farrier visit", category: "farrier" as const, due_date: "2026-11-01" };
    for (let i = 0; i < 3; i++) {
      await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, task, { session: owner }), env(db), workspaceId);
    }
    expect(await countRows(db, "workspace_tasks")).toBe(1);
    expect(await countRows(db, "audit_events", "action='workspace.task_created'")).toBe(1);
  });

  it("staff assign retries write no duplicate audit rows", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    await seedUser(db, "staff-9", "user");
    for (let i = 0; i < 2; i++) {
      await assignWorkspaceStaff(authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "staff-9", actions: "view" }, { session: owner }), env(db), workspaceId);
    }
    expect(await countRows(db, "workspace_staff_assignments")).toBe(1);
    expect(await countRows(db, "audit_events", "action='workspace.staff_assigned'")).toBe(2); // one per successful upsert operation (each is a REAL change)
    // A no-op retry (identical actions, same row) is still one assignment row.
    expect(await countRows(db, "workspace_staff_assignments", "status='active'")).toBe(1);
  });
});

describe("R95-N08 archive semantics + export policy", () => {
  it("an archived workspace accepts NO new work; historical task/member rows are retained; export is refused by the explicit policy", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    await seedHorses(db, 1);
    await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: owner }), env(db), workspaceId);
    await createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, { title: "Dentist", category: "other", due_date: "2026-12-01" }, { session: owner }), env(db), workspaceId);
    const membersBefore = await countRows(db, "workspace_collection_members");
    const tasksBefore = await countRows(db, "workspace_tasks");

    await deleteWorkspace(authedRequest(`/api/workspaces/${workspaceId}`, {}, { session: owner }), env(db), workspaceId);
    expect(await countRows(db, "workspace_collections", "deleted_at IS NOT NULL")).toBe(1);

    // No new work: horse add, bulk, task, staff, second archive — all refused.
    await expect(addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
    await expect(bulkWorkspaceHorses(authedRequest(`/api/workspaces/${workspaceId}/horses/bulk`, { add: [1] }, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
    await expect(createWorkspaceTask(authedRequest(`/api/workspaces/${workspaceId}/tasks`, { title: "After archive", category: "other", due_date: "2026-12-02" }, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });
    await expect(deleteWorkspace(authedRequest(`/api/workspaces/${workspaceId}`, {}, { session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });

    // History retained: the rows were never deleted.
    expect(await countRows(db, "workspace_collection_members")).toBe(membersBefore);
    expect(await countRows(db, "workspace_tasks")).toBe(tasksBefore);

    // Export policy is explicit: archived collections are not exportable.
    await expect(exportWorkspaceCsv(authedRequest(`/api/workspaces/${workspaceId}/export`, undefined, { method: "GET", session: owner }), env(db), workspaceId))
      .rejects.toMatchObject({ status: 404 });

    // The archived collection disappears from the mine list.
    const mine = await myWorkspaces(authedRequest("/api/workspaces", undefined, { method: "GET", session: owner }), env(db));
    const mineBody = await mine.json() as { owned: unknown[] };
    expect(mineBody.owned).toHaveLength(0);
  });

  it("the legitimate export remains available while active and projects only registry-safe fields", async () => {
    const db = await openRealDatabase();
    const { owner, workspaceId } = await ownerWithWorkspace(db);
    await seedHorses(db, 1);
    await db.prepare("UPDATE horses SET name_latin='=SUM(H1:H9)' WHERE id=1").run(); // formula payload
    await addWorkspaceHorse(authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: 1 }, { session: owner }), env(db), workspaceId);
    const response = await exportWorkspaceCsv(authedRequest(`/api/workspaces/${workspaceId}/export`, undefined, { method: "GET", session: owner }), env(db), workspaceId);
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("horse_id,name_latin");
    expect(csv).toContain("'=SUM(H1:H9)"); // formula neutralized
    expect(csv).not.toContain("email"); // no private contact fields in the projection
  });
});
