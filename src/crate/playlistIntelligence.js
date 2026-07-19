const { openDatabase } = require("../db");
const crypto = require("node:crypto");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");

const STATUS_VALUES = new Set(["research", "active", "retired"]);
const SOURCE_TYPES = new Set(["spotify_editorial", "spotify_user", "manual"]);
const REVIEW_STATUSES = new Set(["candidate", "approved", "rejected", "ignored"]);
const TRUST_LEVELS = new Set(["low", "medium", "high"]);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

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

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function numberInRange(value, { min = 0, max = 100, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function integerInRange(value, options) {
  return Math.round(numberInRange(value, options));
}

function paginationOptions(options = {}) {
  const limit = integerInRange(options.limit ?? options.page_size ?? options.pageSize ?? DEFAULT_PAGE_SIZE, {
    min: 1,
    max: MAX_PAGE_SIZE,
    fallback: DEFAULT_PAGE_SIZE,
  });
  const offset = integerInRange(options.offset ?? 0, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 0,
  });
  return { limit, offset };
}

function timedQuery(label, run) {
  const startedAt = process.hrtime.bigint();
  const result = run();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  if (elapsedMs > 250) {
    console.warn("[Crate Admin SQL] slow query", { label, elapsed_ms: Math.round(elapsedMs) });
  }
  return result;
}

function parseCsvRows(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((csvRow) => csvRow.some((value) => cleanText(value)));
}

function normalizeHeader(value) {
  return normalizeCode(value);
}

function csvObjectRows(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]))).filter((row) => Object.values(row).some(Boolean));
}

function firstCsvValue(row, keys = []) {
  for (const key of keys) {
    const value = cleanText(row[key]);
    if (value) return value;
  }
  return "";
}

function mergeReviewStatus(left, right) {
  const rank = { approved: 4, candidate: 3, ignored: 2, rejected: 1 };
  return (rank[right] || 0) > (rank[left] || 0) ? right : left;
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
    source_fingerprint: row.source_fingerprint || "",
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
    spotify_artist_id: row.spotify_artist_id || "",
    production_artist_intelligence_id: row.production_artist_intelligence_id || null,
    production_intelligence_updated_at: row.production_intelligence_updated_at || null,
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
    spotify_track_id: row.spotify_track_id || "",
    isrc: row.isrc || "",
    production_track_intelligence_id: row.production_track_intelligence_id || null,
    production_intelligence_updated_at: row.production_intelligence_updated_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listPlaylistIntelligenceCollections() {
  const db = openDatabase();
  const importJoin = tableExists(db, "playlist_intelligence_import_logs")
    ? `LEFT JOIN (
         SELECT
           collection_id,
           MAX(created_at) AS last_import_at,
           COUNT(*) AS import_count,
           SUM(artists_inserted) AS total_imported_artists,
           SUM(tracks_inserted) AS total_imported_tracks
         FROM playlist_intelligence_import_logs
         GROUP BY collection_id
       ) import_logs ON import_logs.collection_id = definitions.id`
    : "";
  const importSelect = tableExists(db, "playlist_intelligence_import_logs")
    ? `MAX(import_logs.last_import_at) AS last_import_at,
       MAX(import_logs.import_count) AS import_count,
       MAX(import_logs.total_imported_artists) AS total_imported_artists,
       MAX(import_logs.total_imported_tracks) AS total_imported_tracks`
    : `NULL AS last_import_at,
       0 AS import_count,
       0 AS total_imported_artists,
       0 AS total_imported_tracks`;
  const rows = timedQuery("playlist_intelligence.collections.summary", () => db.prepare(`
    SELECT
      definitions.*,
      COALESCE(source_counts.source_playlist_count, 0) AS source_playlist_count,
      COALESCE(source_counts.consensus_source_playlist_count, 0) AS consensus_source_playlist_count,
      COALESCE(source_counts.excluded_source_playlist_count, 0) AS excluded_source_playlist_count,
      COALESCE(artist_counts.approved_artist_count, 0) AS approved_artist_count,
      COALESCE(artist_counts.artist_evidence_count, 0) AS artist_evidence_count,
      COALESCE(track_counts.approved_track_count, 0) AS approved_track_count,
      COALESCE(track_counts.track_evidence_count, 0) AS track_evidence_count,
      ${importSelect}
    FROM playlist_collection_definitions definitions
    LEFT JOIN (
      SELECT
        collection_id,
        COUNT(*) AS source_playlist_count,
        SUM(CASE WHEN include_in_consensus = 1 AND active = 1 THEN 1 ELSE 0 END) AS consensus_source_playlist_count,
        SUM(CASE WHEN include_in_consensus = 0 OR active = 0 OR review_status IN ('rejected', 'ignored') THEN 1 ELSE 0 END) AS excluded_source_playlist_count
      FROM playlist_collection_sources
      GROUP BY collection_id
    ) source_counts ON source_counts.collection_id = definitions.id
    LEFT JOIN (
      SELECT
        collection_id,
        SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) AS approved_artist_count,
        COUNT(*) AS artist_evidence_count
      FROM playlist_collection_artists
      GROUP BY collection_id
    ) artist_counts ON artist_counts.collection_id = definitions.id
    LEFT JOIN (
      SELECT
        collection_id,
        SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) AS approved_track_count,
        COUNT(*) AS track_evidence_count
      FROM playlist_collection_tracks
      GROUP BY collection_id
    ) track_counts ON track_counts.collection_id = definitions.id
    ${importJoin}
    ORDER BY
      CASE definitions.research_status
        WHEN 'active' THEN 1
        WHEN 'research' THEN 2
        ELSE 3
      END,
      definitions.collection_name COLLATE NOCASE
  `).all());

  const collections = rows.map((row) => ({
    ...serializeCollection(row),
    source_playlist_count: Number(row.source_playlist_count || 0),
    consensus_source_playlist_count: Number(row.consensus_source_playlist_count || 0),
    excluded_source_playlist_count: Number(row.excluded_source_playlist_count || 0),
    approved_artist_count: Number(row.approved_artist_count || 0),
    artist_evidence_count: Number(row.artist_evidence_count || 0),
    approved_track_count: Number(row.approved_track_count || 0),
    track_evidence_count: Number(row.track_evidence_count || 0),
    last_import_at: row.last_import_at || null,
    import_count: Number(row.import_count || 0),
    total_imported_artists: Number(row.total_imported_artists || 0),
    total_imported_tracks: Number(row.total_imported_tracks || 0),
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

function getPlaylistIntelligenceCollection(codeOrId, options = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const artistPage = paginationOptions({
    limit: options.artist_limit ?? options.artistLimit ?? options.limit,
    offset: options.artist_offset ?? options.artistOffset ?? options.offset,
  });
  const trackPage = paginationOptions({
    limit: options.track_limit ?? options.trackLimit ?? options.limit,
    offset: options.track_offset ?? options.trackOffset ?? options.offset,
  });
  const sourcePage = paginationOptions({
    limit: options.source_limit ?? options.sourceLimit ?? MAX_PAGE_SIZE,
    offset: options.source_offset ?? options.sourceOffset ?? 0,
  });
  const params = {
    collectionId: collection.id,
    artistLimit: artistPage.limit,
    artistOffset: artistPage.offset,
    trackLimit: trackPage.limit,
    trackOffset: trackPage.offset,
    sourceLimit: sourcePage.limit,
    sourceOffset: sourcePage.offset,
  };
  const totals = timedQuery("playlist_intelligence.collection.totals", () => ({
    sources: db.prepare("SELECT COUNT(*) AS count FROM playlist_collection_sources WHERE collection_id = ?").get(collection.id).count,
    artists: db.prepare("SELECT COUNT(*) AS count FROM playlist_collection_artists WHERE collection_id = ?").get(collection.id).count,
    tracks: db.prepare("SELECT COUNT(*) AS count FROM playlist_collection_tracks WHERE collection_id = ?").get(collection.id).count,
  }));

  return {
    status: "ok",
    collection: serializeCollection(collection),
    pagination: {
      source_playlists: { limit: sourcePage.limit, offset: sourcePage.offset, total_count: Number(totals.sources || 0) },
      consensus_artists: { limit: artistPage.limit, offset: artistPage.offset, total_count: Number(totals.artists || 0) },
      consensus_tracks: { limit: trackPage.limit, offset: trackPage.offset, total_count: Number(totals.tracks || 0) },
    },
    source_playlists: timedQuery("playlist_intelligence.collection.sources", () => db.prepare(`
      SELECT * FROM playlist_collection_sources
      WHERE collection_id = @collectionId
      ORDER BY active DESC, include_in_consensus DESC, weight DESC, playlist_name COLLATE NOCASE
      LIMIT @sourceLimit OFFSET @sourceOffset
    `).all(params).map(serializeSource)),
    consensus_artists: timedQuery("playlist_intelligence.collection.artists", () => db.prepare(`
      SELECT * FROM playlist_collection_artists
      WHERE collection_id = @collectionId
      ORDER BY
        CASE review_status WHEN 'approved' THEN 1 WHEN 'candidate' THEN 2 WHEN 'ignored' THEN 3 ELSE 4 END,
        confidence_score DESC, source_count DESC, evidence_count DESC, artist_name COLLATE NOCASE
      LIMIT @artistLimit OFFSET @artistOffset
    `).all(params).map(serializeArtist)),
    consensus_tracks: timedQuery("playlist_intelligence.collection.tracks", () => db.prepare(`
      SELECT * FROM playlist_collection_tracks
      WHERE collection_id = @collectionId
      ORDER BY
        CASE review_status WHEN 'approved' THEN 1 WHEN 'candidate' THEN 2 WHEN 'ignored' THEN 3 ELSE 4 END,
        confidence_score DESC, source_count DESC, evidence_count DESC, artist_name COLLATE NOCASE, track_name COLLATE NOCASE
      LIMIT @trackLimit OFFSET @trackOffset
    `).all(params).map(serializeTrack)),
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
    source_fingerprint: cleanText(body.source_fingerprint ?? body.sourceFingerprint),
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
      (collection_id, playlist_name, source_type, review_status, trust_level, source_name, source_author, source_url, spotify_playlist_id, source_fingerprint, weight, include_in_consensus, active, notes)
    VALUES
      (@collection_id, @playlist_name, @source_type, @review_status, @trust_level, @source_name, @source_author, @source_url, @spotify_playlist_id, @source_fingerprint, @weight, @include_in_consensus, @active, @notes)
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
    source_fingerprint: body.source_fingerprint ?? existing.source_fingerprint,
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
        source_fingerprint = @source_fingerprint,
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
    spotify_artist_id: cleanText(body.spotify_artist_id ?? body.spotifyArtistId),
    spotify_track_id: cleanText(body.spotify_track_id ?? body.spotifyTrackId),
    isrc: cleanText(body.isrc),
    notes: cleanText(body.notes),
  };
}

function addArtistToCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const payload = evidencePayload(body, "artist");
  const result = db.prepare(`
    INSERT INTO playlist_collection_artists
      (collection_id, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, spotify_artist_id, notes)
    VALUES
      (@collection_id, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @spotify_artist_id, @notes)
  `).run({ ...payload, collection_id: collection.id });
  return serializeArtist(db.prepare("SELECT * FROM playlist_collection_artists WHERE id = ?").get(result.lastInsertRowid));
}

function artistEvidenceFromCsvRow(row, defaults = {}) {
  const artistName = firstCsvValue(row, ["artist_name", "artist_names", "artist_name_s", "artist", "artists", "main_artist", "name"]);
  const spotifyArtistId = firstCsvValue(row, ["spotify_artist_id", "spotify_artist_ids", "artist_id", "artist_ids", "artist_spotify_id"]);
  const appearanceCount = firstCsvValue(row, ["appearance_count", "appearances", "appearance", "count", "playlist_count"]);
  const evidenceCount = firstCsvValue(row, ["evidence_count", "evidence", "evidence_total"]);
  const sourceCount = firstCsvValue(row, ["source_count", "sources", "source_playlists", "playlist_sources"]);
  const confidenceScore = firstCsvValue(row, ["confidence_score", "confidence", "score"]);
  const reviewStatus = firstCsvValue(row, ["review_status", "status"]) || defaults.review_status || defaults.reviewStatus || "candidate";
  const defaultAppearanceCount = defaults.appearance_count ?? defaults.appearanceCount ?? 1;
  return evidencePayload({
    artist_name: artistName,
    appearance_count: appearanceCount || defaultAppearanceCount,
    evidence_count: evidenceCount || defaults.evidence_count || defaults.evidenceCount || appearanceCount || defaultAppearanceCount,
    source_count: sourceCount || defaults.source_count || defaults.sourceCount || 1,
    confidence_score: confidenceScore || defaults.confidence_score || defaults.confidenceScore || 0,
    review_status: reviewStatus,
    spotify_artist_id: spotifyArtistId,
    notes: firstCsvValue(row, ["notes", "note"]) || cleanText(defaults.notes),
  }, "artist");
}

function importArtistEvidenceCsvToCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const rows = csvObjectRows(body.csv || body.csvText || body.content);
  if (!rows.length) {
    const error = new Error("CSV must include a header row and at least one artist row.");
    error.statusCode = 400;
    error.code = "invalid_playlist_intelligence_artist_csv";
    throw error;
  }

  const merged = new Map();
  const errors = [];
  rows.forEach((row, index) => {
    try {
      const payload = artistEvidenceFromCsvRow(row, body.defaults || body);
      const key = payload.artist_name.toLowerCase();
      const current = merged.get(key);
      if (!current) {
        merged.set(key, payload);
      } else {
        merged.set(key, {
          ...current,
          appearance_count: current.appearance_count + payload.appearance_count,
          evidence_count: current.evidence_count + payload.evidence_count,
          source_count: Math.max(current.source_count, payload.source_count),
          confidence_score: Math.max(current.confidence_score, payload.confidence_score),
          review_status: mergeReviewStatus(current.review_status, payload.review_status),
          approved: mergeReviewStatus(current.review_status, payload.review_status) === "approved" ? 1 : 0,
          notes: [current.notes, payload.notes].filter(Boolean).join("\n"),
        });
      }
    } catch (err) {
      errors.push({ row_number: index + 2, message: err.message });
    }
  });

  const rowsToImport = [...merged.values()];
  const summary = {
    status: "ok",
    collection_code: collection.collection_code,
    collection_name: collection.collection_name,
    parsed_rows: rows.length,
    valid_rows: rowsToImport.length,
    error_count: errors.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    dry_run: body.dry_run === true || body.dryRun === true,
    errors,
    sample: rowsToImport.slice(0, 10).map((row) => ({
      artist_name: row.artist_name,
      appearance_count: row.appearance_count,
      evidence_count: row.evidence_count,
      source_count: row.source_count,
      confidence_score: row.confidence_score,
      review_status: row.review_status,
    })),
  };

  if (summary.dry_run) return summary;

  const importRows = db.transaction(() => {
    for (const payload of rowsToImport) {
      const existing = db.prepare(`
        SELECT * FROM playlist_collection_artists
        WHERE collection_id = ? AND lower(artist_name) = lower(?)
      `).get(collection.id, payload.artist_name);
      if (existing) {
        const result = db.prepare(`
          UPDATE playlist_collection_artists
          SET artist_name = @artist_name,
              spotify_artist_id = COALESCE(NULLIF(@spotify_artist_id, ''), spotify_artist_id),
              appearance_count = @appearance_count,
              evidence_count = @evidence_count,
              source_count = @source_count,
              review_status = @review_status,
              confidence_score = @confidence_score,
              approved = @approved,
              notes = @notes,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `).run({ ...payload, id: existing.id });
        summary.updated += result.changes ? 1 : 0;
      } else {
        db.prepare(`
          INSERT INTO playlist_collection_artists
            (collection_id, artist_name, spotify_artist_id, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
          VALUES
            (@collection_id, @artist_name, @spotify_artist_id, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
        `).run({ ...payload, collection_id: collection.id });
        summary.inserted += 1;
      }
    }
  });

  importRows();
  summary.unchanged = summary.valid_rows - summary.inserted - summary.updated;
  return summary;
}

const PROTECTED_REVIEW_STATUSES = new Set(["approved", "rejected", "ignored"]);

function parseStructuredList(value) {
  const text = cleanText(value);
  if (!text) return [];
  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try {
      const parsed = JSON.parse(text);
      const values = Array.isArray(parsed) ? parsed : Object.values(parsed);
      return values.map((item) => cleanText(typeof item === "string" ? item : item?.name || item?.artist_name || item?.id)).filter(Boolean);
    } catch (err) {
      return [];
    }
  }
  return [];
}

function splitDelimitedValue(value) {
  const text = cleanText(value);
  if (!text) return [];
  const structured = parseStructuredList(text);
  if (structured.length) return structured;
  if (text.includes(";")) return text.split(/\s*;\s*/g).map(cleanText).filter(Boolean);
  if (text.includes("|")) return text.split(/\s*\|\s*/g).map(cleanText).filter(Boolean);
  return [text];
}

function artistIdsForRow(row) {
  return splitDelimitedValue(firstCsvValue(row, [
    "spotify_artist_id",
    "spotify_artist_ids",
    "artist_id",
    "artist_ids",
    "Artist ID(s)",
  ]));
}

function trackEvidenceFromCsvRow(row, defaults = {}) {
  const trackName = firstCsvValue(row, ["track_name", "title", "song", "track", "name"]);
  const artistNames = splitDelimitedValue(firstCsvValue(row, [
    "artist_name",
    "artist_names",
    "artist_name_s",
    "artist",
    "artists",
    "main_artist",
    "primary_artist",
    "artist_names_s",
  ]));
  const spotifyArtistIds = artistIdsForRow(row);
  return {
    track_name: cleanText(trackName),
    artist_names: artistNames,
    spotify_artist_ids: spotifyArtistIds,
    spotify_track_id: cleanText(firstCsvValue(row, ["spotify_track_id", "track_id", "Spotify Track ID"])),
    isrc: cleanText(firstCsvValue(row, ["isrc", "ISRC"])),
    review_status: defaults.review_status || defaults.reviewStatus || "candidate",
  };
}

function normalizeCsvFiles(files) {
  const normalized = Array.isArray(files) ? files : [];
  return normalized.map((file, index) => ({
    name: cleanText(file?.name || file?.filename || `playlist-${index + 1}.csv`),
    content: String(file?.content || file?.csv || file?.csvText || ""),
  })).filter((file) => file.name && file.content.trim());
}

function collectPlaylistCsvEvidence(files, defaults = {}) {
  const artists = new Map();
  const tracks = new Map();
  const errors = [];
  const summary = {
    files_processed: 0,
    rows_read: 0,
    skipped_rows: 0,
    duplicate_artist_rows: 0,
    duplicate_track_rows: 0,
  };

  for (const file of files) {
    let rows = [];
    try {
      rows = csvObjectRows(file.content);
    } catch (err) {
      errors.push({ file_name: file.name, message: err.message });
      continue;
    }
    summary.files_processed += 1;
    summary.rows_read += rows.length;
    rows.forEach((row, index) => {
      const trackPayload = trackEvidenceFromCsvRow(row, defaults);
      if (!trackPayload.artist_names.length && !trackPayload.track_name) {
        summary.skipped_rows += 1;
        return;
      }
      if (!trackPayload.artist_names.length) {
        summary.skipped_rows += 1;
        errors.push({ file_name: file.name, row_number: index + 2, message: "Artist name is required." });
        return;
      }

      for (const artistName of trackPayload.artist_names) {
        const artistIndex = trackPayload.artist_names.indexOf(artistName);
        const spotifyArtistId = trackPayload.spotify_artist_ids[artistIndex] || (trackPayload.artist_names.length === 1 ? trackPayload.spotify_artist_ids[0] : "");
        const artistKey = spotifyArtistId ? `spotify:${spotifyArtistId}` : artistName.toLowerCase();
        const artist = artists.get(artistKey) || {
          artist_name: artistName,
          spotify_artist_id: spotifyArtistId,
          appearance_count: 0,
          evidence_count: 0,
          source_names: new Set(),
          spotify_artist_ids: new Set(),
          notes: new Set(),
        };
        if (spotifyArtistId) artist.spotify_artist_ids.add(spotifyArtistId);
        if (artist.source_names.has(file.name)) summary.duplicate_artist_rows += 1;
        artist.appearance_count += 1;
        artist.evidence_count += 1;
        artist.source_names.add(file.name);
        artist.notes.add(file.name);
        artists.set(artistKey, artist);

        if (trackPayload.track_name) {
          const trackKey = trackPayload.spotify_track_id
            ? `spotify:${trackPayload.spotify_track_id}`
            : trackPayload.isrc
              ? `isrc:${trackPayload.isrc}`
              : `${trackPayload.track_name.toLowerCase()}::${artistName.toLowerCase()}`;
          const track = tracks.get(trackKey) || {
            track_name: trackPayload.track_name,
            artist_name: artistName,
            spotify_track_id: trackPayload.spotify_track_id,
            isrc: trackPayload.isrc,
            appearance_count: 0,
            evidence_count: 0,
            source_names: new Set(),
            notes: new Set(),
          };
          if (track.source_names.has(file.name)) summary.duplicate_track_rows += 1;
          track.appearance_count += 1;
          track.evidence_count += 1;
          track.source_names.add(file.name);
          track.notes.add(file.name);
          tracks.set(trackKey, track);
        }
      }
    });
  }

  return { artists, tracks, errors, summary };
}

function confidenceForEvidence(row, fallback = 70) {
  const sourceCount = Number(row.source_names?.size || row.source_count || 0);
  return Math.min(90, Math.max(fallback, 65 + sourceCount * 5));
}

function existingEvidenceCounts(db, collectionId, artists, tracks) {
  const artistExisting = new Set();
  const artistSpotifyIds = new Set();
  const trackExisting = new Set();
  const trackSpotifyIds = new Set();
  const trackIsrcs = new Set();
  const artistRows = db.prepare("SELECT lower(artist_name) AS key, spotify_artist_id FROM playlist_collection_artists WHERE collection_id = ?").all(collectionId);
  const trackRows = db.prepare("SELECT lower(track_name) || '::' || lower(artist_name) AS key, spotify_track_id, isrc FROM playlist_collection_tracks WHERE collection_id = ?").all(collectionId);
  for (const row of artistRows) {
    artistExisting.add(row.key);
    if (row.spotify_artist_id) artistSpotifyIds.add(row.spotify_artist_id);
  }
  for (const row of trackRows) {
    trackExisting.add(row.key);
    if (row.spotify_track_id) trackSpotifyIds.add(row.spotify_track_id);
    if (row.isrc) trackIsrcs.add(row.isrc);
  }
  const artistExists = (artist) => {
    const ids = artist.spotify_artist_ids?.size ? [...artist.spotify_artist_ids] : [artist.spotify_artist_id].filter(Boolean);
    return ids.some((id) => artistSpotifyIds.has(id)) || artistExisting.has(artist.artist_name.toLowerCase());
  };
  const trackExists = (track) => {
    const nameKey = `${track.track_name.toLowerCase()}::${track.artist_name.toLowerCase()}`;
    return (track.spotify_track_id && trackSpotifyIds.has(track.spotify_track_id))
      || (track.isrc && trackIsrcs.has(track.isrc))
      || trackExisting.has(nameKey);
  };
  const artistValues = [...artists.values()];
  const trackValues = [...tracks.values()];
  return {
    existing_artists: artistValues.filter(artistExists).length,
    existing_tracks: trackValues.filter(trackExists).length,
    new_artists: artistValues.filter((artist) => !artistExists(artist)).length,
    new_tracks: trackValues.filter((track) => !trackExists(track)).length,
  };
}

function existingCrateArtistIdentities(db) {
  const names = new Set();
  const normalizedNames = new Set();
  const spotifyIds = new Set();
  const rememberName = (value) => {
    const lowered = cleanText(value).toLowerCase();
    const normalized = trackIntelligenceRepo.normalizeText(value);
    if (lowered) names.add(lowered);
    if (normalized) normalizedNames.add(normalized);
  };
  if (tableExists(db, "artist_intelligence")) {
    for (const row of db.prepare("SELECT normalized_artist_name, spotify_artist_id FROM artist_intelligence").all()) {
      rememberName(row.normalized_artist_name);
      if (row.spotify_artist_id) spotifyIds.add(row.spotify_artist_id);
    }
  }
  if (tableExists(db, "artist_genres")) {
    for (const row of db.prepare("SELECT lower(trim(artist_name)) AS artist_name FROM artist_genres").all()) {
      rememberName(row.artist_name);
    }
  }
  if (tableExists(db, "tracks")) {
    for (const row of db.prepare("SELECT artist_names, raw_json FROM tracks").all()) {
      for (const artistName of artistNamesFromTrackRow(row)) rememberName(artistName);
    }
  }
  return { names, normalizedNames, spotifyIds };
}

function existingCrateTrackIdentities(db) {
  const spotifyIds = new Set();
  const artistTracks = new Set();
  if (tableExists(db, "track_intelligence")) {
    for (const row of db.prepare("SELECT spotify_track_id, normalized_artist_name, normalized_track_name FROM track_intelligence").all()) {
      if (row.spotify_track_id) spotifyIds.add(row.spotify_track_id);
      if (row.normalized_artist_name && row.normalized_track_name) artistTracks.add(`${row.normalized_track_name}::${row.normalized_artist_name}`);
    }
  }
  if (tableExists(db, "tracks")) {
    for (const row of db.prepare("SELECT spotify_track_id, name, artist_names, raw_json FROM tracks").all()) {
      if (row.spotify_track_id) spotifyIds.add(row.spotify_track_id);
      for (const artistName of artistNamesFromTrackRow(row)) {
        const normalizedTrackName = trackIntelligenceRepo.normalizeText(row.name);
        const normalizedArtistName = trackIntelligenceRepo.normalizeText(artistName);
        if (normalizedTrackName && normalizedArtistName) artistTracks.add(`${normalizedTrackName}::${normalizedArtistName}`);
      }
    }
  }
  return { spotifyIds, artistTracks };
}

function existingCrateIdentityCounts(db, artists, tracks) {
  const crateArtists = existingCrateArtistIdentities(db);
  const crateTracks = existingCrateTrackIdentities(db);
  let existingArtists = 0;
  let existingTracks = 0;
  for (const artist of artists.values()) {
    const ids = artist.spotify_artist_ids?.size ? [...artist.spotify_artist_ids] : [artist.spotify_artist_id].filter(Boolean);
    const matchedById = ids.some((id) => crateArtists.spotifyIds.has(id));
    const lowered = artist.artist_name.toLowerCase();
    const normalized = trackIntelligenceRepo.normalizeText(artist.artist_name);
    if (matchedById || crateArtists.names.has(lowered) || crateArtists.normalizedNames.has(normalized)) existingArtists += 1;
  }
  for (const track of tracks.values()) {
    const matchedById = track.spotify_track_id && crateTracks.spotifyIds.has(track.spotify_track_id);
    const normalizedTrackName = trackIntelligenceRepo.normalizeText(track.track_name);
    const normalizedArtistName = trackIntelligenceRepo.normalizeText(track.artist_name);
    const key = normalizedTrackName && normalizedArtistName ? `${normalizedTrackName}::${normalizedArtistName}` : "";
    if (matchedById || crateTracks.artistTracks.has(key)) existingTracks += 1;
  }
  return {
    existing_crate_artists: existingArtists,
    new_crate_artists: Math.max(artists.size - existingArtists, 0),
    existing_crate_tracks: existingTracks,
    new_crate_tracks: Math.max(tracks.size - existingTracks, 0),
  };
}

function playlistNameFromFileName(fileName) {
  return cleanText(fileName).replace(/\.csv$/i, "");
}

function fileFingerprint(file) {
  const rows = csvObjectRows(file.content);
  const normalizedRows = rows.map((row) => Object.keys(row)
    .sort()
    .map((key) => `${key}:${cleanText(row[key]).toLowerCase()}`)
    .join("|"))
    .sort()
    .join("\n");
  const content = normalizedRows || cleanText(file.content).toLowerCase();
  return crypto.createHash("sha256").update(content).digest("hex");
}

function existingSourceFileNames(db, collectionId, files, sourceType = "manual") {
  const existing = new Set();
  if (!files.length) return existing;
  const source = cleanText(sourceType || "manual");
  const rows = db.prepare(`
    SELECT lower(playlist_name) AS playlist_name, source_fingerprint
    FROM playlist_collection_sources
    WHERE collection_id = ? AND source_type = ?
  `).all(collectionId, source);
  const existingNames = new Set(rows.map((row) => row.playlist_name));
  const existingFingerprints = new Set(rows.map((row) => row.source_fingerprint).filter(Boolean));
  for (const file of files) {
    const playlistName = playlistNameFromFileName(file.name).toLowerCase();
    const fingerprint = fileFingerprint(file);
    file.source_fingerprint = fingerprint;
    if (existingNames.has(playlistName) || existingFingerprints.has(fingerprint)) existing.add(file.name);
  }
  return existing;
}

function artistNamesFromTrackRow(row) {
  const names = new Set();
  try {
    const parsed = JSON.parse(row.artist_names || "[]");
    if (Array.isArray(parsed)) parsed.forEach((artist) => {
      const name = cleanText(typeof artist === "string" ? artist : artist?.name);
      if (name) names.add(name.toLowerCase());
    });
  } catch (err) {
    // Fall back to raw_json below.
  }
  try {
    const raw = JSON.parse(row.raw_json || "{}");
    if (Array.isArray(raw.artists)) raw.artists.forEach((artist) => {
      const name = cleanText(artist?.name);
      if (name) names.add(name.toLowerCase());
    });
  } catch (err) {
    // Missing raw JSON should not block import summaries.
  }
  return [...names];
}

function estimateRecoveryImpact(db, artists) {
  const artistNames = new Set([...artists.values()].map((artist) => artist.artist_name.toLowerCase()));
  const impact = {
    unmatched_artist_overlap: 0,
    estimated_recoverable_songs: 0,
    estimate_type: "best_available",
  };
  if (!artistNames.size || !tableExists(db, "user_tracks") || !tableExists(db, "tracks")) return impact;

  const matchedArtists = new Set();
  const matchedTracks = new Set();
  const rows = db.prepare(`
    SELECT tracks.id AS track_id, tracks.artist_names, tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    WHERE user_tracks.playlist_code IS NULL
  `).all();
  for (const row of rows) {
    for (const artistName of artistNamesFromTrackRow(row)) {
      if (!artistNames.has(artistName)) continue;
      matchedArtists.add(artistName);
      matchedTracks.add(row.track_id);
    }
  }
  impact.unmatched_artist_overlap = matchedArtists.size;
  impact.estimated_recoverable_songs = matchedTracks.size;
  return impact;
}

function collectionSignals(collection) {
  return [...new Set([
    collection.collection_name,
    collection.collection_code.replace(/_/g, " "),
  ].map((value) => cleanText(value).toLowerCase()).filter(Boolean))];
}

function getArtistEvidenceWithCollection(db, id) {
  return db.prepare(`
    SELECT
      artists.*,
      definitions.collection_code,
      definitions.collection_name,
      definitions.identity_description
    FROM playlist_collection_artists artists
    INNER JOIN playlist_collection_definitions definitions ON definitions.id = artists.collection_id
    WHERE artists.id = ?
  `).get(id);
}

function getTrackEvidenceWithCollection(db, id) {
  return db.prepare(`
    SELECT
      tracks.*,
      definitions.collection_code,
      definitions.collection_name,
      definitions.identity_description
    FROM playlist_collection_tracks tracks
    INNER JOIN playlist_collection_definitions definitions ON definitions.id = tracks.collection_id
    WHERE tracks.id = ?
  `).get(id);
}

function findArtistIntelligenceBySpotifyId(db, spotifyArtistId) {
  const id = cleanText(spotifyArtistId);
  if (!id || !tableExists(db, "artist_intelligence")) return null;
  return db.prepare("SELECT * FROM artist_intelligence WHERE spotify_artist_id = ?").get(id) || null;
}

function learnApprovedPlaylistArtist(artistRow, options = {}) {
  if (!artistRow || artistRow.review_status !== "approved") return { learned: false, reason: "artist_not_approved" };
  const db = openDatabase();
  const existingBySpotifyId = findArtistIntelligenceBySpotifyId(db, artistRow.spotify_artist_id);
  const before = existingBySpotifyId || artistIntelligenceRepo.getArtistIntelligenceByName(artistRow.artist_name);
  const artist = before || artistIntelligenceRepo.getOrCreateArtistIntelligence({
    artistName: artistRow.artist_name,
    spotifyArtistId: artistRow.spotify_artist_id || null,
  });
  const created = !before;
  const now = new Date().toISOString();
  const source = `playlist_intelligence:${artistRow.collection_code}`;
  artistIntelligenceRepo.upsertArtistIntelligenceSource({
    artistIntelligenceId: artist.id,
    source,
    sourceArtistId: artistRow.spotify_artist_id || null,
    sourceArtistName: artistRow.artist_name,
    rawPayload: {
      collection_code: artistRow.collection_code,
      collection_name: artistRow.collection_name,
      playlist_collection_artist_id: artistRow.id,
      appearance_count: artistRow.appearance_count,
      evidence_count: artistRow.evidence_count,
      source_count: artistRow.source_count,
      confidence_score: artistRow.confidence_score,
      review_status: artistRow.review_status,
      approved_at: now,
      approved_by_user_id: options.adminUser?.id || null,
      manually_approved: true,
      notes: artistRow.notes || "",
    },
    normalizedSignals: collectionSignals(artistRow),
    fetchedAt: now,
  });
  db.prepare(`
    UPDATE playlist_collection_artists
    SET production_artist_intelligence_id = ?,
        production_intelligence_updated_at = ?
    WHERE id = ?
  `).run(artist.id, now, artistRow.id);
  return {
    learned: true,
    type: "artist",
    created,
    updated_existing: !created,
    artist_intelligence_id: artist.id,
    source,
  };
}

function learnApprovedPlaylistTrack(trackRow, options = {}) {
  if (!trackRow || trackRow.review_status !== "approved") return { learned: false, reason: "track_not_approved" };
  const db = openDatabase();
  const beforeIdentityKey = trackIntelligenceRepo.buildTrackIdentityKey({
    spotifyTrackId: trackRow.spotify_track_id || null,
    isrc: trackRow.isrc || null,
    artistName: trackRow.artist_name,
    trackName: trackRow.track_name,
  });
  const before = trackIntelligenceRepo.getTrackIntelligenceByIdentityKey(beforeIdentityKey);
  const track = before || trackIntelligenceRepo.getOrCreateTrackIntelligence({
    trackName: trackRow.track_name,
    artistName: trackRow.artist_name,
    spotifyTrackId: trackRow.spotify_track_id || null,
    isrc: trackRow.isrc || null,
  });
  const created = !before;
  const now = new Date().toISOString();
  const source = `playlist_intelligence:${trackRow.collection_code}`;
  trackIntelligenceRepo.upsertTrackIntelligenceSource({
    trackIntelligenceId: track.id,
    source,
    sourceTrackId: trackRow.spotify_track_id || null,
    sourceTrackName: trackRow.track_name,
    sourceArtistName: trackRow.artist_name,
    rawPayload: {
      collection_code: trackRow.collection_code,
      collection_name: trackRow.collection_name,
      playlist_collection_track_id: trackRow.id,
      appearance_count: trackRow.appearance_count,
      evidence_count: trackRow.evidence_count,
      source_count: trackRow.source_count,
      confidence_score: trackRow.confidence_score,
      review_status: trackRow.review_status,
      approved_at: now,
      approved_by_user_id: options.adminUser?.id || null,
      manually_approved: true,
      notes: trackRow.notes || "",
    },
    normalizedSignals: collectionSignals(trackRow),
    metadata: {
      collection_code: trackRow.collection_code,
      collection_name: trackRow.collection_name,
      isrc: trackRow.isrc || null,
    },
    fetchedAt: now,
  });
  db.prepare(`
    UPDATE playlist_collection_tracks
    SET production_track_intelligence_id = ?,
        production_intelligence_updated_at = ?
    WHERE id = ?
  `).run(track.id, now, trackRow.id);
  return {
    learned: true,
    type: "track",
    created,
    updated_existing: !created,
    track_intelligence_id: track.id,
    source,
  };
}

function latestImportLog(db, collectionId) {
  if (!tableExists(db, "playlist_intelligence_import_logs")) return null;
  return db.prepare(`
    SELECT *
    FROM playlist_intelligence_import_logs
    WHERE collection_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(collectionId) || null;
}

function previewPlaylistIntelligenceCsvImport(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const files = normalizeCsvFiles(body.files);
  if (!files.length) {
    const submittedFiles = Array.isArray(body.files) ? body.files.length : 0;
    const error = new Error(submittedFiles ? "Empty file. Upload at least one CSV with playlist rows." : "At least one CSV file is required.");
    error.statusCode = 400;
    error.code = "missing_playlist_intelligence_csv";
    throw error;
  }
  const sourceType = body.source_type || body.sourceType || "manual";
  const duplicateFiles = existingSourceFileNames(db, collection.id, files, sourceType);
  const evidence = collectPlaylistCsvEvidence(files, body.defaults || body);
  if (evidence.summary.files_processed === 0) {
    const error = new Error("No playlists found. Upload at least one non-empty CSV file.");
    error.statusCode = 400;
    error.code = "no_playlist_csv_rows";
    throw error;
  }
  if (evidence.artists.size === 0) {
    const error = new Error("CSV format not recognized. No artists were detected.");
    error.statusCode = 400;
    error.code = "no_playlist_artists_detected";
    throw error;
  }
  const existing = existingEvidenceCounts(db, collection.id, evidence.artists, evidence.tracks);
  const crateExisting = existingCrateIdentityCounts(db, evidence.artists, evidence.tracks);
  const impact = estimateRecoveryImpact(db, evidence.artists);
  return {
    status: "ok",
    dry_run: true,
    collection_code: collection.collection_code,
    collection_name: collection.collection_name,
    playlists: files.length,
    artists: evidence.artists.size,
    tracks: evidence.tracks.size,
    duplicates: evidence.summary.duplicate_artist_rows + evidence.summary.duplicate_track_rows + existing.existing_artists + existing.existing_tracks,
    duplicate_upload: duplicateFiles.size === files.length,
    duplicate_files: [...duplicateFiles],
    new_artists: crateExisting.new_crate_artists,
    new_tracks: crateExisting.new_crate_tracks,
    new_collection_artists: existing.new_artists,
    new_collection_tracks: existing.new_tracks,
    skipped_rows: evidence.summary.skipped_rows,
    rows_read: evidence.summary.rows_read,
    files_processed: evidence.summary.files_processed,
    existing_artists: crateExisting.existing_crate_artists,
    existing_tracks: crateExisting.existing_crate_tracks,
    existing_collection_artists: existing.existing_artists,
    existing_collection_tracks: existing.existing_tracks,
    duplicate_artist_rows: evidence.summary.duplicate_artist_rows,
    duplicate_track_rows: evidence.summary.duplicate_track_rows,
    unmatched_artist_overlap: impact.unmatched_artist_overlap,
    estimated_recoverable_songs: impact.estimated_recoverable_songs,
    estimate_type: impact.estimate_type,
    errors: evidence.errors,
    sample_artists: [...evidence.artists.values()].slice(0, 12).map((row) => ({
      artist_name: row.artist_name,
      evidence_count: row.evidence_count,
      source_count: row.source_names.size,
    })),
    sample_tracks: [...evidence.tracks.values()].slice(0, 12).map((row) => ({
      track_name: row.track_name,
      artist_name: row.artist_name,
      evidence_count: row.evidence_count,
      source_count: row.source_names.size,
    })),
  };
}

function applyPlaylistIntelligenceCsvImport(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const files = normalizeCsvFiles(body.files);
  if (!files.length) {
    const submittedFiles = Array.isArray(body.files) ? body.files.length : 0;
    const error = new Error(submittedFiles ? "Empty file. Upload at least one CSV with playlist rows." : "At least one CSV file is required.");
    error.statusCode = 400;
    error.code = "missing_playlist_intelligence_csv";
    throw error;
  }
  const sourceType = body.source_type || body.sourceType || "manual";
  const duplicateFiles = existingSourceFileNames(db, collection.id, files, sourceType);
  const filesToImport = files.filter((file) => !duplicateFiles.has(file.name));
  if (!filesToImport.length) {
    const error = new Error("Duplicate upload. These playlist CSVs were already imported for this collection.");
    error.statusCode = 409;
    error.code = "duplicate_playlist_intelligence_upload";
    throw error;
  }
  const evidence = collectPlaylistCsvEvidence(filesToImport, body.defaults || body);
  if (evidence.summary.files_processed === 0) {
    const error = new Error("No playlists found. Upload at least one non-empty CSV file.");
    error.statusCode = 400;
    error.code = "no_playlist_csv_rows";
    throw error;
  }
  if (evidence.artists.size === 0) {
    const error = new Error("CSV format not recognized. No artists were detected.");
    error.statusCode = 400;
    error.code = "no_playlist_artists_detected";
    throw error;
  }
  const before = existingEvidenceCounts(db, collection.id, evidence.artists, evidence.tracks);
  const crateBefore = existingCrateIdentityCounts(db, evidence.artists, evidence.tracks);
  const impact = estimateRecoveryImpact(db, evidence.artists);
  const importCompletedAt = new Date().toISOString();
  const summary = {
    status: "ok",
    collection_code: collection.collection_code,
    collection_name: collection.collection_name,
    files_processed: evidence.summary.files_processed,
    rows_read: evidence.summary.rows_read,
    skipped_rows: evidence.summary.skipped_rows,
    source_playlists_inserted: 0,
    source_playlists_updated: 0,
    artists_inserted: 0,
    artists_updated: 0,
    artists_preserved_status: 0,
    tracks_inserted: 0,
    tracks_updated: 0,
    tracks_preserved_status: 0,
    duplicates: evidence.summary.duplicate_artist_rows + evidence.summary.duplicate_track_rows + before.existing_artists + before.existing_tracks,
    estimated_recovery_impact: 0,
    collections_updated: 1,
    errors: evidence.errors,
    duplicate_files: [...duplicateFiles],
    artists_processed: evidence.artists.size,
    tracks_processed: evidence.tracks.size,
    new_artists: crateBefore.new_crate_artists,
    existing_artists: crateBefore.existing_crate_artists,
    new_tracks: crateBefore.new_crate_tracks,
    existing_tracks: crateBefore.existing_crate_tracks,
    new_collection_artists: before.new_artists,
    existing_collection_artists: before.existing_artists,
    new_collection_tracks: before.new_tracks,
    existing_collection_tracks: before.existing_tracks,
    duplicate_artist_rows: evidence.summary.duplicate_artist_rows,
    duplicate_track_rows: evidence.summary.duplicate_track_rows,
    unmatched_artist_overlap: impact.unmatched_artist_overlap,
    estimated_recoverable_songs: impact.estimated_recoverable_songs,
    estimate_type: impact.estimate_type,
    last_updated: null,
    last_import: null,
  };

  const importRows = db.transaction(() => {
    for (const file of filesToImport) {
      const payload = sourcePayload({
        playlist_name: playlistNameFromFileName(file.name),
        source_type: sourceType,
        review_status: body.review_status || body.reviewStatus || "candidate",
        trust_level: body.trust_level || body.trustLevel || "medium",
        source_name: file.name,
        source_fingerprint: file.source_fingerprint || fileFingerprint(file),
        include_in_consensus: body.include_in_consensus ?? body.includeInConsensus ?? true,
        active: true,
        notes: body.notes || "",
      });
      const existing = db.prepare(`
        SELECT * FROM playlist_collection_sources
        WHERE collection_id = ? AND lower(playlist_name) = lower(?) AND source_type = ?
      `).get(collection.id, payload.playlist_name, payload.source_type);
      if (existing) {
        db.prepare(`
          UPDATE playlist_collection_sources
          SET source_name = @source_name,
              source_fingerprint = COALESCE(NULLIF(@source_fingerprint, ''), source_fingerprint),
              trust_level = @trust_level,
              weight = @weight,
              include_in_consensus = @include_in_consensus,
              active = @active,
              notes = @notes,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `).run({ ...payload, review_status: existing.review_status, id: existing.id });
        summary.source_playlists_updated += 1;
      } else {
        db.prepare(`
          INSERT INTO playlist_collection_sources
            (collection_id, playlist_name, source_type, review_status, trust_level, source_name, source_author, source_url, spotify_playlist_id, source_fingerprint, weight, include_in_consensus, active, notes)
          VALUES
            (@collection_id, @playlist_name, @source_type, @review_status, @trust_level, @source_name, @source_author, @source_url, @spotify_playlist_id, @source_fingerprint, @weight, @include_in_consensus, @active, @notes)
        `).run({ ...payload, collection_id: collection.id });
        summary.source_playlists_inserted += 1;
      }
    }

    for (const artist of evidence.artists.values()) {
      const payload = {
        artist_name: artist.artist_name,
        spotify_artist_id: [...(artist.spotify_artist_ids || new Set())][0] || artist.spotify_artist_id || "",
        appearance_count: artist.appearance_count,
        evidence_count: artist.evidence_count,
        source_count: artist.source_names.size,
        review_status: body.review_status || body.reviewStatus || "candidate",
        confidence_score: confidenceForEvidence(artist),
        approved: 0,
        notes: [...artist.notes].join("\n"),
      };
      const existing = payload.spotify_artist_id
        ? db.prepare(`
            SELECT * FROM playlist_collection_artists
            WHERE collection_id = ? AND spotify_artist_id = ?
          `).get(collection.id, payload.spotify_artist_id)
        : db.prepare(`
            SELECT * FROM playlist_collection_artists
            WHERE collection_id = ? AND lower(artist_name) = lower(?)
          `).get(collection.id, artist.artist_name);
      if (existing) {
        const reviewStatus = PROTECTED_REVIEW_STATUSES.has(existing.review_status) ? existing.review_status : payload.review_status;
        if (PROTECTED_REVIEW_STATUSES.has(existing.review_status)) summary.artists_preserved_status += 1;
        db.prepare(`
          UPDATE playlist_collection_artists
          SET artist_name = @artist_name,
              spotify_artist_id = COALESCE(NULLIF(@spotify_artist_id, ''), spotify_artist_id),
              appearance_count = appearance_count + @appearance_count,
              evidence_count = evidence_count + @evidence_count,
              source_count = MAX(source_count, @source_count),
              review_status = @review_status,
              confidence_score = MAX(confidence_score, @confidence_score),
              approved = @approved,
              notes = CASE WHEN notes = '' THEN @notes ELSE notes || char(10) || @notes END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `).run({ ...payload, review_status: reviewStatus, approved: reviewStatus === "approved" ? 1 : 0, id: existing.id });
        summary.artists_updated += 1;
      } else {
        db.prepare(`
          INSERT INTO playlist_collection_artists
            (collection_id, artist_name, spotify_artist_id, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
          VALUES
            (@collection_id, @artist_name, @spotify_artist_id, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
        `).run({ ...payload, collection_id: collection.id });
        summary.artists_inserted += 1;
      }
    }

    for (const track of evidence.tracks.values()) {
      const payload = {
        track_name: track.track_name,
        artist_name: track.artist_name,
        spotify_track_id: track.spotify_track_id || "",
        isrc: track.isrc || "",
        appearance_count: track.appearance_count,
        evidence_count: track.evidence_count,
        source_count: track.source_names.size,
        review_status: body.review_status || body.reviewStatus || "candidate",
        confidence_score: confidenceForEvidence(track),
        approved: 0,
        notes: [...track.notes].join("\n"),
      };
      const existing = payload.spotify_track_id
        ? db.prepare(`
            SELECT * FROM playlist_collection_tracks
            WHERE collection_id = ? AND spotify_track_id = ?
          `).get(collection.id, payload.spotify_track_id)
        : payload.isrc
          ? db.prepare(`
              SELECT * FROM playlist_collection_tracks
              WHERE collection_id = ? AND isrc = ?
            `).get(collection.id, payload.isrc)
          : db.prepare(`
              SELECT * FROM playlist_collection_tracks
              WHERE collection_id = ? AND lower(track_name) = lower(?) AND lower(artist_name) = lower(?)
            `).get(collection.id, track.track_name, track.artist_name);
      if (existing) {
        const reviewStatus = PROTECTED_REVIEW_STATUSES.has(existing.review_status) ? existing.review_status : payload.review_status;
        if (PROTECTED_REVIEW_STATUSES.has(existing.review_status)) summary.tracks_preserved_status += 1;
        db.prepare(`
          UPDATE playlist_collection_tracks
          SET track_name = @track_name,
              artist_name = @artist_name,
              spotify_track_id = COALESCE(NULLIF(@spotify_track_id, ''), spotify_track_id),
              isrc = COALESCE(NULLIF(@isrc, ''), isrc),
              appearance_count = appearance_count + @appearance_count,
              evidence_count = evidence_count + @evidence_count,
              source_count = MAX(source_count, @source_count),
              review_status = @review_status,
              confidence_score = MAX(confidence_score, @confidence_score),
              approved = @approved,
              notes = CASE WHEN notes = '' THEN @notes ELSE notes || char(10) || @notes END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `).run({ ...payload, review_status: reviewStatus, approved: reviewStatus === "approved" ? 1 : 0, id: existing.id });
        summary.tracks_updated += 1;
      } else {
        db.prepare(`
          INSERT INTO playlist_collection_tracks
            (collection_id, track_name, artist_name, spotify_track_id, isrc, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
          VALUES
            (@collection_id, @track_name, @artist_name, @spotify_track_id, @isrc, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
        `).run({ ...payload, collection_id: collection.id });
        summary.tracks_inserted += 1;
      }
    }

    db.prepare(`
      UPDATE playlist_collection_definitions
      SET updated_at = ?
      WHERE id = ?
    `).run(importCompletedAt, collection.id);

    if (tableExists(db, "playlist_intelligence_import_logs")) {
      const logSummary = {
        ...summary,
        artists_processed: evidence.artists.size,
        tracks_processed: evidence.tracks.size,
      };
      db.prepare(`
        INSERT INTO playlist_intelligence_import_logs (
          collection_id,
          collection_code,
          collection_name,
          imported_by_user_id,
          imported_by_spotify_user_id,
          file_count,
          row_count,
          artists_processed,
          artists_inserted,
          artists_updated,
          tracks_processed,
          tracks_inserted,
          tracks_updated,
          duplicates_skipped,
          skipped_rows,
          error_count,
          estimated_recoverable_songs,
          unmatched_artist_overlap,
          summary_json
        ) VALUES (
          @collection_id,
          @collection_code,
          @collection_name,
          @imported_by_user_id,
          @imported_by_spotify_user_id,
          @file_count,
          @row_count,
          @artists_processed,
          @artists_inserted,
          @artists_updated,
          @tracks_processed,
          @tracks_inserted,
          @tracks_updated,
          @duplicates_skipped,
          @skipped_rows,
          @error_count,
          @estimated_recoverable_songs,
          @unmatched_artist_overlap,
          @summary_json
        )
      `).run({
        collection_id: collection.id,
        collection_code: collection.collection_code,
        collection_name: collection.collection_name,
        imported_by_user_id: body.imported_by_user_id || body.importedByUserId || null,
        imported_by_spotify_user_id: body.imported_by_spotify_user_id || body.importedBySpotifyUserId || null,
        file_count: filesToImport.length,
        row_count: evidence.summary.rows_read,
        artists_processed: evidence.artists.size,
        artists_inserted: summary.artists_inserted,
        artists_updated: summary.artists_updated,
        tracks_processed: evidence.tracks.size,
        tracks_inserted: summary.tracks_inserted,
        tracks_updated: summary.tracks_updated,
        duplicates_skipped: summary.duplicates,
        skipped_rows: summary.skipped_rows,
        error_count: evidence.errors.length,
        estimated_recoverable_songs: impact.estimated_recoverable_songs,
        unmatched_artist_overlap: impact.unmatched_artist_overlap,
        summary_json: JSON.stringify(logSummary),
      });
    }
  });

  importRows();
  const updatedDetail = getPlaylistIntelligenceCollection(collection.collection_code);
  summary.artists_processed = evidence.artists.size;
  summary.tracks_processed = evidence.tracks.size;
  summary.imported = summary.artists_inserted + summary.artists_updated + summary.tracks_inserted + summary.tracks_updated;
  summary.skipped = summary.skipped_rows + evidence.errors.length;
  summary.collection_counts = {
    sources: updatedDetail.pagination?.source_playlists?.total_count || updatedDetail.source_playlists.length,
    artists: updatedDetail.pagination?.consensus_artists?.total_count || updatedDetail.consensus_artists.length,
    tracks: updatedDetail.pagination?.consensus_tracks?.total_count || updatedDetail.consensus_tracks.length,
  };
  const updatedCollection = db.prepare("SELECT updated_at FROM playlist_collection_definitions WHERE id = ?").get(collection.id);
  summary.last_updated = updatedCollection?.updated_at || null;
  summary.last_import = latestImportLog(db, collection.id);
  return summary;
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
    spotify_artist_id: body.spotify_artist_id ?? existing.spotify_artist_id,
    notes: body.notes ?? existing.notes,
  }, "artist");
  db.prepare(`
    UPDATE playlist_collection_artists
    SET artist_name = @artist_name,
        spotify_artist_id = COALESCE(NULLIF(@spotify_artist_id, ''), spotify_artist_id),
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
  const updated = getArtistEvidenceWithCollection(db, id);
  const productionIntelligence = updated.review_status === "approved"
    ? learnApprovedPlaylistArtist(updated, { adminUser: body.adminUser })
    : { learned: false, reason: "artist_not_approved" };
  return {
    ...serializeArtist(db.prepare("SELECT * FROM playlist_collection_artists WHERE id = ?").get(id)),
    production_intelligence: productionIntelligence,
  };
}

function addTrackToCollection(codeOrId, body = {}) {
  const db = openDatabase();
  const collection = requireCollection(db, codeOrId);
  const payload = evidencePayload(body, "track");
  const result = db.prepare(`
    INSERT INTO playlist_collection_tracks
      (collection_id, track_name, artist_name, spotify_track_id, isrc, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
    VALUES
      (@collection_id, @track_name, @artist_name, @spotify_track_id, @isrc, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
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
    spotify_track_id: body.spotify_track_id ?? existing.spotify_track_id,
    isrc: body.isrc ?? existing.isrc,
    notes: body.notes ?? existing.notes,
  }, "track");
  db.prepare(`
    UPDATE playlist_collection_tracks
    SET track_name = @track_name,
        artist_name = @artist_name,
        spotify_track_id = COALESCE(NULLIF(@spotify_track_id, ''), spotify_track_id),
        isrc = COALESCE(NULLIF(@isrc, ''), isrc),
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
  const updated = getTrackEvidenceWithCollection(db, id);
  const productionIntelligence = updated.review_status === "approved"
    ? learnApprovedPlaylistTrack(updated, { adminUser: body.adminUser })
    : { learned: false, reason: "track_not_approved" };
  return {
    ...serializeTrack(db.prepare("SELECT * FROM playlist_collection_tracks WHERE id = ?").get(id)),
    production_intelligence: productionIntelligence,
  };
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
  applyPlaylistIntelligenceCsvImport,
  createPlaylistIntelligenceCollection,
  deleteRow,
  getPlaylistIntelligenceCollection,
  importArtistEvidenceCsvToCollection,
  listPlaylistIntelligenceCollections,
  previewPlaylistIntelligenceCsvImport,
  updateArtist,
  updatePlaylistIntelligenceCollection,
  updateSource,
  updateTrack,
};
