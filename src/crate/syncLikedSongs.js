const trackRepo = require("../repositories/tracks");
const spotifyTracks = require("../spotify/tracks");

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function syncLikedSongs(userId) {
  const fetchStartedAt = process.hrtime.bigint();
  const savedTracks = await spotifyTracks.getAllLikedTracks(userId);
  const likedSongsFetchMs = elapsedMs(fetchStartedAt);

  const scanStartedAt = process.hrtime.bigint();
  const stats = trackRepo.upsertSavedTracksForUser(userId, savedTracks);
  const totalStoredForUser = trackRepo.countLikedTracksForUser(userId);
  const trackScanMs = elapsedMs(scanStartedAt);

  return {
    ...stats,
    totalStoredForUser,
    timing: {
      likedSongsFetchMs,
      trackScanMs,
      totalSyncMs: likedSongsFetchMs + trackScanMs,
      tracksFetched: savedTracks.length,
    },
  };
}

module.exports = {
  syncLikedSongs,
};
