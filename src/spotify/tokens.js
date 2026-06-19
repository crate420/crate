const spotifyAuth = require("./auth");
const users = require("../repositories/users");

function isExpired(tokenExpiresAt) {
  if (!tokenExpiresAt) {
    return true;
  }

  return new Date(tokenExpiresAt).getTime() <= Date.now();
}

function isInvalidGrantError(err) {
  return Boolean(
    err?.isInvalidGrant ||
      err?.code === "invalid_grant" ||
      err?.spotifyError === "invalid_grant",
  );
}

function spotifyReauthorizationRequiredError(userId, cause) {
  const error = new Error("Spotify needs you to reconnect your account.");
  error.code = "spotify_reauthorization_required";
  error.statusCode = 401;
  error.reauthorizationRequired = true;
  error.redirectUrl = "/auth/spotify?reauthorize=1";
  error.userId = userId;
  error.cause = cause;
  return error;
}

async function getValidAccessToken(userId) {
  const user = users.findById(userId);

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  if (!user.refresh_token) {
    users.clearSpotifyTokens(user.id);
    throw spotifyReauthorizationRequiredError(user.id);
  }

  if (!isExpired(user.token_expires_at) && user.access_token) {
    return user.access_token;
  }

  let refreshed;
  try {
    refreshed = await spotifyAuth.refreshAccessToken(user.refresh_token);
  } catch (err) {
    if (isInvalidGrantError(err)) {
      users.clearSpotifyTokens(user.id);
      throw spotifyReauthorizationRequiredError(user.id, err);
    }

    throw err;
  }

  const updatedUser = users.updateTokens(user.id, {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    tokenExpiresAt: spotifyAuth.tokenExpiresAt(refreshed.expires_in),
    scope: refreshed.scope,
  });

  return updatedUser.access_token;
}

module.exports = {
  getValidAccessToken,
  isExpired,
  spotifyReauthorizationRequiredError,
};
