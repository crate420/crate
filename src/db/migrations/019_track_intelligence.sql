CREATE TABLE IF NOT EXISTS track_intelligence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT NOT NULL UNIQUE,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  normalized_track_name TEXT NOT NULL,
  normalized_artist_name TEXT NOT NULL,
  spotify_track_id TEXT,
  isrc TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  last_refreshed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_track_intelligence_spotify_track_id
ON track_intelligence(spotify_track_id);

CREATE INDEX IF NOT EXISTS idx_track_intelligence_isrc
ON track_intelligence(isrc);

CREATE INDEX IF NOT EXISTS idx_track_intelligence_normalized_artist_track
ON track_intelligence(normalized_artist_name, normalized_track_name);

CREATE TABLE IF NOT EXISTS track_intelligence_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_intelligence_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_track_id TEXT,
  source_track_name TEXT,
  source_artist_name TEXT,
  raw_payload_json TEXT NOT NULL,
  normalized_signals_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_intelligence_id) REFERENCES track_intelligence(id),
  UNIQUE (track_intelligence_id, source)
);

CREATE INDEX IF NOT EXISTS idx_track_intelligence_sources_track_id
ON track_intelligence_sources(track_intelligence_id);

CREATE INDEX IF NOT EXISTS idx_track_intelligence_sources_source
ON track_intelligence_sources(source);

CREATE INDEX IF NOT EXISTS idx_track_intelligence_sources_expires_at
ON track_intelligence_sources(expires_at);
