import { anonymousBindings, sqlMayWrite } from "./sqlLex";
import { createClient } from "@tursodatabase/serverless/compat";

type BoundValue = string | number | bigint | boolean | null | ArrayBuffer | Uint8Array;

type TursoResultLike = {
  rows?: unknown[];
  columns?: string[];
  rowsAffected?: number;
  lastInsertRowid?: bigint | number | string | null;
};

function normalizeBound(value: BoundValue): string | number | bigint | null | Uint8Array {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

function rowToObject(row: unknown, columns?: readonly string[]): Record<string, unknown> {
  if (columns?.length) {
    // An actual array's length/numeric properties are positional bookkeeping,
    // not SQL aliases. Use positions before considering named result objects.
    if (Array.isArray(row)) return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    // Column metadata is authoritative. "length" and numeric column names
    // are legitimate SQL aliases, not always array bookkeeping to discard.
    const record = row != null && typeof row === "object" ? row as Record<string, unknown> : {};
    return Object.fromEntries(columns.map((column, index) => [column,
      Object.prototype.hasOwnProperty.call(record, column) ? record[column] : record[String(index)]]));
  }
  if (row && typeof row === "object" && !Array.isArray(row)) return { ...row as Record<string, unknown> };
  return {};
}

function checkedResults(results: TursoResultLike[], expected: number): TursoResultLike[] {
  if (!Array.isArray(results) || results.length !== expected || results.some(result => !result || typeof result !== "object")) {
    throw new Error(`Turso batch result count mismatch: expected ${expected}`);
  }
  return results;
}

function rowsFromResult<T>(result: TursoResultLike): T[] {
  return (result.rows ?? []).map((row) => rowToObject(row, result.columns)) as T[];
}

function lastInsertId(result: TursoResultLike, fallback = 0): number {
  const value = result.lastInsertRowid;
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function d1Meta(result: TursoResultLike, rowsRead = 0, fallbackLastRowId = 0) {
  const changes = Number(result.rowsAffected ?? 0);
  return {
    duration: 0,
    changes,
    last_row_id: lastInsertId(result, fallbackLastRowId),
    changed_db: changes > 0,
    size_after: 0,
    rows_read: rowsRead,
    rows_written: changes,
  };
}

const isWriteSql = sqlMayWrite;

class TursoPreparedStatement {
  private readonly values: BoundValue[];

  constructor(
    private readonly client: ReturnType<typeof createClient>,
    readonly sql: string,
    values: BoundValue[] = [],
  ) {
    this.values = values;
  }

  bind(...values: BoundValue[]): TursoPreparedStatement {
    return new TursoPreparedStatement(this.client, this.sql, values);
  }

  descriptor() {
    const bound = anonymousBindings(this.sql, this.values);
    return { sql: bound.sql, args: bound.values.map(normalizeBound) };
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const result = await this.all<Record<string, unknown>>();
    const row = result.results[0];
    if (!row) return null;
    if (columnName) return (row[columnName] as T) ?? null;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    // first()/all() may execute writes with RETURNING, too. They must use the
    // same FK-enabled atomic path as run(), not bypass write setup.
    if (isWriteSql(this.sql)) return this.run<T>();
    const result = await this.client.execute(this.descriptor()) as unknown as TursoResultLike;
    const rows = rowsFromResult<T>(result);
    return { success: true, results: rows, meta: d1Meta(result, rows.length) } as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (!isWriteSql(this.sql)) return this.all<T>();
    // Foreign-key mode is connection/session state in SQLite and changing it
    // from inside an already-open transaction can be a no-op. Enable it on
    // this request-scoped session BEFORE starting the atomic write batch.
    await this.client.execute("PRAGMA foreign_keys=ON");
    const raw = await this.client.batch([
      this.descriptor(),
      "SELECT last_insert_rowid() AS __last_row_id",
    ], "write") as unknown as TursoResultLike[];
    const [result, lastId] = checkedResults(raw, 2) as [TursoResultLike, TursoResultLike];
    const fallbackLastId = Number(rowsFromResult<{ __last_row_id?: number | bigint }>(lastId)[0]?.__last_row_id ?? 0);
    const rows = rowsFromResult<T>(result);
    return { success: true, results: rows, meta: d1Meta(result, rows.length, fallbackLastId) } as D1Result<T>;
  }
}

export function createTursoD1Database(url: string, authToken: string): D1Database {
  if (!url || !authToken) throw new Error("Turso URL/auth token are required");

  // IMPORTANT: create one client per Worker request. The prior A1 Turso benchmark
  // found that sharing the compat client across concurrent requests could hang an
  // isolate. This factory is therefore intentionally cheap and request-scoped.
  const client = createClient({ url, authToken });

  let closed = false;
  const db = {
    __horseDbProvider: "turso" as const,
    __horseDbClose() {
      if (closed) return;
      closed = true;
      // Compat exposes synchronous close; remote close acknowledgement is
      // driver-owned and is not falsely claimed as an awaited transaction.
      client.close();
    },
    prepare(sql: string) {
      return new TursoPreparedStatement(client, sql);
    },
    async batch(statements: TursoPreparedStatement[]) {
      if (!statements.length) return [];
      const write = statements.some((statement) => isWriteSql(statement.sql));
      if (!write) {
        const raw = await client.batch(statements.map((statement) => statement.descriptor()), "read") as unknown as TursoResultLike[];
        return checkedResults(raw, statements.length).map((result) => {
          const results = rowsFromResult(result);
          return { success: true, results, meta: d1Meta(result, results.length) } as D1Result;
        });
      }

      // PRAGMA foreign_keys must be enabled before the transaction begins.
      await client.execute("PRAGMA foreign_keys=ON");
      const raw = await client.batch([
        ...statements.map((statement) => statement.descriptor()),
        "SELECT last_insert_rowid() AS __last_row_id",
      ], "write") as unknown as TursoResultLike[];

      checkedResults(raw, statements.length + 1);
      const lastIdResult = raw.at(-1) ?? {};
      const fallbackLastId = Number(rowsFromResult<{ __last_row_id?: number | bigint }>(lastIdResult)[0]?.__last_row_id ?? 0);
      const statementResults = raw.slice(0, -1);
      if (statementResults.length !== statements.length) {
        throw new Error(`Turso batch result count mismatch: expected ${statements.length}, got ${statementResults.length}`);
      }
      return statementResults.map((result, index) => {
        const results = rowsFromResult(result);
        // The final connection rowid does not belong to every INSERT in a
        // multi-statement batch. Prefer each result's own lastInsertRowid.
        const fallback = statements.length === 1 && /^\s*(?:INSERT|REPLACE)\b/i.test(statements[index].sql) ? fallbackLastId : 0;
        return { success: true, results, meta: d1Meta(result, results.length, fallback) } as D1Result;
      });
    },
    async exec(sql: string) {
      await client.executeMultiple(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      throw new Error("Turso dump is not exposed through the D1 compatibility adapter.");
    },
  };

  return db as unknown as D1Database;
}

export async function closeTursoD1Database(db: D1Database): Promise<void> {
  const candidate = db as unknown as { __horseDbProvider?: string; __horseDbClose?: () => void };
  if (candidate.__horseDbProvider === "turso" && typeof candidate.__horseDbClose === "function") candidate.__horseDbClose();
}
