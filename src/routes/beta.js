const crypto = require("node:crypto");
const express = require("express");
const betaAccessCodes = require("../repositories/betaAccessCodes");
const { getCurrentUser } = require("../utils/authSession");
const { setSignedCookie } = require("../utils/cookies");
const { BETA_COOKIE, BETA_COOKIE_MAX_AGE_SECONDS, getBetaAccess } = require("../utils/betaAccess");

const router = express.Router();

router.get("/status", (req, res) => {
  const access = getBetaAccess(req);

  res.json({
    status: "ok",
    has_access: Boolean(access),
    code: access?.code || null,
  });
});

router.post("/claim", (req, res) => {
  const existingAccess = getBetaAccess(req);
  if (existingAccess) {
    return res.json({
      status: "ok",
      has_access: true,
      code: existingAccess.code,
      message: "Beta access already active.",
    });
  }

  const code = betaAccessCodes.normalizeCode(req.body?.code);
  if (!code) {
    return res.status(400).json({
      error: "missing_beta_code",
      message: "Enter a beta access code.",
    });
  }

  const betaToken = crypto.randomBytes(32).toString("base64url");
  const currentUser = getCurrentUser(req, res);
  const result = betaAccessCodes.claimCode(code, betaToken, currentUser?.id || null, {
    name: req.body?.name,
    email: req.body?.email,
  });

  if (result.status === "invalid") {
    return res.status(400).json({
      error: "invalid_beta_code",
      message: "That beta access code is not recognized.",
    });
  }

  if (result.status === "claimed") {
    return res.status(409).json({
      error: "beta_code_claimed",
      message: "That beta access code has already been claimed.",
    });
  }

  setSignedCookie(res, BETA_COOKIE, betaToken, {
    maxAgeSeconds: BETA_COOKIE_MAX_AGE_SECONDS,
  });

  return res.json({
    status: "ok",
    has_access: true,
    code: result.code,
    message: "Beta access unlocked.",
  });
});

module.exports = router;
