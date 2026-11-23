-- Admin-managed AI runtime settings (R33 / user task: AI customization
-- belongs to the admin panel, not the user-facing chat).
-- Keys currently used:
--   default_chat_model      -> model id ('gemini-3.5-flash-lite' |
--                              'gemini-3.5-flash' | 'deepseek-flash')
--                              or '' for the system default (Flash-Lite)
--   default_execution_mode  -> 'fast' | 'auto' | 'research', or '' for auto
-- Values are validated server-side before writes; unknown rows are ignored.
CREATE TABLE IF NOT EXISTS ai_runtime_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
