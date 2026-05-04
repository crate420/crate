const express = require("express");
const path = require("node:path");
const config = require("../config");
const {
  getAdminPlaylistOverview,
  getAdminPlaylistTracks,
} = require("../crate/adminPlaylists");
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
const { getCrateStatus } = require("../crate/status");
const { syncPlaylists } = require("../crate/syncPlaylists");
const { syncLikedSongs } = require("../crate/syncLikedSongs");
const { sortTracks } = require("../crate/sortTracks");
const { applyTrackOverride, getTrackForReview } = require("../crate/trackOverrides");
const { importTrainingData } = require("../crate/trainingImport");
const { getUnmatchedDiagnostics } = require("../crate/unmatchedDiagnostics");
const { getUnmatchedGenreSummary } = require("../crate/unmatchedGenres");
const { getUnmatchedTracks } = require("../crate/unmatchedTracks");
const artistGenreRepo = require("../repositories/artistGenres");
const runs = require("../repositories/runs");
const trackRepo = require("../repositories/tracks");
const spotifyTracks = require("../spotify/tracks");
const { requireCurrentUser } = require("../utils/authSession");

const router = express.Router();

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

async function syncLikedHandler(req, res, next) {
  const run = runs.startRun(req.currentUser.id);

  try {
    const summary = await syncLikedSongs(req.currentUser.id);
    const finishedRun = runs.finishRun(run.id, "success", {
      step: "syncLikedSongs",
      ...summary,
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
      summary,
    });
  } catch (err) {
    runs.finishRun(run.id, "failed", {
      step: "syncLikedSongs",
      error: err.message,
    });

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
    return res.json(getCrateStatus());
  } catch (err) {
    return next(err);
  }
});

router.post("/sort", requireCurrentUser, async (req, res, next) => {
  const run = runs.startRun(req.currentUser.id);

  try {
    const summary = await sortTracks(req.currentUser.id);
    const finishedRun = runs.finishRun(run.id, "success", {
      step: "sortTracks",
      ...summary,
    });

    return res.json({
      status: "ok",
      run_id: finishedRun.id,
      processed: summary.processed,
      matched: summary.matched,
      unmatched: summary.unmatched,
    });
  } catch (err) {
    runs.finishRun(run.id, "failed", {
      step: "sortTracks",
      error: err.message,
    });

    return next(err);
  }
});

router.post("/playlists/sync", requireCurrentUser, async (req, res, next) => {
  try {
    return res.json(await syncPlaylists(req.currentUser.id));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.code || "playlist_sync_error",
        message: err.message,
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

router.get("/admin/playlists", (req, res) => {
  return res.sendFile(path.join(__dirname, "../../public/admin-playlists.html"));
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

router.get("/admin/playlists.json", requireCurrentUser, (req, res, next) => {
  try {
    return res.json(getAdminPlaylistOverview(req.currentUser.id));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/playlists/:code/tracks", requireCurrentUser, (req, res, next) => {
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

router.get("/artist-genre-suggestions", requireCurrentUser, (req, res, next) => {
  try {
    return res.json(getArtistGenreSuggestions({ status: req.query.status }));
  } catch (err) {
    return next(err);
  }
});

router.post("/artist-genre-suggestions/apply", requireCurrentUser, (req, res, next) => {
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

router.post("/artist-genre-suggestions/apply-all", requireCurrentUser, (req, res, next) => {
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

router.get("/lastfm-artist-genre-suggestions", requireCurrentUser, (req, res, next) => {
  try {
    return res.json(getLastfmArtistGenreSuggestions({ status: req.query.status }));
  } catch (err) {
    return next(err);
  }
});

router.post("/lastfm-artist-genre-suggestions/apply", requireCurrentUser, (req, res, next) => {
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

router.get("/admin/review-queue", requireCurrentUser, async (req, res, next) => {
  try {
    return res.json(await getAdminReviewQueue(req.currentUser.id));
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/review-queue/apply", requireCurrentUser, (req, res, next) => {
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

router.post("/admin/review-queue/ignore", requireCurrentUser, (req, res, next) => {
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
