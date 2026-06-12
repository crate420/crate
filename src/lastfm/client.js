const config = require("../config");

const LASTFM_API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_MAX_ATTEMPTS = 3;
const LASTFM_REQUEST_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

  const body = await requestLastfm(url, { artistName });
  const tags = body.toptags?.tag;

  return {
    sourceArtistName: body.toptags?.["@attr"]?.artist || artistName,
    tags: Array.isArray(tags) ? tags : [],
    rawPayload: body,
  };
}


async function getTrackInfo({ artistName, trackName }) {
  requireLastfmConfig();

  const url = new URL(LASTFM_API_ROOT);
  url.searchParams.set("method", "track.getInfo");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("track", trackName);
  url.searchParams.set("api_key", config.lastfm.apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");

  const body = await requestLastfm(url, { artistName, trackName });
  const track = body.track || {};

  return {
    sourceTrackName: track.name || trackName,
    sourceArtistName: track.artist?.name || artistName,
    mbid: track.mbid || null,
    rawPayload: body,
    track,
  };
}

async function getTrackTopTags({ artistName, trackName }) {
  requireLastfmConfig();

  const url = new URL(LASTFM_API_ROOT);
  url.searchParams.set("method", "track.getTopTags");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("track", trackName);
  url.searchParams.set("api_key", config.lastfm.apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");

  const body = await requestLastfm(url, { artistName, trackName });
  const tags = body.toptags?.tag;

  return {
    sourceTrackName: body.toptags?.["@attr"]?.track || trackName,
    sourceArtistName: body.toptags?.["@attr"]?.artist || artistName,
    tags: Array.isArray(tags) ? tags : [],
    rawPayload: body,
  };
}

async function getTrackInfoAndTopTags({ artistName, trackName }) {
  const [info, topTags] = await Promise.all([
    getTrackInfo({ artistName, trackName }),
    getTrackTopTags({ artistName, trackName }),
  ]);

  return { info, topTags };
}

async function requestLastfm(url, { artistName, trackName, attempt = 1 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LASTFM_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "CrateMVP/0.1",
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (attempt < LASTFM_MAX_ATTEMPTS) {
      console.warn("[Last.fm] request failed; retrying", {
        artist_name: artistName || null,
        track_name: trackName || null,
        attempt,
        message: err.message,
      });
      await sleep(attempt * 500);
      return requestLastfm(url, { artistName, trackName, attempt: attempt + 1 });
    }

    const error = new Error(`Last.fm request failed: ${err.message}`);
    error.code = err.name === "AbortError" ? "lastfm_timeout" : "lastfm_request_failed";
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => ({}));

  if ((response.status === 429 || response.status >= 500) && attempt < LASTFM_MAX_ATTEMPTS) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "1", 10);
    console.warn("[Last.fm] transient response; retrying", {
      artist_name: artistName || null,
      track_name: trackName || null,
      status: response.status,
      attempt,
    });
    await sleep(Math.max(1, retryAfterSeconds) * 1000);
    return requestLastfm(url, { artistName, trackName, attempt: attempt + 1 });
  }

  if (!response.ok || body.error) {
    const error = new Error(body.message || `Last.fm request failed with HTTP ${response.status}`);
    error.code = body.error ? String(body.error) : String(response.status);
    throw error;
  }

  return body;
}

module.exports = {
  getArtistTopTags,
  getTrackInfo,
  getTrackInfoAndTopTags,
  getTrackTopTags,
  requireLastfmConfig,
};
