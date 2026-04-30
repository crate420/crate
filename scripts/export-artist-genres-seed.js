const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const rootDir = path.resolve(__dirname, "..");
const sourceDatabasePath = path.resolve(
  rootDir,
  process.env.CRATE_EXPORT_DB_PATH || "data/crate.sqlite",
);
const exportPath = path.resolve(
  rootDir,
  process.env.ARTIST_GENRES_SEED_PATH || "data/artist-genres-seed.json",
);

function normalizeArtistName(artistName) {
  return String(artistName || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function main() {
  if (!fs.existsSync(sourceDatabasePath)) {
    throw new Error(`Local database not found: ${sourceDatabasePath}`);
  }

  const db = new Database(sourceDatabasePath, { readonly: true });

  try {
    const rows = db.prepare(`
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
    `).all();
    const rowsByKey = new Map();
    let skippedInvalid = 0;
    let skippedDuplicate = 0;

    for (const row of rows) {
      const artistName = normalizeArtistName(row.artist_name);
      const genre = normalizeText(row.genre);
      const source = normalizeText(row.source);

      if (!artistName || !genre || !source) {
        skippedInvalid += 1;
        continue;
      }

      const key = `${artistName}\u0000${genre}`;

      if (rowsByKey.has(key)) {
        skippedDuplicate += 1;
        continue;
      }

      rowsByKey.set(key, {
        artist_name: artistName,
        genre,
        source,
        created_at: row.created_at || null,
      });
    }

    const exportData = {
      exported_at: new Date().toISOString(),
      source_database: path.relative(rootDir, sourceDatabasePath),
      normalization: {
        artist_name: "trim().toLowerCase()",
        genre: "trim()",
        source: "trim()",
      },
      artist_genres: [...rowsByKey.values()],
      counts: {
        read: rows.length,
        exported: rowsByKey.size,
        skipped_invalid: skippedInvalid,
        skipped_duplicate: skippedDuplicate,
      },
    };

    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.writeFileSync(exportPath, `${JSON.stringify(exportData, null, 2)}\n`);

    console.log(JSON.stringify({
      status: "ok",
      export_path: exportPath,
      ...exportData.counts,
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
