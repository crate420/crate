const { openDatabase } = require("../db");
const { buildDiagnosticsForUser } = require("./unmatchedDiagnostics");

function normalizeLimit(value, fallback = 25, maximum = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function normalizeUserId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function countBy(values, keyName) {
  const counts = new Map();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ [keyName]: value, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function summarizeDiagnostics(records, limit = 8) {
  const artists = [];
  const genres = [];
  const reasons = [];

  for (const record of records) {
    artists.push(...(record.artist_names || []));
    genres.push(...(record.spotify_artist_genres || []));
    reasons.push(record.final_unmatched_reason);
  }

  return {
    top_unmatched_artists: countBy(artists, "artist").slice(0, limit),
    top_unmatched_spotify_genres: countBy(genres, "genre").slice(0, limit),
    top_unmatched_reasons: countBy(reasons, "reason").slice(0, limit),
  };
}

function readUserRows() {
  const db = openDatabase();
  const hasBetaClaims = tableExists(db, "beta_access_codes");
  const betaClaimSelect = hasBetaClaims
    ? `(
        SELECT claimed_name
        FROM beta_access_codes
        WHERE claimed_by_user_id = users.id
        ORDER BY claimed_at DESC
        LIMIT 1
      ) AS claimed_name,
      (
        SELECT claimed_email
        FROM beta_access_codes
        WHERE claimed_by_user_id = users.id
        ORDER BY claimed_at DESC
        LIMIT 1
      ) AS claimed_email,`
    : "NULL AS claimed_name, NULL AS claimed_email,";

  return db.prepare(`
    SELECT
      users.id AS user_id,
      users.spotify_user_id,
      users.display_name,
      users.email,
      ${betaClaimSelect}
      users.created_at,
      users.updated_at
    FROM users
    ORDER BY users.id ASC
  `).all();
}

function readUserStats(userId) {
  const db = openDatabase();
  const hasTrackOverrides = tableExists(db, "track_overrides");
  const effectivePlaylistCode = hasTrackOverrides
    ? "COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code)"
    : "user_tracks.playlist_code";
  const joinTrackOverrides = hasTrackOverrides
    ? "LEFT JOIN track_overrides ON track_overrides.track_id = user_tracks.track_id"
    : "";

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_liked_tracks,
      SUM(CASE WHEN ${effectivePlaylistCode} IS NOT NULL THEN 1 ELSE 0 END) AS matched_tracks,
      SUM(CASE WHEN ${effectivePlaylistCode} IS NULL THEN 1 ELSE 0 END) AS unmatched_tracks,
      COUNT(DISTINCT CASE WHEN ${effectivePlaylistCode} IS NOT NULL THEN ${effectivePlaylistCode} END) AS total_playlists_assigned
    FROM user_tracks
    ${joinTrackOverrides}
    WHERE user_tracks.user_id = ?
  `).get(userId);

  const total = Number(row?.total_liked_tracks || 0);
  const matched = Number(row?.matched_tracks || 0);
  const unmatched = Number(row?.unmatched_tracks || 0);

  return {
    total_liked_tracks: total,
    matched_tracks: matched,
    unmatched_tracks: unmatched,
    match_percent: total ? Math.round((matched / total) * 1000) / 10 : 0,
    total_playlists_assigned: Number(row?.total_playlists_assigned || 0),
  };
}

async function buildUserSummary(user) {
  const stats = readUserStats(user.user_id);
  let diagnostics = [];
  let diagnosticError = null;

  if (stats.unmatched_tracks > 0) {
    try {
      diagnostics = await buildDiagnosticsForUser(user.user_id);
    } catch (err) {
      diagnosticError = err.message;
    }
  }

  return {
    user_id: user.user_id,
    spotify_user_id: user.spotify_user_id,
    name: user.display_name || user.claimed_name || null,
    email: user.email || user.claimed_email || null,
    created_at: user.created_at,
    updated_at: user.updated_at,
    ...stats,
    ...summarizeDiagnostics(diagnostics),
    diagnostic_error: diagnosticError,
  };
}

function summarizeDetail(records, limit) {
  return {
    unmatched_tracks: records.slice(0, limit).map((record) => ({
      track_id: record.track_id,
      spotify_track_id: record.spotify_track_id,
      track_name: record.track_name,
      artist_names: record.artist_names,
      album_name: record.album_name,
      spotify_artist_ids: record.spotify_artist_ids,
      spotify_artist_genres: record.spotify_artist_genres,
      approved_artist_genres: record.approved_artist_genres,
      merged_genre_context: record.merged_genre_context,
      matched_playlist_candidates: record.matched_playlist_candidates,
      final_unmatched_reason: record.final_unmatched_reason,
    })),
    unmatched_artists: countBy(records.flatMap((record) => record.artist_names || []), "artist"),
    unmatched_spotify_genres: countBy(records.flatMap((record) => record.spotify_artist_genres || []), "genre"),
    unmatched_reasons: countBy(records.map((record) => record.final_unmatched_reason), "reason"),
  };
}

async function getAdminUserDiagnostics(options = {}) {
  const selectedUserId = normalizeUserId(options.userId);
  const detailLimit = normalizeLimit(options.detailLimit, 100, 500);
  const users = readUserRows();
  const userSummaries = [];

  for (const user of users) {
    userSummaries.push(await buildUserSummary(user));
  }

  const payload = {
    status: "ok",
    generated_at: new Date().toISOString(),
    user_count: userSummaries.length,
    users: userSummaries,
    selected_user: null,
  };

  if (!selectedUserId) {
    return payload;
  }

  const selected = userSummaries.find((user) => user.user_id === selectedUserId);
  if (!selected) {
    const error = new Error("User was not found.");
    error.code = "user_not_found";
    error.statusCode = 404;
    throw error;
  }

  const records = await buildDiagnosticsForUser(selectedUserId);
  payload.selected_user = {
    ...selected,
    total_unmatched_tracks: records.length,
    ...summarizeDetail(records, detailLimit),
  };

  return payload;
}

module.exports = {
  getAdminUserDiagnostics,
};
