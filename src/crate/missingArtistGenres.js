const trackRepo = require("../repositories/tracks");
const spotifyArtists = require("../spotify/artists");
const {
  getArtistIds,
  getArtistNames,
  getGenresForTrack,
  parseRawTrack,
} = require("./trackContext");

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(parsed, 500);
}

async function getMissingArtistGenres(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const rows = trackRepo.getAllUnmatchedTracksForUser(userId);
  const artistIds = rows.flatMap((row) => getArtistIds(parseRawTrack(row.raw_json)));
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);
  const artistCounts = new Map();

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    const trackGenres = getGenresForTrack(rawTrack, artistsById);

    if (trackGenres.length > 0) {
      continue;
    }

    for (const artistName of getArtistNames(row, rawTrack)) {
      artistCounts.set(artistName, (artistCounts.get(artistName) || 0) + 1);
    }
  }

  const artists = [...artistCounts.entries()]
    .map(([artistName, unmatchedTrackCount]) => ({
      artist_name: artistName,
      unmatched_track_count: unmatchedTrackCount,
    }))
    .sort((a, b) => {
      if (b.unmatched_track_count !== a.unmatched_track_count) {
        return b.unmatched_track_count - a.unmatched_track_count;
      }

      return a.artist_name.localeCompare(b.artist_name);
    })
    .slice(0, limit);

  return {
    limit,
    count: artists.length,
    artists,
  };
}

module.exports = {
  getMissingArtistGenres,
};
