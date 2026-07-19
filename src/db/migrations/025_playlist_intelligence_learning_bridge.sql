ALTER TABLE playlist_collection_artists
ADD COLUMN spotify_artist_id TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_artists
ADD COLUMN production_artist_intelligence_id INTEGER;

ALTER TABLE playlist_collection_artists
ADD COLUMN production_intelligence_updated_at TEXT;

ALTER TABLE playlist_collection_tracks
ADD COLUMN spotify_track_id TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_tracks
ADD COLUMN isrc TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_tracks
ADD COLUMN production_track_intelligence_id INTEGER;

ALTER TABLE playlist_collection_tracks
ADD COLUMN production_intelligence_updated_at TEXT;

ALTER TABLE playlist_collection_sources
ADD COLUMN source_fingerprint TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_spotify_id
ON playlist_collection_artists(spotify_artist_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_production
ON playlist_collection_artists(production_artist_intelligence_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_spotify_id
ON playlist_collection_tracks(spotify_track_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_isrc
ON playlist_collection_tracks(isrc);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_production
ON playlist_collection_tracks(production_track_intelligence_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_fingerprint
ON playlist_collection_sources(collection_id, source_type, source_fingerprint);
