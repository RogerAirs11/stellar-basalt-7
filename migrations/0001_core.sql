PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_rows INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','complete','failed')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS horses (
  id INTEGER PRIMARY KEY,
  company_code TEXT,
  register_no TEXT,
  microchip_no TEXT,
  file_number TEXT,
  name_latin TEXT NOT NULL,
  name_native TEXT,
  father_id INTEGER REFERENCES horses(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  mother_id INTEGER REFERENCES horses(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  book_version TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  originality TEXT,
  birth_date TEXT,
  birth_year INTEGER,
  birth_place_code TEXT,
  birth_place_desc TEXT,
  breed_type TEXT,
  breed_desc TEXT,
  sex_code TEXT,
  sex_desc TEXT,
  color_code TEXT,
  color_desc TEXT,
  main_strain_no TEXT,
  main_strain_desc TEXT,
  sub_strain_no TEXT,
  sub_strain_desc TEXT,
  uel_no TEXT,
  lab_no TEXT,
  dna_status TEXT,
  dna_desc TEXT,
  life_number TEXT,
  passport_no TEXT,
  passport_date TEXT,
  passport_deliver_date TEXT,
  is_stallion INTEGER NOT NULL DEFAULT 0 CHECK (is_stallion IN (0,1)),
  is_sport INTEGER NOT NULL DEFAULT 0 CHECK (is_sport IN (0,1)),
  is_imported INTEGER NOT NULL DEFAULT 0 CHECK (is_imported IN (0,1)),
  imported_date TEXT,
  imported_from_code TEXT,
  imported_from_desc TEXT,
  import_register_no TEXT,
  export_certificate TEXT,
  horse_sr_no TEXT,
  is_dead INTEGER NOT NULL DEFAULT 0 CHECK (is_dead IN (0,1)),
  death_date TEXT,
  is_register_sport INTEGER NOT NULL DEFAULT 0 CHECK (is_register_sport IN (0,1)),
  has_sport_card INTEGER NOT NULL DEFAULT 0 CHECK (has_sport_card IN (0,1)),
  allow_stallion INTEGER NOT NULL DEFAULT 0 CHECK (allow_stallion IN (0,1)),
  description TEXT,
  source_created_at TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_horses_name_latin ON horses(name_latin COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_horses_father ON horses(father_id);
CREATE INDEX IF NOT EXISTS idx_horses_mother ON horses(mother_id);
CREATE INDEX IF NOT EXISTS idx_horses_birth_year ON horses(birth_year);
CREATE INDEX IF NOT EXISTS idx_horses_register_no ON horses(register_no COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_horses_microchip_no ON horses(microchip_no COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name_native TEXT,
  name_latin TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_people_name_latin ON people(name_latin);

CREATE TABLE IF NOT EXISTS horse_people (
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner','breeder','importer','passport_receiver')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (horse_id, person_id, role)
);
CREATE INDEX IF NOT EXISTS idx_horse_people_person_role ON horse_people(person_id, role);

CREATE TABLE IF NOT EXISTS horse_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  language TEXT,
  alias_type TEXT NOT NULL DEFAULT 'alternate',
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE(horse_id, alias_normalized)
);
CREATE INDEX IF NOT EXISTS idx_horse_aliases_normalized ON horse_aliases(alias_normalized);

CREATE TABLE IF NOT EXISTS data_quality_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horse_id INTEGER REFERENCES horses(id) ON DELETE CASCADE,
  issue_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  field_name TEXT,
  message TEXT NOT NULL,
  details_json TEXT,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_quality_horse_open ON data_quality_issues(horse_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_quality_code ON data_quality_issues(issue_code, severity);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','owner','editor','admin','super_admin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent_hash TEXT,
  ip_prefix_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  horse_id INTEGER REFERENCES horses(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('create_horse','update_horse','ownership','other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft','pending','approved','rejected','withdrawn')),
  summary TEXT,
  evidence_json TEXT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS change_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value_json TEXT,
  proposed_value_json TEXT NOT NULL
);
