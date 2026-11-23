-- Per-conversation lease prevents concurrent turns from forking provider continuation state.
ALTER TABLE ai_conversations ADD COLUMN active_turn_id TEXT;
ALTER TABLE ai_conversations ADD COLUMN active_turn_started_at TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_active_turn ON ai_conversations(active_turn_id);
