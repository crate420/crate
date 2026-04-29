const trackRepo = require("../repositories/tracks");
const spotifyArtists = require("../spotify/artists");
const {
  getArtistIds,
  getArtistNames,
  getGenresForTrack,
  getReleaseDate,
  parseRawTrack,
} = require("./trackContext");

function sortGenreCounts(genreCounts) {
  return [...genreCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.genre.localeCompare(b.genre);
    });
}

async function getUnmatchedDiagnostics(userId) {
  const rows = trackRepo.getAllUnmatchedTracksForUser(userId);
  const artistIds = rows.flatMap((row) => getArtistIds(parseRawTrack(row.raw_json)));
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);
  const genreCounts = new Map();
  const noGenreTracks = [];
  let tracksWithGenres = 0;

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    const genres = getGenresForTrack(rawTrack, artistsById);

    if (genres.length > 0) {
      tracksWithGenres += 1;

      for (const genre of genres) {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
      }
    } else if (noGenreTracks.length < 25) {
      noGenreTracks.push({
        track_id: row.track_id,
        spotify_track_id: row.spotify_track_id,
        title: row.name,
        artist_names: getArtistNames(row, rawTrack),
        album_name: row.album_name,
        release_date: getReleaseDate(rawTrack),
      });
    }
  }

  return {
    total_unmatched_tracks: rows.length,
    unmatched_tracks_with_genres: tracksWithGenres,
    unmatched_tracks_with_no_genres: rows.length - tracksWithGenres,
    top_unmatched_genres: sortGenreCounts(genreCounts).slice(0, 50),
    sample_unmatched_tracks_with_no_genres: noGenreTracks,
  };
}

module.exports = {
  getUnmatchedDiagnostics,
};
