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

const ERA_KEYS = ["vintage", "classic", "retro", "modern"];

function emptyEraCounts() {
  return {
    vintage: 0,
    classic: 0,
    retro: 0,
    modern: 0,
  };
}

function releaseYearFromRawJson(rawJson) {
  try {
    const raw = JSON.parse(rawJson || "{}");
    const releaseDate = raw.album?.release_date || raw.release_date || "";
    const year = Number.parseInt(String(releaseDate).slice(0, 4), 10);

    return Number.isInteger(year) ? year : null;
  } catch (err) {
    return null;
  }
}

function eraForYear(year) {
  if (!year) return null;
  if (year <= 1969) return "vintage";
  if (year <= 1989) return "classic";
  if (year <= 2009) return "retro";
  return "modern";
}

function getSortedTrackRowsForStatus(db) {
  if (!tableExists(db, "user_tracks") || !tableExists(db, "tracks")) {
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
        tracks.raw_json
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      ${joinTrackOverrides}
      WHERE ${effectivePlaylistCode} IS NOT NULL
    `).all();
  } catch (err) {
    return null;
  }
}

function getPlaylistCategoryCounts(sortedTrackRows) {
  if (!Array.isArray(sortedTrackRows)) {
    return null;
  }

  const countsByPlaylistCode = new Map();

  for (const row of sortedTrackRows) {
    const playlistCode = row.playlist_code;
    if (!playlistCode) continue;

    if (!countsByPlaylistCode.has(playlistCode)) {
      countsByPlaylistCode.set(playlistCode, {
        playlist_code: playlistCode,
        count: 0,
        era_counts: emptyEraCounts(),
      });
    }

    const entry = countsByPlaylistCode.get(playlistCode);
    entry.count += 1;

    const era = eraForYear(releaseYearFromRawJson(row.raw_json));
    if (era) {
      entry.era_counts[era] += 1;
    }
  }

  return [...countsByPlaylistCode.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.playlist_code.localeCompare(b.playlist_code);
  });
}

function getEraCounts(sortedTrackRows) {
  if (!Array.isArray(sortedTrackRows)) {
    return null;
  }

  const counts = emptyEraCounts();

  for (const row of sortedTrackRows) {
    const era = eraForYear(releaseYearFromRawJson(row.raw_json));
    if (era) {
      counts[era] += 1;
    }
  }

  return ERA_KEYS.map((era) => ({ era, count: counts[era] }));
}

function getCrateStatus() {
  const db = openDatabase();
  const sortedTrackRows = getSortedTrackRowsForStatus(db);

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
    playlist_category_counts: getPlaylistCategoryCounts(sortedTrackRows),
    era_counts: getEraCounts(sortedTrackRows),
    last_sync_run: getLastCrateRunByStep(db, "syncLikedSongs"),
    last_sort_run: getLastCrateRunByStep(db, "sortTracks"),
    last_playlist_sync_run: getLastPlaylistSyncRun(db),
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getCrateStatus,
};
