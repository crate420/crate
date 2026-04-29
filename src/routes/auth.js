const crypto = require("node:crypto");
const express = require("express");
const spotifyAuth = require("../spotify/auth");
const users = require("../repositories/users");
const { CURRENT_USER_COOKIE, getCurrentUser } = require("../utils/authSession");
const { clearCookie, readSignedCookie, setSignedCookie } = require("../utils/cookies");

const router = express.Router();

const OAUTH_STATE_COOKIE = "crate_spotify_oauth_state";

router.get("/spotify", (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("base64url");

    setSignedCookie(res, OAUTH_STATE_COOKIE, state, { maxAgeSeconds: 10 * 60 });
    res.redirect(spotifyAuth.buildAuthorizeUrl(state));
  } catch (err) {
    next(err);
  }
});

router.get("/spotify/callback", async (req, res, next) => {
  try {
    const { code, error, state } = req.query;
    const expectedState = readSignedCookie(req, OAUTH_STATE_COOKIE);

    clearCookie(res, OAUTH_STATE_COOKIE);

    if (error) {
      return res.status(400).json({
        error: "spotify_authorization_failed",
        message: String(error),
      });
    }

    if (!code || !state || state !== expectedState) {
      return res.status(400).json({
        error: "invalid_oauth_state",
        message: "Spotify OAuth state did not match.",
      });
    }

    const tokenResponse = await spotifyAuth.exchangeCodeForTokens(String(code));
    const profile = await spotifyAuth.getCurrentSpotifyProfile(tokenResponse.access_token);

    const user = users.upsertSpotifyUser({
      profile,
      tokens: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt: spotifyAuth.tokenExpiresAt(tokenResponse.expires_in),
        scope: tokenResponse.scope,
      },
    });

    setSignedCookie(res, CURRENT_USER_COOKIE, String(user.id), {
      maxAgeSeconds: 30 * 24 * 60 * 60,
    });

    return res.json({
      status: "ok",
      message: "Spotify account connected.",
      user: {
        id: user.id,
        spotify_user_id: user.spotify_user_id,
        display_name: user.display_name,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res) => {
  clearCookie(res, CURRENT_USER_COOKIE);

  res.json({
    status: "ok",
    message: "Logged out.",
  });
});

router.get("/me", (req, res) => {
  const user = getCurrentUser(req, res);

  if (!user) {
    return res.status(401).json({
      error: "not_authenticated",
      message: "No active Crate session.",
    });
  }

  return res.json({
    user: {
      id: user.id,
      spotify_user_id: user.spotify_user_id,
      display_name: user.display_name,
      email: user.email,
      token_expires_at: user.token_expires_at,
    },
  });
});

module.exports = router;
