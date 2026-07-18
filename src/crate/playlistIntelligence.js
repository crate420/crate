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
  const rows = db.prepare(`
    SELECT
      definitions.*,
      COUNT(DISTINCT sources.id) AS source_playlist_count,
      COUNT(DISTINCT CASE WHEN sources.include_in_consensus = 1 AND sources.active = 1 THEN sources.id END) AS consensus_source_playlist_count,
      COUNT(DISTINCT CASE WHEN sources.include_in_consensus = 0 OR sources.active = 0 OR sources.review_status IN ('rejected', 'ignored') THEN sources.id END) AS excluded_source_playlist_count,
      COUNT(DISTINCT CASE WHEN artists.review_status = 'approved' THEN artists.id END) AS approved_artist_count,
      COUNT(DISTINCT artists.id) AS artist_evidence_count,
      COUNT(DISTINCT CASE WHEN tracks.review_status = 'approved' THEN tracks.id END) AS approved_track_count,
      COUNT(DISTINCT tracks.id) AS track_evidence_count,
      ${importSelect}
    FROM playlist_collection_definitions definitions
    LEFT JOIN playlist_collection_sources sources ON sources.collection_id = definitions.id
    LEFT JOIN playlist_collection_artists artists ON artists.collection_id = definitions.id
    LEFT JOIN playlist_collection_tracks tracks ON tracks.collection_id = definitions.id
    ${importJoin}
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

function artistEvidenceFromCsvRow(row, defaults = {}) {
  const artistName = firstCsvValue(row, ["artist_name", "artist_names", "artist_name_s", "artist", "artists", "main_artist", "name"]);
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
            (collection_id, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
          VALUES
            (@collection_id, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
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

function splitArtistNames(value) {
  return cleanText(value)
    .split(/\s*(?:,|;|\+)\s*/g)
    .map(cleanText)
    .filter(Boolean);
}

function trackEvidenceFromCsvRow(row, defaults = {}) {
  const trackName = firstCsvValue(row, ["track_name", "title", "song", "track", "name"]);
  const artistNames = splitArtistNames(firstCsvValue(row, [
    "artist_name",
    "artist_names",
    "artist_name_s",
    "artist",
    "artists",
    "main_artist",
    "primary_artist",
    "artist_names_s",
  ]));
  return {
    track_name: cleanText(trackName),
    artist_names: artistNames,
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
        const artistKey = artistName.toLowerCase();
        const artist = artists.get(artistKey) || {
          artist_name: artistName,
          appearance_count: 0,
          evidence_count: 0,
          source_names: new Set(),
          notes: new Set(),
        };
        if (artist.source_names.has(file.name)) summary.duplicate_artist_rows += 1;
        artist.appearance_count += 1;
        artist.evidence_count += 1;
        artist.source_names.add(file.name);
        artist.notes.add(file.name);
        artists.set(artistKey, artist);

        if (trackPayload.track_name) {
          const trackKey = `${trackPayload.track_name.toLowerCase()}::${artistKey}`;
          const track = tracks.get(trackKey) || {
            track_name: trackPayload.track_name,
            artist_name: artistName,
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
  const trackExisting = new Set();
  const artistRows = db.prepare("SELECT lower(artist_name) AS key FROM playlist_collection_artists WHERE collection_id = ?").all(collectionId);
  const trackRows = db.prepare("SELECT lower(track_name) || '::' || lower(artist_name) AS key FROM playlist_collection_tracks WHERE collection_id = ?").all(collectionId);
  for (const row of artistRows) artistExisting.add(row.key);
  for (const row of trackRows) trackExisting.add(row.key);
  return {
    existing_artists: [...artists.keys()].filter((key) => artistExisting.has(key)).length,
    existing_tracks: [...tracks.keys()].filter((key) => trackExisting.has(key)).length,
    new_artists: [...artists.keys()].filter((key) => !artistExisting.has(key)).length,
    new_tracks: [...tracks.keys()].filter((key) => !trackExisting.has(key)).length,
  };
}

function playlistNameFromFileName(fileName) {
  return cleanText(fileName).replace(/\.csv$/i, "");
}

function existingSourceFileNames(db, collectionId, files, sourceType = "manual") {
  const existing = new Set();
  if (!files.length) return existing;
  const source = cleanText(sourceType || "manual");
  const rows = db.prepare(`
    SELECT lower(playlist_name) AS playlist_name
    FROM playlist_collection_sources
    WHERE collection_id = ? AND source_type = ?
  `).all(collectionId, source);
  const existingNames = new Set(rows.map((row) => row.playlist_name));
  for (const file of files) {
    const playlistName = playlistNameFromFileName(file.name).toLowerCase();
    if (existingNames.has(playlistName)) existing.add(file.name);
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
  const artistNames = new Set([...artists.keys()]);
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
    new_artists: existing.new_artists,
    new_tracks: existing.new_tracks,
    skipped_rows: evidence.summary.skipped_rows,
    rows_read: evidence.summary.rows_read,
    files_processed: evidence.summary.files_processed,
    existing_artists: existing.existing_artists,
    existing_tracks: existing.existing_tracks,
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
            (collection_id, playlist_name, source_type, review_status, trust_level, source_name, source_author, source_url, spotify_playlist_id, weight, include_in_consensus, active, notes)
          VALUES
            (@collection_id, @playlist_name, @source_type, @review_status, @trust_level, @source_name, @source_author, @source_url, @spotify_playlist_id, @weight, @include_in_consensus, @active, @notes)
        `).run({ ...payload, collection_id: collection.id });
        summary.source_playlists_inserted += 1;
      }
    }

    for (const artist of evidence.artists.values()) {
      const existing = db.prepare(`
        SELECT * FROM playlist_collection_artists
        WHERE collection_id = ? AND lower(artist_name) = lower(?)
      `).get(collection.id, artist.artist_name);
      const payload = {
        artist_name: artist.artist_name,
        appearance_count: artist.appearance_count,
        evidence_count: artist.evidence_count,
        source_count: artist.source_names.size,
        review_status: body.review_status || body.reviewStatus || "candidate",
        confidence_score: confidenceForEvidence(artist),
        approved: 0,
        notes: [...artist.notes].join("\n"),
      };
      if (existing) {
        const reviewStatus = PROTECTED_REVIEW_STATUSES.has(existing.review_status) ? existing.review_status : payload.review_status;
        if (PROTECTED_REVIEW_STATUSES.has(existing.review_status)) summary.artists_preserved_status += 1;
        db.prepare(`
          UPDATE playlist_collection_artists
          SET artist_name = @artist_name,
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
            (collection_id, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
          VALUES
            (@collection_id, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
        `).run({ ...payload, collection_id: collection.id });
        summary.artists_inserted += 1;
      }
    }

    for (const track of evidence.tracks.values()) {
      const existing = db.prepare(`
        SELECT * FROM playlist_collection_tracks
        WHERE collection_id = ? AND lower(track_name) = lower(?) AND lower(artist_name) = lower(?)
      `).get(collection.id, track.track_name, track.artist_name);
      const payload = {
        track_name: track.track_name,
        artist_name: track.artist_name,
        appearance_count: track.appearance_count,
        evidence_count: track.evidence_count,
        source_count: track.source_names.size,
        review_status: body.review_status || body.reviewStatus || "candidate",
        confidence_score: confidenceForEvidence(track),
        approved: 0,
        notes: [...track.notes].join("\n"),
      };
      if (existing) {
        const reviewStatus = PROTECTED_REVIEW_STATUSES.has(existing.review_status) ? existing.review_status : payload.review_status;
        if (PROTECTED_REVIEW_STATUSES.has(existing.review_status)) summary.tracks_preserved_status += 1;
        db.prepare(`
          UPDATE playlist_collection_tracks
          SET track_name = @track_name,
              artist_name = @artist_name,
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
            (collection_id, track_name, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
          VALUES
            (@collection_id, @track_name, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
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
    sources: updatedDetail.source_playlists.length,
    artists: updatedDetail.consensus_artists.length,
    tracks: updatedDetail.consensus_tracks.length,
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
