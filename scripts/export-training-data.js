const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const config = require("../src/config");

const rootDir = path.resolve(__dirname, "..");
const sourceDatabasePath = config.databasePath;
const exportPath = path.resolve(
  rootDir,
  process.env.TRAINING_EXPORT_PATH || "data/training-export.json",
);

function readRows(db, sql) {
  return db.prepare(sql).all();
}

function main() {
  if (!fs.existsSync(sourceDatabasePath)) {
    throw new Error(`Local database not found: ${sourceDatabasePath}`);
  }

  const db = new Database(sourceDatabasePath, { readonly: true });

  try {
    const exportData = {
      exported_at: new Date().toISOString(),
      source_database: path.relative(rootDir, sourceDatabasePath),
      artist_genres: readRows(db, `
        SELECT
          artist_name,
          genre,
          source,
          created_at
        FROM artist_genres
        ORDER BY
          source COLLATE NOCASE ASC,
          artist_name COLLATE NOCASE ASC,
          genre COLLATE NOCASE ASC
      `),
      lastfm_artist_tags: readRows(db, `
        SELECT
          artist_name,
          source_artist_name,
          raw_tags_json,
          mapped_genres_json,
          suggested_playlist_code,
          confidence,
          status,
          error_code,
          error_message,
          fetched_at,
          updated_at
        FROM lastfm_artist_tags
        ORDER BY artist_name COLLATE NOCASE ASC
      `),
      track_overrides: readRows(db, `
        SELECT
          tracks.spotify_track_id,
          tracks.name AS track_name,
          tracks.artist_names,
          track_overrides.override_playlist_code,
          track_overrides.created_at,
          track_overrides.updated_at
        FROM track_overrides
        INNER JOIN tracks ON tracks.id = track_overrides.track_id
        ORDER BY tracks.spotify_track_id COLLATE NOCASE ASC
      `),
    };

    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.writeFileSync(exportPath, `${JSON.stringify(exportData, null, 2)}\n`);

    console.log(JSON.stringify({
      status: "ok",
      export_path: exportPath,
      artist_genres: exportData.artist_genres.length,
      lastfm_artist_tags: exportData.lastfm_artist_tags.length,
      track_overrides: exportData.track_overrides.length,
    }, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
