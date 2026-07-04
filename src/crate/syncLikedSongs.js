const trackRepo = require("../repositories/tracks");
const spotifyTracks = require("../spotify/tracks");
const progress = require("./progress");

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function syncLikedSongs(userId) {
  console.log("[Crate Sync] liked songs sync started", { user_id: userId });
  progress.startProgress(userId, {
    stage: "scan_fetch",
    title: "Reading Your Spotify Library",
    body: "Downloading your Liked Songs from Spotify.",
    detail: "Starting Spotify library read",
  });
  const fetchStartedAt = process.hrtime.bigint();
  const savedTracks = await spotifyTracks.getAllLikedTracks(userId, {
    onPage: ({ pageNumber, pageCount, totalFetched, total, hasNextPage }) => {
      progress.updateProgress(userId, {
        stage: "scan_fetch",
        title: "Reading Your Spotify Library",
        body: "Downloading your Liked Songs from Spotify.",
        detail: total ? `${totalFetched.toLocaleString()} of ${total.toLocaleString()} songs read` : `${totalFetched.toLocaleString()} songs read`,
        songs_processed: totalFetched,
        songs_total: total || totalFetched,
      });
      if (pageNumber === 1 || pageNumber % 20 === 0 || !hasNextPage) {
        console.log("[Crate Sync] liked songs page fetched", {
          user_id: userId,
          page_number: pageNumber,
          page_count: pageCount,
          total_fetched: totalFetched,
          total,
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
  progress.updateProgress(userId, {
    stage: "scan_write",
    title: "Saving Your Spotify Library",
    body: "Updating Crate with your Liked Songs.",
    detail: `0 of ${savedTracks.length.toLocaleString()} songs processed`,
    songs_processed: 0,
    songs_total: savedTracks.length,
  });
  console.log("[Crate Sync] track database scan started", {
    user_id: userId,
    tracks_to_process: savedTracks.length,
  });
  const stats = trackRepo.upsertSavedTracksForUser(userId, savedTracks, {
    onProgress: (scanProgress) => {
      progress.updateProgress(userId, {
        stage: "scan_write",
        title: "Saving Your Spotify Library",
        body: "Updating Crate with your Liked Songs.",
        detail: `${scanProgress.processed.toLocaleString()} of ${scanProgress.total.toLocaleString()} songs processed`,
        songs_processed: scanProgress.processed,
        songs_total: scanProgress.total,
        inserted: scanProgress.inserted,
        updated: scanProgress.updated,
        skipped: scanProgress.skipped,
      });
    },
  });
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
