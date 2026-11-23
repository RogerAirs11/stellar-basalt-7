-- 0046_workspaces.sql
-- R88 agent plan P14: farm workspace collections and delegated daily work.
--
-- Doctrine:
--   1. A private herd COLLECTION is a working set, never an ownership claim.
--      Nothing in these tables writes horse_people or horse_access_grants —
--      a horse in two private collections changes no ownership assertion
--      (the acceptance test pins this by full-snapshot comparison).
--   2. Staff access is ACTION-SCOPED (view / tasks_manage / export) and
--      re-authorized LIVE at every read: a revoked assignment stops working
--      on the next request, exactly like the P12 provider-manager rule.
--   3. Tasks are USER-ENTERED reminders (document renewal, farrier visit,
--      planned veterinary appointment). The machine performs mechanical
--      date arithmetic only — it NEVER generates medical instructions, and
--      veterinary-category reminders carry an explicit qualified-person
--      notice in every response.
--   4. Recurring occurrence creation is idempotent: the deterministic
--      occurrence_key makes a scheduler retry a no-op instead of a duplicate.
--   5. Deleting a collection removes memberships and tasks — NEVER canonical
--      horses (the rollback rule).
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS workspace_collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_user_id TEXT NOT NULL,
  -- Optional organization scope: only organizations the owner can manage.
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  -- Instrumentation: set ONCE on the first dashboard view (CAS) so the time
  -- from creation to first useful herd view is measurable honestly.
  first_dashboard_view_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_collections_owner
  ON workspace_collections(owner_user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_workspace_collections_org
  ON workspace_collections(organization_id) WHERE organization_id IS NOT NULL;

-- Collection membership: a WORKING SET reference, not ownership. The horse
-- itself is never duplicated — this table only points at canonical horses(id).
CREATE TABLE IF NOT EXISTS workspace_collection_members (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  added_by_user_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  UNIQUE(collection_id, horse_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_horse
  ON workspace_collection_members(horse_id);

-- Action-scoped staff assignments with live revocation.
CREATE TABLE IF NOT EXISTS workspace_staff_assignments (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  -- Allowed actions, comma-separated: view, tasks_manage, export.
  actions TEXT NOT NULL CHECK (actions <> ''),
  granted_by_user_id TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  UNIQUE(collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_staff_user
  ON workspace_staff_assignments(user_id, status);

-- User-entered reminders and recurring work. Medical honesty: this table
-- stores REMINDERS ONLY — no dosage, treatment or instruction fields exist.
CREATE TABLE IF NOT EXISTS workspace_tasks (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
  horse_id INTEGER REFERENCES horses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('document_renewal','farrier','veterinary_appointment','other')),
  due_date TEXT NOT NULL,
  -- Recurrence: none, or a mechanical interval in days.
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','custom_days')),
  recurrence_interval_days INTEGER CHECK (recurrence_interval_days IS NULL OR (recurrence_interval_days >= 1 AND recurrence_interval_days <= 3650)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  created_by_user_id TEXT NOT NULL,
  assigned_to_user_id TEXT,
  completed_at TEXT,
  completed_by_user_id TEXT,
  -- Deterministic per-occurrence key: the SAME (task family, due date) can
  -- only exist once — scheduler retries are idempotent by construction.
  occurrence_key TEXT NOT NULL UNIQUE,
  occurrence_index INTEGER NOT NULL DEFAULT 0,
  parent_task_id INTEGER REFERENCES workspace_tasks(id) ON DELETE SET NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_collection
  ON workspace_tasks(collection_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_assigned
  ON workspace_tasks(assigned_to_user_id, status);
