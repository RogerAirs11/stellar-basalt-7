import { describe, expect, it } from "vitest";
import {
  duplicateIdentifierHttpError,
  IDENTIFIER_KIND_NAMESPACES,
  identifierKindForField,
  identifierStatementsForHorseChange,
  isDuplicateIdentifierError,
  isMissingIdentifierTableError,
  normalizeIdentifierValue,
  ARCHIVE_IDENTIFIER_STATEMENT_SQL,
} from "../../src/registry/identifiers";

/**
 * Master-Ai plan T08: identifier integrity at commit time. Persian/Arabic
 * digits normalize, leading zeros survive, registry numbers are issuer-scoped,
 * and DB constraint failures translate into safe 409 duplicate_identifier.
 */

interface BoundStatement {
  sql: string;
  args: unknown[];
}

function statementCollector() {
  const statements: BoundStatement[] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const builder = {
        get bound(): BoundStatement {
          return { sql, args };
        },
        bind(...bindArgs: unknown[]) {
          args = bindArgs;
          return builder;
        },
      };
      return builder;
    },
    record(statement: { bound?: BoundStatement }) {
      statements.push(statement.bound!);
    },
  };
  return { db, statements };
}

describe("normalizeIdentifierValue (T08)", () => {
  it("converts Persian and Arabic-Indic digits to ASCII but preserves leading zeros", () => {
    expect(normalizeIdentifierValue("۱۲۳۴۵")).toBe("12345");
    expect(normalizeIdentifierValue("٠٩٨")).toBe("098");
    expect(normalizeIdentifierValue("007")).toBe("007");
    expect(normalizeIdentifierValue("007")).not.toBe("7");
  });

  it("trims and collapses whitespace but keeps inner separators intact", () => {
    expect(normalizeIdentifierValue("  IR- 123 456  ")).toBe("IR- 123 456");
    expect(normalizeIdentifierValue("")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeIdentifierValue(" ۴۲۰۰-A ");
    expect(normalizeIdentifierValue(once)).toBe(once);
  });
});

describe("identifier namespaces and kinds (T08)", () => {
  it("maps the editable identity fields to their identifier kinds", () => {
    expect(identifierKindForField("register_no")).toBe("register_no");
    expect(identifierKindForField("microchip_no")).toBe("microchip_no");
    expect(identifierKindForField("name_latin")).toBeNull();
    expect(identifierKindForField("father_id")).toBeNull();
  });

  it("scopes registry numbers to the platform issuer namespace and microchips globally", () => {
    expect(IDENTIFIER_KIND_NAMESPACES.register_no).toBe("registry:platform");
    expect(IDENTIFIER_KIND_NAMESPACES.microchip_no).toBe("microchip");
  });
});

describe("identifierStatementsForHorseChange (T08)", () => {
  it("supersedes the previous live row and inserts a fresh live row in the same batch", () => {
    const { db, statements } = statementCollector();
    const produced = identifierStatementsForHorseChange(db as never, {
      horseId: 12,
      mutationId: "mut-1",
      source: "direct_edit",
      changes: { register_no: "  100۲۰  " },
      identifierTableReady: true,
    });
    for (const statement of produced) db.record(statement as never);
    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("UPDATE horse_identifiers SET status='superseded'");
    expect(sql).toContain("INSERT INTO horse_identifiers");
    expect(sql).toContain("status='live'");
    // conditioned on the canonical write having landed in the same batch
    expect(sql).toContain("last_mutation_id=?");
    // normalized value is bound, not the raw whitespace-padded input
    const insert = statements.find((statement) => statement.sql.startsWith("INSERT INTO horse_identifiers"));
    expect(insert?.args).toContain("10020");
    expect(insert?.args).toContain("registry:platform");
    expect(insert?.args).toContain("100۲۰"); // raw value preserved for history
  });

  it("refuses identifier writes when the integrity table is unavailable", () => {
    const { db } = statementCollector();
    expect(() => identifierStatementsForHorseChange(db as never, {
      horseId: 12, mutationId: "mut-1", source: "direct_edit",
      changes: { register_no: "100" }, identifierTableReady: false,
    })).toThrow(/identifier integrity/);
  });

  it("only supersedes (no insert) when a value is cleared to null", () => {
    const { db, statements } = statementCollector();
    const produced = identifierStatementsForHorseChange(db as never, {
      horseId: 12,
      mutationId: "mut-1",
      source: "direct_edit",
      changes: { microchip_no: null },
      identifierTableReady: true,
    });
    for (const statement of produced) db.record(statement as never);
    expect(statements.some((statement) => statement.sql.startsWith("INSERT INTO horse_identifiers"))).toBe(false);
    expect(statements.some((statement) => statement.sql.startsWith("UPDATE horse_identifiers"))).toBe(true);
  });

  it("ignores fields that are not identity fields", () => {
    const { db } = statementCollector();
    const produced = identifierStatementsForHorseChange(db as never, {
      horseId: 12,
      mutationId: "mut-1",
      source: "direct_edit",
      changes: { name_latin: "New Name", birth_year: 2010 },
      identifierTableReady: true,
    });
    expect(produced).toEqual([]);
  });

  it("offers an archive statement that retires live identifiers with the horse", () => {
    expect(ARCHIVE_IDENTIFIER_STATEMENT_SQL).toContain("status='archived'");
    expect(ARCHIVE_IDENTIFIER_STATEMENT_SQL).toContain("last_mutation_id=?");
  });
});

describe("constraint failure translation (T08)", () => {
  it("recognizes missing-table failures on both SQLite and Postgres dialects", () => {
    expect(isMissingIdentifierTableError(new Error('no such table: horse_identifiers'))).toBe(true);
    expect(isMissingIdentifierTableError(new Error('relation "horse_identifiers" does not exist'))).toBe(true);
    expect(isMissingIdentifierTableError({ code: "42P01" } as never)).toBe(true);
    expect(isMissingIdentifierTableError(new Error("no such table: horses"))).toBe(false);
  });

  it("recognizes duplicate-key failures on both SQLite and Postgres dialects", () => {
    expect(isDuplicateIdentifierError(new Error("UNIQUE constraint failed: horse_identifiers.kind, horse_identifiers.issuer_namespace, horse_identifiers.normalized_value"))).toBe(true);
    expect(isDuplicateIdentifierError(new Error('duplicate key value violates unique constraint "uq_horse_identifiers_live"'))).toBe(true);
    expect(isDuplicateIdentifierError({ code: "23505" } as never)).toBe(false);
    expect(isDuplicateIdentifierError({ code: "23505", constraint: "uq_horse_identifiers_live" } as never)).toBe(true);
    expect(isDuplicateIdentifierError(new Error("UNIQUE constraint failed: horses.register_no"))).toBe(false);
  });

  it("builds a safe 409 with the live holder for authorized operators", () => {
    const httpError = duplicateIdentifierHttpError(
      { kind: "register_no", normalizedValue: "10020" },
      { id: 77, name_latin: "Qater Al Nasief", name_native: "قاطر النسیف" },
    );
    expect(httpError.status).toBe(409);
    expect(httpError.code).toBe("duplicate_identifier");
    expect(httpError.details).toMatchObject({
      kind: "register_no",
      value: "10020",
      existing: { id: 77, name_latin: "Qater Al Nasief" },
    });
  });
});
