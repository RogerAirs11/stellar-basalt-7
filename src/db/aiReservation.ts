/**
 * SQLite/libSQL serialize the conditional reservation write. PostgreSQL needs
 * a transaction-scoped advisory lock BEFORE its statement snapshot is taken.
 * This optional adapter capability preserves that distinction without leaking
 * PostgreSQL SQL or connection management into the AI domain.
 */
export type AiReservationDatabase = D1Database & {
  __horseDbWithAiReservation?: <T>(work: (database: D1Database) => Promise<T>) => Promise<T>;
};

export async function withAiReservation<T>(database: D1Database, work: (database: D1Database) => Promise<T>): Promise<T> {
  const authority = database as AiReservationDatabase;
  return authority.__horseDbWithAiReservation ? authority.__horseDbWithAiReservation(work) : work(database);
}
