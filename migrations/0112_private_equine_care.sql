-- Private, capability-gated care records. No row here implies clinical authority
-- or public disclosure. Audit_events stores only operation metadata; sensitive
-- before/after bodies remain in the scoped history table.
CREATE TABLE IF NOT EXISTS equine_care_operations (
  operation_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  command TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS equine_care_history (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('clinical','reproduction','sample','custody','report')),
  resource_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE REFERENCES equine_care_operations(operation_id) ON DELETE RESTRICT,
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_type,resource_id,version)
);
CREATE INDEX IF NOT EXISTS idx_equine_care_history_horse ON equine_care_history(horse_id,created_at);
CREATE TABLE IF NOT EXISTS equine_clinical_events (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('examination','vaccination','diagnosis','procedure','medication','allergy','other')),
  occurred_on TEXT,
  body_json TEXT NOT NULL,
  evidence_media_id TEXT REFERENCES horse_media(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK(status IN ('recorded','voided')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_equine_clinical_horse ON equine_clinical_events(horse_id,occurred_on,id);
