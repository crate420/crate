const { requestSpotify } = require("./client");

function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function createPlaylist(userId, spotifyUserId, { name, description }) {
  return requestSpotify(userId, `/users/${encodeURIComponent(spotifyUserId)}/playlists`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description,
      public: false,
    }),
  });
}

async function getCurrentUserPlaylistsByName(userId, spotifyUserId) {
  const playlistsByName = new Map();
  let nextUrl = "/me/playlists?limit=50";

  while (nextUrl) {
    const page = await requestSpotify(userId, nextUrl);

    for (const playlist of page.items || []) {
      if (!playlist?.id || !playlist.name) {
        continue;
      }

      if (spotifyUserId && playlist.owner?.id && playlist.owner.id !== spotifyUserId) {
        continue;
      }

      if (!playlistsByName.has(playlist.name)) {
        playlistsByName.set(playlist.name, playlist);
      }
    }

    nextUrl = page.next;
  }

  return playlistsByName;
}

async function getPlaylistTrackUris(userId, playlistId) {
  const trackUris = new Set();
  let nextUrl = `/playlists/${encodeURIComponent(playlistId)}/tracks?fields=items(track(uri)),next&limit=100`;

  while (nextUrl) {
    const page = await requestSpotify(userId, nextUrl);

    for (const item of page.items || []) {
      if (item.track?.uri) {
        trackUris.add(item.track.uri);
      }
    }

    nextUrl = page.next;
  }

  return trackUris;
}

async function addTracksToPlaylist(userId, playlistId, uris) {
  for (const uriChunk of chunk(uris, 100)) {
    await requestSpotify(userId, `/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: uriChunk,
      }),
    });
  }
}

async function removeTracksFromPlaylist(userId, playlistId, uris) {
  for (const uriChunk of chunk(uris, 100)) {
    await requestSpotify(userId, `/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tracks: uriChunk.map((uri) => ({ uri })),
      }),
    });
  }
}

module.exports = {
  addTracksToPlaylist,
  createPlaylist,
  getCurrentUserPlaylistsByName,
  getPlaylistTrackUris,
  removeTracksFromPlaylist,
};
