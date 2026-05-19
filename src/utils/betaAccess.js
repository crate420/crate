const betaAccessCodes = require("../repositories/betaAccessCodes");
const { readSignedCookie } = require("./cookies");

const BETA_COOKIE = "crate_beta_access";
const BETA_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function getBetaAccess(req) {
  const betaToken = readSignedCookie(req, BETA_COOKIE);
  return betaAccessCodes.findByToken(betaToken);
}

function hasBetaAccess(req) {
  return Boolean(getBetaAccess(req));
}

module.exports = {
  BETA_COOKIE,
  BETA_COOKIE_MAX_AGE_SECONDS,
  getBetaAccess,
  hasBetaAccess,
};
