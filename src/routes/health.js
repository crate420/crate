const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "crate-mvp",
    revision: process.env.RENDER_GIT_COMMIT || null,
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
