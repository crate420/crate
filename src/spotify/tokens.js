const spotifyAuth = require("./auth");
const users = require("../repositories/users");

function isExpired(tokenExpiresAt) {
  if (!tokenExpiresAt) {
    return true;
  }

  return new Date(tokenExpiresAt).getTime() <= Date.now();
}

async function getValidAccessToken(userId) {
  const user = users.findById(userId);

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  if (!user.refresh_token) {
    throw new Error(`User ${userId} does not have a refresh token`);
  }

  if (!isExpired(user.token_expires_at) && user.access_token) {
    return user.access_token;
  }

  const refreshed = await spotifyAuth.refreshAccessToken(user.refresh_token);

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
};
