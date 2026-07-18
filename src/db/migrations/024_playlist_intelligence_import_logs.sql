CREATE TABLE IF NOT EXISTS playlist_intelligence_import_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  collection_code TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  imported_by_user_id INTEGER,
  imported_by_spotify_user_id TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  artists_processed INTEGER NOT NULL DEFAULT 0,
  artists_inserted INTEGER NOT NULL DEFAULT 0,
  artists_updated INTEGER NOT NULL DEFAULT 0,
  tracks_processed INTEGER NOT NULL DEFAULT 0,
  tracks_inserted INTEGER NOT NULL DEFAULT 0,
  tracks_updated INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  estimated_recoverable_songs INTEGER NOT NULL DEFAULT 0,
  unmatched_artist_overlap INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES playlist_collection_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_intelligence_import_logs_collection
ON playlist_intelligence_import_logs(collection_id, created_at);

CREATE INDEX IF NOT EXISTS idx_playlist_intelligence_import_logs_created
ON playlist_intelligence_import_logs(created_at);
