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

function safeUrlForLog(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (err) {
    return "spotify_api_url";
  }
}

function spotifyApiError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 502;
  error.code = "spotify_api_error";
  Object.assign(error, details);
  return error;
}

async function requestWithRetry(url, options, attempt = 1) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (err) {
    if (attempt <= 3) {
      console.warn("[Spotify API] fetch failed; retrying", {
        url: safeUrlForLog(url),
        attempt,
        message: err.message,
      });
      await sleep(attempt * 1000);
      return requestWithRetry(url, options, attempt + 1);
    }

    throw spotifyApiError(`Spotify API request failed: ${err.message}`, { cause: err });
  }

  if (response.status === 429 && attempt <= 3) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "1", 10);
    console.warn("[Spotify API] rate limited; retrying", {
      url: safeUrlForLog(url),
      attempt,
      retry_after_seconds: retryAfterSeconds,
    });
    await sleep(Math.max(1, retryAfterSeconds) * 1000);
    return requestWithRetry(url, options, attempt + 1);
  }

  if (response.status >= 500 && attempt <= 3) {
    console.warn("[Spotify API] server error; retrying", {
      url: safeUrlForLog(url),
      status: response.status,
      attempt,
    });
    await sleep(attempt * 1000);
    return requestWithRetry(url, options, attempt + 1);
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("[Spotify API] request failed", {
      url: safeUrlForLog(url),
      status: response.status,
      message: body.error?.message || body.error || "unknown error",
    });

    throw spotifyApiError(
      `Spotify API request failed (${response.status}): ${body.error?.message || "unknown error"}`,
      {
        spotifyStatus: response.status,
        spotifyError: body.error || null,
      },
    );
  }

  return body;
}

module.exports = {
  requestSpotify,
};
