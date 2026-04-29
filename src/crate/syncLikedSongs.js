const trackRepo = require("../repositories/tracks");
const spotifyTracks = require("../spotify/tracks");

async function syncLikedSongs(userId) {
  const savedTracks = await spotifyTracks.getAllLikedTracks(userId);
  const stats = trackRepo.upsertSavedTracksForUser(userId, savedTracks);
  const totalStoredForUser = trackRepo.countLikedTracksForUser(userId);

  return {
    ...stats,
    totalStoredForUser,
  };
}

module.exports = {
  syncLikedSongs,
};
