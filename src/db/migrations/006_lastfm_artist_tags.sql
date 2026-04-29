CREATE TABLE lastfm_artist_tags (
  artist_name TEXT PRIMARY KEY,
  source_artist_name TEXT,
  raw_tags_json TEXT NOT NULL,
  mapped_genres_json TEXT NOT NULL,
  suggested_playlist_code TEXT,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_lastfm_artist_tags_status
ON lastfm_artist_tags(status);
