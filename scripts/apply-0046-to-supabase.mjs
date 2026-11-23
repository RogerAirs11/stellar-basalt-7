#!/usr/bin/env node
/**
 * R88 agent plan P14 Supabase-first step: apply migration 0046 (workspace
 * collections + delegated work) to the Supabase canonical database BEFORE
 * the worker push. Additive only: 4 new tables + 6 indexes. No data changes.
 *
 * Usage:
 *   SUPABASE_DATABASE_URL=... node scripts/apply-0046-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0046");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_collections (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_user_id TEXT NOT NULL,
      organization_id bigint REFERENCES organizations(id) ON DELETE SET NULL,
      first_dashboard_view_at TEXT,
      row_version bigint NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_workspace_collections_owner ON workspace_collections(owner_user_id, deleted_at)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_workspace_collections_org ON workspace_collections(organization_id) WHERE organization_id IS NOT NULL`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_collection_members (
      id BIGSERIAL PRIMARY KEY,
      collection_id bigint NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
      horse_id bigint NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
      added_by_user_id TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT,
      UNIQUE(collection_id, horse_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_workspace_members_horse ON workspace_collection_members(horse_id)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_staff_assignments (
      id BIGSERIAL PRIMARY KEY,
      collection_id bigint NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      actions TEXT NOT NULL CHECK (actions <> ''),
      granted_by_user_id TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
      revoked_at TEXT,
      revoked_by_user_id TEXT,
      UNIQUE(collection_id, user_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_workspace_staff_user ON workspace_staff_assignments(user_id, status)`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_tasks (
      id BIGSERIAL PRIMARY KEY,
      collection_id bigint NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
      horse_id bigint REFERENCES horses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('document_renewal','farrier','veterinary_appointment','other')),
      due_date TEXT NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','custom_days')),
      recurrence_interval_days bigint CHECK (recurrence_interval_days IS NULL OR (recurrence_interval_days >= 1 AND recurrence_interval_days <= 3650)),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
      created_by_user_id TEXT NOT NULL,
      assigned_to_user_id TEXT,
      completed_at TEXT,
      completed_by_user_id TEXT,
      occurrence_key TEXT NOT NULL UNIQUE,
      occurrence_index bigint NOT NULL DEFAULT 0,
      parent_task_id bigint REFERENCES workspace_tasks(id) ON DELETE SET NULL,
      row_version bigint NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_workspace_tasks_collection ON workspace_tasks(collection_id, status, due_date)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_workspace_tasks_assigned ON workspace_tasks(assigned_to_user_id, status)`);

  for (const table of ["workspace_collections", "workspace_collection_members", "workspace_staff_assignments", "workspace_tasks"]) {
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    console.log(`OK ${table}:`, rows.map((row) => row.column_name).join(", "));
  }
  console.log("apply-0046: Supabase canonical updated (P14 workspaces; additive only)");
} finally {
  await sql.end({ timeout: 5 });
}
