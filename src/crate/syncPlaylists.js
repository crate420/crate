const playlistRepo = require("../repositories/playlists");
const trackRepo = require("../repositories/tracks");
const userRepo = require("../repositories/users");
const spotifyPlaylists = require("../spotify/playlists");
const { PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { effectiveReleaseYearForRow } = require("./eraYears");
const { resolveSpecialtyTracksForUser, seedCodeForSpecialtyPlaylistCode, specialtyPlaylistCodeForSeed } = require("./specialtyTrackResolver");

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

function displayNameForSpecialtySelection(seedCode, playlistCode = null) {
  const effectivePlaylistCode = playlistCode || specialtyPlaylistCodeForSeed(seedCode);
  const definition = PLAYLIST_DEFINITIONS.find((candidate) => candidate.playlistCode === effectivePlaylistCode);
  if (definition?.displayName) return definition.displayName;
  return compactCrateName(String(seedCode || "").split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "));
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
  return effectiveReleaseYearForRow(track);
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

function specialtyTracksForSelection(userId, seedCode) {
  const preview = resolveSpecialtyTracksForUser(userId, seedCode, { limit: 10000 });
  return (preview.tracks || []).map((track) => ({
    ...track,
    uri: track.spotify_uri,
    playlist_code: preview.playlist_code,
  }));
}

function selectedDefinitionFor(selection, allTracks, userId) {
  const type = String(selection?.type || "").trim().toLowerCase();

  if (type === "genre") {
    const playlistCode = String(selection.playlist_code || "").trim();
    const era = normalizeEra(selection.era);
    const displayName = displayNameForGenreSelection(playlistCode, era);
    return {
      playlistCode: `genre:${playlistCode}:${era}`,
      displayName,
      source: "selected",
      selection: { type: "genre", playlist_code: playlistCode, era },
      tracks: allTracks.filter((track) => track.playlist_code === playlistCode && trackMatchesEra(track, era)),
    };
  }

  if (type === "artist") {
    const artistName = String(selection.artist_name || "").trim();
    return {
      playlistCode: `artist:${slugify(artistName)}`,
      displayName: displayNameForArtistSelection(artistName),
      source: "selected",
      selection: { type: "artist", artist_name: artistName },
      tracks: allTracks.filter((track) => trackMatchesArtist(track, artistName)),
    };
  }

  if (type === "era") {
    const era = normalizeEra(selection.era);
    return {
      playlistCode: `era:${era}`,
      displayName: displayNameForEraSelection(era),
      source: "selected",
      selection: { type: "era", era },
      tracks: allTracks.filter((track) => trackMatchesEra(track, era)),
    };
  }

  if (type === "specialty") {
    const seedCode = String(selection.seed_code || "").trim() || seedCodeForSpecialtyPlaylistCode(selection.playlist_code);
    const playlistCode = specialtyPlaylistCodeForSeed(seedCode);
    if (!seedCode || !playlistCode) return null;
    return {
      playlistCode,
      displayName: displayNameForSpecialtySelection(seedCode, playlistCode),
      source: "specialty",
      selection: { type: "specialty", seed_code: seedCode, playlist_code: playlistCode },
      tracks: specialtyTracksForSelection(userId, seedCode),
    };
  }

  return null;
}

function buildSelectedDefinitions(selections, allTracks, userId) {
  const definitionsByCode = new Map();

  for (const selection of selections) {
    const definition = selectedDefinitionFor(selection, allTracks, userId);
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
    source: "static",
    selection: { type: "static", playlist_code: definition.playlistCode },
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
    ? buildSelectedDefinitions(selectedPlaylists, allTracks, userId)
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
    playlist_results: [],
    errors: [],
    selected_playlist_count: selectedPlaylists ? selectedPlaylists.length : null,
    resolved_playlist_count: syncDefinitions.length,
    skipped_playlists: 0,
  };

  try {
    const spotifyPlaylistsByName = await spotifyPlaylists.getCurrentUserPlaylistsByName(
      userId,
      user.spotify_user_id,
    );

    for (const syncDefinition of syncDefinitions) {
      const tracks = syncDefinition.tracks || [];
      const playlistCode = syncDefinition.playlistCode;
      const displayName = syncDefinition.displayName;
      const instanceSource = syncDefinition.source || (selectedPlaylists ? "selected" : "static");
      const selectionJson = syncDefinition.selection || null;

      summary.playlists_checked += 1;

      try {
        const localUris = uniqueUrisForTracks(tracks);
        let spotifyPlaylistId = null;
        let resolutionSource = "none";
        let userPlaylistInstance = playlistRepo.findUserPlaylistInstance(userId, playlistCode);

        logSend("selected playlist definition", {
          user_id: userId,
          spotify_user_id: user.spotify_user_id,
          playlist_code: playlistCode,
          display_name: displayName,
          track_count: localUris.length,
          source: instanceSource,
          selection: selectionJson,
        });

        if (userPlaylistInstance?.spotify_playlist_id) {
          spotifyPlaylistId = userPlaylistInstance.spotify_playlist_id;
          resolutionSource = "user_playlist_instance";
        }

        logSend("user playlist instance resolved", {
          user_id: userId,
          spotify_user_id: user.spotify_user_id,
          playlist_code: playlistCode,
          display_name: displayName,
          user_playlist_instance_id: userPlaylistInstance?.id || null,
          spotify_playlist_id: spotifyPlaylistId,
          resolution_source: resolutionSource,
        });

        const shouldSkipEmptyPlaylist = localUris.length === 0 && (selectedPlaylists || !spotifyPlaylistId);

        if (shouldSkipEmptyPlaylist) {
          summary.skipped_playlists += 1;
          logSend("skipped playlist", {
            user_id: userId,
            spotify_user_id: user.spotify_user_id,
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
          resolutionSource = "spotify_name_match";
          userPlaylistInstance = playlistRepo.upsertUserPlaylistInstance({
            userId,
            spotifyUserId: user.spotify_user_id,
            playlistCode,
            displayName,
            spotifyPlaylistId,
            spotifyOwnerId: existingPlaylist.owner?.id || user.spotify_user_id,
            source: instanceSource,
            selectionJson,
            lastTrackCount: localUris.length,
          });
          summary.playlists_found_existing += 1;
          logSend("reused current-user Spotify playlist by name", {
            user_id: userId,
            spotify_user_id: user.spotify_user_id,
            playlist_code: playlistCode,
            display_name: displayName,
            user_playlist_instance_id: userPlaylistInstance?.id || null,
            spotify_playlist_id: spotifyPlaylistId,
            resolution_source: resolutionSource,
          });
        } else if (spotifyPlaylistId) {
          userPlaylistInstance = playlistRepo.upsertUserPlaylistInstance({
            userId,
            spotifyUserId: user.spotify_user_id,
            playlistCode,
            displayName,
            spotifyPlaylistId,
            spotifyOwnerId: userPlaylistInstance?.spotify_owner_id || user.spotify_user_id,
            source: instanceSource,
            selectionJson,
            lastTrackCount: localUris.length,
          });
          summary.playlists_reused_from_db += 1;
          logSend("reused user playlist instance", {
            user_id: userId,
            spotify_user_id: user.spotify_user_id,
            playlist_code: playlistCode,
            display_name: displayName,
            user_playlist_instance_id: userPlaylistInstance?.id || null,
            spotify_playlist_id: spotifyPlaylistId,
            resolution_source: resolutionSource,
          });
        } else if (existingPlaylist?.id) {
          await ensureSpotifyPlaylistName(userId, existingPlaylist, displayName);
          spotifyPlaylistId = existingPlaylist.id;
          resolutionSource = "spotify_name_match";
          userPlaylistInstance = playlistRepo.upsertUserPlaylistInstance({
            userId,
            spotifyUserId: user.spotify_user_id,
            playlistCode,
            displayName,
            spotifyPlaylistId,
            spotifyOwnerId: existingPlaylist.owner?.id || user.spotify_user_id,
            source: instanceSource,
            selectionJson,
            lastTrackCount: localUris.length,
          });
          summary.playlists_found_existing += 1;
          logSend("reused current-user Spotify playlist by name", {
            user_id: userId,
            spotify_user_id: user.spotify_user_id,
            playlist_code: playlistCode,
            display_name: displayName,
            user_playlist_instance_id: userPlaylistInstance?.id || null,
            spotify_playlist_id: spotifyPlaylistId,
            resolution_source: resolutionSource,
          });
        }

        if (!spotifyPlaylistId) {
          const playlist = await spotifyPlaylists.createPlaylist(userId, user.spotify_user_id, {
            name: displayName,
            description: "Managed by Crate MVP.",
          });

          spotifyPlaylistId = playlist.id;
          resolutionSource = "created";
          spotifyPlaylistsByName.set(displayName, playlist);
          userPlaylistInstance = playlistRepo.upsertUserPlaylistInstance({
            userId,
            spotifyUserId: user.spotify_user_id,
            playlistCode,
            displayName,
            spotifyPlaylistId,
            spotifyOwnerId: playlist.owner?.id || user.spotify_user_id,
            source: instanceSource,
            selectionJson,
            lastTrackCount: localUris.length,
          });
          summary.playlists_created += 1;
          logSend("created user Spotify playlist instance", {
            user_id: userId,
            spotify_user_id: user.spotify_user_id,
            playlist_code: playlistCode,
            display_name: displayName,
            user_playlist_instance_id: userPlaylistInstance?.id || null,
            spotify_playlist_id: spotifyPlaylistId,
            resolution_source: resolutionSource,
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

        userPlaylistInstance = playlistRepo.markUserPlaylistInstanceSynced({
          userId,
          playlistCode,
          lastTrackCount: localUris.length,
        });

        const playlistResult = {
          playlist_code: playlistCode,
          display_name: displayName,
          user_playlist_instance_id: userPlaylistInstance?.id || null,
          spotify_playlist_id: spotifyPlaylistId,
          resolution_source: resolutionSource,
          track_count: localUris.length,
          tracks_added: urisToAdd.length,
          tracks_removed: urisToRemove.length,
          duplicates_skipped: localUris.length - urisToAdd.length,
        };

        summary.playlist_results.push(playlistResult);
        logSend("synced user playlist instance", {
          user_id: userId,
          spotify_user_id: user.spotify_user_id,
          playlist_code: playlistCode,
          display_name: displayName,
          user_playlist_instance_id: userPlaylistInstance?.id || null,
          spotify_playlist_id: spotifyPlaylistId,
          resolution_source: resolutionSource,
          tracks_added: urisToAdd.length,
          tracks_removed: urisToRemove.length,
          track_count: localUris.length,
        });
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
