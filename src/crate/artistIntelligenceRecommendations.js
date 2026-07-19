const { openDatabase } = require("../db");
const { sourceComparisonSignals } = require("./artistIntelligenceComparison");
const { classifySignal } = require("./signalClassification");

const MIN_RECOMMENDATION_CONFIDENCE = 85;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_BULK_LIMIT = 50;
const MAX_BULK_LIMIT = 100;
const DEFAULT_BULK_CONFIDENCE = 95;
const DEFAULT_BULK_SUPPORT = 3;
const PLAYLIST_INTELLIGENCE_SOURCE = "Playlist Intelligence";
const REVIEWABLE_PLAYLIST_INTELLIGENCE_STATUSES = ["candidate", "approved"];
const PLAYLIST_INTELLIGENCE_COLLECTION_SIGNALS = {
  alt_rb: "alternative r&b",
  college_radio: "college rock",
};

function normalizeGenre(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeArtistName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT, MAX_LIMIT);
}

function normalizeConfidence(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(Number.isInteger(parsed) ? parsed : MIN_RECOMMENDATION_CONFIDENCE, MIN_RECOMMENDATION_CONFIDENCE);
}

function normalizeBulkLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BULK_LIMIT, MAX_BULK_LIMIT);
}

function normalizeSupport(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(Math.max(Number.isInteger(parsed) ? parsed : DEFAULT_BULK_SUPPORT, 2), 3);
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function getApprovedGenreSetForArtist(artist) {
  const db = openDatabase();
  if (!tableExists(db, "artist_genres")) return new Set();

  const artistNames = [...new Set([
    normalizeArtistName(artist?.display_artist_name),
    normalizeArtistName(artist?.normalized_artist_name),
  ].filter(Boolean))];
  if (!artistNames.length) return new Set();

  const placeholders = artistNames.map(() => "?").join(", ");
  return new Set(db.prepare(`
    SELECT genre
    FROM artist_genres
    WHERE lower(trim(artist_name)) IN (${placeholders})
  `).all(...artistNames).map((row) => normalizeGenre(row.genre)).filter(Boolean));
}

function getSourcesForArtist(artistIntelligenceId) {
  return openDatabase().prepare(`
    SELECT *
    FROM artist_intelligence_sources
    WHERE artist_intelligence_id = ?
    ORDER BY source COLLATE NOCASE ASC
  `).all(artistIntelligenceId);
}

function sourceWeight(source) {
  if (source.source_type !== "playlist_intelligence") return 1;
  const trustWeight = { high: 1, medium: 0.75, low: 0.4 }[source.trust_level] || 0.75;
  const reviewWeight = source.review_status === "approved" ? 1 : 0.85;
  const sourceCountBonus = Math.min(Number(source.source_count || 0), 6) * 0.08;
  const trackBonus = Math.min(Number(source.supporting_track_count || 0), 25) * 0.01;
  return Math.min(1.35, trustWeight * reviewWeight + sourceCountBonus + trackBonus);
}

function playlistIntelligenceSignal(row) {
  return normalizeGenre(PLAYLIST_INTELLIGENCE_COLLECTION_SIGNALS[row.collection_code] || row.collection_name);
}

function playlistIntelligenceConfidence(row) {
  const base = Number(row.confidence_score || 0) || (row.review_status === "approved" ? 82 : 70);
  const trustAdjustment = { high: 5, medium: 0, low: -12 }[row.trust_level] || 0;
  const reviewAdjustment = row.review_status === "approved" ? 5 : 0;
  const sourceAdjustment = Math.min(Number(row.source_count || row.accepted_source_count || 0), 4) * 2;
  const trackAdjustment = Math.min(Number(row.supporting_track_count || 0), 20) * 0.25;
  const cap = row.review_status === "approved" && row.trust_level === "high" ? 95 : 92;
  return Math.max(0, Math.min(cap, Math.round(base + trustAdjustment + reviewAdjustment + sourceAdjustment)));
}

function playlistIntelligenceArtistNameSubquery() {
  return `
    SELECT DISTINCT lower(playlist_collection_artists.artist_name)
    FROM playlist_collection_artists
    INNER JOIN playlist_collection_definitions
      ON playlist_collection_definitions.id = playlist_collection_artists.collection_id
    WHERE playlist_collection_artists.review_status IN ('candidate', 'approved')
      AND playlist_collection_definitions.research_status IN ('active', 'research')
  `;
}

function getPlaylistIntelligenceArtistEvidence(artist) {
  const db = openDatabase();
  if (!tableExists(db, "playlist_collection_artists") || !tableExists(db, "playlist_collection_definitions")) return [];

  const artistNames = [...new Set([
    normalizeArtistName(artist?.display_artist_name),
    normalizeArtistName(artist?.normalized_artist_name),
  ].filter(Boolean))];
  if (!artistNames.length) return [];

  const placeholders = artistNames.map(() => "?").join(", ");
  const hasSources = tableExists(db, "playlist_collection_sources");
  const sourceSelect = hasSources
    ? `COALESCE(source_summary.accepted_source_count, 0) AS accepted_source_count,
       COALESCE(source_summary.total_source_count, 0) AS total_source_count,
       COALESCE(source_summary.best_trust_level, 'medium') AS trust_level`
    : `0 AS accepted_source_count,
       0 AS total_source_count,
       'medium' AS trust_level`;
  const sourceJoin = hasSources
    ? `LEFT JOIN (
         SELECT
           collection_id,
           SUM(CASE WHEN active = 1 AND include_in_consensus = 1 AND review_status IN ('candidate', 'approved') THEN 1 ELSE 0 END) AS accepted_source_count,
           COUNT(*) AS total_source_count,
           CASE
             WHEN SUM(CASE WHEN active = 1 AND include_in_consensus = 1 AND review_status IN ('candidate', 'approved') AND trust_level = 'high' THEN 1 ELSE 0 END) > 0 THEN 'high'
             WHEN SUM(CASE WHEN active = 1 AND include_in_consensus = 1 AND review_status IN ('candidate', 'approved') AND trust_level = 'medium' THEN 1 ELSE 0 END) > 0 THEN 'medium'
             ELSE 'low'
           END AS best_trust_level
         FROM playlist_collection_sources
         GROUP BY collection_id
       ) AS source_summary ON source_summary.collection_id = playlist_collection_definitions.id`
    : "";
  const trackSummaryJoin = tableExists(db, "playlist_collection_tracks")
    ? `LEFT JOIN (
         SELECT
           collection_id,
           lower(artist_name) AS normalized_artist_name,
           COUNT(*) AS supporting_track_count,
           SUM(evidence_count) AS supporting_track_evidence_count,
           MAX(updated_at) AS tracks_updated_at
         FROM playlist_collection_tracks
         WHERE review_status IN ('candidate', 'approved')
         GROUP BY collection_id, lower(artist_name)
       ) AS track_summary
         ON track_summary.collection_id = playlist_collection_artists.collection_id
        AND track_summary.normalized_artist_name = lower(playlist_collection_artists.artist_name)`
    : "";
  const trackSummarySelect = tableExists(db, "playlist_collection_tracks")
    ? `COALESCE(track_summary.supporting_track_count, 0) AS supporting_track_count,
       COALESCE(track_summary.supporting_track_evidence_count, 0) AS supporting_track_evidence_count,
       track_summary.tracks_updated_at AS tracks_updated_at`
    : `0 AS supporting_track_count,
       0 AS supporting_track_evidence_count,
       NULL AS tracks_updated_at`;

  return db.prepare(`
    SELECT
      playlist_collection_artists.*,
      playlist_collection_definitions.collection_code,
      playlist_collection_definitions.collection_name,
      playlist_collection_definitions.research_status,
      ${sourceSelect},
      ${trackSummarySelect}
    FROM playlist_collection_artists
    INNER JOIN playlist_collection_definitions
      ON playlist_collection_definitions.id = playlist_collection_artists.collection_id
    ${sourceJoin}
    ${trackSummaryJoin}
    WHERE lower(playlist_collection_artists.artist_name) IN (${placeholders})
      AND playlist_collection_artists.review_status IN (${REVIEWABLE_PLAYLIST_INTELLIGENCE_STATUSES.map(() => "?").join(", ")})
      AND playlist_collection_definitions.research_status IN ('active', 'research')
    ORDER BY playlist_collection_artists.confidence_score DESC, playlist_collection_definitions.collection_name COLLATE NOCASE ASC
  `).all(...artistNames, ...REVIEWABLE_PLAYLIST_INTELLIGENCE_STATUSES)
    .filter((row) => row.review_status === "approved" || Number(row.total_source_count || 0) === 0 || Number(row.accepted_source_count || 0) > 0)
    .map((row) => {
      const sourceCount = Math.max(Number(row.source_count || 0), Number(row.accepted_source_count || 0), Number(row.appearance_count || 0));
      return {
        source: `${PLAYLIST_INTELLIGENCE_SOURCE}: ${row.collection_name}`,
        source_type: "playlist_intelligence",
        signal: playlistIntelligenceSignal(row),
        review_status: row.review_status,
        trust_level: row.trust_level || "medium",
        confidence_score: playlistIntelligenceConfidence({ ...row, source_count: sourceCount }),
        collection_code: row.collection_code,
        collection_name: row.collection_name,
        source_count: sourceCount,
        appearance_count: Number(row.appearance_count || 0),
        evidence_count: Number(row.evidence_count || 0),
        supporting_track_count: Number(row.supporting_track_count || 0),
        supporting_track_evidence_count: Number(row.supporting_track_evidence_count || 0),
        updated_at: [row.updated_at, row.tracks_updated_at].filter(Boolean).sort().pop() || row.updated_at || null,
      };
    });
}

function confidenceReason({ artist, sources, supportWeight }) {
  const playlistSources = sources.filter((source) => source.source_type === "playlist_intelligence");
  if (playlistSources.length) {
    const playlistCount = playlistSources.reduce((sum, source) => sum + Number(source.source_count || 0), 0);
    const trackCount = playlistSources.reduce((sum, source) => sum + Number(source.supporting_track_count || 0), 0);
    return `Playlist Intelligence: ${playlistSources.length} collection(s), ${playlistCount} playlist signal(s), ${trackCount} supporting track(s).`;
  }
  return `Production intelligence confidence ${Number(artist?.confidence_score || 0)} with ${Math.round(supportWeight * 100) / 100} support weight.`;
}

function buildRecommendations(artist, sources = []) {
  if (!artist) return [];

  const supportingSources = new Map();
  const approvedGenres = getApprovedGenreSetForArtist(artist);
  const playlistEvidenceRows = getPlaylistIntelligenceArtistEvidence(artist);
  if (Number(artist.confidence_score || 0) < MIN_RECOMMENDATION_CONFIDENCE && playlistEvidenceRows.length === 0) return [];

  for (const source of sources.filter((row) => !row.error_code)) {
    for (const signal of sourceComparisonSignals(source)) {
      const normalizedSignal = normalizeGenre(signal);
      if (approvedGenres.has(normalizedSignal)) continue;
      const evidence = supportingSources.get(normalizedSignal) || new Map();
      evidence.set(source.source, { source: source.source, source_type: source.source || "artist_intelligence", weight: sourceWeight(source), confidence_score: Number(artist.confidence_score || 0) });
      supportingSources.set(normalizedSignal, evidence);
    }
  }

  for (const evidenceRow of playlistEvidenceRows) {
    if (!evidenceRow.signal) continue;
    if (approvedGenres.has(evidenceRow.signal)) continue;
    const evidence = supportingSources.get(evidenceRow.signal) || new Map();
    evidence.set(evidenceRow.source, { ...evidenceRow, weight: sourceWeight(evidenceRow) });
    supportingSources.set(evidenceRow.signal, evidence);
  }

  return [...supportingSources.entries()]
    .map(([genre, evidence]) => {
      const sources = [...evidence.values()];
      const supportWeight = sources.reduce((sum, source) => sum + Number(source.weight || 0), 0);
      const evidenceConfidence = Math.min(95, Math.max(Number(artist.confidence_score || 0), ...sources.map((source) => Number(source.confidence_score || 0))));
      const playlistSources = sources.filter((source) => source.source_type === "playlist_intelligence");
      return {
        genre,
        classification: classifySignal(genre),
        support_count: sources.length,
        support_weight: Math.round(supportWeight * 100) / 100,
        confidence_score: evidenceConfidence,
        confidence_reason: confidenceReason({ artist, sources, supportWeight }),
        playlist_intelligence_collections: playlistSources.map((source) => ({
          collection_code: source.collection_code,
          collection_name: source.collection_name,
          source_count: Number(source.source_count || 0),
          evidence_count: Number(source.evidence_count || 0),
          supporting_track_count: Number(source.supporting_track_count || 0),
          supporting_track_evidence_count: Number(source.supporting_track_evidence_count || 0),
          confidence_score: Number(source.confidence_score || 0),
          review_status: source.review_status || null,
          trust_level: source.trust_level || null,
          updated_at: source.updated_at || null,
        })),
        playlist_intelligence_consensus_count: playlistSources.reduce((sum, source) => sum + Number(source.source_count || 0), 0),
        playlist_intelligence_supporting_tracks: playlistSources.reduce((sum, source) => sum + Number(source.supporting_track_count || 0), 0),
        last_updated: sources.map((source) => source.updated_at).filter(Boolean).sort().pop() || null,
        sources: sources.map((source) => source.source).sort(),
        source_details: sources
          .map((source) => ({
            source: source.source,
            source_type: source.source_type || "artist_intelligence",
            collection_code: source.collection_code || null,
            collection_name: source.collection_name || null,
            review_status: source.review_status || null,
            trust_level: source.trust_level || null,
            source_count: source.source_count || null,
            evidence_count: source.evidence_count || null,
            supporting_track_count: source.supporting_track_count || null,
            supporting_track_evidence_count: source.supporting_track_evidence_count || null,
            updated_at: source.updated_at || null,
            weight: Math.round(Number(source.weight || 0) * 100) / 100,
            confidence_score: source.confidence_score || null,
          }))
          .sort((left, right) => left.source.localeCompare(right.source)),
      };
    })
    .filter((recommendation) => {
      if (recommendation.classification !== "GENRE") return false;
      if (recommendation.support_count >= 2 && recommendation.support_weight >= 1.5) return true;
      return recommendation.playlist_intelligence_collections.length > 0
        && recommendation.support_weight >= 0.85
        && recommendation.confidence_score >= MIN_RECOMMENDATION_CONFIDENCE;
    })
    .sort((left, right) => right.support_weight - left.support_weight || right.support_count - left.support_count || left.genre.localeCompare(right.genre));
}

function getArtistRecommendationDetail(id) {
  const parsedId = Number.parseInt(id, 10);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return undefined;

  const artist = openDatabase().prepare("SELECT * FROM artist_intelligence WHERE id = ?").get(parsedId);
  if (!artist) return undefined;

  return {
    artist: {
      id: artist.id,
      artist_name: artist.display_artist_name,
      spotify_artist_id: artist.spotify_artist_id,
      review_status: artist.review_status,
      confidence_score: artist.confidence_score,
      source_count: artist.source_count,
    },
    recommendations: buildRecommendations(artist, getSourcesForArtist(artist.id)),
  };
}

function listArtistIntelligenceRecommendations(options = {}) {
  const limit = normalizeLimit(options.limit);
  const confidenceMin = normalizeConfidence(options.confidenceMin);
  const clauses = ["confidence_score >= @confidenceMin"];
  const params = { confidenceMin, limit };

  if (options.reviewedOnly === true && options.pendingOnly === true) return [];
  if (options.reviewedOnly === true) clauses.push("review_status = 'reviewed'");
  if (options.pendingOnly === true) clauses.push("review_status = 'pending'");
  clauses[0] = `(confidence_score >= @confidenceMin OR normalized_artist_name IN (${playlistIntelligenceArtistNameSubquery()}))`;

  return openDatabase().prepare(`
    SELECT *
    FROM artist_intelligence
    WHERE ${clauses.join(" AND ")}
    ORDER BY confidence_score DESC, display_artist_name COLLATE NOCASE ASC
    LIMIT @limit
  `).all(params).map((artist) => {
    const recommendations = buildRecommendations(artist, getSourcesForArtist(artist.id));
    return {
      artist: {
        id: artist.id,
        artist_name: artist.display_artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        review_status: artist.review_status,
      },
      confidence_score: artist.confidence_score,
      recommended_genres: recommendations.map((recommendation) => recommendation.genre),
      recommendations,
    };
  }).filter((row) => row.recommendations.length > 0);
}

function findRecommendation(artistIntelligenceId, genre) {
  const normalizedGenre = normalizeGenre(genre);
  return getArtistRecommendationDetail(artistIntelligenceId)?.recommendations
    .find((recommendation) => recommendation.genre === normalizedGenre);
}

function getBulkRecommendationCandidates(options = {}) {
  const confidenceMin = Math.max(normalizeConfidence(options.confidenceMin), DEFAULT_BULK_CONFIDENCE);
  const supportMin = normalizeSupport(options.supportMin);
  const limit = normalizeBulkLimit(options.limit);
  const artists = listArtistIntelligenceRecommendations({ confidenceMin, limit });
  const candidateArtists = artists.map((row) => ({
    artist: row.artist,
    confidence_score: row.confidence_score,
    recommendations: row.recommendations.filter((recommendation) => recommendation.classification === "GENRE" && recommendation.support_count >= supportMin && Number(recommendation.support_weight || recommendation.support_count || 0) >= supportMin),
  })).filter((row) => row.recommendations.length > 0);

  return { confidence_min: confidenceMin, support_min: supportMin, limit, artists: candidateArtists };
}

function previewBulkRecommendations(options = {}) {
  const plan = getBulkRecommendationCandidates(options);
  const genres = plan.artists.flatMap((row) => row.recommendations.map((recommendation) => recommendation.genre));
  return {
    confidence_min: plan.confidence_min,
    support_min: plan.support_min,
    limit: plan.limit,
    total_candidate_artists: plan.artists.length,
    total_candidate_genres: genres.length,
    sample_artists: plan.artists.slice(0, 10).map((row) => ({ artist_name: row.artist.artist_name, confidence_score: row.confidence_score, genres: row.recommendations.map((recommendation) => recommendation.genre) })),
    sample_genres: [...new Set(genres)].slice(0, 20),
  };
}

module.exports = {
  MIN_RECOMMENDATION_CONFIDENCE,
  buildRecommendations,
  findRecommendation,
  getBulkRecommendationCandidates,
  getArtistRecommendationDetail,
  listArtistIntelligenceRecommendations,
  normalizeGenre,
  previewBulkRecommendations,
};
