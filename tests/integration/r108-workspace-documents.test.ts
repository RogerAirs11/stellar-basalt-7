import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import {
  openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession,
} from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R108-08: document association semantics and import receipts, certified
 * through the REAL Worker router (src/worker.ts — the module Cloudflare
 * deploys) over a REAL SQLite database with EVERY migration (through 0080)
 * applied and foreign keys enforced. No SQL recorder stands in for the
 * database and no handler is called directly: every request travels the real
 * route table, the real Zod schemas, the real auth/CSRF guards and the real
 * D1 batch boundary.
 *
 * Certified acceptance:
 *  A. a document's horse association is FIXED AT CREATION — a round-tripped
 *     horse_id that differs from the stored association is a deterministic
 *     409 document_horse_immutable with NO mutation (no version bump, no
 *     audit row); the same value round-trips; omitting the field updates the
 *     writable fields normally; a non-member horse is refused at create;
 *     expected-version conflicts, archived rows and permission boundaries
 *     still hold;
 *  B. task import carries DURABLE PER-ROW RECEIPTS — a replay with the SAME
 *     intent_key reconciles to the EXACT accepted rows (previously accepted
 *     rows report already_imported, are never re-executed or duplicated, and
 *     count as accepted); a pre-existing occurrence under a DIFFERENT intent
 *     keeps the honest occurrence_exists skip; the legacy no-intent path is
 *     unchanged; every receipt task_id points at a real task row; audits are
 *     never duplicated by a replay.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only",
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter,
    AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter,
    ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

async function call(db: D1Database, request: Request): Promise<Response> {
  return worker.fetch(request, makeEnv(db));
}

interface ErrorBody { error?: { code?: string; message?: string; details?: { current_version?: number; stored_horse_id?: number | null } } }

async function readError(response: Response): Promise<ErrorBody> {
  return await response.json() as ErrorBody;
}

async function scalar(db: D1Database, sql: string, ...args: unknown[]): Promise<number> {
  const found = await db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(...args).first<{ n: number }>();
  return Number(found?.n ?? 0);
}

async function world(db: D1Database) {
  await seedUser(db, "owner-1", "user");
  await seedUser(db, "viewer-1", "user");
  await seedUser(db, "outsider-1", "user");
  const owner = await makeSession(db, "owner-1");
  const viewer = await makeSession(db, "viewer-1");
  const outsider = await makeSession(db, "outsider-1");
  return { owner, viewer, outsider };
}

async function createWorkspace(db: D1Database, session: AuthedSession, name: string): Promise<number> {
  const response = await call(db, authedRequest("/api/workspaces", { name }, { session }));
  expect(response.status).toBe(201);
  const body = await response.json() as { workspace: { id: number } };
  return body.workspace.id;
}

/** A herd with TWO member horses so an association MOVE is representable. */
async function seedHerd(db: D1Database, workspaceId: number, session: AuthedSession): Promise<{ horseA: number; horseB: number }> {
  await db.exec(`
    INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (191,'R108 HERD ONE',1,NULL);
    INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (192,'R108 HERD TWO',1,NULL);
  `);
  for (const horseId of [191, 192]) {
    const added = await call(db, authedRequest(`/api/workspaces/${workspaceId}/horses`, { horse_id: horseId }, { session }));
    expect(added.status).toBe(201);
  }
  return { horseA: 191, horseB: 192 };
}

async function createDocument(db: D1Database, session: AuthedSession, workspaceId: number, body: Record<string, unknown>): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/${workspaceId}/documents`, body, { session }));
}

async function patchDocument(db: D1Database, session: AuthedSession, workspaceId: number, documentId: number, body: Record<string, unknown>): Promise<Response> {
  return call(db, new Request(`https://registry.example/api/workspaces/${workspaceId}/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://registry.example", cookie: session.cookie, "x-csrf-token": session.csrfToken },
    body: JSON.stringify(body),
  }));
}

async function importTasks(db: D1Database, session: AuthedSession, workspaceId: number, body: Record<string, unknown>): Promise<Response> {
  return call(db, authedRequest(`/api/workspaces/${workspaceId}/tasks/import`, body, { session }));
}

// ---------------------------------------------------------------------------
// A. Document association semantics through the real routes
// ---------------------------------------------------------------------------

describe("R108-08 A. document horse association is explicit and immutable after create", () => {
  it("a changed horse_id is a deterministic 409 document_horse_immutable with NO mutation — same value round-trips, omitted value updates normally", async () => {
    const db = await openRealDatabase();
    const { owner } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "R108-08 doc herd");
    const { horseA, horseB } = await seedHerd(db, workspaceId, owner);

    const created = await createDocument(db, owner, workspaceId, { horse_id: horseA, title: "Passport tracker", category: "registration", note: "paper file at the office" });
    expect(created.status).toBe(201);
    const documents = await call(db, authedRequest(`/api/workspaces/${workspaceId}/documents`, undefined, { session: owner }));
    const listed = await documents.json() as { rows: Array<{ id: number; horse_id: number | null; row_version: number; title: string }> };
    expect(listed.rows).toHaveLength(1);
    const doc = listed.rows[0];
    expect(doc.horse_id).toBe(horseA);

    // A round-trip with the SAME association succeeds and bumps the version once.
    const sameAssociation = await patchDocument(db, owner, workspaceId, doc.id, { horse_id: horseA, title: "Passport tracker", category: "registration", note: "updated note", expected_version: doc.row_version });
    expect(sameAssociation.status).toBe(200);

    const afterSame = await call(db, authedRequest(`/api/workspaces/${workspaceId}/documents`, undefined, { session: owner }));
    const docAfterSame = ((await afterSame.json()) as { rows: Array<{ id: number; row_version: number; title: string; note: string | null }> }).rows[0];
    expect(docAfterSame.row_version).toBe(doc.row_version + 1);
    expect(docAfterSame.note).toBe("updated note");

    // A MOVE to the other member horse is explicitly refused — deterministically, with no mutation.
    const auditsBefore = await scalar(db, "audit_events WHERE entity_type='workspace_documents' AND entity_id=?", String(doc.id));
    const move = await patchDocument(db, owner, workspaceId, doc.id, { horse_id: horseB, title: "Passport tracker", category: "registration", expected_version: docAfterSame.row_version });
    expect(move.status).toBe(409);
    const moveError = await readError(move);
    expect(moveError.error?.code).toBe("document_horse_immutable");
    expect(moveError.error?.details?.stored_horse_id).toBe(horseA);
    expect(moveError.error?.message).toContain("fixed");

    // No mutation anywhere: version, note, title, association and audit count are all unchanged.
    const afterMove = await call(db, authedRequest(`/api/workspaces/${workspaceId}/documents`, undefined, { session: owner }));
    const docAfterMove = ((await afterMove.json()) as { rows: Array<{ id: number; horse_id: number | null; row_version: number; title: string; note: string | null }> }).rows[0];
    expect(docAfterMove.horse_id).toBe(horseA);
    expect(docAfterMove.row_version).toBe(docAfterSame.row_version);
    expect(docAfterMove.note).toBe("updated note");
    expect(docAfterMove.title).toBe("Passport tracker");
    const auditsAfter = await scalar(db, "audit_events WHERE entity_type='workspace_documents' AND entity_id=?", String(doc.id));
    expect(auditsAfter).toBe(auditsBefore);

    // Clearing the association (null) is equally immutable.
    const clear = await patchDocument(db, owner, workspaceId, doc.id, { horse_id: null, title: "Passport tracker", category: "registration", expected_version: docAfterSame.row_version });
    expect(clear.status).toBe(409);
    expect((await readError(clear)).error?.code).toBe("document_horse_immutable");

    // Omitting horse_id entirely updates the writable fields normally.
    const plainUpdate = await patchDocument(db, owner, workspaceId, doc.id, { title: "Passport tracker v2", category: "registration", expected_version: docAfterSame.row_version });
    expect(plainUpdate.status).toBe(200);
    const afterPlain = await call(db, authedRequest(`/api/workspaces/${workspaceId}/documents`, undefined, { session: owner }));
    const docAfterPlain = ((await afterPlain.json()) as { rows: Array<{ id: number; horse_id: number | null; row_version: number; title: string }> }).rows[0];
    expect(docAfterPlain.title).toBe("Passport tracker v2");
    expect(docAfterPlain.horse_id).toBe(horseA);
    expect(docAfterPlain.row_version).toBe(docAfterSame.row_version + 1);
  });

  it("a document for a NON-member horse is refused at create; expected-version conflicts, archived rows and permission boundaries still hold", async () => {
    const db = await openRealDatabase();
    const { owner, viewer, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "R108-08 boundaries");
    const { horseA } = await seedHerd(db, workspaceId, owner);

    // Non-member horse at CREATE is a bounded 404 (existing semantics, re-pinned).
    await db.exec(`INSERT INTO horses(id,name_latin,is_active,deleted_at) VALUES (999,'NOT A MEMBER',1,NULL);`);
    const nonMember = await createDocument(db, owner, workspaceId, { horse_id: 999, title: "Stranger file", category: "other" });
    expect(nonMember.status).toBe(404);
    expect((await readError(nonMember)).error?.code).toBe("horse_not_in_workspace");

    const created = await createDocument(db, owner, workspaceId, { horse_id: horseA, title: "Insurance file", category: "insurance" });
    expect(created.status).toBe(201);
    const listed = ((await (await call(db, authedRequest(`/api/workspaces/${workspaceId}/documents`, undefined, { session: owner }))).json()) as { rows: Array<{ id: number; row_version: number }> }).rows;
    expect(listed).toHaveLength(1);
    const doc = listed[0];

    // Stale expected_version is an honest conflict carrying the current version.
    const stale = await patchDocument(db, owner, workspaceId, doc.id, { title: "Insurance file v2", category: "insurance", expected_version: doc.row_version + 5 });
    expect(stale.status).toBe(409);
    const staleError = await readError(stale);
    expect(staleError.error?.code).toBe("document_version_conflict");
    expect(staleError.error?.details?.current_version).toBe(doc.row_version);

    // A viewer-only principal cannot update (server-driven authority).
    await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "viewer-1", actions: "view" }, { session: owner }));
    const viewerUpdate = await patchDocument(db, viewer, workspaceId, doc.id, { title: "viewer edit", category: "insurance", expected_version: doc.row_version });
    expect(viewerUpdate.status).toBe(404); // disclosure-free: a view-only caller does not hold tasks_manage authority

    // An outsider learns nothing: disclosure-free 404.
    const outsiderUpdate = await patchDocument(db, outsider, workspaceId, doc.id, { title: "outsider edit", category: "insurance", expected_version: doc.row_version });
    expect(outsiderUpdate.status).toBe(404);
    expect((await readError(outsiderUpdate)).error?.code).toBe("not_found");

    // Archived documents are read-only history.
    const archived = await call(db, authedRequest(`/api/workspaces/${workspaceId}/documents/${doc.id}/archive`, {}, { session: owner }));
    expect(archived.status).toBe(200);
    const archivedUpdate = await patchDocument(db, owner, workspaceId, doc.id, { title: "edit after archive", category: "insurance", expected_version: doc.row_version });
    expect(archivedUpdate.status).toBe(409);
    expect((await readError(archivedUpdate)).error?.code).toBe("document_archived");
  });
});

// ---------------------------------------------------------------------------
// B. Import receipts and same-intent replay through the real routes
// ---------------------------------------------------------------------------

describe("R108-08 B. task import receipts: same-intent replay reconciles to exact accepted rows", () => {
  it("an interrupted import replays with the SAME intent_key: previously accepted rows report already_imported and are never re-executed or duplicated", async () => {
    const db = await openRealDatabase();
    const { owner } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "R108-08 import herd");

    // Attempt 1: the client's import is interrupted after two rows landed.
    const intentKey = "r108-08-intent-alpha-1";
    const first = await importTasks(db, owner, workspaceId, {
      intent_key: intentKey,
      tasks: [
        { title: "Farrier round A", category: "farrier", due_date: "2026-11-01" },
        { title: "Vet visit A", category: "veterinary_appointment", due_date: "2026-11-02" },
      ],
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { imported: number; accepted: number; already_imported: number; intent_key: string | null; receipts: Array<{ title: string; status: string; task_id: number | null }> };
    expect(firstBody.imported).toBe(2);
    expect(firstBody.accepted).toBe(2);
    expect(firstBody.already_imported).toBe(0);
    expect(firstBody.intent_key).toBe(intentKey);
    expect(firstBody.receipts.map((r) => r.status)).toEqual(["imported", "imported"]);
    const firstIds = firstBody.receipts.map((r) => r.task_id);
    expect(firstIds.every((id) => id != null && id > 0)).toBe(true);

    // The receipts point at real rows stamped with the durable intent.
    for (const taskId of firstIds) {
      const row = await db.prepare("SELECT import_intent_key FROM workspace_tasks WHERE id=?").bind(taskId).first<{ import_intent_key: string | null }>();
      expect(row?.import_intent_key).toBe(intentKey);
    }

    // Attempt 2 (the replay after interruption): the same two rows PLUS a third.
    const replay = await importTasks(db, owner, workspaceId, {
      intent_key: intentKey,
      tasks: [
        { title: "Farrier round A", category: "farrier", due_date: "2026-11-01" },
        { title: "Vet visit A", category: "veterinary_appointment", due_date: "2026-11-02" },
        { title: "Dentist A", category: "other", due_date: "2026-11-03" },
      ],
    });
    expect(replay.status).toBe(201);
    const replayBody = await replay.json() as { imported: number; skipped: number; accepted: number; already_imported: number; receipts: Array<{ title: string; status: string; task_id: number | null }> };
    expect(replayBody.imported).toBe(1);
    expect(replayBody.already_imported).toBe(2);
    expect(replayBody.accepted).toBe(3);
    expect(replayBody.skipped).toBe(0);
    const byTitle = new Map(replayBody.receipts.map((r) => [r.title, r]));
    expect(byTitle.get("Farrier round A")?.status).toBe("already_imported");
    expect(byTitle.get("Vet visit A")?.status).toBe("already_imported");
    expect(byTitle.get("Dentist A")?.status).toBe("imported");
    // The already-imported receipts point at the SAME task rows attempt 1 created.
    expect(byTitle.get("Farrier round A")?.task_id).toBe(firstIds[0]);
    expect(byTitle.get("Vet visit A")?.task_id).toBe(firstIds[1]);

    // Exactly three tasks exist — the replay duplicated NOTHING.
    expect(await scalar(db, "workspace_tasks WHERE collection_id=?", workspaceId)).toBe(3);
    // And the task_created audit fired exactly once per task — no replay audit.
    expect(await scalar(db, "audit_events WHERE action='workspace.task_created'")).toBe(3);
  });

  it("a pre-existing occurrence under a DIFFERENT intent keeps the honest occurrence_exists skip; the legacy no-intent path is unchanged", async () => {
    const db = await openRealDatabase();
    const { owner } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "R108-08 import honesty");

    // A manual/legacy import with NO intent key lands two rows.
    const legacy = await importTasks(db, owner, workspaceId, {
      tasks: [
        { title: "Farrier round B", category: "farrier", due_date: "2026-12-01" },
        { title: "Vet visit B", category: "veterinary_appointment", due_date: "2026-12-02" },
      ],
    });
    expect(legacy.status).toBe(201);
    const legacyBody = await legacy.json() as { imported: number; accepted: number; already_imported: number; intent_key: string | null; receipts: Array<{ status: string; task_id: number | null }> };
    expect(legacyBody.imported).toBe(2);
    expect(legacyBody.accepted).toBe(2);
    expect(legacyBody.intent_key).toBeNull();
    expect(legacyBody.receipts.every((r) => r.status === "imported")).toBe(true);

    // The same occurrences under a DIFFERENT intent are occurrence_exists skips,
    // never already_imported (that intent did not accept them).
    const differentIntent = await importTasks(db, owner, workspaceId, {
      intent_key: "r108-08-intent-beta-2",
      tasks: [
        { title: "Farrier round B", category: "farrier", due_date: "2026-12-01" },
        { title: "New row B", category: "other", due_date: "2026-12-03" },
      ],
    });
    expect(differentIntent.status).toBe(201);
    const differentBody = await differentIntent.json() as { imported: number; skipped: number; accepted: number; already_imported: number; receipts: Array<{ title: string; status: string }> };
    expect(differentBody.imported).toBe(1);
    expect(differentBody.skipped).toBe(1);
    expect(differentBody.already_imported).toBe(0);
    expect(differentBody.accepted).toBe(1);
    const statuses = new Map(differentBody.receipts.map((r) => [r.title, r.status]));
    expect(statuses.get("Farrier round B")).toBe("occurrence_exists");
    expect(statuses.get("New row B")).toBe("imported");

    // Re-importing the same rows with NO intent key keeps the legacy behavior:
    // honest occurrence_exists skips, receipts present, nothing overwritten.
    const legacyReplay = await importTasks(db, owner, workspaceId, {
      tasks: [{ title: "Farrier round B", category: "farrier", due_date: "2026-12-01" }],
    });
    const legacyReplayBody = await legacyReplay.json() as { imported: number; skipped: number; imported_titles: string[]; skipped_rows: Array<{ title: string; reason: string }>; receipts: Array<{ status: string }> };
    expect(legacyReplayBody.imported).toBe(0);
    expect(legacyReplayBody.skipped).toBe(1);
    expect(legacyReplayBody.skipped_rows[0].reason).toBe("occurrence_exists");
    expect(legacyReplayBody.receipts[0].status).toBe("occurrence_exists");

    // Exactly three tasks: two from the legacy import, one from the different intent.
    expect(await scalar(db, "workspace_tasks WHERE collection_id=?", workspaceId)).toBe(3);
    expect(await scalar(db, "audit_events WHERE action='workspace.task_created'")).toBe(3);
  });

  it("permission boundaries hold: a viewer cannot import and an outsider learns nothing", async () => {
    const db = await openRealDatabase();
    const { owner, viewer, outsider } = await world(db);
    const workspaceId = await createWorkspace(db, owner, "R108-08 import boundaries");

    await call(db, authedRequest(`/api/workspaces/${workspaceId}/staff`, { user_id: "viewer-1", actions: "view" }, { session: owner }));
    const row = { title: "Farrier round C", category: "farrier", due_date: "2026-11-05" };
    const viewerImport = await importTasks(db, viewer, workspaceId, { intent_key: "r108-08-intent-gamma", tasks: [row] });
    expect(viewerImport.status).toBe(404); // disclosure-free: a view-only caller does not hold tasks_manage authority
    const outsiderImport = await importTasks(db, outsider, workspaceId, { intent_key: "r108-08-intent-delta", tasks: [row] });
    expect(outsiderImport.status).toBe(404);
    expect((await readError(outsiderImport)).error?.code).toBe("not_found");
    // Nothing was written by either refusal.
    expect(await scalar(db, "workspace_tasks WHERE collection_id=?", workspaceId)).toBe(0);
  });
});
