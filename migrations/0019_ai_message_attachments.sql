-- Lightweight, durable image references. R31 stores HTTPS references, not base64 payloads.
CREATE TABLE IF NOT EXISTS ai_message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image')),
  url TEXT NOT NULL,
  mime_type TEXT,
  alt_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_message_attachments_message ON ai_message_attachments(message_id);
