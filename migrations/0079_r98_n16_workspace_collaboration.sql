-- 0079_r98_n16_workspace_collaboration.sql
-- R98-N16: finish stable collaboration and calendar operations.
--
--   1. workspace_staff_invites: the consent-first staff invitation lifecycle.
--      Direct assignment (workspace_staff_assignments) stays available for
--      the owner/manager who wants immediate delegation; the invite flow
--      requires the INVITEE's explicit acceptance before any assignment is
--      created, expires after 14 days, cannot be self-invited, and is fully
--      audited. Acceptance re-checks the inviter's CURRENT manage authority
--      and the staff capacity INSIDE the creating statement (a late revoke
--      or a full collection inserts zero rows).
--   2. workspace_documents: document ORGANIZATION records (title, bounded
--      category, note, optional expiry) — the tracker that makes the
--      existing document_renewal task category actionable. No file bytes and
--      no medical content are stored here: a document row points at a paper
--      process the operator maintains; the expiry date feeds renewal tasks
--      through date arithmetic only. Rows are versioned (row_version +
--      last_operation_id) and bounded per collection at the command layer.
--
--   Reassignment and staff departure need NO new tables: reassignment is an
--   UPDATE on workspace_tasks with mutation-time authority predicates and a
--   marker-gated audit row (the proven pattern); staff departure suppresses
--   QUEUED workspace-task notifications for the revoked user at revoke time
--   (notification_outbox.status -> 'suppressed') in addition to the drain's
--   existing live re-authorization — revoked staff lose private reads
--   immediately, not at the next drain.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

-- ---------------------------------------------------------------------------
-- 1. Staff invitation lifecycle (consent before delegation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_staff_invites (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_actions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  note TEXT,
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  -- Marker for THIS operation's audit/receipt gating (the invite status
  -- changes only through the operation that actually performed it).
  last_invite_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (invitee_user_id <> invited_by_user_id)
);

-- One OPEN invite per (collection, invitee): a racing duplicate invitation
-- fails closed; closed history never blocks a fresh invite for a new period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_staff_invites_open
  ON workspace_staff_invites(collection_id, invitee_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workspace_staff_invites_invitee
  ON workspace_staff_invites(invitee_user_id, status);

-- ---------------------------------------------------------------------------
-- 2. Document organization records (tracker rows, not file storage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_documents (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES workspace_collections(id) ON DELETE CASCADE,
  horse_id INTEGER REFERENCES horses(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 300),
  category TEXT NOT NULL CHECK (category IN ('identification','registration','insurance','ownership','veterinary_paper','transport','other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  -- Operator-entered expiry of the PAPER process; drives document_renewal
  -- task creation through date arithmetic only. NULL = no known expiry.
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  row_version INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_collection
  ON workspace_documents(collection_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_version
  ON workspace_documents(collection_id, row_version);
