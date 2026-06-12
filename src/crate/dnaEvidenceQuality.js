const { openDatabase } = require("../db");
const { normalizeArtistName } = require("../repositories/artistGenres");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");
const { getAdminPlaylistDnaValidation } = require("./playlistDnaValidation");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { getArtistIds, getArtistNames, parseRawTrack } = require("./trackContext");

const PLAYLISTS = new Map(ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [definition.playlistCode, definition]));
const METADATA_PREFIXES = ["era ", "year ", "album ", "popularity ", "explicit "];

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeSignal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^genre:/, "")
    .replace(/^tag:/, "")
    .replace(/_/g, " ")
    .replace(/[^a-z0-9&$' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMetadataSignal(signal) {
  return METADATA_PREFIXES.some((prefix) => String(signal || "").startsWith(prefix));
}

function percentage(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function coveragePercentage(count, total) {
  return Math.min(100, percentage(count, total));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function tierForScore(score) {
  if (score >= 85) return "Tier A - Autonomous Candidate";
  if (score >= 70) return "Tier B - Nearly Ready";
  if (score >= 50) return "Tier C - Needs More Evidence";
  return "Tier D - Not Ready";
}

function tierKey(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

function readArtistCache(db) {
  const approvedByArtist = new Map();
  if (tableExists(db, "artist_genres")) {
    for (const row of db.prepare("SELECT artist_name, genre FROM artist_genres").all()) {
      const key = normalizeArtistName(row.artist_name);
      const list = approvedByArtist.get(key) || [];
      list.push(normalizeSignal(row.genre));
      approvedByArtist.set(key, list);
    }
  }

  const byName = new Map();
  const bySpotifyId = new Map();
  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { approvedByArtist, byName, bySpotifyId };
  }

  const rows = db.prepare(`
    SELECT
      artist_intelligence.normalized_artist_name,
      artist_intelligence.display_artist_name,
      artist_intelligence.spotify_artist_id,
      artist_intelligence.confidence_score,
      artist_intelligence_sources.source,
      artist_intelligence_sources.normalized_signals_json,
      artist_intelligence_sources.error_code
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
  `).all();

  for (const row of rows) {
    const key = row.normalized_artist_name;
    if (!key) continue;
    const entry = byName.get(key) || {
      artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: row.confidence_score || 0,
      spotify_genres: new Set(),
      lastfm_artist_tags: new Set(),
      musicbrainz_tags: new Set(),
      sources: new Set(),
    };
    if (row.source && !row.error_code) {
      const signals = parseJson(row.normalized_signals_json, []).map(normalizeSignal).filter(Boolean);
      entry.sources.add(row.source);
      if (row.source === "spotify") {
        signals
          .filter((signal) => !signal.startsWith("popularity:") && !signal.startsWith("followers total:") && !signal.startsWith("spotify artist id:") && !signal.startsWith("artist name:"))
          .forEach((signal) => entry.spotify_genres.add(signal));
      } else if (row.source === "lastfm") {
        signals.forEach((signal) => entry.lastfm_artist_tags.add(signal));
      } else if (row.source === "musicbrainz") {
        signals
          .filter((signal) => signal.startsWith("tag:") || !signal.includes(":"))
          .map((signal) => signal.replace(/^tag:/, ""))
          .filter(Boolean)
          .forEach((signal) => entry.musicbrainz_tags.add(signal));
      }
    }
    byName.set(key, entry);
    if (entry.spotify_artist_id) bySpotifyId.set(entry.spotify_artist_id, entry);
  }

  return { approvedByArtist, byName, bySpotifyId };
}

function readTrackCache(db) {
  const byIdentityKey = new Map();
  const bySpotifyTrackId = new Map();
  const byIsrc = new Map();
  const byArtistTrack = new Map();
  if (!tableExists(db, "track_intelligence") || !tableExists(db, "track_intelligence_sources")) {
    return { byIdentityKey, bySpotifyTrackId, byIsrc, byArtistTrack };
  }

  const rows = db.prepare(`
    SELECT
      track_intelligence.identity_key,
      track_intelligence.spotify_track_id,
      track_intelligence.isrc,
      track_intelligence.normalized_artist_name,
      track_intelligence.normalized_track_name,
      track_intelligence.confidence_score,
      track_intelligence_sources.source,
      track_intelligence_sources.normalized_signals_json,
      track_intelligence_sources.error_code
    FROM track_intelligence
    LEFT JOIN track_intelligence_sources
      ON track_intelligence_sources.track_intelligence_id = track_intelligence.id
  `).all();

  for (const row of rows) {
    const entry = byIdentityKey.get(row.identity_key) || {
      identity_key: row.identity_key,
      spotify_track_id: row.spotify_track_id,
      isrc: row.isrc,
      normalized_artist_name: row.normalized_artist_name,
      normalized_track_name: row.normalized_track_name,
      confidence_score: row.confidence_score || 0,
      lastfm_track_tags: new Set(),
      sources: new Set(),
    };
    if (row.source === "lastfm" && !row.error_code) {
      parseJson(row.normalized_signals_json, []).map(normalizeSignal).filter(Boolean).forEach((signal) => entry.lastfm_track_tags.add(signal));
      entry.sources.add("lastfm");
    }
    byIdentityKey.set(row.identity_key, entry);
    if (entry.spotify_track_id) bySpotifyTrackId.set(entry.spotify_track_id, entry);
    if (entry.isrc) byIsrc.set(entry.isrc, entry);
    byArtistTrack.set(`${entry.normalized_artist_name}:${entry.normalized_track_name}`, entry);
  }

  return { byIdentityKey, bySpotifyTrackId, byIsrc, byArtistTrack };
}

function extractIsrc(rawTrack) {
  return rawTrack?.external_ids?.isrc || null;
}

function cachedTrackFor(row, rawTrack, artistName, trackCache) {
  const isrc = extractIsrc(rawTrack);
  const identityKey = trackIntelligenceRepo.buildTrackIdentityKey({
    spotifyTrackId: row.spotify_track_id,
    isrc,
    artistName,
    trackName: row.name,
  });
  const artistTrackKey = `${trackIntelligenceRepo.normalizeText(artistName)}:${trackIntelligenceRepo.normalizeText(row.name)}`;
  return trackCache.byIdentityKey.get(identityKey) ||
    (row.spotify_track_id ? trackCache.bySpotifyTrackId.get(row.spotify_track_id) : null) ||
    (isrc ? trackCache.byIsrc.get(String(isrc).trim().toUpperCase()) : null) ||
    trackCache.byArtistTrack.get(artistTrackKey) ||
    null;
}

function readAssignedRows(db) {
  return db.prepare(`
    SELECT
      user_tracks.user_id,
      user_tracks.track_id,
      COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS playlist_code,
      tracks.spotify_track_id,
      tracks.name,
      tracks.artist_names,
      tracks.album_name,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    WHERE COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) IS NOT NULL
  `).all();
}

function emptyCoverage(playlistCode) {
  return {
    playlist_code: playlistCode,
    playlist_label: PLAYLISTS.get(playlistCode)?.shortLabel || playlistCode,
    category: PLAYLISTS.get(playlistCode)?.category || "unknown",
    track_count: 0,
    artists: new Set(),
    albums: new Set(),
    artist_intelligence: 0,
    lastfm_artist: 0,
    lastfm_track: 0,
    musicbrainz: 0,
    spotify: 0,
    approved_artist_genres: 0,
    multiple_source_agreement: 0,
    specialty_signal: 0,
    strong_artist_evidence: 0,
    strong_track_evidence: 0,
    signalCounts: new Map(),
    conflictingSignals: new Map(),
  };
}

function addSignals(map, values, weight = 1) {
  for (const value of values || []) {
    const normalized = normalizeSignal(value);
    if (!normalized || isMetadataSignal(normalized)) continue;
    map.set(normalized, (map.get(normalized) || 0) + weight);
  }
}

function analyzeRow(row, caches, coverageByPlaylist) {
  const playlistCode = row.playlist_code;
  if (!playlistCode) return;
  const record = coverageByPlaylist.get(playlistCode) || emptyCoverage(playlistCode);
  const rawTrack = parseRawTrack(row.raw_json);
  const artistNames = getArtistNames(row, rawTrack);
  const artistIds = getArtistIds(rawTrack);
  const primaryArtistName = artistNames[0] || "Unknown Artist";
  const trackCache = cachedTrackFor(row, rawTrack, primaryArtistName, caches.trackCache);
  const sourceTypes = new Set();
  const spotifySignals = new Set();
  const lastfmArtistSignals = new Set();
  const musicbrainzSignals = new Set();
  const approvedSignals = new Set();

  record.track_count += 1;
  artistNames.forEach((artist) => record.artists.add(artist));
  if (row.album_name) record.albums.add(row.album_name);

  for (const artistName of artistNames) {
    const normalized = normalizeArtistName(artistName);
    (caches.artistCache.approvedByArtist.get(normalized) || []).forEach((signal) => approvedSignals.add(signal));
    const cached = caches.artistCache.byName.get(normalized);
    if (cached) {
      if (cached.sources.size > 0) record.artist_intelligence += 1;
      cached.sources.forEach((source) => sourceTypes.add(source));
      cached.spotify_genres.forEach((signal) => spotifySignals.add(signal));
      cached.lastfm_artist_tags.forEach((signal) => lastfmArtistSignals.add(signal));
      cached.musicbrainz_tags.forEach((signal) => musicbrainzSignals.add(signal));
    }
  }

  for (const artistId of artistIds) {
    const cached = caches.artistCache.bySpotifyId.get(artistId);
    if (!cached) continue;
    if (cached.sources.size > 0) record.artist_intelligence += 1;
    cached.sources.forEach((source) => sourceTypes.add(source));
    cached.spotify_genres.forEach((signal) => spotifySignals.add(signal));
    cached.lastfm_artist_tags.forEach((signal) => lastfmArtistSignals.add(signal));
    cached.musicbrainz_tags.forEach((signal) => musicbrainzSignals.add(signal));
  }

  if (approvedSignals.size) record.approved_artist_genres += 1;
  if (spotifySignals.size) record.spotify += 1;
  if (lastfmArtistSignals.size) record.lastfm_artist += 1;
  if (musicbrainzSignals.size) record.musicbrainz += 1;
  if (trackCache?.lastfm_track_tags?.size) {
    record.lastfm_track += 1;
    sourceTypes.add("lastfm_track");
  }
  if (sourceTypes.size >= 2) record.multiple_source_agreement += 1;
  if (playlistCode.startsWith("specialty_")) record.specialty_signal += 1;
  if (approvedSignals.size || spotifySignals.size || lastfmArtistSignals.size || musicbrainzSignals.size) record.strong_artist_evidence += 1;
  if (trackCache?.lastfm_track_tags?.size) record.strong_track_evidence += 1;

  addSignals(record.signalCounts, approvedSignals, 3);
  addSignals(record.signalCounts, spotifySignals, 2.5);
  addSignals(record.signalCounts, lastfmArtistSignals, 1.5);
  addSignals(record.signalCounts, musicbrainzSignals, 1.25);
  addSignals(record.signalCounts, trackCache ? [...trackCache.lastfm_track_tags] : [], 3);

  coverageByPlaylist.set(playlistCode, record);
}

function serializeTopSignals(map, limit = 12) {
  return [...map.entries()]
    .map(([signal, count]) => ({ signal, count: Math.round(count * 100) / 100 }))
    .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal))
    .slice(0, limit);
}

function coverageScore(coverage) {
  return (
    coverage.spotify_genre_coverage * 0.14 +
    coverage.approved_artist_genre_coverage * 0.10 +
    coverage.lastfm_artist_coverage * 0.16 +
    coverage.lastfm_track_coverage * 0.22 +
    coverage.musicbrainz_coverage * 0.12 +
    coverage.multiple_source_agreement * 0.18 +
    coverage.artist_intelligence_coverage * 0.10
  );
}

function diversityScore(row) {
  const artistDepth = Math.min(100, row.unique_artist_count * 2);
  const albumDepth = Math.min(100, row.unique_album_count * 1.5);
  const countDepth = Math.min(100, row.track_count / 5);
  return (artistDepth * 0.35) + (albumDepth * 0.25) + (countDepth * 0.40);
}

function readinessScore({ validation, coverage }) {
  const validationScore = validation ? (validation.accuracy * 0.55 + validation.precision * 0.20 + validation.recall * 0.25) : 0;
  const coverageQuality = coverageScore(coverage);
  const diversity = diversityScore(coverage);
  const signalStrength = Math.min(100, (coverage.strong_artist_evidence_coverage * 0.55) + (coverage.strong_track_evidence_coverage * 0.45));
  return clamp((validationScore * 0.38) + (coverageQuality * 0.34) + (signalStrength * 0.18) + (diversity * 0.10));
}

function gapAnalysis(coverage, validation) {
  const gaps = [];
  if (!validation || validation.accuracy < 60) gaps.push(`needs stronger DNA self-test accuracy (${validation?.accuracy || 0}%)`);
  if (coverage.lastfm_track_coverage < 40) gaps.push(`needs Last.fm track tags for about ${Math.max(0, Math.ceil((0.4 * coverage.track_count) - coverage.lastfm_track_count))} more tracks`);
  if (coverage.lastfm_artist_coverage < 60) gaps.push("needs better Last.fm artist coverage");
  if (coverage.spotify_genre_coverage < 50) gaps.push("needs more Spotify genre evidence");
  if (coverage.musicbrainz_coverage < 35) gaps.push("needs more MusicBrainz tag evidence");
  if (coverage.multiple_source_agreement < 35) gaps.push("needs stronger multi-source agreement");
  if (coverage.track_count < 50) gaps.push("needs more assigned tracks before autonomy is trustworthy");
  return gaps.length ? gaps : ["evidence quality looks comparatively strong; review false positives before autonomy"];
}

function serializeCoverage(row, validationByPlaylist, profileByPlaylist) {
  const base = {
    playlist_code: row.playlist_code,
    playlist_label: row.playlist_label,
    category: row.category,
    track_count: row.track_count,
    unique_artist_count: row.artists.size,
    unique_album_count: row.albums.size,
    artist_intelligence_coverage: coveragePercentage(row.artist_intelligence, row.track_count),
    lastfm_artist_coverage: coveragePercentage(row.lastfm_artist, row.track_count),
    lastfm_track_coverage: coveragePercentage(row.lastfm_track, row.track_count),
    musicbrainz_coverage: coveragePercentage(row.musicbrainz, row.track_count),
    spotify_genre_coverage: coveragePercentage(row.spotify, row.track_count),
    approved_artist_genre_coverage: coveragePercentage(row.approved_artist_genres, row.track_count),
    specialty_signal_coverage: coveragePercentage(row.specialty_signal, row.track_count),
    multiple_source_agreement: coveragePercentage(row.multiple_source_agreement, row.track_count),
    strong_artist_evidence_coverage: coveragePercentage(row.strong_artist_evidence, row.track_count),
    strong_track_evidence_coverage: coveragePercentage(row.strong_track_evidence, row.track_count),
    lastfm_track_count: row.lastfm_track,
    top_contributing_signals: serializeTopSignals(row.signalCounts),
  };
  const validation = validationByPlaylist.get(row.playlist_code) || null;
  const profile = profileByPlaylist.get(row.playlist_code) || null;
  const score = readinessScore({ validation, coverage: base });
  const missing = gapAnalysis(base, validation);
  const genericSignals = (profile?.top_signals || []).filter((signal) => isMetadataSignal(signal.name)).slice(0, 6);
  const sparseSources = [
    base.lastfm_track_coverage < 20 ? "sparse Last.fm track tags" : null,
    base.musicbrainz_coverage < 20 ? "sparse MusicBrainz evidence" : null,
    base.multiple_source_agreement < 20 ? "low multi-source agreement" : null,
  ].filter(Boolean);

  return {
    ...base,
    dna_validation_accuracy: validation?.accuracy || 0,
    dna_precision: validation?.precision || 0,
    dna_recall: validation?.recall || 0,
    false_negatives: validation?.false_negatives || 0,
    readiness_score: score,
    readiness_tier: tierForScore(score),
    readiness_tier_key: tierKey(score),
    strong_signals: base.top_contributing_signals.slice(0, 8),
    weak_signals: sparseSources,
    conflicting_signals: [
      ...(validation?.confused_playlists || []).slice(0, 5).map((item) => `confused with ${item.playlist_label} (${item.count})`),
      ...genericSignals.map((item) => `generic metadata signal: ${item.name}`),
    ],
    missing_signals: missing,
  };
}

function getAdminDnaEvidenceQuality() {
  const db = openDatabase();
  const dna = getAdminPlaylistDnaValidation({ limit: 500 });
  const validationByPlaylist = new Map((dna.validation?.playlist_results || []).map((row) => [row.playlist_code, row]));
  const profileByPlaylist = new Map((dna.playlist_dna_profiles || []).map((row) => [row.playlist_code, row]));
  const caches = { artistCache: readArtistCache(db), trackCache: readTrackCache(db) };
  const coverageByPlaylist = new Map();

  for (const row of readAssignedRows(db)) analyzeRow(row, caches, coverageByPlaylist);

  const playlists = [...coverageByPlaylist.values()]
    .map((row) => serializeCoverage(row, validationByPlaylist, profileByPlaylist))
    .sort((a, b) => b.readiness_score - a.readiness_score || a.playlist_label.localeCompare(b.playlist_label));

  const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const playlist of playlists) tierCounts[playlist.readiness_tier_key] += 1;

  const averageCoverage = playlists.length ? {
    artist_intelligence: Math.round(playlists.reduce((sum, row) => sum + row.artist_intelligence_coverage, 0) / playlists.length * 10) / 10,
    lastfm_artist: Math.round(playlists.reduce((sum, row) => sum + row.lastfm_artist_coverage, 0) / playlists.length * 10) / 10,
    lastfm_track: Math.round(playlists.reduce((sum, row) => sum + row.lastfm_track_coverage, 0) / playlists.length * 10) / 10,
    musicbrainz: Math.round(playlists.reduce((sum, row) => sum + row.musicbrainz_coverage, 0) / playlists.length * 10) / 10,
    spotify: Math.round(playlists.reduce((sum, row) => sum + row.spotify_genre_coverage, 0) / playlists.length * 10) / 10,
    approved_artist_genres: Math.round(playlists.reduce((sum, row) => sum + row.approved_artist_genre_coverage, 0) / playlists.length * 10) / 10,
    multiple_source_agreement: Math.round(playlists.reduce((sum, row) => sum + row.multiple_source_agreement, 0) / playlists.length * 10) / 10,
  } : {};

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    summary: {
      total_playlists_analyzed: playlists.length,
      tier_a_count: tierCounts.A,
      tier_b_count: tierCounts.B,
      tier_c_count: tierCounts.C,
      tier_d_count: tierCounts.D,
      average_coverage: averageCoverage,
    },
    readiness_rankings: playlists,
    strongest_playlists: playlists.slice(0, 10),
    weakest_playlists: [...playlists].sort((a, b) => a.readiness_score - b.readiness_score || b.track_count - a.track_count).slice(0, 10),
    best_source_coverage: [...playlists].sort((a, b) => coverageScore(b) - coverageScore(a)).slice(0, 10),
    worst_source_coverage: [...playlists].sort((a, b) => coverageScore(a) - coverageScore(b)).slice(0, 10),
    closest_to_autonomy: playlists.filter((row) => row.readiness_score < 85).sort((a, b) => b.readiness_score - a.readiness_score).slice(0, 10),
    furthest_from_autonomy: [...playlists].sort((a, b) => a.readiness_score - b.readiness_score).slice(0, 10),
    top_autonomous_candidates: playlists.filter((row) => row.readiness_score >= 85),
    notes: [
      "Read-only DNA evidence quality report. No approvals, recommendations, rescans, sorting changes, assignments, overrides, or Spotify writes are performed.",
      "Readiness is intentionally conservative: validation accuracy and multi-source coverage matter more than raw track count.",
    ],
  };
}

module.exports = {
  getAdminDnaEvidenceQuality,
};
