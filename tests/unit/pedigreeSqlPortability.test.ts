import { describe, expect, it } from "vitest";
import { ANCESTOR_GRAPH_SQL } from "../../src/pedigree/engine";
import { DESCENDANT_GRAPH_SQL } from "../../src/pedigree/graph";
import { sqliteSqlToPostgres } from "../../src/db/sqliteSqlToPostgres";

/**
 * R132 regression guards for the recursive-CTE pedigree loaders. Both queries
 * passed the SQLite suite but FAILED on the live PostgreSQL in two
 * engine-specific ways; these tests pin the portable shapes so neither can
 * silently regress:
 *
 *  1. PostgreSQL: a JOIN's ON clause may only reference relations joined to
 *     its LEFT. The ancestor walk's `side` relation must therefore be CROSS
 *     JOINed BEFORE the `par` join whose ON uses side.k ("missing
 *     FROM-clause entry for table side" was the live 500).
 *  2. PostgreSQL: LIMIT inside a recursive CTE is not implemented — the
 *     descendant walk's row budget lives on the OUTER select only.
 *  3. Both engines: the recursive reference may appear exactly once in the
 *     recursive term (single-branch form, R120 precedent).
 */

const recursiveTerm = (sql: string) => {
  const match = /UNION\s+([\s\S]*?)\)\s*SELECT/.exec(sql);
  if (!match) throw new Error("could not isolate the recursive term");
  return match[1]!;
};

describe("ancestor graph SQL portability", () => {
  it("joins the side table before the parent join that references it", () => {
    const term = recursiveTerm(ANCESTOR_GRAPH_SQL);
    const sideAt = term.indexOf("CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) side");
    const parAt = term.indexOf("JOIN horses par ON par.id = CASE WHEN side.k");
    expect(sideAt).toBeGreaterThan(-1);
    expect(parAt).toBeGreaterThan(sideAt);
  });

  it("references the recursive table exactly once in the recursive term", () => {
    const term = recursiveTerm(ANCESTOR_GRAPH_SQL);
    expect(term.match(/\bwalk\b/g)?.length).toBe(1);
  });

  it("translates cleanly through the production SQLite→PG translator", () => {
    const translated = sqliteSqlToPostgres(ANCESTOR_GRAPH_SQL);
    expect(translated).toContain("$1");
    expect(translated).toContain("$2");
    // The scope-sensitive join order must survive translation untouched.
    const sideAt = translated.indexOf("CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) side");
    const parAt = translated.indexOf("JOIN horses par ON par.id = CASE WHEN side.k");
    expect(sideAt).toBeGreaterThan(-1);
    expect(parAt).toBeGreaterThan(sideAt);
  });
});

describe("descendant graph SQL portability", () => {
  it("keeps LIMIT out of the recursive CTE (PostgreSQL does not implement it there)", () => {
    const cte = /WITH RECURSIVE walk\(id, depth\) AS \(([\s\S]*?)\n    \)\s*\n\s*SELECT/.exec(DESCENDANT_GRAPH_SQL)?.[1];
    expect(cte).toBeDefined();
    expect(/LIMIT/i.test(cte!)).toBe(false);
  });

  it("carries the row budget on the outer select", () => {
    expect(DESCENDANT_GRAPH_SQL.trimEnd().endsWith("LIMIT ?")).toBe(true);
  });

  it("references the recursive table exactly once in the recursive term", () => {
    const term = recursiveTerm(DESCENDANT_GRAPH_SQL);
    expect(term.match(/\bwalk\b/g)?.length).toBe(1);
  });

  it("translates cleanly through the production SQLite→PG translator", () => {
    const translated = sqliteSqlToPostgres(DESCENDANT_GRAPH_SQL);
    expect(translated).toContain("$1");
    expect(translated).toContain("$2");
    expect(translated).toContain("$3");
    const cte = /WITH RECURSIVE walk\(id, depth\) AS \(([\s\S]*?)\n    \)\s*\n\s*SELECT/.exec(translated)?.[1];
    expect(/LIMIT/i.test(cte!)).toBe(false);
  });
});
