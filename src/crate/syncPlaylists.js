const playlistRepo = require("../repositories/playlists");
const trackRepo = require("../repositories/tracks");
const userRepo = require("../repositories/users");
const spotifyPlaylists = require("../spotify/playlists");
const { PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");

const ERA_LABELS = {
  all: "All",
  vintage: "Vintage",
  classic: "Classic",
  retro: "Retro",
  modern: "Modern",
};

const ERA_RANGES = {
  vintage: { max: 1969 },
  classic: { min: 1970, max: 1989 },
  retro: { min: 1990, max: 2009 },
  modern: { min: 2010 },
};

function logSend(message, details = {}) {
  console.log(`[Crate Send] ${message}`, details);
}

function normalizePlaylistName(value) {
  return String(value || "")
    .trim()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "playlist";
}

function labelForPlaylistCode(playlistCode) {
  const definition = PLAYLIST_DEFINITIONS.find((candidate) => candidate.playlistCode === playlistCode);
  return definition ? definition.displayName.replace(/^Crate:\s*/i, "") : playlistCode;
}

function compactCrateName(value) {
  return "Crate: " + String(value || "").trim().replace(/\s+/g, " ");
}

function displayNameForGenreSelection(playlistCode, era = "all") {
  const label = labelForPlaylistCode(playlistCode);
  const eraKey = normalizeEra(era);
  if (eraKey === "all") {
    return compactCrateName(label);
  }
  return compactCrateName(`${label} - ${ERA_LABELS[eraKey]}`);
}

function displayNameForArtistSelection(artistName) {
  return compactCrateName(artistName);
}

function displayNameForEraSelection(era) {
  return compactCrateName(ERA_LABELS[normalizeEra(era)] || String(era || ""));
}

function legacyNameCandidates(displayName) {
  const names = new Set([displayName]);
  const eraRanges = {
    Vintage: "Vintage (pre-1970)",
    Classic: "Classic (1970-1989)",
    Retro: "Retro (1990-2009)",
    Modern: "Modern (2010-Present)",
  };

  for (const [shortLabel, longLabel] of Object.entries(eraRanges)) {
    if (displayName.endsWith(` - ${shortLabel}`)) {
      names.add(displayName.replace(` - ${shortLabel}`, ` - ${longLabel}`));
      names.add(displayName.replace(` - ${shortLabel}`, ` - ${longLabel.replace(/-/g, "–")}`));
    }
  }

  return [...names];
}

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

function normalizeEra(era) {
  const value = String(era || "all").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ERA_LABELS, value) ? value : "all";
}

function releaseYearForTrack(track) {
  try {
    const raw = JSON.parse(track.raw_json || "{}");
    const releaseDate = raw.album?.release_date || raw.release_date || "";
    const year = Number(String(releaseDate).slice(0, 4));
    return Number.isFinite(year) ? year : null;
  } catch (err) {
    return null;
  }
}

function trackMatchesEra(track, era) {
  const eraKey = normalizeEra(era);
  if (eraKey === "all") {
    return true;
  }

  const year = releaseYearForTrack(track);
  const range = ERA_RANGES[eraKey];
  if (!year || !range) {
    return false;
  }

  if (range.min && year < range.min) {
    return false;
  }
  if (range.max && year > range.max) {
    return false;
  }
  return true;
}

function parseArtistNames(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean);
    }
  } catch (err) {
    // Fall back to delimiter parsing for older rows or imported data.
  }

  return String(value || "")
    .split(/,|;|\|/)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function trackMatchesArtist(track, artistName) {
  const target = String(artistName || "").trim().toLowerCase();
  if (!target) {
    return false;
  }

  return parseArtistNames(track.artist_names).some((artist) => (
    String(artist || "").trim().toLowerCase() === target
  ));
}

function selectedDefinitionFor(selection, allTracks) {
  const type = String(selection?.type || "").trim().toLowerCase();

  if (type === "genre") {
    const playlistCode = String(selection.playlist_code || "").trim();
    const era = normalizeEra(selection.era);
    const displayName = displayNameForGenreSelection(playlistCode, era);
    return {
      playlistCode: `genre:${playlistCode}:${era}`,
      displayName,
      tracks: allTracks.filter((track) => track.playlist_code === playlistCode && trackMatchesEra(track, era)),
    };
  }

  if (type === "artist") {
    const artistName = String(selection.artist_name || "").trim();
    return {
      playlistCode: `artist:${slugify(artistName)}`,
      displayName: displayNameForArtistSelection(artistName),
      tracks: allTracks.filter((track) => trackMatchesArtist(track, artistName)),
    };
  }

  if (type === "era") {
    const era = normalizeEra(selection.era);
    return {
      playlistCode: `era:${era}`,
      displayName: displayNameForEraSelection(era),
      tracks: allTracks.filter((track) => trackMatchesEra(track, era)),
    };
  }

  return null;
}

function buildSelectedDefinitions(selections, allTracks) {
  const definitionsByCode = new Map();

  for (const selection of selections) {
    const definition = selectedDefinitionFor(selection, allTracks);
    if (!definition || !definition.displayName || !definition.playlistCode) {
      continue;
    }

    definitionsByCode.set(definition.playlistCode, definition);
  }

  return [...definitionsByCode.values()];
}

function buildAllStaticDefinitions(allTracks) {
  const tracksByPlaylistCode = groupTracksByPlaylistCode(allTracks);

  return PLAYLIST_DEFINITIONS.map((definition) => ({
    playlistCode: definition.playlistCode,
    displayName: definition.displayName,
    tracks: tracksByPlaylistCode.get(definition.playlistCode) || [],
  }));
}

function getSpotifyPlaylistByName(spotifyPlaylistsByName, displayName) {
  const normalizedPlaylists = new Map(
    [...spotifyPlaylistsByName.entries()].map(([name, playlist]) => [normalizePlaylistName(name), playlist]),
  );

  for (const candidateName of legacyNameCandidates(displayName)) {
    const playlist = normalizedPlaylists.get(normalizePlaylistName(candidateName));
    if (playlist?.id) {
      return playlist;
    }
  }

  return null;
}

async function ensureSpotifyPlaylistName(userId, playlist, displayName) {
  if (!playlist?.id || normalizePlaylistName(playlist.name) === normalizePlaylistName(displayName)) {
    return;
  }

  await spotifyPlaylists.updatePlaylistDetails(userId, playlist.id, { name: displayName });
  logSend("renamed Spotify playlist to short Crate name", {
    spotify_playlist_id: playlist.id,
    old_name: playlist.name,
    new_name: displayName,
  });
  playlist.name = displayName;
}

async function syncPlaylists(userId, options = {}) {
  const user = userRepo.findById(userId);

  if (!user?.spotify_user_id) {
    const error = new Error(`User ${userId} does not have a Spotify profile.`);
    error.statusCode = 400;
    error.code = "missing_spotify_profile";
    throw error;
  }

  const selectedPlaylists = Array.isArray(options.playlists) ? options.playlists : null;
  const allTracks = trackRepo.getSortedTracksForPlaylistSync(userId);
  const syncDefinitions = selectedPlaylists
    ? buildSelectedDefinitions(selectedPlaylists, allTracks)
    : buildAllStaticDefinitions(allTracks);

  if (selectedPlaylists && syncDefinitions.length === 0) {
    const error = new Error("Select at least one playlist before sending to Spotify.");
    error.statusCode = 400;
    error.code = "no_playlists_selected";
    throw error;
  }

  logSend("selected playlist payload", {
    user_id: userId,
    spotify_user_id: user.spotify_user_id,
    selected_playlist_count: selectedPlaylists ? selectedPlaylists.length : null,
    selected_playlists: selectedPlaylists || "all_static_playlists",
  });

  logSend("resolved playlist names", syncDefinitions.map((definition) => ({
    playlist_code: definition.playlistCode,
    display_name: definition.displayName,
    track_count: (definition.tracks || []).length,
  })));

  playlistRepo.upsertPlaylistDefinitions([
    ...PLAYLIST_DEFINITIONS,
    ...syncDefinitions.map((definition) => ({
      playlistCode: definition.playlistCode,
      displayName: definition.displayName,
    })),
  ]);

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
    playlist_results: [],
    errors: [],
    selected_playlist_count: selectedPlaylists ? selectedPlaylists.length : null,
    resolved_playlist_count: syncDefinitions.length,
    skipped_playlists: 0,
  };

  try {
    const definitionsByCode = playlistRepo.getPlaylistDefinitionsByCode();
    const spotifyPlaylistsByName = await spotifyPlaylists.getCurrentUserPlaylistsByName(
      userId,
      user.spotify_user_id,
    );

    for (const syncDefinition of syncDefinitions) {
      const definition = definitionsByCode.get(syncDefinition.playlistCode) || syncDefinition;
      const tracks = syncDefinition.tracks || [];
      const playlistCode = syncDefinition.playlistCode;
      const displayName = syncDefinition.displayName || definition.display_name || definition.displayName;

      summary.playlists_checked += 1;

      try {
        let spotifyPlaylistId = definition.spotify_playlist_id;
        const localUris = uniqueUrisForTracks(tracks);

        const shouldSkipEmptyPlaylist = localUris.length === 0 && (selectedPlaylists || !spotifyPlaylistId);

        if (shouldSkipEmptyPlaylist) {
          summary.skipped_playlists += 1;
          logSend("skipped playlist", {
            playlist_code: playlistCode,
            display_name: displayName,
            reason: "no_matching_tracks",
          });
          summary.playlist_results.push({
            playlist_code: playlistCode,
            display_name: displayName,
            tracks_added: 0,
            tracks_removed: 0,
            skipped: true,
            message: "No matching tracks for selected playlist.",
          });
          continue;
        }

        const existingPlaylist = getSpotifyPlaylistByName(spotifyPlaylistsByName, displayName);

        if (existingPlaylist?.id && existingPlaylist.id !== spotifyPlaylistId) {
          await ensureSpotifyPlaylistName(userId, existingPlaylist, displayName);
          spotifyPlaylistId = existingPlaylist.id;
          playlistRepo.updateSpotifyPlaylistId(playlistCode, spotifyPlaylistId);
          summary.playlists_found_existing += 1;
          logSend("reused existing Spotify playlist by name", {
            playlist_code: playlistCode,
            display_name: displayName,
            spotify_playlist_id: spotifyPlaylistId,
          });
        } else if (existingPlaylist?.id && spotifyPlaylistId) {
          await ensureSpotifyPlaylistName(userId, existingPlaylist, displayName);
          summary.playlists_reused_from_db += 1;
          logSend("reused Spotify playlist from local DB", {
            playlist_code: playlistCode,
            display_name: displayName,
            spotify_playlist_id: spotifyPlaylistId,
          });
        } else if (spotifyPlaylistId) {
          summary.playlists_reused_from_db += 1;
          logSend("reused Spotify playlist from local DB", {
            playlist_code: playlistCode,
            display_name: displayName,
            spotify_playlist_id: spotifyPlaylistId,
          });
        } else if (existingPlaylist?.id) {
          await ensureSpotifyPlaylistName(userId, existingPlaylist, displayName);
          spotifyPlaylistId = existingPlaylist.id;
          playlistRepo.updateSpotifyPlaylistId(playlistCode, spotifyPlaylistId);
          summary.playlists_found_existing += 1;
          logSend("reused existing Spotify playlist by name", {
            playlist_code: playlistCode,
            display_name: displayName,
            spotify_playlist_id: spotifyPlaylistId,
          });
        }

        if (!spotifyPlaylistId) {
          const playlist = await spotifyPlaylists.createPlaylist(userId, user.spotify_user_id, {
            name: displayName,
            description: "Managed by Crate MVP.",
          });

          spotifyPlaylistId = playlist.id;
          playlistRepo.updateSpotifyPlaylistId(playlistCode, spotifyPlaylistId);
          spotifyPlaylistsByName.set(displayName, playlist);
          summary.playlists_created += 1;
          logSend("created Spotify playlist", {
            playlist_code: playlistCode,
            display_name: displayName,
            spotify_playlist_id: spotifyPlaylistId,
          });
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

        const playlistResult = {
          playlist_code: playlistCode,
          display_name: displayName,
          spotify_playlist_id: spotifyPlaylistId,
          track_count: localUris.length,
          tracks_added: urisToAdd.length,
          tracks_removed: urisToRemove.length,
          duplicates_skipped: localUris.length - urisToAdd.length,
        };

        summary.playlist_results.push(playlistResult);
        logSend("playlist sync result", playlistResult);
      } catch (err) {
        console.error("[Crate Send] Spotify playlist sync error", {
          playlist_code: playlistCode,
          display_name: displayName,
          message: err.message,
        });
        summary.errors.push({
          playlist_code: playlistCode,
          display_name: displayName,
          message: err.message,
        });
      }
    }

    const completedPlaylists = summary.playlist_results.filter((result) => (
      !result.skipped && result.spotify_playlist_id
    ));

    if (summary.errors.length > 0 && completedPlaylists.length === 0) {
      summary.status = "error";
    } else if (summary.errors.length > 0 || completedPlaylists.length === 0) {
      summary.status = "warning";
    } else if (summary.tracks_added === 0 && summary.tracks_removed === 0) {
      summary.status = "up_to_date";
    }

    logSend("playlist sync summary", {
      status: summary.status,
      spotify_user_id: user.spotify_user_id,
      playlists_checked: summary.playlists_checked,
      playlists_created: summary.playlists_created,
      playlists_found_existing: summary.playlists_found_existing,
      playlists_reused_from_db: summary.playlists_reused_from_db,
      skipped_playlists: summary.skipped_playlists,
      tracks_added: summary.tracks_added,
      tracks_removed: summary.tracks_removed,
      errors: summary.errors,
    });
  } finally {
    playlistRepo.finishPlaylistSyncRun(run.run_id, summary);
  }

  return summary;
}

module.exports = {
  PLAYLIST_DEFINITIONS,
  normalizePlaylistName,
  syncPlaylists,
};
