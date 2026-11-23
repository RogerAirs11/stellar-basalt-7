-- R47b: Horse photos & documents (client requirement: آپلود عکس و مدارک) with a
-- two-tier verification model: owner-submitted media starts 'pending', federation
-- staff flips it to 'federation_verified'. Blobs live in a separate table so
-- metadata listings never drag payload bytes. Portable relational SQL.

CREATE TABLE IF NOT EXISTS horse_media (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo','document')),
  role TEXT NOT NULL DEFAULT 'gallery' CHECK (role IN ('profile','gallery','passport','certificate','veterinary','competition','other')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  width INTEGER,
  height INTEGER,
  caption TEXT,
  verification TEXT NOT NULL DEFAULT 'pending' CHECK (verification IN ('pending','federation_verified','owner_submitted','rejected')),
  rejection_note TEXT,
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_horse_media_horse ON horse_media(horse_id, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_horse_media_verification ON horse_media(verification, horse_id);

CREATE TABLE IF NOT EXISTS horse_media_blobs (
  media_id TEXT PRIMARY KEY REFERENCES horse_media(id) ON DELETE CASCADE,
  chunk INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(media_id, chunk)
);

-- Registry certificate issuance ledger: every generated certificate is recorded
-- with its generation parameters so the artifact can be re-verified later.
CREATE TABLE IF NOT EXISTS registry_certificates (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  certificate_type TEXT NOT NULL DEFAULT 'registration' CHECK (certificate_type IN ('registration','pedigree','breeding')),
  language TEXT NOT NULL DEFAULT 'fa' CHECK (language IN ('fa','en')),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  verification_code TEXT NOT NULL,
  payload_digest TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registry_certificates_horse ON registry_certificates(horse_id, issued_at DESC);
