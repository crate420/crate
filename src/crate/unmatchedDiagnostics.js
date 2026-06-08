const { openDatabase } = require("../db");
const artistGenreRepo = require("../repositories/artistGenres");
const spotifyArtists = require("../spotify/artists");
const { formatScoreDebug, scorePlaylistCode } = require("./sortRules");
const {
  getArtistIds,
  getArtistNames,
  getTrackContext,
  parseRawTrack,
} = require("./trackContext");

function normalizeLimit(value, fallback = 100, maximum = 500) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function readUnmatchedRows(userId) {
  return openDatabase().prepare(`
    SELECT
      user_tracks.user_id,
      user_tracks.track_id,
      tracks.spotify_track_id,
      tracks.uri,
      tracks.name,
      tracks.artist_names,
      tracks.album_name,
      tracks.popularity,
      tracks.explicit,
      tracks.duration_ms,
      tracks.raw_json,
      track_overrides.override_playlist_code
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id
    WHERE user_tracks.user_id = ?
      AND user_tracks.playlist_code IS NULL
      AND track_overrides.override_playlist_code IS NULL
    ORDER BY tracks.artist_names COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC
  `).all(userId);
}

function compactCandidates(candidates = []) {
  return candidates.map((candidate) => ({
    playlist_code: candidate.playlistCode,
    score: candidate.score,
    reasons: candidate.reasons || [],
  }));
}

function getUnmatchedReason(context, decision, rawTrack) {
  if (!rawTrack || !context.track?.name || context.artistNames.length === 0) {
    return "missing_track_metadata";
  }

  if (decision.playlistCode) {
    return "unknown";
  }

  if (context.spotifyGenres.length === 0 && context.fallbackGenres.length === 0) {
    return "no_artist_genres_found";
  }

  if (context.fallbackGenres.length > 0) {
    return "artist_genres_found_but_no_rule_match";
  }

  if (context.spotifyGenres.length > 0) {
    return "spotify_genres_found_but_no_rule_match";
  }

  return "no_playlist_rule_match";
}

function buildDiagnostic(row, artistsById, fallbackGenresByArtistName) {
  const rawTrack = parseRawTrack(row.raw_json);
  const context = getTrackContext(row, artistsById, fallbackGenresByArtistName, rawTrack);
  const decision = scorePlaylistCode(context);

  return {
    track_id: row.track_id,
    spotify_track_id: row.spotify_track_id,
    track_name: row.name,
    artist_names: context.artistNames,
    album_name: row.album_name,
    spotify_artist_ids: getArtistIds(rawTrack),
    spotify_artist_genres: context.spotifyGenres,
    approved_artist_genres: context.fallbackGenres,
    merged_genre_context: context.genres,
    matched_playlist_candidates: compactCandidates(decision.candidates),
    rejected_playlist_candidates: compactCandidates(decision.suppressedCandidates),
    phrase_blocked_matches: decision.phraseBlockedMatches || [],
    final_unmatched_reason: getUnmatchedReason(context, decision, rawTrack),
    score_debug: formatScoreDebug(context, decision),
  };
}

async function buildDiagnosticsForUser(userId) {
  const rows = readUnmatchedRows(userId);
  const rawTracks = rows.map((row) => parseRawTrack(row.raw_json));
  const artistIds = rawTracks.flatMap(getArtistIds);
  const artistNames = rows.flatMap((row, index) => getArtistNames(row, rawTracks[index]));
  const [artistsById, fallbackGenresByArtistName] = await Promise.all([
    spotifyArtists.getArtistsByIds(userId, artistIds),
    Promise.resolve(artistGenreRepo.findGenresByArtistNames(artistNames)),
  ]);

  return rows.map((row) => buildDiagnostic(row, artistsById, fallbackGenresByArtistName));
}

function countReasons(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.final_unmatched_reason, (counts.get(record.final_unmatched_reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function matchesSearch(record, search) {
  if (!search) return true;
  const haystack = [record.track_name, record.album_name, ...(record.artist_names || []), ...(record.merged_genre_context || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

async function getAdminUnmatchedDiagnostics(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const search = String(options.search || "").trim();
  const reason = String(options.reason || "").trim();
  const records = await buildDiagnosticsForUser(userId);
  const filtered = records.filter((record) =>
    matchesSearch(record, search) && (!reason || record.final_unmatched_reason === reason),
  );

  return {
    status: "ok",
    user_id: userId,
    total_unmatched_tracks: records.length,
    filtered_count: filtered.length,
    limit,
    offset,
    search,
    reason,
    summary_by_reason: countReasons(records),
    diagnostics: filtered.slice(offset, offset + limit),
  };
}

async function getAdminUnmatchedDiagnostic(userId, trackId) {
  const normalizedTrackId = Number.parseInt(trackId, 10);
  const records = await buildDiagnosticsForUser(userId);
  const diagnostic = records.find((record) => record.track_id === normalizedTrackId);

  if (!diagnostic) {
    const error = new Error("Unmatched track was not found for this user.");
    error.code = "unmatched_track_not_found";
    error.statusCode = 404;
    throw error;
  }

  return diagnostic;
}

async function getUnmatchedDiagnostics(userId) {
  const records = await buildDiagnosticsForUser(userId);
  const genreCounts = new Map();
  const noGenreTracks = [];

  for (const record of records) {
    for (const genre of record.spotify_artist_genres) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
    if (record.spotify_artist_genres.length === 0) noGenreTracks.push(record);
  }

  return {
    total_unmatched_tracks: records.length,
    unmatched_tracks_with_genres: records.length - noGenreTracks.length,
    unmatched_tracks_with_no_genres: noGenreTracks.length,
    top_unmatched_genres: [...genreCounts.entries()].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre)).slice(0, 50),
    sample_unmatched_tracks_with_no_genres: noGenreTracks.slice(0, 25),
  };
}

module.exports = {
  buildDiagnosticsForUser,
  getAdminUnmatchedDiagnostic,
  getAdminUnmatchedDiagnostics,
  getUnmatchedDiagnostics,
};
