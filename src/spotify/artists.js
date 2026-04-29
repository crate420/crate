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

  for (const artistIdChunk of chunk(uniqueArtistIds, 50)) {
    const params = new URLSearchParams({
      ids: artistIdChunk.join(","),
    });

    const response = await requestSpotify(userId, `/artists?${params.toString()}`);

    for (const artist of response.artists || []) {
      if (artist?.id) {
        artistsById.set(artist.id, artist);
      }
    }
  }

  return artistsById;
}

module.exports = {
  getArtistsByIds,
};
