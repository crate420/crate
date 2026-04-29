const { openDatabase } = require("../db");

function normalizeArtistName(artistName) {
  return String(artistName || "").trim().toLowerCase();
}

function insertArtistGenres({ artistName, genres, source }) {
  const db = openDatabase();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO artist_genres (
      artist_name,
      genre,
      source
    )
    VALUES (
      @artistName,
      @genre,
      @source
    )
  `);

  const insertAll = db.transaction(() => {
    let inserted = 0;

    for (const genre of genres) {
      const result = insert.run({
        artistName,
        genre,
        source,
      });

      inserted += result.changes;
    }

    return inserted;
  });

  return { inserted: insertAll() };
}

function findGenresByArtistNames(artistNames) {
  const uniqueArtistNames = [...new Set(artistNames.map(normalizeArtistName))].filter(Boolean);

  if (uniqueArtistNames.length === 0) {
    return new Map();
  }

  const placeholders = uniqueArtistNames.map(() => "?").join(", ");
  const rows = openDatabase()
    .prepare(`
      SELECT artist_name, genre
      FROM artist_genres
      WHERE lower(trim(artist_name)) IN (${placeholders})
      ORDER BY artist_name COLLATE NOCASE ASC, genre COLLATE NOCASE ASC
    `)
    .all(...uniqueArtistNames);

  const genresByArtistName = new Map();

  for (const row of rows) {
    const normalizedArtistName = normalizeArtistName(row.artist_name);
    const genres = genresByArtistName.get(normalizedArtistName) || [];
    genres.push(row.genre);
    genresByArtistName.set(normalizedArtistName, genres);
  }

  return genresByArtistName;
}

function countExistingSuggestedGenres(suggestions) {
  const countsByArtistName = new Map();

  if (suggestions.length === 0) {
    return countsByArtistName;
  }

  const db = openDatabase();

  for (const suggestion of suggestions) {
    const placeholders = suggestion.suggestedGenres.map(() => "?").join(", ");
    const countExisting = db.prepare(`
      SELECT COUNT(*) AS count
      FROM artist_genres
      WHERE artist_name = ?
        AND genre IN (${placeholders})
    `);
    const row = countExisting.get(
      suggestion.artistName,
      ...suggestion.suggestedGenres,
    );

    countsByArtistName.set(suggestion.artistName, row.count);
  }

  return countsByArtistName;
}

module.exports = {
  countExistingSuggestedGenres,
  findGenresByArtistNames,
  insertArtistGenres,
  normalizeArtistName,
};
