const { openDatabase } = require("../db");
const { normalizeArtistName } = require("../repositories/artistGenres");
const trackIntelligenceRepo = require("../repositories/trackIntelligence");
const { eraForYear, releaseYearFromDate } = require("./eraYears");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { getArtistIds, getArtistNames, parseRawTrack } = require("./trackContext");

const PLAYLISTS = new Map(ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [definition.playlistCode, definition]));
const MAX_PROFILE_TERMS = 20;
const MAX_ROWS = 500;

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

function normalizeLimit(value, fallback = 100, maximum = MAX_ROWS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function addWeighted(map, key, weight = 1) {
  const normalized = normalizeSignal(key);
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + weight);
}

function addWeightedMany(map, values, weight = 1) {
  for (const value of values || []) addWeighted(map, value, weight);
}

function mapToTopItems(map, totalTracks, limit = MAX_PROFILE_TERMS) {
  return [...map.entries()]
    .map(([name, weight]) => ({
      name,
      weight: Math.round(weight * 100) / 100,
      prevalence: totalTracks ? Math.round((weight / totalTracks) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function sourceSplit(sourceName, signals) {
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
  if (sourceName === "lastfm") return { spotifyGenres: [], lastfmTags: normalized, musicbrainzTags: [] };
  if (sourceName === "musicbrainz") {
    return {
      spotifyGenres: [],
      lastfmTags: [],
      musicbrainzTags: normalized
        .filter((signal) => signal.startsWith("tag:") || !signal.includes(":"))
        .map((signal) => signal.replace(/^tag:/, "")),
    };
  }
  return { spotifyGenres: [], lastfmTags: [], musicbrainzTags: [] };
}

function readArtistGenreCache(db) {
  const approvedByArtist = new Map();
  if (tableExists(db, "artist_genres")) {
    const rows = db.prepare("SELECT artist_name, genre FROM artist_genres ORDER BY artist_name").all();
    for (const row of rows) {
      const key = normalizeArtistName(row.artist_name);
      const list = approvedByArtist.get(key) || [];
      list.push(row.genre);
      approvedByArtist.set(key, list);
    }
  }

  const intelligenceByName = new Map();
  const intelligenceBySpotifyId = new Map();
  if (tableExists(db, "artist_intelligence") && tableExists(db, "artist_intelligence_sources")) {
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
      ORDER BY artist_intelligence.normalized_artist_name
    `).all();

    for (const row of rows) {
      const key = row.normalized_artist_name;
      if (!key) continue;
      const entry = intelligenceByName.get(key) || {
        artist_name: row.display_artist_name,
        spotify_artist_id: row.spotify_artist_id,
        confidence_score: row.confidence_score || 0,
        spotifyGenres: new Set(),
        lastfmTags: new Set(),
        musicbrainzTags: new Set(),
      };
      if (row.source && !row.error_code) {
        const split = sourceSplit(row.source, parseJson(row.normalized_signals_json, []));
        split.spotifyGenres.forEach((value) => entry.spotifyGenres.add(value));
        split.lastfmTags.forEach((value) => entry.lastfmTags.add(value));
        split.musicbrainzTags.forEach((value) => entry.musicbrainzTags.add(value));
      }
      intelligenceByName.set(key, entry);
      if (entry.spotify_artist_id) intelligenceBySpotifyId.set(entry.spotify_artist_id, entry);
    }
  }

  return { approvedByArtist, intelligenceByName, intelligenceBySpotifyId };
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
      lastfmTrackTags: new Set(),
      lastfmTrackMetadata: {},
    };
    if (row.source === "lastfm" && !row.error_code) {
      parseJson(row.normalized_signals_json, []).map(normalizeSignal).filter(Boolean).forEach((value) => entry.lastfmTrackTags.add(value));
      entry.lastfmTrackMetadata = parseJson(row.metadata_json, {});
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

function getTrackCacheForRow(row, rawTrack, artistName, trackCache) {
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

function releaseYear(row, rawTrack) {
  const manualYear = Number.parseInt(row.effective_release_year, 10);
  if (Number.isInteger(manualYear)) return manualYear;
  return releaseYearFromDate(rawTrack?.album?.release_date);
}

function albumType(albumName) {
  const normalized = normalizeSignal(albumName);
  if (!normalized) return null;
  if (normalized.includes("soundtrack") || normalized.includes("original cast") || normalized.includes("motion picture")) return "soundtrack_album";
  if (normalized.includes("live")) return "live_album";
  if (normalized.includes("remaster") || normalized.includes("anniversary") || normalized.includes("deluxe")) return "edition_release";
  if (normalized.includes("single")) return "single_release";
  return "standard_album";
}

function popularityBucket(value) {
  const popularity = Number.parseInt(value, 10);
  if (!Number.isInteger(popularity)) return null;
  if (popularity >= 75) return "popularity_high";
  if (popularity >= 45) return "popularity_mid";
  return "popularity_low";
}

function evidenceForRow(row, caches) {
  const rawTrack = parseRawTrack(row.raw_json);
  const artistNames = getArtistNames(row, rawTrack);
  const artistIds = getArtistIds(rawTrack);
  const primaryArtistName = artistNames[0] || "Unknown Artist";
  const year = releaseYear(row, rawTrack);
  const era = eraForYear(year);
  const trackCache = getTrackCacheForRow(row, rawTrack, primaryArtistName, caches.trackCache);
  const approvedArtistGenres = new Set();
  const spotifyArtistGenres = new Set();
  const lastfmArtistTags = new Set();
  const musicbrainzTags = new Set();

  for (const artistName of artistNames) {
    const normalized = normalizeArtistName(artistName);
    (caches.approvedByArtist.get(normalized) || []).forEach((value) => approvedArtistGenres.add(normalizeSignal(value)));
    const cached = caches.intelligenceByName.get(normalized);
    if (cached) {
      cached.spotifyGenres.forEach((value) => spotifyArtistGenres.add(value));
      cached.lastfmTags.forEach((value) => lastfmArtistTags.add(value));
      cached.musicbrainzTags.forEach((value) => musicbrainzTags.add(value));
    }
  }

  for (const artistId of artistIds) {
    const cached = caches.intelligenceBySpotifyId.get(artistId);
    if (!cached) continue;
    cached.spotifyGenres.forEach((value) => spotifyArtistGenres.add(value));
    cached.lastfmTags.forEach((value) => lastfmArtistTags.add(value));
    cached.musicbrainzTags.forEach((value) => musicbrainzTags.add(value));
  }

  const lastfmTrackTags = new Set(trackCache ? [...trackCache.lastfmTrackTags] : []);
  const type = albumType(row.album_name);
  const pop = popularityBucket(row.popularity);
  const explicitToken = row.explicit ? "explicit_true" : "explicit_false";
  const specialtySignals = new Set();
  if (String(row.effective_playlist_code || row.playlist_code || "").startsWith("specialty_")) {
    specialtySignals.add(String(row.effective_playlist_code || row.playlist_code));
  }

  const allSignals = new Map();
  addWeightedMany(allSignals, approvedArtistGenres, 3.5);
  addWeightedMany(allSignals, spotifyArtistGenres, 3);
  addWeightedMany(allSignals, lastfmArtistTags, 1.8);
  addWeightedMany(allSignals, lastfmTrackTags, 3.2);
  addWeightedMany(allSignals, musicbrainzTags, 1.4);
  if (era) addWeighted(allSignals, `era:${era}`, 1.2);
  if (year) addWeighted(allSignals, `year:${year}`, 0.4);
  if (type) addWeighted(allSignals, `album:${type}`, 0.8);
  if (pop) addWeighted(allSignals, pop, 0.7);
  addWeighted(allSignals, explicitToken, 0.5);
  addWeightedMany(allSignals, specialtySignals, 2.5);

  return {
    track_id: row.track_id,
    spotify_track_id: row.spotify_track_id,
    track_name: row.name,
    artist: artistNames.join(", "),
    artist_names: artistNames,
    album_name: row.album_name,
    release_year: year,
    era,
    playlist_code: row.effective_playlist_code || row.playlist_code || null,
    playlist_label: PLAYLISTS.get(row.effective_playlist_code || row.playlist_code)?.shortLabel || row.effective_playlist_code || row.playlist_code || null,
    approved_artist_genres: [...approvedArtistGenres].sort(),
    spotify_artist_genres: [...spotifyArtistGenres].sort(),
    lastfm_artist_tags: [...lastfmArtistTags].sort(),
    lastfm_track_tags: [...lastfmTrackTags].sort(),
    musicbrainz_tags: [...musicbrainzTags].sort(),
    specialty_signals: [...specialtySignals].sort(),
    popularity: row.popularity,
    explicit: Boolean(row.explicit),
    album_type: type,
    track_intelligence_source_count: trackCache?.source_count || 0,
    track_intelligence_confidence: trackCache?.confidence_score || 0,
    signals: allSignals,
  };
}

function readAssignedRows(db) {
  return db.prepare(`
    SELECT
      user_tracks.user_id,
      user_tracks.track_id,
      COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS effective_playlist_code,
      user_tracks.playlist_code,
      tracks.spotify_track_id,
      tracks.name,
      tracks.artist_names,
      tracks.album_name,
      tracks.popularity,
      tracks.explicit,
      tracks.raw_json,
      track_era_overrides.effective_release_year
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    LEFT JOIN track_era_overrides ON track_era_overrides.track_id = tracks.id
    WHERE COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) IS NOT NULL
    ORDER BY effective_playlist_code COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC
  `).all();
}

function readUnmatchedRows(db) {
  return db.prepare(`
    SELECT
      user_tracks.user_id,
      user_tracks.track_id,
      NULL AS effective_playlist_code,
      user_tracks.playlist_code,
      tracks.spotify_track_id,
      tracks.name,
      tracks.artist_names,
      tracks.album_name,
      tracks.popularity,
      tracks.explicit,
      tracks.raw_json,
      track_era_overrides.effective_release_year
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    LEFT JOIN track_era_overrides ON track_era_overrides.track_id = tracks.id
    WHERE user_tracks.playlist_code IS NULL
      AND track_overrides.override_playlist_code IS NULL
    ORDER BY tracks.name COLLATE NOCASE ASC
  `).all();
}

function buildProfile(playlistCode, evidences) {
  const profile = {
    playlist_code: playlistCode,
    playlist_label: PLAYLISTS.get(playlistCode)?.shortLabel || playlistCode,
    category: PLAYLISTS.get(playlistCode)?.category || "unknown",
    track_count: evidences.length,
    tokenCounts: new Map(),
    approvedArtistGenreCounts: new Map(),
    spotifyArtistGenreCounts: new Map(),
    lastfmArtistTagCounts: new Map(),
    lastfmTrackTagCounts: new Map(),
    musicbrainzTagCounts: new Map(),
    eraCounts: new Map(),
    albumTypeCounts: new Map(),
    popularityCounts: new Map(),
    explicitCounts: new Map(),
    specialtySignalCounts: new Map(),
  };

  for (const evidence of evidences) {
    for (const [token, weight] of evidence.signals.entries()) addWeighted(profile.tokenCounts, token, weight);
    addWeightedMany(profile.approvedArtistGenreCounts, evidence.approved_artist_genres);
    addWeightedMany(profile.spotifyArtistGenreCounts, evidence.spotify_artist_genres);
    addWeightedMany(profile.lastfmArtistTagCounts, evidence.lastfm_artist_tags);
    addWeightedMany(profile.lastfmTrackTagCounts, evidence.lastfm_track_tags);
    addWeightedMany(profile.musicbrainzTagCounts, evidence.musicbrainz_tags);
    if (evidence.era) addWeighted(profile.eraCounts, evidence.era);
    if (evidence.album_type) addWeighted(profile.albumTypeCounts, evidence.album_type);
    const pop = popularityBucket(evidence.popularity);
    if (pop) addWeighted(profile.popularityCounts, pop);
    addWeighted(profile.explicitCounts, evidence.explicit ? "explicit_true" : "explicit_false");
    addWeightedMany(profile.specialtySignalCounts, evidence.specialty_signals);
  }

  return profile;
}

function serializeProfile(profile) {
  return {
    playlist_code: profile.playlist_code,
    playlist_label: profile.playlist_label,
    category: profile.category,
    track_count: profile.track_count,
    top_signals: mapToTopItems(profile.tokenCounts, profile.track_count),
    approved_artist_genres: mapToTopItems(profile.approvedArtistGenreCounts, profile.track_count, 12),
    spotify_artist_genres: mapToTopItems(profile.spotifyArtistGenreCounts, profile.track_count, 12),
    lastfm_artist_tags: mapToTopItems(profile.lastfmArtistTagCounts, profile.track_count, 12),
    lastfm_track_tags: mapToTopItems(profile.lastfmTrackTagCounts, profile.track_count, 12),
    musicbrainz_tags: mapToTopItems(profile.musicbrainzTagCounts, profile.track_count, 12),
    eras: mapToTopItems(profile.eraCounts, profile.track_count, 6),
    album_types: mapToTopItems(profile.albumTypeCounts, profile.track_count, 6),
    popularity: mapToTopItems(profile.popularityCounts, profile.track_count, 6),
    explicit: mapToTopItems(profile.explicitCounts, profile.track_count, 3),
    specialty_signals: mapToTopItems(profile.specialtySignalCounts, profile.track_count, 8),
  };
}


function isMetadataSignal(signal) {
  return signal.startsWith("era ") ||
    signal.startsWith("year ") ||
    signal.startsWith("album ") ||
    signal.startsWith("popularity ") ||
    signal.startsWith("explicit ");
}

function profileScore(evidence, profile, excludeSelf = false) {
  const profileTrackCount = Math.max(1, profile.track_count - (excludeSelf ? 1 : 0));
  const supporting = [];
  const conflicting = [];
  let specificSupport = 0;
  let metadataSupport = 0;
  let specificWeight = 0;
  let metadataWeight = 0;

  for (const [token, weight] of evidence.signals.entries()) {
    const metadata = isMetadataSignal(token);
    if (metadata) metadataWeight += weight;
    else specificWeight += weight;

    const profileWeight = Math.max(0, (profile.tokenCounts.get(token) || 0) - (excludeSelf ? weight : 0));
    if (profileWeight > 0) {
      const prevalence = profileWeight / profileTrackCount;
      const support = weight * Math.min(1.5, prevalence);
      if (metadata) metadataSupport += support;
      else specificSupport += support;
      supporting.push({ signal: token, track_weight: Math.round(weight * 100) / 100, profile_weight: Math.round(profileWeight * 100) / 100, prevalence: Math.round(prevalence * 1000) / 10, metadata });
    } else if (!metadata && weight >= 1.5) {
      conflicting.push({ signal: token, track_weight: Math.round(weight * 100) / 100, reason: "not common in playlist DNA" });
    }
  }

  const specificScore = specificWeight ? (specificSupport / Math.max(1, specificWeight)) * 85 : 0;
  const metadataScore = metadataWeight ? (metadataSupport / Math.max(1, metadataWeight)) * 15 : 0;
  const evidenceBonus = supporting.filter((item) => !item.metadata).length >= 3 ? 8 : supporting.filter((item) => !item.metadata).length >= 2 ? 4 : 0;
  const cap = specificWeight > 0 ? 99 : 35;
  const score = Math.max(0, Math.min(cap, Math.round(specificScore + metadataScore + evidenceBonus)));

  return {
    playlist_code: profile.playlist_code,
    playlist_label: profile.playlist_label,
    similarity_score: score,
    confidence: score >= 90 ? "high" : score >= 75 ? "medium" : score >= 55 ? "low" : "weak",
    supporting_evidence: supporting.sort((a, b) => Number(a.metadata) - Number(b.metadata) || b.prevalence - a.prevalence || b.track_weight - a.track_weight).slice(0, 10),
    conflicting_evidence: conflicting.slice(0, 8),
  };
}

function buildProfiles(assignedEvidence) {
  const byPlaylist = new Map();
  for (const evidence of assignedEvidence) {
    const list = byPlaylist.get(evidence.playlist_code) || [];
    list.push(evidence);
    byPlaylist.set(evidence.playlist_code, list);
  }
  return [...byPlaylist.entries()]
    .map(([playlistCode, evidences]) => buildProfile(playlistCode, evidences))
    .filter((profile) => profile.track_count >= 3)
    .sort((a, b) => a.playlist_label.localeCompare(b.playlist_label));
}

function topMatchesForEvidence(evidence, profiles, targetPlaylistCode = null) {
  return profiles
    .map((profile) => profileScore(evidence, profile, profile.playlist_code === targetPlaylistCode))
    .sort((a, b) => b.similarity_score - a.similarity_score || a.playlist_label.localeCompare(b.playlist_label))
    .slice(0, 5);
}

function validateProfiles(assignedEvidence, profiles) {
  const byPlaylist = new Map();
  const confusion = new Map();
  let correct = 0;
  let tested = 0;

  for (const evidence of assignedEvidence) {
    if (!evidence.playlist_code) continue;
    const targetProfile = profiles.find((profile) => profile.playlist_code === evidence.playlist_code);
    if (!targetProfile || targetProfile.track_count < 4) continue;
    const matches = topMatchesForEvidence(evidence, profiles, evidence.playlist_code);
    const winner = matches[0];
    const isCorrect = winner?.playlist_code === evidence.playlist_code;
    tested += 1;
    if (isCorrect) correct += 1;

    const row = byPlaylist.get(evidence.playlist_code) || {
      playlist_code: evidence.playlist_code,
      playlist_label: evidence.playlist_label,
      tested_tracks: 0,
      correct_tracks: 0,
      false_negatives: 0,
      false_positives: 0,
      confused_with: new Map(),
      sample_misses: [],
    };
    row.tested_tracks += 1;
    if (isCorrect) row.correct_tracks += 1;
    else {
      row.false_negatives += 1;
      row.confused_with.set(winner?.playlist_code || "none", (row.confused_with.get(winner?.playlist_code || "none") || 0) + 1);
      if (row.sample_misses.length < 6) row.sample_misses.push({ track_name: evidence.track_name, artist: evidence.artist, predicted_playlist: winner?.playlist_label || "None", score: winner?.similarity_score || 0 });
    }
    byPlaylist.set(evidence.playlist_code, row);

    const key = `${evidence.playlist_code}=>${winner?.playlist_code || "none"}`;
    confusion.set(key, {
      actual_playlist_code: evidence.playlist_code,
      actual_playlist_label: evidence.playlist_label,
      predicted_playlist_code: winner?.playlist_code || null,
      predicted_playlist_label: winner?.playlist_label || "None",
      count: (confusion.get(key)?.count || 0) + 1,
    });
  }

  const playlistRows = [...byPlaylist.values()].map((row) => ({
    ...row,
    accuracy: row.tested_tracks ? Math.round((row.correct_tracks / row.tested_tracks) * 1000) / 10 : 0,
    precision: row.tested_tracks ? Math.round((row.correct_tracks / row.tested_tracks) * 1000) / 10 : 0,
    recall: row.tested_tracks ? Math.round((row.correct_tracks / row.tested_tracks) * 1000) / 10 : 0,
    confused_playlists: [...row.confused_with.entries()].map(([playlistCode, count]) => ({ playlist_code: playlistCode, playlist_label: PLAYLISTS.get(playlistCode)?.shortLabel || playlistCode, count })).sort((a, b) => b.count - a.count),
  })).sort((a, b) => b.tested_tracks - a.tested_tracks || a.playlist_label.localeCompare(b.playlist_label));

  return {
    overall_accuracy: tested ? Math.round((correct / tested) * 1000) / 10 : 0,
    tracks_tested: tested,
    correct_tracks: correct,
    playlist_results: playlistRows,
    top_performing_playlists: playlistRows.filter((row) => row.tested_tracks >= 5).sort((a, b) => b.accuracy - a.accuracy || b.tested_tracks - a.tested_tracks).slice(0, 10),
    weakest_playlists: playlistRows.filter((row) => row.tested_tracks >= 5).sort((a, b) => a.accuracy - b.accuracy || b.tested_tracks - a.tested_tracks).slice(0, 10),
    confusion_matrix: [...confusion.values()].sort((a, b) => b.count - a.count).slice(0, 50),
  };
}

function unmatchedMatches(unmatchedEvidence, profiles) {
  return unmatchedEvidence.map((evidence) => {
    const matches = topMatchesForEvidence(evidence, profiles);
    return {
      track_id: evidence.track_id,
      track_name: evidence.track_name,
      artist: evidence.artist,
      album_name: evidence.album_name,
      release_year: evidence.release_year,
      evidence_summary: {
        approved_artist_genres: evidence.approved_artist_genres,
        spotify_artist_genres: evidence.spotify_artist_genres,
        lastfm_artist_tags: evidence.lastfm_artist_tags.slice(0, 12),
        lastfm_track_tags: evidence.lastfm_track_tags.slice(0, 12),
        musicbrainz_tags: evidence.musicbrainz_tags.slice(0, 12),
      },
      top_playlist_dna_matches: matches.slice(0, 3),
      best_match_score: matches[0]?.similarity_score || 0,
      best_match_confidence: matches[0]?.confidence || "none",
    };
  }).sort((a, b) => b.best_match_score - a.best_match_score || a.track_name.localeCompare(b.track_name));
}

function findConflicts(unmatchedRows) {
  return unmatchedRows
    .filter((row) => row.top_playlist_dna_matches.length >= 2)
    .map((row) => {
      const [first, second] = row.top_playlist_dna_matches;
      return {
        track_name: row.track_name,
        artist: row.artist,
        top_playlist: first.playlist_label,
        top_score: first.similarity_score,
        second_playlist: second.playlist_label,
        second_score: second.similarity_score,
        score_gap: first.similarity_score - second.similarity_score,
        artist_signals: [...row.evidence_summary.approved_artist_genres, ...row.evidence_summary.spotify_artist_genres, ...row.evidence_summary.lastfm_artist_tags].slice(0, 12),
        track_signals: row.evidence_summary.lastfm_track_tags,
      };
    })
    .filter((row) => row.top_score >= 45 && row.score_gap <= 15)
    .sort((a, b) => b.top_score - a.top_score || a.score_gap - b.score_gap)
    .slice(0, 25);
}

function getAdminPlaylistDnaValidation(options = {}) {
  const db = openDatabase();
  const limit = normalizeLimit(options.limit, 100, 500);
  const caches = { ...readArtistGenreCache(db), trackCache: readTrackCache(db) };
  const assignedEvidence = readAssignedRows(db).map((row) => evidenceForRow(row, caches));
  const unmatchedEvidence = readUnmatchedRows(db).map((row) => evidenceForRow(row, caches));
  const profiles = buildProfiles(assignedEvidence);
  const validation = validateProfiles(assignedEvidence, profiles);
  const unmatched = unmatchedMatches(unmatchedEvidence, profiles);
  const strongUnmatched = unmatched.filter((row) => row.best_match_score >= 65).slice(0, limit);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    summary: {
      playlist_dna_profiles_generated: profiles.length,
      assigned_tracks_analyzed: assignedEvidence.length,
      unmatched_tracks_analyzed: unmatchedEvidence.length,
      overall_validation_accuracy: validation.overall_accuracy,
      tracks_tested: validation.tracks_tested,
      strong_unmatched_dna_matches: strongUnmatched.length,
      conflict_count: findConflicts(unmatched).length,
    },
    playlist_dna_profiles: profiles.map(serializeProfile),
    validation,
    strong_unmatched_dna_matches: strongUnmatched,
    unmatched_dna_matches: unmatched.slice(0, limit),
    artist_track_dna_conflicts: findConflicts(unmatched),
    notes: [
      "Read-only Playlist DNA validation. No sorting rules, assignments, approvals, rescans, overrides, or Spotify writes are performed.",
      "Self-test hides known assignments in memory by subtracting each test track from its assigned playlist profile before scoring.",
    ],
  };
}

module.exports = {
  getAdminPlaylistDnaValidation,
};
