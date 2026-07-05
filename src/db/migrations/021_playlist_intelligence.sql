CREATE TABLE IF NOT EXISTS playlist_collection_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_code TEXT NOT NULL UNIQUE,
  collection_name TEXT NOT NULL,
  identity_description TEXT NOT NULL DEFAULT '',
  research_status TEXT NOT NULL DEFAULT 'research',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (research_status IN ('research', 'active', 'retired'))
);

CREATE TABLE IF NOT EXISTS playlist_collection_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  playlist_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  weight REAL NOT NULL DEFAULT 1,
  include_in_consensus INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES playlist_collection_definitions(id) ON DELETE CASCADE,
  CHECK (source_type IN ('spotify_editorial', 'spotify_user', 'manual')),
  CHECK (include_in_consensus IN (0, 1))
);

CREATE TABLE IF NOT EXISTS playlist_collection_artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  artist_name TEXT NOT NULL,
  appearance_count INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES playlist_collection_definitions(id) ON DELETE CASCADE,
  CHECK (appearance_count >= 0),
  CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CHECK (approved IN (0, 1))
);

CREATE TABLE IF NOT EXISTS playlist_collection_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  track_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  appearance_count INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES playlist_collection_definitions(id) ON DELETE CASCADE,
  CHECK (appearance_count >= 0),
  CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CHECK (approved IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_definitions_status
ON playlist_collection_definitions(research_status);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_collection
ON playlist_collection_sources(collection_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_sources_consensus
ON playlist_collection_sources(collection_id, include_in_consensus);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_collection
ON playlist_collection_artists(collection_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_artists_approved
ON playlist_collection_artists(collection_id, approved);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_collection
ON playlist_collection_tracks(collection_id);

CREATE INDEX IF NOT EXISTS idx_playlist_collection_tracks_approved
ON playlist_collection_tracks(collection_id, approved);

INSERT OR IGNORE INTO playlist_collection_definitions
  (collection_code, collection_name, identity_description, research_status, notes)
VALUES
  ('dream_pop', 'Dream Pop', 'Atmospheric, ethereal, dreamy. Dream Pop. Not Shoegaze.', 'active', ''),
  ('indie_pop', 'Indie Pop', 'Modern indie pop. Festival-friendly. Alternative crossover.', 'active', ''),
  ('college_radio', 'College Radio', 'Late 80s / Early 90s college radio. Primary era: 1984-1994. Modern college playlists should not redefine this collection.', 'active', ''),
  ('alt_rb', 'Alt R&B', 'Modern atmospheric R&B. Frank Ocean is the center of gravity. Separate from Neo Soul.', 'active', ''),
  ('bedroom_pop', 'Bedroom Pop', 'DIY. Lo-fi. Intimate. Modern. Exclude historical "80s Bedroom Pop" playlists from consensus.', 'active', ''),
  ('indie_folk', 'Indie Folk', 'Modern indie folk. Distinct from Singer-Songwriter.', 'active', ''),
  ('neo_soul', 'Neo Soul', 'Organic. Soul. Jazz influence. Groove. Separate from Alt R&B.', 'active', ''),
  ('dance_pop', 'Dance Pop', 'Pop first. Dance second. Exclude EDM-focused playlists from consensus.', 'active', ''),
  ('synth_pop', 'Synth Pop', 'Synth-driven pop. Overlap with New Wave. Not identical to New Wave.', 'active', ''),
  ('britpop', 'Britpop', '1990-1998 British alternative guitar music. Exclude generic British Rock playlists from consensus.', 'active', ''),
  ('shoegaze', 'Shoegaze', 'Dream Pop''s louder guitar-driven cousin. Heavy Shoegaze, Grungegaze, Nugaze, and Metalgaze should be treated as substyles feeding Shoegaze rather than separate collections.', 'active', '');
