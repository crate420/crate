const trackRepo = require("../repositories/tracks");
const { PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");

function playlistDefinitionForCode(playlistCode) {
  return PLAYLIST_DEFINITIONS.find((definition) => definition.playlistCode === playlistCode);
}

function getAdminPlaylistOverview(userId) {
  const countsByPlaylistCode = trackRepo.getEffectivePlaylistCountsForUser(userId);

  return {
    playlists: PLAYLIST_DEFINITIONS.map((definition) => ({
      playlist_code: definition.playlistCode,
      display_name: definition.displayName,
      track_count: countsByPlaylistCode.get(definition.playlistCode) || 0,
    })),
  };
}

function getAdminPlaylistTracks(userId, playlistCode) {
  const definition = playlistDefinitionForCode(playlistCode);

  if (!definition) {
    const error = new Error("Unknown playlist code.");
    error.statusCode = 404;
    error.code = "playlist_not_found";
    throw error;
  }

  return {
    playlist_code: definition.playlistCode,
    display_name: definition.displayName,
    tracks: trackRepo.getTracksForEffectivePlaylist(userId, playlistCode).map((track) => ({
      track_id: track.track_id,
      title: track.name,
      artist_names: JSON.parse(track.artist_names || "[]"),
      album_name: track.album_name,
      current_playlist_code: track.effective_playlist_code,
      assigned_playlist_code: track.assigned_playlist_code,
      override_exists: Boolean(track.override_playlist_code),
      override_playlist_code: track.override_playlist_code || null,
    })),
  };
}

module.exports = {
  getAdminPlaylistOverview,
  getAdminPlaylistTracks,
};
