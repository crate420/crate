const fs = require("node:fs");
const path = require("node:path");
const { openDatabase, closeDatabase } = require("../src/db");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "research", "playlist-intelligence-seed.json");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function rowsForCollection(db, tableName, collectionId, orderBy) {
  return db.prepare(`SELECT * FROM ${tableName} WHERE collection_id = ? ORDER BY ${orderBy}`).all(collectionId);
}

function stripIds(row) {
  const { id, collection_id, ...rest } = row;
  return rest;
}

function exportPlaylistIntelligenceSeed(outputPath = DEFAULT_OUTPUT) {
  const db = openDatabase();
  const collections = db.prepare(`
    SELECT *
    FROM playlist_collection_definitions
    ORDER BY collection_code COLLATE NOCASE ASC
  `).all().map((collection) => ({
    collection: stripIds(collection),
    sources: rowsForCollection(db, "playlist_collection_sources", collection.id, "playlist_name COLLATE NOCASE ASC").map(stripIds),
    artists: rowsForCollection(db, "playlist_collection_artists", collection.id, "artist_name COLLATE NOCASE ASC").map(stripIds),
    tracks: rowsForCollection(db, "playlist_collection_tracks", collection.id, "artist_name COLLATE NOCASE ASC, track_name COLLATE NOCASE ASC").map(stripIds),
  }));

  const seed = {
    schema: "crate.playlist_intelligence.seed",
    version: 1,
    exported_at: new Date().toISOString(),
    counts: {
      collections: collections.length,
      sources: collections.reduce((sum, row) => sum + row.sources.length, 0),
      artists: collections.reduce((sum, row) => sum + row.artists.length, 0),
      tracks: collections.reduce((sum, row) => sum + row.tracks.length, 0),
    },
    collections,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(seed, null, 2) + "\n");
  return { status: "ok", output_path: outputPath, counts: seed.counts };
}

try {
  console.log(JSON.stringify(exportPlaylistIntelligenceSeed(path.resolve(argValue("out", DEFAULT_OUTPUT))), null, 2));
} catch (err) {
  console.error(JSON.stringify({ status: "error", message: err.message }, null, 2));
  process.exitCode = 1;
} finally {
  closeDatabase();
}

module.exports = { exportPlaylistIntelligenceSeed };
