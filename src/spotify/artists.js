const { requestSpotify } = require("./client");

function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function getArtistsByIds(userId, artistIds) {
  const uniqueArtistIds = [...new Set(artistIds)].filter(Boolean);
  const artistsById = new Map();

  const chunks = chunk(uniqueArtistIds, 50);
  let failedBatches = 0;

  console.log("[Crate Sort] Spotify artist genre fetch started", {
    user_id: userId,
    unique_artist_ids: uniqueArtistIds.length,
    batches: chunks.length,
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const artistIdChunk = chunks[index];
    const params = new URLSearchParams({
      ids: artistIdChunk.join(","),
    });

    try {
      const response = await requestSpotify(userId, `/artists?${params.toString()}`);

      for (const artist of response.artists || []) {
        if (artist?.id) {
          artistsById.set(artist.id, artist);
        }
      }
    } catch (err) {
      failedBatches += 1;
      console.error("[Crate Sort] Spotify artist genre batch failed; continuing with fallbacks", {
        user_id: userId,
        batch_number: index + 1,
        batches: chunks.length,
        artist_ids_in_batch: artistIdChunk.length,
        code: err.code || "unknown_error",
        message: err.message,
      });
    }

    if (index === 0 || (index + 1) % 10 === 0 || index + 1 === chunks.length) {
      console.log("[Crate Sort] Spotify artist genre fetch progress", {
        user_id: userId,
        batches_completed: index + 1,
        batches: chunks.length,
        artists_loaded: artistsById.size,
        failed_batches: failedBatches,
      });
    }
  }

  console.log("[Crate Sort] Spotify artist genre fetch complete", {
    user_id: userId,
    artists_requested: uniqueArtistIds.length,
    artists_loaded: artistsById.size,
    failed_batches: failedBatches,
  });

  return artistsById;
}

module.exports = {
  getArtistsByIds,
};
