-- Stable browser-generated IDs make retries safe and avoid duplicate paid/provider calls.
ALTER TABLE ai_messages ADD COLUMN client_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_conversation_client_message
  ON ai_messages(conversation_id,client_message_id)
  WHERE client_message_id IS NOT NULL AND role='user';
