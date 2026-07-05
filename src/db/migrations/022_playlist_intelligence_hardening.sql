ALTER TABLE playlist_collection_sources
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'candidate'
CHECK (review_status IN ('candidate', 'approved', 'rejected', 'ignored'));

ALTER TABLE playlist_collection_sources
ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'medium'
CHECK (trust_level IN ('low', 'medium', 'high'));

ALTER TABLE playlist_collection_sources
ADD COLUMN source_name TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_sources
ADD COLUMN source_author TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_sources
ADD COLUMN source_url TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_sources
ADD COLUMN spotify_playlist_id TEXT NOT NULL DEFAULT '';

ALTER TABLE playlist_collection_sources
ADD COLUMN active INTEGER NOT NULL DEFAULT 1
CHECK (active IN (0, 1));

ALTER TABLE playlist_collection_artists
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'candidate'
CHECK (review_status IN ('candidate', 'approved', 'rejected', 'ignored'));

ALTER TABLE playlist_collection_artists
ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0
CHECK (evidence_count >= 0);

ALTER TABLE playlist_collection_artists
ADD COLUMN source_count INTEGER NOT NULL DEFAULT 0
CHECK (source_count >= 0);

ALTER TABLE playlist_collection_tracks
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'candidate'
CHECK (review_status IN ('candidate', 'approved', 'rejected', 'ignored'));

ALTER TABLE playlist_collection_tracks
ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0
CHECK (evidence_count >= 0);

ALTER TABLE playlist_collection_tracks
ADD COLUMN source_count INTEGER NOT NULL DEFAULT 0
CHECK (source_count >= 0);

UPDATE playlist_collection_sources
SET
  review_status = CASE WHEN include_in_consensus = 1 THEN 'candidate' ELSE 'ignored' END,
  source_name = playlist_name,
  active = 1
WHERE source_name = '';

UPDATE playlist_collection_artists
SET
  review_status = CASE WHEN approved = 1 THEN 'approved' ELSE 'candidate' END,
  evidence_count = CASE WHEN evidence_count = 0 THEN appearance_count ELSE evidence_count END,
  source_count = CASE WHEN source_count = 0 AND appearance_count > 0 THEN appearance_count ELSE source_count END;

UPDATE playlist_collection_tracks
SET
  review_status = CASE WHEN approved = 1 THEN 'approved' ELSE 'candidate' END,
  evidence_count = CASE WHEN evidence_count = 0 THEN appearance_count ELSE evidence_count END,
  source_count = CASE WHEN source_count = 0 AND appearance_count > 0 THEN appearance_count ELSE source_count END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_collection_sources_unique
ON playlist_collection_sources(collection_id, lower(playlist_name), source_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_collection_artists_unique
ON playlist_collection_artists(collection_id, lower(artist_name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_collection_tracks_unique
ON playlist_collection_tracks(collection_id, lower(track_name), lower(artist_name));

CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_review
ON playlist_collection_sources(collection_id, review_status, active);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_trust
ON playlist_collection_sources(collection_id, trust_level);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_spotify
ON playlist_collection_sources(spotify_playlist_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_review
ON playlist_collection_artists(collection_id, review_status, confidence_score);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_source_count
ON playlist_collection_artists(collection_id, source_count);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_review
ON playlist_collection_tracks(collection_id, review_status, confidence_score);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_source_count
ON playlist_collection_tracks(collection_id, source_count);
