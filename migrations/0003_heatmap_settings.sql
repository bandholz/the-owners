-- Shared Home heatmap rules. One row. Defaults: five weekdays, weekends hidden, 9:00–17:00.
CREATE TABLE IF NOT EXISTS heatmap_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day_count INTEGER NOT NULL DEFAULT 5,
  show_weekends INTEGER NOT NULL DEFAULT 0,
  window_start_minutes INTEGER NOT NULL DEFAULT 540,
  window_end_minutes INTEGER NOT NULL DEFAULT 1020,
  updated_at TEXT,
  updated_by_user_id TEXT
);
INSERT OR IGNORE INTO heatmap_settings (
  id, day_count, show_weekends, window_start_minutes, window_end_minutes
) VALUES (1, 5, 0, 540, 1020);
