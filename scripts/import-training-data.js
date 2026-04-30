const fs = require("node:fs");
const path = require("node:path");
const { closeDatabase, openDatabase } = require("../src/db");

const rootDir = path.resolve(__dirname, "..");
const exportPath = path.resolve(
  rootDir,
  process.env.TRAINING_EXPORT_PATH || "data/training-export.json",
);

function readExportData() {
  if (!fs.existsSync(exportPath)) {
    throw new Error(`Training export not found: ${exportPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(exportPath, "utf8"));

  for (const key of ["artist_genres", "lastfm_artist_tags", "track_overrides"]) {
    if (!Array.isArray(parsed[key])) {
      throw new Error(`Training export is missing array: ${key}`);
    }
  }

  return parsed;
}

function sameLastfmRow(existing, row) {
  return [
    "source_artist_name",
    "raw_tags_json",
    "mapped_genres_json",
    "suggested_playlist_code",
    "confidence",
    "status",
    "error_code",
    "error_message",
    "fetched_at",
    "updated_at",
  ].every((key) => (existing[key] || null) === (row[key] || null));
}

function importArtistGenres(db, rows) {
  const stats = {
    inserted: 0,
    skipped_existing: 0,
  };
  const insert = db.prepare(`
    INSERT OR IGNORE INTO artist_genres (
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

  for (const row of rows) {
    const result = insert.run({
      artist_name: row.artist_name,
      genre: row.genre,
      source: row.source,
      created_at: row.created_at || null,
    });

    if (result.changes > 0) {
      stats.inserted += 1;
    } else {
      stats.skipped_existing += 1;
    }
  }

  return stats;
}

function importLastfmArtistTags(db, rows) {
  const stats = {
    inserted: 0,
    updated: 0,
    skipped_unchanged: 0,
  };
  const find = db.prepare(`
    SELECT *
    FROM lastfm_artist_tags
    WHERE artist_name = ?
  `);
  const insert = db.prepare(`
    INSERT INTO lastfm_artist_tags (
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
    )
    VALUES (
      @artist_name,
      @source_artist_name,
      @raw_tags_json,
      @mapped_genres_json,
      @suggested_playlist_code,
      @confidence,
      @status,
      @error_code,
      @error_message,
      @fetched_at,
      @updated_at
    )
  `);
  const update = db.prepare(`
    UPDATE lastfm_artist_tags
    SET
      source_artist_name = @source_artist_name,
      raw_tags_json = @raw_tags_json,
      mapped_genres_json = @mapped_genres_json,
      suggested_playlist_code = @suggested_playlist_code,
      confidence = @confidence,
      status = @status,
      error_code = @error_code,
      error_message = @error_message,
      fetched_at = @fetched_at,
      updated_at = @updated_at
    WHERE artist_name = @artist_name
  `);

  for (const row of rows) {
    const normalized = {
      artist_name: row.artist_name,
      source_artist_name: row.source_artist_name || null,
      raw_tags_json: row.raw_tags_json || "[]",
      mapped_genres_json: row.mapped_genres_json || "[]",
      suggested_playlist_code: row.suggested_playlist_code || null,
      confidence: row.confidence || "low",
      status: row.status || "pending",
      error_code: row.error_code || null,
      error_message: row.error_message || null,
      fetched_at: row.fetched_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
    };
    const existing = find.get(normalized.artist_name);

    if (!existing) {
      insert.run(normalized);
      stats.inserted += 1;
    } else if (sameLastfmRow(existing, normalized)) {
      stats.skipped_unchanged += 1;
    } else {
      update.run(normalized);
      stats.updated += 1;
    }
  }

  return stats;
}

function importTrackOverrides(db, rows) {
  const stats = {
    inserted: 0,
    updated: 0,
    skipped_unchanged: 0,
    skipped_missing_track: 0,
  };
  const findTrack = db.prepare(`
    SELECT id
    FROM tracks
    WHERE spotify_track_id = ?
  `);
  const findOverride = db.prepare(`
    SELECT *
    FROM track_overrides
    WHERE track_id = ?
  `);
  const insert = db.prepare(`
    INSERT INTO track_overrides (
      track_id,
      override_playlist_code,
      created_at,
      updated_at
    )
    VALUES (
      @track_id,
      @override_playlist_code,
      COALESCE(@created_at, CURRENT_TIMESTAMP),
      COALESCE(@updated_at, CURRENT_TIMESTAMP)
    )
  `);
  const update = db.prepare(`
    UPDATE track_overrides
    SET
      override_playlist_code = @override_playlist_code,
      updated_at = COALESCE(@updated_at, CURRENT_TIMESTAMP)
    WHERE track_id = @track_id
  `);

  for (const row of rows) {
    const track = findTrack.get(row.spotify_track_id);

    if (!track) {
      stats.skipped_missing_track += 1;
      continue;
    }

    const existing = findOverride.get(track.id);
    const payload = {
      track_id: track.id,
      override_playlist_code: row.override_playlist_code,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    };

    if (!existing) {
      insert.run(payload);
      stats.inserted += 1;
    } else if (existing.override_playlist_code === payload.override_playlist_code) {
      stats.skipped_unchanged += 1;
    } else {
      update.run(payload);
      stats.updated += 1;
    }
  }

  return stats;
}

function main() {
  const exportData = readExportData();
  const db = openDatabase();
  const runImport = db.transaction(() => ({
    artist_genres: importArtistGenres(db, exportData.artist_genres),
    lastfm_artist_tags: importLastfmArtistTags(db, exportData.lastfm_artist_tags),
    track_overrides: importTrackOverrides(db, exportData.track_overrides),
  }));
  const result = runImport();

  console.log(JSON.stringify({
    status: "ok",
    import_database: process.env.DATABASE_PATH || "./data/crate.sqlite",
    export_path: exportPath,
    exported_at: exportData.exported_at || null,
    ...result,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  closeDatabase();
}
