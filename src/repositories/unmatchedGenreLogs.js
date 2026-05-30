const { openDatabase } = require("../db");

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function serializeContext(value) {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (err) {
    return null;
  }
}

function logUnmatchedGenre({
  userId,
  genre,
  artistName,
  trackName = null,
  spotifyTrackId = null,
  playlistAttemptContext = null,
}) {
  const normalizedGenre = normalizeValue(genre);
  const normalizedArtistName = normalizeValue(artistName);

  if (!userId || !normalizedGenre || !normalizedArtistName) {
    return { logged: false };
  }

  const now = new Date().toISOString();
  const result = openDatabase()
    .prepare(`
      INSERT INTO unmatched_genre_logs (
        user_id,
        genre,
        normalized_genre,
        artist_name,
        normalized_artist_name,
        track_name,
        spotify_track_id,
        playlist_attempt_context,
        first_seen_at,
        last_seen_at,
        occurrence_count
      )
      VALUES (
        @userId,
        @genre,
        @normalizedGenre,
        @artistName,
        @normalizedArtistName,
        @trackName,
        @spotifyTrackId,
        @playlistAttemptContext,
        @now,
        @now,
        1
      )
      ON CONFLICT(user_id, normalized_genre, normalized_artist_name) DO UPDATE SET
        genre = excluded.genre,
        artist_name = excluded.artist_name,
        track_name = COALESCE(excluded.track_name, unmatched_genre_logs.track_name),
        spotify_track_id = COALESCE(excluded.spotify_track_id, unmatched_genre_logs.spotify_track_id),
        playlist_attempt_context = COALESCE(excluded.playlist_attempt_context, unmatched_genre_logs.playlist_attempt_context),
        last_seen_at = excluded.last_seen_at,
        occurrence_count = unmatched_genre_logs.occurrence_count + 1
    `)
    .run({
      userId,
      genre: String(genre || "").trim(),
      normalizedGenre,
      artistName: String(artistName || "").trim(),
      normalizedArtistName,
      trackName,
      spotifyTrackId,
      playlistAttemptContext: serializeContext(playlistAttemptContext),
      now,
    });

  return { logged: result.changes > 0 };
}

function scopeFilter(scope) {
  return scope === "all" ? "" : "WHERE user_id = @userId";
}

function getMostCommonUnmatchedGenres(userId, { limit = 50, scope = "user" } = {}) {
  return openDatabase()
    .prepare(`
      SELECT
        normalized_genre,
        MAX(genre) AS genre,
        COUNT(DISTINCT user_id) AS user_count,
        COUNT(*) AS artist_count,
        SUM(occurrence_count) AS occurrence_count,
        MAX(last_seen_at) AS last_seen_at
      FROM unmatched_genre_logs
      ${scopeFilter(scope)}
      GROUP BY normalized_genre
      ORDER BY occurrence_count DESC, artist_count DESC, genre COLLATE NOCASE ASC
      LIMIT @limit
    `)
    .all({ userId, limit });
}

function getMostCommonUnmatchedArtists(userId, { limit = 50, scope = "user" } = {}) {
  return openDatabase()
    .prepare(`
      SELECT
        normalized_artist_name,
        MAX(artist_name) AS artist_name,
        COUNT(DISTINCT user_id) AS user_count,
        COUNT(*) AS genre_count,
        SUM(occurrence_count) AS occurrence_count,
        MAX(last_seen_at) AS last_seen_at
      FROM unmatched_genre_logs
      ${scopeFilter(scope)}
      GROUP BY normalized_artist_name
      ORDER BY occurrence_count DESC, genre_count DESC, artist_name COLLATE NOCASE ASC
      LIMIT @limit
    `)
    .all({ userId, limit });
}

function getRecentUnmatchedGenreLogs(userId, { limit = 100, scope = "user" } = {}) {
  return openDatabase()
    .prepare(`
      SELECT
        id,
        user_id,
        genre,
        artist_name,
        track_name,
        spotify_track_id,
        playlist_attempt_context,
        first_seen_at,
        last_seen_at,
        occurrence_count
      FROM unmatched_genre_logs
      ${scopeFilter(scope)}
      ORDER BY last_seen_at DESC, id DESC
      LIMIT @limit
    `)
    .all({ userId, limit });
}

module.exports = {
  getMostCommonUnmatchedArtists,
  getMostCommonUnmatchedGenres,
  getRecentUnmatchedGenreLogs,
  logUnmatchedGenre,
  normalizeValue,
};
