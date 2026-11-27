-- Security hardening for sessions and encrypted OAuth tokens (H-02, M-05).
-- 1. Invalidate any pre-existing plaintext session rows so all active users
--    re-authenticate into hashed 256-bit sessions with absolute lifetime caps.
-- 2. Track absolute session expiry (max_expires_at) for safe sliding/rotation.
-- 3. Track key_version and aad_bound on oauth_tokens for AES-GCM AAD binding
--    and zero-downtime encryption key rotation.

DELETE FROM sessions;

ALTER TABLE sessions ADD COLUMN max_expires_at TEXT;

ALTER TABLE oauth_tokens ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oauth_tokens ADD COLUMN aad_bound INTEGER NOT NULL DEFAULT 0;
