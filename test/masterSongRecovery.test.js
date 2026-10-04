const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const test = require("node:test");
const config = require("../src/config");

const recovery = require("../src/crate/masterSongRecovery");

test("schema inspection and recovery tolerate a partial legacy database", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE legacy_tracks (
      id INTEGER PRIMARY KEY,
      spotify_track_id TEXT,
      track_name TEXT,
      artist_name TEXT,
      album TEXT,
      release_date TEXT
    );
    INSERT INTO legacy_tracks VALUES
      (1, 'sp-1', 'Comma, Song', 'Artist One', 'Album A', '1999-02-03'),
      (2, NULL, 'Orphan Song', 'Artist Two', NULL, NULL);
  `);

  const schema = recovery.inspectSchema(db);
  assert.deepEqual(schema.map((table) => table.name), ["legacy_tracks"]);
  assert.deepEqual(schema[0].columns, ["id", "spotify_track_id", "track_name", "artist_name", "album", "release_date"]);
  db.close();
});

test("recovery deduplicates shared Spotify tracks and preserves no-ID songs", () => {
  const result = recovery.buildRecovery();
  const spotifyIds = result.rows.map((row) => row.spotify_track_id).filter(Boolean);

  assert.equal(new Set(spotifyIds).size, spotifyIds.length);
  assert.equal(result.summary.total_unique_recovered_songs, result.rows.length);
  assert.equal(result.summary.unique_spotify_track_ids, spotifyIds.length);
  assert.ok(result.summary.relevant_tables_found.includes("tracks"));
  assert.equal(result.summary.database_path, config.databasePath);
  assert.doesNotMatch(JSON.stringify(result.rows), /access_token|refresh_token|spotify_user_id|admin_user_id|user_id/);
});

test("CSV contains canonical recovery fields and one line per recovered row", () => {
  const result = recovery.buildRecovery();
  const csv = recovery.getMasterSongRecoveryCsv();

  assert.ok(csv.startsWith("\uFEFF\"spotify_track_id\",\"track_name\""));
  assert.match(csv, /"approved_genre_category"/);
  assert.match(csv, /"intelligence_source_evidence"/);
  assert.equal(csv.split("\r\n").length, result.rows.length + 2);
});
