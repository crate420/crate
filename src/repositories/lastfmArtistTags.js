const { openDatabase } = require("../db");

function findByArtistName(artistName) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM lastfm_artist_tags
      WHERE artist_name = ?
    `)
    .get(artistName);
}

function upsertLookup({
  artistName,
  sourceArtistName,
  rawTags,
  mappedGenres,
  suggestedPlaylistCode,
  confidence,
  status,
  errorCode,
  errorMessage,
}) {
  const now = new Date().toISOString();

  openDatabase()
    .prepare(`
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
        @artistName,
        @sourceArtistName,
        @rawTagsJson,
        @mappedGenresJson,
        @suggestedPlaylistCode,
        @confidence,
        @status,
        @errorCode,
        @errorMessage,
        @now,
        @now
      )
      ON CONFLICT(artist_name) DO UPDATE SET
        source_artist_name = excluded.source_artist_name,
        raw_tags_json = excluded.raw_tags_json,
        mapped_genres_json = excluded.mapped_genres_json,
        suggested_playlist_code = excluded.suggested_playlist_code,
        confidence = excluded.confidence,
        status = excluded.status,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at
    `)
    .run({
      artistName,
      sourceArtistName,
      rawTagsJson: JSON.stringify(rawTags || []),
      mappedGenresJson: JSON.stringify(mappedGenres || []),
      suggestedPlaylistCode,
      confidence,
      status,
      errorCode,
      errorMessage,
      now,
    });
}

function listByStatus(status) {
  const db = openDatabase();

  if (status === "all") {
    return db
      .prepare(`
        SELECT *
        FROM lastfm_artist_tags
        ORDER BY
          status COLLATE NOCASE ASC,
          artist_name COLLATE NOCASE ASC
      `)
      .all();
  }

  return db
    .prepare(`
      SELECT *
      FROM lastfm_artist_tags
      WHERE status = @status
      ORDER BY
        status COLLATE NOCASE ASC,
        artist_name COLLATE NOCASE ASC
    `)
    .all({ status });
}

function markApplied(artistName) {
  const now = new Date().toISOString();

  return openDatabase()
    .prepare(`
      UPDATE lastfm_artist_tags
      SET
        status = 'applied',
        updated_at = @now
      WHERE artist_name = @artistName
    `)
    .run({ artistName, now });
}

function markIgnored(artistName) {
  const now = new Date().toISOString();

  return openDatabase()
    .prepare(`
      UPDATE lastfm_artist_tags
      SET
        status = 'ignored',
        updated_at = @now
      WHERE artist_name = @artistName
    `)
    .run({ artistName, now });
}

function listSafeBatchToApply(limit = 25) {
  return openDatabase()
    .prepare(`
      SELECT *
      FROM lastfm_artist_tags
      WHERE status = 'pending'
        AND confidence = 'medium'
        AND mapped_genres_json != '[]'
      ORDER BY artist_name COLLATE NOCASE ASC
      LIMIT @limit
    `)
    .all({ limit });
}

module.exports = {
  findByArtistName,
  listByStatus,
  listSafeBatchToApply,
  markApplied,
  markIgnored,
  upsertLookup,
};
