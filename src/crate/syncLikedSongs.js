const trackRepo = require("../repositories/tracks");
const spotifyTracks = require("../spotify/tracks");

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function syncLikedSongs(userId) {
  console.log("[Crate Sync] liked songs sync started", { user_id: userId });
  const fetchStartedAt = process.hrtime.bigint();
  const savedTracks = await spotifyTracks.getAllLikedTracks(userId, {
    onPage: ({ pageNumber, pageCount, totalFetched, hasNextPage }) => {
      if (pageNumber === 1 || pageNumber % 20 === 0 || !hasNextPage) {
        console.log("[Crate Sync] liked songs page fetched", {
          user_id: userId,
          page_number: pageNumber,
          page_count: pageCount,
          total_fetched: totalFetched,
          has_next_page: hasNextPage,
        });
      }
    },
  });
  const likedSongsFetchMs = elapsedMs(fetchStartedAt);
  console.log("[Crate Sync] liked songs fetch complete", {
    user_id: userId,
    tracks_fetched: savedTracks.length,
    duration_ms: Math.round(likedSongsFetchMs),
  });

  const scanStartedAt = process.hrtime.bigint();
  console.log("[Crate Sync] track database scan started", {
    user_id: userId,
    tracks_to_process: savedTracks.length,
  });
  const stats = trackRepo.upsertSavedTracksForUser(userId, savedTracks);
  const totalStoredForUser = trackRepo.countLikedTracksForUser(userId);
  const trackScanMs = elapsedMs(scanStartedAt);
  console.log("[Crate Sync] track database scan complete", {
    user_id: userId,
    duration_ms: Math.round(trackScanMs),
    total_stored_for_user: totalStoredForUser,
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
  });

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
