CREATE TABLE IF NOT EXISTS artist_genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_name TEXT NOT NULL,
  genre TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (artist_name, genre)
);

CREATE INDEX IF NOT EXISTS idx_artist_genres_artist_name
ON artist_genres(artist_name);
