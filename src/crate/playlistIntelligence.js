const { openDatabase } = require("../db");

const STATUS_VALUES = new Set(["research", "active", "retired"]);
const SOURCE_TYPES = new Set(["spotify_editorial", "spotify_user", "manual"]);
const REVIEW_STATUSES = new Set(["candidate", "approved", "rejected", "ignored"]);
const TRUST_LEVELS = new Set(["low", "medium", "high"]);

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeCode(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function boolToInt(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function numberInRange(value, { min = 0, max = 100, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function integerInRange(value, options) {
  return Math.round(numberInRange(value, options));
}

function requireCollection(db, codeOrId) {
  const value = cleanText(codeOrId);
  const row = /^\d+$/.test(value)
    ? db.prepare("SELECT * FROM playlist_collection_definitions WHERE id = ?").get(Number(value))
    : db.prepare("SELECT * FROM playlist_collection_definitions WHERE collection_code = ?").get(value);

  if (!row) {
    const error = new Error("Playlist intelligence collection not found.");
    error.statusCode = 404;
    error.code = "playlist_collection_not_found";
    throw error;
  }

  return row;
}

function serializeCollection(row) {
  return {
    id: row.id,
    collection_code: row.collection_code,
    collection_name: row.collection_name,
    identity_description: row.identity_description || "",
    research_status: row.research_status,
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeSource(row) {
  return {
    id: row.id,
    collection_id: row.collection_id,
    playlist_name: row.playlist_name,
    source_type: row.source_type,
    review_status: row.review_status || "candidate",
    trust_level: row.trust_level || "medium",
    source_name: row.source_name || row.playlist_name,
    source_author: row.source_author || "",
    source_url: row.source_url || "",
    spotify_playlist_id: row.spotify_playlist_id || "",
    weight: Number(row.weight || 0),
    include_in_consensus: Boolean(row.include_in_consensus),
    active: row.active == null ? true : Boolean(row.active),
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeArtist(row) {
  return {
    id: row.id,
    collection_id: row.collection_id,
    artist_name: row.artist_name,
    appearance_count: Number(row.appearance_count || 0),
    evidence_count: Number(row.evidence_count || row.appearance_count || 0),
    source_count: Number(row.source_count || 0),
    review_status: row.review_status || "candidate",
    confidence_score: Number(row.confidence_score || 0),
    approved: Boolean(row.approved),
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeTrack(row) {
  return {
    id: row.id,
    collection_id: row.collection_id,
    track_name: row.track_name,
    artist_name: row.artist_name,
    appearance_count: Number(row.appearance_count || 0),
    evidence_count: Number(row.evidence_count || row.appearance_count || 0),
    source_count: Number(row.source_count || 0),
    review_status: row.review_status || "candidate",
    confidence_score: Number(row.confidence_score || 0),
    approved: Boolean(row.approved),
    notes: row.notes || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listPlaylistIntelligenceCollections() {
  const db = openDatabase();
  const rows = db.prepare(`
    SELECT
      definitions.*,
      COUNT(DISTINCT sources.id) AS source_playlist_count,
      COUNT(DISTINCT CASE WHEN sources.include_in_consensus = 1 AND sources.active = 1 THEN sources.id END) AS consensus_source_playlist_count,
      COUNT(DISTINCT CASE WHEN sources.include_in_consensus = 0 OR sources.active = 0 OR sources.review_status IN ('rejected', 'ignored') THEN sources.id END) AS excluded_source_playlist_count,
      COUNT(DISTINCT CASE WHEN artists.review_status = 'approved' THEN artists.id END) AS approved_artist_count,
      COUNT(DISTINCT artists.id) AS artist_evidence_count,
      COUNT(DISTINCT CASE WHEN tracks.review_status = 'approved' THEN tracks.id END) AS approved_track_count,
      COUNT(DISTINCT tracks.id) AS track_evidence_count
    FROM playlist_collection_definitions definitions
    LEFT JOIN playlist_collection_sources sources ON sources.collection_id = definitions.id
    LEFT JOIN playlist_collection_artists artists ON artists.collection_id = definitions.id
    LEFT JOIN playlist_collection_tracks tracks ON tracks.collection_id = definitions.id
    GROUP BY definitions.id
    ORDER BY
      CASE definitions.research_status
        WHEN 'active' THEN 1
        WHEN 'research' THEN 2
        ELSE 3
      END,
      definitions.collection_name COLLATE NOCASE
  `).all();

  const collections = rows.map((row) => ({
    ...serializeCollection(row),
    source_playlist_count: Number(row.source_playlist_count || 0),
    consensus_source_playlist_count: Number(row.consensus_source_playlist_count || 0),
    excluded_source_playlist_count: Number(row.excluded_source_playlist_count || 0),
    approved_artist_count: Number(row.approved_artist_count || 0),
    artist_evidence_count: Number(row.artist_evidence_count || 0),
    approved_track_count: Number(row.approved_track_count || 0),
    track_evidence_count: Number(row.track_evidence_count || 0),
  }));

  return {
    status: "ok",
    collections,
    summary: {
      collection_count: collections.length,
      active_count: collections.filter((row) => row.research_status === "active").length,
      research_count: collections.filter((row) => row.research_status === "research").length,
      retired_count: collections.filter((row) => row.research_status === "retired").length,
      source_playlist_count: collections.reduce((sum, row) => sum + row.source_playlist_count, 0),
      approved_artist_count: collections.reduce((sum, row) => sum + row.approved_artist_count, 0),
      approved_track_count: collections.reduce((sum, row) => sum + row.approved_track_count, 0),
    },
  };
}

function getPlaylistIntelligenceCollection(codeOrId) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const params = { collectionId: collection.id };

  return {
    status: "ok",
    collection: serializeCollection(collection),
    source_playlists: db.prepare(`
      SELECT * FROM playlist_collection_sources
      WHERE collection_id = @collectionId
      ORDER BY active DESC, include_in_consensus DESC, weight DESC, playlist_name COLLATE NOCASE
    `).all(params).map(serializeSource),
    consensus_artists: db.prepare(`
      SELECT * FROM playlist_collection_artists
      WHERE collection_id = @collectionId
      ORDER BY
        CASE review_status WHEN 'approved' THEN 1 WHEN 'candidate' THEN 2 WHEN 'ignored' THEN 3 ELSE 4 END,
        confidence_score DESC, source_count DESC, evidence_count DESC, artist_name COLLATE NOCASE
    `).all(params).map(serializeArtist),
    consensus_tracks: db.prepare(`
      SELECT * FROM playlist_collection_tracks
      WHERE collection_id = @collectionId
      ORDER BY
        CASE review_status WHEN 'approved' THEN 1 WHEN 'candidate' THEN 2 WHEN 'ignored' THEN 3 ELSE 4 END,
        confidence_score DESC, source_count DESC, evidence_count DESC, artist_name COLLATE NOCASE, track_name COLLATE NOCASE
    `).all(params).map(serializeTrack),
  };
}

function collectionPayload(body = {}, existing = null) {
  const collectionName = cleanText(body.collection_name ?? body.collectionName ?? existing?.collection_name);
  const collectionCode = normalizeCode(body.collection_code ?? body.collectionCode ?? existing?.collection_code ?? collectionName);
  const researchStatus = cleanText(body.research_status ?? body.researchStatus ?? existing?.research_status ?? "research");

  if (!collectionCode || !collectionName) {
    const error = new Error("Collection code and name are required.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection";
    throw error;
  }
  if (!STATUS_VALUES.has(researchStatus)) {
    const error = new Error("Research status must be research, active, or retired.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_status";
    throw error;
  }

  return {
    collection_code: collectionCode,
    collection_name: collectionName,
    identity_description: cleanText(body.identity_description ?? body.identityDescription ?? existing?.identity_description),
    research_status: researchStatus,
    notes: cleanText(body.notes ?? existing?.notes),
  };
}

function createPlaylistIntelligenceCollection(body = {}) {
  const db = openDatabase();
  const payload = collectionPayload(body);
  db.prepare(`
    INSERT INTO playlist_collection_definitions
      (collection_code, collection_name, identity_description, research_status, notes)
    VALUES
      (@collection_code, @collection_name, @identity_description, @research_status, @notes)
  `).run(payload);
  return getPlaylistIntelligenceCollection(payload.collection_code);
}

function updatePlaylistIntelligenceCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const existing = requireCollection(db, codeOrId);
  const payload = collectionPayload(body, existing);
  db.prepare(`
    UPDATE playlist_collection_definitions
    SET
      collection_code = @collection_code,
      collection_name = @collection_name,
      identity_description = @identity_description,
      research_status = @research_status,
      notes = @notes,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ ...payload, id: existing.id });
  return getPlaylistIntelligenceCollection(payload.collection_code);
}

function sourcePayload(body = {}) {
  const playlistName = cleanText(body.playlist_name ?? body.playlistName);
  const sourceType = cleanText(body.source_type ?? body.sourceType ?? "manual");
  const reviewStatus = cleanText(body.review_status ?? body.reviewStatus ?? "candidate");
  const trustLevel = cleanText(body.trust_level ?? body.trustLevel ?? "medium");
  if (!playlistName) {
    const error = new Error("Playlist name is required.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_source";
    throw error;
  }
  if (!SOURCE_TYPES.has(sourceType)) {
    const error = new Error("Source type must be spotify_editorial, spotify_user, or manual.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_source_type";
    throw error;
  }
  if (!REVIEW_STATUSES.has(reviewStatus)) {
    const error = new Error("Review status must be candidate, approved, rejected, or ignored.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_review_status";
    throw error;
  }
  if (!TRUST_LEVELS.has(trustLevel)) {
    const error = new Error("Trust level must be low, medium, or high.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_trust_level";
    throw error;
  }
  return {
    playlist_name: playlistName,
    source_type: sourceType,
    review_status: reviewStatus,
    trust_level: trustLevel,
    source_name: cleanText(body.source_name ?? body.sourceName ?? playlistName),
    source_author: cleanText(body.source_author ?? body.sourceAuthor),
    source_url: cleanText(body.source_url ?? body.sourceUrl),
    spotify_playlist_id: cleanText(body.spotify_playlist_id ?? body.spotifyPlaylistId),
    weight: numberInRange(body.weight ?? 1, { min: 0, max: 10, fallback: 1 }),
    include_in_consensus: boolToInt(body.include_in_consensus ?? body.includeInConsensus ?? true),
    active: boolToInt(body.active ?? true),
    notes: cleanText(body.notes),
  };
}

function addSourceToCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const payload = sourcePayload(body);
  const result = db.prepare(`
    INSERT INTO playlist_collection_sources
      (collection_id, playlist_name, source_type, review_status, trust_level, source_name, source_author, source_url, spotify_playlist_id, weight, include_in_consensus, active, notes)
    VALUES
      (@collection_id, @playlist_name, @source_type, @review_status, @trust_level, @source_name, @source_author, @source_url, @spotify_playlist_id, @weight, @include_in_consensus, @active, @notes)
  `).run({ ...payload, collection_id: collection.id });
  return serializeSource(db.prepare("SELECT * FROM playlist_collection_sources WHERE id = ?").get(result.lastInsertRowid));
}

function updateSource(id, body = {}) {
  const db = openDatabase();
  const existing = db.prepare("SELECT * FROM playlist_collection_sources WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("Source playlist not found.");
    error.statusCode = 404;
    error.code = "playlist_collection_source_not_found";
    throw error;
  }
  const payload = sourcePayload({
    playlist_name: body.playlist_name ?? existing.playlist_name,
    source_type: body.source_type ?? existing.source_type,
    review_status: body.review_status ?? existing.review_status,
    trust_level: body.trust_level ?? existing.trust_level,
    source_name: body.source_name ?? existing.source_name,
    source_author: body.source_author ?? existing.source_author,
    source_url: body.source_url ?? existing.source_url,
    spotify_playlist_id: body.spotify_playlist_id ?? existing.spotify_playlist_id,
    weight: body.weight ?? existing.weight,
    include_in_consensus: body.include_in_consensus ?? existing.include_in_consensus,
    active: body.active ?? existing.active,
    notes: body.notes ?? existing.notes,
  });
  db.prepare(`
    UPDATE playlist_collection_sources
    SET playlist_name = @playlist_name,
        source_type = @source_type,
        review_status = @review_status,
        trust_level = @trust_level,
        source_name = @source_name,
        source_author = @source_author,
        source_url = @source_url,
        spotify_playlist_id = @spotify_playlist_id,
        weight = @weight,
        include_in_consensus = @include_in_consensus,
        active = @active,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ ...payload, id });
  return serializeSource(db.prepare("SELECT * FROM playlist_collection_sources WHERE id = ?").get(id));
}

function evidencePayload(body = {}, type) {
  const artistName = cleanText(body.artist_name ?? body.artistName);
  const trackName = cleanText(body.track_name ?? body.trackName);
  const reviewStatus = cleanText(body.review_status ?? body.reviewStatus ?? (body.approved ? "approved" : "candidate"));
  if (!artistName || (type === "track" && !trackName)) {
    const error = new Error(type === "track" ? "Track and artist are required." : "Artist name is required.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_evidence";
    throw error;
  }
  if (!REVIEW_STATUSES.has(reviewStatus)) {
    const error = new Error("Review status must be candidate, approved, rejected, or ignored.");
    error.statusCode = 400;
    error.code = "invalid_playlist_collection_review_status";
    throw error;
  }
  const appearanceCount = integerInRange(body.appearance_count ?? body.appearanceCount ?? 0, { min: 0, max: 100000, fallback: 0 });
  return {
    artist_name: artistName,
    track_name: trackName,
    appearance_count: appearanceCount,
    evidence_count: integerInRange(body.evidence_count ?? body.evidenceCount ?? appearanceCount, { min: 0, max: 100000, fallback: appearanceCount }),
    source_count: integerInRange(body.source_count ?? body.sourceCount ?? 0, { min: 0, max: 100000, fallback: 0 }),
    review_status: reviewStatus,
    confidence_score: integerInRange(body.confidence_score ?? body.confidenceScore ?? 0, { min: 0, max: 100, fallback: 0 }),
    approved: reviewStatus === "approved" ? 1 : 0,
    notes: cleanText(body.notes),
  };
}

function addArtistToCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const payload = evidencePayload(body, "artist");
  const result = db.prepare(`
    INSERT INTO playlist_collection_artists
      (collection_id, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
    VALUES
      (@collection_id, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
  `).run({ ...payload, collection_id: collection.id });
  return serializeArtist(db.prepare("SELECT * FROM playlist_collection_artists WHERE id = ?").get(result.lastInsertRowid));
}

function updateArtist(id, body = {}) {
  const db = openDatabase();
  const existing = db.prepare("SELECT * FROM playlist_collection_artists WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("Consensus artist not found.");
    error.statusCode = 404;
    error.code = "playlist_collection_artist_not_found";
    throw error;
  }
  const payload = evidencePayload({
    artist_name: body.artist_name ?? existing.artist_name,
    appearance_count: body.appearance_count ?? existing.appearance_count,
    evidence_count: body.evidence_count ?? existing.evidence_count,
    source_count: body.source_count ?? existing.source_count,
    review_status: body.review_status ?? existing.review_status,
    confidence_score: body.confidence_score ?? existing.confidence_score,
    approved: body.approved ?? existing.approved,
    notes: body.notes ?? existing.notes,
  }, "artist");
  db.prepare(`
    UPDATE playlist_collection_artists
    SET artist_name = @artist_name,
        appearance_count = @appearance_count,
        evidence_count = @evidence_count,
        source_count = @source_count,
        review_status = @review_status,
        confidence_score = @confidence_score,
        approved = @approved,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ ...payload, id });
  return serializeArtist(db.prepare("SELECT * FROM playlist_collection_artists WHERE id = ?").get(id));
}

function addTrackToCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const payload = evidencePayload(body, "track");
  const result = db.prepare(`
    INSERT INTO playlist_collection_tracks
      (collection_id, track_name, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
    VALUES
      (@collection_id, @track_name, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
  `).run({ ...payload, collection_id: collection.id });
  return serializeTrack(db.prepare("SELECT * FROM playlist_collection_tracks WHERE id = ?").get(result.lastInsertRowid));
}

function updateTrack(id, body = {}) {
  const db = openDatabase();
  const existing = db.prepare("SELECT * FROM playlist_collection_tracks WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("Consensus track not found.");
    error.statusCode = 404;
    error.code = "playlist_collection_track_not_found";
    throw error;
  }
  const payload = evidencePayload({
    track_name: body.track_name ?? existing.track_name,
    artist_name: body.artist_name ?? existing.artist_name,
    appearance_count: body.appearance_count ?? existing.appearance_count,
    evidence_count: body.evidence_count ?? existing.evidence_count,
    source_count: body.source_count ?? existing.source_count,
    review_status: body.review_status ?? existing.review_status,
    confidence_score: body.confidence_score ?? existing.confidence_score,
    approved: body.approved ?? existing.approved,
    notes: body.notes ?? existing.notes,
  }, "track");
  db.prepare(`
    UPDATE playlist_collection_tracks
    SET track_name = @track_name,
        artist_name = @artist_name,
        appearance_count = @appearance_count,
        evidence_count = @evidence_count,
        source_count = @source_count,
        review_status = @review_status,
        confidence_score = @confidence_score,
        approved = @approved,
        notes = @notes,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ ...payload, id });
  return serializeTrack(db.prepare("SELECT * FROM playlist_collection_tracks WHERE id = ?").get(id));
}

function deleteRow(tableName, id) {
  const allowedTables = new Set([
    "playlist_collection_sources",
    "playlist_collection_artists",
    "playlist_collection_tracks",
  ]);
  if (!allowedTables.has(tableName)) {
    const error = new Error("Unsupported playlist intelligence row type.");
    error.statusCode = 400;
    error.code = "invalid_playlist_intelligence_row_type";
    throw error;
  }
  const db = openDatabase();
  const result = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
  return { status: "ok", deleted: result.changes };
}

module.exports = {
  addArtistToCollection,
  addSourceToCollection,
  addTrackToCollection,
  createPlaylistIntelligenceCollection,
  deleteRow,
  getPlaylistIntelligenceCollection,
  listPlaylistIntelligenceCollections,
  updateArtist,
  updatePlaylistIntelligenceCollection,
  updateSource,
  updateTrack,
};
