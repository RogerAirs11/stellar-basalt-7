import { describe, expect, it } from "vitest";
import { sqliteReadSqlToPostgres, sqliteSqlToPostgres } from "../../src/db/supabaseCompat";

describe("R113 PostgreSQL table-presence catalog compatibility", () => {
  it("projects table identity only from the current visible schema", () => {
    const translated = sqliteSqlToPostgres("SELECT * FROM sqlite_master WHERE type='table' AND name='horses'");
    expect(translated).toContain("information_schema.tables");
    expect(translated).toContain("table_schema = current_schema()");
    expect(translated).toContain("table_type = 'BASE TABLE'");
    expect(translated).toContain("table_name::text AS name");
    expect(translated).toContain("table_name::text AS tbl_name");
    // PostgreSQL has no SQLite b-tree root page or faithful SQLite CREATE SQL.
    expect(translated).toContain("NULL::bigint AS rootpage");
    expect(translated).toContain("NULL::text AS sql");
    expect(translated).toMatch(/WHERE type='table' AND name='horses'$/);
  });

  it("preserves the AI readiness name projection and numbered bind predicates", () => {
    const translated = sqliteSqlToPostgres("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?2,?1,?2)");
    expect(translated).toMatch(/^SELECT name FROM \(/);
    expect(translated).toMatch(/WHERE type='table' AND name IN \(\$2,\$1,\$2\)$/);
    expect(sqliteReadSqlToPostgres("SELECT name FROM sqlite_master WHERE type='table' AND name=?"))
      .toMatch(/WHERE type='table' AND name=\$1$/);
  });

  it("preserves quoted names containing question marks, escaped quotes and catalog-looking text", () => {
    const predicate = "WHERE type='table' AND name IN ('horse? ''FROM sqlite_master'' /* ? */',?)";
    const translated = sqliteSqlToPostgres(`SELECT name FROM sqlite_master ${predicate}`);
    expect(translated).toContain("information_schema.tables");
    expect(translated.endsWith(predicate.slice(0, -2) + "$1)")).toBe(true);
  });

  it("preserves comments at token boundaries without treating their text as SQL", () => {
    const translated = sqliteSqlToPostgres(
      "/* FROM sqlite_master ? */ SELECT/* projection */name FROM /* source ? */sqlite_master\n"
      + "WHERE type='table' AND name=/* bind ? */?; -- trailing FROM sqlite_master ?",
    );
    expect(translated).toMatch(/^\/\* FROM sqlite_master \? \*\/ SELECT\/\* projection \*\/name FROM \/\* source \? \*\/\(/);
    expect(translated).toContain("information_schema.tables");
    expect(translated).toMatch(/WHERE type='table' AND name=\/\* bind \? \*\/\$1; -- trailing FROM sqlite_master \?$/);
  });

  it("leaves catalog-looking literals and unrelated table names alone", () => {
    expect(sqliteSqlToPostgres("SELECT 'FROM sqlite_master ?' AS note, ? AS bound /* FROM sqlite_master */"))
      .toBe("SELECT 'FROM sqlite_master ?' AS note, $1 AS bound /* FROM sqlite_master */");
    expect(sqliteSqlToPostgres("SELECT name FROM sqlite_master_archive WHERE id=?"))
      .toBe("SELECT name FROM sqlite_master_archive WHERE id=$1");
  });

  it.each([
    "SELECT sql FROM sqlite_master WHERE name='uq_moderation_cases_active'",
    "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
    "SELECT * FROM sqlite_master",
    "SELECT name FROM public.sqlite_master WHERE type='table' AND name=?",
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?; SELECT name FROM horses",
  ])("refuses unsupported catalog projection or scope: %s", (query) => {
    expect(() => sqliteSqlToPostgres(query)).toThrow(/Unsupported sqlite_master query/);
  });
});
