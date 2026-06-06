CREATE TABLE IF NOT EXISTS track_era_overrides (
  track_id INTEGER PRIMARY KEY,
  spotify_release_year INTEGER,
  original_release_year INTEGER NOT NULL,
  effective_release_year INTEGER NOT NULL,
  source TEXT,
  reason TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

CREATE INDEX IF NOT EXISTS idx_track_era_overrides_effective_release_year
ON track_era_overrides(effective_release_year);

CREATE INDEX IF NOT EXISTS idx_track_era_overrides_confidence
ON track_era_overrides(confidence);
