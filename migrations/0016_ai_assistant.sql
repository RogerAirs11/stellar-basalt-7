-- R31 canonical AI assistant: durable conversation transcript and provider continuation state.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  title TEXT,
  locale TEXT NOT NULL DEFAULT 'auto',
  preferred_provider TEXT,
  preferred_model TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'auto' CHECK (execution_mode IN ('fast','auto','research')),
  active_provider TEXT,
  active_model TEXT,
  provider_interaction_id TEXT,
  provider_state_json TEXT,
  effective_context_tokens INTEGER NOT NULL DEFAULT 0 CHECK (effective_context_tokens >= 0),
  last_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (last_input_tokens >= 0),
  last_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (last_output_tokens >= 0),
  last_thought_tokens INTEGER NOT NULL DEFAULT 0 CHECK (last_thought_tokens >= 0),
  last_cached_tokens INTEGER NOT NULL DEFAULT 0 CHECK (last_cached_tokens >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner_activity ON ai_conversations(owner_key,last_activity_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system_event')),
  text TEXT NOT NULL DEFAULT '',
  provider TEXT,
  model TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  entity_refs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending','complete','error','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages(conversation_id,created_at,id);
