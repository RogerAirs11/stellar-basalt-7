-- Private URLs are conveniences for a currently authenticated reader, never
-- anonymous bearer authorization. Old unbound grants remain as history and
-- cannot authorize new private delivery. No public photo consent is changed.
ALTER TABLE media_access_grants ADD COLUMN granted_to_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE media_access_grants ADD COLUMN granted_to_token_hash TEXT;
CREATE INDEX IF NOT EXISTS media_access_grants_session ON media_access_grants(granted_to_session_id,revoked_at);
