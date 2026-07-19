CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_admin_order
ON playlist_collection_sources(collection_id, active, include_in_consensus, weight, playlist_name);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_admin_order
ON playlist_collection_artists(collection_id, review_status, confidence_score, source_count, evidence_count, artist_name);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_admin_order
ON playlist_collection_tracks(collection_id, review_status, confidence_score, source_count, evidence_count, artist_name, track_name);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_collection_name
ON playlist_collection_artists(collection_id, artist_name);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_collection_identity
ON playlist_collection_tracks(collection_id, track_name, artist_name);

CREATE INDEX IF NOT EXISTS idx_admin_review_decisions_lookup
ON admin_intelligence_review_decisions(normalized_artist_name, normalized_suggested_genre, source_type, decision);

CREATE INDEX IF NOT EXISTS idx_user_tracks_playlist_user_track
ON user_tracks(playlist_code, user_id, track_id);
