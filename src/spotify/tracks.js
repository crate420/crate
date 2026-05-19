const { requestSpotify } = require("./client");

async function getAllLikedTracks(userId, options = {}) {
  const tracks = [];
  let nextUrl = "/me/tracks?limit=50&offset=0";
  let pageNumber = 0;

  while (nextUrl) {
    pageNumber += 1;
    const page = await requestSpotify(userId, nextUrl);
    const items = page.items || [];
    tracks.push(...items);

    if (typeof options.onPage === "function") {
      options.onPage({
        pageNumber,
        pageCount: items.length,
        totalFetched: tracks.length,
        hasNextPage: Boolean(page.next),
      });
    }

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
