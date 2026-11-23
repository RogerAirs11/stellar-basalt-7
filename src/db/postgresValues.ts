/** PostgreSQL wire-type based normalization. Text identifiers must stay text. */
export interface PostgresColumn { name: string; type: number }
export function parseSafePostgresInt8(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") ||
      !/^-?\d+$/.test(String(value))) throw new Error("Invalid PostgreSQL int8 value");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("PostgreSQL int8 exceeds the application's safe integer range");
  return parsed;
}
/** OID 20 is int8, including COUNT(*). Never infer a database type from a name. */
export function normalizePostgresRows(rows: Array<Record<string, unknown>>, columns: readonly PostgresColumn[]): Array<Record<string, unknown>> {
  const bigintColumns = new Set(columns.filter((column) => column.type === 20).map((column) => column.name));
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value !== null && bigintColumns.has(key) ? parseSafePostgresInt8(value) : value])));
}
