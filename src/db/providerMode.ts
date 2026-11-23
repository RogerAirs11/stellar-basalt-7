import { HttpError } from "../api/http";

/** Explicit configuration; missing config defaults to the canonical Supabase store.
 * *_full selects one registry/auth/AI authority. Legacy *_only semantics are
 * preserved; new full modes require a verified data migration, not just a flag. */
export type DatabaseProviderMode =
  | "d1_full"
  | "turso_full"
  | "d1_only"
  | "turso_only"
  | "d1_with_turso_read_failover"
  | "turso_with_d1_read_failover"
  | "supabase_only"
  | "d1_with_supabase_read_failover"
  | "supabase_with_d1_read_failover"
  | "supabase_with_turso_read_failover"
  | "turso_with_supabase_read_failover"
  /** R56: public reads pull from Supabase (Turso read failover) while every
   *  canonical write stays on D1 — the single canonical write primary. This is a legacy split-authority posture: Supabase is the default database to
   *  pull horse/person data from, without giving up validated D1 write paths
   *  (auth, admin curation, AI state are all routed to their own D1 bindings). */
  | "supabase_read_with_d1_write"
  /** R59: Supabase Postgres is THE canonical database — every read AND every
   *  write (registry, auth, AI state, audit) goes to Supabase. No automatic
   *  fallback: the health-probe/circuit machinery asserts an exact static
   *  dataset snapshot (fixed horse count, pinned revisions) which is
   *  incompatible with a writeable primary. Emergency recovery requires a verified current replica and an explicit
   *  promotion runbook. Never redirect canonical writes to a stale snapshot. */
  | "supabase_full";

export function parseDatabaseProviderMode(value?: string): DatabaseProviderMode {
  switch ((value ?? "supabase_full").trim().toLowerCase()) {
    case "d1_full":
    case "turso_full":
    case "d1_only":
    case "turso_only":
    case "d1_with_turso_read_failover":
    case "turso_with_d1_read_failover":
    case "supabase_only":
    case "d1_with_supabase_read_failover":
    case "supabase_with_d1_read_failover":
    case "supabase_with_turso_read_failover":
    case "turso_with_supabase_read_failover":
    case "supabase_read_with_d1_write":
    case "supabase_full":
      return (value ?? "supabase_full").trim().toLowerCase() as DatabaseProviderMode;
    default:
      throw new HttpError(500, "invalid_database_provider_mode", "Database provider mode is invalid");
  }
}
