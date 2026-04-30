const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("../db");
const config = require("../config");

function defaultSeedPath() {
  return path.join(config.rootDir, "data/artist-genres-seed.json");
}

function normalizeArtistName(artistName) {
  return String(artistName || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function readArtistGenreSeed(seedPath = defaultSeedPath()) {
  if (!fs.existsSync(seedPath)) {
    const error = new Error(`Artist genre seed not found: ${seedPath}`);
    error.statusCode = 404;
    error.code = "artist_genre_seed_not_found";
    throw error;
  }

  const parsed = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  if (!Array.isArray(parsed.artist_genres)) {
    const error = new Error("Artist genre seed is missing array: artist_genres");
    error.statusCode = 400;
    error.code = "invalid_artist_genre_seed";
    throw error;
  }

  return parsed;
}

function importArtistGenreRows(db, rows) {
  const stats = {
    inserted: 0,
    skipped_existing: 0,
    skipped_invalid: 0,
    updated: 0,
  };
  const findExisting = db.prepare(`
    SELECT *
    FROM artist_genres
    WHERE lower(trim(artist_name)) = @artist_name
      AND genre = @genre
    ORDER BY id ASC
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO artist_genres (
      artist_name,
      genre,
      source,
      created_at
    )
    VALUES (
      @artist_name,
      @genre,
      @source,
      COALESCE(@created_at, CURRENT_TIMESTAMP)
    )
  `);
  const updateBlankFields = db.prepare(`
    UPDATE artist_genres
    SET
      artist_name = CASE
        WHEN artist_name IS NULL OR trim(artist_name) = '' THEN @artist_name
        ELSE artist_name
      END,
      source = CASE
        WHEN source IS NULL OR trim(source) = '' THEN @source
        ELSE source
      END
    WHERE id = @id
      AND (
        artist_name IS NULL OR trim(artist_name) = ''
        OR source IS NULL OR trim(source) = ''
      )
  `);

  for (const row of rows) {
    const normalized = {
      artist_name: normalizeArtistName(row.artist_name),
      genre: normalizeText(row.genre),
      source: normalizeText(row.source),
      created_at: row.created_at || null,
    };

    if (!normalized.artist_name || !normalized.genre || !normalized.source) {
      stats.skipped_invalid += 1;
      continue;
    }

    const existing = findExisting.get({
      artist_name: normalized.artist_name,
      genre: normalized.genre,
    });

    if (!existing) {
      insert.run(normalized);
      stats.inserted += 1;
      continue;
    }

    const result = updateBlankFields.run({
      id: existing.id,
      artist_name: normalized.artist_name,
      source: normalized.source,
    });

    if (result.changes > 0) {
      stats.updated += 1;
    } else {
      stats.skipped_existing += 1;
    }
  }

  return stats;
}

function importArtistGenreSeed(options = {}) {
  const seedPath = options.seedPath || defaultSeedPath();
  const seedData = readArtistGenreSeed(seedPath);
  const db = openDatabase();
  const runImport = db.transaction(() => importArtistGenreRows(db, seedData.artist_genres));
  const artistGenres = runImport();

  return {
    status: "ok",
    import_database: config.databasePath,
    seed_path: seedPath,
    exported_at: seedData.exported_at || null,
    artist_genres: artistGenres,
  };
}

module.exports = {
  importArtistGenreSeed,
};
