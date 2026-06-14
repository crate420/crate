const { openDatabase } = require("../db");
const { normalizeArtistName } = require("../repositories/artistGenres");
const { sourceComparisonSignals } = require("./artistIntelligenceComparison");

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function normalizeSignal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^genre:/, "")
    .replace(/^tag:/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function readArtistEvidenceMaps(db = openDatabase()) {
  const byName = new Map();
  const bySpotifyId = new Map();

  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { byName, bySpotifyId };
  }

  const rows = db.prepare(`
    SELECT
      artist_intelligence.id,
      artist_intelligence.normalized_artist_name,
      artist_intelligence.display_artist_name,
      artist_intelligence.spotify_artist_id,
      artist_intelligence.confidence_score,
      artist_intelligence.source_count,
      artist_intelligence_sources.source,
      artist_intelligence_sources.normalized_signals_json,
      artist_intelligence_sources.error_code,
      artist_intelligence_sources.error_message,
      artist_intelligence_sources.fetched_at,
      artist_intelligence_sources.expires_at
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
    ORDER BY artist_intelligence.normalized_artist_name COLLATE NOCASE ASC,
      artist_intelligence_sources.source COLLATE NOCASE ASC
  `).all();

  for (const row of rows) {
    const key = normalizeArtistName(row.normalized_artist_name || row.display_artist_name);
    if (!key) continue;

    const entry = byName.get(key) || {
      artist_intelligence_id: row.id,
      normalized_artist_name: key,
      display_artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: Number(row.confidence_score || 0),
      source_count: Number(row.source_count || 0),
      sources: [],
      source_names: [],
      signals: [],
      errored_sources: [],
    };

    if (row.source) {
      const source = {
        source: row.source,
        normalized_signals_json: row.normalized_signals_json,
        error_code: row.error_code,
        error_message: row.error_message,
        fetched_at: row.fetched_at,
        expires_at: row.expires_at,
      };
      entry.sources.push(source);
      if (row.error_code) {
        entry.errored_sources.push(row.source);
      } else {
        entry.source_names.push(row.source);
        entry.signals.push(...sourceComparisonSignals(source).map(normalizeSignal).filter(Boolean));
      }
    }

    entry.source_names = unique(entry.source_names).sort();
    entry.errored_sources = unique(entry.errored_sources).sort();
    entry.signals = unique(entry.signals).sort();
    byName.set(key, entry);
    if (entry.spotify_artist_id) bySpotifyId.set(entry.spotify_artist_id, entry);
  }

  return { byName, bySpotifyId };
}

function findArtistEvidence({ artistNames = [], spotifyArtistIds = [] } = {}, evidenceMaps = readArtistEvidenceMaps()) {
  const matches = [];

  for (const artistName of artistNames || []) {
    const match = evidenceMaps.byName.get(normalizeArtistName(artistName));
    if (match) matches.push(match);
  }

  for (const spotifyArtistId of spotifyArtistIds || []) {
    const match = evidenceMaps.bySpotifyId.get(spotifyArtistId);
    if (match) matches.push(match);
  }

  const deduped = new Map();
  for (const match of matches) {
    deduped.set(match.artist_intelligence_id || match.normalized_artist_name, match);
  }

  return [...deduped.values()];
}

function summarizeArtistEvidence(evidence = []) {
  const sourceNames = unique(evidence.flatMap((entry) => entry.source_names || [])).sort();
  const erroredSources = unique(evidence.flatMap((entry) => entry.errored_sources || [])).sort();
  const signals = unique(evidence.flatMap((entry) => entry.signals || [])).sort();

  return {
    source_names: sourceNames,
    errored_sources: erroredSources,
    signals,
    has_cached_intelligence: evidence.length > 0,
    has_usable_signals: signals.length > 0,
    max_confidence_score: evidence.reduce((max, entry) => Math.max(max, Number(entry.confidence_score || 0)), 0),
  };
}

module.exports = {
  findArtistEvidence,
  normalizeSignal,
  readArtistEvidenceMaps,
  summarizeArtistEvidence,
};
