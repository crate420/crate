const trackOverrideRepo = require("../repositories/trackOverrides");
const trackRepo = require("../repositories/tracks");
const { PLAYLIST_CODES } = require("./playlistDefinitions");

function parseTrackId(trackId) {
  const parsed = Number.parseInt(trackId, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error("track_id must be a positive integer.");
    error.statusCode = 400;
    error.code = "invalid_track_id";
    throw error;
  }

  return parsed;
}

function validatePlaylistCode(playlistCode) {
  const normalized = String(playlistCode || "").trim();

  if (!PLAYLIST_CODES.has(normalized)) {
    const error = new Error("playlist_code must be a known Crate playlist code.");
    error.statusCode = 400;
    error.code = "invalid_playlist_code";
    throw error;
  }

  return normalized;
}

function serializeTrack(row) {
  if (!row) {
    return null;
  }

  const overrideExists = Boolean(row.override_playlist_code);

  return {
    track_id: row.track_id,
    spotify_track_id: row.spotify_track_id,
    uri: row.uri,
    title: row.name,
    artist_names: JSON.parse(row.artist_names || "[]"),
    album_name: row.album_name,
    liked_at: row.liked_at,
    assigned_playlist_code: row.playlist_code,
    effective_playlist_code: row.override_playlist_code || row.playlist_code,
    override_exists: overrideExists,
    override_playlist_code: row.override_playlist_code || null,
  };
}

function getTrackForReview(userId, rawTrackId) {
  const trackId = parseTrackId(rawTrackId);
  const row = trackRepo.getTrackForUser(userId, trackId);

  if (!row) {
    const error = new Error("Track not found for current user.");
    error.statusCode = 404;
    error.code = "track_not_found";
    throw error;
  }

  return serializeTrack(row);
}

function applyTrackOverride(userId, { trackId: rawTrackId, playlistCode: rawPlaylistCode }) {
  const trackId = parseTrackId(rawTrackId);
  const playlistCode = validatePlaylistCode(rawPlaylistCode);
  const existing = trackRepo.getTrackForUser(userId, trackId);

  if (!existing) {
    const error = new Error("Track not found for current user.");
    error.statusCode = 404;
    error.code = "track_not_found";
    throw error;
  }

  const override = trackOverrideRepo.upsertTrackOverride({ trackId, playlistCode });
  trackRepo.setUserTrackPlaylistCode({ userId, trackId, playlistCode });

  return {
    track_id: trackId,
    playlist_code: playlistCode,
    override_exists: true,
    updated_at: override.updated_at,
  };
}

module.exports = {
  applyTrackOverride,
  getTrackForReview,
};
