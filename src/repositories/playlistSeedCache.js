const { openDatabase } = require("../db");

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function upsertSeedMetadata(metadata) {
  const payload = {
    seedCode: metadata.seed_code,
    playlistId: metadata.playlist_id,
    playlistName: metadata.playlist_name,
    ownerId: metadata.owner_id || null,
    ownerName: metadata.owner_name || null,
    description: metadata.description || null,
    snapshotId: metadata.snapshot_id || null,
    followerCount: Number.isInteger(metadata.follower_count) ? metadata.follower_count : 0,
    imageUrl: metadata.image_url || null,
    trackCount: Number.isInteger(metadata.track_count) ? metadata.track_count : 0,
    fetchedAt: metadata.fetched_at || new Date().toISOString(),
  };

  openDatabase().prepare(`
    INSERT INTO playlist_seed_cache (
      seed_code,
      playlist_id,
      playlist_name,
      owner_id,
      owner_name,
      description,
      snapshot_id,
      follower_count,
      image_url,
      track_count,
      fetched_at
    )
    VALUES (
      @seedCode,
      @playlistId,
      @playlistName,
      @ownerId,
      @ownerName,
      @description,
      @snapshotId,
      @followerCount,
      @imageUrl,
      @trackCount,
      @fetchedAt
    )
    ON CONFLICT(seed_code) DO UPDATE SET
      playlist_id = excluded.playlist_id,
      playlist_name = excluded.playlist_name,
      owner_id = excluded.owner_id,
      owner_name = excluded.owner_name,
      description = excluded.description,
      snapshot_id = excluded.snapshot_id,
      follower_count = excluded.follower_count,
      image_url = excluded.image_url,
      track_count = excluded.track_count,
      fetched_at = excluded.fetched_at
  `).run(payload);

  return getCachedSeedMetadata(payload.seedCode);
}

function replaceSeedTracks(seedCode, tracks, fetchedAt = new Date().toISOString()) {
  const db = openDatabase();
  const deleteTracks = db.prepare("DELETE FROM playlist_seed_tracks WHERE seed_code = ?");
  const insertTrack = db.prepare(`
    INSERT INTO playlist_seed_tracks (
      seed_code,
      spotify_track_id,
      spotify_uri,
      isrc,
      track_name,
      artist_names_json,
      artist_ids_json,
      album_name,
      release_date,
      release_year,
      position,
      fetched_at
    )
    VALUES (
      @seedCode,
      @spotifyTrackId,
      @spotifyUri,
      @isrc,
      @trackName,
      @artistNamesJson,
      @artistIdsJson,
      @albumName,
      @releaseDate,
      @releaseYear,
      @position,
      @fetchedAt
    )
  `);

  const write = db.transaction(() => {
    deleteTracks.run(seedCode);
    for (const track of tracks) {
      insertTrack.run({
        seedCode,
        spotifyTrackId: track.spotify_track_id,
        spotifyUri: track.spotify_uri || null,
        isrc: track.isrc || null,
        trackName: track.track_name,
        artistNamesJson: JSON.stringify(track.artist_names || []),
        artistIdsJson: JSON.stringify(track.artist_ids || []),
        albumName: track.album_name || null,
        releaseDate: track.release_date || null,
        releaseYear: Number.isInteger(track.release_year) ? track.release_year : null,
        position: track.position,
        fetchedAt,
      });
    }
  });

  write();
  return { replaced: tracks.length };
}

function getCachedSeedMetadata(seedCode) {
  return openDatabase()
    .prepare("SELECT * FROM playlist_seed_cache WHERE seed_code = ?")
    .get(seedCode);
}

function listCachedSeedMetadata() {
  return openDatabase()
    .prepare("SELECT * FROM playlist_seed_cache ORDER BY seed_code COLLATE NOCASE ASC")
    .all();
}

function getCachedSeedTracks(seedCode, { limit = 500, offset = 0 } = {}) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM playlist_seed_tracks
      WHERE seed_code = @seedCode
      ORDER BY position ASC
      LIMIT @limit
      OFFSET @offset
    `)
    .all({ seedCode, limit, offset })
    .map((row) => ({
      ...row,
      artist_names: parseJson(row.artist_names_json, []),
      artist_ids: parseJson(row.artist_ids_json, []),
    }));
}

function summarizeSeedCacheFreshness(activeSeeds = []) {
  const cachedRows = listCachedSeedMetadata();
  const cachedByCode = new Map(cachedRows.map((row) => [row.seed_code, row]));
  const now = Date.now();
  const rows = activeSeeds.map((seed) => {
    const cached = cachedByCode.get(seed.seed_code) || null;
    const fetchedMs = cached?.fetched_at ? Date.parse(cached.fetched_at) : NaN;
    const ageDays = Number.isFinite(fetchedMs) ? Math.max(0, (now - fetchedMs) / 86400000) : null;
    const stale = !cached || ageDays === null || ageDays > Number(seed.refresh_interval_days || 30);
    return {
      seed_code: seed.seed_code,
      playlist_id: seed.playlist_id,
      cached: Boolean(cached),
      stale,
      age_days: ageDays === null ? null : Math.round(ageDays * 10) / 10,
      fetched_at: cached?.fetched_at || null,
      snapshot_id: cached?.snapshot_id || null,
      cached_track_count: cached?.track_count || 0,
      follower_count: cached?.follower_count || 0,
    };
  });

  return {
    total: rows.length,
    cached: rows.filter((row) => row.cached).length,
    stale: rows.filter((row) => row.stale).length,
    rows,
  };
}

module.exports = {
  getCachedSeedMetadata,
  getCachedSeedTracks,
  listCachedSeedMetadata,
  replaceSeedTracks,
  summarizeSeedCacheFreshness,
  upsertSeedMetadata,
};
