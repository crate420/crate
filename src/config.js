const path = require("node:path");
const { fileURLToPath } = require("node:url");
const dotenv = require("dotenv");

dotenv.config();

const rootDir = path.resolve(__dirname, "..");

function readPort(value) {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  return port;
}

function readDatabasePath(value) {
  if (!value) {
    throw new Error("DATABASE_URL must be set to the SQLite database path.");
  }

  if (value.startsWith("file:")) {
    return fileURLToPath(value);
  }

  if (value.startsWith("sqlite://")) {
    const sqlitePath = value.slice("sqlite://".length);

    return path.isAbsolute(sqlitePath)
      ? sqlitePath
      : path.resolve(rootDir, sqlitePath);
  }

  return path.isAbsolute(value)
    ? value
    : path.resolve(rootDir, value);
}

const config = {
  env: process.env.NODE_ENV || "development",
  port: readPort(process.env.PORT || "3000"),
  databasePath: readDatabasePath(process.env.DATABASE_URL),
  sessionSecret: process.env.SESSION_SECRET || "",
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || "",
  },
  lastfm: {
    apiKey: process.env.LASTFM_API_KEY || "",
  },
  adminSpotifyUserId: process.env.ADMIN_SPOTIFY_USER_ID || "",
  rootDir,
};

function requireSessionSecret() {
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
}

function requireSpotifyConfig() {
  const missing = [];

  if (!config.spotify.clientId) missing.push("SPOTIFY_CLIENT_ID");
  if (!config.spotify.clientSecret) missing.push("SPOTIFY_CLIENT_SECRET");
  if (!config.spotify.redirectUri) missing.push("SPOTIFY_REDIRECT_URI");

  if (missing.length > 0) {
    throw new Error(`Missing Spotify config: ${missing.join(", ")}`);
  }

  requireSessionSecret();
}

module.exports = {
  ...config,
  readDatabasePath,
  requireSessionSecret,
  requireSpotifyConfig,
};
