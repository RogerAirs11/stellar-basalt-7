-- Genetic parentage and gestation are separate roles. An episode never rewrites
-- horses.father_id/mother_id. Those remain subject to canonical review.
CREATE TABLE IF NOT EXISTS equine_reproductive_episodes (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE RESTRICT,
  sire_id INTEGER REFERENCES horses(id) ON DELETE RESTRICT,
  recipient_dam_id INTEGER REFERENCES horses(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK(method IN ('natural_cover','artificial_insemination','embryo_transfer','icsi','unknown')),
  covering_on TEXT,
  transfer_on TEXT,
  outcome_on TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('planned','covered','pregnant','not_pregnant','pregnancy_loss','foaled','cancelled')),
  body_json TEXT NOT NULL,
  evidence_media_id TEXT REFERENCES horse_media(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(sire_id IS NULL OR sire_id<>horse_id),
  CHECK(recipient_dam_id IS NULL OR recipient_dam_id<>horse_id),
  CHECK(recipient_dam_id IS NULL OR recipient_dam_id<>sire_id)
);
CREATE INDEX IF NOT EXISTS idx_equine_reproduction_genetic_dam ON equine_reproductive_episodes(horse_id,created_at);
CREATE INDEX IF NOT EXISTS idx_equine_reproduction_recipient ON equine_reproductive_episodes(recipient_dam_id,created_at);
CREATE INDEX IF NOT EXISTS idx_equine_reproduction_sire ON equine_reproductive_episodes(sire_id);
CREATE TABLE IF NOT EXISTS equine_reproductive_offspring (
  episode_id TEXT NOT NULL REFERENCES equine_reproductive_episodes(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 8),
  foal_horse_id INTEGER REFERENCES horses(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK(outcome IN ('live','stillborn','died_after_birth')),
  sex_at_birth TEXT CHECK(sex_at_birth IN ('male','female','unknown')),
  notes TEXT,
  PRIMARY KEY(episode_id,ordinal),
  UNIQUE(episode_id,foal_horse_id)
);
CREATE INDEX IF NOT EXISTS idx_equine_reproductive_offspring_foal ON equine_reproductive_offspring(foal_horse_id);
