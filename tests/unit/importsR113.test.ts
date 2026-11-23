import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { adminApplyImportBatch, adminStageImportBatch } from "../../src/api/modules/imports";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/** Real SQL and transactions; only scheduling/faults at the driver boundary are injected. */
function afterRead(db: D1Database, match: (sql: string) => boolean, callback: () => Promise<void>): D1Database {
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
        if (key === "first" || key === "all") return async (...args: unknown[]) => {
          const value = await (target[key] as (...values: unknown[]) => Promise<unknown>).apply(target, args);
          await callback();
          return value;
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  return { ...db, prepare(sql: string) { const statement = db.prepare(sql); return match(sql) ? wrap(statement) : statement; } } as D1Database;
}

function twoReaders() {
  let count = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return async () => { if (++count === 2) release(); await ready; };
}

describe("R113 import transaction and retry boundaries", () => {
  let db: D1Database;
  let a: AuthedSession;
  let b: AuthedSession;
  const body = (suffix = "a") => ({
    source_id: 1, file_name: `audit-${suffix}.json`, mapping_version: "v1",
    rows: [{ external_id: suffix, register_no: `R113-${suffix}`, name_latin: `Audit ${suffix}` }],
  });
  const env = (database = db) => ({ DB: database, SESSION_COOKIE_NAME: "hr_session" });
  const stage = (payload = body(), database = db, session = a) => adminStageImportBatch(
    authedRequest("/api/admin/imports/stage", payload, { session }), env(database),
  );
  const apply = (id: number, database = db, session = a) => adminApplyImportBatch(
    authedRequest(`/api/admin/imports/batches/${id}/apply`, {}, { session }), env(database), id,
  );
  const number = async (sql: string) => Number(await db.prepare(sql).first("n"));

  beforeEach(async () => {
    db = await openRealDatabase();
    await seedUser(db, "r113-editor-a", "editor");
    await seedUser(db, "r113-editor-b", "editor");
    a = await makeSession(db, "r113-editor-a");
    b = await makeSession(db, "r113-editor-b");
    await db.prepare("INSERT INTO import_sources(id,name,issuer_namespace,scope_note,is_synthetic) VALUES(1,'Disposable R113 audit','registry:r113','In-memory test fixture only',0)").run();
  });

  it("rolls back the header and every row if staging fails, then safely retries the same file", async () => {
    const payload = { ...body(), rows: [...body().rows, ...body("interrupt").rows] };
    await db.exec("CREATE TRIGGER r113_fail_stage BEFORE INSERT ON import_staging_rows WHEN NEW.external_id='interrupt' BEGIN SELECT RAISE(ABORT,'injected row fault'); END;");
    await expect(stage(payload)).rejects.toBeDefined();
    expect(await number("SELECT COUNT(*) n FROM import_batches")).toBe(0);
    expect(await number("SELECT COUNT(*) n FROM import_staging_rows")).toBe(0);
    await db.exec("DROP TRIGGER r113_fail_stage;");
    const response = await stage(payload);
    expect(response.status).toBe(201);
    expect(await number("SELECT COUNT(*) n FROM import_batches")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM import_staging_rows")).toBe(2);
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(0);
  });

  it("returns one durable batch for simultaneous staging of identical content", async () => {
    const racing = afterRead(db, sql => sql.includes("FROM import_batches WHERE source_id=? AND file_sha256=?"), twoReaders());
    const results = await Promise.all([stage(body(), racing, a), stage(body(), racing, b)]);
    const replies = await Promise.all(results.map(response => response.json())) as Array<{ batch: { id: number } }>;
    expect(new Set(replies.map(reply => reply.batch.id)).size).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM import_batches")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM import_staging_rows")).toBe(1);
  });

  it("does not turn a successful apply into a conflict when two callers read the same pending row", async () => {
    const staged = await (await stage()).json() as { batch: { id: number } };
    const racing = afterRead(db, sql => /^\s*SELECT id,external_id/.test(sql) && sql.includes("outcome='pending'"), twoReaders());
    await Promise.all([apply(staged.batch.id, racing, a), apply(staged.batch.id, racing, b)]);
    expect(await db.prepare("SELECT outcome,outcome_detail FROM import_staging_rows").first()).toEqual({ outcome: "applied_create", outcome_detail: null });
    expect(await db.prepare("SELECT status,rows_created,rows_conflict FROM import_batches").first()).toEqual({ status: "completed", rows_created: 1, rows_conflict: 0 });
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM audit_events WHERE action='import.horse.created'")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM horse_search_reindex_queue")).toBe(1);
  });

  it("retains a real conflict when separate batches race to claim the same identifier", async () => {
    const one = await (await stage()).json() as { batch: { id: number } };
    const two = await (await stage({ ...body("b"), rows: [{ ...body().rows[0], external_id: "another-source-row", name_latin: "Different source assertion" }] })).json() as { batch: { id: number } };
    const racing = afterRead(db, sql => /^\s*SELECT id,external_id/.test(sql) && sql.includes("outcome='pending'"), twoReaders());
    await Promise.all([apply(one.batch.id, racing, a), apply(two.batch.id, racing, b)]);
    expect((await db.prepare("SELECT outcome FROM import_staging_rows ORDER BY outcome").all()).results).toEqual([{ outcome: "applied_create" }, { outcome: "conflict" }]);
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM horse_identifiers WHERE status='live'")).toBe(1);
  });

  it("recovers after the database commits but its apply acknowledgement is lost", async () => {
    const staged = await (await stage()).json() as { batch: { id: number } };
    let inject = true;
    const uncertain = { ...db, async batch(statements: D1PreparedStatement[]) {
      const result = await db.batch(statements);
      if (inject) { inject = false; throw new Error("Injected acknowledgement loss after commit"); }
      return result;
    } } as D1Database;
    await expect(apply(staged.batch.id, uncertain)).rejects.toBeDefined();
    await apply(staged.batch.id);
    expect(await db.prepare("SELECT outcome FROM import_staging_rows").first("outcome")).toBe("applied_create");
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(1);
    expect(await number("SELECT COUNT(*) n FROM audit_events WHERE action='import.horse.created'")).toBe(1);
  });

  it("refuses an old incomplete stage instead of falsely completing an empty import", async () => {
    const staged = await (await stage()).json() as { batch: { id: number } };
    await db.prepare("DELETE FROM import_staging_rows WHERE batch_id=?").bind(staged.batch.id).run();
    await expect(apply(staged.batch.id)).rejects.toMatchObject({ status: 409, code: "incomplete_import_batch" });
    await expect(stage()).rejects.toMatchObject({ status: 409, code: "incomplete_import_batch" });
    expect(await db.prepare("SELECT status FROM import_batches").first("status")).toBe("staged");
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(0);
  });

  it("does not record applied_update when the staged horse was archived before apply", async () => {
    await db.prepare("INSERT INTO horses(id,register_no,name_latin) VALUES(101,'R113-a','Existing horse')").run();
    await db.prepare("INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status) VALUES('register_no','registry:r113','R113-a','R113-a',101,'live')").run();
    const staged = await (await stage()).json() as { batch: { id: number } };
    await db.prepare("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=101").run();
    const reply = await (await apply(staged.batch.id)).json() as { batch: { rows_updated: number; rows_skipped: number } };
    expect(await db.prepare("SELECT outcome FROM import_staging_rows").first("outcome")).toBe("skipped");
    expect(reply.batch).toMatchObject({ rows_updated: 0, rows_skipped: 1 });
  });

  it("rechecks editor authority at apply time after preflight", async () => {
    const staged = await (await stage()).json() as { batch: { id: number } };
    let inject = true;
    const revoked = { ...db, async batch(statements: D1PreparedStatement[]) {
      if (inject) { inject = false; await db.prepare("UPDATE users SET role='user' WHERE id=?").bind(a.userId).run(); }
      return db.batch(statements);
    } } as D1Database;
    await expect(apply(staged.batch.id, revoked)).rejects.toMatchObject({ status: 403 });
    expect(await number("SELECT COUNT(*) n FROM horses")).toBe(0);
    expect(await db.prepare("SELECT outcome FROM import_staging_rows").first("outcome")).toBe("pending");
  });
});
