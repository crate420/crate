const users = require("../repositories/users");
const { clearCookie, readSignedCookie } = require("./cookies");

const CURRENT_USER_COOKIE = "crate_user_id";

function getCurrentUser(req, res) {
  const userId = readSignedCookie(req, CURRENT_USER_COOKIE);

  if (!userId) {
    return null;
  }

  const user = users.findById(Number(userId));

  if (!user) {
    clearCookie(res, CURRENT_USER_COOKIE);
    return null;
  }

  return user;
}

function requireCurrentUser(req, res, next) {
  const user = getCurrentUser(req, res);

  if (!user) {
    return res.status(401).json({
      error: "not_authenticated",
      message: "Connect Spotify before running Crate.",
    });
  }

  req.currentUser = user;
  return next();
}

module.exports = {
  CURRENT_USER_COOKIE,
  getCurrentUser,
  requireCurrentUser,
};
