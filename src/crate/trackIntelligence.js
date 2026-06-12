const { openDatabase } = require("../db");
const { normalizeArtistName } = require("../repositories/artistGenres");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");
const { scorePlaylistCode } = require("./sortRules");
const { getArtistIds, getArtistNames, getTrackContext, parseRawTrack } = require("./trackContext");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");

const PLAYLIST_LABELS = Object.fromEntries(
  ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [
    definition.playlistCode,
    definition.shortLabel || definition.displayName,
  ]),
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

function normalizeSignal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^genre:/, "")
    .replace(/^tag:/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeLimit(value, fallback = 100, maximum = 500) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function normalizeMinimum(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function confidenceTier(score) {
  if (score >= 95) return "Safe";
  if (score >= 85) return "Strong";
  if (score >= 70) return "Review";
  return "Manual";
}

function addToSet(set, values) {
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (normalized) set.add(normalized);
  }
}

function serializeSet(set) {
  return [...set].sort((a, b) => a.localeCompare(b));
}

function increment(map, key, amount = 1) {
  const normalized = String(key || "").trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function serializeCountMap(map, keyName) {
  return [...map.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function readUnmatchedRows(db) {
  return db.prepare(`
    SELECT
      users.id AS user_id,
      users.display_name,
      users.email,
      tracks.id AS track_id,
      tracks.spotify_track_id,
      tracks.uri,
      tracks.name,
      tracks.album_name,
      tracks.artist_names,
      tracks.popularity,
      tracks.explicit,
      tracks.raw_json,
      track_overrides.override_playlist_code,
      track_era_overrides.effective_release_year
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    INNER JOIN users ON users.id = user_tracks.user_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    LEFT JOIN track_era_overrides ON track_era_overrides.track_id = tracks.id
    WHERE user_tracks.playlist_code IS NULL
      AND track_overrides.override_playlist_code IS NULL
    ORDER BY tracks.name COLLATE NOCASE ASC, users.id ASC
  `).all();
}

function readApprovedGenresByArtist(db) {
  const result = new Map();
  if (!tableExists(db, "artist_genres")) return result;

  const rows = db.prepare(`
    SELECT artist_name, genre, source
    FROM artist_genres
    ORDER BY artist_name COLLATE NOCASE ASC, genre COLLATE NOCASE ASC
  `).all();

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

function splitSourceSignals(sourceName, signals) {
  const normalized = (signals || []).map(normalizeSignal).filter(Boolean);

  if (sourceName === "spotify") {
    return {
      spotifyGenres: normalized.filter((signal) =>
        !signal.startsWith("popularity:") &&
        !signal.startsWith("followers total:") &&
        !signal.startsWith("spotify artist id:") &&
        !signal.startsWith("artist name:"),
      ),
      lastfmTags: [],
      musicbrainzTags: [],
    };
  }

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

  if (sourceName === "lastfm") {
    return {
      spotifyGenres: [],
      lastfmTags: normalized,
      musicbrainzTags: [],
    };
  }

  return { spotifyGenres: [], lastfmTags: [], musicbrainzTags: [] };
}


function readTrackIntelligenceCache(db) {
  const byIdentityKey = new Map();
  const bySpotifyTrackId = new Map();
  const byIsrc = new Map();
  const byArtistTrack = new Map();

  if (!tableExists(db, "track_intelligence") || !tableExists(db, "track_intelligence_sources")) {
    return { byIdentityKey, bySpotifyTrackId, byIsrc, byArtistTrack };
  }

  const rows = db.prepare(`
    SELECT
      track_intelligence.id AS track_intelligence_id,
      track_intelligence.identity_key,
      track_intelligence.track_name,
      track_intelligence.artist_name,
      track_intelligence.normalized_track_name,
      track_intelligence.normalized_artist_name,
      track_intelligence.spotify_track_id,
      track_intelligence.isrc,
      track_intelligence.source_count,
      track_intelligence.confidence_score,
      track_intelligence.last_refreshed_at,
      track_intelligence_sources.source,
      track_intelligence_sources.normalized_signals_json,
      track_intelligence_sources.metadata_json,
      track_intelligence_sources.error_code,
      track_intelligence_sources.fetched_at,
      track_intelligence_sources.expires_at
    FROM track_intelligence
    LEFT JOIN track_intelligence_sources
      ON track_intelligence_sources.track_intelligence_id = track_intelligence.id
    ORDER BY track_intelligence.identity_key, track_intelligence_sources.source
  `).all();

  for (const row of rows) {
    const entry = byIdentityKey.get(row.identity_key) || {
      track_intelligence_id: row.track_intelligence_id,
      identity_key: row.identity_key,
      track_name: row.track_name,
      artist_name: row.artist_name,
      normalized_track_name: row.normalized_track_name,
      normalized_artist_name: row.normalized_artist_name,
      spotify_track_id: row.spotify_track_id,
      isrc: row.isrc,
      source_count: row.source_count || 0,
      confidence_score: row.confidence_score || 0,
      last_refreshed_at: row.last_refreshed_at,
      lastfm_track_tags: new Set(),
      lastfm_track_metadata: {},
      sources: [],
    };

    if (row.source) {
      const signals = parseJson(row.normalized_signals_json, []);
      const metadata = parseJson(row.metadata_json, {});
      if (row.source === "lastfm" && !row.error_code) {
        addToSet(entry.lastfm_track_tags, signals.map(normalizeSignal));
        entry.lastfm_track_metadata = metadata;
      }
      entry.sources.push({
        source: row.source,
        error_code: row.error_code,
        fetched_at: row.fetched_at,
        expires_at: row.expires_at,
        signal_count: signals.length,
      });
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

function getCachedTrackIntelligence(row, rawTrack, artistName, trackCache) {
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

function readArtistIntelligence(db) {
  const byName = new Map();
  const bySpotifyId = new Map();
  const artistsByIdForTrackContext = new Map();

  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { byName, bySpotifyId, artistsByIdForTrackContext };
  }

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
      artist_intelligence_sources.fetched_at
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
    ORDER BY artist_intelligence.normalized_artist_name, artist_intelligence_sources.source
  `).all();

  for (const row of rows) {
    const key = row.normalized_artist_name;
    if (!key) continue;

    const entry = byName.get(key) || {
      artist_intelligence_id: row.artist_intelligence_id,
      normalized_artist_name: row.normalized_artist_name,
      display_artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: row.confidence_score || 0,
      source_count: row.source_count || 0,
      spotify_genres: new Set(),
      lastfm_tags: new Set(),
      musicbrainz_tags: new Set(),
      sources: [],
    };

    if (row.source) {
      const signals = parseJson(row.normalized_signals_json, []);
      const split = splitSourceSignals(row.source, signals);
      addToSet(entry.spotify_genres, split.spotifyGenres);
      addToSet(entry.lastfm_tags, split.lastfmTags);
      addToSet(entry.musicbrainz_tags, split.musicbrainzTags);
      entry.sources.push({
        source: row.source,
        error_code: row.error_code,
        fetched_at: row.fetched_at,
        signal_count: signals.length,
      });
    }

    byName.set(key, entry);
    if (entry.spotify_artist_id) {
      bySpotifyId.set(entry.spotify_artist_id, entry);
      artistsByIdForTrackContext.set(entry.spotify_artist_id, {
        id: entry.spotify_artist_id,
        name: entry.display_artist_name,
        genres: serializeSet(entry.spotify_genres),
      });
    }
  }

  return { byName, bySpotifyId, artistsByIdForTrackContext };
}

function releaseYearFromRawTrack(rawTrack) {
  const value = rawTrack?.album?.release_date;
  const parsed = Number.parseInt(String(value || "").slice(0, 4), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function scoreToConfidence(score) {
  const parsed = Number(score);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.min(99, Math.round(parsed)));
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
  return (decision.candidates || []).slice(0, 3).map((candidate) => {
    const confidence = scoreToConfidence(candidate.score);
    return {
      playlist_code: candidate.playlistCode,
      playlist_label: PLAYLIST_LABELS[candidate.playlistCode] || candidate.playlistCode,
      confidence,
      confidence_tier: confidenceTier(confidence),
      score: candidate.score,
      evidence: (candidate.reasons || []).slice(0, 5).map(compactReason),
    };
  });
}

function reasonForUnmatched(context, candidateCount) {
  if (!context.track?.name || !context.artistNames?.length) return "missing_track_metadata";
  if (context.fallbackGenres?.length && !candidateCount) return "artist_genres_found_but_no_rule_match";
  if (context.spotifyGenres?.length && !candidateCount) return "spotify_genres_found_but_no_rule_match";
  if (!context.spotifyGenres?.length && !context.fallbackGenres?.length) return "no_artist_genres_found";
  if (!candidateCount) return "no_playlist_rule_match";
  return "unknown";
}

function evidenceConfidence({ approvedGenres, spotifyGenres, lastfmTags, musicbrainzTags }) {
  const sourceCount = [
    approvedGenres.length > 0,
    spotifyGenres.length > 0,
    lastfmTags.length > 0,
    musicbrainzTags.length > 0,
  ].filter(Boolean).length;

  if (approvedGenres.length && spotifyGenres.length) return 92;
  if (approvedGenres.length) return 84;
  if (spotifyGenres.length && sourceCount >= 2) return 80;
  if (spotifyGenres.length) return 72;
  if (sourceCount >= 2) return 68;
  if (lastfmTags.length || musicbrainzTags.length) return 55;
  return 0;
}

function trackKey(row) {
  return row.spotify_track_id || `track:${row.track_id}`;
}

function buildTrackRecords(rows, approvedByArtist, intelligence, trackCache) {
  const grouped = new Map();

  for (const row of rows) {
    const key = trackKey(row);
    const rawTrack = parseRawTrack(row.raw_json);
    const existing = grouped.get(key);

    if (existing) {
      existing.affected_users.set(row.user_id, {
        user_id: row.user_id,
        name: row.display_name || null,
        email: row.email || null,
      });
      continue;
    }

    const artistNames = getArtistNames(row, rawTrack);
    const artistIds = getArtistIds(rawTrack);
    const primaryArtistName = artistNames[0] || "Unknown Artist";
    const cachedTrack = getCachedTrackIntelligence(row, rawTrack, primaryArtistName, trackCache);
    const trackLastfmTags = cachedTrack ? serializeSet(cachedTrack.lastfm_track_tags) : [];
    const fallbackGenresByArtistName = new Map();
    const approvedGenres = new Set();
    const approvedSources = new Set();
    const spotifyGenres = new Set();
    const lastfmTags = new Set();
    const musicbrainzTags = new Set();

    for (const artistName of artistNames) {
      const keyName = normalizeArtistName(artistName);
      const approved = approvedByArtist.get(keyName);
      const cached = intelligence.byName.get(keyName);

      if (approved) {
        fallbackGenresByArtistName.set(keyName, serializeSet(approved.genres));
        addToSet(approvedGenres, approved.genres);
        addToSet(approvedSources, approved.sources);
      }

      if (cached) {
        addToSet(spotifyGenres, cached.spotify_genres);
        addToSet(lastfmTags, cached.lastfm_tags);
        addToSet(musicbrainzTags, cached.musicbrainz_tags);
      }
    }

    for (const artistId of artistIds) {
      const cached = intelligence.bySpotifyId.get(artistId);
      if (!cached) continue;
      addToSet(spotifyGenres, cached.spotify_genres);
      addToSet(lastfmTags, cached.lastfm_tags);
      addToSet(musicbrainzTags, cached.musicbrainz_tags);
    }

    const baseContext = getTrackContext(
      row,
      intelligence.artistsByIdForTrackContext,
      fallbackGenresByArtistName,
      rawTrack,
    );
    const context = {
      ...baseContext,
      genres: [...new Set([...(baseContext.genres || []), ...trackLastfmTags])],
      trackTags: trackLastfmTags,
    };
    const playlistCandidates = playlistCandidatesForContext(context);
    const topPlaylistFitScore = playlistCandidates[0]?.confidence || 0;
    const genreConfidence = evidenceConfidence({
      approvedGenres: serializeSet(approvedGenres),
      spotifyGenres: serializeSet(spotifyGenres),
      lastfmTags: serializeSet(lastfmTags),
      musicbrainzTags: serializeSet(musicbrainzTags),
    });
    const artistConfidence = Math.max(
      genreConfidence,
      ...artistNames.map((artistName) => intelligence.byName.get(normalizeArtistName(artistName))?.confidence_score || 0),
    );

    grouped.set(key, {
      track_id: row.track_id,
      spotify_track_id: row.spotify_track_id,
      spotify_uri: row.uri,
      track_name: row.name,
      artist_names: artistNames,
      artist: artistNames.join(", "),
      album_name: row.album_name,
      release_year: context.album?.effectiveReleaseYear || releaseYearFromRawTrack(rawTrack),
      affected_users: new Map([[row.user_id, {
        user_id: row.user_id,
        name: row.display_name || null,
        email: row.email || null,
      }]]),
      spotify_artist_ids: artistIds,
      approved_artist_genres: serializeSet(approvedGenres),
      approved_genre_sources: serializeSet(approvedSources),
      spotify_artist_genres: serializeSet(spotifyGenres),
      lastfm_artist_tags: serializeSet(lastfmTags),
      musicbrainz_tags: serializeSet(musicbrainzTags),
      lastfm_track_tags: trackLastfmTags,
      lastfm_track_metadata: cachedTrack?.lastfm_track_metadata || {},
      track_intelligence_source_count: cachedTrack?.source_count || 0,
      track_intelligence_confidence: cachedTrack?.confidence_score || 0,
      track_intelligence_sources: cachedTrack?.sources || [],
      evidence_count: serializeSet(approvedGenres).length + serializeSet(spotifyGenres).length + serializeSet(lastfmTags).length + serializeSet(musicbrainzTags).length + trackLastfmTags.length,
      merged_genre_context: context.genres || [],
      playlist_candidates: playlistCandidates,
      existing_playlist_candidates: playlistCandidates,
      artist_confidence: Math.min(99, Math.round(artistConfidence)),
      genre_confidence: genreConfidence,
      playlist_fit_score: topPlaylistFitScore,
      playlist_fit_tier: confidenceTier(topPlaylistFitScore),
      final_unmatched_reason: reasonForUnmatched(context, playlistCandidates.length),
    });
  }

  return [...grouped.values()].map((record) => ({
    ...record,
    affected_user_count: record.affected_users.size,
    affected_users: [...record.affected_users.values()].sort((a, b) => a.user_id - b.user_id),
    impact_score: record.affected_users.size,
  }));
}

function sortImpactRows(left, right) {
  if (right.impact_score !== left.impact_score) return right.impact_score - left.impact_score;
  if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
  return String(left.artist || left.album || left.track_name).localeCompare(String(right.artist || right.album || right.track_name));
}

function aggregateByArtist(records) {
  const byArtist = new Map();

  for (const record of records) {
    for (const artistName of record.artist_names.length ? record.artist_names : ["Unknown Artist"]) {
      const key = normalizeArtistName(artistName) || "unknown artist";
      const item = byArtist.get(key) || {
        artist: artistName,
        affected_users: new Map(),
        unmatched_track_ids: new Set(),
        unmatched_count: 0,
        impact_score: 0,
        sample_tracks: [],
      };
      for (const user of record.affected_users) item.affected_users.set(user.user_id, user);
      item.unmatched_track_ids.add(record.track_id);
      item.unmatched_count += record.affected_user_count;
      if (item.sample_tracks.length < 5) item.sample_tracks.push(record.track_name);
      byArtist.set(key, item);
    }
  }

  return [...byArtist.values()].map((item) => ({
    artist: item.artist,
    affected_user_count: item.affected_users.size,
    affected_users: [...item.affected_users.values()].sort((a, b) => a.user_id - b.user_id),
    unmatched_track_count: item.unmatched_track_ids.size,
    total_occurrences: item.unmatched_count,
    impact_score: item.affected_users.size * item.unmatched_track_ids.size,
    sample_tracks: item.sample_tracks,
  })).sort(sortImpactRows);
}

function aggregateByAlbum(records) {
  const byAlbum = new Map();

  for (const record of records) {
    const albumName = record.album_name || "Unknown Album";
    const key = albumName.toLowerCase();
    const item = byAlbum.get(key) || {
      album: albumName,
      artists: new Set(),
      affected_users: new Map(),
      unmatched_track_ids: new Set(),
      unmatched_count: 0,
      sample_tracks: [],
    };
    addToSet(item.artists, record.artist_names);
    for (const user of record.affected_users) item.affected_users.set(user.user_id, user);
    item.unmatched_track_ids.add(record.track_id);
    item.unmatched_count += record.affected_user_count;
    if (item.sample_tracks.length < 5) item.sample_tracks.push(record.track_name);
    byAlbum.set(key, item);
  }

  return [...byAlbum.values()].map((item) => ({
    album: item.album,
    artists: serializeSet(item.artists),
    affected_user_count: item.affected_users.size,
    affected_users: [...item.affected_users.values()].sort((a, b) => a.user_id - b.user_id),
    unmatched_track_count: item.unmatched_track_ids.size,
    total_occurrences: item.unmatched_count,
    impact_score: item.affected_users.size * item.unmatched_track_ids.size,
    sample_tracks: item.sample_tracks,
  })).sort(sortImpactRows);
}

function flattenPlaylistRecommendations(records) {
  const rows = [];
  for (const record of records) {
    for (const candidate of record.playlist_candidates) {
      rows.push({
        track_id: record.track_id,
        track_name: record.track_name,
        artist: record.artist,
        affected_user_count: record.affected_user_count,
        playlist_code: candidate.playlist_code,
        playlist_label: candidate.playlist_label,
        confidence: candidate.confidence,
        confidence_tier: candidate.confidence_tier,
        evidence: candidate.evidence,
        impact_score: record.affected_user_count * candidate.confidence,
      });
    }
  }

  return rows.sort((left, right) => {
    if (right.impact_score !== left.impact_score) return right.impact_score - left.impact_score;
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return left.track_name.localeCompare(right.track_name);
  });
}

function applyFilters(records, filters) {
  const artistFilter = String(filters.artist || "").trim().toLowerCase();
  const playlistFilter = String(filters.playlistCandidate || "").trim().toLowerCase();
  const tierFilter = String(filters.confidenceTier || "").trim().toLowerCase();
  const minimumAffectedUsers = normalizeMinimum(filters.affectedUsers, 0);

  return records.filter((record) => {
    if (artistFilter && !record.artist.toLowerCase().includes(artistFilter)) return false;
    if (minimumAffectedUsers && record.affected_user_count < minimumAffectedUsers) return false;
    if (playlistFilter && !record.playlist_candidates.some((candidate) => candidate.playlist_code.toLowerCase() === playlistFilter || candidate.playlist_label.toLowerCase() === playlistFilter)) return false;
    if (tierFilter && !record.playlist_candidates.some((candidate) => candidate.confidence_tier.toLowerCase() === tierFilter)) return false;
    return true;
  });
}

function getAdminTrackIntelligence(options = {}) {
  const db = openDatabase();
  const limit = normalizeLimit(options.limit, 100, 500);
  const approvedByArtist = readApprovedGenresByArtist(db);
  const intelligence = readArtistIntelligence(db);
  const trackCache = readTrackIntelligenceCache(db);
  const allRecords = buildTrackRecords(readUnmatchedRows(db), approvedByArtist, intelligence, trackCache).sort(sortImpactRows);
  const filteredRecords = applyFilters(allRecords, {
    artist: options.artist,
    playlistCandidate: options.playlistCandidate,
    confidenceTier: options.confidenceTier,
    affectedUsers: options.affectedUsers,
  });
  const tracksWithCandidates = filteredRecords.filter((record) => record.playlist_candidates.length > 0);
  const tracksWithNoUsefulEvidence = filteredRecords.filter((record) =>
    record.playlist_candidates.length === 0 &&
    record.approved_artist_genres.length === 0 &&
    record.spotify_artist_genres.length === 0 &&
    record.lastfm_artist_tags.length === 0 &&
    record.musicbrainz_tags.length === 0 &&
    record.lastfm_track_tags.length === 0
  );
  const recommendations = flattenPlaylistRecommendations(filteredRecords);
  const availablePlaylistCandidates = [...new Map(
    recommendations.map((candidate) => [candidate.playlist_code, {
      playlist_code: candidate.playlist_code,
      playlist_label: candidate.playlist_label,
    }]),
  ).values()].sort((left, right) => left.playlist_label.localeCompare(right.playlist_label));
  const artistRows = aggregateByArtist(filteredRecords);
  const albumRows = aggregateByAlbum(filteredRecords);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    filters: {
      artist: options.artist || "",
      playlist_candidate: options.playlistCandidate || "",
      confidence_tier: options.confidenceTier || "",
      affected_users: normalizeMinimum(options.affectedUsers, 0),
      limit,
    },
    summary: {
      total_unmatched_tracks: allRecords.length,
      filtered_unmatched_tracks: filteredRecords.length,
      unique_unmatched_artists: artistRows.length,
      unique_unmatched_albums: albumRows.length,
      tracks_with_playlist_candidates: tracksWithCandidates.length,
      tracks_with_no_useful_evidence: tracksWithNoUsefulEvidence.length,
    },
    top_unmatched_tracks: filteredRecords.slice(0, limit),
    top_unmatched_artists: artistRows.slice(0, limit),
    top_unmatched_albums: albumRows.slice(0, limit),
    playlist_candidate_recommendations: recommendations.slice(0, limit),
    playlist_candidates_available: availablePlaylistCandidates,
    reason_counts: serializeCountMap(filteredRecords.reduce((map, record) => {
      increment(map, record.final_unmatched_reason);
      return map;
    }, new Map()), "reason"),
    notes: [
      "Read-only diagnostics built from cached Crate data.",
      "No approvals, rescans, playlist sends, Spotify calls, or track classification writes are performed.",
    ],
  };
}

module.exports = {
  getAdminTrackIntelligence,
};
