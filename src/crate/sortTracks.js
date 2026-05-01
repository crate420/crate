const trackRepo = require("../repositories/tracks");
const artistGenreRepo = require("../repositories/artistGenres");
const spotifyArtists = require("../spotify/artists");
const { matchAlbumPlaylistCode, matchPlaylistCode } = require("./sortRules");
const { getArtistIds, getArtistNames, getTrackContext, parseRawTrack } = require("./trackContext");

async function sortTracks(userId) {
  const unsortedTracks = trackRepo.getUnsortedTracksForUser(userId);
  const rawTracks = unsortedTracks.map((row) => parseRawTrack(row.raw_json));
  const artistIds = rawTracks.flatMap((rawTrack) => getArtistIds(rawTrack));
  const artistNames = unsortedTracks.flatMap((row, index) =>
    getArtistNames(row, rawTracks[index]),
  );
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);
  const fallbackGenresByArtistName = artistGenreRepo.findGenresByArtistNames(artistNames);

  const assignments = [];
  let matched = 0;
  let unmatched = 0;

  for (const row of unsortedTracks) {
    const context = getTrackContext(row, artistsById, fallbackGenresByArtistName);
    let playlistCode = row.override_playlist_code || matchPlaylistCode(context);

    if (
      !playlistCode &&
      context.spotifyGenres.length === 0 &&
      context.fallbackGenres.length === 0
    ) {
      playlistCode = matchAlbumPlaylistCode(context);

      if (playlistCode) {
        console.log(
          `Album title classified track ${row.track_id} as ${playlistCode}: ${context.album.name}`,
        );
      }
    }

    if (playlistCode) {
      matched += 1;
      assignments.push({
        userId,
        trackId: row.track_id,
        playlistCode,
      });
    } else {
      unmatched += 1;
    }
  }

  trackRepo.assignPlaylistCodes(assignments);

  return {
    processed: unsortedTracks.length,
    matched,
    unmatched,
  };
}

module.exports = {
  sortTracks,
};
