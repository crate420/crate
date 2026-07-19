const { openDatabase } = require("../db");
const artistGenreRepo = require("../repositories/artistGenres");
const unmatchedGenreLogs = require("../repositories/unmatchedGenreLogs");
const {
  findRecommendation,
  getArtistRecommendationDetail,
  listArtistIntelligenceRecommendations,
  normalizeGenre,
} = require("./artistIntelligenceRecommendations");
const {
  approveGenreRecommendation,
  approveSelectedGenreRecommendations,
  getAdminGenreRecommendations,
} = require("./genreRecommendations");
const {
  createPlaylistIntelligenceCollection,
  getPlaylistIntelligenceCollection,
  listPlaylistIntelligenceCollections,
} = require("./playlistIntelligence");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const DEFAULT_REVIEW_LIMIT = 50;
const MAX_REVIEW_LIMIT = 200;
const EDITABLE_GENRE_EXTRAS = [
  "acoustic pop",
  "alt r&b",
  "alternative r&b",
  "alternative rock",
  "baroque pop",
  "bedroom pop",
  "britpop",
  "college rock",
  "dance pop",
  "dream pop",
  "folk pop",
  "indie folk",
  "indie pop",
  "indie rock",
  "neo soul",
  "shoegaze",
  "singer-songwriter",
  "sunshine pop",
  "synthpop",
];

function normalizeArtistName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLimit(value, fallback = DEFAULT_REVIEW_LIMIT, max = MAX_REVIEW_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(Number.isInteger(parsed) && parsed > 0 ? parsed : fallback, max);
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function reviewDecisionTableExists(db = openDatabase()) {
  return tableExists(db, "admin_intelligence_review_decisions");
}

function normalizeDecisionSourceType(value) {
  return String(value || "artist_intelligence").trim().toLowerCase();
}

function decisionKeyForItem(item = {}) {
  return {
    normalized_artist_name: normalizeArtistName(item.artist),
    normalized_suggested_genre: normalizeGenre(item.suggested_genre || item.genre),
    source_type: normalizeDecisionSourceType(item.source_type),
  };
}

function getReviewDecisionKeys(db = openDatabase()) {
  const keys = new Set();
  if (!reviewDecisionTableExists(db)) return keys;
  const rows = db.prepare(`
    SELECT normalized_artist_name, normalized_suggested_genre, source_type
    FROM admin_intelligence_review_decisions
    WHERE decision IN ('rejected', 'edited')
  `).all();
  for (const row of rows) {
    keys.add(`${row.normalized_artist_name}::${row.normalized_suggested_genre}::${row.source_type}`);
    keys.add(`${row.normalized_artist_name}::${row.normalized_suggested_genre}::*`);
  }
  return keys;
}

function isReviewDecisionRejected(item, keys) {
  const key = decisionKeyForItem(item);
  return keys.has(`${key.normalized_artist_name}::${key.normalized_suggested_genre}::${key.source_type}`)
    || keys.has(`${key.normalized_artist_name}::${key.normalized_suggested_genre}::*`);
}

function recordReviewDecision(item = {}, decision, options = {}) {
  const db = openDatabase();
  if (!reviewDecisionTableExists(db)) {
    const error = new Error("Admin review decision table is missing. Run migrations first.");
    error.statusCode = 500;
    error.code = "admin_review_decision_schema_missing";
    throw error;
  }
  const key = decisionKeyForItem(item);
  if (!key.normalized_artist_name || !key.normalized_suggested_genre) {
    const error = new Error("Artist and suggested genre are required.");
    error.statusCode = 400;
    error.code = "missing_review_decision_fields";
    throw error;
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO admin_intelligence_review_decisions (
      normalized_artist_name,
      artist_name,
      suggested_genre,
      normalized_suggested_genre,
      source_type,
      decision,
      approved_genre,
      normalized_approved_genre,
      notes,
      evidence_json,
      admin_user_id,
      admin_spotify_user_id,
      created_at,
      updated_at
    ) VALUES (
      @normalized_artist_name,
      @artist_name,
      @suggested_genre,
      @normalized_suggested_genre,
      @source_type,
      @decision,
      @approved_genre,
      @normalized_approved_genre,
      @notes,
      @evidence_json,
      @admin_user_id,
      @admin_spotify_user_id,
      @now,
      @now
    )
    ON CONFLICT(normalized_artist_name, normalized_suggested_genre, source_type) DO UPDATE SET
      artist_name = excluded.artist_name,
      suggested_genre = excluded.suggested_genre,
      decision = excluded.decision,
      approved_genre = excluded.approved_genre,
      normalized_approved_genre = excluded.normalized_approved_genre,
      notes = excluded.notes,
      evidence_json = excluded.evidence_json,
      admin_user_id = excluded.admin_user_id,
      admin_spotify_user_id = excluded.admin_spotify_user_id,
      updated_at = excluded.updated_at
  `).run({
    ...key,
    artist_name: String(item.artist || "").trim(),
    suggested_genre: String(item.suggested_genre || item.genre || "").trim(),
    decision,
    approved_genre: options.approvedGenre || null,
    normalized_approved_genre: options.approvedGenre ? normalizeGenre(options.approvedGenre) : null,
    notes: String(options.notes || "").trim(),
    evidence_json: JSON.stringify(options.evidence || item.evidence_details || {}),
    admin_user_id: options.adminUser?.id || null,
    admin_spotify_user_id: options.adminUser?.spotify_user_id || null,
    now,
  });
  return { status: "ok", decision };
}

function sourceLabel(source = {}) {
  const raw = String(source.source_type || source.source || "").toLowerCase();
  if (raw.includes("spotify")) return "Spotify";
  if (raw.includes("last.fm") || raw.includes("lastfm")) return "Last.fm";
  if (raw.includes("musicbrainz")) return "MusicBrainz";
  if (raw.includes("playlist_intelligence")) return "Playlist Intelligence";
  if (raw.includes("manual") || raw.includes("approved_artist_genres") || raw.includes("admin")) return "Manual";
  if (String(source.source || "").includes("Playlist Intelligence")) return "Playlist Intelligence";
  return "Manual";
}

function unmatchedArtistStats() {
  const db = openDatabase();
  const stats = new Map();
  if (!tableExists(db, "user_tracks") || !tableExists(db, "tracks")) return stats;

  const rows = db.prepare(`
    SELECT
      user_tracks.user_id,
      tracks.id AS track_id,
      tracks.name,
      tracks.artist_names,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    WHERE user_tracks.playlist_code IS NULL
  `).all();

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    for (const artistName of getArtistNames(row, rawTrack)) {
      const key = normalizeArtistName(artistName);
      if (!key) continue;
      const entry = stats.get(key) || {
        artist_name: artistName,
        affected_users: new Set(),
        track_ids: new Set(),
        sample_tracks: [],
      };
      entry.affected_users.add(row.user_id);
      entry.track_ids.add(row.track_id);
      if (entry.sample_tracks.length < 5) entry.sample_tracks.push({ track_id: row.track_id, track_name: row.name, user_id: row.user_id });
      stats.set(key, entry);
    }
  }

  for (const entry of stats.values()) {
    entry.affected_user_count = entry.affected_users.size;
    entry.estimated_recovery = entry.track_ids.size;
    entry.affected_users = [...entry.affected_users].sort((a, b) => a - b);
  }
  return stats;
}

function reviewRowFromArtistIntelligence(row, recommendation, stats) {
  const artistName = row.artist.artist_name;
  const artistStats = stats.get(normalizeArtistName(artistName));
  const evidence = recommendation.source_details || [];
  const evidenceSources = [...new Set(evidence.map(sourceLabel))];
  const hasPlaylistIntelligence = evidence.some((source) => sourceLabel(source) === "Playlist Intelligence");
  return {
    key: `artist_intelligence:${row.artist.id}:${recommendation.genre}`,
    source_type: "artist_intelligence",
    artist_intelligence_id: row.artist.id,
    artist: artistName,
    suggested_genre: recommendation.genre,
    evidence: evidenceSources,
    playlist_intelligence: hasPlaylistIntelligence,
    affected_users: artistStats?.affected_user_count || 0,
    estimated_recovery: artistStats?.estimated_recovery || 0,
    status: "candidate",
    confidence_score: recommendation.confidence_score || row.confidence_score || 0,
    support_count: recommendation.support_count || 0,
    support_weight: recommendation.support_weight || 0,
    evidence_details: evidence,
    sample_tracks: artistStats?.sample_tracks || [],
    can_edit: true,
  };
}

function reviewRowFromGenreRecommendation(row) {
  const evidence = row.supporting_evidence || [];
  const evidenceSources = [...new Set(evidence.map((item) => sourceLabel({ source: item.source })))];
  return {
    key: `genre_recommendation:${row.normalized_artist_name}:${row.recommended_playlist_code}`,
    source_type: "genre_recommendation",
    artist_intelligence_id: row.artist_intelligence_id || null,
    artist: row.artist,
    playlist_code: row.recommended_playlist_code,
    suggested_genre: row.approved_genre,
    evidence: evidenceSources,
    playlist_intelligence: evidenceSources.includes("Playlist Intelligence"),
    affected_users: row.affected_user_count || 0,
    estimated_recovery: row.estimated_gain || 0,
    status: "candidate",
    confidence_score: row.confidence || 0,
    support_count: row.source_agreement || 0,
    support_weight: row.source_agreement || 0,
    evidence_details: evidence,
    sample_tracks: row.sample_tracks || [],
    can_edit: true,
  };
}

async function getIntelligenceReviewQueue(options = {}) {
  const limit = normalizeLimit(options.limit);
  const offset = Math.max(Number.parseInt(options.offset, 10) || 0, 0);
  const stats = unmatchedArtistStats();
  const rows = [];

  const artistRecommendations = listArtistIntelligenceRecommendations({
    confidenceMin: options.confidence_min || 85,
    limit: Math.max(limit + offset, limit),
  });
  for (const artist of artistRecommendations) {
    for (const recommendation of artist.recommendations || []) {
      rows.push(reviewRowFromArtistIntelligence(artist, recommendation, stats));
    }
  }

  const genreRecommendations = await getAdminGenreRecommendations({ limit: Math.max(limit + offset, limit), preview: "all" });
  for (const recommendation of genreRecommendations.recommendations || []) {
    rows.push(reviewRowFromGenreRecommendation(recommendation));
  }

  const deduped = new Map();
  for (const row of rows) {
    const key = `${normalizeArtistName(row.artist)}::${normalizeGenre(row.suggested_genre)}`;
    const current = deduped.get(key);
    if (!current || row.estimated_recovery > current.estimated_recovery || row.playlist_intelligence) deduped.set(key, row);
  }

  const rejectedKeys = getReviewDecisionKeys();
  const visible = [...deduped.values()].filter((row) => !isReviewDecisionRejected(row, rejectedKeys));
  const sorted = visible.sort((left, right) => {
    if (right.confidence_score !== left.confidence_score) return right.confidence_score - left.confidence_score;
    if (right.estimated_recovery !== left.estimated_recovery) return right.estimated_recovery - left.estimated_recovery;
    return left.artist.localeCompare(right.artist);
  });

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    total_count: sorted.length,
    limit,
    offset,
    rows: sorted.slice(offset, offset + limit),
    genre_options: getApprovedGenreOptions(),
  };
}

function approveReviewQueueItem(item, adminUser) {
  if (!item || !item.source_type) {
    const error = new Error("Review item is required.");
    error.statusCode = 400;
    error.code = "missing_review_item";
    throw error;
  }

  if (item.source_type === "genre_recommendation") {
    return approveGenreRecommendation({
      artist: item.artist,
      playlistCode: item.playlist_code,
      adminUser,
    });
  }

  const artistIntelligenceId = Number.parseInt(item.artist_intelligence_id, 10);
  const genre = normalizeGenre(item.suggested_genre || item.genre);
  const detail = getArtistRecommendationDetail(artistIntelligenceId);
  if (!detail) {
    const error = new Error("Artist intelligence record not found.");
    error.statusCode = 404;
    error.code = "artist_intelligence_not_found";
    throw error;
  }
  const recommendation = findRecommendation(artistIntelligenceId, genre);
  if (!recommendation) {
    const error = new Error("Recommendation was not found or is already approved.");
    error.statusCode = 400;
    error.code = "recommendation_not_found";
    throw error;
  }
  const result = artistGenreRepo.insertArtistGenres({
    artistName: detail.artist.artist_name,
    genres: [genre],
    source: "artist_intelligence_admin",
  });
  markArtistIntelligenceReviewed(artistIntelligenceId);
  return {
    status: "ok",
    mode: "single",
    result: {
      artist: detail.artist,
      approved_genre: genre,
      inserted_count: result.inserted,
      support_count: recommendation.support_count,
      supporting_sources: recommendation.sources,
    },
    message: "Approval saved. Run a separate future sort/rescan to apply the estimated match gain.",
  };
}

function markArtistIntelligenceReviewed(artistIntelligenceId) {
  const parsedId = Number.parseInt(artistIntelligenceId, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return { changed: 0 };
  const db = openDatabase();
  if (!tableExists(db, "artist_intelligence")) return { changed: 0 };
  const result = db.prepare(`
    UPDATE artist_intelligence
    SET review_status = 'reviewed',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(parsedId);
  return { changed: result.changes };
}

async function approveReviewQueueBulk(items, adminUser) {
  const selections = Array.isArray(items) ? items : [];
  if (!selections.length) {
    const error = new Error("At least one review item is required.");
    error.statusCode = 400;
    error.code = "missing_review_items";
    throw error;
  }
  if (selections.length > 100) {
    const error = new Error("Bulk approval is limited to 100 items.");
    error.statusCode = 400;
    error.code = "too_many_review_items";
    throw error;
  }

  const genreSelections = selections
    .filter((item) => item.source_type === "genre_recommendation")
    .map((item) => ({ artist: item.artist, playlist_code: item.playlist_code }));
  const artistSelections = selections.filter((item) => item.source_type !== "genre_recommendation");
  const results = [];
  const errors = [];
  let inserted = 0;

  if (genreSelections.length) {
    const result = await approveSelectedGenreRecommendations({ selections: genreSelections, adminUser });
    results.push(result);
    inserted += result.inserted_genres_count || 0;
    errors.push(...(result.errors || []));
  }

  for (const item of artistSelections) {
    try {
      const result = approveReviewQueueItem(item, adminUser);
      inserted += result.result?.inserted_count || 0;
      results.push(result);
    } catch (err) {
      errors.push({ artist: item.artist || null, suggested_genre: item.suggested_genre || null, error: err.code || "review_queue_approval_error", message: err.message });
    }
  }

  return {
    status: errors.length ? "partial" : "ok",
    attempted_count: selections.length,
    approved_count: results.length,
    inserted_genres_count: inserted,
    error_count: errors.length,
    results,
    errors,
  };
}

function rejectReviewQueueItem(item, adminUser) {
  return {
    ...recordReviewDecision(item, "rejected", { adminUser, evidence: item.evidence_details || {} }),
    item,
    message: "Recommendation rejected and hidden from the default review queue.",
  };
}

function editReviewQueueItem(item, options = {}) {
  const approvedGenre = normalizeGenre(options.approved_genre || options.approvedGenre);
  if (!approvedGenre) {
    const error = new Error("Approved genre is required.");
    error.statusCode = 400;
    error.code = "missing_approved_genre";
    throw error;
  }
  const artistName = String(item?.artist || "").trim();
  if (!artistName) {
    const error = new Error("Artist is required.");
    error.statusCode = 400;
    error.code = "missing_artist";
    throw error;
  }
  const db = openDatabase();
  const run = db.transaction(() => {
    const result = artistGenreRepo.insertArtistGenres({
      artistName,
      genres: [approvedGenre],
      source: "admin_intelligence_edit",
    });
    recordReviewDecision(item, "edited", {
      adminUser: options.adminUser,
      approvedGenre,
      notes: options.notes,
      evidence: item.evidence_details || {},
    });
    if (item.artist_intelligence_id) markArtistIntelligenceReviewed(item.artist_intelligence_id);
    return result;
  });
  const result = run();
  return {
    status: "ok",
    mode: "edit",
    artist: artistName,
    rejected_genre: item.suggested_genre || item.genre,
    approved_genre: approvedGenre,
    inserted_count: result.inserted,
    message: "Edited recommendation approved. The original suggestion will stay hidden from the default review queue.",
  };
}

function getApprovedGenreOptions() {
  const db = openDatabase();
  const genres = new Set(EDITABLE_GENRE_EXTRAS);
  for (const definition of ACTIVE_PLAYLIST_DEFINITIONS) {
    genres.add(definition.playlistCode.replace(/_/g, " "));
    if (definition.shortLabel) genres.add(String(definition.shortLabel).trim().toLowerCase());
  }
  if (tableExists(db, "artist_genres")) {
    const rows = db.prepare("SELECT DISTINCT lower(trim(genre)) AS genre FROM artist_genres WHERE trim(genre) != '' ORDER BY genre").all();
    for (const row of rows) genres.add(row.genre);
  }
  return [...genres].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((genre) => ({
    value: genre,
    label: genre.replace(/\b\w/g, (letter) => letter.toUpperCase()),
  }));
}

function playlistIntelligenceMatches(collectionCode) {
  const db = openDatabase();
  const collection = db.prepare(`
    SELECT id, collection_code
    FROM playlist_collection_definitions
    WHERE collection_code = ?
  `).get(collectionCode);
  const unmatched = unmatchedArtistStats();
  const unmatchedNames = new Set(unmatched.keys());
  let userLibraryMatches = 0;
  let unmatchedMatches = 0;
  let recoveryValue = 0;

  if (tableExists(db, "user_tracks") && tableExists(db, "tracks")) {
    const libraryArtists = new Set();
    const rows = db.prepare(`
      SELECT tracks.artist_names, tracks.raw_json
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
    `).all();
    for (const row of rows) {
      const rawTrack = parseRawTrack(row.raw_json);
      for (const artistName of getArtistNames(row, rawTrack)) libraryArtists.add(normalizeArtistName(artistName));
    }
    const artists = collection
      ? db.prepare("SELECT artist_name FROM playlist_collection_artists WHERE collection_id = ?").all(collection.id)
      : [];
    for (const artist of artists) {
      const key = normalizeArtistName(artist.artist_name);
      if (libraryArtists.has(key)) userLibraryMatches += 1;
      if (unmatchedNames.has(key)) {
        unmatchedMatches += 1;
        recoveryValue += unmatched.get(key)?.estimated_recovery || 0;
      }
    }
  }

  return { user_library_matches: userLibraryMatches, unmatched_matches: unmatchedMatches, recovery_value: recoveryValue };
}

function libraryArtistNames(db) {
  const libraryArtists = new Set();
  if (!tableExists(db, "user_tracks") || !tableExists(db, "tracks")) return libraryArtists;
  const rows = db.prepare(`
    SELECT tracks.artist_names, tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
  `).all();
  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    for (const artistName of getArtistNames(row, rawTrack)) libraryArtists.add(normalizeArtistName(artistName));
  }
  return libraryArtists;
}

function playlistIntelligenceMatchesByCollection(collections = []) {
  const db = openDatabase();
  const result = new Map();
  for (const collection of collections) {
    result.set(collection.id, { user_library_matches: 0, unmatched_matches: 0, recovery_value: 0 });
  }
  if (!collections.length || !tableExists(db, "playlist_collection_artists")) return result;

  const libraryArtists = libraryArtistNames(db);
  const unmatched = unmatchedArtistStats();
  const unmatchedNames = new Set(unmatched.keys());
  const placeholders = collections.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT collection_id, artist_name
    FROM playlist_collection_artists
    WHERE collection_id IN (${placeholders})
  `).all(...collections.map((collection) => collection.id));

  const seenLibrary = new Set();
  const seenUnmatched = new Set();
  for (const row of rows) {
    const key = normalizeArtistName(row.artist_name);
    if (!key) continue;
    const values = result.get(row.collection_id);
    if (!values) continue;
    const libraryKey = `${row.collection_id}::${key}`;
    if (libraryArtists.has(key) && !seenLibrary.has(libraryKey)) {
      values.user_library_matches += 1;
      seenLibrary.add(libraryKey);
    }
    if (unmatchedNames.has(key) && !seenUnmatched.has(libraryKey)) {
      values.unmatched_matches += 1;
      values.recovery_value += unmatched.get(key)?.estimated_recovery || 0;
      seenUnmatched.add(libraryKey);
    }
  }
  return result;
}

function importHistoryByCollection(collections = [], limitPerCollection = 1) {
  const db = openDatabase();
  const history = new Map();
  if (!collections.length || !tableExists(db, "playlist_intelligence_import_logs")) return history;
  const placeholders = collections.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT *
    FROM playlist_intelligence_import_logs
    WHERE collection_id IN (${placeholders})
    ORDER BY collection_id ASC, created_at DESC, id DESC
  `).all(...collections.map((collection) => collection.id));
  for (const row of rows) {
    const list = history.get(row.collection_id) || [];
    if (list.length < limitPerCollection) {
      list.push({
        id: row.id,
        collection_id: row.collection_id,
        collection_code: row.collection_code,
        collection_name: row.collection_name,
        imported_by_user_id: row.imported_by_user_id,
        imported_by_spotify_user_id: row.imported_by_spotify_user_id,
        file_count: Number(row.file_count || 0),
        row_count: Number(row.row_count || 0),
        artists_processed: Number(row.artists_processed || 0),
        artists_inserted: Number(row.artists_inserted || 0),
        artists_updated: Number(row.artists_updated || 0),
        tracks_processed: Number(row.tracks_processed || 0),
        tracks_inserted: Number(row.tracks_inserted || 0),
        tracks_updated: Number(row.tracks_updated || 0),
        duplicates_skipped: Number(row.duplicates_skipped || 0),
        skipped_rows: Number(row.skipped_rows || 0),
        error_count: Number(row.error_count || 0),
        estimated_recoverable_songs: Number(row.estimated_recoverable_songs || 0),
        unmatched_artist_overlap: Number(row.unmatched_artist_overlap || 0),
        created_at: row.created_at,
      });
      history.set(row.collection_id, list);
    }
  }
  return history;
}

function readImportHistory(collectionId, limit = 5) {
  const db = openDatabase();
  if (!tableExists(db, "playlist_intelligence_import_logs")) return [];
  return db.prepare(`
    SELECT *
    FROM playlist_intelligence_import_logs
    WHERE collection_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(collectionId, limit).map((row) => ({
    id: row.id,
    collection_id: row.collection_id,
    collection_code: row.collection_code,
    collection_name: row.collection_name,
    imported_by_user_id: row.imported_by_user_id,
    imported_by_spotify_user_id: row.imported_by_spotify_user_id,
    file_count: Number(row.file_count || 0),
    row_count: Number(row.row_count || 0),
    artists_processed: Number(row.artists_processed || 0),
    artists_inserted: Number(row.artists_inserted || 0),
    artists_updated: Number(row.artists_updated || 0),
    tracks_processed: Number(row.tracks_processed || 0),
    tracks_inserted: Number(row.tracks_inserted || 0),
    tracks_updated: Number(row.tracks_updated || 0),
    duplicates_skipped: Number(row.duplicates_skipped || 0),
    skipped_rows: Number(row.skipped_rows || 0),
    error_count: Number(row.error_count || 0),
    estimated_recoverable_songs: Number(row.estimated_recoverable_songs || 0),
    unmatched_artist_overlap: Number(row.unmatched_artist_overlap || 0),
    created_at: row.created_at,
  }));
}

function getPlaylistIntelligenceWorkflowSummary() {
  const payload = listPlaylistIntelligenceCollections();
  const matches = playlistIntelligenceMatchesByCollection(payload.collections || []);
  const history = importHistoryByCollection(payload.collections || [], 1);
  return {
    ...payload,
    collections: (payload.collections || []).map((collection) => ({
      ...collection,
      ...(matches.get(collection.id) || { user_library_matches: 0, unmatched_matches: 0, recovery_value: 0 }),
      last_import: history.get(collection.id)?.[0] || null,
    })),
  };
}

function createPlaylistIntelligenceWorkflowCollection(body = {}) {
  return createPlaylistIntelligenceCollection({
    collection_name: body.collection_name || body.collectionName,
    collection_code: body.collection_code || body.collectionCode,
    identity_description: body.identity_description || body.identityDescription || "",
    research_status: body.research_status || body.researchStatus || "active",
    notes: body.notes || "",
  });
}

function getPlaylistIntelligenceWorkflowDetail(collectionCode, options = {}) {
  const detail = getPlaylistIntelligenceCollection(collectionCode, options);
  return {
    ...detail,
    overlap: playlistIntelligenceMatches(detail.collection.collection_code),
    import_history: readImportHistory(detail.collection.id, 10),
  };
}

function getTrackGapOverview(options = {}) {
  const limit = normalizeLimit(options.limit, 25, 100);
  const currentUserId = Number.parseInt(options.userId, 10) || 0;
  const scope = "all";
  const genres = unmatchedGenreLogs.getMostCommonUnmatchedGenres(currentUserId, { scope, limit });
  const artists = unmatchedGenreLogs.getMostCommonUnmatchedArtists(currentUserId, { scope, limit });
  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    top_unmatched_genres: genres,
    top_unmatched_artists: artists,
    learning_signals: genres.slice(0, 8).map((row) => ({
      label: row.genre,
      occurrence_count: row.occurrence_count,
      affected_users: row.user_count,
    })),
    era_issues: [],
  };
}

function getTrackGapDetail(type, value, options = {}) {
  const db = openDatabase();
  const limit = normalizeLimit(options.limit, 50, 200);
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    const error = new Error("Gap value is required.");
    error.statusCode = 400;
    error.code = "missing_gap_value";
    throw error;
  }

  const where = type === "artist" ? "normalized_artist_name = @normalized" : "normalized_genre = @normalized";
  const rows = tableExists(db, "unmatched_genre_logs")
    ? db.prepare(`
        SELECT *
        FROM unmatched_genre_logs
        WHERE ${where}
        ORDER BY occurrence_count DESC, last_seen_at DESC
        LIMIT @limit
      `).all({ normalized, limit })
    : [];
  const artistNames = [...new Set(rows.map((row) => row.artist_name).filter(Boolean))];
  const approved = artistNames.length
    ? artistGenreRepo.findGenresByArtistNames(artistNames)
    : new Map();
  return {
    status: "ok",
    type,
    value,
    affected_users: [...new Set(rows.map((row) => row.user_id))].length,
    occurrences: rows.reduce((sum, row) => sum + Number(row.occurrence_count || 0), 0),
    artists: artistNames.map((artistName) => ({
      artist_name: artistName,
      existing_mappings: approved.get(normalizeArtistName(artistName)) || [],
    })),
    tracks: rows.map((row) => ({
      user_id: row.user_id,
      artist_name: row.artist_name,
      track_name: row.track_name,
      genre: row.genre,
      occurrence_count: row.occurrence_count,
      last_seen_at: row.last_seen_at,
    })),
    suggested_mapping: type === "genre" ? { genre: value, action: "Review artist mappings before approval." } : null,
  };
}

module.exports = {
  approveReviewQueueBulk,
  approveReviewQueueItem,
  createPlaylistIntelligenceWorkflowCollection,
  editReviewQueueItem,
  getApprovedGenreOptions,
  getIntelligenceReviewQueue,
  getPlaylistIntelligenceWorkflowDetail,
  getPlaylistIntelligenceWorkflowSummary,
  getTrackGapDetail,
  getTrackGapOverview,
  rejectReviewQueueItem,
};
