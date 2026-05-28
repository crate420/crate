const unmatchedGenreLogRepo = require("../repositories/unmatchedGenreLogs");

function normalizeLimit(value, fallback = 50, maximum = 500) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function compactPlaylistAttemptContext(decision) {
  if (!decision) {
    return null;
  }

  return {
    top_candidates: (decision.candidates || []).slice(0, 3).map((candidate) => ({
      playlist_code: candidate.playlistCode,
      score: candidate.score,
      main_reason: candidate.reasons?.[0]?.reason || candidate.reasons?.[0]?.matched || null,
    })),
    suppressed_candidates: (decision.suppressedCandidates || []).slice(0, 3).map((candidate) => ({
      playlist_code: candidate.playlistCode,
      score: candidate.score,
    })),
    phrase_blocked_matches: decision.phraseBlockedMatches || [],
  };
}

function logUnmatchedTrackGenres(userId, context, decision) {
  const genres = [...new Set(context?.genres || [])].map((genre) => String(genre || "").trim()).filter(Boolean);
  const artistNames = [...new Set(context?.artistNames || [])].map((name) => String(name || "").trim()).filter(Boolean);

  if (genres.length === 0 || artistNames.length === 0) {
    return { attempted: 0, logged: 0 };
  }

  const playlistAttemptContext = compactPlaylistAttemptContext(decision);
  let attempted = 0;
  let logged = 0;

  for (const genre of genres) {
    for (const artistName of artistNames) {
      attempted += 1;
      const result = unmatchedGenreLogRepo.logUnmatchedGenre({
        userId,
        genre,
        artistName,
        trackName: context.track?.name || null,
        spotifyTrackId: context.track?.spotifyTrackId || null,
        playlistAttemptContext,
      });

      if (result.logged) {
        logged += 1;
      }
    }
  }

  return { attempted, logged };
}

function getUnmatchedGenreLearningSummary(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const recentLimit = normalizeLimit(options.recentLimit || options.recent_limit, 100);

  return {
    status: "ok",
    user_id: userId,
    most_common_genres: unmatchedGenreLogRepo.getMostCommonUnmatchedGenres(userId, { limit }),
    unmatched_artists: unmatchedGenreLogRepo.getMostCommonUnmatchedArtists(userId, { limit }),
    recent_unmatched_items: unmatchedGenreLogRepo.getRecentUnmatchedGenreLogs(userId, { limit: recentLimit }).map((row) => ({
      ...row,
      playlist_attempt_context: parseContext(row.playlist_attempt_context),
    })),
  };
}

function parseContext(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

module.exports = {
  getUnmatchedGenreLearningSummary,
  logUnmatchedTrackGenres,
};
