CREATE TABLE IF NOT EXISTS curated_playlist_seed_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed_code TEXT NOT NULL,
  source_type TEXT NOT NULL,
  spotify_track_id TEXT,
  spotify_uri TEXT,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  artist_names_json TEXT NOT NULL DEFAULT '[]',
  normalized_track TEXT NOT NULL,
  normalized_artist TEXT NOT NULL,
  album_name TEXT,
  release_date TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(seed_code, source_type, normalized_track, normalized_artist)
);

CREATE INDEX IF NOT EXISTS idx_curated_playlist_seed_tracks_seed
ON curated_playlist_seed_tracks(seed_code, source_type);

CREATE INDEX IF NOT EXISTS idx_curated_playlist_seed_tracks_spotify_track_id
ON curated_playlist_seed_tracks(spotify_track_id);

CREATE INDEX IF NOT EXISTS idx_curated_playlist_seed_tracks_normalized
ON curated_playlist_seed_tracks(normalized_track, normalized_artist);
