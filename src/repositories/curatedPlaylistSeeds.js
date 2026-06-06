const { openDatabase } = require("../db");

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch (err) { return fallback; }
}

function replaceCuratedSeedTracks({ seedCode, sourceType, tracks, importedAt = new Date().toISOString() }) {
  const db = openDatabase();
  const deleteRows = db.prepare("DELETE FROM curated_playlist_seed_tracks WHERE seed_code = ? AND source_type = ?");
  const insertRow = db.prepare("INSERT INTO curated_playlist_seed_tracks (seed_code, source_type, spotify_track_id, spotify_uri, track_name, artist_name, artist_names_json, normalized_track, normalized_artist, album_name, release_date, genres_json, position, imported_at) VALUES (@seedCode, @sourceType, @spotifyTrackId, @spotifyUri, @trackName, @artistName, @artistNamesJson, @normalizedTrack, @normalizedArtist, @albumName, @releaseDate, @genresJson, @position, @importedAt) ON CONFLICT(seed_code, source_type, normalized_track, normalized_artist) DO UPDATE SET spotify_track_id = excluded.spotify_track_id, spotify_uri = excluded.spotify_uri, track_name = excluded.track_name, artist_name = excluded.artist_name, artist_names_json = excluded.artist_names_json, album_name = excluded.album_name, release_date = excluded.release_date, genres_json = excluded.genres_json, position = excluded.position, imported_at = excluded.imported_at");
  const write = db.transaction(() => {
    deleteRows.run(seedCode, sourceType);
    for (const track of tracks) {
      insertRow.run({
        seedCode,
        sourceType,
        spotifyTrackId: track.spotify_track_id || null,
        spotifyUri: track.spotify_uri || null,
        trackName: track.track_name,
        artistName: track.artist_name,
        artistNamesJson: JSON.stringify(track.artist_names || []),
        normalizedTrack: track.normalized_track,
        normalizedArtist: track.normalized_artist,
        albumName: track.album_name || null,
        releaseDate: track.release_date || null,
        genresJson: JSON.stringify(track.genres || []),
        position: track.position,
        importedAt,
      });
    }
  });
  write();
  return { replaced: tracks.length };
}

function listCuratedSeedTracks(seedCode, sourceType) {
  const params = [];
  let where = "WHERE 1 = 1";
  if (seedCode) { where += " AND seed_code = ?"; params.push(seedCode); }
  if (sourceType) { where += " AND source_type = ?"; params.push(sourceType); }
  return openDatabase()
    .prepare("SELECT * FROM curated_playlist_seed_tracks " + where + " ORDER BY seed_code, position ASC")
    .all(...params)
    .map((row) => ({
      ...row,
      artist_names: parseJson(row.artist_names_json, []),
      genres: parseJson(row.genres_json, []),
    }));
}

function summarizeCuratedSeeds() {
  return openDatabase()
    .prepare("SELECT seed_code, source_type, COUNT(*) AS track_count, COUNT(DISTINCT normalized_artist) AS artist_count, MIN(imported_at) AS imported_at FROM curated_playlist_seed_tracks GROUP BY seed_code, source_type ORDER BY seed_code COLLATE NOCASE ASC")
    .all();
}

module.exports = {
  listCuratedSeedTracks,
  replaceCuratedSeedTracks,
  summarizeCuratedSeeds,
};
