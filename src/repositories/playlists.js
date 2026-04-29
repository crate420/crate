const { openDatabase } = require("../db");

function upsertPlaylistDefinitions(definitions) {
  const db = openDatabase();
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO playlist_definitions (
      playlist_code,
      display_name,
      created_at,
      updated_at
    )
    VALUES (
      @playlistCode,
      @displayName,
      @now,
      @now
    )
    ON CONFLICT(playlist_code) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `);

  const writeDefinitions = db.transaction(() => {
    for (const definition of definitions) {
      upsert.run({
        playlistCode: definition.playlistCode,
        displayName: definition.displayName,
        now,
      });
    }
  });

  writeDefinitions();
}

function getPlaylistDefinitionsByCode() {
  const rows = openDatabase()
    .prepare(`
      SELECT *
      FROM playlist_definitions
      ORDER BY playlist_code COLLATE NOCASE ASC
    `)
    .all();

  return new Map(rows.map((row) => [row.playlist_code, row]));
}

function updateSpotifyPlaylistId(playlistCode, spotifyPlaylistId) {
  const now = new Date().toISOString();

  return openDatabase()
    .prepare(`
      UPDATE playlist_definitions
      SET
        spotify_playlist_id = @spotifyPlaylistId,
        updated_at = @now
      WHERE playlist_code = @playlistCode
    `)
    .run({ playlistCode, spotifyPlaylistId, now });
}

function startPlaylistSyncRun(userId) {
  const result = openDatabase()
    .prepare(`
      INSERT INTO playlist_sync_runs (user_id)
      VALUES (?)
    `)
    .run(userId);

  return findPlaylistSyncRunById(result.lastInsertRowid);
}

function finishPlaylistSyncRun(runId, summary) {
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      UPDATE playlist_sync_runs
      SET
        completed_at = @completedAt,
        playlists_checked = @playlistsChecked,
        playlists_created = @playlistsCreated,
        tracks_added = @tracksAdded,
        duplicates_skipped = @duplicatesSkipped,
        errors = @errors,
        updated_at = @completedAt
      WHERE run_id = @runId
    `)
    .run({
      runId,
      completedAt: now,
      playlistsChecked: summary.playlists_checked,
      playlistsCreated: summary.playlists_created,
      tracksAdded: summary.tracks_added,
      duplicatesSkipped: summary.duplicates_skipped,
      errors: JSON.stringify(summary.errors || []),
    });

  return findPlaylistSyncRunById(runId);
}

function findPlaylistSyncRunById(runId) {
  return openDatabase()
    .prepare("SELECT * FROM playlist_sync_runs WHERE run_id = ?")
    .get(runId);
}

module.exports = {
  finishPlaylistSyncRun,
  getPlaylistDefinitionsByCode,
  startPlaylistSyncRun,
  updateSpotifyPlaylistId,
  upsertPlaylistDefinitions,
};
