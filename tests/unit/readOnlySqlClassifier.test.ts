import { describe, expect, it } from "vitest";
import { assertReadOnlySql, sqlMayWrite } from "../../src/db/sqlLex";

/**
 * R132 regression guards for the read-only SQL classifier.
 *
 * The Persian collation-key expression nests ~80 REPLACE(expr, a, b) string
 * functions. The classifier used to treat ANY `REPLACE` token as the mutating
 * SQLite "REPLACE INTO" statement, which misclassified every sort-by-name
 * browse query as a WRITE batch — and write batches never take the read
 * retry path. Combined with the (now removed) cross-request client pool,
 * this produced the intermittent browse 500s. These tests pin the
 * function-vs-statement distinction.
 */
describe("assertReadOnlySql REPLACE function vs statement", () => {
  it("allows the REPLACE string function inside expressions", () => {
    expect(() => assertReadOnlySql("SELECT REPLACE(name, 'a', 'b') FROM horses")).not.toThrow();
    expect(() => assertReadOnlySql("SELECT REPLACE (name, 'a', 'b') FROM horses")).not.toThrow();
    expect(() =>
      assertReadOnlySql(
        "SELECT COALESCE(NULLIF(LTRIM(REPLACE(REPLACE(REPLACE(name_native,'۰','0'),'۱','1'),'آ','01'))), name_latin) FROM horses ORDER BY 1",
      ),
    ).not.toThrow();
  });

  it("still blocks the REPLACE INTO statement form", () => {
    expect(() => assertReadOnlySql("REPLACE INTO horses(id) VALUES(1)")).toThrow();
    expect(() => assertReadOnlySql("WITH x AS (SELECT 1) REPLACE INTO horses(id) VALUES(1)")).toThrow();
  });

  it("keeps every other mutating keyword blocked", () => {
    for (const sql of [
      "SELECT 1; DELETE FROM horses",
      "SELECT 1; INSERT INTO horses(id) VALUES(1)",
      "SELECT 1; UPDATE horses SET name_latin='x'",
      "SELECT 1; DROP TABLE horses",
      "SELECT 1; CREATE TABLE evil(id int)",
      "SELECT 1; TRUNCATE horses",
      "SELECT 1; GRANT ALL ON horses TO public",
      "SELECT 1; CALL dangerous_proc()",
      "SELECT 1; DO $$ BEGIN END $$",
      "SELECT * FROM horses INTO outfile",
      "SELECT 1; LOCK TABLE horses",
    ]) {
      expect(() => assertReadOnlySql(sql), sql).toThrow();
    }
  });

  it("keeps plain reads allowed", () => {
    for (const sql of [
      "SELECT id FROM horses WHERE deleted_at IS NULL",
      "WITH RECURSIVE walk(id) AS (SELECT 1 UNION SELECT id+1 FROM walk) SELECT * FROM walk",
      "EXPLAIN SELECT 1",
    ]) {
      expect(() => assertReadOnlySql(sql), sql).not.toThrow();
    }
  });

  it("sqlMayWrite agrees with the classifier", () => {
    expect(sqlMayWrite("SELECT REPLACE(name, 'a', 'b') FROM horses ORDER BY REPLACE(name, 'x', 'y')")).toBe(false);
    expect(sqlMayWrite("REPLACE INTO horses(id) VALUES(1)")).toBe(true);
  });
});
