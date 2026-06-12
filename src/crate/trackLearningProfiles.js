const { openDatabase } = require("../db");
const { normalizeArtistName } = require("../repositories/artistGenres");
const curatedSeedRepo = require("../repositories/curatedPlaylistSeeds");
const playlistSeedCacheRepo = require("../repositories/playlistSeedCache");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");
const trackLearningRepo = require("../repositories/trackLearningProfiles");
const { normalizeText } = require("./curatedSeedImport");
const { eraForYear, releaseYearFromDate } = require("./eraYears");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const playlistSeedRegistry = require("./playlistSeedRegistry");
const { scorePlaylistCode } = require("./sortRules");
const { getArtistIds, getArtistNames, getTrackContext, parseRawTrack } = require("./trackContext");

const PROFILE_VERSION = "v1";
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const PLAYLIST_LABELS = Object.fromEntries(
  ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [definition.playlistCode, definition.shortLabel || definition.displayName]),
);

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

function normalizeLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : fallback;
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

function addMany(set, values) {
  for (const value of values || []) {
    const normalized = normalizeSignal(value);
    if (normalized) set.add(normalized);
  }
}

function serializeSet(set) {
  return [...set].sort((a, b) => a.localeCompare(b));
}

function confidenceTier(score) {
  if (score >= 90) return "high";
  if (score >= 75) return "strong";
  if (score >= 55) return "review";
  if (score > 0) return "weak";
  return "none";
}

function sourceSplit(sourceName, signals) {
  const normalized = (signals || []).map(normalizeSignal).filter(Boolean);
  if (sourceName === "spotify") {
    return {
      spotifyGenres: normalized.filter((signal) =>
        !signal.startsWith("popularity") &&
        !signal.startsWith("followers total") &&
        !signal.startsWith("spotify artist id") &&
        !signal.startsWith("artist name"),
      ),
      lastfmTags: [],
      musicbrainzTags: [],
    };
  }
  if (sourceName === "lastfm") return { spotifyGenres: [], lastfmTags: normalized, musicbrainzTags: [] };
  if (sourceName === "musicbrainz") {
    return {
      spotifyGenres: [],
      lastfmTags: [],
      musicbrainzTags: normalized
        .filter((signal) => signal.startsWith("tag:") || !signal.includes(":"))
        .map((signal) => signal.replace(/^tag:/, ""))
        .filter(Boolean),
    };
  }
  return { spotifyGenres: [], lastfmTags: [], musicbrainzTags: [] };
}

function readApprovedArtistGenres(db) {
  const result = new Map();
  if (!tableExists(db, "artist_genres")) return result;
  const rows = db.prepare("SELECT artist_name, genre, source FROM artist_genres ORDER BY artist_name COLLATE NOCASE ASC").all();
  for (const row of rows) {
    const key = normalizeArtistName(row.artist_name);
    if (!key) continue;
    const item = result.get(key) || { genres: new Set(), sources: new Set() };
    item.genres.add(row.genre);
    item.sources.add(row.source);
    result.set(key, item);
  }
  return result;
}

function readArtistIntelligence(db) {
  const byName = new Map();
  const bySpotifyId = new Map();
  const artistsByIdForTrackContext = new Map();
  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { byName, bySpotifyId, artistsByIdForTrackContext };
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
      artist_intelligence_sources.error_code
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
    ORDER BY artist_intelligence.normalized_artist_name
  `).all();

  for (const row of rows) {
    const key = row.normalized_artist_name;
    if (!key) continue;
    const entry = byName.get(key) || {
      artist_intelligence_id: row.id,
      artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: row.confidence_score || 0,
      source_count: row.source_count || 0,
      spotify_genres: new Set(),
      lastfm_artist_tags: new Set(),
      musicbrainz_tags: new Set(),
      sources: new Set(),
    };
    if (row.source && !row.error_code) {
      const split = sourceSplit(row.source, parseJson(row.normalized_signals_json, []));
      addMany(entry.spotify_genres, split.spotifyGenres);
      addMany(entry.lastfm_artist_tags, split.lastfmTags);
      addMany(entry.musicbrainz_tags, split.musicbrainzTags);
      entry.sources.add(row.source);
    }
    byName.set(key, entry);
    if (entry.spotify_artist_id) {
      bySpotifyId.set(entry.spotify_artist_id, entry);
      artistsByIdForTrackContext.set(entry.spotify_artist_id, {
        id: entry.spotify_artist_id,
        name: entry.artist_name,
        genres: serializeSet(entry.spotify_genres),
      });
    }
  }

  return { byName, bySpotifyId, artistsByIdForTrackContext };
}

function readTrackIntelligence(db) {
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
      track_intelligence.source_count,
      track_intelligence.confidence_score,
      track_intelligence_sources.source,
      track_intelligence_sources.normalized_signals_json,
      track_intelligence_sources.metadata_json,
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
      source_count: row.source_count || 0,
      confidence_score: row.confidence_score || 0,
      lastfm_track_tags: new Set(),
      lastfm_track_metadata: {},
      sources: new Set(),
    };
    if (row.source === "lastfm" && !row.error_code) {
      addMany(entry.lastfm_track_tags, parseJson(row.normalized_signals_json, []));
      entry.lastfm_track_metadata = parseJson(row.metadata_json, {});
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

function trackIdentityForRow(row, rawTrack, artistName) {
  const isrc = extractIsrc(rawTrack);
  return {
    isrc,
    identityKey: trackIntelligenceRepo.buildTrackIdentityKey({
      spotifyTrackId: row.spotify_track_id,
      isrc,
      artistName,
      trackName: row.name,
    }),
  };
}

function cachedTrackForRow(row, rawTrack, artistName, cache) {
  const identity = trackIdentityForRow(row, rawTrack, artistName);
  const artistTrackKey = `${trackIntelligenceRepo.normalizeText(artistName)}:${trackIntelligenceRepo.normalizeText(row.name)}`;
  return cache.byIdentityKey.get(identity.identityKey) ||
    (row.spotify_track_id ? cache.bySpotifyTrackId.get(row.spotify_track_id) : null) ||
    (identity.isrc ? cache.byIsrc.get(String(identity.isrc).trim().toUpperCase()) : null) ||
    cache.byArtistTrack.get(artistTrackKey) ||
    null;
}

function normalizedTrackKey(trackName, artistName) {
  return normalizeText(trackName) + "::" + normalizeText(artistName).replace(/^the\s+/, "");
}

function buildSpecialtyEvidence() {
  const spotifyByTrackId = new Map();
  const curatedByTrackId = new Map();
  const isrc = new Map();
  const spotifyKeys = new Map();
  const curatedKeys = new Map();
  const seeds = playlistSeedRegistry.getActivePlaylistSeeds().filter((seed) => seed.category === "specialty");

  function addMatch(map, key, match) {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(match);
    map.set(key, list);
  }

  for (const seed of seeds) {
    for (const track of playlistSeedCacheRepo.getCachedSeedTracks(seed.seed_code, { limit: 5000 })) {
      const primaryArtist = (track.artist_names || [])[0] || "";
      const match = {
        seed_code: seed.seed_code,
        playlist_name: seed.playlist_name,
        supported_playlist_code: seed.supports_playlist_code || null,
        source_type: seed.source_type || "spotify",
        match_source: "spotify_seed",
        confidence: 82,
      };
      addMatch(spotifyByTrackId, track.spotify_track_id, { ...match, match_type: "spotify_track_id", confidence: 100 });
      addMatch(isrc, track.isrc, { ...match, match_type: "isrc", confidence: 96 });
      addMatch(spotifyKeys, normalizedTrackKey(track.track_name, primaryArtist), { ...match, match_type: "spotify_artist_title", confidence: 82 });
    }

    for (const track of curatedSeedRepo.listCuratedSeedTracks(seed.seed_code)) {
      const match = {
        seed_code: seed.seed_code,
        playlist_name: seed.playlist_name,
        supported_playlist_code: seed.supports_playlist_code || null,
        source_type: track.source_type || seed.source_type || "curated",
        match_source: "curated_seed",
        match_type: "curated_artist_title",
        confidence: 88,
      };
      addMatch(curatedByTrackId, track.spotify_track_id, { ...match, match_type: "spotify_track_id", confidence: 100 });
      addMatch(curatedKeys, `${track.normalized_track}::${track.normalized_artist}`, match);
    }
  }

  return { spotifyByTrackId, curatedByTrackId, isrc, spotifyKeys, curatedKeys };
}

function specialtyMatchesForTrack(row, rawTrack, primaryArtistName, specialtyEvidence) {
  const identity = trackIdentityForRow(row, rawTrack, primaryArtistName);
  const key = normalizedTrackKey(row.name, primaryArtistName);
  const matches = [
    ...(row.spotify_track_id ? specialtyEvidence.spotifyByTrackId.get(row.spotify_track_id) || [] : []),
    ...(row.spotify_track_id ? specialtyEvidence.curatedByTrackId.get(row.spotify_track_id) || [] : []),
    ...(identity.isrc ? specialtyEvidence.isrc.get(identity.isrc) || [] : []),
    ...(specialtyEvidence.curatedKeys.get(key) || []),
    ...(specialtyEvidence.spotifyKeys.get(key) || []),
  ];
  const seen = new Set();
  return matches
    .filter((match) => {
      const dedupeKey = `${match.seed_code}:${match.match_type}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    })
    .sort((left, right) => right.confidence - left.confidence || left.seed_code.localeCompare(right.seed_code));
}

function readTrackRows({ limit, playlistCode, unmatchedOnly }) {
  const params = { limit: normalizeLimit(limit) };
  const having = [];
  if (playlistCode) {
    having.push("SUM(CASE WHEN effective_playlist_code = @playlistCode THEN 1 ELSE 0 END) > 0");
    params.playlistCode = playlistCode;
  }
  if (unmatchedOnly) {
    having.push("SUM(CASE WHEN effective_playlist_code IS NULL THEN 1 ELSE 0 END) > 0");
  }

  const havingSql = having.length ? "HAVING " + having.join(" AND ") : "";
  return openDatabase().prepare(`
    WITH track_users AS (
      SELECT
        tracks.id AS track_id,
        tracks.spotify_track_id,
        tracks.uri,
        tracks.name,
        tracks.artist_names,
        tracks.album_name,
        tracks.popularity,
        tracks.explicit,
        tracks.duration_ms,
        tracks.raw_json,
        track_era_overrides.effective_release_year,
        COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS effective_playlist_code,
        track_overrides.override_playlist_code,
        user_tracks.playlist_code AS assigned_playlist_code,
        user_tracks.user_id
      FROM tracks
      LEFT JOIN user_tracks ON user_tracks.track_id = tracks.id
      LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
      LEFT JOIN track_era_overrides ON track_era_overrides.track_id = tracks.id
    )
    SELECT
      track_id,
      spotify_track_id,
      uri,
      name,
      artist_names,
      album_name,
      popularity,
      explicit,
      duration_ms,
      raw_json,
      effective_release_year,
      COUNT(DISTINCT user_id) AS user_occurrence_count,
      SUM(CASE WHEN effective_playlist_code IS NULL THEN 1 ELSE 0 END) AS unmatched_occurrence_count,
      GROUP_CONCAT(DISTINCT effective_playlist_code) AS effective_playlist_codes,
      GROUP_CONCAT(DISTINCT override_playlist_code) AS override_playlist_codes,
      GROUP_CONCAT(DISTINCT assigned_playlist_code) AS assigned_playlist_codes
    FROM track_users
    GROUP BY track_id
    ${havingSql}
    ORDER BY unmatched_occurrence_count DESC, user_occurrence_count DESC, name COLLATE NOCASE ASC
    LIMIT @limit
  `).all(params);
}

function releaseYearForRow(row, rawTrack) {
  const manualYear = Number.parseInt(row.effective_release_year, 10);
  if (Number.isInteger(manualYear)) return manualYear;
  return releaseYearFromDate(rawTrack?.album?.release_date);
}

function splitCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function primaryPlaylistCode(row) {
  return splitCsv(row.effective_playlist_codes).find(Boolean) || null;
}

function compactReason(reason) {
  if (!reason || typeof reason !== "object") return {};
  return {
    reason: reason.reason || reason.matched || reason.genre || reason.title || null,
    genre: reason.genre || null,
    matched: reason.matched || null,
    points: reason.points || reason.score || null,
  };
}

function playlistCandidatesForContext(context) {
  const decision = scorePlaylistCode(context);
  return (decision.candidates || []).slice(0, 5).map((candidate) => ({
    playlist_code: candidate.playlistCode,
    playlist_label: PLAYLIST_LABELS[candidate.playlistCode] || candidate.playlistCode,
    score: candidate.score,
    confidence: Math.max(1, Math.min(99, Math.round(Number(candidate.score || 0)))),
    evidence: (candidate.reasons || []).slice(0, 6).map(compactReason),
  }));
}

function sourceCountForEvidence({ approvedGenres, spotifyGenres, lastfmArtistTags, musicbrainzTags, lastfmTrackTags, specialtyMatches, hasTrackOverride, hasEraOverride }) {
  return [
    approvedGenres.length > 0,
    spotifyGenres.length > 0,
    lastfmArtistTags.length > 0,
    musicbrainzTags.length > 0,
    lastfmTrackTags.length > 0,
    specialtyMatches.length > 0,
    hasTrackOverride,
    hasEraOverride,
  ].filter(Boolean).length;
}

function confidenceForEvidence({ approvedGenres, spotifyGenres, lastfmArtistTags, musicbrainzTags, lastfmTrackTags, specialtyMatches, hasTrackOverride, hasEraOverride }) {
  let score = 0;
  if (approvedGenres.length) score += 30;
  if (spotifyGenres.length) score += 20;
  if (lastfmArtistTags.length) score += 15;
  if (musicbrainzTags.length) score += 15;
  if (lastfmTrackTags.length) score += 20;
  if (specialtyMatches.some((match) => match.confidence >= 96)) score += 20;
  else if (specialtyMatches.length) score += 15;
  if (hasTrackOverride) score += 10;
  if (hasEraOverride) score += 5;
  return Math.min(95, score);
}

function conflictList({ currentPlaylistCode, candidates, specialtyMatches }) {
  const conflicts = [];
  const topCandidate = candidates[0] || null;
  if (currentPlaylistCode && topCandidate && topCandidate.playlist_code !== currentPlaylistCode && topCandidate.confidence >= 75) {
    conflicts.push({
      type: "assignment_candidate_mismatch",
      current_playlist_code: currentPlaylistCode,
      candidate_playlist_code: topCandidate.playlist_code,
      confidence: topCandidate.confidence,
    });
  }
  for (const match of specialtyMatches) {
    if (currentPlaylistCode && match.supported_playlist_code && match.supported_playlist_code !== currentPlaylistCode && match.confidence >= 88) {
      conflicts.push({
        type: "specialty_seed_current_playlist_mismatch",
        seed_code: match.seed_code,
        current_playlist_code: currentPlaylistCode,
        supported_playlist_code: match.supported_playlist_code,
        confidence: match.confidence,
      });
    }
  }
  return conflicts;
}

function profileForRow(row, caches) {
  const rawTrack = parseRawTrack(row.raw_json);
  const artistNames = getArtistNames(row, rawTrack);
  const artistIds = getArtistIds(rawTrack);
  const primaryArtistName = artistNames[0] || "Unknown Artist";
  const identity = trackIdentityForRow(row, rawTrack, primaryArtistName);
  const cachedTrack = cachedTrackForRow(row, rawTrack, primaryArtistName, caches.trackCache);
  const approvedGenres = new Set();
  const approvedSources = new Set();
  const spotifyGenres = new Set();
  const lastfmArtistTags = new Set();
  const musicbrainzTags = new Set();
  const fallbackGenresByArtistName = new Map();

  for (const artistName of artistNames) {
    const key = normalizeArtistName(artistName);
    const approved = caches.approvedByArtist.get(key);
    const cached = caches.artistIntelligence.byName.get(key);
    if (approved) {
      addMany(approvedGenres, approved.genres);
      addMany(approvedSources, approved.sources);
      fallbackGenresByArtistName.set(key, serializeSet(approved.genres));
    }
    if (cached) {
      addMany(spotifyGenres, cached.spotify_genres);
      addMany(lastfmArtistTags, cached.lastfm_artist_tags);
      addMany(musicbrainzTags, cached.musicbrainz_tags);
    }
  }

  for (const artistId of artistIds) {
    const cached = caches.artistIntelligence.bySpotifyId.get(artistId);
    if (!cached) continue;
    addMany(spotifyGenres, cached.spotify_genres);
    addMany(lastfmArtistTags, cached.lastfm_artist_tags);
    addMany(musicbrainzTags, cached.musicbrainz_tags);
  }

  const lastfmTrackTags = serializeSet(cachedTrack?.lastfm_track_tags || new Set());
  const specialtyMatches = specialtyMatchesForTrack(row, rawTrack, primaryArtistName, caches.specialtyEvidence);
  const baseContext = getTrackContext(row, caches.artistIntelligence.artistsByIdForTrackContext, fallbackGenresByArtistName, rawTrack);
  const context = {
    ...baseContext,
    genres: [...new Set([...(baseContext.genres || []), ...lastfmTrackTags])],
    trackTags: lastfmTrackTags,
  };
  const candidates = playlistCandidatesForContext(context);
  const currentPlaylistCode = primaryPlaylistCode(row);
  const hasTrackOverride = splitCsv(row.override_playlist_codes).length > 0;
  const hasEraOverride = Boolean(row.effective_release_year);
  const releaseYear = releaseYearForRow(row, rawTrack);
  const evidence = {
    approvedGenres: serializeSet(approvedGenres),
    spotifyGenres: serializeSet(spotifyGenres),
    lastfmArtistTags: serializeSet(lastfmArtistTags),
    musicbrainzTags: serializeSet(musicbrainzTags),
    lastfmTrackTags,
    specialtyMatches,
    hasTrackOverride,
    hasEraOverride,
  };
  const confidenceScore = confidenceForEvidence(evidence);
  const sourceCount = sourceCountForEvidence(evidence);
  const conflicts = conflictList({ currentPlaylistCode, candidates, specialtyMatches });
  const topCandidate = candidates[0] || null;
  const wouldChange = Boolean(currentPlaylistCode && topCandidate && topCandidate.playlist_code !== currentPlaylistCode && topCandidate.confidence >= 75);

  return {
    track_id: row.track_id,
    spotify_track_id: row.spotify_track_id || null,
    identity_key: identity.identityKey,
    profile_version: PROFILE_VERSION,
    current_playlist_code: currentPlaylistCode,
    top_candidate_playlist_code: topCandidate?.playlist_code || null,
    confidence_score: confidenceScore,
    confidence_tier: confidenceTier(confidenceScore),
    source_count: sourceCount,
    would_change_if_learning_active: wouldChange,
    has_specialty_match: specialtyMatches.length > 0,
    has_conflict: conflicts.length > 0,
    user_occurrence_count: row.user_occurrence_count || 0,
    unmatched_occurrence_count: row.unmatched_occurrence_count || 0,
    derived_profile: {
      track: {
        id: row.track_id,
        name: row.name,
        spotify_track_id: row.spotify_track_id || null,
        uri: row.uri || null,
        isrc: identity.isrc || null,
        album_name: row.album_name || null,
        release_year: releaseYear,
        era: eraForYear(releaseYear),
        popularity: row.popularity,
        explicit: Boolean(row.explicit),
        duration_ms: row.duration_ms,
      },
      artists: artistNames.map((artistName, index) => ({
        name: artistName,
        spotify_artist_id: artistIds[index] || null,
      })),
      inherited_artist_signals: {
        approved_artist_genres: evidence.approvedGenres,
        approved_sources: serializeSet(approvedSources),
        spotify_artist_genres: evidence.spotifyGenres,
        lastfm_artist_tags: evidence.lastfmArtistTags.slice(0, 30),
        musicbrainz_tags: evidence.musicbrainzTags.slice(0, 30),
      },
      track_signals: {
        lastfm_track_tags: evidence.lastfmTrackTags,
        audio_features: null,
      },
      assignment_context: {
        current_playlist_code: currentPlaylistCode,
        current_playlist_label: PLAYLIST_LABELS[currentPlaylistCode] || currentPlaylistCode,
        assigned_playlist_codes: splitCsv(row.assigned_playlist_codes),
        override_playlist_codes: splitCsv(row.override_playlist_codes),
        era_override_applied: hasEraOverride,
        user_occurrence_count: row.user_occurrence_count || 0,
        unmatched_occurrence_count: row.unmatched_occurrence_count || 0,
      },
      specialty_context: {
        seed_matches: specialtyMatches,
        strongest_specialty_match: specialtyMatches[0] || null,
      },
      conflicts,
      notes: [
        "Derived internal profile only.",
        "Not connected to sorting, playlist assignment, Spotify send, or user UI.",
      ],
    },
    evidence_summary: {
      source_count: sourceCount,
      confidence_score: confidenceScore,
      confidence_tier: confidenceTier(confidenceScore),
      approved_artist_genre_count: evidence.approvedGenres.length,
      spotify_artist_genre_count: evidence.spotifyGenres.length,
      lastfm_artist_tag_count: evidence.lastfmArtistTags.length,
      musicbrainz_tag_count: evidence.musicbrainzTags.length,
      lastfm_track_tag_count: evidence.lastfmTrackTags.length,
      specialty_match_count: specialtyMatches.length,
      has_track_override: hasTrackOverride,
      has_era_override: hasEraOverride,
    },
    playlist_candidates: candidates,
    specialty_matches: specialtyMatches,
  };
}

function buildCaches() {
  const db = openDatabase();
  return {
    approvedByArtist: readApprovedArtistGenres(db),
    artistIntelligence: readArtistIntelligence(db),
    trackCache: readTrackIntelligence(db),
    specialtyEvidence: buildSpecialtyEvidence(),
  };
}

function generateTrackLearningProfiles(options = {}) {
  const filters = {
    limit: normalizeLimit(options.limit),
    playlistCode: String(options.playlist_code || options.playlistCode || "").trim(),
    unmatchedOnly: Boolean(options.unmatched_only || options.unmatchedOnly),
  };
  const rows = readTrackRows(filters);
  const caches = buildCaches();
  const db = openDatabase();
  const generated = [];

  const write = db.transaction(() => {
    for (const row of rows) {
      const profile = profileForRow(row, caches);
      generated.push(trackLearningRepo.upsertTrackLearningProfile(profile));
    }
  });
  write();

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    profile_version: PROFILE_VERSION,
    filters,
    attempted: rows.length,
    generated: generated.length,
    summary: trackLearningRepo.getTrackLearningProfileSummary(),
  };
}

function getAdminTrackLearningProfiles(options = {}) {
  const limit = normalizeLimit(options.limit);
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  const rows = trackLearningRepo.listTrackLearningProfiles({
    limit,
    offset,
    confidenceTier: String(options.confidence_tier || options.confidenceTier || "").trim(),
    playlistCode: String(options.playlist_code || options.playlistCode || "").trim(),
    unmatchedOnly: Boolean(options.unmatched_only || options.unmatchedOnly),
  });
  const wouldChange = rows.filter((row) => row.would_change_if_learning_active);
  const conflicts = rows.filter((row) => row.has_conflict);
  const specialty = rows.filter((row) => row.has_specialty_match);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    filters: {
      limit,
      offset,
      confidence_tier: options.confidence_tier || "",
      playlist_code: options.playlist_code || "",
      unmatched_only: Boolean(options.unmatched_only || options.unmatchedOnly),
    },
    summary: trackLearningRepo.getTrackLearningProfileSummary(),
    profiles: rows,
    unmatched_tracks_with_derived_evidence: rows.filter((row) => row.unmatched_occurrence_count > 0 && row.source_count > 0),
    current_assignment_vs_derived_candidates: wouldChange,
    specialty_matches: specialty,
    conflicts,
    would_change_if_learning_active_count: wouldChange.length,
    notes: [
      "Backend-only Track Learning profile report.",
      "Confidence is informational only.",
      "No sorting, playlist assignment, user UI, approvals, rescans, Spotify reads, or Spotify writes are triggered.",
    ],
  };
}

module.exports = {
  generateTrackLearningProfiles,
  getAdminTrackLearningProfiles,
};
