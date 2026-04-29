const { openDatabase } = require("../db");

function upsertTrackOverride({ trackId, playlistCode }) {
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      INSERT INTO track_overrides (
        track_id,
        override_playlist_code,
        created_at,
        updated_at
      )
      VALUES (
        @trackId,
        @playlistCode,
        @now,
        @now
      )
      ON CONFLICT(track_id) DO UPDATE SET
        override_playlist_code = excluded.override_playlist_code,
        updated_at = excluded.updated_at
    `)
    .run({ trackId, playlistCode, now });

  return findByTrackId(trackId);
}

function findByTrackId(trackId) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM track_overrides
      WHERE track_id = ?
    `)
    .get(trackId);
}

module.exports = {
  findByTrackId,
  upsertTrackOverride,
};
