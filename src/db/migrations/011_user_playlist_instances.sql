CREATE TABLE IF NOT EXISTS user_playlist_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  spotify_user_id TEXT,
  playlist_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  spotify_playlist_id TEXT,
  spotify_owner_id TEXT,
  source TEXT NOT NULL DEFAULT 'selected',
  selection_json TEXT,
  last_synced_at TEXT,
  last_track_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, playlist_code)
);

CREATE INDEX IF NOT EXISTS idx_user_playlist_instances_user_id
ON user_playlist_instances(user_id);

CREATE INDEX IF NOT EXISTS idx_user_playlist_instances_spotify_playlist_id
ON user_playlist_instances(spotify_playlist_id);

CREATE INDEX IF NOT EXISTS idx_user_playlist_instances_playlist_code
ON user_playlist_instances(playlist_code);
