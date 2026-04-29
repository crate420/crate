CREATE TABLE IF NOT EXISTS track_overrides (
  track_id INTEGER PRIMARY KEY,
  override_playlist_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

CREATE INDEX IF NOT EXISTS idx_track_overrides_playlist_code
ON track_overrides(override_playlist_code);
