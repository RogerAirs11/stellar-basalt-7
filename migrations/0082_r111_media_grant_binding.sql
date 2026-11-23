-- Every new signed link binds one unpredictable grant identifier. Old grant
-- rows are retained for audit but old unbound tokens are no longer accepted.
ALTER TABLE media_access_grants ADD COLUMN token_binding TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_access_grants_token_binding
  ON media_access_grants(token_binding) WHERE token_binding IS NOT NULL;
