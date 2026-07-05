const { openDatabase, closeDatabase } = require("../src/db");

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function verifyPlaylistIntelligence() {
  const db = openDatabase();
  if (!tableExists(db, "playlist_collection_definitions")) {
    return { status: "missing", message: "Playlist Intelligence tables do not exist." };
  }

  const collections = db.prepare(`
    SELECT
      definitions.collection_code,
      definitions.collection_name,
      definitions.research_status,
      COUNT(DISTINCT sources.id) AS source_count,
      COUNT(DISTINCT CASE WHEN sources.active = 1 AND sources.include_in_consensus = 1 THEN sources.id END) AS active_source_count,
      COUNT(DISTINCT artists.id) AS artist_count,
      COUNT(DISTINCT CASE WHEN artists.review_status = 'approved' THEN artists.id END) AS approved_artist_count,
      COUNT(DISTINCT tracks.id) AS track_count,
      COUNT(DISTINCT CASE WHEN tracks.review_status = 'approved' THEN tracks.id END) AS approved_track_count
    FROM playlist_collection_definitions definitions
    LEFT JOIN playlist_collection_sources sources ON sources.collection_id = definitions.id
    LEFT JOIN playlist_collection_artists artists ON artists.collection_id = definitions.id
    LEFT JOIN playlist_collection_tracks tracks ON tracks.collection_id = definitions.id
    GROUP BY definitions.id
    ORDER BY definitions.collection_code COLLATE NOCASE ASC
  `).all().map((row) => ({
    collection_code: row.collection_code,
    collection_name: row.collection_name,
    research_status: row.research_status,
    source_count: Number(row.source_count || 0),
    active_source_count: Number(row.active_source_count || 0),
    artist_count: Number(row.artist_count || 0),
    approved_artist_count: Number(row.approved_artist_count || 0),
    track_count: Number(row.track_count || 0),
    approved_track_count: Number(row.approved_track_count || 0),
  }));

  return {
    status: "ok",
    summary: {
      collection_count: collections.length,
      source_count: collections.reduce((sum, row) => sum + row.source_count, 0),
      artist_count: collections.reduce((sum, row) => sum + row.artist_count, 0),
      approved_artist_count: collections.reduce((sum, row) => sum + row.approved_artist_count, 0),
      track_count: collections.reduce((sum, row) => sum + row.track_count, 0),
      approved_track_count: collections.reduce((sum, row) => sum + row.approved_track_count, 0),
    },
    collections,
  };
}

try {
  console.log(JSON.stringify(verifyPlaylistIntelligence(), null, 2));
} catch (err) {
  console.error(JSON.stringify({ status: "error", message: err.message }, null, 2));
  process.exitCode = 1;
} finally {
  closeDatabase();
}

module.exports = { verifyPlaylistIntelligence };
