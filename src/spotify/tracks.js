const { requestSpotify } = require("./client");

async function getAllLikedTracks(userId) {
  const tracks = [];
  let nextUrl = "/me/tracks?limit=50&offset=0";

  while (nextUrl) {
    const page = await requestSpotify(userId, nextUrl);
    tracks.push(...(page.items || []));
    nextUrl = page.next;
  }

  return tracks;
}

async function getLikedTracksPage(userId, { limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  return requestSpotify(userId, `/me/tracks?${params.toString()}`);
}

module.exports = {
  getAllLikedTracks,
  getLikedTracksPage,
};
