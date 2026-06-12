const { openDatabase } = require("../db");

function serializeJson(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function upsertTrackLearningProfile(profile) {
  const now = new Date().toISOString();
  const db = openDatabase();

  db.prepare(`
    INSERT INTO track_learning_profiles (
      track_id,
      spotify_track_id,
      identity_key,
      profile_version,
      current_playlist_code,
      top_candidate_playlist_code,
      confidence_score,
      confidence_tier,
      source_count,
      would_change_if_learning_active,
      has_specialty_match,
      has_conflict,
      user_occurrence_count,
      unmatched_occurrence_count,
      derived_profile_json,
      evidence_summary_json,
      playlist_candidates_json,
      specialty_matches_json,
      generated_at,
      updated_at
    )
    VALUES (
      @trackId,
      @spotifyTrackId,
      @identityKey,
      @profileVersion,
      @currentPlaylistCode,
      @topCandidatePlaylistCode,
      @confidenceScore,
      @confidenceTier,
      @sourceCount,
      @wouldChangeIfLearningActive,
      @hasSpecialtyMatch,
      @hasConflict,
      @userOccurrenceCount,
      @unmatchedOccurrenceCount,
      @derivedProfileJson,
      @evidenceSummaryJson,
      @playlistCandidatesJson,
      @specialtyMatchesJson,
      @now,
      @now
    )
    ON CONFLICT(track_id) DO UPDATE SET
      spotify_track_id = excluded.spotify_track_id,
      identity_key = excluded.identity_key,
      profile_version = excluded.profile_version,
      current_playlist_code = excluded.current_playlist_code,
      top_candidate_playlist_code = excluded.top_candidate_playlist_code,
      confidence_score = excluded.confidence_score,
      confidence_tier = excluded.confidence_tier,
      source_count = excluded.source_count,
      would_change_if_learning_active = excluded.would_change_if_learning_active,
      has_specialty_match = excluded.has_specialty_match,
      has_conflict = excluded.has_conflict,
      user_occurrence_count = excluded.user_occurrence_count,
      unmatched_occurrence_count = excluded.unmatched_occurrence_count,
      derived_profile_json = excluded.derived_profile_json,
      evidence_summary_json = excluded.evidence_summary_json,
      playlist_candidates_json = excluded.playlist_candidates_json,
      specialty_matches_json = excluded.specialty_matches_json,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at
  `).run({
    trackId: profile.track_id,
    spotifyTrackId: profile.spotify_track_id || null,
    identityKey: profile.identity_key || null,
    profileVersion: profile.profile_version || "v1",
    currentPlaylistCode: profile.current_playlist_code || null,
    topCandidatePlaylistCode: profile.top_candidate_playlist_code || null,
    confidenceScore: normalizeInteger(profile.confidence_score),
    confidenceTier: profile.confidence_tier || "none",
    sourceCount: normalizeInteger(profile.source_count),
    wouldChangeIfLearningActive: profile.would_change_if_learning_active ? 1 : 0,
    hasSpecialtyMatch: profile.has_specialty_match ? 1 : 0,
    hasConflict: profile.has_conflict ? 1 : 0,
    userOccurrenceCount: normalizeInteger(profile.user_occurrence_count),
    unmatchedOccurrenceCount: normalizeInteger(profile.unmatched_occurrence_count),
    derivedProfileJson: serializeJson(profile.derived_profile, {}),
    evidenceSummaryJson: serializeJson(profile.evidence_summary, {}),
    playlistCandidatesJson: serializeJson(profile.playlist_candidates, []),
    specialtyMatchesJson: serializeJson(profile.specialty_matches, []),
    now,
  });

  return getTrackLearningProfile(profile.track_id);
}

function getTrackLearningProfile(trackId) {
  const parsed = Number.parseInt(trackId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  const row = openDatabase()
    .prepare("SELECT * FROM track_learning_profiles WHERE track_id = ?")
    .get(parsed);
  return row ? serializeProfileRow(row) : undefined;
}

function serializeProfileRow(row) {
  return {
    ...row,
    would_change_if_learning_active: Boolean(row.would_change_if_learning_active),
    has_specialty_match: Boolean(row.has_specialty_match),
    has_conflict: Boolean(row.has_conflict),
    derived_profile: parseJson(row.derived_profile_json, {}),
    evidence_summary: parseJson(row.evidence_summary_json, {}),
    playlist_candidates: parseJson(row.playlist_candidates_json, []),
    specialty_matches: parseJson(row.specialty_matches_json, []),
  };
}

function listTrackLearningProfiles({ limit = 100, offset = 0, confidenceTier = "", playlistCode = "", unmatchedOnly = false } = {}) {
  const clauses = [];
  const params = {
    limit: Math.max(1, Math.min(500, normalizeInteger(limit, 100))),
    offset: Math.max(0, normalizeInteger(offset, 0)),
  };

  if (confidenceTier) {
    clauses.push("confidence_tier = @confidenceTier");
    params.confidenceTier = confidenceTier;
  }
  if (playlistCode) {
    clauses.push("(current_playlist_code = @playlistCode OR top_candidate_playlist_code = @playlistCode)");
    params.playlistCode = playlistCode;
  }
  if (unmatchedOnly) {
    clauses.push("unmatched_occurrence_count > 0");
  }

  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const rows = openDatabase().prepare(`
    SELECT *
    FROM track_learning_profiles
    ${where}
    ORDER BY
      would_change_if_learning_active DESC,
      unmatched_occurrence_count DESC,
      confidence_score DESC,
      updated_at DESC
    LIMIT @limit
    OFFSET @offset
  `).all(params);

  return rows.map(serializeProfileRow);
}

function getTrackLearningProfileSummary() {
  const db = openDatabase();
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_profiles,
      SUM(CASE WHEN confidence_tier = 'high' THEN 1 ELSE 0 END) AS high_confidence,
      SUM(CASE WHEN confidence_tier = 'strong' THEN 1 ELSE 0 END) AS strong_confidence,
      SUM(CASE WHEN confidence_tier = 'review' THEN 1 ELSE 0 END) AS review_confidence,
      SUM(CASE WHEN confidence_tier = 'weak' THEN 1 ELSE 0 END) AS weak_confidence,
      SUM(CASE WHEN confidence_tier = 'none' THEN 1 ELSE 0 END) AS no_confidence,
      SUM(CASE WHEN unmatched_occurrence_count > 0 THEN 1 ELSE 0 END) AS unmatched_with_profiles,
      SUM(CASE WHEN unmatched_occurrence_count > 0 AND source_count > 0 THEN 1 ELSE 0 END) AS unmatched_with_derived_evidence,
      SUM(CASE WHEN would_change_if_learning_active = 1 THEN 1 ELSE 0 END) AS would_change_if_learning_active,
      SUM(CASE WHEN has_specialty_match = 1 THEN 1 ELSE 0 END) AS profiles_with_specialty_matches,
      SUM(CASE WHEN has_conflict = 1 THEN 1 ELSE 0 END) AS profiles_with_conflicts,
      MAX(generated_at) AS latest_generated_at
    FROM track_learning_profiles
  `).get();

  return {
    total_profiles: summary.total_profiles || 0,
    confidence_tiers: {
      high: summary.high_confidence || 0,
      strong: summary.strong_confidence || 0,
      review: summary.review_confidence || 0,
      weak: summary.weak_confidence || 0,
      none: summary.no_confidence || 0,
    },
    unmatched_with_profiles: summary.unmatched_with_profiles || 0,
    unmatched_with_derived_evidence: summary.unmatched_with_derived_evidence || 0,
    would_change_if_learning_active: summary.would_change_if_learning_active || 0,
    profiles_with_specialty_matches: summary.profiles_with_specialty_matches || 0,
    profiles_with_conflicts: summary.profiles_with_conflicts || 0,
    latest_generated_at: summary.latest_generated_at || null,
  };
}

module.exports = {
  getTrackLearningProfile,
  getTrackLearningProfileSummary,
  listTrackLearningProfiles,
  upsertTrackLearningProfile,
};
