const { openDatabase } = require("../db");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const { fetchAndCacheLastfmArtistIntelligence } = require("./lastfmGenreSuggestions");
const { fetchAndCacheMusicBrainzArtistIntelligence } = require("./musicbrainzArtistIntelligence");
const { fetchAndCacheSpotifyArtistIntelligence } = require("./spotifyArtistIntelligence");

const SUPPORTED_SOURCES = ["spotify", "lastfm", "musicbrainz"];
const DEFAULT_BATCH_LIMIT = 10;
const MAX_BATCH_LIMIT = 50;
const DEFAULT_SEED_LIMIT = 250;
const MAX_SEED_LIMIT = 1000;
const ERROR_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const SOURCE_ADAPTERS = {
  spotify: (userId, artist) => fetchAndCacheSpotifyArtistIntelligence(userId, { artistIntelligenceId: artist.id }),
  lastfm: (userId, artist) => fetchAndCacheLastfmArtistIntelligence({ artistIntelligenceId: artist.id }),
  musicbrainz: (userId, artist) => fetchAndCacheMusicBrainzArtistIntelligence({ artistIntelligenceId: artist.id }),
};

function normalizeLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(Number.isInteger(parsed) && parsed > 0 ? parsed : fallback, max);
}

function normalizeSources(sources) {
  const requested = Array.isArray(sources) ? sources : SUPPORTED_SOURCES;
  return [...new Set(requested.map((source) => String(source || "").trim().toLowerCase()))]
    .filter((source) => SUPPORTED_SOURCES.includes(source));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTrackArtists(rawJson) {
  try {
    return (JSON.parse(rawJson || "{}").artists || [])
      .map((artist) => ({
        artistName: String(artist.name || "").trim(),
        spotifyArtistId: String(artist.id || "").trim() || null,
      }))
      .filter((artist) => artist.artistName);
  } catch (err) {
    return [];
  }
}

function seedFromTracks(limit) {
  const rows = openDatabase().prepare("SELECT raw_json FROM tracks ORDER BY id ASC").all();
  const artists = new Map();

  for (const row of rows) {
    for (const artist of parseTrackArtists(row.raw_json)) {
      const normalizedName = artistIntelligenceRepo.normalizeArtistName(artist.artistName);
      const current = artists.get(normalizedName);
      artists.set(normalizedName, {
        artistName: current?.artistName || artist.artistName,
        spotifyArtistId: current?.spotifyArtistId || artist.spotifyArtistId,
      });
    }
  }

  return [...artists.values()].slice(0, limit);
}

function seedFromArtistGenres(limit) {
  return openDatabase().prepare(`
    SELECT artist_name AS artistName
    FROM artist_genres
    GROUP BY lower(trim(artist_name))
    ORDER BY artist_name COLLATE NOCASE ASC
    LIMIT ?
  `).all(limit);
}

function seedArtistIntelligence({ limit, source = "tracks" } = {}) {
  const normalizedLimit = normalizeLimit(limit, DEFAULT_SEED_LIMIT, MAX_SEED_LIMIT);
  const normalizedSource = String(source || "tracks").trim().toLowerCase();

  if (!["tracks", "artist_genres"].includes(normalizedSource)) {
    const error = new Error("source must be tracks or artist_genres.");
    error.code = "invalid_artist_intelligence_seed_source";
    error.statusCode = 400;
    throw error;
  }

  const artists = normalizedSource === "tracks" ? seedFromTracks(normalizedLimit) : seedFromArtistGenres(normalizedLimit);
  let created = 0;
  let skipped = 0;

  for (const artist of artists) {
    if (artistIntelligenceRepo.getArtistIntelligenceByName(artist.artistName)) {
      skipped += 1;
      continue;
    }
    artistIntelligenceRepo.getOrCreateArtistIntelligence(artist);
    created += 1;
  }

  return { source: normalizedSource, limit: normalizedLimit, considered: artists.length, created, skipped };
}

function listSourceRowsByArtistId() {
  const rows = openDatabase().prepare("SELECT * FROM artist_intelligence_sources ORDER BY artist_intelligence_id ASC, source ASC").all();
  const rowsByArtistId = new Map();
  for (const row of rows) {
    const sources = rowsByArtistId.get(row.artist_intelligence_id) || new Map();
    sources.set(row.source, row);
    rowsByArtistId.set(row.artist_intelligence_id, sources);
  }
  return rowsByArtistId;
}

function sourceNeedsFetch(row, { onlyMissing, onlyExpired, force }, nowMs) {
  if (!row) return onlyMissing || force;
  if (force) return true;
  if (row.error_code) {
    const retryAtMs = row.expires_at ? new Date(row.expires_at).getTime() : null;
    return onlyExpired && Number.isFinite(retryAtMs) && retryAtMs <= nowMs;
  }
  if (onlyExpired) {
    const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : null;
    return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  }
  return !onlyMissing;
}

function selectBatchArtists({ sources, limit, onlyMissing, onlyExpired, force }) {
  const rowsByArtistId = listSourceRowsByArtistId();
  const nowMs = Date.now();
  return openDatabase().prepare("SELECT * FROM artist_intelligence ORDER BY updated_at ASC, id ASC").all()
    .map((artist) => {
      const sourceRows = rowsByArtistId.get(artist.id) || new Map();
      const eligibleSources = sources.filter((source) => sourceNeedsFetch(sourceRows.get(source), { onlyMissing, onlyExpired, force }, nowMs));
      return { artist, sourceRows, eligibleSources, missingCount: eligibleSources.filter((source) => !sourceRows.get(source)).length };
    })
    .filter(({ eligibleSources }) => eligibleSources.length > 0)
    .sort((left, right) => right.missingCount - left.missingCount || left.artist.updated_at.localeCompare(right.artist.updated_at) || left.artist.id - right.artist.id)
    .slice(0, limit)
    .map(({ artist, sourceRows }) => ({ artist, sourceRows }));
}

function cacheSourceError(artist, source, error) {
  const fetchedAt = new Date();
  artistIntelligenceRepo.upsertArtistIntelligenceSource({
    artistIntelligenceId: artist.id,
    source,
    rawPayload: {},
    normalizedSignals: [],
    errorCode: error.code || `${source}_fetch_error`,
    errorMessage: error.message,
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + ERROR_RETRY_COOLDOWN_MS).toISOString(),
  });
}

async function batchFetchArtistIntelligence(userId, options = {}, adapters = SOURCE_ADAPTERS) {
  const sources = normalizeSources(options.sources);
  const limit = normalizeLimit(options.limit, DEFAULT_BATCH_LIMIT, MAX_BATCH_LIMIT);
  const onlyExpired = options.onlyExpired === true;
  const onlyMissing = onlyExpired ? false : options.onlyMissing !== false;
  const force = options.force === true;
  if (sources.length === 0) {
    const error = new Error("At least one supported source is required.");
    error.code = "invalid_artist_intelligence_sources";
    error.statusCode = 400;
    throw error;
  }

  const artists = selectBatchArtists({ sources, limit, onlyMissing, onlyExpired, force });
  const summary = {
    limit, sources, only_missing: onlyMissing, only_expired: onlyExpired, force, artists_selected: artists.length,
    attempted: 0, succeeded: 0, failed: 0, skipped: 0,
    per_source: Object.fromEntries(sources.map((source) => [source, { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }])),
    errors: [],
  };

  for (const { artist, sourceRows } of artists) {
    for (const source of sources) {
      if (!sourceNeedsFetch(sourceRows.get(source), { onlyMissing, onlyExpired, force }, Date.now())) {
        summary.skipped += 1;
        summary.per_source[source].skipped += 1;
        continue;
      }
      summary.attempted += 1;
      summary.per_source[source].attempted += 1;
      try {
        await adapters[source](userId, artist);
        summary.succeeded += 1;
        summary.per_source[source].succeeded += 1;
      } catch (error) {
        cacheSourceError(artist, source, error);
        summary.failed += 1;
        summary.per_source[source].failed += 1;
        summary.errors.push({ artist_name: artist.display_artist_name, source, code: error.code || `${source}_fetch_error`, message: error.message });
      }
      if (source === "lastfm") await sleep(250);
    }
    artistIntelligenceRepo.refreshArtistIntelligenceStats(artist.id);
  }

  return summary;
}

function getStaleArtistIntelligence() {
  const db = openDatabase();
  const now = new Date().toISOString();
  const providers = Object.fromEntries(SUPPORTED_SOURCES.map((source) => {
    const missing = db.prepare(`SELECT COUNT(*) AS count FROM artist_intelligence WHERE NOT EXISTS (SELECT 1 FROM artist_intelligence_sources WHERE artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id AND artist_intelligence_sources.source = ?)`).get(source).count;
    const expired = db.prepare("SELECT COUNT(*) AS count FROM artist_intelligence_sources WHERE source = ? AND expires_at IS NOT NULL AND expires_at <= ?").get(source, now).count;
    return [source, { missing, expired }];
  }));
  return {
    total_intelligence_rows: db.prepare("SELECT COUNT(*) AS count FROM artist_intelligence").get().count,
    providers,
    oldest_refreshed: db.prepare(`SELECT artist_intelligence.display_artist_name AS artist_name, artist_intelligence_sources.source, artist_intelligence_sources.fetched_at, artist_intelligence_sources.expires_at, artist_intelligence_sources.error_code FROM artist_intelligence_sources INNER JOIN artist_intelligence ON artist_intelligence.id = artist_intelligence_sources.artist_intelligence_id ORDER BY artist_intelligence_sources.fetched_at ASC LIMIT 25`).all(),
  };
}

module.exports = { ERROR_RETRY_COOLDOWN_MS, MAX_BATCH_LIMIT, SUPPORTED_SOURCES, batchFetchArtistIntelligence, getStaleArtistIntelligence, parseTrackArtists, seedArtistIntelligence };
