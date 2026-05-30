const { openDatabase } = require("../db");

function normalizeArtistName(name) {
  return String(name || "").trim().toLowerCase();
}

function requireArtistName(artistName) {
  const displayArtistName = String(artistName || "").trim();
  const normalizedArtistName = normalizeArtistName(displayArtistName);

  if (!normalizedArtistName) {
    throw new Error("artistName is required.");
  }

  return { displayArtistName, normalizedArtistName };
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function serializeJson(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function getArtistIntelligenceByName(artistName) {
  const normalizedArtistName = normalizeArtistName(artistName);

  if (!normalizedArtistName) {
    return undefined;
  }

  return openDatabase()
    .prepare(`
      SELECT *
      FROM artist_intelligence
      WHERE normalized_artist_name = ?
    `)
    .get(normalizedArtistName);
}

function getArtistIntelligenceById(id) {
  const parsedId = Number.parseInt(id, 10);

  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return undefined;
  }

  return openDatabase()
    .prepare(`
      SELECT *
      FROM artist_intelligence
      WHERE id = ?
    `)
    .get(parsedId);
}

function getOrCreateArtistIntelligence({ artistName, spotifyArtistId = null }) {
  const { displayArtistName, normalizedArtistName } = requireArtistName(artistName);
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      INSERT INTO artist_intelligence (
        normalized_artist_name,
        display_artist_name,
        spotify_artist_id,
        created_at,
        updated_at
      )
      VALUES (
        @normalizedArtistName,
        @displayArtistName,
        @spotifyArtistId,
        @now,
        @now
      )
      ON CONFLICT(normalized_artist_name) DO UPDATE SET
        display_artist_name = excluded.display_artist_name,
        spotify_artist_id = COALESCE(excluded.spotify_artist_id, artist_intelligence.spotify_artist_id),
        updated_at = excluded.updated_at
    `)
    .run({
      normalizedArtistName,
      displayArtistName,
      spotifyArtistId: normalizeOptionalText(spotifyArtistId),
      now,
    });

  return getArtistIntelligenceByName(normalizedArtistName);
}

function listArtistIntelligence({ limit = 100, offset = 0, reviewStatus, search } = {}) {
  const normalizedLimit = Math.min(normalizePositiveInteger(limit, 100), 500);
  const parsedOffset = Number.parseInt(offset, 10);
  const normalizedOffset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const normalizedReviewStatus = normalizeOptionalText(reviewStatus);
  const normalizedSearch = normalizeOptionalText(search);
  const db = openDatabase();
  const clauses = [];
  const params = { limit: normalizedLimit, offset: normalizedOffset };

  if (normalizedReviewStatus) {
    clauses.push("review_status = @reviewStatus");
    params.reviewStatus = normalizedReviewStatus;
  }

  if (normalizedSearch) {
    clauses.push("display_artist_name LIKE @search COLLATE NOCASE");
    params.search = `%${normalizedSearch}%`;
  }

  return db
    .prepare(`
      SELECT *
      FROM artist_intelligence
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY display_artist_name COLLATE NOCASE ASC
      LIMIT @limit OFFSET @offset
    `)
    .all(params);
}

function getArtistIntelligenceSummary({ reviewStatus, search } = {}) {
  const normalizedReviewStatus = normalizeOptionalText(reviewStatus);
  const normalizedSearch = normalizeOptionalText(search);
  const clauses = [];
  const params = {};

  if (normalizedReviewStatus) {
    clauses.push("review_status = @reviewStatus");
    params.reviewStatus = normalizedReviewStatus;
  }

  if (normalizedSearch) {
    clauses.push("display_artist_name LIKE @search COLLATE NOCASE");
    params.search = `%${normalizedSearch}%`;
  }

  return openDatabase()
    .prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN review_status = 'reviewed' THEN 1 ELSE 0 END), 0) AS reviewed,
        COALESCE(SUM(CASE WHEN source_count > 0 THEN 1 ELSE 0 END), 0) AS with_sources
      FROM artist_intelligence
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    `)
    .get(params);
}

function refreshArtistIntelligenceStats(artistIntelligenceId) {
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      UPDATE artist_intelligence
      SET
        source_count = (
          SELECT COUNT(*)
          FROM artist_intelligence_sources
          WHERE artist_intelligence_id = @artistIntelligenceId
        ),
        updated_at = @now
      WHERE id = @artistIntelligenceId
    `)
    .run({ artistIntelligenceId, now });

  return openDatabase()
    .prepare(`
      SELECT *
      FROM artist_intelligence
      WHERE id = ?
    `)
    .get(artistIntelligenceId);
}

function upsertArtistIntelligenceSource({
  artistIntelligenceId,
  source,
  sourceArtistId = null,
  sourceArtistName = null,
  rawPayload,
  normalizedSignals = [],
  errorCode = null,
  errorMessage = null,
  fetchedAt = new Date().toISOString(),
  expiresAt = null,
}) {
  const normalizedSource = String(source || "").trim();

  if (!artistIntelligenceId || !normalizedSource) {
    throw new Error("artistIntelligenceId and source are required.");
  }

  const now = new Date().toISOString();
  const db = openDatabase();

  db.prepare(`
    INSERT INTO artist_intelligence_sources (
      artist_intelligence_id,
      source,
      source_artist_id,
      source_artist_name,
      raw_payload_json,
      normalized_signals_json,
      error_code,
      error_message,
      fetched_at,
      expires_at,
      updated_at
    )
    VALUES (
      @artistIntelligenceId,
      @source,
      @sourceArtistId,
      @sourceArtistName,
      @rawPayloadJson,
      @normalizedSignalsJson,
      @errorCode,
      @errorMessage,
      @fetchedAt,
      @expiresAt,
      @now
    )
    ON CONFLICT(artist_intelligence_id, source) DO UPDATE SET
      source_artist_id = excluded.source_artist_id,
      source_artist_name = excluded.source_artist_name,
      raw_payload_json = excluded.raw_payload_json,
      normalized_signals_json = excluded.normalized_signals_json,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run({
    artistIntelligenceId,
    source: normalizedSource,
    sourceArtistId: normalizeOptionalText(sourceArtistId),
    sourceArtistName: normalizeOptionalText(sourceArtistName),
    rawPayloadJson: serializeJson(rawPayload, {}),
    normalizedSignalsJson: serializeJson(normalizedSignals, []),
    errorCode: normalizeOptionalText(errorCode),
    errorMessage: normalizeOptionalText(errorMessage),
    fetchedAt,
    expiresAt,
    now,
  });

  refreshArtistIntelligenceStats(artistIntelligenceId);

  return db
    .prepare(`
      SELECT *
      FROM artist_intelligence_sources
      WHERE artist_intelligence_id = ? AND source = ?
    `)
    .get(artistIntelligenceId, normalizedSource);
}

function listArtistIntelligenceSources(artistIntelligenceId) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM artist_intelligence_sources
      WHERE artist_intelligence_id = ?
      ORDER BY source COLLATE NOCASE ASC
    `)
    .all(artistIntelligenceId);
}

module.exports = {
  getArtistIntelligenceById,
  getArtistIntelligenceByName,
  getArtistIntelligenceSummary,
  getOrCreateArtistIntelligence,
  listArtistIntelligence,
  listArtistIntelligenceSources,
  normalizeArtistName,
  refreshArtistIntelligenceStats,
  upsertArtistIntelligenceSource,
};
