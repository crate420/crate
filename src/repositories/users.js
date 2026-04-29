const { openDatabase } = require("../db");

function upsertSpotifyUser({ profile, tokens }) {
  const db = openDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (
      spotify_user_id,
      display_name,
      email,
      country,
      product,
      access_token,
      refresh_token,
      token_expires_at,
      token_scope,
      created_at,
      updated_at
    )
    VALUES (
      @spotifyUserId,
      @displayName,
      @email,
      @country,
      @product,
      @accessToken,
      @refreshToken,
      @tokenExpiresAt,
      @tokenScope,
      @now,
      @now
    )
    ON CONFLICT(spotify_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      email = excluded.email,
      country = excluded.country,
      product = excluded.product,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, users.refresh_token),
      token_expires_at = excluded.token_expires_at,
      token_scope = excluded.token_scope,
      updated_at = excluded.updated_at
  `).run({
    spotifyUserId: profile.id,
    displayName: profile.display_name || null,
    email: profile.email || null,
    country: profile.country || null,
    product: profile.product || null,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    tokenExpiresAt: tokens.tokenExpiresAt,
    tokenScope: tokens.scope || null,
    now,
  });

  return findBySpotifyUserId(profile.id);
}

function findById(id) {
  return openDatabase()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id);
}

function findBySpotifyUserId(spotifyUserId) {
  return openDatabase()
    .prepare("SELECT * FROM users WHERE spotify_user_id = ?")
    .get(spotifyUserId);
}

function updateTokens(userId, tokens) {
  const refreshTokenSql = tokens.refreshToken ? ", refresh_token = @refreshToken" : "";

  openDatabase()
    .prepare(`
      UPDATE users
      SET
        access_token = @accessToken,
        token_expires_at = @tokenExpiresAt,
        token_scope = COALESCE(@tokenScope, token_scope),
        updated_at = @updatedAt
        ${refreshTokenSql}
      WHERE id = @userId
    `)
    .run({
      userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || null,
      tokenExpiresAt: tokens.tokenExpiresAt,
      tokenScope: tokens.scope || null,
      updatedAt: new Date().toISOString(),
    });

  return findById(userId);
}

module.exports = {
  findById,
  findBySpotifyUserId,
  updateTokens,
  upsertSpotifyUser,
};
