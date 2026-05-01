const config = require("../config");
const { openDatabase } = require("../db");

function readCount(db, tableName, whereClause = "", params = {}) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${tableName}
    ${whereClause}
  `).get(params).count;
}

function getDatabaseDiagnostics(userId) {
  const db = openDatabase();

  return {
    active_database_path: config.databasePath,
    current_user_id: userId,
    users_count: readCount(db, "users"),
    tracks_count: readCount(db, "tracks"),
    user_tracks_count: readCount(db, "user_tracks"),
    current_user_track_count: readCount(
      db,
      "user_tracks",
      "WHERE user_id = @userId",
      { userId },
    ),
    artist_genres_count: readCount(db, "artist_genres"),
  };
}

module.exports = {
  getDatabaseDiagnostics,
};
