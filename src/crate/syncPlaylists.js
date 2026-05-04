const playlistRepo = require("../repositories/playlists");
const trackRepo = require("../repositories/tracks");
const userRepo = require("../repositories/users");
const spotifyPlaylists = require("../spotify/playlists");
const { PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");

function groupTracksByPlaylistCode(tracks) {
  const groups = new Map();

  for (const track of tracks) {
    const playlistTracks = groups.get(track.playlist_code) || [];
    playlistTracks.push(track);
    groups.set(track.playlist_code, playlistTracks);
  }

  return groups;
}

function uniqueUrisForTracks(tracks) {
  return [...new Set(tracks.map((track) => track.uri).filter(Boolean))];
}

async function syncPlaylists(userId) {
  const user = userRepo.findById(userId);

  if (!user?.spotify_user_id) {
    const error = new Error(`User ${userId} does not have a Spotify profile.`);
    error.statusCode = 400;
    error.code = "missing_spotify_profile";
    throw error;
  }

  playlistRepo.upsertPlaylistDefinitions(PLAYLIST_DEFINITIONS);

  const run = playlistRepo.startPlaylistSyncRun(userId);
  const summary = {
    status: "ok",
    run_id: run.run_id,
    playlists_checked: 0,
    playlists_created: 0,
    playlists_found_existing: 0,
    playlists_reused_from_db: 0,
    tracks_added: 0,
    tracks_removed: 0,
    duplicates_skipped: 0,
    errors: [],
  };

  try {
    const definitionsByCode = playlistRepo.getPlaylistDefinitionsByCode();
    const spotifyPlaylistsByName = await spotifyPlaylists.getCurrentUserPlaylistsByName(
      userId,
      user.spotify_user_id,
    );
    const tracksByPlaylistCode = groupTracksByPlaylistCode(
      trackRepo.getSortedTracksForPlaylistSync(userId),
    );

    const playlistCodesToCheck = new Set([
      ...PLAYLIST_DEFINITIONS.map((definition) => definition.playlistCode),
      ...tracksByPlaylistCode.keys(),
    ]);

    for (const playlistCode of playlistCodesToCheck) {
      const tracks = tracksByPlaylistCode.get(playlistCode) || [];
      const definition = definitionsByCode.get(playlistCode);

      if (!definition) {
        summary.errors.push({
          playlist_code: playlistCode,
          message: "No playlist definition found.",
        });
        continue;
      }

      summary.playlists_checked += 1;

      try {
        let spotifyPlaylistId = definition.spotify_playlist_id;

        const localUris = uniqueUrisForTracks(tracks);

        if (!spotifyPlaylistId && localUris.length === 0) {
          continue;
        }

        if (spotifyPlaylistId) {
          summary.playlists_reused_from_db += 1;
        }

        if (!spotifyPlaylistId) {
          const existingPlaylist = spotifyPlaylistsByName.get(definition.display_name);

          if (existingPlaylist?.id) {
            spotifyPlaylistId = existingPlaylist.id;
            playlistRepo.updateSpotifyPlaylistId(playlistCode, spotifyPlaylistId);
            summary.playlists_found_existing += 1;
            console.log(
              `Reused existing Spotify playlist for ${playlistCode}: ${definition.display_name}`,
            );
          }
        }

        if (!spotifyPlaylistId) {
          const playlist = await spotifyPlaylists.createPlaylist(userId, user.spotify_user_id, {
            name: definition.display_name,
            description: "Managed by Crate MVP.",
          });

          spotifyPlaylistId = playlist.id;
          playlistRepo.updateSpotifyPlaylistId(playlistCode, spotifyPlaylistId);
          spotifyPlaylistsByName.set(definition.display_name, playlist);
          summary.playlists_created += 1;
        }

        const existingUris = await spotifyPlaylists.getPlaylistTrackUris(userId, spotifyPlaylistId);
        const urisToAdd = localUris.filter((uri) => !existingUris.has(uri));
        const localUriSet = new Set(localUris);
        const urisToRemove = [...existingUris].filter((uri) => !localUriSet.has(uri));

        summary.duplicates_skipped += localUris.length - urisToAdd.length;

        if (urisToAdd.length > 0) {
          await spotifyPlaylists.addTracksToPlaylist(userId, spotifyPlaylistId, urisToAdd);
          summary.tracks_added += urisToAdd.length;
        }

        if (urisToRemove.length > 0) {
          await spotifyPlaylists.removeTracksFromPlaylist(userId, spotifyPlaylistId, urisToRemove);
          summary.tracks_removed += urisToRemove.length;
        }
      } catch (err) {
        summary.errors.push({
          playlist_code: playlistCode,
          message: err.message,
        });
      }
    }
  } finally {
    playlistRepo.finishPlaylistSyncRun(run.run_id, summary);
  }

  return summary;
}

module.exports = {
  PLAYLIST_DEFINITIONS,
  syncPlaylists,
};
