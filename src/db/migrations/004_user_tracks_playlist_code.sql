ALTER TABLE user_tracks ADD COLUMN playlist_code TEXT;

CREATE INDEX IF NOT EXISTS idx_user_tracks_playlist_code
ON user_tracks(user_id, playlist_code);
