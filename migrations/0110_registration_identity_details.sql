-- Additive registration fields. Legacy unknowns remain unknown; no issuer is invented.
ALTER TABLE horses ADD COLUMN birth_name TEXT;
ALTER TABLE horses ADD COLUMN previous_names_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE horses ADD COLUMN passport_issuer TEXT;
ALTER TABLE horses ADD COLUMN passport_issue_date_value TEXT;
ALTER TABLE horses ADD COLUMN passport_issue_date_precision TEXT;
ALTER TABLE horses ADD COLUMN passport_issue_date_calendar TEXT;
ALTER TABLE horses ADD COLUMN passport_expiry_value TEXT;
ALTER TABLE horses ADD COLUMN passport_expiry_precision TEXT;
ALTER TABLE horses ADD COLUMN passport_expiry_calendar TEXT;
ALTER TABLE horses ADD COLUMN foreign_registration_no TEXT;
ALTER TABLE horses ADD COLUMN foreign_registration_issuer TEXT;
ALTER TABLE horses ADD COLUMN life_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK(life_status IN ('unknown','alive','dead','missing'));
UPDATE horses SET life_status='dead' WHERE is_dead=1 AND life_status='unknown';
-- Passport/foreign live-identifier claims are created only by reviewed writes.
-- Legacy records require issuer reconciliation before claiming uniqueness.
