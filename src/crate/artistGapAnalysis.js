const { openDatabase } = require("../db");
const { buildDiagnosticsForUser } = require("./unmatchedDiagnostics");

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function normalizeArtistName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLimit(value, fallback = 100, maximum = 500) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function countBy(values, keyName) {
  const counts = new Map();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ [keyName]: value, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function readUsersWithTracks() {
  return openDatabase().prepare(`
    SELECT
      users.id AS user_id,
      users.spotify_user_id,
      users.display_name,
      users.email,
      COUNT(user_tracks.track_id) AS total_tracks
    FROM users
    INNER JOIN user_tracks ON user_tracks.user_id = users.id
    GROUP BY users.id
    ORDER BY users.id ASC
  `).all();
}

function readApprovedGenresByArtist() {
  const db = openDatabase();
  if (!tableExists(db, "artist_genres")) return new Map();

  const rows = db.prepare(`
    SELECT artist_name, genre, source
    FROM artist_genres
    ORDER BY artist_name COLLATE NOCASE ASC, genre COLLATE NOCASE ASC
  `).all();

  const result = new Map();
  for (const row of rows) {
    const key = normalizeArtistName(row.artist_name);
    if (!key) continue;
    const item = result.get(key) || { genres: new Set(), sources: new Set() };
    item.genres.add(row.genre);
    item.sources.add(row.source);
    result.set(key, item);
  }

  return result;
}

function addUnique(set, values) {
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (normalized) set.add(normalized);
  }
}

function makeArtistRecord(artistName) {
  return {
    artist_name: artistName,
    normalized_artist_name: normalizeArtistName(artistName),
    affected_user_ids: new Set(),
    affected_users: new Map(),
    unmatched_track_ids: new Set(),
    total_occurrences: 0,
    spotify_artist_ids: new Set(),
    spotify_genres: new Set(),
    approved_artist_genres: new Set(),
    approved_sources: new Set(),
    unmatched_reasons: new Map(),
    sample_tracks: [],
    estimated_match_gain_if_approved: 0,
  };
}

function increment(map, key, amount = 1) {
  const normalized = String(key || "").trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function serializeCountMap(map, keyName) {
  return [...map.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function learningStatus(record) {
  if (record.approved_artist_genres.size > 0) return "approved_fallback_present";
  if (record.spotify_genres.size > 0) return "spotify_genres_no_rule_match";
  return "missing_artist_genres";
}

function attachApprovedGenres(recordsByArtist, approvedByArtist) {
  for (const [artistKey, approved] of approvedByArtist.entries()) {
    const record = recordsByArtist.get(artistKey);
    if (!record) continue;
    addUnique(record.approved_artist_genres, approved.genres);
    addUnique(record.approved_sources, approved.sources);
  }
}

function serializeArtistRecord(record) {
  return {
    artist_name: record.artist_name,
    normalized_artist_name: record.normalized_artist_name,
    affected_user_count: record.affected_user_ids.size,
    affected_users: [...record.affected_users.values()].sort((a, b) => a.user_id - b.user_id),
    unmatched_track_count: record.unmatched_track_ids.size,
    total_occurrences: record.total_occurrences,
    spotify_artist_ids: [...record.spotify_artist_ids].sort(),
    spotify_artist_id: [...record.spotify_artist_ids][0] || null,
    spotify_genres: [...record.spotify_genres].sort((a, b) => a.localeCompare(b)),
    approved_artist_genres: [...record.approved_artist_genres].sort((a, b) => a.localeCompare(b)),
    approved_sources: [...record.approved_sources].sort((a, b) => a.localeCompare(b)),
    current_learning_status: learningStatus(record),
    unmatched_reasons: serializeCountMap(record.unmatched_reasons, "reason"),
    estimated_match_gain_if_approved: record.estimated_match_gain_if_approved,
    sample_tracks: record.sample_tracks.slice(0, 8),
  };
}

async function getAdminArtistGapAnalysis(options = {}) {
  const limit = normalizeLimit(options.limit, 100, 500);
  const users = readUsersWithTracks();
  const recordsByArtist = new Map();
  const allGenres = [];
  let totalUnmatchedTracks = 0;

  for (const user of users) {
    const diagnostics = await buildDiagnosticsForUser(user.user_id);
    totalUnmatchedTracks += diagnostics.length;

    for (const diagnostic of diagnostics) {
      const artistNames = diagnostic.artist_names && diagnostic.artist_names.length ? diagnostic.artist_names : ["Unknown Artist"];
      const artistIds = diagnostic.spotify_artist_ids || [];
      allGenres.push(...(diagnostic.spotify_artist_genres || []));

      artistNames.forEach((artistName, index) => {
        const normalizedArtistName = normalizeArtistName(artistName);
        if (!normalizedArtistName) return;
        const record = recordsByArtist.get(normalizedArtistName) || makeArtistRecord(artistName);
        record.affected_user_ids.add(user.user_id);
        record.affected_users.set(user.user_id, {
          user_id: user.user_id,
          name: user.display_name || null,
          email: user.email || null,
        });
        record.unmatched_track_ids.add(diagnostic.track_id);
        record.total_occurrences += 1;
        if (artistIds[index]) record.spotify_artist_ids.add(artistIds[index]);
        addUnique(record.spotify_genres, diagnostic.spotify_artist_genres);
        addUnique(record.approved_artist_genres, diagnostic.approved_artist_genres);
        increment(record.unmatched_reasons, diagnostic.final_unmatched_reason);
        if (diagnostic.final_unmatched_reason === "no_artist_genres_found") {
          record.estimated_match_gain_if_approved += 1;
        }
        if (record.sample_tracks.length < 8) {
          record.sample_tracks.push({
            user_id: user.user_id,
            track_id: diagnostic.track_id,
            track_name: diagnostic.track_name,
            album_name: diagnostic.album_name,
            reason: diagnostic.final_unmatched_reason,
          });
        }
        recordsByArtist.set(normalizedArtistName, record);
      });
    }
  }

  attachApprovedGenres(recordsByArtist, readApprovedGenresByArtist());

  const artists = [...recordsByArtist.values()]
    .map(serializeArtistRecord)
    .sort((left, right) => {
      if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
      if (right.unmatched_track_count !== left.unmatched_track_count) return right.unmatched_track_count - left.unmatched_track_count;
      if (right.estimated_match_gain_if_approved !== left.estimated_match_gain_if_approved) return right.estimated_match_gain_if_approved - left.estimated_match_gain_if_approved;
      return left.artist_name.localeCompare(right.artist_name);
    });

  const totalEstimatedGain = artists.reduce((sum, artist) => sum + artist.estimated_match_gain_if_approved, 0);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    user_count: users.length,
    total_unmatched_tracks: totalUnmatchedTracks,
    artist_count: artists.length,
    estimated_match_gain_if_approved: totalEstimatedGain,
    top_missing_artists: artists.slice(0, limit),
    top_missing_genres: countBy(allGenres, "genre").slice(0, limit),
  };
}

module.exports = {
  getAdminArtistGapAnalysis,
};
