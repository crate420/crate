const { createApp } = require("./app");
const config = require("./config");

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Crate MVP listening on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);

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
