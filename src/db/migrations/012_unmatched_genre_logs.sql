CREATE TABLE IF NOT EXISTS unmatched_genre_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  genre TEXT NOT NULL,
  normalized_genre TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  normalized_artist_name TEXT NOT NULL,
  track_name TEXT,
  spotify_track_id TEXT,
  playlist_attempt_context TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id, normalized_genre, normalized_artist_name)
);

CREATE INDEX IF NOT EXISTS idx_unmatched_genre_logs_user_id
ON unmatched_genre_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_unmatched_genre_logs_normalized_genre
ON unmatched_genre_logs(normalized_genre);

CREATE INDEX IF NOT EXISTS idx_unmatched_genre_logs_last_seen_at
ON unmatched_genre_logs(last_seen_at);
