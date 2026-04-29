const config = require("../config");

const SPOTIFY_ACCOUNTS_URL = "https://accounts.spotify.com";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";

const SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "user-read-email",
  "user-read-private",
];

function buildAuthorizeUrl(state) {
  config.requireSpotifyConfig();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.spotify.clientId,
    scope: SCOPES.join(" "),
    redirect_uri: config.spotify.redirectUri,
    state,
  });

  return `${SPOTIFY_ACCOUNTS_URL}/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  config.requireSpotifyConfig();

  return requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.spotify.redirectUri,
  });
}

async function refreshAccessToken(refreshToken) {
  config.requireSpotifyConfig();

  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function requestToken(params) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.spotify.clientId}:${config.spotify.clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Spotify token request failed (${response.status}): ${body.error_description || body.error || "unknown error"}`,
    );
  }

  return body;
}

async function getCurrentSpotifyProfile(accessToken) {
  const response = await fetch(`${SPOTIFY_API_URL}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Spotify profile request failed (${response.status}): ${body.error?.message || "unknown error"}`,
    );
  }

  return body;
}

function tokenExpiresAt(expiresInSeconds) {
  const safetyBufferSeconds = 60;
  const expiresInMs = Math.max(0, expiresInSeconds - safetyBufferSeconds) * 1000;

  return new Date(Date.now() + expiresInMs).toISOString();
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getCurrentSpotifyProfile,
  refreshAccessToken,
  tokenExpiresAt,
};
