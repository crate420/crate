const { openDatabase } = require("../db");

function normalizeSavedTrack(savedTrack) {
  const track = savedTrack.track;
  const artistNames = (track.artists || []).map((artist) => artist.name).filter(Boolean);

  return {
    spotifyTrackId: track.id,
    uri: track.uri,
    name: track.name,
    artistNames: JSON.stringify(artistNames),
    albumName: track.album?.name || null,
    popularity: Number.isInteger(track.popularity) ? track.popularity : null,
    explicit: track.explicit ? 1 : 0,
    durationMs: Number.isInteger(track.duration_ms) ? track.duration_ms : null,
    addedAt: savedTrack.added_at || null,
    rawJson: JSON.stringify(track),
  };
}

function upsertSavedTracksForUser(userId, savedTracks) {
  const db = openDatabase();
  const now = new Date().toISOString();
  const stats = {
    seen: savedTracks.length,
    skipped: 0,
    inserted: 0,
    updated: 0,
    userTracksInserted: 0,
    userTracksUpdated: 0,
  };

  const findTrack = db.prepare("SELECT id FROM tracks WHERE spotify_track_id = ?");
  const findUserTrack = db.prepare(`
    SELECT 1
    FROM user_tracks
    WHERE user_id = ? AND track_id = ?
  `);

  const insertTrack = db.prepare(`
    INSERT INTO tracks (
      spotify_track_id,
      uri,
      name,
      artist_names,
      album_name,
      popularity,
      explicit,
      duration_ms,
      added_at,
      raw_json,
      created_at,
      updated_at
    )
    VALUES (
      @spotifyTrackId,
      @uri,
      @name,
      @artistNames,
      @albumName,
      @popularity,
      @explicit,
      @durationMs,
      @addedAt,
      @rawJson,
      @now,
      @now
    )
  `);

  const updateTrack = db.prepare(`
    UPDATE tracks
    SET
      uri = @uri,
      name = @name,
      artist_names = @artistNames,
      album_name = @albumName,
      popularity = @popularity,
      explicit = @explicit,
      duration_ms = @durationMs,
      added_at = COALESCE(@addedAt, added_at),
      raw_json = @rawJson,
      updated_at = @now
    WHERE id = @id
  `);

  const upsertUserTrack = db.prepare(`
    INSERT INTO user_tracks (
      user_id,
      track_id,
      liked_at,
      first_seen_at,
      last_seen_at
    )
    VALUES (
      @userId,
      @trackId,
      @likedAt,
      @now,
      @now
    )
    ON CONFLICT(user_id, track_id) DO UPDATE SET
      liked_at = COALESCE(excluded.liked_at, user_tracks.liked_at),
      last_seen_at = excluded.last_seen_at
  `);

  const writeTracks = db.transaction(() => {
    for (const savedTrack of savedTracks) {
      if (!savedTrack?.track?.id || !savedTrack.track.uri) {
        stats.skipped += 1;
        continue;
      }

      const track = normalizeSavedTrack(savedTrack);
      const existing = findTrack.get(track.spotifyTrackId);
      let trackId;

      if (existing) {
        trackId = existing.id;
        updateTrack.run({ ...track, id: trackId, now });
        stats.updated += 1;
      } else {
        const result = insertTrack.run({ ...track, now });
        trackId = result.lastInsertRowid;
        stats.inserted += 1;
      }

      const existingUserTrack = findUserTrack.get(userId, trackId);

      upsertUserTrack.run({
        userId,
        trackId,
        likedAt: track.addedAt,
        now,
      });

      if (existingUserTrack) {
        stats.userTracksUpdated += 1;
      } else {
        stats.userTracksInserted += 1;
      }
    }
  });

  writeTracks();

  return stats;
}

function countLikedTracksForUser(userId) {
  return openDatabase()
    .prepare("SELECT COUNT(*) AS count FROM user_tracks WHERE user_id = ?")
    .get(userId).count;
}

function getUnsortedTracksForUser(userId) {
  return openDatabase()
    .prepare(`
      SELECT
        user_tracks.user_id,
        user_tracks.track_id,
        user_tracks.liked_at,
        tracks.spotify_track_id,
        tracks.uri,
        tracks.name,
        tracks.artist_names,
        tracks.album_name,
        tracks.popularity,
        tracks.explicit,
        tracks.duration_ms,
        tracks.raw_json,
        track_overrides.override_playlist_code
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
      WHERE user_tracks.user_id = ?
        AND user_tracks.playlist_code IS NULL
      ORDER BY user_tracks.liked_at DESC, user_tracks.first_seen_at DESC
    `)
    .all(userId);
}

function getUnmatchedTracksForUser(userId, { limit, offset }) {
  return openDatabase()
    .prepare(`
      SELECT
        user_tracks.user_id,
        user_tracks.track_id,
        user_tracks.liked_at,
        tracks.spotify_track_id,
        tracks.uri,
        tracks.name,
        tracks.artist_names,
        tracks.album_name,
        tracks.raw_json
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      WHERE user_tracks.user_id = @userId
        AND user_tracks.playlist_code IS NULL
      ORDER BY
        tracks.artist_names COLLATE NOCASE ASC,
        tracks.name COLLATE NOCASE ASC
      LIMIT @limit
      OFFSET @offset
    `)
    .all({ userId, limit, offset });
}

function getAllUnmatchedTracksForUser(userId) {
  return openDatabase()
    .prepare(`
      SELECT
        user_tracks.user_id,
        user_tracks.track_id,
        tracks.spotify_track_id,
        tracks.name,
        tracks.artist_names,
        tracks.album_name,
        tracks.raw_json
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      WHERE user_tracks.user_id = ?
        AND user_tracks.playlist_code IS NULL
      ORDER BY
        tracks.artist_names COLLATE NOCASE ASC,
        tracks.name COLLATE NOCASE ASC
    `)
    .all(userId);
}

function getSortedTracksForPlaylistSync(userId) {
  return openDatabase()
    .prepare(`
      SELECT
        user_tracks.user_id,
        user_tracks.track_id,
        COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS playlist_code,
        user_tracks.playlist_code AS assigned_playlist_code,
        track_overrides.override_playlist_code,
        tracks.spotify_track_id,
        tracks.uri,
        tracks.name,
        tracks.artist_names,
        tracks.album_name
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
      WHERE user_tracks.user_id = ?
        AND COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) IS NOT NULL
        AND tracks.uri IS NOT NULL
      ORDER BY
        COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) COLLATE NOCASE ASC,
        user_tracks.liked_at ASC,
        tracks.name COLLATE NOCASE ASC
    `)
    .all(userId);
}

function getEffectivePlaylistCountsForUser(userId) {
  const rows = openDatabase()
    .prepare(`
      SELECT
        COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS playlist_code,
        COUNT(*) AS count
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
      WHERE user_tracks.user_id = ?
        AND COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) IS NOT NULL
      GROUP BY COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code)
    `)
    .all(userId);

  return new Map(rows.map((row) => [row.playlist_code, row.count]));
}

function getTracksForEffectivePlaylist(userId, playlistCode) {
  return openDatabase()
    .prepare(`
      SELECT
        user_tracks.track_id,
        COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS effective_playlist_code,
        user_tracks.playlist_code AS assigned_playlist_code,
        track_overrides.override_playlist_code,
        tracks.spotify_track_id,
        tracks.uri,
        tracks.name,
        tracks.artist_names,
        tracks.album_name
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
      WHERE user_tracks.user_id = @userId
        AND COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) = @playlistCode
      ORDER BY
        tracks.artist_names COLLATE NOCASE ASC,
        tracks.name COLLATE NOCASE ASC
    `)
    .all({ userId, playlistCode });
}

function assignPlaylistCodes(assignments) {
  if (assignments.length === 0) {
    return { updated: 0 };
  }

  const db = openDatabase();
  const now = new Date().toISOString();

  const updatePlaylistCode = db.prepare(`
    UPDATE user_tracks
    SET
      playlist_code = @playlistCode,
      last_seen_at = @now
    WHERE user_id = @userId
      AND track_id = @trackId
  `);

  const updateAssignments = db.transaction(() => {
    for (const assignment of assignments) {
      updatePlaylistCode.run({
        ...assignment,
        now,
      });
    }
  });

  updateAssignments();

  return { updated: assignments.length };
}

function getTrackForUser(userId, trackId) {
  return openDatabase()
    .prepare(`
      SELECT
        user_tracks.user_id,
        user_tracks.track_id,
        user_tracks.liked_at,
        user_tracks.playlist_code,
        track_overrides.override_playlist_code,
        tracks.spotify_track_id,
        tracks.uri,
        tracks.name,
        tracks.artist_names,
        tracks.album_name,
        tracks.popularity,
        tracks.explicit,
        tracks.duration_ms
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
      WHERE user_tracks.user_id = @userId
        AND user_tracks.track_id = @trackId
    `)
    .get({ userId, trackId });
}

function setUserTrackPlaylistCode({ userId, trackId, playlistCode }) {
  const now = new Date().toISOString();

  return openDatabase()
    .prepare(`
      UPDATE user_tracks
      SET
        playlist_code = @playlistCode,
        last_seen_at = @now
      WHERE user_id = @userId
        AND track_id = @trackId
    `)
    .run({ userId, trackId, playlistCode, now });
}

module.exports = {
  assignPlaylistCodes,
  countLikedTracksForUser,
  getAllUnmatchedTracksForUser,
  getEffectivePlaylistCountsForUser,
  getSortedTracksForPlaylistSync,
  getTracksForEffectivePlaylist,
  getTrackForUser,
  getUnmatchedTracksForUser,
  getUnsortedTracksForUser,
  setUserTrackPlaylistCode,
  upsertSavedTracksForUser,
};
