CREATE TABLE IF NOT EXISTS playlist_definitions (
  playlist_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  spotify_playlist_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_sync_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  playlists_checked INTEGER NOT NULL DEFAULT 0,
  playlists_created INTEGER NOT NULL DEFAULT 0,
  tracks_added INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
