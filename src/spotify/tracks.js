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

module.exports = {
  getAllLikedTracks,
};
