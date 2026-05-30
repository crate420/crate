const MUSICBRAINZ_API_ROOT = "https://musicbrainz.org/ws/2/artist/";
const MUSICBRAINZ_MAX_ATTEMPTS = 3;
const MUSICBRAINZ_REQUEST_TIMEOUT_MS = 10_000;
const MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS = 1_000;
const MUSICBRAINZ_USER_AGENT = "Crate/0.9.3 (https://crate-mlou.onrender.com)";

let nextRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRateLimit() {
  const waitMs = Math.max(0, nextRequestAt - Date.now());

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextRequestAt = Date.now() + MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS;
}

function isTransientStatus(status) {
  return status === 429 || status >= 500;
}

async function requestMusicBrainz(url, { artistName, attempt = 1 } = {}) {
  await waitForRateLimit();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MUSICBRAINZ_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": MUSICBRAINZ_USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (attempt < MUSICBRAINZ_MAX_ATTEMPTS) {
      console.warn("[MusicBrainz] request failed; retrying", {
        artist_name: artistName || null,
        attempt,
        message: err.message,
      });
      return requestMusicBrainz(url, { artistName, attempt: attempt + 1 });
    }

    const error = new Error(`MusicBrainz request failed: ${err.message}`);
    error.code = err.name === "AbortError" ? "musicbrainz_timeout" : "musicbrainz_request_failed";
    error.statusCode = 502;
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => ({}));

  if (isTransientStatus(response.status) && attempt < MUSICBRAINZ_MAX_ATTEMPTS) {
    console.warn("[MusicBrainz] transient response; retrying", {
      artist_name: artistName || null,
      status: response.status,
      attempt,
    });
    return requestMusicBrainz(url, { artistName, attempt: attempt + 1 });
  }

  if (!response.ok) {
    const error = new Error(body.error || `MusicBrainz request failed with HTTP ${response.status}`);
    error.code = `musicbrainz_http_${response.status}`;
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }

  return body;
}

async function searchArtist(artistName) {
  const normalizedArtistName = String(artistName || "").trim();

  if (!normalizedArtistName) {
    const error = new Error("artistName is required.");
    error.code = "invalid_artist_name";
    error.statusCode = 400;
    throw error;
  }

  const url = new URL(MUSICBRAINZ_API_ROOT);
  const escapedArtistName = normalizedArtistName.replace(/[\\"]/g, "\\$&");
  url.searchParams.set("query", `artist:\"${escapedArtistName}\"`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "5");

  return requestMusicBrainz(url, { artistName: normalizedArtistName });
}

module.exports = {
  searchArtist,
};
