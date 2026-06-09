CREATE TABLE IF NOT EXISTS genre_recommendation_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_name TEXT NOT NULL,
  normalized_artist_name TEXT NOT NULL,
  recommended_playlist_code TEXT NOT NULL,
  approved_genre TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  confidence_tier TEXT NOT NULL,
  estimated_gain INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  admin_user_id INTEGER,
  admin_spotify_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_genre_recommendation_approvals_artist
ON genre_recommendation_approvals(normalized_artist_name);

CREATE INDEX IF NOT EXISTS idx_genre_recommendation_approvals_playlist
ON genre_recommendation_approvals(recommended_playlist_code);
