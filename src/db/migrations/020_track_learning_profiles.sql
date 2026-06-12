CREATE TABLE IF NOT EXISTS track_learning_profiles (
  track_id INTEGER PRIMARY KEY,
  spotify_track_id TEXT,
  identity_key TEXT,
  profile_version TEXT NOT NULL DEFAULT 'v1',
  current_playlist_code TEXT,
  top_candidate_playlist_code TEXT,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  confidence_tier TEXT NOT NULL DEFAULT 'none',
  source_count INTEGER NOT NULL DEFAULT 0,
  would_change_if_learning_active INTEGER NOT NULL DEFAULT 0,
  has_specialty_match INTEGER NOT NULL DEFAULT 0,
  has_conflict INTEGER NOT NULL DEFAULT 0,
  user_occurrence_count INTEGER NOT NULL DEFAULT 0,
  unmatched_occurrence_count INTEGER NOT NULL DEFAULT 0,
  derived_profile_json TEXT NOT NULL DEFAULT '{}',
  evidence_summary_json TEXT NOT NULL DEFAULT '{}',
  playlist_candidates_json TEXT NOT NULL DEFAULT '[]',
  specialty_matches_json TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

CREATE INDEX IF NOT EXISTS idx_track_learning_profiles_spotify_track_id
ON track_learning_profiles(spotify_track_id);

CREATE INDEX IF NOT EXISTS idx_track_learning_profiles_identity_key
ON track_learning_profiles(identity_key);

CREATE INDEX IF NOT EXISTS idx_track_learning_profiles_current_playlist
ON track_learning_profiles(current_playlist_code);

CREATE INDEX IF NOT EXISTS idx_track_learning_profiles_top_candidate
ON track_learning_profiles(top_candidate_playlist_code);

CREATE INDEX IF NOT EXISTS idx_track_learning_profiles_confidence
ON track_learning_profiles(confidence_score);

CREATE INDEX IF NOT EXISTS idx_track_learning_profiles_generated_at
ON track_learning_profiles(generated_at);
