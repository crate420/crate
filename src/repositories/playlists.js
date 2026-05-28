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

function serializeSelectionJson(selectionJson) {
  if (selectionJson === undefined || selectionJson === null) {
    return null;
  }
  return typeof selectionJson === "string" ? selectionJson : JSON.stringify(selectionJson);
}

function normalizeUserPlaylistInstance(instance) {
  return {
    userId: instance.userId,
    spotifyUserId: instance.spotifyUserId || null,
    playlistCode: instance.playlistCode,
    displayName: instance.displayName,
    spotifyPlaylistId: instance.spotifyPlaylistId || null,
    spotifyOwnerId: instance.spotifyOwnerId || null,
    source: instance.source || "selected",
    selectionJson: serializeSelectionJson(instance.selectionJson),
    lastTrackCount: Number.isFinite(Number(instance.lastTrackCount))
      ? Number(instance.lastTrackCount)
      : 0,
  };
}

function findUserPlaylistInstance(userId, playlistCode) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM user_playlist_instances
      WHERE user_id = @userId
        AND playlist_code = @playlistCode
    `)
    .get({ userId, playlistCode });
}

function upsertUserPlaylistInstance(instance) {
  const db = openDatabase();
  const now = new Date().toISOString();
  const normalized = normalizeUserPlaylistInstance(instance);

  db.prepare(`
    INSERT INTO user_playlist_instances (
      user_id,
      spotify_user_id,
      playlist_code,
      display_name,
      spotify_playlist_id,
      spotify_owner_id,
      source,
      selection_json,
      last_track_count,
      created_at,
      updated_at
    )
    VALUES (
      @userId,
      @spotifyUserId,
      @playlistCode,
      @displayName,
      @spotifyPlaylistId,
      @spotifyOwnerId,
      @source,
      @selectionJson,
      @lastTrackCount,
      @now,
      @now
    )
    ON CONFLICT(user_id, playlist_code) DO UPDATE SET
      spotify_user_id = excluded.spotify_user_id,
      display_name = excluded.display_name,
      spotify_playlist_id = COALESCE(excluded.spotify_playlist_id, user_playlist_instances.spotify_playlist_id),
      spotify_owner_id = COALESCE(excluded.spotify_owner_id, user_playlist_instances.spotify_owner_id),
      source = excluded.source,
      selection_json = excluded.selection_json,
      last_track_count = excluded.last_track_count,
      updated_at = excluded.updated_at
  `).run({ ...normalized, now });

  return findUserPlaylistInstance(normalized.userId, normalized.playlistCode);
}

function updateUserPlaylistInstanceSpotifyId({ userId, playlistCode, spotifyPlaylistId, spotifyOwnerId = null }) {
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      UPDATE user_playlist_instances
      SET
        spotify_playlist_id = @spotifyPlaylistId,
        spotify_owner_id = COALESCE(@spotifyOwnerId, spotify_owner_id),
        updated_at = @now
      WHERE user_id = @userId
        AND playlist_code = @playlistCode
    `)
    .run({ userId, playlistCode, spotifyPlaylistId, spotifyOwnerId, now });

  return findUserPlaylistInstance(userId, playlistCode);
}

function markUserPlaylistInstanceSynced({ userId, playlistCode, lastTrackCount = 0 }) {
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
      UPDATE user_playlist_instances
      SET
        last_synced_at = @now,
        last_track_count = @lastTrackCount,
        updated_at = @now
      WHERE user_id = @userId
        AND playlist_code = @playlistCode
    `)
    .run({ userId, playlistCode, lastTrackCount, now });

  return findUserPlaylistInstance(userId, playlistCode);
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
  findPlaylistSyncRunById,
  findUserPlaylistInstance,
  finishPlaylistSyncRun,
  getPlaylistDefinitionsByCode,
  markUserPlaylistInstanceSynced,
  startPlaylistSyncRun,
  updateSpotifyPlaylistId,
  updateUserPlaylistInstanceSpotifyId,
  upsertPlaylistDefinitions,
  upsertUserPlaylistInstance,
};
