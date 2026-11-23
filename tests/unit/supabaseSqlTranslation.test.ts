import { describe, expect, it } from "vitest";
import { sqliteSqlToPostgres, createSupabaseD1Database, __resetSupabaseAdapterCachesForTests } from "../../src/db/supabaseCompat";

describe("sqliteSqlToPostgres — dialect translation (R59)", () => {
  it("rewrites ? placeholders to $n", () => {
    expect(sqliteSqlToPostgres("SELECT id FROM horses WHERE id = ? AND name_latin = ?")).toBe(
      "SELECT id FROM horses WHERE id = $1 AND name_latin = $2",
    );
  });

  it("does not rewrite ? inside string literals", () => {
    expect(sqliteSqlToPostgres("SELECT 'a?b' AS x WHERE id = ?")).toBe("SELECT 'a?b' AS x WHERE id = $1");
  });

  it("translates datetime('now', ?) with a bound modifier into a UTC text expression", () => {
    const out = sqliteSqlToPostgres("SELECT COUNT(*) AS n FROM t WHERE created_at > datetime('now','-10 minutes')");
    expect(out).toContain("created_at > to_char((now() AT TIME ZONE 'UTC' + '-10 minutes'::interval), 'YYYY-MM-DD HH24:MI:SS')");
  });

  it("translates datetime('now') with no modifier", () => {
    expect(sqliteSqlToPostgres("SELECT datetime('now') AS now_text")).toBe(
      "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS now_text",
    );
  });

  it("translates datetime(column) for text-column comparisons", () => {
    const out = sqliteSqlToPostgres("SELECT id FROM sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP");
    expect(out).toContain("to_char((expires_at)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') <= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
  });

  it("translates CURRENT_TIMESTAMP to SQLite's UTC text form everywhere", () => {
    const out = sqliteSqlToPostgres("UPDATE t SET updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    expect(out).toBe(
      "UPDATE t SET updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
    );
  });

  it("maps INSERT OR IGNORE onto ON CONFLICT DO NOTHING", () => {
    const out = sqliteSqlToPostgres("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) VALUES(?,?)");
    expect(out).toMatch(/^INSERT INTO horse_search_reindex_queue\(horse_id,reason\) VALUES\(\$1,\$2\)/);
    expect(out).toMatch(/ON CONFLICT DO NOTHING$/);
  });

  it("keeps an existing explicit ON CONFLICT and does not add DO NOTHING", () => {
    const out = sqliteSqlToPostgres(
      "INSERT INTO ai_conversations(id,locale) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET locale=excluded.locale",
    );
    expect(out).toContain("ON CONFLICT(id) DO UPDATE");
    expect(out).not.toContain("DO NOTHING");
  });

  it("turns LIKE into ILIKE and strips COLLATE NOCASE", () => {
    expect(sqliteSqlToPostgres("SELECT id FROM horses WHERE name_latin LIKE ? COLLATE NOCASE LIMIT 100")).toBe(
      "SELECT id FROM horses WHERE name_latin ILIKE $1 LIMIT 100",
    );
    expect(sqliteSqlToPostgres("SELECT id FROM t WHERE a LIKE ? OR b LIKE ? ESCAPE '\\'")).toBe(
      "SELECT id FROM t WHERE a ILIKE $1 OR b ILIKE $2 ESCAPE '\\'",
    );
  });

  it("translates group_concat to string_agg with matching separators", () => {
    const one = sqliteSqlToPostgres("SELECT group_concat(alias) FROM horse_aliases WHERE horse_id=?");
    expect(one).toContain("string_agg(alias, ',')");
    const two = sqliteSqlToPostgres(
      "SELECT group_concat(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')),' ') FROM horse_people hp",
    );
    expect(two).toContain("string_agg(trim(COALESCE(p.name_latin,'') || ' ' || COALESCE(p.name_native,'')), ' ')");
  });

  it("preserves explicitly case-insensitive email equality", () => {
    const out = sqliteSqlToPostgres("SELECT id FROM users WHERE email = ? COLLATE NOCASE");
    expect(out).toBe("SELECT id FROM users WHERE LOWER(email)=LOWER($1)");
  });
});

// ---------------------------------------------------------------------------
// Live integration — runs only when SUPABASE_DATABASE_URL is present (this
// sandbox / local). CI skips. Exercises the real adapter against real Postgres
// using a dedicated throwaway table.
// ---------------------------------------------------------------------------
const SUPA_URL = process.env.SUPABASE_DATABASE_URL;
const d = SUPA_URL ? describe : describe.skip;

const makeDb = () => createSupabaseD1Database(SUPA_URL!, { mode: "full" });

d("supabase full-mode adapter (live Postgres)", () => {
  const TEST_TABLE = "__r59_adapter_test";

  it("runs reads through the translated surface", async () => {
    const db = makeDb();
    const row = await db.prepare("SELECT COUNT(*) AS count FROM horses WHERE deleted_at IS NULL").first<{ count: number }>();
    expect(Number(row?.count ?? 0)).toBeGreaterThan(70000);
  });

  it("supports writes, last_row_id and transactions atomically", async () => {
    const db = makeDb();
    await db.prepare(`DROP TABLE IF EXISTS "${TEST_TABLE}"`).run();
    __resetSupabaseAdapterCachesForTests();
    await db.prepare(`CREATE TABLE "${TEST_TABLE}" (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name text NOT NULL, created_at text NOT NULL DEFAULT 'x')`).run();
    try {
      const insert = await db.prepare(`INSERT INTO "${TEST_TABLE}"(name) VALUES(?)`).bind("first").run();
      expect(insert.meta.last_row_id).toBeGreaterThan(0);
      expect(insert.meta.changes).toBe(1);

      // datetime('now', ?) comparison against a text column
      await db.prepare(`INSERT INTO "${TEST_TABLE}"(name,created_at) VALUES('old', datetime('now','-10 minutes'))`).run();
      const old = await db.prepare(`SELECT COUNT(*) AS n FROM "${TEST_TABLE}" WHERE created_at < datetime('now','-5 minutes')`).first<{ n: number }>();
      expect(Number(old?.n ?? 0)).toBe(1);

      // LIKE case-insensitivity
      await db.prepare(`INSERT INTO "${TEST_TABLE}"(name) VALUES('CaSeTeSt')`).run();
      const ci = await db.prepare(`SELECT COUNT(*) AS n FROM "${TEST_TABLE}" WHERE name LIKE ?`).bind("casetest%").first<{ n: number }>();
      expect(Number(ci?.n ?? 0)).toBe(1);

      // batch atomicity: second statement fails -> first must roll back
      const before = await db.prepare(`SELECT COUNT(*) AS n FROM "${TEST_TABLE}"`).first<{ n: number }>();
      await expect(
        db.batch([
          db.prepare(`INSERT INTO "${TEST_TABLE}"(name) VALUES('doomed')`),
          db.prepare(`INSERT INTO "${TEST_TABLE}"(name,created_at) VALUES('bad','not-a-timestamp-x')`).bind(),
          // force a failure with a violation on a NOT NULL column
          db.prepare(`UPDATE "${TEST_TABLE}" SET name=NULL WHERE name='first'`),
        ]),
      ).rejects.toThrow();
      const after = await db.prepare(`SELECT COUNT(*) AS n FROM "${TEST_TABLE}"`).first<{ n: number }>();
      expect(Number(after?.n ?? -1)).toBe(Number(before?.n ?? -2));

      // INSERT OR IGNORE
      const ignored = await db.prepare(`INSERT OR IGNORE INTO "${TEST_TABLE}"(id,name) VALUES(1,'dup')`).run();
      expect(ignored.meta.changes).toBe(0);
    } finally {
      await db.prepare(`DROP TABLE IF EXISTS "${TEST_TABLE}"`).run();
    }
  });

  it("read-mode adapter still rejects writes", async () => {
    const readOnly = createSupabaseD1Database(SUPA_URL!, { mode: "read" });
    await expect(readOnly.prepare(`UPDATE horses SET name_latin='x' WHERE id=1`).run()).rejects.toThrow(/read-only/);
    await expect(readOnly.prepare(`SELECT * FROM sqlite_master WHERE type='table' AND name='horses'`).first()).resolves.toEqual(
      expect.objectContaining({ name: "horses" }),
    );
  });
});

describe("sqliteSqlToPostgres — R74 conditioned review mutations", () => {
  it("maps INSERT OR IGNORE ... SELECT ... WHERE EXISTS onto ON CONFLICT DO NOTHING (claim owner link)", () => {
    const out = sqliteSqlToPostgres(
      "INSERT OR IGNORE INTO horse_people(horse_id,person_id,role,is_current,created_at)\n  SELECT ?,?,'owner',1,CURRENT_TIMESTAMP\n  WHERE EXISTS(SELECT 1 FROM horse_claims WHERE id=? AND status='approved' AND reviewed_by_user_id=?)",
    );
    expect(out).toMatch(/^INSERT INTO horse_people\(horse_id,person_id,role,is_current,created_at\)/);
    expect(out).toContain("WHERE EXISTS(SELECT 1 FROM horse_claims WHERE id=$3 AND status='approved' AND reviewed_by_user_id=$4)");
    expect(out).toMatch(/ON CONFLICT DO NOTHING$/);
  });

  it("keeps the version guard and decision precondition intact in the horse update translation", () => {
    const out = sqliteSqlToPostgres(
      "UPDATE horses SET name_latin=?,updated_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_mutation_id=?\n  WHERE id=? AND deleted_at IS NULL AND row_version=?\n  AND EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))",
    );
    expect(out).toContain("WHERE id=$3 AND deleted_at IS NULL AND row_version=$4");
    expect(out).toContain("AND EXISTS(SELECT 1 FROM change_requests WHERE id=$5 AND status IN ('pending','draft'))");
    expect(out).toContain("row_version=row_version+1");
  });
});

describe("sqliteSqlToPostgres — T07/T08/T09 registry mutation statements", () => {
  it("translates the identifier supersede + conditional insert pair", () => {
    const supersede = sqliteSqlToPostgres(
      "UPDATE horse_identifiers SET status='superseded',updated_at=CURRENT_TIMESTAMP\n        WHERE horse_id=? AND kind=? AND status='live'\n        AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)",
    );
    expect(supersede).toContain("WHERE horse_id=$1 AND kind=$2 AND status='live'");
    expect(supersede).toContain("AND EXISTS(SELECT 1 FROM horses WHERE id=$3 AND last_mutation_id=$4)");
    expect(supersede).toContain("to_char(now() AT TIME ZONE 'UTC'");

    const insert = sqliteSqlToPostgres(
      "INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id,created_at,updated_at)\n        SELECT ?,?,?,?,?,'live',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\n        WHERE EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)",
    );
    expect(insert).toMatch(/^INSERT INTO horse_identifiers\(/);
    expect(insert).toContain("SELECT $1,$2,$3,$4,$5,'live',$6");
    // created_at/updated_at come from CURRENT_TIMESTAMP -> UTC text (no DDL defaults on Postgres)
    expect(insert).toContain("'live',$6,to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
    expect(insert).toContain("WHERE EXISTS(SELECT 1 FROM horses WHERE id=$7 AND last_mutation_id=$8)");
    expect(insert).not.toContain(" ON CONFLICT DO NOTHING");
  });

  it("translates the child reindex fan-out from the shared mutation builder", () => {
    const out = sqliteSqlToPostgres(
      "INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason)\n          SELECT child.id,'parent_name_changed' FROM horses child\n          WHERE child.deleted_at IS NULL AND (child.father_id=? OR child.mother_id=?)\n            AND EXISTS(SELECT 1 FROM horses changed WHERE changed.id=? AND changed.last_mutation_id=?)",
    );
    expect(out).toMatch(/^INSERT INTO horse_search_reindex_queue\(/);
    expect(out).toContain("(child.father_id=$1 OR child.mother_id=$2)");
    expect(out).toMatch(/ON CONFLICT DO NOTHING$/);
  });

  it("translates the admin observability reads without sqlite-only functions", () => {
    const oldest = sqliteSqlToPostgres("SELECT MIN(queued_at) AS oldest FROM horse_search_reindex_queue");
    expect(oldest).toBe("SELECT MIN(queued_at) AS oldest FROM horse_search_reindex_queue");
    const failed = sqliteSqlToPostgres("SELECT COUNT(*) AS count FROM canonical_mutation_log WHERE last_error IS NOT NULL AND updated_at >= datetime('now','-7 days')");
    expect(failed).toContain("to_char((now() AT TIME ZONE 'UTC' + '-7 days'::interval)");
  });

  it("translates the duplicate-holder lookup used by 409 duplicate_identifier", () => {
    const out = sqliteSqlToPostgres(
      "SELECT h.id,h.name_latin,h.name_native FROM horse_identifiers i JOIN horses h ON h.id=i.horse_id\n       WHERE i.kind=? AND i.issuer_namespace=? AND i.normalized_value=? AND i.status='live' AND h.deleted_at IS NULL LIMIT 1",
    );
    expect(out).toContain("WHERE i.kind=$1 AND i.issuer_namespace=$2 AND i.normalized_value=$3");
    expect(out).toContain("LIMIT 1");
  });
});
