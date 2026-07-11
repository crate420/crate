const { openDatabase } = require("../db");
const runs = require("../repositories/runs");
const { getArtistRecommendationDetail } = require("./artistIntelligenceRecommendations");
const { sortTracks } = require("./sortTracks");

function normalizeUserId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLimit(value, fallback = 25, maximum = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeArtistName(value) {
  return String(value || "").trim().toLowerCase();
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function requireUser(db, userId) {
  const user = db.prepare(`
    SELECT id AS user_id, spotify_user_id, display_name, email, created_at, updated_at
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!user) {
    const error = new Error("User was not found.");
    error.statusCode = 404;
    error.code = "user_not_found";
    throw error;
  }
  return user;
}

function readUserCounts(db, userId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_songs,
      SUM(CASE WHEN user_tracks.playlist_code IS NOT NULL THEN 1 ELSE 0 END) AS matched,
      SUM(CASE WHEN user_tracks.playlist_code IS NULL THEN 1 ELSE 0 END) AS unmatched
    FROM user_tracks
    WHERE user_id = ?
  `).get(userId);
  const total = Number(row?.total_songs || 0);
  const matched = Number(row?.matched || 0);
  const unmatched = Number(row?.unmatched || 0);
  return {
    total_songs: total,
    matched,
    unmatched,
    match_percent: total ? Math.round((matched / total) * 1000) / 10 : 0,
  };
}

function readUnmatchedRows(db, userId, options = {}) {
  const search = String(options.search || "").trim().toLowerCase();
  const rows = db.prepare(`
    SELECT
      user_tracks.track_id,
      tracks.spotify_track_id,
      tracks.name AS track_name,
      tracks.artist_names,
      tracks.album_name
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    WHERE user_tracks.user_id = ?
      AND user_tracks.playlist_code IS NULL
    ORDER BY tracks.artist_names COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC
  `).all(userId).map((row) => ({
    ...row,
    artist_names: parseJson(row.artist_names, []),
  }));
  if (!search) return rows;
  return rows.filter((row) => [row.track_name, row.album_name, ...(row.artist_names || [])].join(" ").toLowerCase().includes(search));
}

function readLastRun(db, userId, step) {
  if (!tableExists(db, "crate_runs")) return null;
  const rows = db.prepare(`
    SELECT id, status, summary_json, created_at, finished_at, updated_at
    FROM crate_runs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 20
  `).all(userId);
  return rows.find((row) => parseJson(row.summary_json, {}).step === step) || null;
}

function readUsersSummary(options = {}) {
  const db = openDatabase();
  const rows = db.prepare(`
    SELECT id AS user_id, spotify_user_id, display_name, email, created_at, updated_at
    FROM users
    ORDER BY COALESCE(display_name, email, spotify_user_id, id) COLLATE NOCASE ASC
  `).all();

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    users: rows.map((user) => {
      const counts = readUserCounts(db, user.user_id);
      const lastScan = readLastRun(db, user.user_id, "syncLikedSongs");
      const lastSort = readLastRun(db, user.user_id, "sortTracks") || readLastRun(db, user.user_id, "adminUserRecoveryRescan") || readLastRun(db, user.user_id, "adminGenreRecommendationRescan");
      return {
        ...user,
        name: user.display_name || user.email || user.spotify_user_id || `User #${user.user_id}`,
        ...counts,
        last_scan: lastScan?.finished_at || lastScan?.updated_at || lastScan?.created_at || null,
        last_sort: lastSort?.finished_at || lastSort?.updated_at || lastSort?.created_at || null,
        recovery_priority: counts.unmatched >= 100 ? "high" : counts.unmatched > 0 ? "normal" : "low",
      };
    }),
  };
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

function readArtistIntelligenceByName(db, artistNames) {
  const keys = [...new Set(artistNames.map(normalizeArtistName).filter(Boolean))];
  if (!keys.length || !tableExists(db, "artist_intelligence")) return new Map();
  const placeholders = keys.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT *
    FROM artist_intelligence
    WHERE normalized_artist_name IN (${placeholders})
       OR lower(trim(display_artist_name)) IN (${placeholders})
  `).all(...keys, ...keys);
  return new Map(rows.map((row) => [normalizeArtistName(row.normalized_artist_name || row.display_artist_name), row]));
}

function suggestedFixesFromDiagnostics(records, limit = 8) {
  const db = openDatabase();
  const artistCounts = countBy(records.flatMap((record) => record.artist_names || []), "artist");
  const intelligenceByArtist = readArtistIntelligenceByName(db, artistCounts.map((row) => row.artist));
  const fixes = [];

  for (const row of artistCounts) {
    const artist = intelligenceByArtist.get(normalizeArtistName(row.artist));
    if (!artist) continue;
    const detail = getArtistRecommendationDetail(artist.id);
    const recommendation = (detail?.recommendations || [])[0];
    if (!recommendation) continue;
    fixes.push({
      artist_intelligence_id: artist.id,
      artist: row.artist,
      suggested_genre: recommendation.genre,
      evidence: recommendation.sources || [],
      evidence_details: recommendation.source_details || [],
      estimated_recovery: row.count,
      status: "needs_review",
      confidence_score: recommendation.confidence_score,
      support_count: recommendation.support_count,
    });
    if (fixes.length >= limit) break;
  }

  return fixes;
}

function latestRecoveryRun(db, userId) {
  if (!tableExists(db, "crate_runs")) return null;
  const rows = db.prepare(`
    SELECT id, status, summary_json, created_at, finished_at, updated_at
    FROM crate_runs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 30
  `).all(userId);
  const row = rows.find((item) => {
    const summary = parseJson(item.summary_json, {});
    return ["adminUserRecoveryRescan", "adminGenreRecommendationRescan"].includes(summary.step);
  });
  if (!row) return null;
  return { ...row, summary: parseJson(row.summary_json, {}) };
}

async function getUserRecoverySummary(userId) {
  const db = openDatabase();
  const normalizedUserId = normalizeUserId(userId);
  const user = requireUser(db, normalizedUserId);
  const counts = readUserCounts(db, normalizedUserId);
  const unmatchedRows = counts.unmatched ? readUnmatchedRows(db, normalizedUserId) : [];
  const lastScan = readLastRun(db, normalizedUserId, "syncLikedSongs");
  const lastSort = readLastRun(db, normalizedUserId, "sortTracks") || readLastRun(db, normalizedUserId, "adminUserRecoveryRescan") || readLastRun(db, normalizedUserId, "adminGenreRecommendationRescan");

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    user: {
      ...user,
      name: user.display_name || user.email || user.spotify_user_id || `User #${user.user_id}`,
    },
    library: {
      ...counts,
      last_scan: lastScan?.finished_at || lastScan?.updated_at || lastScan?.created_at || null,
      last_sort: lastSort?.finished_at || lastSort?.updated_at || lastSort?.created_at || null,
    },
    top_unmatched_artists: countBy(unmatchedRows.flatMap((record) => record.artist_names || []), "artist").slice(0, 8),
    suggested_fixes: suggestedFixesFromDiagnostics(unmatchedRows, 5),
    latest_recovery: latestRecoveryRun(db, normalizedUserId),
    diagnostic_count: counts.unmatched,
  };
}

function groupedUnmatched(records) {
  const byArtist = new Map();
  for (const record of records) {
    const artist = (record.artist_names || [])[0] || "Unknown Artist";
    const key = normalizeArtistName(artist) || "unknown artist";
    const item = byArtist.get(key) || { artist, count: 0, tracks: [] };
    item.count += 1;
    if (item.tracks.length < 6) {
      item.tracks.push({
        track_id: record.track_id,
        track_name: record.track_name,
        artists: record.artist_names || [],
        album: record.album_name,
        reason: "unmatched",
      });
    }
    byArtist.set(key, item);
  }
  return [...byArtist.values()].sort((left, right) => right.count - left.count || left.artist.localeCompare(right.artist));
}

async function getUserRecoveryDetail(userId, options = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const section = String(options.section || "unmatched").trim().toLowerCase();
  const limit = normalizeLimit(options.limit, 25, 100);
  const offset = normalizeOffset(options.offset);
  const search = String(options.search || "").trim();
  const db = openDatabase();
  requireUser(db, normalizedUserId);

  if (section === "history") {
    const rows = tableExists(db, "crate_runs") ? db.prepare(`
      SELECT id, status, summary_json, created_at, finished_at, updated_at
      FROM crate_runs
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 25
    `).all(normalizedUserId).map((row) => ({ ...row, summary: parseJson(row.summary_json, {}) }))
      .filter((row) => ["adminUserRecoveryRescan", "adminGenreRecommendationRescan", "sortTracks"].includes(row.summary.step)) : [];
    return { status: "ok", user_id: normalizedUserId, section, history: rows };
  }

  const records = readUnmatchedRows(db, normalizedUserId, { search });
  if (section === "fixes") {
    const fixes = suggestedFixesFromDiagnostics(records, limit);
    return { status: "ok", user_id: normalizedUserId, section, fixes, total: fixes.length };
  }
  if (section !== "unmatched") {
    const error = new Error("Unsupported recovery detail section.");
    error.statusCode = 400;
    error.code = "unsupported_section";
    throw error;
  }
  const grouped = groupedUnmatched(records);
  return {
    status: "ok",
    user_id: normalizedUserId,
    section,
    total_unmatched_tracks: readUserCounts(db, normalizedUserId).unmatched,
    filtered_count: records.length,
    limit,
    offset,
    search,
    artists: grouped.slice(offset, offset + limit),
  };
}

function readUnmatchedSnapshot(db, userId) {
  return db.prepare(`
    SELECT
      user_tracks.track_id,
      tracks.name AS track_name,
      tracks.artist_names,
      tracks.album_name,
      user_tracks.playlist_code
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    WHERE user_tracks.user_id = ?
      AND user_tracks.playlist_code IS NULL
    ORDER BY tracks.artist_names COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC
  `).all(userId).map((row) => ({
    ...row,
    artist_names: parseJson(row.artist_names, []),
  }));
}

function readRecoveredTracks(db, userId, beforeRows) {
  if (!beforeRows.length) return [];
  const beforeById = new Map(beforeRows.map((row) => [row.track_id, row]));
  const placeholders = beforeRows.map(() => "?").join(", ");
  return db.prepare(`
    SELECT user_tracks.track_id, user_tracks.playlist_code
    FROM user_tracks
    WHERE user_tracks.user_id = ?
      AND user_tracks.track_id IN (${placeholders})
      AND user_tracks.playlist_code IS NOT NULL
  `).all(userId, ...beforeRows.map((row) => row.track_id)).map((row) => ({
    ...beforeById.get(row.track_id),
    playlist_code: row.playlist_code,
  }));
}

async function runUserRecoveryRescan(userId) {
  const db = openDatabase();
  const normalizedUserId = normalizeUserId(userId);
  requireUser(db, normalizedUserId);
  const beforeRows = readUnmatchedSnapshot(db, normalizedUserId);
  const beforeCounts = readUserCounts(db, normalizedUserId);
  const crateRun = runs.startRun(normalizedUserId);

  try {
    const sortSummary = await sortTracks(normalizedUserId, { skipSpotifyArtistFetch: true });
    const afterCounts = readUserCounts(db, normalizedUserId);
    const recoveredTracks = readRecoveredTracks(db, normalizedUserId, beforeRows);
    const recoveredArtists = countBy(recoveredTracks.flatMap((row) => row.artist_names || []), "artist");
    const summary = {
      step: "adminUserRecoveryRescan",
      before_unmatched: beforeCounts.unmatched,
      after_unmatched: afterCounts.unmatched,
      recovered_count: recoveredTracks.length,
      recovered_artists: recoveredArtists.slice(0, 50),
      recovered_tracks: recoveredTracks.slice(0, 100),
      sort_summary: sortSummary,
    };
    const finishedRun = runs.finishRun(crateRun.id, "success", summary);
    return {
      status: "ok",
      run_id: finishedRun.id,
      user_id: normalizedUserId,
      before_unmatched: beforeCounts.unmatched,
      after_unmatched: afterCounts.unmatched,
      recovered_count: recoveredTracks.length,
      recovered_artists: recoveredArtists,
      recovered_tracks: recoveredTracks,
    };
  } catch (err) {
    runs.finishRun(crateRun.id, "failed", { step: "adminUserRecoveryRescan", error: err.message });
    throw err;
  }
}

module.exports = {
  getUserRecoveryDetail,
  getUserRecoverySummary,
  readUsersSummary,
  runUserRecoveryRescan,
};
