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

function normalizeGenre(value) {
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

function getSourcesForArtist(artistIntelligenceId) {
  return openDatabase().prepare(`
    SELECT *
    FROM artist_intelligence_sources
    WHERE artist_intelligence_id = ?
    ORDER BY source COLLATE NOCASE ASC
  `).all(artistIntelligenceId);
}

function buildRecommendations(artist, sources = []) {
  if (!artist || Number(artist.confidence_score || 0) < MIN_RECOMMENDATION_CONFIDENCE) return [];

  const supportingSources = new Map();

  for (const source of sources.filter((row) => !row.error_code)) {
    for (const signal of sourceComparisonSignals(source)) {
      const names = supportingSources.get(signal) || new Set();
      names.add(source.source);
      supportingSources.set(signal, names);
    }
  }

  return [...supportingSources.entries()]
    .filter(([signal, names]) => names.size >= 2 && classifySignal(signal) === "GENRE")
    .map(([genre, names]) => ({ genre, classification: "GENRE", support_count: names.size, sources: [...names].sort() }))
    .sort((left, right) => right.support_count - left.support_count || left.genre.localeCompare(right.genre));
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
    recommendations: row.recommendations.filter((recommendation) => recommendation.classification === "GENRE" && recommendation.support_count >= supportMin),
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
