const path = require("node:path");
const { importCuratedSeedCsvDirectory } = require("../src/crate/curatedSeedImport");
const { closeDatabase } = require("../src/db");

const directory = process.argv[2] || process.env.CURATED_SEED_CSV_DIR || path.join(process.env.HOME || "", "Desktop");

try {
  const results = importCuratedSeedCsvDirectory(directory);
  console.log(JSON.stringify({ status: "ok", directory, results }, null, 2));
} catch (err) {
  console.error(JSON.stringify({ status: "error", message: err.message }, null, 2));
  process.exitCode = 1;
} finally {
  closeDatabase();
}
