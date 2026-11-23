-- Supplementary metadata only. Core identity, health permissions and scientific
-- semantics remain in reviewed domain schemas. Definitions are immutable versions.
CREATE TABLE IF NOT EXISTS registry_metadata_fields (
  field_key TEXT PRIMARY KEY,
  value_type TEXT NOT NULL CHECK(value_type IN ('text','number','boolean','select')),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','staff')),
  active_version INTEGER,
  latest_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  last_operation_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS registry_metadata_versions (
  field_key TEXT NOT NULL REFERENCES registry_metadata_fields(field_key),
  version INTEGER NOT NULL CHECK(version>0),
  definition_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(field_key,version)
);
CREATE TABLE IF NOT EXISTS registry_metadata_values (
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  field_key TEXT NOT NULL REFERENCES registry_metadata_fields(field_key),
  definition_version INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  value_json TEXT NOT NULL,
  filter_value TEXT,
  source_ref TEXT NOT NULL,
  evidence_ref TEXT,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  last_operation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(horse_id,field_key),
  FOREIGN KEY(field_key,definition_version) REFERENCES registry_metadata_versions(field_key,version)
);
CREATE INDEX IF NOT EXISTS registry_metadata_filter ON registry_metadata_values(field_key,filter_value,horse_id);
CREATE TABLE IF NOT EXISTS registry_metadata_operations (
  operation_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  field_key TEXT NOT NULL,
  horse_id INTEGER REFERENCES horses(id),
  command TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS registry_metadata_history (
  id TEXT PRIMARY KEY,
  field_key TEXT NOT NULL REFERENCES registry_metadata_fields(field_key),
  horse_id INTEGER REFERENCES horses(id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES registry_metadata_operations(operation_id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS registry_metadata_history_subject ON registry_metadata_history(horse_id,field_key,created_at);
