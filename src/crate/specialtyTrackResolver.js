const { openDatabase } = require("../db");
const curatedSeedRepo = require("../repositories/curatedPlaylistSeeds");
const playlistSeedCacheRepo = require("../repositories/playlistSeedCache");
const playlistSeedRegistry = require("./playlistSeedRegistry");
const { normalizeText } = require("./curatedSeedImport");


const SPECIALTY_SEED_PLAYLIST_CODES = {
  beach_vibes: "specialty_beach_vibes",
  disco: "specialty_disco",
  motown: "specialty_motown",
  new_wave: "specialty_new_wave",
  pop_punk: "specialty_pop_punk",
  southern_soul: "specialty_southern_soul",
  yacht_rock: "specialty_yacht_rock",
};

function specialtyPlaylistCodeForSeed(seedCode) {
  return SPECIALTY_SEED_PLAYLIST_CODES[String(seedCode || "").trim()] || null;
}

function seedCodeForSpecialtyPlaylistCode(playlistCode) {
  const normalized = String(playlistCode || "").trim();
  for (const [seedCode, candidatePlaylistCode] of Object.entries(SPECIALTY_SEED_PLAYLIST_CODES)) {
    if (candidatePlaylistCode === normalized) return seedCode;
  }
  return null;
}

const MATCH_TYPES = {
  spotify_exact: { label: "exact Spotify track ID", confidence: 100 },
  isrc: { label: "ISRC seed match", confidence: 96 },
  curated_artist_title: { label: "curated seed artist/title match", confidence: 88 },
  spotify_artist_title: { label: "Spotify seed artist/title match", confidence: 82 },
  crate_playlist_support: { label: "strong Crate playlist support", confidence: 76 },
};

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeArtist(value) {
  return normalizeText(value).replace(/^the\s+/, "");
}

function normalizedTrackKey(trackName, artistName) {
  return normalizeText(trackName) + "::" + normalizeArtist(artistName);
}

function getPrimaryArtist(artistNames) {
  return Array.isArray(artistNames) ? artistNames[0] || "" : "";
}

function getUserTracks(userId) {
  return openDatabase().prepare(`
    SELECT
      user_tracks.track_id,
      COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS current_playlist_code,
      tracks.spotify_track_id,
      tracks.uri,
      tracks.name,
      tracks.artist_names,
      tracks.album_name,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    WHERE user_tracks.user_id = ?
      AND tracks.uri IS NOT NULL
    ORDER BY tracks.artist_names COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC
  `).all(userId).map((row) => {
    const artistNames = parseJson(row.artist_names, []);
    const raw = parseJson(row.raw_json, {});
    const primaryArtist = getPrimaryArtist(artistNames);
    return {
      track_id: row.track_id,
      spotify_track_id: row.spotify_track_id,
      spotify_uri: row.uri,
      track_name: row.name,
      artist_name: primaryArtist,
      artist_names: artistNames,
      album_name: row.album_name,
      current_crate_playlist: row.current_playlist_code || null,
      isrc: raw?.external_ids?.isrc || null,
      key: normalizedTrackKey(row.name, primaryArtist),
      artist_key: normalizeArtist(primaryArtist),
    };
  });
}

function buildSeedEvidence(seedCode) {
  const spotifyTracks = playlistSeedCacheRepo.getCachedSeedTracks(seedCode, { limit: 5000 });
  const curatedTracks = curatedSeedRepo.listCuratedSeedTracks(seedCode);
  const spotifyByTrackId = new Map();
  const isrc = new Map();
  const spotifyKeys = new Map();
  const curatedByTrackId = new Map();
  const curatedKeys = new Map();
  const seedArtists = new Set();

  for (const track of spotifyTracks) {
    if (track.spotify_track_id) spotifyByTrackId.set(track.spotify_track_id, track);
    if (track.isrc) isrc.set(track.isrc, track);
    const primaryArtist = getPrimaryArtist(track.artist_names);
    if (primaryArtist) seedArtists.add(normalizeArtist(primaryArtist));
    spotifyKeys.set(normalizedTrackKey(track.track_name, primaryArtist), track);
  }

  for (const track of curatedTracks) {
    if (track.spotify_track_id) curatedByTrackId.set(track.spotify_track_id, track);
    if (track.artist_name) seedArtists.add(normalizeArtist(track.artist_name));
    curatedKeys.set(track.normalized_track + "::" + track.normalized_artist, track);
  }

  return {
    spotifyByTrackId,
    curatedByTrackId,
    isrc,
    spotifyKeys,
    curatedKeys,
    seedArtists,
    spotify_seed_track_count: spotifyTracks.length,
    curated_seed_track_count: curatedTracks.length,
  };
}

function pickBestMatch(userTrack, seed, evidence) {
  if (userTrack.spotify_track_id && evidence.spotifyByTrackId.has(userTrack.spotify_track_id)) {
    return { match_source: "spotify_exact", seed_track: evidence.spotifyByTrackId.get(userTrack.spotify_track_id) };
  }
  if (userTrack.spotify_track_id && evidence.curatedByTrackId.has(userTrack.spotify_track_id)) {
    return { match_source: "spotify_exact", seed_track: evidence.curatedByTrackId.get(userTrack.spotify_track_id) };
  }
  if (userTrack.isrc && evidence.isrc.has(userTrack.isrc)) {
    return { match_source: "isrc", seed_track: evidence.isrc.get(userTrack.isrc) };
  }
  if (evidence.curatedKeys.has(userTrack.key)) {
    return { match_source: "curated_artist_title", seed_track: evidence.curatedKeys.get(userTrack.key) };
  }
  if (evidence.spotifyKeys.has(userTrack.key)) {
    return { match_source: "spotify_artist_title", seed_track: evidence.spotifyKeys.get(userTrack.key) };
  }
  return null;
}

function emptySummary(seedCode) {
  return {
    seed_code: seedCode,
    total_resolved_tracks: 0,
    exact_matches: 0,
    isrc_matches: 0,
    curated_matches: 0,
    normalized_matches: 0,
    crate_playlist_support_matches: 0,
    excluded_weak_matches: 0,
    duplicate_tracks: 0,
    missing_spotify_uri: 0,
    confidence_average: 0,
  };
}

function summarizeResolvedTracks(seedCode, tracks, excluded = {}) {
  const summary = emptySummary(seedCode);
  summary.total_resolved_tracks = tracks.length;
  summary.duplicate_tracks = excluded.duplicate_tracks || 0;
  summary.missing_spotify_uri = excluded.missing_spotify_uri || 0;
  summary.excluded_weak_matches = excluded.excluded_weak_matches || 0;

  let confidenceTotal = 0;
  for (const track of tracks) {
    confidenceTotal += Number(track.confidence || 0);
    if (track.match_source === "spotify_exact") summary.exact_matches += 1;
    else if (track.match_source === "isrc") summary.isrc_matches += 1;
    else if (track.match_source === "curated_artist_title") summary.curated_matches += 1;
    else if (track.match_source === "spotify_artist_title") summary.normalized_matches += 1;
    else if (track.match_source === "crate_playlist_support") summary.crate_playlist_support_matches += 1;
  }
  summary.confidence_average = tracks.length ? Math.round(confidenceTotal / tracks.length) : 0;
  return summary;
}

function resolveSpecialtyTracksForUser(userId, seedCode, { limit = 500 } = {}) {
  const seed = playlistSeedRegistry.findPlaylistSeedByCode(seedCode);
  if (!seed || seed.active === false) {
    const error = new Error("Unknown or inactive specialty seed.");
    error.code = "specialty_seed_not_found";
    error.statusCode = 404;
    throw error;
  }

  const evidence = buildSeedEvidence(seed.seed_code);
  const userTracks = getUserTracks(userId);
  const seen = new Set();
  const excluded = { duplicate_tracks: 0, missing_spotify_uri: 0, excluded_weak_matches: 0 };
  const resolved = [];

  for (const userTrack of userTracks) {
    if (!userTrack.spotify_uri) {
      excluded.missing_spotify_uri += 1;
      continue;
    }
    const dedupeKey = userTrack.spotify_track_id || userTrack.spotify_uri;
    if (seen.has(dedupeKey)) {
      excluded.duplicate_tracks += 1;
      continue;
    }

    const match = pickBestMatch(userTrack, seed, evidence);
    if (!match) continue;

    const meta = MATCH_TYPES[match.match_source];
    seen.add(dedupeKey);
    resolved.push({
      track_id: userTrack.track_id,
      spotify_track_id: userTrack.spotify_track_id,
      spotify_uri: userTrack.spotify_uri,
      track_name: userTrack.track_name,
      artist_name: userTrack.artist_name,
      album_name: userTrack.album_name,
      current_crate_playlist: userTrack.current_crate_playlist,
      match_source: match.match_source,
      confidence: meta.confidence,
      seed_code: seed.seed_code,
      reason: `${meta.label} for ${seed.playlist_name}.`,
    });
  }

  resolved.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return String(left.artist_name + left.track_name).localeCompare(String(right.artist_name + right.track_name));
  });

  return {
    status: "ok",
    seed_code: seed.seed_code,
    playlist_code: specialtyPlaylistCodeForSeed(seed.seed_code),
    display_name: seed.playlist_name,
    source_type: seed.source_type || "spotify",
    supported_playlist_code: seed.supports_playlist_code || null,
    spotify_seed_track_count: evidence.spotify_seed_track_count,
    curated_seed_track_count: evidence.curated_seed_track_count,
    summary: summarizeResolvedTracks(seed.seed_code, resolved, excluded),
    tracks: resolved.slice(0, Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 500)),
  };
}

function getSpecialtyTrackPreviewSummariesForUser(userId, seedCodes) {
  return Object.fromEntries((seedCodes || []).map((seedCode) => {
    try {
      const preview = resolveSpecialtyTracksForUser(userId, seedCode, { limit: 0 });
      return [seedCode, preview.summary];
    } catch (err) {
      return [seedCode, { ...emptySummary(seedCode), error: err.code || "preview_error" }];
    }
  }));
}

module.exports = {
  MATCH_TYPES,
  SPECIALTY_SEED_PLAYLIST_CODES,
  getSpecialtyTrackPreviewSummariesForUser,
  resolveSpecialtyTracksForUser,
  seedCodeForSpecialtyPlaylistCode,
  specialtyPlaylistCodeForSeed,
};
