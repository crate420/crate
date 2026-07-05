const express = require("express");
const path = require("node:path");
const authRouter = require("./routes/auth");
const betaRouter = require("./routes/beta");
const crateRouter = require("./routes/crate");
const healthRouter = require("./routes/health");
const config = require("./config");
const { getCurrentUser } = require("./utils/authSession");

function requireAdminPage(req, res, next) {
  const user = getCurrentUser(req, res);

  if (!user) {
    return res.redirect("/?registration_required=1");
  }

  if (!config.adminSpotifyUserId || user.spotify_user_id !== config.adminSpotifyUserId) {
    return res.status(403).send("This page is restricted to the configured Crate admin.");
  }

  return next();
}

function createApp() {
  const app = express();

  app.disable("x-powered-by");

  if (config.env === "production") {
    app.set("trust proxy", 1);
  }

  app.use(express.json({ limit: "1mb" }));

  app.get("/admin.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin.html"));
  });

  app.get("/admin-review.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-review.html"));
  });

  app.get("/admin-playlists.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-playlists.html"));
  });

  app.get("/admin-playlist-seeds.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-playlist-seeds.html"));
  });

  app.get("/admin-playlist-intelligence.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-playlist-intelligence.html"));
  });

  app.get("/admin-specialty-validation.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-specialty-validation.html"));
  });

  app.get("/admin-specialty-discovery.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-specialty-discovery.html"));
  });

  app.get("/admin-unmatched.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-unmatched.html"));
  });

  app.get("/admin-unmatched-diagnostics.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-unmatched-diagnostics.html"));
  });

  app.get("/admin-user-diagnostics.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-user-diagnostics.html"));
  });

  app.get("/admin-user-unmatched-export.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-user-unmatched-export.html"));
  });

  app.get("/admin-artist-gap-analysis.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-artist-gap-analysis.html"));
  });

  app.get("/admin-artist-enrichment-queue.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-artist-enrichment-queue.html"));
  });

  app.get("/admin-genre-recommendations.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-genre-recommendations.html"));
  });

  app.get("/admin-genre-recommendation-rescan.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-genre-recommendation-rescan.html"));
  });

  app.get("/admin-recommendation-impact.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-recommendation-impact.html"));
  });

  app.get("/admin-track-intelligence.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-track-intelligence.html"));
  });

  app.get("/admin-track-learning.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-track-learning.html"));
  });

  app.get("/admin-playlist-dna-validation.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-playlist-dna-validation.html"));
  });

  app.get("/admin-dna-evidence-quality.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-dna-evidence-quality.html"));
  });

  app.get("/admin-intelligence-coverage.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-intelligence-coverage.html"));
  });

  app.get("/admin-era-diagnostics.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-era-diagnostics.html"));
  });

  app.get("/admin-learning.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-learning.html"));
  });

  app.get("/admin-artist-intelligence.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-artist-intelligence.html"));
  });

  app.get("/admin-artist-recommendations.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-artist-recommendations.html"));
  });

  app.use(express.static(path.join(config.rootDir, "public")));

  app.use("/auth", authRouter);
  app.use("/beta", betaRouter);
  app.use("/crate", crateRouter);
  app.use("/health", healthRouter);

  app.use((req, res) => {
    res.status(404).json({
      error: "not_found",
      message: `No route found for ${req.method} ${req.path}`,
    });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    console.error(err);

    if (err.statusCode) {
      const payload = {
        error: err.code || "request_error",
        message: err.message,
      };

      if (err.reauthorizationRequired) {
        payload.reauthorization_required = true;
        payload.redirect_url = err.redirectUrl || "/auth/spotify?reauthorize=1";
      }

      return res.status(err.statusCode).json(payload);
    }

    return res.status(500).json({
      error: "internal_server_error",
      message: "Something went wrong.",
    });
  });

  return app;
}

module.exports = { createApp };
