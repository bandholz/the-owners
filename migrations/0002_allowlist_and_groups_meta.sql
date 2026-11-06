-- Allowlist sync bookkeeping + Google test-user ack (manual checklist).
-- Groups tables already exist from 0001.

CREATE TABLE IF NOT EXISTS google_test_user_acks (
  email_normalized TEXT PRIMARY KEY NOT NULL,
  acked_at TEXT NOT NULL,
  acked_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS access_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_error TEXT,
  last_emails_json TEXT
);
INSERT OR IGNORE INTO access_sync_state (id, last_status) VALUES (1, 'never');
