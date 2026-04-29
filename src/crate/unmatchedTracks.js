const trackRepo = require("../repositories/tracks");
const spotifyArtists = require("../spotify/artists");
const {
  getArtistIds,
  getArtistNames,
  getGenresForTrack,
  getReleaseDate,
  parseRawTrack,
} = require("./trackContext");

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(parsed, 500);
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

async function getUnmatchedTracks(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const rows = trackRepo.getUnmatchedTracksForUser(userId, { limit, offset });
  const artistIds = rows.flatMap((row) => getArtistIds(parseRawTrack(row.raw_json)));
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);

  return {
    limit,
    offset,
    count: rows.length,
    tracks: rows.map((row) => {
      const rawTrack = parseRawTrack(row.raw_json);

      return {
        track_id: row.track_id,
        spotify_track_id: row.spotify_track_id,
        title: row.name,
        artist_names: getArtistNames(row, rawTrack),
        album_name: row.album_name,
        release_date: getReleaseDate(rawTrack),
        spotify_genres: getGenresForTrack(rawTrack, artistsById),
      };
    }),
  };
}

module.exports = {
  getUnmatchedTracks,
};
