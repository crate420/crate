CREATE TABLE IF NOT EXISTS artist_intelligence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_artist_name TEXT NOT NULL UNIQUE,
  display_artist_name TEXT NOT NULL,
  spotify_artist_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  confidence_score INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_artist_intelligence_spotify_artist_id
ON artist_intelligence(spotify_artist_id);

CREATE INDEX IF NOT EXISTS idx_artist_intelligence_review_status
ON artist_intelligence(review_status);

CREATE TABLE IF NOT EXISTS artist_intelligence_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_intelligence_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_artist_id TEXT,
  source_artist_name TEXT,
  raw_payload_json TEXT NOT NULL,
  normalized_signals_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artist_intelligence_id) REFERENCES artist_intelligence(id),
  UNIQUE (artist_intelligence_id, source)
);

CREATE INDEX IF NOT EXISTS idx_artist_intelligence_sources_artist_id
ON artist_intelligence_sources(artist_intelligence_id);

CREATE INDEX IF NOT EXISTS idx_artist_intelligence_sources_source
ON artist_intelligence_sources(source);
