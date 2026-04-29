const config = require("../config");

const LASTFM_API_ROOT = "https://ws.audioscrobbler.com/2.0/";

function requireLastfmConfig() {
  if (!config.lastfm.apiKey) {
    const error = new Error("Missing Last.fm config: LASTFM_API_KEY");
    error.code = "missing_lastfm_api_key";
    error.statusCode = 400;
    throw error;
  }
}

async function getArtistTopTags(artistName) {
  requireLastfmConfig();

  const url = new URL(LASTFM_API_ROOT);
  url.searchParams.set("method", "artist.getTopTags");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("api_key", config.lastfm.apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "CrateMVP/0.1",
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.error) {
    const error = new Error(body.message || `Last.fm request failed with HTTP ${response.status}`);
    error.code = body.error ? String(body.error) : String(response.status);
    throw error;
  }

  const tags = body.toptags?.tag;

  return {
    sourceArtistName: body.toptags?.["@attr"]?.artist || artistName,
    tags: Array.isArray(tags) ? tags : [],
  };
}

module.exports = {
  getArtistTopTags,
  requireLastfmConfig,
};
