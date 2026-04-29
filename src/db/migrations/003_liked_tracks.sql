CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_track_id TEXT NOT NULL UNIQUE,
  uri TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  artist_names TEXT NOT NULL,
  album_name TEXT,
  popularity INTEGER,
  explicit INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  added_at TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_tracks (
  user_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  liked_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, track_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

CREATE INDEX IF NOT EXISTS idx_user_tracks_user_id ON user_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at);
