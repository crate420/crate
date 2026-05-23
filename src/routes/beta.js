const crypto = require("node:crypto");
const express = require("express");
const betaAccessCodes = require("../repositories/betaAccessCodes");
const { getCurrentUser } = require("../utils/authSession");
const { setSignedCookie } = require("../utils/cookies");
const { BETA_COOKIE, BETA_COOKIE_MAX_AGE_SECONDS, getBetaAccess } = require("../utils/betaAccess");

const router = express.Router();

function betaStatusPayload(req, res) {
  const access = getBetaAccess(req);
  const currentUser = getCurrentUser(req, res);
  const registered = Boolean(access || currentUser);
  const spotifyConnected = Boolean(currentUser);
  const nextStep = !registered ? "register" : spotifyConnected ? "dashboard" : "spotify";

  return {
    status: "ok",
    has_access: registered,
    registered,
    spotifyConnected,
    userId: currentUser?.id || null,
    nextStep,
    redirectTo: nextStep === "dashboard" ? "/app.html" : nextStep === "spotify" ? "/auth/spotify" : null,
    tester: access ? {
      name: access.claimed_name || null,
      email: access.claimed_email || null,
      registered_at: access.claimed_at || null,
    } : null,
  };
}

router.get("/status", (req, res) => {
  res.json(betaStatusPayload(req, res));
});

function normalizeRequiredText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

router.post("/claim", (req, res) => {
  const existingAccess = getBetaAccess(req);
  if (existingAccess) {
    return res.json({
      status: "ok",
      has_access: true,
      tester: {
        name: existingAccess.claimed_name || null,
        email: existingAccess.claimed_email || null,
        registered_at: existingAccess.claimed_at || null,
      },
      message: "Tester registration already active.",
    });
  }

  const name = normalizeRequiredText(req.body?.name);
  const email = normalizeRequiredText(req.body?.email);

  if (!name || !email) {
    return res.status(400).json({
      error: "missing_tester_contact",
      message: "Enter your name and email to continue.",
    });
  }

  if (!isLikelyEmail(email)) {
    return res.status(400).json({
      error: "invalid_tester_email",
      message: "Enter a valid email address to continue.",
    });
  }

  const betaToken = crypto.randomBytes(32).toString("base64url");
  const registrationCode = `TESTER-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const currentUser = getCurrentUser(req, res);
  betaAccessCodes.createTesterRegistration(registrationCode, betaToken, currentUser?.id || null, {
    name,
    email,
  });

  setSignedCookie(res, BETA_COOKIE, betaToken, {
    maxAgeSeconds: BETA_COOKIE_MAX_AGE_SECONDS,
  });

  return res.json({
    status: "ok",
    has_access: true,
    registered: true,
    spotifyConnected: Boolean(currentUser),
    userId: currentUser?.id || null,
    nextStep: currentUser ? "dashboard" : "spotify",
    redirectTo: currentUser ? "/app.html" : "/auth/spotify",
    tester: { name, email },
    message: "Tester registration saved.",
  });
});

module.exports = router;
