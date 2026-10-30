const { requestSpotify } = require("./client");

async function getAllLikedTracks(userId, options = {}) {
  const tracks = [];
  let nextUrl = "/me/tracks?limit=50&offset=0";
  let pageNumber = 0;
  let expectedTotal = null;
  const visited = new Set();
  const ids = new Set();
  function incomplete() { const err = new Error('Spotify library changed or returned an incomplete page. Cached library retained; please retry.'); err.code='incomplete_spotify_library'; err.statusCode=502; throw err; }

  while (nextUrl) {
    if (visited.has(nextUrl)) incomplete();
    visited.add(nextUrl);
    if (nextUrl.startsWith('https://') && !nextUrl.startsWith('https://api.spotify.com/v1/me/tracks?')) incomplete();
    pageNumber += 1;
    const page = await requestSpotify(userId, nextUrl);
    if (!Array.isArray(page?.items) || !Number.isInteger(page.total) || page.total < 0) incomplete();
    if (expectedTotal === null) expectedTotal = page.total;
    if (expectedTotal !== page.total) incomplete();
    const items = page.items;
    if (!items.length && page.next) incomplete();
    for (const item of items) { if (!item?.track?.id || !item.track.uri || ids.has(item.track.id)) incomplete(); ids.add(item.track.id); }
    tracks.push(...items);

    if (typeof options.onPage === "function") {
      options.onPage({
        pageNumber,
        pageCount: items.length,
        totalFetched: tracks.length,
        total: Number(page.total || 0),
        hasNextPage: Boolean(page.next),
      });
    }

    nextUrl = page.next;
  }

  if (tracks.length !== expectedTotal) incomplete();
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
