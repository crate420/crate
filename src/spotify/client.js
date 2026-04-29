const { getValidAccessToken } = require("./tokens");

const SPOTIFY_API_URL = "https://api.spotify.com/v1";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestSpotify(userId, pathOrUrl, options = {}) {
  const accessToken = await getValidAccessToken(userId);
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${SPOTIFY_API_URL}${pathOrUrl}`;

  return requestWithRetry(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function requestWithRetry(url, options, attempt = 1) {
  const response = await fetch(url, options);

  if (response.status === 429 && attempt <= 3) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "1", 10);
    await sleep(Math.max(1, retryAfterSeconds) * 1000);
    return requestWithRetry(url, options, attempt + 1);
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Spotify API request failed (${response.status}): ${body.error?.message || "unknown error"}`,
    );
  }

  return body;
}

module.exports = {
  requestSpotify,
};
