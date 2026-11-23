/** Stable configuration scope for in-memory state; never reuse a DB connection. */
const databaseScopes = new WeakMap<object, object>();

export function associateDatabaseRuntimeIdentity<T extends object>(database: T, identity: object): T {
  databaseScopes.set(database, identity);
  return database;
}

export function databaseRuntimeIdentity(database: object): object {
  return databaseScopes.get(database) ?? database;
}
