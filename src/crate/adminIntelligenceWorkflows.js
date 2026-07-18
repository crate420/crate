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
  getPlaylistIntelligenceCollection,
  listPlaylistIntelligenceCollections,
} = require("./playlistIntelligence");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const DEFAULT_REVIEW_LIMIT = 50;
const MAX_REVIEW_LIMIT = 200;

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
  };
}

function reviewRowFromGenreRecommendation(row) {
  const evidence = row.supporting_evidence || [];
  const evidenceSources = [...new Set(evidence.map((item) => sourceLabel({ source: item.source })))];
  return {
    key: `genre_recommendation:${row.normalized_artist_name}:${row.recommended_playlist_code}`,
    source_type: "genre_recommendation",
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

  const sorted = [...deduped.values()].sort((left, right) => {
    if (right.estimated_recovery !== left.estimated_recovery) return right.estimated_recovery - left.estimated_recovery;
    if (right.confidence_score !== left.confidence_score) return right.confidence_score - left.confidence_score;
    return left.artist.localeCompare(right.artist);
  });

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    total_count: sorted.length,
    limit,
    offset,
    rows: sorted.slice(offset, offset + limit),
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

function playlistIntelligenceMatches(collectionCode) {
  const db = openDatabase();
  const collection = getPlaylistIntelligenceCollection(collectionCode);
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
    for (const artist of collection.consensus_artists || []) {
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

function getPlaylistIntelligenceWorkflowSummary() {
  const payload = listPlaylistIntelligenceCollections();
  return {
    ...payload,
    collections: (payload.collections || []).map((collection) => ({
      ...collection,
      ...playlistIntelligenceMatches(collection.collection_code),
    })),
  };
}

function getPlaylistIntelligenceWorkflowDetail(collectionCode) {
  const detail = getPlaylistIntelligenceCollection(collectionCode);
  return {
    ...detail,
    overlap: playlistIntelligenceMatches(detail.collection.collection_code),
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
  getIntelligenceReviewQueue,
  getPlaylistIntelligenceWorkflowDetail,
  getPlaylistIntelligenceWorkflowSummary,
  getTrackGapDetail,
  getTrackGapOverview,
};
