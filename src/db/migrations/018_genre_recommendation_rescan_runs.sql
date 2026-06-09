CREATE TABLE IF NOT EXISTS genre_recommendation_rescan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER,
  admin_spotify_user_id TEXT,
  selected_user_ids_json TEXT NOT NULL DEFAULT '[]',
  approval_ids_json TEXT NOT NULL DEFAULT '[]',
  before_counts_json TEXT NOT NULL DEFAULT '[]',
  after_counts_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_genre_recommendation_rescan_runs_started
ON genre_recommendation_rescan_runs(started_at);
