import { anonymousBindings } from "./sqlLex";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type BoundValue = string | number | bigint | null | ArrayBuffer | Uint8Array | boolean;

function normalize(value: BoundValue): string | number | bigint | null | Uint8Array {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

function d1Meta(changes = 0, lastRowId = 0, rowsRead = 0) {
  return {
    duration: 0,
    changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    size_after: 0,
    rows_read: rowsRead,
    rows_written: changes,
  };
}

class LocalPreparedStatement {
  private readonly values: BoundValue[];
  constructor(private readonly db: DatabaseSync, private readonly sql: string, values: BoundValue[] = []) {
    this.values = values;
  }

  bind(...values: BoundValue[]): LocalPreparedStatement {
    return new LocalPreparedStatement(this.db, this.sql, values);
  }

  private statement(): StatementSync {
    return this.db.prepare(anonymousBindings(this.sql, this.values).sql);
  }

  private args() {
    return anonymousBindings(this.sql, this.values).values.map(normalize);
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = this.statement().get(...this.args()) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (columnName) return (row[columnName] as T) ?? null;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeSync() as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    // D1 run() and all() are aliases, including SELECT and RETURNING rows.
    return this.executeSync() as D1Result<T>;
  }

  executeSync(): D1Result {
    const stmt = this.statement();
    if (stmt.columns().length > 0) {
      const before = Number((this.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n);
      const rows = stmt.all(...this.args()) as Record<string, unknown>[];
      const after = Number((this.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n);
      const wrote = after !== before;
      const info = this.db.prepare("SELECT changes() AS changes, last_insert_rowid() AS id").get() as { changes: number; id: number };
      return { success: true, results: rows, meta: d1Meta(wrote ? Number(info.changes) : 0, wrote ? Number(info.id) : 0, rows.length) } as D1Result;
    }
    const info = stmt.run(...this.args());
    const changes = Number(info.changes);
    const lastRowId = Number(info.lastInsertRowid ?? 0);
    return { success: true, results: [], meta: d1Meta(changes, lastRowId, 0) } as D1Result;
  }
}

export function openLocalSqlite(filename: string, options: { readOnly?: boolean } = {}): D1Database {
  const sqlite = new DatabaseSync(filename, { readOnly: options.readOnly === true });
  sqlite.exec(options.readOnly
    ? "PRAGMA foreign_keys = ON; PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;"
    : "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");

  const db = {
    prepare(sql: string) {
      return new LocalPreparedStatement(sqlite, sql);
    },
    async batch(statements: LocalPreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.executeSync());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        try { sqlite.exec("ROLLBACK"); } catch { }
        throw error;
      }
    },
    async exec(sql: string) {
      // R125 dialect boundary: Cloudflare D1's SQLite fork accepts the
      // PostgreSQL-style `ADD COLUMN IF NOT EXISTS` (migration 0098 was applied
      // to live D1 verbatim), but stock SQLite — node:sqlite, used by the local
      // test suite and validators — rejects it at parse time. Normalize the
      // dialect for the local adapter only; semantics are identical because a
      // fresh local database applies each migration exactly once.
      sqlite.exec(sql.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+/gi, "ADD COLUMN "));
      return { count: 0, duration: 0 };
    },
    async dump() {
      throw new Error("Local SQLite dump is not exposed through the D1 compatibility adapter.");
    },
  };

  return db as unknown as D1Database;
}
