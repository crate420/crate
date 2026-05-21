const crypto = require("node:crypto");
const express = require("express");
const spotifyAuth = require("../spotify/auth");
const users = require("../repositories/users");
const { CURRENT_USER_COOKIE, getCurrentUser } = require("../utils/authSession");
const { clearCookie, readSignedCookie, setSignedCookie } = require("../utils/cookies");
const betaAccessCodes = require("../repositories/betaAccessCodes");
const { BETA_COOKIE, hasBetaAccess } = require("../utils/betaAccess");

const router = express.Router();

const OAUTH_STATE_COOKIE = "crate_spotify_oauth_state";

router.get("/spotify", (req, res, next) => {
  try {
    if (!hasBetaAccess(req)) {
      return res.redirect("/?registration_required=1");
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const authorizeUrl = spotifyAuth.buildAuthorizeUrl(state);

    setSignedCookie(res, OAUTH_STATE_COOKIE, state, { maxAgeSeconds: 10 * 60 });
    return res.redirect(authorizeUrl);
  } catch (err) {
    console.error("[Crate Auth] Spotify login failed before redirect", {
      code: err.code || "unknown_error",
      message: err.message,
      missing_env: err.missingEnv || undefined,
    });

    if (err.code === "spotify_config_missing") {
      return res.status(503).json({
        error: "spotify_config_missing",
        message: "Spotify login is not configured. Ask the Crate beta admin to check Render environment variables.",
        missing_env: err.missingEnv || [],
      });
    }

    return next(err);
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

    betaAccessCodes.attachUserToToken(readSignedCookie(req, BETA_COOKIE), user.id);

    return res.redirect("/app.html");
  } catch (err) {
    next(err);
  }
});

router.get("/logout", (req, res) => {
  clearCookie(res, CURRENT_USER_COOKIE);
  clearCookie(res, OAUTH_STATE_COOKIE);

  res.redirect("/app.html");
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
