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
    return res.redirect("/?beta_required=1");
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

  app.get("/admin-unmatched.html", requireAdminPage, (req, res) => {
    res.sendFile(path.join(config.rootDir, "public/admin-unmatched.html"));
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

    return res.status(500).json({
      error: "internal_server_error",
      message: "Something went wrong.",
    });
  });

  return app;
}

module.exports = { createApp };
