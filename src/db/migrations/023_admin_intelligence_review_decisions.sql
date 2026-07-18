CREATE TABLE IF NOT EXISTS admin_intelligence_review_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_artist_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  suggested_genre TEXT NOT NULL,
  normalized_suggested_genre TEXT NOT NULL,
  source_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  approved_genre TEXT,
  normalized_approved_genre TEXT,
  notes TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  admin_user_id INTEGER,
  admin_spotify_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (decision IN ('rejected', 'edited')),
  UNIQUE (normalized_artist_name, normalized_suggested_genre, source_type)
);

CREATE INDEX IF NOT EXISTS idx_admin_intelligence_review_decisions_lookup
ON admin_intelligence_review_decisions(normalized_artist_name, normalized_suggested_genre, source_type, decision);

CREATE INDEX IF NOT EXISTS idx_admin_intelligence_review_decisions_updated
ON admin_intelligence_review_decisions(updated_at);
