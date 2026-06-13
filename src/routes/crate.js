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
  applyAdminReviewQueueBulk,
  getAdminReviewQueue,
  ignoreAdminReviewQueueArtist,
} = require("../crate/adminReviewQueue");
const {
  applyHighConfidenceArtistGenreSuggestions,
  getArtistGenreSuggestions,
  getCuratedArtistSuggestion,
  getMissingArtistGenreSuggestions,
} = require("../crate/artistGenreSuggestions");
const { compareArtistIntelligenceSources } = require("../crate/artistIntelligenceComparison");
const { classifySignals } = require("../crate/signalClassification");
const { importArtistGenreSeed } = require("../crate/artistGenreSeedImport");
const {
  applyLastfmArtistGenreSuggestion,
  applySafeLastfmArtistGenreSuggestionBatch,
  fetchLastfmArtistGenreSuggestions,
  getLastfmArtistGenreSuggestions,
} = require("../crate/lastfmGenreSuggestions");
const {
  batchFetchArtistIntelligence,
  getStaleArtistIntelligence,
  seedArtistIntelligence,
} = require("../crate/artistIntelligenceOperations");
const {
  findRecommendation,
  getBulkRecommendationCandidates,
  getArtistRecommendationDetail,
  listArtistIntelligenceRecommendations,
  normalizeGenre,
  previewBulkRecommendations,
} = require("../crate/artistIntelligenceRecommendations");
const { getAdminArtistGapAnalysis } = require("../crate/artistGapAnalysis");
const { approveGenreRecommendation, approveSelectedGenreRecommendations, getAdminGenreRecommendations } = require("../crate/genreRecommendations");
const { getAdminGenreRecommendationRescanPlan, runAdminGenreRecommendationRescan } = require("../crate/genreRecommendationRescan");
const { getAdminRecommendationImpact } = require("../crate/recommendationImpact");
const { getAdminTrackIntelligence } = require("../crate/trackIntelligence");
const { generateTrackLearningProfiles, getAdminTrackLearningProfiles } = require("../crate/trackLearningProfiles");
const { refreshLastfmTrackIntelligence } = require("../crate/lastfmTrackIntelligence");
const { getAdminPlaylistDnaValidation } = require("../crate/playlistDnaValidation");
const { getAdminDnaEvidenceQuality } = require("../crate/dnaEvidenceQuality");
const { getAdminIntelligenceCoverage, refreshArtistCoverage, refreshTrackCoverage } = require("../crate/intelligenceCoverage");
const { getAdminArtistEnrichmentQueue, refreshLastfmArtistTagsForQueue, refreshSpotifyArtistGenresForQueue } = require("../crate/artistEnrichmentQueue");
const { getDatabaseDiagnostics } = require("../crate/dbDiagnostics");
const { getAdminEraDiagnostics } = require("../crate/eraDiagnostics");
const playlistSeedRegistry = require("../crate/playlistSeedRegistry");
const { getSeedIntelligenceReport } = require("../crate/seedIntelligence");
const { fetchAllPlaylistSeeds, fetchPlaylistSeed } = require("../crate/playlistSeedFetcher");
const { getMissingArtistGenres } = require("../crate/missingArtistGenres");
const { fetchAndCacheMusicBrainzArtistIntelligence } = require("../crate/musicbrainzArtistIntelligence");
const { getCrateStatus, getGlobalCrateStatus } = require("../crate/status");
const { getAdminUserDiagnostics } = require("../crate/userDiagnostics");
const { getAdminUserUnmatchedExport } = require("../crate/userUnmatchedExport");
const { getTopArtists } = require("../crate/topArtists");
const { getSpecialtyPlaylistValidationReport } = require("../crate/specialtyPlaylistValidation");
const { resolveSpecialtyTracksForUser } = require("../crate/specialtyTrackResolver");
const { syncPlaylists } = require("../crate/syncPlaylists");
const { syncLikedSongs } = require("../crate/syncLikedSongs");
const { sortTracks } = require("../crate/sortTracks");
const { fetchAndCacheSpotifyArtistIntelligence } = require("../crate/spotifyArtistIntelligence");
const { applyTrackOverride, getTrackForReview } = require("../crate/trackOverrides");
const { importTrainingData } = require("../crate/trainingImport");
const {
  getAdminUnmatchedDiagnostic,
  getAdminUnmatchedDiagnostics,
  getUnmatchedDiagnostics,
} = require("../crate/unmatchedDiagnostics");
const { getUnmatchedGenreSummary } = require("../crate/unmatchedGenres");
const { getUnmatchedGenreLearningSummary } = require("../crate/unmatchedGenreLearning");
const { getUnmatchedTracks } = require("../crate/unmatchedTracks");
const artistGenreRepo = require("../repositories/artistGenres");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const betaAccessCodes = require("../repositories/betaAccessCodes");
const runs = require("../repositories/runs");
const trackRepo = require("../repositories/tracks");
const trackEraOverrideRepo = require("../repositories/trackEraOverrides");
const playlistSeedCacheRepo = require("../repositories/playlistSeedCache");
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
    const specialtyPreviewEnabled = Boolean(
      currentUser && config.adminSpotifyUserId && currentUser.spotify_user_id === config.adminSpotifyUserId
    );
    const specialtySuggestionsVisible = Boolean(
      currentUser && (config.specialtySuggestionsTestVisible || specialtyPreviewEnabled)
    );
    return res.json(getCrateStatus({
      userId: currentUser?.id || null,
      specialtySuggestionsVisible,
      specialtyPreviewEnabled,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/artist-enrichment-queue", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminArtistEnrichmentQueue({
      limit: req.query.limit,
      filter: req.query.filter,
    }));
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/artist-enrichment-queue/refresh-spotify", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await refreshSpotifyArtistGenresForQueue(req.currentUser.id, {
      limit: req.body?.limit,
      filter: req.body?.filter,
    }));
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/artist-enrichment-queue/refresh-lastfm", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await refreshLastfmArtistTagsForQueue({
      limit: req.body?.limit,
      filter: req.body?.filter,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/artist-gap-analysis", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminArtistGapAnalysis({
      limit: req.query.limit,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/genre-recommendations", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminGenreRecommendations({
      limit: req.query.limit,
      preview: req.query.preview,
    }));
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/genre-recommendations/apply", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await approveGenreRecommendation({
      artist: req.body?.artist,
      playlistCode: req.body?.playlist_code || req.body?.playlistCode,
      adminUser: req.currentUser,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "genre_recommendation_approval_error", message: err.message });
    }
    return next(err);
  }
});

router.post("/admin/genre-recommendations/apply-selected", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await approveSelectedGenreRecommendations({
      selections: req.body?.selections,
      adminUser: req.currentUser,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "genre_recommendation_approval_error", message: err.message });
    }
    return next(err);
  }
});

router.get("/admin/genre-recommendation-rescan", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminGenreRecommendationRescanPlan());
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/genre-recommendation-rescan", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await runAdminGenreRecommendationRescan({
      userIds: req.body?.user_ids || req.body?.userIds,
      adminUser: req.currentUser,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "genre_recommendation_rescan_error", message: err.message });
    }
    return next(err);
  }
});

router.get("/admin/recommendation-impact", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminRecommendationImpact());
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/track-intelligence", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminTrackIntelligence({
      artist: req.query.artist,
      playlistCandidate: req.query.playlist_candidate,
      confidenceTier: req.query.confidence_tier,
      affectedUsers: req.query.affected_users,
      limit: req.query.limit,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/track-learning-profiles", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminTrackLearningProfiles({
      confidence_tier: req.query.confidence_tier,
      playlist_code: req.query.playlist_code,
      unmatched_only: req.query.unmatched_only === "1" || req.query.unmatched_only === "true",
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/track-learning/generate", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(generateTrackLearningProfiles({
      limit: req.body?.limit,
      playlist_code: req.body?.playlist_code || req.body?.playlistCode,
      unmatched_only: req.body?.unmatched_only || req.body?.unmatchedOnly,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/playlist-dna-validation", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminPlaylistDnaValidation({
      limit: req.query.limit,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/dna-evidence-quality", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminDnaEvidenceQuality());
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/intelligence-coverage", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminIntelligenceCoverage());
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/intelligence-coverage/refresh-artists", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await refreshArtistCoverage(req.currentUser.id, {
      mode: req.body?.mode,
      sources: req.body?.sources,
      limit: req.body?.limit,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "artist_intelligence_coverage_refresh_error", message: err.message });
    }
    return next(err);
  }
});

router.post("/admin/intelligence-coverage/refresh-tracks", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await refreshTrackCoverage({
      mode: req.body?.mode,
      limit: req.body?.limit,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "track_intelligence_coverage_refresh_error", message: err.message });
    }
    return next(err);
  }
});

router.post("/admin/track-intelligence/refresh-lastfm", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await refreshLastfmTrackIntelligence({
      mode: req.body?.mode,
      limit: req.body?.limit,
      trackIds: req.body?.track_ids || req.body?.trackIds,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "lastfm_track_intelligence_error", message: err.message });
    }
    return next(err);
  }
});

router.get("/admin/user-unmatched-export", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminUserUnmatchedExport({
      userId: req.query.user_id,
      limit: req.query.limit,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/user-diagnostics", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminUserDiagnostics({
      userId: req.query.user_id,
      detailLimit: req.query.limit,
    }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "user_diagnostics_error", message: err.message });
    }
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

router.get("/admin/era-diagnostics", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getAdminEraDiagnostics(req.currentUser.id, req.query));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/era-overrides", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      overrides: trackEraOverrideRepo.listTrackEraOverrides({
        limit: Number.parseInt(req.query.limit, 10) || 250,
        offset: Number.parseInt(req.query.offset, 10) || 0,
      }),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/era-overrides", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const trackId = Number.parseInt(req.body?.track_id, 10);
    const track = trackRepo.getTrackForUser(req.currentUser.id, trackId);
    if (!track) {
      return res.status(404).json({ error: "track_not_found", message: "Track was not found for this user." });
    }

    const override = trackEraOverrideRepo.upsertTrackEraOverride({
      trackId,
      spotifyReleaseYear: req.body?.spotify_release_year,
      originalReleaseYear: req.body?.original_release_year,
      effectiveReleaseYear: req.body?.effective_release_year,
      source: req.body?.source || "manual_admin",
      reason: req.body?.reason,
      confidence: req.body?.confidence,
    });

    return res.json({ status: "ok", override });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "era_override_error", message: err.message });
    }
    return next(err);
  }
});

router.delete("/admin/era-overrides/:trackId", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const trackId = Number.parseInt(req.params.trackId, 10);
    const track = trackRepo.getTrackForUser(req.currentUser.id, trackId);
    if (!track) {
      return res.status(404).json({ error: "track_not_found", message: "Track was not found for this user." });
    }

    const result = trackEraOverrideRepo.deleteTrackEraOverride(trackId);
    return res.json({ status: "ok", deleted: result.changes });
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

function getPlaylistSeedCachePayload() {
  const seeds = playlistSeedRegistry.getActivePlaylistSeeds();
  const cacheSummary = playlistSeedCacheRepo.summarizeSeedCacheFreshness(seeds);
  const cacheByCode = new Map(cacheSummary.rows.map((row) => [row.seed_code, row]));
  const enrichedSeeds = seeds.map((seed) => ({
    ...seed,
    cache: cacheByCode.get(seed.seed_code) || null,
  }));

  return {
    status: "ok",
    total_seed_count: playlistSeedRegistry.PLAYLIST_SEEDS.length,
    active_seed_count: seeds.length,
    seeds: enrichedSeeds,
    grouped_by_supported_playlist: playlistSeedRegistry.groupPlaylistSeedsBySupportedPlaylist(seeds),
    quality_summary: playlistSeedRegistry.summarizePlaylistSeedQuality(seeds),
    cache_summary: cacheSummary,
    cached_metadata: playlistSeedCacheRepo.listCachedSeedMetadata(),
  };
}

router.get("/admin/playlist-seeds", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getPlaylistSeedCachePayload());
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/seed-intelligence", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const userId = req.query.user_id ? Number.parseInt(req.query.user_id, 10) : req.currentUser.id;
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "invalid_user_id", message: "user_id must be a positive integer." });
    }
    return res.json(getSeedIntelligenceReport(userId));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/specialty-validation", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const userId = req.query.user_id ? Number.parseInt(req.query.user_id, 10) : req.currentUser.id;
    const matchLimit = req.query.match_limit || 50;
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "invalid_user_id", message: "user_id must be a positive integer." });
    }
    return res.json(getSpecialtyPlaylistValidationReport(userId, { matchLimit }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/specialty-track-preview", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const seedCode = String(req.query.seed_code || "").trim();
    if (!seedCode) {
      return res.status(400).json({ error: "missing_seed_code", message: "seed_code is required." });
    }
    const userId = req.query.user_id ? Number.parseInt(req.query.user_id, 10) : req.currentUser.id;
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "invalid_user_id", message: "user_id must be a positive integer." });
    }
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 100;
    return res.json(resolveSpecialtyTracksForUser(userId, seedCode, { limit }));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "specialty_track_preview_error", message: err.message });
    }
    return next(err);
  }
});

router.get("/admin/playlist-seed-cache", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json(getPlaylistSeedCachePayload());
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/playlist-seed-cache/fetch/:seedCode", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await fetchPlaylistSeed(req.currentUser.id, req.params.seedCode));
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) {
      return res.status(err.statusCode).json({
        error: err.code || "playlist_seed_fetch_error",
        message: err.message,
      });
    }
    return next(err);
  }
});

router.post("/admin/playlist-seed-cache/fetch-all", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await fetchAllPlaylistSeeds(req.currentUser.id));
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

router.get("/admin/unmatched-diagnostics", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json(await getAdminUnmatchedDiagnostics(req.currentUser.id, {
      limit: req.query.limit,
      offset: req.query.offset,
      search: req.query.search,
      reason: req.query.reason,
    }));
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/unmatched-diagnostics/:trackId", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      diagnostic: await getAdminUnmatchedDiagnostic(req.currentUser.id, req.params.trackId),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
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

router.get("/admin/artist-intelligence/stale", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({ status: "ok", ...getStaleArtistIntelligence() });
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/artist-intelligence/seed", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({ status: "ok", ...seedArtistIntelligence(req.body) });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "artist_intelligence_seed_error", message: err.message });
    }
    return next(err);
  }
});

router.post("/admin/artist-intelligence/batch-fetch", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json({ status: "ok", ...await batchFetchArtistIntelligence(req.currentUser.id, req.body) });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || "artist_intelligence_batch_fetch_error", message: err.message });
    }
    return next(err);
  }
});

router.get("/admin/artist-intelligence/recommendations", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const recommendations = listArtistIntelligenceRecommendations({
      confidenceMin: req.query.confidence_min,
      limit: req.query.limit,
      reviewedOnly: req.query.reviewed_only === "true",
      pendingOnly: req.query.pending_only === "true",
    });
    return res.json({ status: "ok", count: recommendations.length, recommendations });
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/artist-intelligence/recommendations/bulk-preview", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({ status: "ok", ...previewBulkRecommendations({ confidenceMin: req.query.confidence_min, supportMin: req.query.support_min, limit: req.query.limit }) });
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/artist-intelligence/recommendations/apply-bulk", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const plan = getBulkRecommendationCandidates({ confidenceMin: req.body?.confidence_min, supportMin: req.body?.support_min, limit: req.body?.limit });
    const db = openDatabase();
    const artistGenresBefore = db.prepare("SELECT COUNT(*) AS count FROM artist_genres").get().count;
    const summary = { artists_reviewed: plan.artists.length, candidates_considered: 0, genres_inserted: 0, duplicates_skipped: 0, rejected_count: 0, error_count: 0, errors: [], sample_inserted_rows: [] };
    for (const row of plan.artists) {
      for (const recommendation of row.recommendations) {
        summary.candidates_considered += 1;
        if (recommendation.classification !== "GENRE") { summary.rejected_count += 1; continue; }
        try {
          const result = artistGenreRepo.insertArtistGenres({ artistName: row.artist.artist_name, genres: [recommendation.genre], source: "artist_intelligence_admin_bulk" });
          if (result.inserted) {
            summary.genres_inserted += result.inserted;
            if (summary.sample_inserted_rows.length < 20) summary.sample_inserted_rows.push({ artist_name: row.artist.artist_name, genre: recommendation.genre, support_count: recommendation.support_count, supporting_sources: recommendation.sources });
          } else {
            summary.duplicates_skipped += 1;
          }
        } catch (error) {
          summary.error_count += 1;
          summary.errors.push({ artist_name: row.artist.artist_name, genre: recommendation.genre, message: error.message });
        }
      }
    }
    const artistGenresAfter = db.prepare("SELECT COUNT(*) AS count FROM artist_genres").get().count;
    const noInsertReason = summary.genres_inserted === 0
      ? (summary.candidates_considered === 0 ? "No recommendations matched the bulk filters." : summary.duplicates_skipped === summary.candidates_considered ? "All matching recommendations already exist in artist_genres." : "No new artist_genres rows were inserted. Review rejected_count and errors.")
      : null;
    return res.json({ status: "ok", confidence_min: plan.confidence_min, support_min: plan.support_min, limit: plan.limit, artist_genres_before: artistGenresBefore, artist_genres_after: artistGenresAfter, artist_genres_delta: artistGenresAfter - artistGenresBefore, no_insert_reason: noInsertReason, ...summary });
  } catch (err) {
    return next(err);
  }
});

router.get("/admin/artist-intelligence/recommendations/:id", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const detail = getArtistRecommendationDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "artist_intelligence_not_found", message: "Artist intelligence record not found." });
    return res.json({ status: "ok", ...detail });
  } catch (err) {
    return next(err);
  }
});

router.post("/admin/artist-intelligence/recommendations/apply", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    const artistIntelligenceId = Number.parseInt(req.body?.artist_intelligence_id, 10);
    const genre = normalizeGenre(req.body?.genre);
    const detail = getArtistRecommendationDetail(artistIntelligenceId);
    if (!detail) return res.status(404).json({ error: "artist_intelligence_not_found", message: "Artist intelligence record not found." });
    const recommendation = findRecommendation(artistIntelligenceId, genre);
    if (!recommendation) return res.status(400).json({ error: "recommendation_not_found", message: "Genre is not a current approved Artist Intelligence recommendation." });
    const result = artistGenreRepo.insertArtistGenres({ artistName: detail.artist.artist_name, genres: [genre], source: "artist_intelligence_admin" });
    return res.json({ status: "ok", artist: detail.artist, genre, support_count: recommendation.support_count, supporting_sources: recommendation.sources, inserted_count: result.inserted });
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

    const sourceRows = artistIntelligenceRepo.listArtistIntelligenceSources(artist.id);
    const sources = sourceRows.map(serializeArtistIntelligenceSource);

    return res.json({
      status: "ok",
      artist: serializeArtistIntelligence(artist),
      sources,
      source_summary: {
        count: sources.length,
        available: sources.map((source) => source.source),
        expected: ["spotify", "lastfm", "musicbrainz"],
      },
      source_comparison: compareArtistIntelligenceSources(sourceRows),
      signal_breakdown: classifySignals(sourceRows.flatMap((source) => parseArtistIntelligenceSignals(source.normalized_signals_json))),
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

router.post("/admin/artist-intelligence/recalculate-confidence", requireCurrentUser, requireAdminUser, (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      ...artistIntelligenceRepo.recalculateAllArtistIntelligenceConfidence(),
    });
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

router.post("/admin/review-queue/apply-bulk", requireCurrentUser, requireAdminUser, async (req, res, next) => {
  try {
    return res.json({
      status: "ok",
      ...await applyAdminReviewQueueBulk(req.currentUser.id, {
        approvals: req.body?.approvals,
        safeRecommendations: req.body?.safe_recommendations === true,
      }),
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.code || "admin_review_queue_error", message: err.message });
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
