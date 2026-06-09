const { openDatabase } = require("../db");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const spotifyArtists = require("../spotify/artists");
const { normalizeSpotifySignals } = require("./spotifyArtistIntelligence");

const SPOTIFY_ARTIST_INTELLIGENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeArtistName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLimit(value, fallback = 250, maximum = 1000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function readUnmatchedTrackRows() {
  const db = openDatabase();
  const hasTrackOverrides = tableExists(db, "track_overrides");
  const effectivePlaylistCode = hasTrackOverrides
    ? "COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code)"
    : "user_tracks.playlist_code";
  const joinTrackOverrides = hasTrackOverrides
    ? "LEFT JOIN track_overrides ON track_overrides.track_id = user_tracks.track_id"
    : "";

  return db.prepare(`
    SELECT
      user_tracks.user_id,
      users.display_name AS user_name,
      users.email AS user_email,
      tracks.id AS track_id,
      tracks.spotify_track_id,
      tracks.name AS track_name,
      tracks.album_name,
      tracks.artist_names,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    INNER JOIN users ON users.id = user_tracks.user_id
    ${joinTrackOverrides}
    WHERE ${effectivePlaylistCode} IS NULL
    ORDER BY users.id ASC, tracks.artist_names COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC
  `).all();
}

function readApprovedGenresByArtist() {
  const db = openDatabase();
  if (!tableExists(db, "artist_genres")) return new Map();
  const rows = db.prepare("SELECT artist_name, genre FROM artist_genres ORDER BY artist_name, genre").all();
  const map = new Map();
  for (const row of rows) {
    const key = normalizeArtistName(row.artist_name);
    if (!key) continue;
    const genres = map.get(key) || new Set();
    genres.add(row.genre);
    map.set(key, genres);
  }
  return map;
}

function genreSignalsFromSource(source) {
  const signals = parseJson(source?.normalized_signals_json, []);
  return [...new Set(signals
    .map((signal) => String(signal || "").trim())
    .filter((signal) => signal.startsWith("genre:"))
    .map((signal) => signal.slice("genre:".length).trim())
    .filter(Boolean))];
}

function readCachedSpotifyIntelligence() {
  const db = openDatabase();
  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { byName: new Map(), bySpotifyId: new Map() };
  }

  const rows = db.prepare(`
    SELECT
      artist_intelligence.id,
      artist_intelligence.normalized_artist_name,
      artist_intelligence.display_artist_name,
      artist_intelligence.spotify_artist_id,
      artist_intelligence.review_status,
      artist_intelligence.confidence_score,
      artist_intelligence.source_count,
      artist_intelligence_sources.source_artist_id,
      artist_intelligence_sources.source_artist_name,
      artist_intelligence_sources.normalized_signals_json,
      artist_intelligence_sources.error_code,
      artist_intelligence_sources.error_message,
      artist_intelligence_sources.fetched_at,
      artist_intelligence_sources.expires_at
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
      AND artist_intelligence_sources.source = 'spotify'
  `).all();

  const byName = new Map();
  const bySpotifyId = new Map();
  for (const row of rows) {
    const cached = {
      artist_intelligence_id: row.id,
      normalized_artist_name: row.normalized_artist_name,
      display_artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id || row.source_artist_id || null,
      review_status: row.review_status,
      confidence_score: row.confidence_score,
      source_count: row.source_count,
      spotify_source_artist_id: row.source_artist_id,
      spotify_source_artist_name: row.source_artist_name,
      spotify_genres: genreSignalsFromSource(row),
      spotify_error_code: row.error_code,
      spotify_error_message: row.error_message,
      spotify_fetched_at: row.fetched_at,
      spotify_expires_at: row.expires_at,
      has_spotify_source: Boolean(row.fetched_at || row.error_code || row.source_artist_id),
    };
    if (cached.normalized_artist_name) byName.set(cached.normalized_artist_name, cached);
    if (cached.spotify_artist_id) bySpotifyId.set(cached.spotify_artist_id, cached);
  }

  return { byName, bySpotifyId };
}

function extractArtists(row) {
  const raw = parseJson(row.raw_json, null);
  if (raw?.artists?.length) {
    return raw.artists.map((artist) => ({
      artist_name: artist.name || "Unknown Artist",
      normalized_artist_name: normalizeArtistName(artist.name),
      spotify_artist_id: artist.id || null,
    })).filter((artist) => artist.normalized_artist_name);
  }

  return parseJson(row.artist_names, []).map((artistName) => ({
    artist_name: artistName || "Unknown Artist",
    normalized_artist_name: normalizeArtistName(artistName),
    spotify_artist_id: null,
  })).filter((artist) => artist.normalized_artist_name);
}

function makeQueueRecord(artist) {
  return {
    artist_name: artist.artist_name,
    normalized_artist_name: artist.normalized_artist_name,
    spotify_artist_id: artist.spotify_artist_id || null,
    affected_users: new Map(),
    track_ids: new Set(),
    total_occurrences: 0,
    sample_tracks: [],
  };
}

function resolveCachedIntelligence(record, cached) {
  return (record.spotify_artist_id && cached.bySpotifyId.get(record.spotify_artist_id))
    || cached.byName.get(record.normalized_artist_name)
    || null;
}

function queueReason({ record, approvedGenres, cached }) {
  const reasons = [];
  if (!record.spotify_artist_id) reasons.push("missing_spotify_artist_id");
  if (approvedGenres.length === 0) reasons.push("missing_approved_artist_genres");
  if (!cached) reasons.push("missing_cached_artist_intelligence");
  else if (!cached.has_spotify_source) reasons.push("missing_cached_spotify_source");
  else if (cached.spotify_error_code) reasons.push("cached_spotify_error");
  else if (cached.spotify_genres.length === 0) reasons.push("cached_spotify_genres_empty");
  return reasons;
}

function priorityScore(record) {
  return (record.affected_user_count * 100000)
    + (record.estimated_gain * 1000)
    + (record.unmatched_track_count * 10)
    + (record.spotify_artist_id ? 1 : 0);
}

function serializeRecord(record, approvedByArtist, cachedSources) {
  const approvedGenres = [...(approvedByArtist.get(record.normalized_artist_name) || [])].sort((a, b) => a.localeCompare(b));
  const cached = resolveCachedIntelligence(record, cachedSources);
  const spotifyGenres = [...(cached?.spotify_genres || [])].sort((a, b) => a.localeCompare(b));
  const reason = queueReason({ record, approvedGenres, cached });
  const serialized = {
    artist_name: record.artist_name,
    normalized_artist_name: record.normalized_artist_name,
    spotify_artist_id: record.spotify_artist_id || cached?.spotify_artist_id || null,
    affected_user_count: record.affected_users.size,
    affected_users: [...record.affected_users.values()].sort((a, b) => a.user_id - b.user_id),
    unmatched_track_count: record.track_ids.size,
    total_occurrences: record.total_occurrences,
    estimated_gain: record.track_ids.size,
    sample_tracks: record.sample_tracks.slice(0, 8),
    current_spotify_genres: spotifyGenres,
    approved_artist_genres: approvedGenres,
    artist_intelligence_id: cached?.artist_intelligence_id || null,
    intelligence_confidence_score: cached?.confidence_score || 0,
    intelligence_source_count: cached?.source_count || 0,
    spotify_fetched_at: cached?.spotify_fetched_at || null,
    spotify_error_code: cached?.spotify_error_code || null,
    reason,
  };
  serialized.priority_score = priorityScore(serialized);
  return serialized;
}

function shouldInclude(record) {
  return record.approved_artist_genres.length === 0 && record.current_spotify_genres.length === 0;
}

function applyFilter(records, filter) {
  if (filter === "has_spotify_artist_id") return records.filter((record) => record.spotify_artist_id);
  if (filter === "missing_spotify_artist_id") return records.filter((record) => !record.spotify_artist_id);
  if (filter === "affected_2_plus") return records.filter((record) => record.affected_user_count >= 2);
  if (filter === "gain_5_plus") return records.filter((record) => record.estimated_gain >= 5);
  return records;
}

function normalizeRefreshLimit(value, fallback = 25, maximum = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function summarizeDiscoveredGenres(results) {
  const counts = new Map();
  for (const result of results) {
    for (const genre of result.spotify_genres || []) {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((left, right) => right.count - left.count || left.genre.localeCompare(right.genre));
}

function cacheSpotifyArtistSuccess(queueArtist, spotifyArtist) {
  const intelligence = artistIntelligenceRepo.getOrCreateArtistIntelligence({
    artistName: queueArtist.artist_name,
    spotifyArtistId: spotifyArtist.id || queueArtist.spotify_artist_id,
  });
  const fetchedAt = new Date();
  const source = artistIntelligenceRepo.upsertArtistIntelligenceSource({
    artistIntelligenceId: intelligence.id,
    source: "spotify",
    sourceArtistId: spotifyArtist.id || queueArtist.spotify_artist_id,
    sourceArtistName: spotifyArtist.name || queueArtist.artist_name,
    rawPayload: spotifyArtist,
    normalizedSignals: normalizeSpotifySignals(spotifyArtist),
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + SPOTIFY_ARTIST_INTELLIGENCE_TTL_MS).toISOString(),
  });
  const refreshed = artistIntelligenceRepo.getArtistIntelligenceById(intelligence.id);
  return {
    artist_intelligence_id: refreshed.id,
    source_id: source.id,
    source_count: refreshed.source_count,
    confidence_score: refreshed.confidence_score,
  };
}

function cacheSpotifyArtistFailure(queueArtist, err) {
  const intelligence = artistIntelligenceRepo.getOrCreateArtistIntelligence({
    artistName: queueArtist.artist_name,
    spotifyArtistId: queueArtist.spotify_artist_id,
  });
  const fetchedAt = new Date();
  const source = artistIntelligenceRepo.upsertArtistIntelligenceSource({
    artistIntelligenceId: intelligence.id,
    source: "spotify",
    sourceArtistId: queueArtist.spotify_artist_id,
    sourceArtistName: queueArtist.artist_name,
    rawPayload: {
      artist_name: queueArtist.artist_name,
      spotify_artist_id: queueArtist.spotify_artist_id,
      error: err.spotifyError || err.code || "spotify_artist_refresh_error",
    },
    normalizedSignals: [],
    errorCode: err.code || "spotify_artist_refresh_error",
    errorMessage: err.message,
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  });
  const refreshed = artistIntelligenceRepo.getArtistIntelligenceById(intelligence.id);
  return {
    artist_intelligence_id: refreshed.id,
    source_id: source.id,
    source_count: refreshed.source_count,
    confidence_score: refreshed.confidence_score,
  };
}

async function refreshSpotifyArtistGenresForQueue(userId, options = {}) {
  const limit = normalizeRefreshLimit(options.limit);
  const filter = String(options.filter || "all").trim();
  const queue = getAdminArtistEnrichmentQueue({ limit: 1000, filter });
  const candidates = queue.artists
    .filter((artist) => artist.spotify_artist_id)
    .filter((artist) => artist.current_spotify_genres.length === 0)
    .slice(0, limit);
  const results = [];
  let updated = 0;
  let emptyGenres = 0;
  let failed = 0;
  let skipped = Math.max(0, queue.filtered_count - candidates.length);

  console.log("[Artist Enrichment Queue] Spotify refresh started", {
    admin_user_id: userId,
    filter,
    limit,
    candidates: candidates.length,
  });

  for (const artist of candidates) {
    try {
      const spotifyArtist = await spotifyArtists.getArtistById(userId, artist.spotify_artist_id);
      if (!spotifyArtist || !spotifyArtist.id) {
        const error = new Error("Spotify artist response was empty.");
        error.code = "empty_spotify_artist_response";
        throw error;
      }
      const cacheResult = cacheSpotifyArtistSuccess(artist, spotifyArtist);
      const spotifyGenres = Array.isArray(spotifyArtist.genres) ? spotifyArtist.genres : [];
      if (spotifyGenres.length > 0) updated += 1;
      else emptyGenres += 1;
      results.push({
        artist_name: artist.artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        status: spotifyGenres.length > 0 ? "updated" : "empty_genres",
        spotify_genres: spotifyGenres,
        popularity: spotifyArtist.popularity ?? null,
        followers_total: spotifyArtist.followers?.total ?? null,
        ...cacheResult,
      });
    } catch (err) {
      failed += 1;
      const cacheResult = cacheSpotifyArtistFailure(artist, err);
      results.push({
        artist_name: artist.artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        status: "failed",
        error_code: err.code || "spotify_artist_refresh_error",
        error_message: err.message,
        spotify_status: err.spotifyStatus || null,
        ...cacheResult,
      });
    }
  }

  const summary = {
    status: "ok",
    generated_at: new Date().toISOString(),
    filter,
    requested_limit: limit,
    queue_size: queue.total_artists_in_queue,
    filtered_count: queue.filtered_count,
    attempted: candidates.length,
    updated,
    empty_spotify_genres: emptyGenres,
    failed,
    skipped,
    top_newly_discovered_spotify_genres: summarizeDiscoveredGenres(results).slice(0, 25),
    results,
  };

  console.log("[Artist Enrichment Queue] Spotify refresh complete", {
    attempted: summary.attempted,
    updated: summary.updated,
    empty_spotify_genres: summary.empty_spotify_genres,
    failed: summary.failed,
    skipped: summary.skipped,
  });

  return summary;
}

function getAdminArtistEnrichmentQueue(options = {}) {
  const limit = normalizeLimit(options.limit);
  const filter = String(options.filter || "all").trim();
  const rows = readUnmatchedTrackRows();
  const recordsByArtist = new Map();

  for (const row of rows) {
    for (const artist of extractArtists(row)) {
      const record = recordsByArtist.get(artist.normalized_artist_name) || makeQueueRecord(artist);
      if (!record.spotify_artist_id && artist.spotify_artist_id) record.spotify_artist_id = artist.spotify_artist_id;
      record.affected_users.set(row.user_id, { user_id: row.user_id, name: row.user_name || null, email: row.user_email || null });
      record.track_ids.add(row.track_id);
      record.total_occurrences += 1;
      if (record.sample_tracks.length < 8) {
        record.sample_tracks.push({
          user_id: row.user_id,
          track_id: row.track_id,
          track_name: row.track_name,
          album_name: row.album_name,
          spotify_track_id: row.spotify_track_id,
        });
      }
      recordsByArtist.set(record.normalized_artist_name, record);
    }
  }

  const approvedByArtist = readApprovedGenresByArtist();
  const cachedSources = readCachedSpotifyIntelligence();
  const allQueueRecords = [...recordsByArtist.values()]
    .map((record) => serializeRecord(record, approvedByArtist, cachedSources))
    .filter(shouldInclude)
    .sort((left, right) => {
      if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
      if (right.estimated_gain !== left.estimated_gain) return right.estimated_gain - left.estimated_gain;
      if (right.unmatched_track_count !== left.unmatched_track_count) return right.unmatched_track_count - left.unmatched_track_count;
      return left.artist_name.localeCompare(right.artist_name);
    });
  const filtered = applyFilter(allQueueRecords, filter);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    filter,
    total_unmatched_tracks: rows.length,
    total_artists_in_queue: allQueueRecords.length,
    filtered_count: filtered.length,
    estimated_match_gain: allQueueRecords.reduce((sum, record) => sum + record.estimated_gain, 0),
    filters: ["all", "has_spotify_artist_id", "missing_spotify_artist_id", "affected_2_plus", "gain_5_plus"],
    artists: filtered.slice(0, limit),
  };
}

module.exports = {
  getAdminArtistEnrichmentQueue,
  refreshSpotifyArtistGenresForQueue,
};
