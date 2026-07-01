const { openDatabase } = require("../db");
const { effectiveReleaseYearForRow } = require("./eraYears");

function parseArtistNames(value) {
  try {
    const parsed = JSON.parse(value || "[]");

    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

function getTopArtists(options = {}) {
  const limit = Math.min(Math.max(Number.parseInt(options.limit || "10", 10) || 10, 1), 50);
  const parsedUserId = Number(options.userId);
  const userId = options.userId != null && Number.isInteger(parsedUserId) ? parsedUserId : null;
  const db = openDatabase();
  const rows = userId
    ? db.prepare(`
      SELECT
        tracks.artist_names,
        tracks.raw_json,
        track_era_overrides.effective_release_year
      FROM user_tracks
      INNER JOIN tracks ON tracks.id = user_tracks.track_id
      LEFT JOIN track_era_overrides ON track_era_overrides.track_id = tracks.id
      WHERE user_tracks.user_id = ?
    `).all(userId)
    : db.prepare(`
      SELECT artist_names, raw_json, NULL AS effective_release_year
      FROM tracks
    `).all();
  const countsByArtistName = new Map();

  for (const row of rows) {
    const releaseYear = effectiveReleaseYearForRow(row);
    for (const artistName of parseArtistNames(row.artist_names)) {
      if (!countsByArtistName.has(artistName)) {
        countsByArtistName.set(artistName, { count: 0, yearCounts: new Map() });
      }
      const artistCounts = countsByArtistName.get(artistName);
      artistCounts.count += 1;
      if (releaseYear) {
        artistCounts.yearCounts.set(releaseYear, (artistCounts.yearCounts.get(releaseYear) || 0) + 1);
      }
    }
  }

  return [...countsByArtistName.entries()]
    .map(([artistName, data]) => ({
      artist_name: artistName,
      count: data.count,
      year_counts: [...data.yearCounts.entries()]
        .map(([year, count]) => ({ year: Number(year), count }))
        .sort((left, right) => left.year - right.year),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.artist_name.localeCompare(b.artist_name);
    })
    .slice(0, limit);
}

module.exports = {
  getTopArtists,
};
