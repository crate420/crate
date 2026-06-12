const { openDatabase } = require("../db");
const lastfmClient = require("../lastfm/client");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const TRACK_INTELLIGENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ERROR_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function extractIsrc(rawTrack) {
  return rawTrack?.external_ids?.isrc || null;
}

function normalizeTrackIdList(values) {
  if (!Array.isArray(values)) return new Set();
  return new Set(values.map((value) => Number.parseInt(value, 10)).filter((value) => Number.isInteger(value) && value > 0));
}

function readUnmatchedTrackRows() {
  return openDatabase().prepare(`
    SELECT
      tracks.id AS track_id,
      tracks.spotify_track_id,
      tracks.name,
      tracks.album_name,
      tracks.artist_names,
      tracks.raw_json,
      COUNT(DISTINCT user_tracks.user_id) AS affected_user_count
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    WHERE user_tracks.playlist_code IS NULL
      AND track_overrides.override_playlist_code IS NULL
    GROUP BY tracks.id
    ORDER BY affected_user_count DESC, tracks.name COLLATE NOCASE ASC
  `).all();
}

function sourceNeedsRefresh(source, { refreshMissing, refreshStale, now }) {
  if (!source) return refreshMissing;
  const expiresAt = source.expires_at ? Date.parse(source.expires_at) : 0;
  if (source.error_code && expiresAt && expiresAt > now.getTime()) return false;
  if (refreshStale && (!expiresAt || expiresAt <= now.getTime())) return true;
  return false;
}

function normalizeTags(tags) {
  return [...new Set(
    (tags || [])
      .map((tag) => String(tag.name || tag).trim().toLowerCase())
      .filter(Boolean),
  )].slice(0, 30);
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

function serializeTrack(row) {
  const rawTrack = parseRawTrack(row.raw_json);
  const artistNames = getArtistNames(row, rawTrack);
  const artistName = artistNames[0] || "Unknown Artist";
  const isrc = extractIsrc(rawTrack);
  const intelligence = trackIntelligenceRepo.getOrCreateTrackIntelligence({
    trackName: row.name,
    artistName,
    spotifyTrackId: row.spotify_track_id,
    isrc,
  });
  const source = trackIntelligenceRepo.listTrackIntelligenceSources(intelligence.id)
    .find((item) => item.source === "lastfm");

  return { row, rawTrack, artistName, artistNames, isrc, intelligence, source };
}

function selectTracksForRefresh(options = {}) {
  const now = new Date();
  const limit = normalizeLimit(options.limit);
  const mode = String(options.mode || "missing").trim().toLowerCase();
  const selectedTrackIds = normalizeTrackIdList(options.trackIds || options.track_ids);
  const refreshMissing = mode === "missing" || mode === "selected" || mode === "all";
  const refreshStale = mode === "stale" || mode === "selected" || mode === "all";
  const rows = readUnmatchedTrackRows();
  const selected = [];
  let skipped = 0;

  for (const row of rows) {
    if (selected.length >= limit) break;
    if (selectedTrackIds.size && !selectedTrackIds.has(row.track_id)) {
      skipped += 1;
      continue;
    }

    const track = serializeTrack(row);
    if (mode === "selected" && selectedTrackIds.has(row.track_id)) {
      selected.push(track);
      continue;
    }

    if (sourceNeedsRefresh(track.source, { refreshMissing, refreshStale, now })) {
      selected.push(track);
    } else {
      skipped += 1;
    }
  }

  return { selected, skipped, totalUnmatched: rows.length, limit, mode };
}

function topTagsFromResults(results) {
  const counts = new Map();
  for (const result of results) {
    for (const tag of result.normalized_signals || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 25);
}

async function refreshLastfmTrackIntelligence(options = {}) {
  lastfmClient.requireLastfmConfig();
  const { selected, skipped, totalUnmatched, limit, mode } = selectTracksForRefresh(options);
  const summary = {
    status: "ok",
    mode,
    limit,
    total_unmatched_tracks: totalUnmatched,
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
      const result = await lastfmClient.getTrackInfoAndTopTags({
        artistName: item.artistName,
        trackName: item.row.name,
      });
      const rawTags = (result.topTags.tags || [])
        .slice(0, 30)
        .map((tag) => ({ name: tag.name, count: Number.parseInt(tag.count, 10) || 0 }))
        .filter((tag) => tag.name);
      const normalizedSignals = normalizeTags(rawTags);
      const metadata = metadataFromInfo(result.info);
      const source = trackIntelligenceRepo.upsertTrackIntelligenceSource({
        trackIntelligenceId: item.intelligence.id,
        source: "lastfm",
        sourceTrackId: result.info.mbid || null,
        sourceTrackName: result.info.sourceTrackName || result.topTags.sourceTrackName || item.row.name,
        sourceArtistName: result.info.sourceArtistName || result.topTags.sourceArtistName || item.artistName,
        rawPayload: { info: result.info.rawPayload, topTags: result.topTags.rawPayload },
        normalizedSignals,
        metadata,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: new Date(fetchedAt.getTime() + TRACK_INTELLIGENCE_TTL_MS).toISOString(),
      });
      const serialized = {
        track_id: item.row.track_id,
        track_name: item.row.name,
        artist: item.artistName,
        source_track_name: source.source_track_name,
        source_artist_name: source.source_artist_name,
        normalized_signals: normalizedSignals,
        metadata,
        fetched_at: source.fetched_at,
      };
      if (normalizedSignals.length) summary.updated += 1;
      else summary.empty += 1;
      summary.results.push(serialized);
    } catch (err) {
      summary.failed += 1;
      trackIntelligenceRepo.upsertTrackIntelligenceSource({
        trackIntelligenceId: item.intelligence.id,
        source: "lastfm",
        rawPayload: {},
        normalizedSignals: [],
        metadata: {},
        errorCode: err.code || "lastfm_track_refresh_error",
        errorMessage: err.message,
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: new Date(fetchedAt.getTime() + ERROR_COOLDOWN_MS).toISOString(),
      });
      summary.results.push({
        track_id: item.row.track_id,
        track_name: item.row.name,
        artist: item.artistName,
        error_code: err.code || "lastfm_track_refresh_error",
        error_message: err.message,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  summary.top_newly_discovered_lastfm_track_tags = topTagsFromResults(summary.results);
  return summary;
}

function getTrackIntelligenceCacheSummary() {
  const db = openDatabase();
  const totalRows = db.prepare("SELECT COUNT(*) AS count FROM track_intelligence").get().count;
  const sourceRows = db.prepare("SELECT COUNT(*) AS count FROM track_intelligence_sources").get().count;
  const lastfmRows = db.prepare("SELECT COUNT(*) AS count FROM track_intelligence_sources WHERE source = 'lastfm' AND error_code IS NULL").get().count;
  return { total_rows: totalRows, source_rows: sourceRows, lastfm_rows: lastfmRows };
}

module.exports = {
  getTrackIntelligenceCacheSummary,
  refreshLastfmTrackIntelligence,
  selectTracksForRefresh,
};
