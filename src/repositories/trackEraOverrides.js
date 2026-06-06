const { openDatabase } = require("../db");

function normalizeYear(value, fieldName) {
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 1800 || year > 2100) {
    const err = new Error(`${fieldName} must be a year between 1800 and 2100.`);
    err.statusCode = 400;
    err.code = "invalid_release_year";
    throw err;
  }
  return year;
}

function normalizeTrackId(value) {
  const trackId = Number.parseInt(value, 10);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    const err = new Error("track_id is required.");
    err.statusCode = 400;
    err.code = "invalid_track_id";
    throw err;
  }
  return trackId;
}

function normalizeConfidence(value) {
  const confidence = String(value || "medium").trim().toLowerCase();
  return ["high", "medium", "low"].includes(confidence) ? confidence : "medium";
}

function findByTrackId(trackId) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM track_era_overrides
      WHERE track_id = ?
    `)
    .get(trackId);
}

function listTrackEraOverrides({ limit = 250, offset = 0 } = {}) {
  return openDatabase()
    .prepare(`
      SELECT
        track_era_overrides.*,
        tracks.spotify_track_id,
        tracks.name AS track_name,
        tracks.artist_names,
        tracks.album_name
      FROM track_era_overrides
      INNER JOIN tracks ON tracks.id = track_era_overrides.track_id
      ORDER BY track_era_overrides.updated_at DESC
      LIMIT @limit
      OFFSET @offset
    `)
    .all({ limit, offset });
}

function upsertTrackEraOverride({
  trackId,
  spotifyReleaseYear,
  originalReleaseYear,
  effectiveReleaseYear,
  source,
  reason,
  confidence,
}) {
  const now = new Date().toISOString();
  const payload = {
    trackId: normalizeTrackId(trackId),
    spotifyReleaseYear: spotifyReleaseYear ? normalizeYear(spotifyReleaseYear, "spotify_release_year") : null,
    originalReleaseYear: normalizeYear(originalReleaseYear, "original_release_year"),
    effectiveReleaseYear: normalizeYear(effectiveReleaseYear, "effective_release_year"),
    source: String(source || "manual_admin").trim() || "manual_admin",
    reason: String(reason || "").trim() || null,
    confidence: normalizeConfidence(confidence),
    now,
  };

  openDatabase()
    .prepare(`
      INSERT INTO track_era_overrides (
        track_id,
        spotify_release_year,
        original_release_year,
        effective_release_year,
        source,
        reason,
        confidence,
        created_at,
        updated_at
      )
      VALUES (
        @trackId,
        @spotifyReleaseYear,
        @originalReleaseYear,
        @effectiveReleaseYear,
        @source,
        @reason,
        @confidence,
        @now,
        @now
      )
      ON CONFLICT(track_id) DO UPDATE SET
        spotify_release_year = excluded.spotify_release_year,
        original_release_year = excluded.original_release_year,
        effective_release_year = excluded.effective_release_year,
        source = excluded.source,
        reason = excluded.reason,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `)
    .run(payload);

  return findByTrackId(payload.trackId);
}

function deleteTrackEraOverride(trackId) {
  return openDatabase()
    .prepare(`
      DELETE FROM track_era_overrides
      WHERE track_id = ?
    `)
    .run(trackId);
}

module.exports = {
  deleteTrackEraOverride,
  findByTrackId,
  listTrackEraOverrides,
  upsertTrackEraOverride,
};
