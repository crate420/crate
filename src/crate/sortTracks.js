const trackRepo = require("../repositories/tracks");
const artistGenreRepo = require("../repositories/artistGenres");
const spotifyArtists = require("../spotify/artists");
const progress = require("./progress");
const { matchAlbumPlaylistCode, maybeLogScoreDebug, scorePlaylistCode } = require("./sortRules");
const { getTrackTaxonomy } = require("./taxonomyMap");
const { getArtistIds, getArtistNames, getTrackContext, parseRawTrack } = require("./trackContext");
const { logUnmatchedTrackGenres } = require("./unmatchedGenreLearning");

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function memorySnapshot() {
  const memory = process.memoryUsage();

  return {
    rss_mb: Math.round(memory.rss / 1024 / 1024),
    heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
  };
}

function emptyDiscoveryCounters() {
  return {
    artists: new Map(),
    genres: new Map(),
    scenes: new Map(),
    collections: new Map(),
    specialInterest: new Map(),
  };
}

function incrementCounter(counter, name) {
  const label = String(name || "").trim();
  if (!label) return;

  const key = label.toLowerCase();
  const existing = counter.get(key) || { name: label, count: 0 };
  existing.count += 1;
  counter.set(key, existing);
}

function incrementLabels(counter, labels = []) {
  for (const label of new Set(labels || [])) {
    incrementCounter(counter, label);
  }
}

function addTrackDiscovery(counters, context) {
  const artistNames = [...new Set((context.artistNames || []).map((name) => String(name || "").trim()).filter(Boolean))];
  for (const artistName of artistNames) {
    incrementCounter(counters.artists, artistName);
  }

  const taxonomy = getTrackTaxonomy(context);
  incrementLabels(counters.genres, taxonomy.coreGenres);
  incrementLabels(counters.scenes, taxonomy.scenes);
  incrementLabels(counters.collections, taxonomy.collections);
  incrementLabels(counters.specialInterest, taxonomy.specialInterest);
}

function rankedDiscoveryRows(counter, limit = 5) {
  return [...counter.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(({ name, count }) => ({ name, count }));
}

function buildDiscoverySummary(counters) {
  return {
    topArtists: rankedDiscoveryRows(counters.artists),
    topGenres: rankedDiscoveryRows(counters.genres),
    topScenes: rankedDiscoveryRows(counters.scenes),
    topCollections: rankedDiscoveryRows(counters.collections),
    topSpecialInterest: rankedDiscoveryRows(counters.specialInterest),
  };
}

async function sortTracks(userId) {
  const sortStartedAt = process.hrtime.bigint();
  console.log("[Crate Sort] sort started", { user_id: userId });
  progress.updateProgress(userId, {
    stage: "sort_start",
    title: "Building Your Crate",
    body: "Sorting your Liked Songs into playlists built from what you love.",
    detail: "Preparing songs for sorting",
  });
  const unsortedTracks = trackRepo.getUnsortedTracksForUser(userId);
  progress.updateProgress(userId, {
    stage: "sort_start",
    title: "Building Your Crate",
    body: "Sorting your Liked Songs into playlists built from what you love.",
    detail: `${unsortedTracks.length.toLocaleString()} songs need sorting`,
    sorted_processed: 0,
    sorted_total: unsortedTracks.length,
  });
  console.log("[Crate Sort] unsorted tracks loaded", {
    user_id: userId,
    unsorted_tracks: unsortedTracks.length,
    memory: memorySnapshot(),
  });

  console.log("[Crate Sort] prepare artist signals started", { user_id: userId });
  progress.updateProgress(userId, {
    stage: "sort_artists",
    title: "Finding Artists",
    body: "Reading artist signals from your songs.",
    detail: "Finding artists",
    sorted_processed: 0,
    sorted_total: unsortedTracks.length,
  });
  const rawTracks = unsortedTracks.map((row) => parseRawTrack(row.raw_json));
  const artistIds = rawTracks.flatMap((rawTrack) => getArtistIds(rawTrack));
  const artistNames = unsortedTracks.flatMap((row, index) =>
    getArtistNames(row, rawTracks[index]),
  );
  const uniqueArtistNames = [...new Set(artistNames.map((name) => String(name || "").trim()).filter(Boolean))];
  progress.updateProgress(userId, {
    stage: "sort_artists",
    title: "Finding Artists",
    body: "Reading artist signals from your songs.",
    detail: `${uniqueArtistNames.length.toLocaleString()} artists found`,
    artists_found: uniqueArtistNames.length,
    sorted_total: unsortedTracks.length,
  });
  console.log("[Crate Sort] artist signals prepared", {
    user_id: userId,
    artist_id_refs: artistIds.length,
    unique_artist_ids: new Set(artistIds).size,
    unique_artist_names: uniqueArtistNames.length,
    memory: memorySnapshot(),
  });

  const artistFetchStartedAt = process.hrtime.bigint();
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds, {
    onProgress: ({ batchesCompleted, batches, artistsLoaded }) => {
      progress.updateProgress(userId, {
        stage: "sort_artists",
        title: "Finding Artists",
        body: "Reading artist signals from your songs.",
        detail: batches ? `${artistsLoaded.toLocaleString()} artists loaded (${batchesCompleted}/${batches})` : `${artistsLoaded.toLocaleString()} artists loaded`,
        artists_found: Math.max(uniqueArtistNames.length, artistsLoaded),
        sorted_total: unsortedTracks.length,
      });
    },
  });
  const artistFetchMs = elapsedMs(artistFetchStartedAt);

  const fallbackStartedAt = process.hrtime.bigint();
  progress.updateProgress(userId, {
    stage: "sort_genres",
    title: "Finding Genres",
    body: "Combining Spotify and Crate genre evidence.",
    detail: "Finding genres",
    artists_found: Math.max(uniqueArtistNames.length, artistsById.size),
    sorted_total: unsortedTracks.length,
  });
  const fallbackGenresByArtistName = artistGenreRepo.findGenresByArtistNames(artistNames);
  const fallbackMs = elapsedMs(fallbackStartedAt);
  const genreCount = new Set([...fallbackGenresByArtistName.values()].flat()).size;
  progress.updateProgress(userId, {
    stage: "sort_genres",
    title: "Finding Genres",
    body: "Combining Spotify and Crate genre evidence.",
    detail: `${genreCount.toLocaleString()} genres found`,
    artists_found: Math.max(uniqueArtistNames.length, artistsById.size),
    genres_found: genreCount,
    sorted_total: unsortedTracks.length,
  });
  console.log("[Crate Sort] genre signals loaded", {
    user_id: userId,
    spotify_artists_loaded: artistsById.size,
    fallback_artists_loaded: fallbackGenresByArtistName.size,
    spotify_artist_fetch_ms: Math.round(artistFetchMs),
    fallback_genre_fetch_ms: Math.round(fallbackMs),
    memory: memorySnapshot(),
  });

  const matchingStartedAt = process.hrtime.bigint();
  progress.updateProgress(userId, {
    stage: "sort_playlists",
    title: "Building Playlists",
    body: "Sorting songs into playlist lanes.",
    detail: `0 of ${unsortedTracks.length.toLocaleString()} songs sorted`,
    sorted_processed: 0,
    sorted_total: unsortedTracks.length,
    matched: 0,
    unmatched: 0,
  });
  console.log("[Crate Sort] playlist matching started", {
    user_id: userId,
    tracks_to_match: unsortedTracks.length,
    memory: memorySnapshot(),
  });
  const assignments = [];
  const discoveryCounters = emptyDiscoveryCounters();
  let matched = 0;
  let unmatched = 0;

  let processed = 0;
  let albumFallbackClassified = 0;
  let unmatchedGenreLogAttempts = 0;
  let unmatchedGenreLogsWritten = 0;
  const albumFallbackExamples = [];

  for (const row of unsortedTracks) {
    const rawTrack = rawTracks[processed];
    processed += 1;
    const context = getTrackContext(row, artistsById, fallbackGenresByArtistName, rawTrack);
    addTrackDiscovery(discoveryCounters, context);
    const decision = scorePlaylistCode(context);
    maybeLogScoreDebug(context, decision);
    let playlistCode = row.override_playlist_code || decision.playlistCode;

    if (
      !playlistCode &&
      context.spotifyGenres.length === 0 &&
      context.fallbackGenres.length === 0
    ) {
      playlistCode = matchAlbumPlaylistCode(context);

      if (playlistCode) {
        albumFallbackClassified += 1;

        if (albumFallbackExamples.length < 5) {
          albumFallbackExamples.push({
            track_id: row.track_id,
            playlist_code: playlistCode,
            album: context.album.name,
          });
        }
      }
    }

    if (playlistCode) {
      matched += 1;
      assignments.push({
        userId,
        trackId: row.track_id,
        playlistCode,
      });
    } else {
      unmatched += 1;
      const unmatchedLogResult = logUnmatchedTrackGenres(userId, context, decision);
      unmatchedGenreLogAttempts += unmatchedLogResult.attempted;
      unmatchedGenreLogsWritten += unmatchedLogResult.logged;
    }

    if (processed % 1000 === 0 || processed === unsortedTracks.length) {
      console.log("[Crate Sort] matching progress", {
        user_id: userId,
        processed,
        total: unsortedTracks.length,
        matched,
        unmatched,
        album_fallback_classified: albumFallbackClassified,
        unmatched_genre_log_attempts: unmatchedGenreLogAttempts,
        unmatched_genre_logs_written: unmatchedGenreLogsWritten,
        memory: memorySnapshot(),
      });
    }

    if (processed % 100 === 0) {
      progress.updateProgress(userId, {
        stage: "sort_playlists",
        title: "Building Playlists",
        body: "Sorting songs into playlist lanes.",
        detail: `${processed.toLocaleString()} of ${unsortedTracks.length.toLocaleString()} songs sorted`,
        sorted_processed: processed,
        sorted_total: unsortedTracks.length,
        matched,
        unmatched,
      });
      await yieldToEventLoop();
    }
  }

  progress.updateProgress(userId, {
    stage: "sort_playlists",
    title: "Building Playlists",
    body: "Sorting songs into playlist lanes.",
    detail: `${processed.toLocaleString()} of ${unsortedTracks.length.toLocaleString()} songs sorted`,
    sorted_processed: processed,
    sorted_total: unsortedTracks.length,
    matched,
    unmatched,
  });

  console.log("[Crate Sort] playlist matching complete", {
    user_id: userId,
    processed,
    matched,
    unmatched,
    album_fallback_classified: albumFallbackClassified,
    album_fallback_examples: albumFallbackExamples,
    unmatched_genre_log_attempts: unmatchedGenreLogAttempts,
    unmatched_genre_logs_written: unmatchedGenreLogsWritten,
    duration_ms: Math.round(elapsedMs(matchingStartedAt)),
    memory: memorySnapshot(),
  });

  console.log("[Crate Sort] database assignment started", {
    user_id: userId,
    assignments: assignments.length,
  });
  progress.updateProgress(userId, {
    stage: "sort_assign",
    title: "Building Playlists",
    body: "Saving playlist matches.",
    detail: `${assignments.length.toLocaleString()} playlist matches ready`,
    sorted_processed: processed,
    sorted_total: unsortedTracks.length,
    matched,
    unmatched,
  });
  trackRepo.assignPlaylistCodes(assignments);
  console.log("[Crate Sort] database assignment complete", {
    user_id: userId,
    assignments: assignments.length,
    memory: memorySnapshot(),
  });
  const playlistSortMs = elapsedMs(matchingStartedAt);
  const totalSortMs = elapsedMs(sortStartedAt);
  const discovery = buildDiscoverySummary(discoveryCounters);
  progress.updateProgress(userId, {
    stage: "sort_profile",
    title: "Creating Your Music Profile",
    body: "Preparing your dashboard.",
    detail: `${matched.toLocaleString()} of ${unsortedTracks.length.toLocaleString()} songs sorted`,
    sorted_processed: processed,
    sorted_total: unsortedTracks.length,
    matched,
    unmatched,
    genres_found: Math.max(genreCount, discovery.topGenres.length),
  });

  console.log("[Crate Sort] discovery summary prepared", {
    user_id: userId,
    top_artists: discovery.topArtists.length,
    top_genres: discovery.topGenres.length,
    top_scenes: discovery.topScenes.length,
    top_collections: discovery.topCollections.length,
    top_special_interest: discovery.topSpecialInterest.length,
  });

  return {
    processed: unsortedTracks.length,
    matched,
    unmatched,
    unmatchedGenreLogAttempts,
    unmatchedGenreLogsWritten,
    discovery,
    timing: {
      artistFetchMs,
      fallbackMs,
      playlistSortMs,
      totalSortMs,
    },
  };
}

module.exports = {
  sortTracks,
};
