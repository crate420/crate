const { openDatabase } = require("../db");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");
const lastfmClient = require("../lastfm/client");
const { batchFetchArtistIntelligence, MAX_BATCH_LIMIT, SUPPORTED_SOURCES } = require("./artistIntelligenceOperations");
const { getAdminDnaEvidenceQuality } = require("./dnaEvidenceQuality");
const { getAdminRecommendationImpact } = require("./recommendationImpact");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const TRACK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TRACK_ERROR_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const PLAYLIST_LABELS = Object.fromEntries(ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [definition.playlistCode, definition.shortLabel || definition.displayName]));

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

function normalizeLimit(value, fallback = DEFAULT_LIMIT, maximum = MAX_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function pct(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeArtistName(value) {
  return artistIntelligenceRepo.normalizeArtistName(value);
}

function normalizeTrackSignal(value) {
  return String(value || "").trim().toLowerCase();
}

function extractIsrc(rawTrack) {
  return rawTrack?.external_ids?.isrc || null;
}

function readTrackRows() {
  return openDatabase().prepare(`
    SELECT
      tracks.id AS track_id,
      tracks.spotify_track_id,
      tracks.name,
      tracks.album_name,
      tracks.artist_names,
      tracks.raw_json,
      COUNT(DISTINCT user_tracks.user_id) AS affected_user_count,
      GROUP_CONCAT(DISTINCT user_tracks.user_id) AS affected_user_ids,
      SUM(CASE WHEN user_tracks.playlist_code IS NULL AND track_overrides.override_playlist_code IS NULL THEN 1 ELSE 0 END) AS unmatched_occurrences,
      COUNT(DISTINCT CASE WHEN user_tracks.playlist_code IS NULL AND track_overrides.override_playlist_code IS NULL THEN user_tracks.user_id END) AS unmatched_user_count,
      GROUP_CONCAT(DISTINCT CASE WHEN user_tracks.playlist_code IS NULL AND track_overrides.override_playlist_code IS NULL THEN user_tracks.user_id END) AS unmatched_user_ids
    FROM tracks
    LEFT JOIN user_tracks ON user_tracks.track_id = tracks.id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    GROUP BY tracks.id
    ORDER BY tracks.id ASC
  `).all();
}

function artistEntriesFromTrack(row) {
  const rawTrack = parseRawTrack(row.raw_json);
  if (rawTrack?.artists?.length) {
    return rawTrack.artists
      .map((artist) => ({
        artist_name: String(artist.name || "").trim(),
        normalized_artist_name: normalizeArtistName(artist.name),
        spotify_artist_id: String(artist.id || "").trim() || null,
      }))
      .filter((artist) => artist.normalized_artist_name);
  }

  return getArtistNames(row, rawTrack)
    .map((artistName) => ({
      artist_name: artistName,
      normalized_artist_name: normalizeArtistName(artistName),
      spotify_artist_id: null,
    }))
    .filter((artist) => artist.normalized_artist_name);
}

function splitIdList(value) {
  return String(value || "").split(",").map((item) => Number.parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
}

function readArtistUniverse(trackRows = readTrackRows()) {
  const artists = new Map();
  for (const row of trackRows) {
    for (const artist of artistEntriesFromTrack(row)) {
      const current = artists.get(artist.normalized_artist_name) || {
        artist_name: artist.artist_name,
        normalized_artist_name: artist.normalized_artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        track_ids: new Set(),
        affected_users: new Set(),
        unmatched_track_ids: new Set(),
        unmatched_occurrences: 0,
        sample_tracks: [],
      };
      current.spotify_artist_id = current.spotify_artist_id || artist.spotify_artist_id;
      current.track_ids.add(row.track_id);
      splitIdList(row.affected_user_ids).forEach((userId) => current.affected_users.add(userId));
      if (Number(row.unmatched_occurrences || 0) > 0) {
        current.unmatched_track_ids.add(row.track_id);
        splitIdList(row.unmatched_user_ids).forEach((userId) => current.affected_users.add(userId));
        current.unmatched_occurrences += Number(row.unmatched_occurrences || 0);
        if (current.sample_tracks.length < 5) current.sample_tracks.push({ track_id: row.track_id, track_name: row.name, album_name: row.album_name });
      }
      artists.set(artist.normalized_artist_name, current);
    }
  }
  return artists;
}

function readArtistSourceRows(db) {
  const byArtistId = new Map();
  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) return byArtistId;
  const rows = db.prepare(`
    SELECT
      artist_intelligence.id AS artist_intelligence_id,
      artist_intelligence.normalized_artist_name,
      artist_intelligence.display_artist_name,
      artist_intelligence.spotify_artist_id,
      artist_intelligence.confidence_score,
      artist_intelligence.source_count,
      artist_intelligence_sources.source,
      artist_intelligence_sources.normalized_signals_json,
      artist_intelligence_sources.error_code,
      artist_intelligence_sources.fetched_at,
      artist_intelligence_sources.expires_at
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
  `).all();
  for (const row of rows) {
    const entry = byArtistId.get(row.artist_intelligence_id) || {
      artist_intelligence_id: row.artist_intelligence_id,
      normalized_artist_name: row.normalized_artist_name,
      display_artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: row.confidence_score || 0,
      source_count: row.source_count || 0,
      sources: new Map(),
    };
    if (row.source) {
      entry.sources.set(row.source, {
        source: row.source,
        normalized_signals: parseJson(row.normalized_signals_json, []).map(normalizeTrackSignal).filter(Boolean),
        error_code: row.error_code,
        fetched_at: row.fetched_at,
        expires_at: row.expires_at,
      });
    }
    byArtistId.set(row.artist_intelligence_id, entry);
  }
  return byArtistId;
}

function readArtistIntelligenceByName(db) {
  const result = new Map();
  if (!tableExists(db, "artist_intelligence")) return result;
  for (const row of db.prepare("SELECT * FROM artist_intelligence").all()) result.set(row.normalized_artist_name, row);
  return result;
}

function spotifyGenreSignals(source) {
  return (source?.normalized_signals || [])
    .filter((signal) => signal.startsWith("genre:"))
    .map((signal) => signal.slice("genre:".length).trim())
    .filter(Boolean);
}

function readTrackSourcesByIdentity(db) {
  const sourcesByIdentity = new Map();
  if (!tableExists(db, "track_intelligence") || !tableExists(db, "track_intelligence_sources")) return sourcesByIdentity;
  const rows = db.prepare(`
    SELECT
      track_intelligence.identity_key,
      track_intelligence.spotify_track_id,
      track_intelligence.isrc,
      track_intelligence.normalized_artist_name,
      track_intelligence.normalized_track_name,
      track_intelligence.source_count,
      track_intelligence.confidence_score,
      track_intelligence_sources.source,
      track_intelligence_sources.normalized_signals_json,
      track_intelligence_sources.metadata_json,
      track_intelligence_sources.error_code,
      track_intelligence_sources.fetched_at,
      track_intelligence_sources.expires_at
    FROM track_intelligence
    LEFT JOIN track_intelligence_sources
      ON track_intelligence_sources.track_intelligence_id = track_intelligence.id
  `).all();
  for (const row of rows) {
    const entry = sourcesByIdentity.get(row.identity_key) || {
      identity_key: row.identity_key,
      spotify_track_id: row.spotify_track_id,
      isrc: row.isrc,
      normalized_artist_name: row.normalized_artist_name,
      normalized_track_name: row.normalized_track_name,
      source_count: row.source_count || 0,
      confidence_score: row.confidence_score || 0,
      sources: new Map(),
    };
    if (row.source) {
      entry.sources.set(row.source, {
        source: row.source,
        normalized_signals: parseJson(row.normalized_signals_json, []).map(normalizeTrackSignal).filter(Boolean),
        metadata: parseJson(row.metadata_json, {}),
        error_code: row.error_code,
        fetched_at: row.fetched_at,
        expires_at: row.expires_at,
      });
    }
    sourcesByIdentity.set(row.identity_key, entry);
  }
  return sourcesByIdentity;
}

function trackIdentityForRow(row) {
  const rawTrack = parseRawTrack(row.raw_json);
  const artistName = getArtistNames(row, rawTrack)[0] || "Unknown Artist";
  return {
    artistName,
    rawTrack,
    isrc: extractIsrc(rawTrack),
    identityKey: trackIntelligenceRepo.buildTrackIdentityKey({
      spotifyTrackId: row.spotify_track_id,
      isrc: extractIsrc(rawTrack),
      artistName,
      trackName: row.name,
    }),
  };
}

function metadataOnly(source) {
  if (!source || source.error_code) return false;
  const hasSignals = (source.normalized_signals || []).length > 0;
  const metadataValues = Object.values(source.metadata || {}).filter((value) => value !== null && value !== undefined && value !== "");
  return !hasSignals && metadataValues.length > 0;
}

function computeOverallCoverage({ trackRows, artists, artistByName, artistSources, trackSourcesByIdentity }) {
  let lastfmArtists = 0;
  let musicbrainzArtists = 0;
  let spotifyGenreArtists = 0;
  let multiSourceArtists = 0;

  for (const artist of artists.values()) {
    const intelligence = artistByName.get(artist.normalized_artist_name);
    const sourceEntry = intelligence ? artistSources.get(intelligence.id) : null;
    const usableSources = [...(sourceEntry?.sources?.values() || [])].filter((source) => !source.error_code);
    if (sourceEntry?.sources.get("lastfm") && !sourceEntry.sources.get("lastfm").error_code) lastfmArtists += 1;
    if (sourceEntry?.sources.get("musicbrainz") && !sourceEntry.sources.get("musicbrainz").error_code) musicbrainzArtists += 1;
    if (spotifyGenreSignals(sourceEntry?.sources.get("spotify")).length) spotifyGenreArtists += 1;
    if (usableSources.length >= 2) multiSourceArtists += 1;
  }

  let tracksWithLastfmTags = 0;
  let tracksWithMetadataOnly = 0;
  let tracksWithNoIntelligence = 0;
  let multiSourceTracks = 0;

  for (const row of trackRows) {
    const identity = trackIdentityForRow(row);
    const sourceEntry = trackSourcesByIdentity.get(identity.identityKey);
    const usableSources = [...(sourceEntry?.sources?.values() || [])].filter((source) => !source.error_code);
    const lastfm = sourceEntry?.sources.get("lastfm");
    if (lastfm && !lastfm.error_code && lastfm.normalized_signals.length) tracksWithLastfmTags += 1;
    else if (metadataOnly(lastfm)) tracksWithMetadataOnly += 1;
    else if (!usableSources.length) tracksWithNoIntelligence += 1;
    if (usableSources.length >= 2) multiSourceTracks += 1;
  }

  return {
    artists: {
      total_artists: artists.size,
      artists_with_lastfm: lastfmArtists,
      artists_with_musicbrainz: musicbrainzArtists,
      artists_with_spotify_genres: spotifyGenreArtists,
      multi_source_artist_agreement_percent: pct(multiSourceArtists, artists.size),
      lastfm_coverage_percent: pct(lastfmArtists, artists.size),
      musicbrainz_coverage_percent: pct(musicbrainzArtists, artists.size),
      spotify_genre_coverage_percent: pct(spotifyGenreArtists, artists.size),
    },
    tracks: {
      total_tracks: trackRows.length,
      tracks_with_lastfm_tags: tracksWithLastfmTags,
      tracks_with_metadata_only: tracksWithMetadataOnly,
      tracks_with_no_intelligence: tracksWithNoIntelligence,
      multi_source_track_agreement_percent: pct(multiSourceTracks, trackRows.length),
      lastfm_track_coverage_percent: pct(tracksWithLastfmTags, trackRows.length),
      metadata_only_percent: pct(tracksWithMetadataOnly, trackRows.length),
      no_intelligence_percent: pct(tracksWithNoIntelligence, trackRows.length),
    },
  };
}

function computeCoverageByPlaylist(trackRows, artists, artistByName, artistSources, trackSourcesByIdentity, dnaReport) {
  const rows = new Map();
  const dnaByCode = new Map((dnaReport.readiness_rankings || []).map((row) => [row.playlist_code, row]));

  for (const row of trackRows) {
    const playlistCodeRow = openDatabase().prepare(`
      SELECT COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS playlist_code
      FROM user_tracks
      LEFT JOIN track_overrides ON track_overrides.track_id = user_tracks.track_id
      WHERE user_tracks.track_id = ? AND COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) IS NOT NULL
      LIMIT 1
    `).get(row.track_id);
    const playlistCode = playlistCodeRow?.playlist_code;
    if (!playlistCode) continue;
    const bucket = rows.get(playlistCode) || {
      playlist_code: playlistCode,
      playlist_label: PLAYLIST_LABELS[playlistCode] || playlistCode,
      track_count: 0,
      artist_covered: 0,
      track_covered: 0,
      multi_source: 0,
    };
    bucket.track_count += 1;

    const artistEntries = artistEntriesFromTrack(row);
    const hasArtistCoverage = artistEntries.some((artist) => {
      const intelligence = artistByName.get(artist.normalized_artist_name);
      const sourceEntry = intelligence ? artistSources.get(intelligence.id) : null;
      return [...(sourceEntry?.sources?.values() || [])].some((source) => !source.error_code);
    });
    if (hasArtistCoverage) bucket.artist_covered += 1;

    const identity = trackIdentityForRow(row);
    const trackEntry = trackSourcesByIdentity.get(identity.identityKey);
    const usableTrackSources = [...(trackEntry?.sources?.values() || [])].filter((source) => !source.error_code);
    if (usableTrackSources.some((source) => source.normalized_signals.length)) bucket.track_covered += 1;
    if (usableTrackSources.length >= 2 || (hasArtistCoverage && usableTrackSources.length >= 1)) bucket.multi_source += 1;
    rows.set(playlistCode, bucket);
  }

  return [...rows.values()].map((row) => {
    const dna = dnaByCode.get(row.playlist_code);
    const artistCoverage = pct(row.artist_covered, row.track_count);
    const trackCoverage = pct(row.track_covered, row.track_count);
    const multiSourceCoverage = pct(row.multi_source, row.track_count);
    return {
      ...row,
      artist_coverage_percent: artistCoverage,
      track_coverage_percent: trackCoverage,
      multi_source_coverage_percent: multiSourceCoverage,
      dna_readiness_score: dna?.readiness_score || 0,
      dna_readiness_tier: dna?.readiness_tier_key || "D",
      dna_readiness_contribution: Math.round((artistCoverage * 0.35) + (trackCoverage * 0.45) + (multiSourceCoverage * 0.20)),
    };
  }).sort((a, b) => b.dna_readiness_score - a.dna_readiness_score || a.playlist_label.localeCompare(b.playlist_label));
}

function topMissingArtists(artists, artistByName, artistSources) {
  return [...artists.values()]
    .filter((artist) => artist.unmatched_track_ids.size > 0)
    .map((artist) => {
      const intelligence = artistByName.get(artist.normalized_artist_name);
      const sourceEntry = intelligence ? artistSources.get(intelligence.id) : null;
      const usableSources = [...(sourceEntry?.sources?.values() || [])].filter((source) => !source.error_code);
      return {
        artist_name: artist.artist_name,
        normalized_artist_name: artist.normalized_artist_name,
        spotify_artist_id: artist.spotify_artist_id || intelligence?.spotify_artist_id || null,
        affected_users: artist.affected_users.size || 1,
        unmatched_tracks: artist.unmatched_track_ids.size,
        total_occurrences: artist.unmatched_occurrences,
        estimated_impact: artist.unmatched_track_ids.size,
        confidence: usableSources.length ? "medium" : "low",
        source_count: usableSources.length,
        reason: usableSources.length ? "has some intelligence but still unmatched" : "missing artist intelligence coverage",
        sample_tracks: artist.sample_tracks,
        priority_score: ((artist.affected_users.size || 1) * Math.max(1, artist.unmatched_track_ids.size)),
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score || b.unmatched_tracks - a.unmatched_tracks || a.artist_name.localeCompare(b.artist_name))
    .slice(0, 50);
}

function topMissingTracks(trackRows, trackSourcesByIdentity) {
  return trackRows
    .filter((row) => Number(row.unmatched_occurrences || 0) > 0)
    .map((row) => {
      const identity = trackIdentityForRow(row);
      const sourceEntry = trackSourcesByIdentity.get(identity.identityKey);
      const usableSources = [...(sourceEntry?.sources?.values() || [])].filter((source) => !source.error_code);
      const lastfm = sourceEntry?.sources.get("lastfm");
      return {
        track_id: row.track_id,
        track_name: row.name,
        artist: identity.artistName,
        album_name: row.album_name,
        affected_users: Number(row.unmatched_user_count || 0) || 1,
        unmatched_count: Number(row.unmatched_occurrences || 0),
        estimated_impact: Number(row.unmatched_occurrences || 0),
        confidence: usableSources.length ? "medium" : "low",
        source_count: usableSources.length,
        lastfm_tag_count: lastfm && !lastfm.error_code ? lastfm.normalized_signals.length : 0,
        reason: usableSources.length ? "has track intelligence but remains unmatched" : "missing track intelligence coverage",
        priority_score: (Number(row.unmatched_user_count || 0) || 1) * Math.max(1, Number(row.unmatched_occurrences || 0)),
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score || b.estimated_impact - a.estimated_impact || a.track_name.localeCompare(b.track_name))
    .slice(0, 50);
}

async function sourceQualityComparison(coverage) {
  let impact = null;
  try {
    impact = await getAdminRecommendationImpact();
  } catch (err) {
    impact = null;
  }
  const impactBySource = new Map((impact?.source_performance || []).map((row) => [row.key, row]));
  return [
    {
      source: "lastfm",
      coverage_percent: coverage.artists.lastfm_coverage_percent,
      agreement_percent: coverage.artists.multi_source_artist_agreement_percent,
      recommendation_contribution: impactBySource.get("lastfm")?.approvals || 0,
      recovered_track_contribution: impactBySource.get("lastfm")?.actual_gain || 0,
    },
    {
      source: "musicbrainz",
      coverage_percent: coverage.artists.musicbrainz_coverage_percent,
      agreement_percent: coverage.artists.multi_source_artist_agreement_percent,
      recommendation_contribution: impactBySource.get("musicbrainz")?.approvals || 0,
      recovered_track_contribution: impactBySource.get("musicbrainz")?.actual_gain || 0,
    },
    {
      source: "spotify",
      coverage_percent: coverage.artists.spotify_genre_coverage_percent,
      agreement_percent: coverage.artists.multi_source_artist_agreement_percent,
      recommendation_contribution: impactBySource.get("spotify")?.approvals || 0,
      recovered_track_contribution: impactBySource.get("spotify")?.actual_gain || 0,
    },
    {
      source: "lastfm_track",
      coverage_percent: coverage.tracks.lastfm_track_coverage_percent,
      agreement_percent: coverage.tracks.multi_source_track_agreement_percent,
      recommendation_contribution: 0,
      recovered_track_contribution: 0,
    },
  ];
}

function projectDnaReadiness(dnaReport, coverage) {
  const boost = Math.min(45,
    Math.round(((100 - coverage.artists.lastfm_coverage_percent) * 0.08) +
      ((100 - coverage.tracks.lastfm_track_coverage_percent) * 0.18) +
      ((100 - coverage.artists.musicbrainz_coverage_percent) * 0.05) +
      ((100 - coverage.artists.spotify_genre_coverage_percent) * 0.04)),
  );
  const projected = { A: 0, B: 0, C: 0, D: 0 };
  for (const row of dnaReport.readiness_rankings || []) {
    const score = Math.min(100, Number(row.readiness_score || 0) + boost);
    if (score >= 85) projected.A += 1;
    else if (score >= 70) projected.B += 1;
    else if (score >= 50) projected.C += 1;
    else projected.D += 1;
  }
  return {
    note: "Projection is heuristic only. It estimates the tier distribution if missing artist and track intelligence coverage were filled without changing sorting or approvals.",
    estimated_score_boost: boost,
    current: {
      A: dnaReport.summary?.tier_a_count || 0,
      B: dnaReport.summary?.tier_b_count || 0,
      C: dnaReport.summary?.tier_c_count || 0,
      D: dnaReport.summary?.tier_d_count || 0,
    },
    projected_after_full_coverage: projected,
  };
}

async function getAdminIntelligenceCoverage() {
  const db = openDatabase();
  const trackRows = readTrackRows();
  const artists = readArtistUniverse(trackRows);
  const artistByName = readArtistIntelligenceByName(db);
  const artistSources = readArtistSourceRows(db);
  const trackSourcesByIdentity = readTrackSourcesByIdentity(db);
  const dnaReport = getAdminDnaEvidenceQuality();
  const coverage = computeOverallCoverage({ trackRows, artists, artistByName, artistSources, trackSourcesByIdentity });

  const missingArtists = topMissingArtists(artists, artistByName, artistSources);
  const missingTracks = topMissingTracks(trackRows, trackSourcesByIdentity);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    summary: {
      total_artists: coverage.artists.total_artists,
      total_tracks: coverage.tracks.total_tracks,
      estimated_recoverable_tracks: missingTracks.reduce((sum, row) => sum + Number(row.estimated_impact || 0), 0),
      affected_users: Math.max(...missingTracks.map((row) => row.affected_users), 0),
    },
    overall_coverage: coverage.artists,
    track_coverage: coverage.tracks,
    coverage_by_playlist: computeCoverageByPlaylist(trackRows, artists, artistByName, artistSources, trackSourcesByIdentity, dnaReport),
    top_missing_artists: missingArtists,
    top_missing_tracks: missingTracks,
    coverage_impact_estimator: {
      potential_gain: missingTracks.reduce((sum, row) => sum + Number(row.estimated_impact || 0), 0),
      affected_users: Math.max(...missingTracks.map((row) => row.affected_users), 0),
      confidence: missingTracks.length ? "medium" : "none",
      note: "Potential gain estimates unmatched track occurrences that could benefit from better intelligence. It is not a sorting or approval prediction.",
    },
    source_quality: await sourceQualityComparison(coverage),
    readiness_progress: projectDnaReadiness(dnaReport, coverage),
    operations: {
      max_batch_limit: MAX_LIMIT,
      artist_sources_supported: SUPPORTED_SOURCES,
      track_sources_supported: ["lastfm"],
      note: "Admin refresh actions write only intelligence cache/source rows and preserve sorting, approvals, playlist assignments, rescans, overrides, and Spotify playlists.",
    },
  };
}

function seedMissingArtistIntelligence(limit) {
  const trackRows = readTrackRows();
  const artists = readArtistUniverse(trackRows);
  let created = 0;
  let skipped = 0;
  for (const artist of artists.values()) {
    if (created >= limit) break;
    if (artistIntelligenceRepo.getArtistIntelligenceByName(artist.artist_name)) {
      skipped += 1;
      continue;
    }
    artistIntelligenceRepo.getOrCreateArtistIntelligence({ artistName: artist.artist_name, spotifyArtistId: artist.spotify_artist_id });
    created += 1;
  }
  return { considered: artists.size, created, skipped };
}

async function refreshArtistCoverage(userId, options = {}) {
  const mode = String(options.mode || "missing").toLowerCase() === "stale" ? "stale" : "missing";
  const limit = normalizeLimit(options.limit, DEFAULT_LIMIT, MAX_BATCH_LIMIT);
  const sources = Array.isArray(options.sources) && options.sources.length ? options.sources : SUPPORTED_SOURCES;
  const seed = mode === "missing" ? seedMissingArtistIntelligence(Math.max(limit, 50)) : { considered: 0, created: 0, skipped: 0 };
  const batch = await batchFetchArtistIntelligence(userId, {
    sources,
    limit,
    onlyMissing: mode === "missing",
    onlyExpired: mode === "stale",
    force: false,
  });
  return { status: "ok", mode, seed, batch };
}

function sourceNeedsRefresh(source, mode, nowMs) {
  if (!source) return mode === "missing";
  const expiresAt = source.expires_at ? Date.parse(source.expires_at) : 0;
  if (source.error_code && expiresAt && expiresAt > nowMs) return false;
  if (mode === "stale") return !expiresAt || expiresAt <= nowMs;
  return false;
}

function selectTracksForLibraryRefresh({ mode, limit }) {
  const db = openDatabase();
  const trackRows = readTrackRows();
  const sourcesByIdentity = readTrackSourcesByIdentity(db);
  const nowMs = Date.now();
  const selected = [];
  let skipped = 0;
  for (const row of trackRows) {
    if (selected.length >= limit) break;
    const identity = trackIdentityForRow(row);
    const source = sourcesByIdentity.get(identity.identityKey)?.sources.get("lastfm") || null;
    if (!sourceNeedsRefresh(source, mode, nowMs)) {
      skipped += 1;
      continue;
    }
    selected.push({ row, ...identity });
  }
  return { selected, skipped, total_tracks: trackRows.length };
}

function normalizeTags(tags) {
  return [...new Set((tags || []).map((tag) => String(tag.name || tag).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

function metadataFromInfo(infoResult) {
  const track = infoResult?.track || {};
  return {
    listeners: Number.parseInt(track.listeners, 10) || null,
    playcount: Number.parseInt(track.playcount, 10) || null,
    album: track.album?.title || null,
    duration: Number.parseInt(track.duration, 10) || null,
    mbid: track.mbid || null,
  };
}

function topTagsFromResults(results) {
  const counts = new Map();
  for (const result of results) {
    for (const tag of result.normalized_signals || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 25);
}

async function refreshTrackCoverage(options = {}) {
  lastfmClient.requireLastfmConfig();
  const mode = String(options.mode || "missing").toLowerCase() === "stale" ? "stale" : "missing";
  const limit = normalizeLimit(options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const { selected, skipped, total_tracks: totalTracks } = selectTracksForLibraryRefresh({ mode, limit });
  const summary = {
    status: "ok",
    mode,
    source: "lastfm",
    limit,
    total_tracks: totalTracks,
    attempted: 0,
    updated: 0,
    empty: 0,
    failed: 0,
    skipped,
    results: [],
    top_newly_discovered_lastfm_track_tags: [],
  };

  for (const item of selected) {
    summary.attempted += 1;
    const fetchedAt = new Date();
    try {
      const intelligence = trackIntelligenceRepo.getOrCreateTrackIntelligence({
        trackName: item.row.name,
        artistName: item.artistName,
        spotifyTrackId: item.row.spotify_track_id,
        isrc: item.isrc,
      });
      const result = await lastfmClient.getTrackInfoAndTopTags({ artistName: item.artistName, trackName: item.row.name });
      const rawTags = (result.topTags.tags || []).slice(0, 30).map((tag) => ({ name: tag.name, count: Number.parseInt(tag.count, 10) || 0 })).filter((tag) => tag.name);
      const normalizedSignals = normalizeTags(rawTags);
      const metadata = metadataFromInfo(result.info);
      const source = trackIntelligenceRepo.upsertTrackIntelligenceSource({
        trackIntelligenceId: intelligence.id,
        source: "lastfm",
        sourceTrackId: result.info.mbid || null,
        sourceTrackName: result.info.sourceTrackName || result.topTags.sourceTrackName || item.row.name,
        sourceArtistName: result.info.sourceArtistName || result.topTags.sourceArtistName || item.artistName,
        rawPayload: { info: result.info.rawPayload, topTags: result.topTags.rawPayload },
        normalizedSignals,
        metadata,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: new Date(fetchedAt.getTime() + TRACK_TTL_MS).toISOString(),
      });
      const serialized = {
        track_id: item.row.track_id,
        track_name: item.row.name,
        artist: item.artistName,
        normalized_signals: normalizedSignals,
        metadata,
        fetched_at: source.fetched_at,
      };
      if (normalizedSignals.length) summary.updated += 1;
      else summary.empty += 1;
      summary.results.push(serialized);
    } catch (err) {
      summary.failed += 1;
      try {
        const intelligence = trackIntelligenceRepo.getOrCreateTrackIntelligence({
          trackName: item.row.name,
          artistName: item.artistName,
          spotifyTrackId: item.row.spotify_track_id,
          isrc: item.isrc,
        });
        trackIntelligenceRepo.upsertTrackIntelligenceSource({
          trackIntelligenceId: intelligence.id,
          source: "lastfm",
          rawPayload: {},
          normalizedSignals: [],
          metadata: {},
          errorCode: err.code || "lastfm_track_refresh_error",
          errorMessage: err.message,
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: new Date(fetchedAt.getTime() + TRACK_ERROR_COOLDOWN_MS).toISOString(),
        });
      } catch (cacheErr) {
        // Preserve the original fetch failure in the response; cache write failure is secondary.
      }
      summary.results.push({ track_id: item.row.track_id, track_name: item.row.name, artist: item.artistName, error_code: err.code || "lastfm_track_refresh_error", error_message: err.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  summary.top_newly_discovered_lastfm_track_tags = topTagsFromResults(summary.results);
  return summary;
}

module.exports = {
  getAdminIntelligenceCoverage,
  refreshArtistCoverage,
  refreshTrackCoverage,
  seedMissingArtistIntelligence,
};
