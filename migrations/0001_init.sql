-- Operators: The Owners Scheduler — initial schema
-- No event titles, attendees, or free/busy payloads are stored.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  email_normalized TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('host', 'producer', 'guest', 'admin')),
  google_sub TEXT UNIQUE,
  invited_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  calendar_connected_at TEXT,
  token_status TEXT NOT NULL DEFAULT 'none'
    CHECK (token_status IN ('none', 'ok', 'expired', 'revoked'))
);

CREATE TABLE user_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE user_group_members (
  group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE calendars_selected (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  summary TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, calendar_id)
);

CREATE TABLE oauth_tokens (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_ciphertext BLOB NOT NULL,
  refresh_token_iv BLOB NOT NULL,
  refresh_token_tag BLOB NOT NULL,
  scopes TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  at TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_email TEXT,
  meta_json TEXT
);

CREATE INDEX audit_log_at_idx ON audit_log(at);
CREATE INDEX audit_log_action_idx ON audit_log(action);
