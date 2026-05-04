const config = require("../config");
const { openDatabase } = require("../db");

function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT 1 AS found
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(tableName);

  return Boolean(row);
}

function readCount(db, tableName, whereClause = "") {
  if (!tableExists(db, tableName)) {
    return null;
  }

  try {
    return db.prepare(`
      SELECT COUNT(*) AS count
      FROM ${tableName}
      ${whereClause}
    `).get().count;
  } catch (err) {
    return null;
  }
}

function parseSummaryJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function serializeCrateRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    summary: parseSummaryJson(row.summary_json),
  };
}

function getLastCrateRunByStep(db, stepName) {
  if (!tableExists(db, "crate_runs")) {
    return null;
  }

  try {
    const rows = db.prepare(`
      SELECT
        id,
        user_id,
        status,
        started_at,
        finished_at,
        summary_json
      FROM crate_runs
      ORDER BY id DESC
      LIMIT 200
    `).all();

    const row = rows.find((candidate) => parseSummaryJson(candidate.summary_json)?.step === stepName);

    return serializeCrateRun(row);
  } catch (err) {
    return null;
  }
}

function getLastPlaylistSyncRun(db) {
  if (!tableExists(db, "playlist_sync_runs")) {
    return null;
  }

  try {
    const row = db.prepare(`
      SELECT
        run_id,
        user_id,
        started_at,
        completed_at,
        playlists_checked,
        playlists_created,
        tracks_added,
        duplicates_skipped,
        errors
      FROM playlist_sync_runs
      ORDER BY run_id DESC
      LIMIT 1
    `).get();

    if (!row) {
      return null;
    }

    return {
      run_id: row.run_id,
      user_id: row.user_id,
      started_at: row.started_at,
      completed_at: row.completed_at,
      playlists_checked: row.playlists_checked,
      playlists_created: row.playlists_created,
      tracks_added: row.tracks_added,
      duplicates_skipped: row.duplicates_skipped,
      errors: parseSummaryJson(row.errors) || [],
    };
  } catch (err) {
    return null;
  }
}

function getPlaylistCategoryCounts(db) {
  if (!tableExists(db, "user_tracks")) {
    return null;
  }

  const hasTrackOverrides = tableExists(db, "track_overrides");
  const effectivePlaylistCode = hasTrackOverrides
    ? "COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code)"
    : "user_tracks.playlist_code";
  const joinTrackOverrides = hasTrackOverrides
    ? "LEFT JOIN track_overrides ON track_overrides.track_id = user_tracks.track_id"
    : "";

  try {
    return db.prepare(`
      SELECT
        ${effectivePlaylistCode} AS playlist_code,
        COUNT(*) AS count
      FROM user_tracks
      ${joinTrackOverrides}
      WHERE ${effectivePlaylistCode} IS NOT NULL
      GROUP BY ${effectivePlaylistCode}
      ORDER BY count DESC, playlist_code COLLATE NOCASE ASC
    `).all();
  } catch (err) {
    return null;
  }
}

function getCrateStatus() {
  const db = openDatabase();

  return {
    status: "ok",
    database_path: config.databasePath,
    environment: config.env || null,
    total_tracks_count: readCount(db, "tracks"),
    total_user_tracks_count: readCount(db, "user_tracks"),
    total_artist_genres_count: readCount(db, "artist_genres"),
    sorted_tracks_count: readCount(db, "user_tracks", "WHERE playlist_code IS NOT NULL"),
    unmatched_tracks_count: readCount(db, "user_tracks", "WHERE playlist_code IS NULL"),
    matched_tracks_count: readCount(db, "user_tracks", "WHERE playlist_code IS NOT NULL"),
    playlist_category_counts: getPlaylistCategoryCounts(db),
    last_sync_run: getLastCrateRunByStep(db, "syncLikedSongs"),
    last_sort_run: getLastCrateRunByStep(db, "sortTracks"),
    last_playlist_sync_run: getLastPlaylistSyncRun(db),
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getCrateStatus,
};
