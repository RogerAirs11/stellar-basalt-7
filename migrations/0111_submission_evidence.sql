-- Private evidence can belong to a resumable request before a horse exists.
ALTER TABLE change_requests ADD COLUMN evidence_file_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE change_requests ADD COLUMN evidence_total_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE change_requests ADD COLUMN last_evidence_operation TEXT;
CREATE TABLE IF NOT EXISTS request_evidence (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
 uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('passport','identity_photo','registration','laboratory','other')),
 file_name TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=8388608),
 sha256 TEXT NOT NULL,
 payload_digest TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at TEXT,
 UNIQUE(request_id,uploaded_by_user_id,operation_id)
);
CREATE INDEX IF NOT EXISTS idx_request_evidence_request ON request_evidence(request_id,created_at);
CREATE TABLE IF NOT EXISTS request_evidence_blobs (
 evidence_id TEXT NOT NULL REFERENCES request_evidence(id) ON DELETE CASCADE,
 chunk INTEGER NOT NULL CHECK(chunk>=0 AND chunk<16),
 data BLOB NOT NULL,
 PRIMARY KEY(evidence_id,chunk)
);
