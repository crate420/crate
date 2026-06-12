const { openDatabase } = require("../db");
const { getAdminGenreRecommendations } = require("./genreRecommendations");

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

function roundOne(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function readApprovals(db) {
  if (!tableExists(db, "genre_recommendation_approvals")) return [];
  return db.prepare(`
    SELECT *
    FROM genre_recommendation_approvals
    ORDER BY created_at DESC, id DESC
  `).all().map((row) => ({
    ...row,
    evidence: parseJson(row.evidence_json, []),
    estimated_gain: Number(row.estimated_gain || 0),
    confidence: Number(row.confidence || 0),
  }));
}

function readRescanRuns(db) {
  if (!tableExists(db, "genre_recommendation_rescan_runs")) return [];
  return db.prepare(`
    SELECT *
    FROM genre_recommendation_rescan_runs
    WHERE status IN ('success', 'partial')
    ORDER BY started_at ASC, id ASC
  `).all().map((row) => ({
    ...row,
    selected_user_ids: parseJson(row.selected_user_ids_json, []),
    approval_ids: parseJson(row.approval_ids_json, []),
    before_counts: parseJson(row.before_counts_json, []),
    after_counts: parseJson(row.after_counts_json, []),
    summary: parseJson(row.summary_json, {}),
  }));
}

function sourceNames(approval) {
  const sources = new Set();
  for (const item of approval.evidence || []) {
    if (item?.source) sources.add(item.source);
  }
  return [...sources].sort();
}

function addMetric(map, key, patch) {
  const row = map.get(key) || {
    key,
    approvals: 0,
    rescanned_approvals: 0,
    estimated_gain: 0,
    actual_gain: 0,
    zero_gain_approvals: 0,
  };
  row.approvals += patch.approvals || 0;
  row.rescanned_approvals += patch.rescanned_approvals || 0;
  row.estimated_gain += patch.estimated_gain || 0;
  row.actual_gain += patch.actual_gain || 0;
  row.zero_gain_approvals += patch.zero_gain_approvals || 0;
  map.set(key, row);
}

function finalizeMetric(row) {
  return {
    ...row,
    estimated_gain: roundOne(row.estimated_gain),
    actual_gain: roundOne(row.actual_gain),
    accuracy_percent: row.estimated_gain > 0 ? Math.round((row.actual_gain / row.estimated_gain) * 1000) / 10 : null,
  };
}

function attributionForRun(run, approvalsById) {
  const approvalIds = [...new Set((run.approval_ids || []).map((id) => Number(id)).filter(Boolean))];
  const approvals = approvalIds.map((id) => approvalsById.get(id)).filter(Boolean);
  if (!approvals.length) return [];

  const actualGain = Number(run.summary?.actual_gain || 0);
  const estimatedGain = Number(run.summary?.estimated_gain || approvals.reduce((sum, row) => sum + Number(row.estimated_gain || 0), 0));
  const denominator = approvals.reduce((sum, row) => sum + Math.max(1, Number(row.estimated_gain || 0)), 0) || approvals.length;
  const single = approvals.length === 1;

  return approvals.map((approval) => {
    const weight = single ? 1 : Math.max(1, Number(approval.estimated_gain || 0)) / denominator;
    return {
      approval,
      run_id: run.id,
      actual_gain: single ? actualGain : actualGain * weight,
      run_estimated_gain: estimatedGain,
      attribution_method: single ? "exact_single_approval_run" : "proportional_multi_approval_run",
    };
  });
}

async function getAdminRecommendationImpact() {
  const db = openDatabase();
  const approvals = readApprovals(db);
  const rescans = readRescanRuns(db);
  const approvalsById = new Map(approvals.map((approval) => [approval.id, approval]));
  const impactByApprovalId = new Map(approvals.map((approval) => [approval.id, {
    approval,
    actual_gain: 0,
    rescan_count: 0,
    attribution_methods: new Set(),
  }]));
  const rescanTotals = { estimated_gain: 0, actual_gain: 0, runs: rescans.length };

  for (const run of rescans) {
    rescanTotals.estimated_gain += Number(run.summary?.estimated_gain || 0);
    rescanTotals.actual_gain += Number(run.summary?.actual_gain || 0);
    for (const item of attributionForRun(run, approvalsById)) {
      const row = impactByApprovalId.get(item.approval.id);
      if (!row) continue;
      row.actual_gain += item.actual_gain;
      row.rescan_count += 1;
      row.attribution_methods.add(item.attribution_method);
    }
  }

  const sourceMetrics = new Map();
  const playlistMetrics = new Map();
  const artistMetrics = new Map();
  const zeroGainApprovals = [];

  for (const approval of approvals) {
    const impact = impactByApprovalId.get(approval.id);
    const actualGain = roundOne(impact?.actual_gain || 0);
    const rescanned = Boolean(impact?.rescan_count);
    const zeroGain = rescanned && Number(approval.estimated_gain || 0) > 0 && actualGain <= 0;
    const metricPatch = {
      approvals: 1,
      rescanned_approvals: rescanned ? 1 : 0,
      estimated_gain: Number(approval.estimated_gain || 0),
      actual_gain: actualGain,
      zero_gain_approvals: zeroGain ? 1 : 0,
    };

    addMetric(playlistMetrics, approval.recommended_playlist_code, metricPatch);
    addMetric(artistMetrics, approval.normalized_artist_name, metricPatch);
    const artistMetric = artistMetrics.get(approval.normalized_artist_name);
    artistMetric.artist = approval.artist_name;
    artistMetric.approved_genres = [...new Set([...(artistMetric.approved_genres || []), approval.approved_genre])];
    artistMetric.playlist_codes = [...new Set([...(artistMetric.playlist_codes || []), approval.recommended_playlist_code])];

    const sources = sourceNames(approval);
    if (!sources.length) addMetric(sourceMetrics, "unknown", metricPatch);
    for (const source of sources) addMetric(sourceMetrics, source, metricPatch);

    if (zeroGain) {
      zeroGainApprovals.push({
        approval_id: approval.id,
        artist: approval.artist_name,
        approved_genre: approval.approved_genre,
        playlist_code: approval.recommended_playlist_code,
        confidence: approval.confidence,
        confidence_tier: approval.confidence_tier,
        estimated_gain: approval.estimated_gain,
        actual_gain: actualGain,
        sources,
        created_at: approval.created_at,
      });
    }
  }

  const pending = await getAdminGenreRecommendations({ limit: 500 });
  const pendingRecommendations = (pending.recommendations || [])
    .sort((left, right) => {
      if (right.estimated_gain !== left.estimated_gain) return right.estimated_gain - left.estimated_gain;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
      return left.artist.localeCompare(right.artist);
    })
    .slice(0, 50);

  const totalRecovered = roundOne(rescanTotals.actual_gain);
  const totalEstimated = roundOne(rescanTotals.estimated_gain);
  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    attribution_note: "Actual gain is exact at the rescan-run level. Per-artist/source/lane gain is exact for single-approval rescans and proportional for multi-approval rescans.",
    summary: {
      total_approvals: approvals.length,
      total_rescan_runs: rescans.length,
      total_recovered_tracks: totalRecovered,
      total_estimated_gain_from_rescans: totalEstimated,
      estimate_accuracy_percent: totalEstimated > 0 ? Math.round((totalRecovered / totalEstimated) * 1000) / 10 : null,
      zero_gain_approval_count: zeroGainApprovals.length,
      pending_recommendation_count: pending.recommendation_count || 0,
      pending_estimated_gain: pending.estimated_total_match_gain || 0,
    },
    top_approved_artists_by_actual_gain: [...artistMetrics.values()].map(finalizeMetric).sort((a, b) => b.actual_gain - a.actual_gain || b.estimated_gain - a.estimated_gain || String(a.artist).localeCompare(String(b.artist))).slice(0, 25),
    zero_gain_approvals: zeroGainApprovals.sort((a, b) => b.estimated_gain - a.estimated_gain || b.confidence - a.confidence).slice(0, 50),
    source_performance: [...sourceMetrics.values()].map(finalizeMetric).sort((a, b) => b.actual_gain - a.actual_gain || b.estimated_gain - a.estimated_gain || a.key.localeCompare(b.key)),
    playlist_lane_performance: [...playlistMetrics.values()].map(finalizeMetric).sort((a, b) => b.actual_gain - a.actual_gain || b.estimated_gain - a.estimated_gain || a.key.localeCompare(b.key)),
    remaining_pending_recommendations: pendingRecommendations,
    recent_rescans: rescans.slice(-10).reverse().map((run) => ({
      id: run.id,
      status: run.status,
      selected_user_ids: run.selected_user_ids,
      approval_ids: run.approval_ids,
      estimated_gain: Number(run.summary?.estimated_gain || 0),
      actual_gain: Number(run.summary?.actual_gain || 0),
      finished_at: run.finished_at,
    })),
  };
}

module.exports = {
  getAdminRecommendationImpact,
};
