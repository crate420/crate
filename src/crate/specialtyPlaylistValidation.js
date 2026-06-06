const { openDatabase } = require("../db");
const playlistSeedRegistry = require("./playlistSeedRegistry");

const MATCH_WEIGHTS = { exact: 100, isrc: 92, fallback: 70 };

const EXPECTED_PLAYLIST_CODES = {
  yacht_rock: ["soft_rock", "classic_rock", "rock", "pop"],
  disco: ["funk_disco", "dance", "pop", "soul"],
  southern_soul: ["soul", "blues", "r_b", "funk_disco"],
  motown: ["soul", "r_b", "funk_disco", "pop"],
  funk: ["funk_disco", "soul", "r_b", "dance"],
  new_wave: ["newwave", "alternative", "rock", "pop"],
  pop_punk: ["pop_punk", "punk", "alternative", "rock"],
  broadway: ["soundtrack"],
  classic_rock: ["classic_rock", "rock", "hard_rock", "soft_rock"],
};

const SEED_GENRE_ALLOWLIST = {
  yacht_rock: ["yacht", "soft rock", "smooth", "adult contemporary", "mellow", "classic rock", "pop rock"],
  disco: ["disco", "dance", "funk", "soul", "boogie"],
  southern_soul: ["soul", "southern soul", "blues", "r&b", "rhythm and blues"],
  motown: ["motown", "soul", "r&b", "funk", "pop soul"],
  funk: ["funk", "soul", "r&b", "disco", "dance"],
  new_wave: ["new wave", "synth", "post-punk", "alternative", "permanent wave"],
  pop_punk: ["pop punk", "punk", "emo", "alternative", "skate punk"],
  broadway: ["broadway", "show tunes", "showtunes", "musical", "soundtrack", "cast recording"],
  classic_rock: ["classic rock", "album rock", "rock", "hard rock", "soft rock", "blues rock"],
};

const HARD_CONFLICTS = {
  yacht_rock: ["metal", "hip hop", "rap", "trap", "punk", "hardcore", "edm", "techno", "house"],
  disco: ["metal", "punk", "hardcore", "country", "folk", "soundtrack"],
  southern_soul: ["metal", "punk", "edm", "techno", "house", "soundtrack"],
  motown: ["metal", "punk", "edm", "techno", "house", "soundtrack"],
  funk: ["metal", "punk", "country", "folk", "soundtrack"],
  new_wave: ["country", "metal", "hip hop", "rap", "reggae", "soundtrack"],
  pop_punk: ["country", "soul", "jazz", "blues", "reggae", "soundtrack"],
  broadway: ["metal", "hip hop", "rap", "reggae", "dance", "punk"],
  classic_rock: ["hip hop", "rap", "edm", "techno", "house", "reggaeton", "soundtrack"],
};

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch (err) { return fallback; }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|with)\b.*$/i, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeArtistName(value) {
  return normalizeText(value).replace(/^the\s+/, "");
}

function normalizeTrackKey(trackName, artistNames) {
  const primaryArtist = Array.isArray(artistNames) ? artistNames[0] : String(artistNames || "").split(",")[0];
  return normalizeText(trackName) + "::" + normalizeArtistName(primaryArtist);
}

function getRawIsrc(row) {
  const raw = parseJson(row.raw_json, {});
  return raw && raw.external_ids ? raw.external_ids.isrc || null : null;
}

function getRawArtistGenres(row) {
  const raw = parseJson(row.raw_json, {});
  const artists = Array.isArray(raw && raw.artists ? raw.artists : []) ? raw.artists : [];
  return artists.flatMap((artist) => Array.isArray(artist.genres) ? artist.genres : []).filter(Boolean);
}

function getApprovedArtistGenres(artistNames) {
  if (!artistNames.length) return [];
  const db = openDatabase();
  const genres = new Set();
  const statement = db.prepare("SELECT genre FROM artist_genres WHERE lower(artist_name) = lower(?)");
  for (const artistName of artistNames) {
    for (const row of statement.all(artistName)) {
      if (row.genre) genres.add(row.genre);
    }
  }
  return [...genres].sort((a, b) => a.localeCompare(b));
}

function getUserTracks(userId) {
  const rows = openDatabase().prepare("SELECT user_tracks.track_id, user_tracks.playlist_code, tracks.spotify_track_id, tracks.name, tracks.artist_names, tracks.album_name, tracks.raw_json FROM user_tracks INNER JOIN tracks ON tracks.id = user_tracks.track_id WHERE user_tracks.user_id = ?").all(userId);
  return rows.map((row) => {
    const artistNames = parseJson(row.artist_names, []);
    return {
      ...row,
      artist_names: artistNames,
      isrc: getRawIsrc(row),
      spotify_artist_genres: getRawArtistGenres(row),
      fallback_artist_genres: getApprovedArtistGenres(artistNames),
      fallback_key: normalizeTrackKey(row.name, artistNames),
    };
  });
}

function getCachedSeedTracks(seedCode) {
  const rows = openDatabase().prepare("SELECT * FROM playlist_seed_tracks WHERE seed_code = ? ORDER BY position ASC").all(seedCode);
  return rows.map((row) => {
    const artistNames = parseJson(row.artist_names_json, []);
    return {
      ...row,
      artist_names: artistNames,
      artist_ids: parseJson(row.artist_ids_json, []),
      fallback_key: normalizeTrackKey(row.track_name, artistNames),
    };
  });
}

function buildSeedIndexes(seedTracks) {
  return {
    bySpotifyTrackId: new Map(seedTracks.map((track) => [track.spotify_track_id, track])),
    byIsrc: new Map(seedTracks.filter((track) => track.isrc).map((track) => [track.isrc, track])),
    byFallbackKey: new Map(seedTracks.map((track) => [track.fallback_key, track])),
  };
}

function findMatch(userTrack, indexes) {
  if (userTrack.spotify_track_id && indexes.bySpotifyTrackId.has(userTrack.spotify_track_id)) {
    return { match_type: "exact", seed_track: indexes.bySpotifyTrackId.get(userTrack.spotify_track_id) };
  }
  if (userTrack.isrc && indexes.byIsrc.has(userTrack.isrc)) {
    return { match_type: "isrc", seed_track: indexes.byIsrc.get(userTrack.isrc) };
  }
  if (userTrack.fallback_key && indexes.byFallbackKey.has(userTrack.fallback_key)) {
    return { match_type: "fallback", seed_track: indexes.byFallbackKey.get(userTrack.fallback_key) };
  }
  return null;
}

function hasPhrase(values, phrases) {
  const normalizedValues = values.map(normalizeText).filter(Boolean);
  return normalizedValues.some((value) => phrases.some((phrase) => value.includes(normalizeText(phrase))));
}

function buildFlags(seed, userTrack, matchType) {
  const flags = [];
  const expectedPlaylists = EXPECTED_PLAYLIST_CODES[seed.seed_code] || [seed.supports_playlist_code].filter(Boolean);
  const assignedPlaylist = userTrack.playlist_code || null;
  const genres = [...userTrack.spotify_artist_genres, ...userTrack.fallback_artist_genres];
  const hardConflicts = HARD_CONFLICTS[seed.seed_code] || [];
  const allowlist = SEED_GENRE_ALLOWLIST[seed.seed_code] || [];

  if (matchType === "fallback") {
    flags.push({ type: "weak_fallback_match", message: "Matched only by normalized track title and primary artist." });
  }

  if (assignedPlaylist && expectedPlaylists.length && !expectedPlaylists.includes(assignedPlaylist)) {
    flags.push({ type: "playlist_inconsistency", message: "Track currently belongs to an unrelated Crate playlist.", playlist_code: assignedPlaylist, expected_playlist_codes: expectedPlaylists });
  }

  if (hardConflicts.length && hasPhrase(genres, hardConflicts) && !hasPhrase(genres, allowlist)) {
    flags.push({ type: "artist_genre_conflict", message: "Artist genre evidence conflicts with the seed category.", genres });
  }

  return flags;
}

function summarizeArtists(matches) {
  const counts = new Map();
  for (const match of matches) {
    const artistName = match.artist_names[0] || "Unknown Artist";
    counts.set(artistName, (counts.get(artistName) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist))
    .slice(0, 15);
}

function scoreSeed({ matches, exactCount, isrcCount, fallbackCount, flaggedCount, playlistInconsistencyCount, artistGenreConflictCount }) {
  const overlapCount = matches.length;
  if (overlapCount === 0) {
    return { track_match_score: 0, artist_match_score: 0, playlist_consistency_score: 0, overall_confidence: 0, recommendation_status: "insufficient_data" };
  }

  const trackScore = Math.round(((exactCount * MATCH_WEIGHTS.exact) + (isrcCount * MATCH_WEIGHTS.isrc) + (fallbackCount * MATCH_WEIGHTS.fallback)) / overlapCount);
  const artistScore = Math.max(0, Math.round(100 - ((artistGenreConflictCount / overlapCount) * 100)));
  const consistencyScore = Math.max(0, Math.round(100 - ((playlistInconsistencyCount / overlapCount) * 100)));
  const overall = Math.max(0, Math.round(((trackScore * 0.45) + (artistScore * 0.25) + (consistencyScore * 0.3)) - Math.min(20, flaggedCount * 2)));

  let status = "needs_review";
  if (overall >= 90 && flaggedCount <= Math.max(2, Math.floor(overlapCount * 0.05))) {
    status = "approved_for_recommendation";
  } else if (overall < 75 || flaggedCount > Math.max(5, Math.floor(overlapCount * 0.15))) {
    status = "requires_refinement";
  }

  return { track_match_score: trackScore, artist_match_score: artistScore, playlist_consistency_score: consistencyScore, overall_confidence: overall, recommendation_status: status };
}

function validateSeed(seed, userTracks, matchLimit) {
  const seedTracks = getCachedSeedTracks(seed.seed_code);
  const indexes = buildSeedIndexes(seedTracks);
  const matches = [];
  const falsePositives = [];
  let exactCount = 0;
  let isrcCount = 0;
  let fallbackCount = 0;
  let playlistInconsistencyCount = 0;
  let artistGenreConflictCount = 0;

  for (const userTrack of userTracks) {
    const match = findMatch(userTrack, indexes);
    if (!match) continue;
    if (match.match_type === "exact") exactCount += 1;
    if (match.match_type === "isrc") isrcCount += 1;
    if (match.match_type === "fallback") fallbackCount += 1;

    const flags = buildFlags(seed, userTrack, match.match_type);
    if (flags.some((flag) => flag.type === "playlist_inconsistency")) playlistInconsistencyCount += 1;
    if (flags.some((flag) => flag.type === "artist_genre_conflict")) artistGenreConflictCount += 1;

    const record = {
      track_id: userTrack.track_id,
      spotify_track_id: userTrack.spotify_track_id,
      track: userTrack.name,
      artist: userTrack.artist_names.join(", "),
      artist_names: userTrack.artist_names,
      album: userTrack.album_name,
      current_playlist_code: userTrack.playlist_code || null,
      match_type: match.match_type,
      seed_track_name: match.seed_track.track_name,
      seed_artist_names: match.seed_track.artist_names,
      spotify_artist_genres: userTrack.spotify_artist_genres,
      approved_artist_genres: userTrack.fallback_artist_genres,
      flags,
    };

    matches.push(record);
    if (flags.length) falsePositives.push(record);
  }

  const score = scoreSeed({ matches, exactCount, isrcCount, fallbackCount, flaggedCount: falsePositives.length, playlistInconsistencyCount, artistGenreConflictCount });
  return {
    seed_code: seed.seed_code,
    playlist_id: seed.playlist_id,
    playlist_name: seed.playlist_name,
    supports_playlist_code: seed.supports_playlist_code,
    seed_track_count: seedTracks.length,
    overlap_count: matches.length,
    exact_match_count: exactCount,
    isrc_match_count: isrcCount,
    fallback_match_count: fallbackCount,
    flagged_false_positive_count: falsePositives.length,
    recommendation_status: score.recommendation_status,
    scores: score,
    top_artists: summarizeArtists(matches),
    matches: matches.slice(0, matchLimit),
    flagged_false_positives: falsePositives.slice(0, 25),
  };
}

function getSpecialtyPlaylistValidationReport(userId, { matchLimit = 50 } = {}) {
  const normalizedMatchLimit = Math.max(1, Math.min(100, Number.parseInt(matchLimit, 10) || 50));
  const seeds = playlistSeedRegistry.getActivePlaylistSeeds();
  const userTracks = getUserTracks(userId);
  const seedReports = seeds.map((seed) => validateSeed(seed, userTracks, normalizedMatchLimit));
  const summary = {
    user_id: userId,
    seed_count: seedReports.length,
    total_overlap_count: seedReports.reduce((sum, seed) => sum + seed.overlap_count, 0),
    approved_count: seedReports.filter((seed) => seed.recommendation_status === "approved_for_recommendation").length,
    needs_review_count: seedReports.filter((seed) => seed.recommendation_status === "needs_review").length,
    requires_refinement_count: seedReports.filter((seed) => seed.recommendation_status === "requires_refinement").length,
    insufficient_data_count: seedReports.filter((seed) => seed.recommendation_status === "insufficient_data").length,
  };
  return { status: "ok", generated_at: new Date().toISOString(), summary, seeds: seedReports };
}

module.exports = { getSpecialtyPlaylistValidationReport };
