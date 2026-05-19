const { createApp } = require("./app");
const config = require("./config");
const { applyMigrations } = require("./db/migrate");

console.log(`Crate SQLite database: ${config.databasePath}`);
config.logStartupConfigStatus();

applyMigrations();

function logProcessEvent(event, details = {}) {
  console.error(`[Crate Process] ${event}`, {
    pid: process.pid,
    uptime_seconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    ...details,
  });
}

process.on("uncaughtException", (err) => {
  logProcessEvent("uncaughtException", {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logProcessEvent("unhandledRejection", {
    message: reason?.message || String(reason),
    stack: reason?.stack || null,
  });
});

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Crate MVP listening on port ${config.port}`);
});

function shutdown(signal) {
  logProcessEvent(signal + " received; shutting down");

  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
