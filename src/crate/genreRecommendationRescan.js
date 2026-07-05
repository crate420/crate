const { openDatabase } = require("../db");
const runs = require("../repositories/runs");
const trackRepo = require("../repositories/tracks");
const { sortTracks } = require("./sortTracks");

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
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

function normalizeUserIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => Number.parseInt(value, 10)).filter((value) => Number.isInteger(value) && value > 0))];
}

function readUserCounts(db, userId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_tracks,
      SUM(CASE WHEN user_tracks.playlist_code IS NOT NULL THEN 1 ELSE 0 END) AS matched_tracks,
      SUM(CASE WHEN user_tracks.playlist_code IS NULL THEN 1 ELSE 0 END) AS unmatched_tracks
    FROM user_tracks
    WHERE user_id = ?
  `).get(userId);
  const total = Number(row?.total_tracks || 0);
  const matched = Number(row?.matched_tracks || 0);
  const unmatched = Number(row?.unmatched_tracks || 0);
  return {
    user_id: userId,
    total_tracks: total,
    matched_tracks: matched,
    unmatched_tracks: unmatched,
    match_rate: total ? Math.round((matched / total) * 1000) / 10 : 0,
  };
}

function readUsersById(db) {
  return new Map(db.prepare("SELECT id, spotify_user_id, display_name, email FROM users ORDER BY id").all().map((row) => [row.id, row]));
}

function validateUserIds(db, userIds) {
  const usersById = readUsersById(db);
  const missingUserIds = userIds.filter((userId) => !usersById.has(userId));
  if (missingUserIds.length) {
    const error = new Error("Unknown user id(s): " + missingUserIds.join(", "));
    error.statusCode = 400;
    error.code = "unknown_users";
    throw error;
  }
}

function readAppliedPairs(db) {
  const pairs = new Set();
  if (!tableExists(db, "genre_recommendation_rescan_runs")) return pairs;
  const rows = db.prepare(`
    SELECT selected_user_ids_json, approval_ids_json
    FROM genre_recommendation_rescan_runs
    WHERE status = 'success'
  `).all();
  for (const row of rows) {
    const userIds = parseJson(row.selected_user_ids_json, []);
    const approvalIds = parseJson(row.approval_ids_json, []);
    for (const userId of userIds) {
      for (const approvalId of approvalIds) {
        pairs.add(Number(approvalId) + "::" + Number(userId));
      }
    }
  }
  return pairs;
}

function readApprovals(db) {
  if (!tableExists(db, "genre_recommendation_approvals")) return [];
  return db.prepare(`
    SELECT *
    FROM genre_recommendation_approvals
    ORDER BY created_at DESC, id DESC
  `).all();
}

function readCurrentUnmatchedByArtist(db) {
  const rows = db.prepare(`
    SELECT
      users.id AS user_id,
      users.spotify_user_id,
      users.display_name,
      users.email,
      tracks.id AS track_id,
      tracks.name AS track_name,
      tracks.artist_names,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN users ON users.id = user_tracks.user_id
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    WHERE user_tracks.playlist_code IS NULL
    ORDER BY users.id ASC, tracks.name COLLATE NOCASE ASC
  `).all();
  const byArtist = new Map();
  for (const row of rows) {
    let artistNames = [];
    try {
      const raw = JSON.parse(row.raw_json || "null");
      artistNames = Array.isArray(raw?.artists) ? raw.artists.map((artist) => artist.name).filter(Boolean) : [];
    } catch (err) {
      artistNames = [];
    }
    if (!artistNames.length) {
      artistNames = parseJson(row.artist_names, []);
    }
    for (const artistName of artistNames.length ? artistNames : ["Unknown Artist"]) {
      const key = normalizeArtistName(artistName);
      if (!key) continue;
      const record = byArtist.get(key) || { users: new Map(), track_ids: new Set(), sample_tracks: [] };
      const user = record.users.get(row.user_id) || {
        user_id: row.user_id,
        spotify_user_id: row.spotify_user_id || null,
        name: row.display_name || null,
        email: row.email || null,
        unmatched_tracks: 0,
        sample_tracks: [],
      };
      user.unmatched_tracks += 1;
      if (user.sample_tracks.length < 4) user.sample_tracks.push({ track_id: row.track_id, track_name: row.track_name });
      record.users.set(row.user_id, user);
      record.track_ids.add(row.track_id);
      if (record.sample_tracks.length < 6) record.sample_tracks.push({ user_id: row.user_id, track_id: row.track_id, track_name: row.track_name });
      byArtist.set(key, record);
    }
  }
  return byArtist;
}

function getAdminGenreRecommendationRescanPlan() {
  const db = openDatabase();
  const appliedPairs = readAppliedPairs(db);
  const unmatchedByArtist = readCurrentUnmatchedByArtist(db);
  const usersById = readUsersById(db);
  const approvals = [];
  const users = new Map();
  let estimatedTotalGain = 0;

  for (const approval of readApprovals(db)) {
    const unmatched = unmatchedByArtist.get(approval.normalized_artist_name);
    if (!unmatched) continue;
    const affectedUsers = [...unmatched.users.values()].filter((user) => !appliedPairs.has(approval.id + "::" + user.user_id));
    if (!affectedUsers.length) continue;
    const estimatedGain = affectedUsers.reduce((sum, user) => sum + Number(user.unmatched_tracks || 0), 0);
    estimatedTotalGain += estimatedGain;
    for (const user of affectedUsers) {
      const existing = users.get(user.user_id) || {
        user_id: user.user_id,
        spotify_user_id: user.spotify_user_id,
        name: user.name,
        email: user.email,
        pending_approval_count: 0,
        estimated_gain: 0,
        counts: readUserCounts(db, user.user_id),
      };
      existing.pending_approval_count += 1;
      existing.estimated_gain += Number(user.unmatched_tracks || 0);
      users.set(user.user_id, existing);
    }
    approvals.push({
      id: approval.id,
      artist: approval.artist_name,
      normalized_artist_name: approval.normalized_artist_name,
      recommended_playlist_code: approval.recommended_playlist_code,
      approved_genre: approval.approved_genre,
      confidence: approval.confidence,
      confidence_tier: approval.confidence_tier,
      estimated_gain: estimatedGain,
      evidence: parseJson(approval.evidence_json, []),
      created_at: approval.created_at,
      affected_users: affectedUsers,
      sample_tracks: unmatched.sample_tracks,
    });
  }

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    pending_approval_count: approvals.length,
    affected_user_count: users.size,
    estimated_total_gain: estimatedTotalGain,
    approvals,
    users: [...users.values()].sort((left, right) => right.estimated_gain - left.estimated_gain || left.user_id - right.user_id),
    recent_rescans: tableExists(db, "genre_recommendation_rescan_runs") ? db.prepare(`
      SELECT id, admin_user_id, admin_spotify_user_id, selected_user_ids_json, approval_ids_json, summary_json, status, started_at, finished_at
      FROM genre_recommendation_rescan_runs
      ORDER BY id DESC
      LIMIT 10
    `).all().map((row) => ({
      id: row.id,
      admin_user_id: row.admin_user_id,
      admin_spotify_user_id: row.admin_spotify_user_id,
      selected_user_ids: parseJson(row.selected_user_ids_json, []),
      approval_ids: parseJson(row.approval_ids_json, []),
      summary: parseJson(row.summary_json, {}),
      status: row.status,
      started_at: row.started_at,
      finished_at: row.finished_at,
    })) : [],
  };
}

function insertRescanRun(db, adminUser, userIds, approvalIds, beforeCounts) {
  const result = db.prepare(`
    INSERT INTO genre_recommendation_rescan_runs (
      admin_user_id,
      admin_spotify_user_id,
      selected_user_ids_json,
      approval_ids_json,
      before_counts_json,
      status
    ) VALUES (
      @adminUserId,
      @adminSpotifyUserId,
      @selectedUserIdsJson,
      @approvalIdsJson,
      @beforeCountsJson,
      'running'
    )
  `).run({
    adminUserId: adminUser?.id || null,
    adminSpotifyUserId: adminUser?.spotify_user_id || null,
    selectedUserIdsJson: JSON.stringify(userIds),
    approvalIdsJson: JSON.stringify(approvalIds),
    beforeCountsJson: JSON.stringify(beforeCounts),
  });
  return result.lastInsertRowid;
}

function finishRescanRun(db, runId, status, afterCounts, summary) {
  db.prepare(`
    UPDATE genre_recommendation_rescan_runs
    SET
      status = @status,
      after_counts_json = @afterCountsJson,
      summary_json = @summaryJson,
      finished_at = @finishedAt
    WHERE id = @runId
  `).run({
    runId,
    status,
    afterCountsJson: JSON.stringify(afterCounts),
    summaryJson: JSON.stringify(summary),
    finishedAt: new Date().toISOString(),
  });
}

async function runAdminGenreRecommendationRescan(options = {}) {
  const db = openDatabase();
  const selectedUserIds = normalizeUserIds(options.userIds);
  const manual = Boolean(options.manual);
  if (!selectedUserIds.length) {
    const error = new Error("Select at least one user to rescan.");
    error.statusCode = 400;
    error.code = "missing_users";
    throw error;
  }
  if (selectedUserIds.length > 25) {
    const error = new Error("Rescan is limited to 25 selected users per run.");
    error.statusCode = 400;
    error.code = "too_many_users";
    throw error;
  }

  const plan = getAdminGenreRecommendationRescanPlan();
  let userIds = selectedUserIds;
  let approvalIds = [];
  if (manual) {
    validateUserIds(db, userIds);
  } else {
    const allowedUserIds = new Set(plan.users.map((user) => user.user_id));
    userIds = selectedUserIds.filter((userId) => allowedUserIds.has(userId));
    if (!userIds.length) {
      const error = new Error("Selected users do not have pending approved recommendation gains.");
      error.statusCode = 400;
      error.code = "no_pending_user_gains";
      throw error;
    }
    approvalIds = plan.approvals
      .filter((approval) => approval.affected_users.some((user) => userIds.includes(user.user_id)))
      .map((approval) => approval.id);
  }
  const beforeCounts = userIds.map((userId) => readUserCounts(db, userId));
  const rescanRunId = insertRescanRun(db, options.adminUser, userIds, approvalIds, beforeCounts);
  const userResults = [];
  let status = "success";

  try {
    for (const userId of userIds) {
      const crateRun = runs.startRun(userId);
      try {
        console.log("[Genre Recommendation Rescan] user sort started", { admin_user_id: options.adminUser?.id || null, user_id: userId, rescan_run_id: rescanRunId });
        const summary = await sortTracks(userId);
        const finishedRun = runs.finishRun(crateRun.id, "success", { step: "adminGenreRecommendationRescan", ...summary });
        userResults.push({ user_id: userId, run_id: finishedRun.id, status: "success", processed: summary.processed, matched: summary.matched, unmatched: summary.unmatched });
      } catch (err) {
        status = "partial";
        runs.finishRun(crateRun.id, "failed", { step: "adminGenreRecommendationRescan", error: err.message });
        userResults.push({ user_id: userId, run_id: crateRun.id, status: "failed", error: err.message });
      }
    }

    const afterCounts = userIds.map((userId) => readUserCounts(db, userId));
    const beforeByUser = new Map(beforeCounts.map((row) => [row.user_id, row]));
    const results = afterCounts.map((after) => {
      const before = beforeByUser.get(after.user_id);
      const actualGain = Number(before?.unmatched_tracks || 0) - Number(after.unmatched_tracks || 0);
      const estimated = manual ? 0 : plan.users.find((user) => user.user_id === after.user_id)?.estimated_gain || 0;
      return { user_id: after.user_id, before, after, estimated_gain: estimated, actual_gain: actualGain };
    });
    const summary = {
      manual,
      selected_user_count: userIds.length,
      approval_count: approvalIds.length,
      estimated_gain: results.reduce((sum, row) => sum + Number(row.estimated_gain || 0), 0),
      actual_gain: results.reduce((sum, row) => sum + Number(row.actual_gain || 0), 0),
      user_results: userResults,
      results,
    };
    finishRescanRun(db, rescanRunId, status, afterCounts, summary);
    console.log("[Genre Recommendation Rescan] complete", { rescan_run_id: rescanRunId, admin_user_id: options.adminUser?.id || null, selected_user_ids: userIds, approval_ids: approvalIds, status, estimated_gain: summary.estimated_gain, actual_gain: summary.actual_gain });
    return { status: "ok", rescan_run_id: rescanRunId, ...summary };
  } catch (err) {
    finishRescanRun(db, rescanRunId, "failed", [], { error: err.message, selected_user_ids: userIds, approval_ids: approvalIds });
    throw err;
  }
}

module.exports = {
  getAdminGenreRecommendationRescanPlan,
  runAdminGenreRecommendationRescan,
};
