-- Per-user limit on how far ahead others may see free/busy.
-- full = the range being viewed. week = next 7 days. month = next 30 days.
ALTER TABLE users ADD COLUMN share_window TEXT NOT NULL DEFAULT 'full';
