const trackRepo = require("../repositories/tracks");
const spotifyArtists = require("../spotify/artists");
const { getArtistIds, getGenresForTrack, parseRawTrack } = require("./trackContext");

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(parsed, 500);
}

async function getUnmatchedGenreSummary(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const rows = trackRepo.getAllUnmatchedTracksForUser(userId);
  const artistIds = rows.flatMap((row) => getArtistIds(parseRawTrack(row.raw_json)));
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);
  const genreCounts = new Map();

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    const genres = getGenresForTrack(rawTrack, artistsById);

    for (const genre of genres) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }

  const genres = [...genreCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.genre.localeCompare(b.genre);
    })
    .slice(0, limit);

  return {
    total_unmatched_tracks: rows.length,
    total_unique_genres: genreCounts.size,
    limit,
    genres,
  };
}

module.exports = {
  getUnmatchedGenreSummary,
};
