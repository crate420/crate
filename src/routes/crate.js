const express = require("express");
const path = require("node:path");
const config = require("../config");
const { openDatabase } = require("../db");
const {
  getAdminPlaylistOverview,
  getAdminPlaylistTracks,
} = require("../crate/adminPlaylists");
const {
  getAdminUnmatchedReview,
  getAdminUnmatchedReviewCsv,
} = require("../crate/adminUnmatchedReview");
const {
  applyAdminReviewQueueArtist,
  getAdminReviewQueue,
  ignoreAdminReviewQueueArtist,
} = require("../crate/adminReviewQueue");
const {
  applyHighConfidenceArtistGenreSuggestions,
  getArtistGenreSuggestions,
  getCuratedArtistSuggestion,
  getMissingArtistGenreSuggestions,
} = require("../crate/artistGenreSuggestions");
const { importArtistGenreSeed } = require("../crate/artistGenreSeedImport");
const {
  applyLastfmArtistGenreSuggestion,
  applySafeLastfmArtistGenreSuggestionBatch,
  fetchLastfmArtistGenreSuggestions,
  getLastfmArtistGenreSuggestions,
} = require("../crate/lastfmGenreSuggestions");
const { getDatabaseDiagnostics } = require("../crate/dbDiagnostics");
const { getMissingArtistGenres } = require("../crate/missingArtistGenres");
const { fetchAndCacheMusicBrainzArtistIntelligence } = require("../crate/musicbrainzArtistIntelligence");
const { getCrateStatus, getGlobalCrateStatus } = require("../crate/status");
const { getTopArtists } = require("../crate/topArtists");
const { syncPlaylists } = require("../crate/syncPlaylists");
const { syncLikedSongs } = require("../crate/syncLikedSongs");
const { sortTracks } = require("../crate/sortTracks");
const { fetchAndCacheSpotifyArtistIntelligence } = require("../crate/spotifyArtistIntelligence");
const { applyTrackOverride, getTrackForReview } = require("../crate/trackOverrides");
const { importTrainingData } = require("../crate/trainingImport");
const { getUnmatchedDiagnostics } = require("../crate/unmatchedDiagnostics");
const { getUnmatchedGenreSummary } = require("../crate/unmatchedGenres");
const { getUnmatchedGenreLearningSummary } = require("../crate/unmatchedGenreLearning");
const { getUnmatchedTracks } = require("../crate/unmatchedTracks");
const artistGenreRepo = require("../repositories/artistGenres");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const betaAccessCodes = require("../repositories/betaAccessCodes");
const runs = require("../repositories/runs");
const trackRepo = require("../repositories/tracks");
const spotifyTracks = require("../spotify/tracks");
const { getCurrentUser, requireCurrentUser } = require("../utils/authSession");

const router = express.Router();

const lastSortFlowSyncTimingByUserId = new Map();

function seconds(valueMs) {
  return Number.isFinite(Number(valueMs)) ? (Number(valueMs) / 1000).toFixed(1) + "s" : "n/a";
}

function logCrateTiming({ likedSongsFetchMs, trackScanMs, playlistSortMs, totalSortFlowMs, tracksProcessed }) {
  console.log([
    "[Crate Timing]",
    "Liked Songs Fetch: " + seconds(likedSongsFetchMs),
    "Track Scan: " + seconds(trackScanMs),
    "Playlist Sort: " + seconds(playlistSortMs),
    "Total Sort Flow: " + seconds(totalSortFlowMs),
    "Tracks Processed: " + (Number.isFinite(Number(tracksProcessed)) ? tracksProcessed : "n/a"),
  ].join("\n"));
}

function logCrateFlowError(step, currentUser, err) {
  console.error("[Crate Flow] " + step + " failed", {
    user_id: currentUser?.id || null,
    spotify_user_id: currentUser?.spotify_user_id || null,
    code: err.code || "unknown_error",
    status_code: err.statusCode || 500,
    spotify_status: err.spotifyStatus || null,
    message: err.message,
  });
}

function sendKnownCrateFlowError(res, step, err) {
  if (!err.statusCode) {
    return false;
  }

  res.status(err.statusCode).json({
    error: err.code || "crate_flow_error",
    message: err.message,
    step,
    spotify_status: err.spotifyStatus || null,
  });

  return true;
}

function requireAdminUser(req, res, next) {
  if (
    !config.adminSpotifyUserId ||
    req.currentUser.spotify_user_id !== config.adminSpotifyUserId
  ) {
    return res.status(403).json({
      error: "forbidden",
      message: "This route is restricted to the configured Crate admin.",
    });
  }

  return next();
}

function hasSuccessfulSortForUser(userId) {
  const db = openDatabase();

  const sortedTracks = db.prepare(`
    SELECT COUNT(*) AS count
    FROM user_tracks
    WHERE user_id = ?
      AND playlist_code IS NOT NULL
  `).get(userId).count;

  if (sortedTracks === 0) {
    return false;
  }

  const recentRuns = db.prepare(`
    SELECT status, summary_json
    FROM crate_runs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(userId);

  return recentRuns.some((run) => {
    if (run.status !== "success") {
      return false;
    }

    try {
      return JSON.parse(run.summary_json || "{}").step === "sortTracks";
    } catch (err) {
      return false;
    }
  });
}


async function syncLikedHandler(req, res, next) {
  const flowStartedAt = process.hrtime.bigint();
  const run = runs.startRun(req.currentUser.id);

  try {
    console.log("[Crate Flow] sync-liked-songs request started", {
      user_id: req.currentUser.id,
      spotify_user_id: req.currentUser.spotify_user_id,
    });
    const summary = await syncLikedSongs(req.currentUser.id);
    lastSortFlowSyncTimingByUserId.set(req.currentUser.id, {
      startedAt: flowStartedAt,
      timing: summary.timing,
      createdAt: Date.now(),
    });
    logCrateTiming({
      likedSongsFetchMs: summary.timing?.likedSongsFetchMs,
      trackScanMs: summary.timing?.trackScanMs,
      tracksProcessed: summary.timing?.tracksFetched || summary.seen,
    });
    const finishedRun = runs.finishRun(run.id, "success", {
      step: "syncLikedSongs",
      ...summary,
    });

    console.log("[Crate Flow] sync-liked-songs request complete", {
      user_id: req.currentUser.id,
      tracks_synced: summary.seen,
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: summary.skipped,
    });

    return res.json({
      status: "ok",
      run_id: finishedRun.id,
      synced: summary.seen,
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: summary.skipped,
      user_tracks_inserted: summary.userTracksInserted,
      user_tracks_updated: summary.userTracksUpdated,
      total_stored_for_user: summary.totalStoredForUser,
      errors: [],
      timing: summary.timing,
      summary,
    });
  } catch (err) {
    runs.finishRun(run.id, "failed", {
      step: "syncLikedSongs",
      error: err.message,
    });
    logCrateFlowError("syncLikedSongs", req.currentUser, err);

    if (sendKnownCrateFlowError(res, "syncLikedSongs", err)) {
      return undefined;
    }

    return next(err);
  }
}

router.post("/sync-liked", requireCurrentUser, syncLikedHandler);
router.post("/sync-liked-songs", requireCurrentUser, syncLikedHandler);

if (process.env.NODE_ENV !== "production") {
  router.get("/sync-liked", requireCurrentUser, syncLikedHandler);
}

router.get("/status", (req, res, next) => {
  try {
    const currentUser = getCurrentUser(req, res);
    return res.json(getCrateStatus({ userId: currentUser?.id || null }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/status", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getGlobalCrateStatus());
  } catch (err) {
    return next(err);
  }
});

router.get("/top-artists", (req, res, next) => {
  try {
    const currentUser = getCurrentUser(req, res);
    if (!currentUser) {
      return res.json([]);
    }

    return res.json(getTopArtists({ limit: req.query.limit, userId: currentUser.id }));
  } catch (err) {
    return next(err);
  }
});

router.post("/sort", requireCurrentUser, async (req, res, next) => {
  const run = runs.startRun(req.currentUser.id);

  try {
    console.log("[Crate Flow] sort request started", {
      user_id: req.currentUser.id,
      spotify_user_id: req.currentUser.spotify_user_id,
    });
    const summary = await sortTracks(req.currentUser.id);
    const syncTiming = lastSortFlowSyncTimingByUserId.get(req.currentUser.id);
    const syncTimingIsFresh = syncTiming && Date.now() - syncTiming.createdAt < 10 * 60 * 1000;
    const totalSortFlowMs = syncTimingIsFresh
      ? Number(process.hrtime.bigint() - syncTiming.startedAt) / 1_000_000
      : summary.timing?.totalSortMs;

    logCrateTiming({
      likedSongsFetchMs: syncTimingIsFresh ? syncTiming.timing?.likedSongsFetchMs : undefined,
      trackScanMs: syncTimingIsFresh ? syncTiming.timing?.trackScanMs : undefined,
      playlistSortMs: summary.timing?.playlistSortMs,
      totalSortFlowMs,
      tracksProcessed: summary.processed,
    });

    const finishedRun = runs.finishRun(run.id, "success", {
      step: "sortTracks",
      ...summary,
    });

    console.log("[Crate Flow] sort request complete", {
      user_id: req.currentUser.id,
      processed: summary.processed,
      matched: summary.matched,
      unmatched: summary.unmatched,
    });

    return res.json({
      status: "ok",
      run_id: finishedRun.id,
      processed: summary.processed,
      matched: summary.matched,
      unmatched: summary.unmatched,
      discovery: summary.discovery || {
        topArtists: [],
        topGenres: [],
        topScenes: [],
        topCollections: [],
        topSpecialInterest: [],
      },
      timing: {
        ...summary.timing,
        likedSongsFetchMs: syncTimingIsFresh ? syncTiming.timing?.likedSongsFetchMs : undefined,
        trackScanMs: syncTimingIsFresh ? syncTiming.timing?.trackScanMs : undefined,
        totalSortFlowMs,
      },
    });
  } catch (err) {
    runs.finishRun(run.id, "failed", {
      step: "sortTracks",
      error: err.message,
    });
    logCrateFlowError("sortTracks", req.currentUser, err);

    if (sendKnownCrateFlowError(res, "sortTracks", err)) {
      return undefined;
    }

    return next(err);
  }
});

router.post("/playlists/sync", requireCurrentUser, async (req, res, next) => {
  try {
    if (!hasSuccessfulSortForUser(req.currentUser.id)) {
      return res.status(409).json({
        error: "sort_required",
        message: "Run Sort before sending playlists to Spotify.",
      });
    }

    const selectedPlaylists = Array.isArray(req.body?.playlists) ? req.body.playlists : undefined;
    console.log("[Crate Send] route received playlist sync request", {
      user_id: req.currentUser.id,
      spotify_user_id: req.currentUser.spotify_user_id,
      content_length: req.get("content-length") || null,
      payload_bytes: Buffer.byteLength(JSON.stringify(req.body || {})),
      selected_playlist_count: selectedPlaylists ? selectedPlaylists.length : null,
      selected_playlists: selectedPlaylists || "all_static_playlists",
    });

    return res.json(await syncPlaylists(req.currentUser.id, {
      playlists: selectedPlaylists,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "playlist_sync_error",
        message: err.message,
        summary: err.summary || null,
      });
    }

    return next(err);
  }
});

router.get("/spotify/liked-songs", requireCurrentUser, async (req, res, next) => {
  try {
    const page = await spotifyTracks.getLikedTracksPage(req.currentUser.id, {
      limit: 20,
      offset: 0,
    });

    return res.json({
      status: "ok",
      count: page.items?.length || 0,
      tracks: (page.items || []).map((item) => ({
        track_name: item.track?.name || null,
        artist_name: item.track?.artists?.map((artist) => artist.name).join(", ") || null,
        album: item.track?.album?.name || null,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/playlists", requireCurrentUser, requireAdminUser, (req, res) => {
  return res.sendFile(path.join(__dirname, "../../public/admin-playlists.html"));
});

router.get("/admin/unmatched-review", requireCurrentUser, requireAdminUser, (req, res) => {
  return res.sendFile(path.join(__dirname, "../../public/admin-unmatched.html"));
});

router.get("/admin/unmatched-review.json", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminUnmatchedReview(req.currentUser.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/unmatched-review.csv", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    const csv = await getAdminUnmatchedReviewCsv(req.currentUser.id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=crate-unmatched-tracks.csv");
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
});

router.post(
  "/admin/import-training",
  requireCurrentUser,
  requireAdminUser,
  (req, res, next) => {
    try {
      return res.json(importTrainingData());
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          error: err.code || "training_import_error",
          message: err.message,
        });
      }

      return next(err);
    }
  },
);

router.post(
  "/admin/import-artist-genres",
  requireCurrentUser,
  requireAdminUser,
  (req, res, next) => {
    try {
      return res.json(importArtistGenreSeed());
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          error: err.code || "artist_genre_import_error",
          message: err.message,
        });
      }

      return next(err);
    }
  },
);

router.post(
  "/admin/resort-all",
  requireCurrentUser,
  requireAdminUser,
  async (req, res, next) => {
    try {
      const reset = trackRepo.clearPlaylistCodesForUser(req.currentUser.id);
      const summary = await sortTracks(req.currentUser.id);

      return res.json({
        status: "ok",
        reset_tracks: reset.reset_tracks,
        processed: summary.processed,
        matched: summary.matched,
        unmatched: summary.unmatched,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  "/admin/db-diagnostics",
  requireCurrentUser,
  requireAdminUser,
  (req, res, next) => {
    try {
      return res.json({
        status: "ok",
        ...getDatabaseDiagnostics(req.currentUser.id),
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  "/admin/beta-claims",
  requireCurrentUser,
  requireAdminUser,
  (req, res, next) => {
    try {
      const claims = betaAccessCodes.listClaims();
      return res.json({
        status: "ok",
        count: claims.length,
        claims,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.get("/admin/playlists.json", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminPlaylistOverview(req.currentUser.id));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/playlists/:code/tracks", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminPlaylistTracks(req.currentUser.id, req.params.code));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "admin_playlist_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.post("/track/override", requireCurrentUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      ...applyTrackOverride(req.currentUser.id, {
        trackId: req.body?.track_id,
        playlistCode: req.body?.playlist_code,
      }),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "track_override_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.get("/track/:id", requireCurrentUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      track: getTrackForReview(req.currentUser.id, req.params.id),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "track_lookup_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.get("/unmatched", requireCurrentUser, async (req, res, next) => {
  try {
    const result = await getUnmatchedTracks(req.currentUser.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.get("/unmatched-genres", requireCurrentUser, async (req, res, next) => {
  try {
    const result = await getUnmatchedGenreSummary(req.currentUser.id, {
      limit: req.query.limit,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.get("/unmatched-diagnostics", requireCurrentUser, async (req, res, next) => {
  try {
    const result = await getUnmatchedDiagnostics(req.currentUser.id);

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/unmatched-genre-learning", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getUnmatchedGenreLearningSummary(req.currentUser.id, {
      limit: req.query.limit,
      recentLimit: req.query.recent_limit,
      scope: req.query.scope,
    }));
  } catch (err) {
    return next(err);
  }
});

function serializeArtistIntelligence(row) {
  return {
    id: row.id,
    artist_name: row.display_artist_name,
    normalized_artist_name: row.normalized_artist_name,
    spotify_artist_id: row.spotify_artist_id,
    review_status: row.review_status,
    source_count: row.source_count,
    confidence_score: row.confidence_score,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseArtistIntelligenceSignals(value) {
  try {
    const signals = JSON.parse(value || "[]");
    return Array.isArray(signals) ? signals : [];
  } catch (err) {
    return [];
  }
}

function serializeArtistIntelligenceSource(row) {
  return {
    id: row.id,
    source: row.source,
    source_artist_id: row.source_artist_id,
    source_artist_name: row.source_artist_name,
    normalized_signals: parseArtistIntelligenceSignals(row.normalized_signals_json),
    error_code: row.error_code,
    error_message: row.error_message,
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
    updated_at: row.updated_at,
  };
}

router.get("/admin/artist-intelligence", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const options = {
      limit: req.query.limit,
      offset: req.query.offset,
      reviewStatus: req.query.review_status,
      search: req.query.search,
    };
    const artists = artistIntelligenceRepo.listArtistIntelligence(options).map(serializeArtistIntelligence);

    return res.json({
      status: "ok",
      count: artists.length,
      summary: artistIntelligenceRepo.getArtistIntelligenceSummary(options),
      artists,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/artist-intelligence/:id", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const artist = artistIntelligenceRepo.getArtistIntelligenceById(req.params.id);

    if (!artist) {
      return res.status(404).json({
        error: "artist_intelligence_not_found",
        message: "Artist intelligence record not found.",
      });
    }

    const sources = artistIntelligenceRepo
      .listArtistIntelligenceSources(artist.id)
      .map(serializeArtistIntelligenceSource);

    return res.json({
      status: "ok",
      artist: serializeArtistIntelligence(artist),
      sources,
      source_summary: {
        count: sources.length,
        available: sources.map((source) => source.source),
        expected: ["spotify", "lastfm", "musicbrainz"],
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/artist-intelligence/musicbrainz/fetch", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      intelligence: await fetchAndCacheMusicBrainzArtistIntelligence({
        artistName: req.body?.artistName,
        artistIntelligenceId: req.body?.artistIntelligenceId,
      }),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "musicbrainz_fetch_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.post("/admin/artist-intelligence/spotify/fetch", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      intelligence: await fetchAndCacheSpotifyArtistIntelligence(req.currentUser.id, {
        artistName: req.body?.artistName,
        artistIntelligenceId: req.body?.artistIntelligenceId,
      }),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "spotify_artist_intelligence_fetch_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.get("/missing-artist-genres", requireCurrentUser, async (req, res, next) => {
  try {
    const result = await getMissingArtistGenres(req.currentUser.id, {
      limit: req.query.limit,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.get("/missing-artist-genre-suggestions", requireCurrentUser, async (req, res, next) => {
  try {
    const result = await getMissingArtistGenreSuggestions(req.currentUser.id, {
      limit: req.query.limit,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.get("/artist-genre-suggestions", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getArtistGenreSuggestions({ status: req.query.status }));
  } catch (err) {
    return next(err);
  }
});

router.post("/artist-genre-suggestions/apply", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const artistName = req.body?.artist_name;

    if (!artistName || typeof artistName !== "string") {
      return res.status(400).json({
        error: "invalid_artist_name",
        message: "artist_name is required.",
      });
    }

    const suggestion = getCuratedArtistSuggestion(artistName);

    if (!suggestion) {
      return res.status(404).json({
        error: "suggestion_not_found",
        message: "No curated seed suggestion found for this artist.",
      });
    }

    const result = artistGenreRepo.insertArtistGenres({
      artistName: suggestion.artistName,
      genres: suggestion.suggestedGenres,
      source: suggestion.source,
    });

    return res.json({
      status: "ok",
      artist_name: suggestion.artistName,
      inserted_count: result.inserted,
      source: suggestion.source,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/artist-genre-suggestions/apply-all", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      ...applyHighConfidenceArtistGenreSuggestions(),
    });
  } catch (err) {
    return next(err);
  }
});

router.post(
  "/lastfm-artist-genre-suggestions/fetch",
  requireCurrentUser,
  requireAdminUser,
  async (req, res, next) => {
    try {
      const result = await fetchLastfmArtistGenreSuggestions(req.currentUser.id, {
        limit: req.query.limit,
      });

      return res.json({
        status: "ok",
        ...result,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          error: err.code || "lastfm_fetch_error",
          message: err.message,
        });
      }

      return next(err);
    }
  },
);

router.get("/lastfm-artist-genre-suggestions", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getLastfmArtistGenreSuggestions({ status: req.query.status }));
  } catch (err) {
    return next(err);
  }
});

router.post("/lastfm-artist-genre-suggestions/apply", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const result = applyLastfmArtistGenreSuggestion(req.body?.artist_name);

    return res.json({
      status: "ok",
      ...result,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "lastfm_suggestion_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.post(
  "/lastfm-artist-genre-suggestions/apply-safe-batch",
  requireCurrentUser,
  requireAdminUser,
  (req, res, next) => {
    try {
      return res.json({
        status: "ok",
        ...applySafeLastfmArtistGenreSuggestionBatch(),
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.get("/admin/review-queue", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminReviewQueue(req.currentUser.id));
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/review-queue/apply", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      ...applyAdminReviewQueueArtist({
        artistName: req.body?.artist_name,
        genres: req.body?.genres,
      }),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "admin_review_queue_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

router.post("/admin/review-queue/ignore", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      ...ignoreAdminReviewQueueArtist(req.body?.artist_name),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "admin_review_queue_error",
        message: err.message,
      });
    }

    return next(err);
  }
});

module.exports = router;
