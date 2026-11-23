CREATE TABLE IF NOT EXISTS equine_samples (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  sample_ref TEXT NOT NULL,
  specimen TEXT NOT NULL CHECK(specimen IN ('hair_root','blood','buccal','semen','tissue','other')),
  collected_on TEXT,
  identity_check TEXT NOT NULL CHECK(identity_check IN ('microchip_matched','document_checked','not_checked')),
  observed_microchip TEXT,
  body_json TEXT NOT NULL,
  evidence_media_id TEXT REFERENCES horse_media(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_equine_samples_horse ON equine_samples(horse_id,created_at);
CREATE TABLE IF NOT EXISTS equine_sample_custody_events (
  id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL REFERENCES equine_samples(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('received','transferred','stored','discarded','correction')),
  occurred_at TEXT NOT NULL,
  custodian_ref TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_equine_sample_custody_sample ON equine_sample_custody_events(sample_id,occurred_at,id);
CREATE TABLE IF NOT EXISTS equine_lab_reports (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  sample_id TEXT NOT NULL REFERENCES equine_samples(id) ON DELETE RESTRICT,
  laboratory_ref TEXT NOT NULL,
  accession_ref TEXT NOT NULL,
  report_revision TEXT NOT NULL DEFAULT 'original',
  issued_on TEXT NOT NULL,
  panel_type TEXT NOT NULL CHECK(panel_type IN ('base_color','str_parentage','disease','other')),
  panel_version TEXT NOT NULL,
  method TEXT NOT NULL,
  evidence_media_id TEXT NOT NULL REFERENCES horse_media(id) ON DELETE RESTRICT,
  evidence_sha256 TEXT NOT NULL,
  body_json TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'pending' CHECK(review_state IN ('pending','accepted','rejected','withdrawn')),
  review_json TEXT,
  supersedes_report_id TEXT REFERENCES equine_lab_reports(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  last_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(laboratory_ref,accession_ref,report_revision,panel_type,panel_version)
);
CREATE INDEX IF NOT EXISTS idx_equine_lab_reports_horse ON equine_lab_reports(horse_id,panel_type,review_state);
