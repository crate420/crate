const trackRepo = require("../repositories/tracks");
const artistGenreRepo = require("../repositories/artistGenres");
const spotifyArtists = require("../spotify/artists");
const { matchAlbumPlaylistCode, maybeLogScoreDebug, scorePlaylistCode } = require("./sortRules");
const { getArtistIds, getArtistNames, getTrackContext, parseRawTrack } = require("./trackContext");

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function sortTracks(userId) {
  const sortStartedAt = process.hrtime.bigint();
  const unsortedTracks = trackRepo.getUnsortedTracksForUser(userId);
  const rawTracks = unsortedTracks.map((row) => parseRawTrack(row.raw_json));
  const artistIds = rawTracks.flatMap((rawTrack) => getArtistIds(rawTrack));
  const artistNames = unsortedTracks.flatMap((row, index) =>
    getArtistNames(row, rawTracks[index]),
  );
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);
  const fallbackGenresByArtistName = artistGenreRepo.findGenresByArtistNames(artistNames);

  const matchingStartedAt = process.hrtime.bigint();
  const assignments = [];
  let matched = 0;
  let unmatched = 0;

  for (const row of unsortedTracks) {
    const context = getTrackContext(row, artistsById, fallbackGenresByArtistName);
    const decision = scorePlaylistCode(context);
    maybeLogScoreDebug(context, decision);
    let playlistCode = row.override_playlist_code || decision.playlistCode;

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
  const playlistSortMs = elapsedMs(matchingStartedAt);
  const totalSortMs = elapsedMs(sortStartedAt);

  return {
    processed: unsortedTracks.length,
    matched,
    unmatched,
    timing: {
      playlistSortMs,
      totalSortMs,
    },
  };
}

module.exports = {
  sortTracks,
};
