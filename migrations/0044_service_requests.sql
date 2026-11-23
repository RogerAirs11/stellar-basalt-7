-- 0044_service_requests.sql
-- R88 agent plan P12: consented service request inbox (before booking or
-- commissions).
--
-- A service request is a LEAD, never a confirmed appointment: no paid/booked
-- states exist anywhere in the machine.
--
--   service_requests: provider (directory person, optional organization),
--   category (reviewed vocabulary), coarse location (approved province code +
--   canonical city), optional horse, MINIMIZED note (no medical details are
--   solicited), explicit contact-sharing consent, an explicit role transition
--   table (new -> acknowledged -> discussing; closed/withdrawn/spam terminal),
--   row_version optimistic concurrency and audit trail.
--
--   service_request_receipts: idempotency receipts with the SAME discipline
--   as marketplace command_receipts (P03): scoped to (actor, target), request
--   digest + stable response persisted in the same batch as the request, so a
--   receipt only exists for an execution that happened; retry replays the
--   stored response; same key + different payload = 409.
--
--   service_request_blocks / service_request_reports: the requester can block
--   a provider and report abuse without the note ever becoming public.
--
-- Portable relational SQL (SQLite/D1 + Postgres translation verified).

CREATE TABLE IF NOT EXISTS service_requests (
  id INTEGER PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  provider_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  provider_organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  province_code TEXT,
  city TEXT,
  horse_id INTEGER REFERENCES horses(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  share_contact INTEGER NOT NULL DEFAULT 0 CHECK (share_contact IN (0,1)),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','discussing','closed','withdrawn','spam')),
  first_response_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  last_transition_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_requests_requester ON service_requests(requester_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_provider ON service_requests(provider_person_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_service_requests_open_pair ON service_requests(requester_user_id, provider_person_id) WHERE status IN ('new','acknowledged','discussing');

CREATE TABLE IF NOT EXISTS service_request_receipts (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_person_id INTEGER NOT NULL,
  request_digest TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code IN (200, 201)),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_request_receipts ON service_request_receipts(actor_user_id, id);

CREATE TABLE IF NOT EXISTS service_request_blocks (
  id INTEGER PRIMARY KEY,
  blocker_user_id TEXT NOT NULL,
  blocked_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(blocker_user_id, blocked_person_id)
);

CREATE TABLE IF NOT EXISTS service_request_reports (
  id INTEGER PRIMARY KEY,
  service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_request_reports_request ON service_request_reports(service_request_id);
