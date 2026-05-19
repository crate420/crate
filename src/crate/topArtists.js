const { openDatabase } = require("../db");

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
  const rows = openDatabase()
    .prepare(`
      SELECT artist_names
      FROM tracks
    `)
    .all();
  const countsByArtistName = new Map();

  for (const row of rows) {
    for (const artistName of parseArtistNames(row.artist_names)) {
      countsByArtistName.set(artistName, (countsByArtistName.get(artistName) || 0) + 1);
    }
  }

  return [...countsByArtistName.entries()]
    .map(([artistName, count]) => ({ artist_name: artistName, count }))
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
