CREATE TABLE IF NOT EXISTS playlist_seed_cache (
  seed_code TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  playlist_name TEXT NOT NULL,
  owner_id TEXT,
  owner_name TEXT,
  description TEXT,
  snapshot_id TEXT,
  follower_count INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  track_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_seed_tracks (
  seed_code TEXT NOT NULL,
  spotify_track_id TEXT NOT NULL,
  spotify_uri TEXT,
  isrc TEXT,
  track_name TEXT NOT NULL,
  artist_names_json TEXT NOT NULL DEFAULT '[]',
  artist_ids_json TEXT NOT NULL DEFAULT '[]',
  album_name TEXT,
  release_date TEXT,
  release_year INTEGER,
  position INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (seed_code, spotify_track_id),
  FOREIGN KEY (seed_code) REFERENCES playlist_seed_cache(seed_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_seed_tracks_seed_code
ON playlist_seed_tracks(seed_code);

CREATE INDEX IF NOT EXISTS idx_playlist_seed_tracks_isrc
ON playlist_seed_tracks(isrc);

CREATE INDEX IF NOT EXISTS idx_playlist_seed_tracks_release_year
ON playlist_seed_tracks(release_year);
