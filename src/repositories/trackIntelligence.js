const { openDatabase } = require("../db");

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeSpotifyTrackId(value) {
  return normalizeOptionalText(value);
}

function normalizeIsrc(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function buildTrackIdentityKey({ spotifyTrackId, isrc, artistName, trackName }) {
  const spotifyId = normalizeSpotifyTrackId(spotifyTrackId);
  const normalizedIsrc = normalizeIsrc(isrc);
  const normalizedArtistName = normalizeText(artistName);
  const normalizedTrackName = normalizeText(trackName);

  if (spotifyId) return `spotify:${spotifyId}`;
  if (normalizedIsrc) return `isrc:${normalizedIsrc}`;
  return `artist_track:${normalizedArtistName}:${normalizedTrackName}`;
}

function requireTrackIdentity({ trackName, artistName, spotifyTrackId = null, isrc = null }) {
  const displayTrackName = String(trackName || "").trim();
  const displayArtistName = String(artistName || "").trim();
  const normalizedTrackName = normalizeText(displayTrackName);
  const normalizedArtistName = normalizeText(displayArtistName);

  if (!normalizedTrackName || !normalizedArtistName) {
    throw new Error("trackName and artistName are required.");
  }

  return {
    identityKey: buildTrackIdentityKey({ spotifyTrackId, isrc, artistName: displayArtistName, trackName: displayTrackName }),
    displayTrackName,
    displayArtistName,
    normalizedTrackName,
    normalizedArtistName,
    spotifyTrackId: normalizeSpotifyTrackId(spotifyTrackId),
    isrc: normalizeIsrc(isrc),
  };
}

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

function getTrackIntelligenceByIdentityKey(identityKey) {
  const key = String(identityKey || "").trim();
  if (!key) return undefined;
  return openDatabase()
    .prepare("SELECT * FROM track_intelligence WHERE identity_key = ?")
    .get(key);
}

function getTrackIntelligenceById(id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return openDatabase()
    .prepare("SELECT * FROM track_intelligence WHERE id = ?")
    .get(parsed);
}

function getOrCreateTrackIntelligence({ trackName, artistName, spotifyTrackId = null, isrc = null }) {
  const identity = requireTrackIdentity({ trackName, artistName, spotifyTrackId, isrc });
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      INSERT INTO track_intelligence (
        identity_key,
        track_name,
        artist_name,
        normalized_track_name,
        normalized_artist_name,
        spotify_track_id,
        isrc,
        created_at,
        updated_at
      )
      VALUES (
        @identityKey,
        @displayTrackName,
        @displayArtistName,
        @normalizedTrackName,
        @normalizedArtistName,
        @spotifyTrackId,
        @isrc,
        @now,
        @now
      )
      ON CONFLICT(identity_key) DO UPDATE SET
        track_name = excluded.track_name,
        artist_name = excluded.artist_name,
        spotify_track_id = COALESCE(excluded.spotify_track_id, track_intelligence.spotify_track_id),
        isrc = COALESCE(excluded.isrc, track_intelligence.isrc),
        updated_at = excluded.updated_at
    `)
    .run({ ...identity, now });

  return getTrackIntelligenceByIdentityKey(identity.identityKey);
}

function listTrackIntelligenceSources(trackIntelligenceId) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM track_intelligence_sources
      WHERE track_intelligence_id = ?
      ORDER BY source COLLATE NOCASE ASC
    `)
    .all(trackIntelligenceId);
}

function calculateTrackConfidence(sources) {
  const usableSources = sources.filter((source) => !source.error_code);
  if (usableSources.length === 0) return 0;

  const signalCount = usableSources.reduce((sum, source) => sum + parseJson(source.normalized_signals_json, []).length, 0);
  const metadataCount = usableSources.reduce((sum, source) => {
    const metadata = parseJson(source.metadata_json, {});
    return sum + Object.values(metadata).filter((value) => value !== null && value !== undefined && value !== "").length;
  }, 0);

  return Math.min(95, 35 + (usableSources.length * 20) + Math.min(signalCount * 3, 30) + Math.min(metadataCount * 2, 10));
}

function refreshTrackIntelligenceStats(trackIntelligenceId) {
  const now = new Date().toISOString();
  const sources = listTrackIntelligenceSources(trackIntelligenceId);
  const sourceCount = sources.filter((source) => !source.error_code).length;
  const confidenceScore = calculateTrackConfidence(sources);
  const lastRefreshedAt = sources
    .map((source) => source.fetched_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  openDatabase()
    .prepare(`
      UPDATE track_intelligence
      SET
        source_count = @sourceCount,
        confidence_score = @confidenceScore,
        last_refreshed_at = @lastRefreshedAt,
        updated_at = @now
      WHERE id = @trackIntelligenceId
    `)
    .run({ trackIntelligenceId, sourceCount, confidenceScore, lastRefreshedAt, now });

  return getTrackIntelligenceById(trackIntelligenceId);
}

function upsertTrackIntelligenceSource({
  trackIntelligenceId,
  source,
  sourceTrackId = null,
  sourceTrackName = null,
  sourceArtistName = null,
  rawPayload,
  normalizedSignals = [],
  metadata = {},
  errorCode = null,
  errorMessage = null,
  fetchedAt = new Date().toISOString(),
  expiresAt = null,
}) {
  const normalizedSource = String(source || "").trim();
  if (!trackIntelligenceId || !normalizedSource) {
    throw new Error("trackIntelligenceId and source are required.");
  }

  const now = new Date().toISOString();
  const db = openDatabase();

  db.prepare(`
    INSERT INTO track_intelligence_sources (
      track_intelligence_id,
      source,
      source_track_id,
      source_track_name,
      source_artist_name,
      raw_payload_json,
      normalized_signals_json,
      metadata_json,
      error_code,
      error_message,
      fetched_at,
      expires_at,
      updated_at
    )
    VALUES (
      @trackIntelligenceId,
      @source,
      @sourceTrackId,
      @sourceTrackName,
      @sourceArtistName,
      @rawPayloadJson,
      @normalizedSignalsJson,
      @metadataJson,
      @errorCode,
      @errorMessage,
      @fetchedAt,
      @expiresAt,
      @now
    )
    ON CONFLICT(track_intelligence_id, source) DO UPDATE SET
      source_track_id = excluded.source_track_id,
      source_track_name = excluded.source_track_name,
      source_artist_name = excluded.source_artist_name,
      raw_payload_json = excluded.raw_payload_json,
      normalized_signals_json = excluded.normalized_signals_json,
      metadata_json = excluded.metadata_json,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run({
    trackIntelligenceId,
    source: normalizedSource,
    sourceTrackId: normalizeOptionalText(sourceTrackId),
    sourceTrackName: normalizeOptionalText(sourceTrackName),
    sourceArtistName: normalizeOptionalText(sourceArtistName),
    rawPayloadJson: serializeJson(rawPayload, {}),
    normalizedSignalsJson: serializeJson(normalizedSignals, []),
    metadataJson: serializeJson(metadata, {}),
    errorCode: normalizeOptionalText(errorCode),
    errorMessage: normalizeOptionalText(errorMessage),
    fetchedAt,
    expiresAt,
    now,
  });

  refreshTrackIntelligenceStats(trackIntelligenceId);

  return db
    .prepare(`
      SELECT *
      FROM track_intelligence_sources
      WHERE track_intelligence_id = ? AND source = ?
    `)
    .get(trackIntelligenceId, normalizedSource);
}

function listTrackIntelligenceWithSources() {
  const db = openDatabase();
  const tracks = db.prepare("SELECT * FROM track_intelligence ORDER BY updated_at DESC").all();
  const sources = db.prepare("SELECT * FROM track_intelligence_sources ORDER BY source COLLATE NOCASE ASC").all();
  const byTrackId = new Map();

  for (const source of sources) {
    const list = byTrackId.get(source.track_intelligence_id) || [];
    list.push(source);
    byTrackId.set(source.track_intelligence_id, list);
  }

  return tracks.map((track) => ({ ...track, sources: byTrackId.get(track.id) || [] }));
}

module.exports = {
  buildTrackIdentityKey,
  getOrCreateTrackIntelligence,
  getTrackIntelligenceById,
  getTrackIntelligenceByIdentityKey,
  listTrackIntelligenceSources,
  listTrackIntelligenceWithSources,
  normalizeText,
  parseJson,
  refreshTrackIntelligenceStats,
  upsertTrackIntelligenceSource,
};
