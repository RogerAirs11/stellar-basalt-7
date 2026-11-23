import { assertReadOnlySql, assertSqlBindings, sqlCodeMask, sqlMayWrite, sqlSpans } from "./sqlLex";
import postgres from "postgres";
import { normalizePostgresRows, type PostgresColumn } from "./postgresValues";
import { sqliteSqlToPostgres as translateSQLiteSql, stripLeadingComments, appendSqlClause } from "./sqliteSqlToPostgres";

const catalogName = String.raw`(?:\?\d*|'(?:[^']|'')*')`;
/** R120 / IMP-012: the pedigree graph-lock marker statement text. MUST stay
 * byte-identical to PEDIGREE_GRAPH_LOCK_SQL in src/registry/mutationStatements.ts
 * (the barrier evidence script asserts the sync; keeping this literal local
 * avoids a db-layer dependency on the registry layer). */
const PEDIGREE_GRAPH_LOCK_MARKER = "SELECT ? AS pedigree_graph_lock";
const tablePresenceQuery = new RegExp(
  String.raw`^\s*SELECT\s+(?:name|\*)\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*(?:=\s*${catalogName}|IN\s*\(\s*${catalogName}(?:\s*,\s*${catalogName})*\s*\))\s*;?\s*$`,
  "i",
);

/** Only the application's two table-presence catalog shapes are supported.
 * information_schema applies current-role visibility; current_schema keeps
 * the selected application schema isolated from other search_path schemas.
 * SQLite root pages and CREATE SQL have no faithful PostgreSQL equivalent.
 * This is not general SQLite catalog/PRAGMA or index-definition support. */
function translateTablePresenceCatalog(sql: string): string {
  if (!/\bsqlite_master\b/i.test(sql)) return sql;
  const code = sqlCodeMask(sql);
  const source = /\bFROM\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?(sqlite_master)\b/i.exec(code);
  if (!source) return sql;
  const withoutComments = sqlSpans(sql).map((span) => {
    const text = sql.slice(span.start, span.end);
    return span.kind === "comment" ? text.replace(/[^\r\n]/g, " ") : text;
  }).join("");
  if (!tablePresenceQuery.test(withoutComments)) {
    throw new Error("Unsupported sqlite_master query: use table-presence SELECT name or * with type='table' and name =/IN predicates");
  }
  // Replace only the bare catalog token. Keep original predicates, bind order,
  // literal bytes and comments for the normal lexical dialect translator.
  const start = source.index + source[0].lastIndexOf(source[1]!);
  const projection = `(SELECT 'table'::text AS type, table_name::text AS name,
    table_name::text AS tbl_name, NULL::bigint AS rootpage, NULL::text AS sql
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE') AS sqlite_master`;
  return sql.slice(0, start) + projection + sql.slice(start + source[1]!.length);
}

export function sqliteSqlToPostgres(sql: string): string {
  return translateSQLiteSql(translateTablePresenceCatalog(sql));
}

export function sqliteReadSqlToPostgres(sql: string): string {
  return sqliteSqlToPostgres(sql);
}

type BoundValue = string | number | bigint | boolean | null | ArrayBuffer | Uint8Array;
type SqlClient = ReturnType<typeof postgres>;
/** Minimal structural type both a top-level client and a begin() transaction satisfy. */
type UnsafeCapable = { unsafe: (query: string, params?: unknown[]) => Promise<unknown> };

/**
 * R132: the R131 isolate-scoped client pool is REMOVED. Sharing postgres.js
 * clients (and therefore SOCKETS) across Workers requests violates the
 * runtime's I/O model — sockets created in one request handler cannot be used
 * from another ("Cannot perform I/O on behalf of a different request", seen
 * live at ~40% of browse requests). The pool never actually warmed anything:
 * every reuse hit the I/O guard, and read-only statements only succeeded
 * because withDeadline silently recycled and retried on a fresh client (the
 * retry is what paid the real connect). Writes — and read batches that were
 * misclassified as writes (the Persian collation-key REPLACE() bug, also
 * fixed in R132) — had NO retry and surfaced as intermittent 500s.
 *
 * Hyperdrive itself is the connection pool: connecting to the Hyperdrive
 * binding is a local proxy handshake, while the expensive cross-ocean
 * connections to the origin are kept warm by Hyperdrive. One request-scoped
 * client per request (max:1, idle_timeout:0) is the correct pattern, and the
 * R132 pipelined batch means the whole request is one round trip over that
 * single connection.
 */
const REQUEST_CLIENT_OPTIONS = {
  prepare: false,
  max: 1,
  idle_timeout: 0,
  connect_timeout: 8,
  fetch_types: false,
  connection: { statement_timeout: 30_000 },
} as const;

// executeOn normalizes the actual PostgreSQL int8 wire type. This identity
// function keeps the existing query API shape without guessing from names.
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> { return row; }

function normalizeBound(value: BoundValue): string | number | boolean | null | Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

function d1Meta(rowsRead: number, changes = 0, lastRowId = 0) {
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

export type SupabaseProviderMode = "read" | "full";

/* turn-27 Hyperdrive hang guard: observed in production (~1 in 8 requests)
 * that a pooled Hyperdrive connection goes half-open — the query is written,
 * no response ever arrives, and the request hangs forever while direct
 * pooler connections stay at ~200ms. postgres.js 3.x has no per-query
 * timeout, so every top-level D1-shaped operation runs under a client-side
 * deadline. Read-only operations retry once on a fresh client (which lands
 * on a live connection); writes never retry — they fail fast instead. */
const STATEMENT_DEADLINE_MS = 8_000;
const BATCH_DEADLINE_MS = 20_000;

class SupabaseQueryDeadlineError extends Error {
  constructor(operation: string, readonly attempt: number) {
    super(`Supabase query deadline exceeded (${operation}, attempt ${attempt})`);
    this.name = "SupabaseQueryDeadlineError";
  }
}

type DeadlineRunner = <T>(
  operation: string,
  deadlineMs: number,
  retryOnDeadline: boolean,
  run: (client: UnsafeCapable) => Promise<T>,
) => Promise<T>;

// Cache per request-local client/transaction, never across databases or schemas.
let integerIdTablesCache = new WeakMap<object, Promise<Set<string>>>();
async function loadIntegerIdTables(client: UnsafeCapable): Promise<Set<string>> {
  let pending = integerIdTablesCache.get(client);
  if (!pending) {
    pending = (async () => {
      const rows = await client.unsafe(`
        SELECT c.relname AS table_name FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
        WHERE pg_catalog.pg_table_is_visible(c.oid) AND a.attname='id'
          AND NOT a.attisdropped AND a.atttypid IN (20,21,23)
      `) as { table_name: string }[];
      return new Set(rows.map((row) => String(row.table_name)));
    })();
    integerIdTablesCache.set(client, pending);
  }
  return pending;
}

interface ExecOutcome {
  rows: Record<string, unknown>[];
  changes: number;
  lastRowId: number;
}

/** R132: detect INSERT statements that need the integer-id catalog decision,
 * without running the catalog query itself. The batch path pre-resolves the
 * set ONCE per batch (from the pooled top-level client, where the WeakMap
 * cache actually survives across transactions) so the per-statement catalog
 * lookup — which previously fired inside every write batch because the
 * transaction object is a fresh WeakMap key each time — disappears. */
function insertTargetTable(sqlText: string): string | null {
  const match = stripLeadingComments(sqlText).match(/^INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
  if (!match || /\bRETURNING\b/i.test(sqlCodeMask(sqlText))) return null;
  return match[1] ?? null;
}

async function executeOn(
  client: UnsafeCapable,
  sqlText: string,
  values: BoundValue[],
  mode: SupabaseProviderMode,
  precomputedIntegerIdTables?: Set<string>,
): Promise<ExecOutcome> {
  assertSqlBindings(sqlText, values.length);
  if (mode === "read") assertReadOnlySql(sqlText);
  let translated = sqliteSqlToPostgres(sqlText);
  const insertMatch = stripLeadingComments(translated).match(/^INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
  let appendedReturning = false;
  if (insertMatch && !/\bRETURNING\b/i.test(sqlCodeMask(translated))) {
    const table = insertMatch[1]!;
    const integerIdTables = precomputedIntegerIdTables ?? await loadIntegerIdTables(client);
    if (integerIdTables.has(table)) {
      translated = appendSqlClause(translated, "RETURNING id");
      appendedReturning = true;
    }
  }
  const result = (await client.unsafe(translated, values.map(normalizeBound))) as unknown as Record<
    string,
    unknown
  >[] & { count?: number; columns?: PostgresColumn[] };
  const rows = normalizePostgresRows(Array.from(result), result.columns ?? []);
  const changes = sqlMayWrite(sqlText) ? Number((result as unknown as { count?: number }).count ?? 0) : 0;
  const lastRowId = appendedReturning ? Number((rows[0] as { id?: unknown } | undefined)?.id ?? 0) : 0;
  return { rows, changes, lastRowId };
}

class SupabasePreparedStatement {
  constructor(
    private readonly executeStatement: (sql: string, values: BoundValue[]) => Promise<ExecOutcome>,
    private readonly mode: SupabaseProviderMode,
    readonly sql: string,
    readonly boundValues: BoundValue[] = [],
  ) {}

  bind(...values: BoundValue[]): SupabasePreparedStatement {
    return new SupabasePreparedStatement(this.executeStatement, this.mode, this.sql, values);
  }

  private async queryRows<T>(): Promise<T[]> {
    const outcome = await this.executeStatement(this.sql, this.boundValues);
    return outcome.rows.map(normalizeRow) as T[];
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = (await this.queryRows<Record<string, unknown>>())[0];
    if (!row) return null;
    if (columnName) return (row[columnName] as T) ?? null;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.run<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.mode === "read") assertReadOnlySql(this.sql);
    const outcome = await this.executeStatement(this.sql, this.boundValues);
    return {
      success: true,
      results: outcome.rows.map(normalizeRow) as T[],
      meta: d1Meta(outcome.rows.length, outcome.changes, outcome.lastRowId),
    } as D1Result<T>;
  }
}

export function createSupabaseD1Database(
  connectionString: string,
  options: { hyperdrive?: boolean; mode?: SupabaseProviderMode } = {},
): D1Database {
  if (!connectionString) throw new Error("Supabase transaction-pooler connection string is required");
  const mode: SupabaseProviderMode = options.mode ?? "read";

  // R132: one request-scoped postgres.js client per adapter (see the block
  // comment above REQUEST_CLIENT_OPTIONS for why the R131 isolate pool was
  // removed). The client is still replaceable so a deadline-tripped or failed
  // connection can be recycled and the (idempotent) read retried on a fresh
  // socket within the same request. Hyperdrive owns the cross-request pool.
  const createClient = () => postgres(connectionString, REQUEST_CLIENT_OPTIONS);
  let client = createClient();
  let closed = false;
  const recycleClient = async (dead: unknown): Promise<void> => {
    try {
      await (dead as { end?: (endOptions?: { timeout?: number }) => Promise<void> }).end?.({ timeout: 0.5 });
    } catch { /* the socket is already unusable — that is the point */ }
    if (!closed) client = createClient();
  };
  const withDeadline: DeadlineRunner = async (operation, deadlineMs, retryOnDeadline, run) => {
    for (let attempt = 1; ; attempt++) {
      const active = client as unknown as UnsafeCapable;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run(active),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new SupabaseQueryDeadlineError(operation, attempt)), deadlineMs);
          }),
        ]);
      } catch (error) {
        // Reads are idempotent, so a dead connection can be recycled and
        // retried on a fresh client within the same request; writes never
        // retry — they fail fast instead.
        const retryable = retryOnDeadline && !closed && attempt <= 2
          && !(error instanceof SupabaseQueryDeadlineError && error.attempt >= 3);
        if (retryable) {
          await recycleClient(active);
          continue;
        }
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  };
  const executeStatementWithDeadline = (sql: string, values: BoundValue[]): Promise<ExecOutcome> => {
    const retryable = mode === "read" || !isWriteSql(sql);
    const label = `${retryable ? "read" : "write"} statement ${sql.slice(0, 48).replaceAll(/\s+/g, " ")}`;
    return withDeadline(label, STATEMENT_DEADLINE_MS, retryable, (active) => executeOn(active, sql, values, mode));
  };
  const db = {
    __horseDbProvider: "supabase" as const,
    __horseDbMode: mode,
    async __horseDbClose() {
      if (closed) return;
      closed = true;
      // R132: the client is request-scoped (Hyperdrive owns the cross-request
      // pool), so a completed request bounds-tears-down its own socket. The
      // bounded end() keeps a completed route from ever waiting indefinitely
      // for socket shutdown.
      await client.end({ timeout: 1 }).catch(() => undefined);
    },
    prepare(sql: string) {
      return new SupabasePreparedStatement(executeStatementWithDeadline, mode, sql);
    },
    async batch(statements: SupabasePreparedStatement[]) {
      if (statements.some((statement) => mode === "read" && isWriteSql(statement.sql))) {
        throw new Error("Supabase Horse-DB provider is public-read-only; write batches are not allowed");
      }
      if (!statements.length) return [];
      // R120 / IMP-012 (BE-13): a batch whose FIRST statement is the pedigree
      // graph-lock marker takes a graph-wide transaction advisory lock — in a
      // SEPARATE statement before any guard read — with a BOUNDED wait, so a
      // concurrent parentage edit on another row cannot use a pre-commit
      // snapshot to slip past the recursive cycle guard (write skew). The
      // marker literal is the one exported as PEDIGREE_GRAPH_LOCK_SQL from
      // src/registry/mutationStatements.ts; the two-connection barrier
      // evidence script asserts the literals stay identical.
      const graphLock = statements[0]!.sql.trim() === PEDIGREE_GRAPH_LOCK_MARKER;
      const body = graphLock ? statements.slice(1) : statements;
      // D1 batches are ordered transactions. Read-only PostgreSQL batches
      // additionally need a stable snapshot, not parallel autocommit reads.
      //
      // R132 PERFORMANCE: the body statements used to be awaited one-by-one,
      // which on the Hyperdrive→Supabase chain means one full network round
      // trip PER STATEMENT (measured ~0.5-0.9s each; an 11-statement platform
      // meta batch cost ~10 round trips). Every statement in a D1-shaped
      // batch is pre-bound — no statement depends on a prior statement's
      // RESULT — so they are now all written to the socket before any result
      // is awaited (postgres.js pipelines them inside the transaction) and
      // the whole batch costs ONE round trip. The server still executes the
      // statements in submission order inside the same transaction, so D1's
      // ordered-transaction semantics are preserved; only the client-side
      // waiting changes. The integer-id catalog set is pre-resolved from the
      // pooled top-level client (where the cache survives) so no statement
      // needs an intra-transaction catalog query before it can be sent.
      const needsIntegerIdCatalog = body.some((statement) => insertTargetTable(statement.sql) !== null);
      const integerIdTables = needsIntegerIdCatalog
        ? await withDeadline(
            "integer-id catalog prewarm",
            STATEMENT_DEADLINE_MS,
            true,
            (active) => loadIntegerIdTables(active as unknown as UnsafeCapable),
          )
        : undefined;
      const executeBatch = async (tx: unknown) => {
        const transaction = tx as unknown as UnsafeCapable;
        const results: ExecOutcome[] = [];
        if (graphLock) {
          await transaction.unsafe("SET LOCAL lock_timeout = '5s'", []);
          await transaction.unsafe("SELECT pg_advisory_xact_lock($1)", [Number(statements[0]!.boundValues[0] ?? 0)]);
          results.push({ rows: [], changes: 0, lastRowId: 0 });
        }
        const settled = await Promise.all(
          body.map((statement) => executeOn(transaction, statement.sql, statement.boundValues, mode, integerIdTables)),
        );
        results.push(...settled);
        return results;
      };
      // turn-27: the whole transaction runs under the batch deadline. A
      // read-only batch (the common serving path) retries once on a fresh
      // client when the pooled connection is half-open; write batches never
      // retry — they surface the deadline error to the caller instead.
      const batchIsReadOnly = mode === "read" || statements.every((statement) => !isWriteSql(statement.sql));
      const outcomes = await withDeadline(
        `${batchIsReadOnly ? "read-only" : "write"} batch (${statements.length} statements)`,
        BATCH_DEADLINE_MS,
        batchIsReadOnly,
        async (active) => {
          const runner = active as unknown as { begin: typeof client["begin"] };
          return mode === "read"
            ? runner.begin("isolation level repeatable read read only", executeBatch)
            : runner.begin(executeBatch);
        },
      );
      return outcomes.map((outcome) => ({
        success: true,
        results: outcome.rows.map(normalizeRow),
        meta: d1Meta(outcome.rows.length, outcome.changes, outcome.lastRowId),
      })) as D1Result[];
    },
    async __horseDbWithAiReservation<T>(work: (database: D1Database) => Promise<T>): Promise<T> {
      if (mode !== "full") throw new Error("AI reservations require the writable database authority");
      // A separate lock statement is essential: locking inside INSERT's CTE
      // would still let competing transactions use a pre-lock MVCC snapshot.
      // One small namespace lock covers the low-volume AI admission path only.
      const result = await client.begin("isolation level read committed", async (tx) => {
        const transaction = tx as unknown as UnsafeCapable;
        await transaction.unsafe("SELECT pg_advisory_xact_lock($1)", [710109]);
        // turn-27: reservation statements run on the transaction client under a
        // deadline but NEVER retry — re-running an admitted AI write after a
        // timeout could double-execute. A deadline error fails the reservation.
        const executeReservationStatement = (sql: string, values: BoundValue[]): Promise<ExecOutcome> =>
          withDeadline(`ai-reservation statement ${sql.slice(0, 48).replaceAll(/\s+/g, " ")}`, STATEMENT_DEADLINE_MS, false, () => executeOn(transaction, sql, values, mode));
        const scoped = {
          ...db,
          __horseDbWithAiReservation: undefined,
          prepare(sql: string) { return new SupabasePreparedStatement(executeReservationStatement, mode, sql); },
          async batch(statements: SupabasePreparedStatement[]) {
            const results: D1Result[] = [];
            for (const statement of statements) {
              const value = await executeReservationStatement(statement.sql, statement.boundValues);
              results.push({ success: true, results: value.rows, meta: d1Meta(value.rows.length, value.changes, value.lastRowId) } as D1Result);
            }
            return results;
          },
          async __horseDbClose() { throw new Error("A reservation cannot close its parent database"); },
        };
        return work(scoped as unknown as D1Database);
      });
      return result as T;
    },
    async exec(_sql: string) {
      throw new Error("Supabase exec() is not exposed through the D1 compatibility adapter");
    },
    async dump() {
      throw new Error("Supabase dump is not exposed through the D1 compatibility adapter");
    },
  };
  return db as unknown as D1Database;
}

const isWriteSql = sqlMayWrite;

/** Test hook: the integer-id table cache can outlive throwaway test tables. */
export function __resetSupabaseAdapterCachesForTests(): void {
  integerIdTablesCache = new WeakMap();
}

export function isSupabaseD1Database(db: D1Database): boolean {
  return (db as unknown as { __horseDbProvider?: string }).__horseDbProvider === "supabase";
}

export function isSupabaseFullModeDatabase(db: D1Database): boolean {
  const candidate = db as unknown as { __horseDbProvider?: string; __horseDbMode?: string };
  return candidate.__horseDbProvider === "supabase" && candidate.__horseDbMode === "full";
}

export async function closeSupabaseD1Database(db: D1Database): Promise<void> {
  const candidate = db as unknown as { __horseDbProvider?: string; __horseDbClose?: () => Promise<void> };
  if (candidate.__horseDbProvider !== "supabase" || typeof candidate.__horseDbClose !== "function") return;
  await candidate.__horseDbClose();
}
