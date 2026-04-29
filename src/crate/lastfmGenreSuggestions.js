const artistGenreRepo = require("../repositories/artistGenres");
const lastfmArtistTagRepo = require("../repositories/lastfmArtistTags");
const lastfmClient = require("../lastfm/client");
const { getMissingArtistGenres } = require("./missingArtistGenres");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// Conservative v1 mapper. Last.fm is folksonomy data, so only clear tags map
// to Crate's existing category names. Everything else remains review-only.
const TAG_CATEGORY_KEYWORDS = [
  { category: "hiphop", keywords: ["hip hop", "hip-hop", "rap", "trap"] },
  { category: "rb", keywords: ["r&b", "rnb", "rhythm and blues"] },
  { category: "singer_songwriter", keywords: ["singer-songwriter", "singer songwriter"] },
  { category: "newwave", keywords: ["new wave", "new-wave", "synthpop"] },
  { category: "electronic", keywords: ["electronic", "electronica", "trip hop", "trip-hop"] },
  { category: "alternative", keywords: ["alternative", "indie", "alt rock"] },
  { category: "country", keywords: ["country"] },
  { category: "soundtrack", keywords: ["soundtrack", "stage and screen"] },
  { category: "seasonal", keywords: ["christmas", "holiday"] },
  { category: "dance", keywords: ["dance", "disco", "house"] },
  { category: "soul", keywords: ["soul", "funk"] },
  { category: "folk", keywords: ["folk", "americana"] },
  { category: "metal", keywords: ["metal"] },
  { category: "punk", keywords: ["punk"] },
  { category: "blues", keywords: ["blues"] },
  { category: "jazz", keywords: ["jazz"] },
  { category: "rock", keywords: ["rock"] },
  { category: "pop", keywords: ["pop"] },
];

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function normalizeStatus(value) {
  if (["pending", "applied", "ignored", "error", "all"].includes(value)) {
    return value;
  }

  return "pending";
}

function mapLastfmTagsToCrateGenres(tags) {
  const mapped = [];

  for (const tag of tags) {
    const tagName = String(tag.name || "").trim().toLowerCase();

    if (!tagName) {
      continue;
    }

    for (const rule of TAG_CATEGORY_KEYWORDS) {
      if (rule.keywords.some((keyword) => tagName.includes(keyword))) {
        if (!mapped.includes(rule.category)) {
          mapped.push(rule.category);
        }
        break;
      }
    }

    if (mapped.length >= 3) {
      break;
    }
  }

  return mapped;
}

function getConfidence(mappedGenres) {
  if (mappedGenres.length >= 2) {
    return "medium";
  }

  if (mappedGenres.length === 1) {
    return "low";
  }

  return "low";
}

function serializeRow(row) {
  return {
    artist_name: row.artist_name,
    source_artist_name: row.source_artist_name,
    raw_tags: JSON.parse(row.raw_tags_json || "[]"),
    mapped_genres: JSON.parse(row.mapped_genres_json || "[]"),
    suggested_playlist_code: row.suggested_playlist_code,
    confidence: row.confidence,
    status: row.status,
    error_code: row.error_code,
    error_message: row.error_message,
    fetched_at: row.fetched_at,
    updated_at: row.updated_at,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchLastfmArtistGenreSuggestions(userId, options = {}) {
  lastfmClient.requireLastfmConfig();

  const limit = normalizeLimit(options.limit);
  const missing = await getMissingArtistGenres(userId, { limit: 500 });
  const stats = {
    limit,
    looked_up: 0,
    cached: 0,
    skipped_existing_cache: 0,
    skipped_existing_artist_genres: 0,
    errors: 0,
    artists: [],
  };

  for (const artist of missing.artists) {
    if (stats.looked_up >= limit) {
      break;
    }

    const artistName = artist.artist_name;
    const existingGenres = artistGenreRepo.findGenresByArtistNames([artistName]);

    if ((existingGenres.get(artistName) || []).length > 0) {
      stats.skipped_existing_artist_genres += 1;
      continue;
    }

    if (lastfmArtistTagRepo.findByArtistName(artistName)) {
      stats.skipped_existing_cache += 1;
      continue;
    }

    stats.looked_up += 1;

    try {
      const result = await lastfmClient.getArtistTopTags(artistName);
      const rawTags = result.tags
        .slice(0, 20)
        .map((tag) => ({
          name: tag.name,
          count: Number.parseInt(tag.count, 10) || 0,
        }))
        .filter((tag) => tag.name);
      const mappedGenres = mapLastfmTagsToCrateGenres(rawTags);
      const row = {
        artistName,
        sourceArtistName: result.sourceArtistName,
        rawTags,
        mappedGenres,
        suggestedPlaylistCode: mappedGenres[0] || null,
        confidence: getConfidence(mappedGenres),
        status: "pending",
        errorCode: null,
        errorMessage: null,
      };

      lastfmArtistTagRepo.upsertLookup(row);
      stats.cached += 1;
      stats.artists.push({
        artist_name: artistName,
        source_artist_name: result.sourceArtistName,
        mapped_genres: mappedGenres,
        suggested_playlist_code: row.suggestedPlaylistCode,
        confidence: row.confidence,
      });
    } catch (err) {
      lastfmArtistTagRepo.upsertLookup({
        artistName,
        sourceArtistName: null,
        rawTags: [],
        mappedGenres: [],
        suggestedPlaylistCode: null,
        confidence: "low",
        status: "error",
        errorCode: err.code || "lastfm_error",
        errorMessage: err.message,
      });

      stats.errors += 1;
    }

    await sleep(250);
  }

  return stats;
}

function getLastfmArtistGenreSuggestions(options = {}) {
  const status = normalizeStatus(options.status);
  const suggestions = lastfmArtistTagRepo.listByStatus(status).map(serializeRow);

  return {
    status,
    count: suggestions.length,
    suggestions,
  };
}

function applyLastfmArtistGenreSuggestion(artistName) {
  if (!artistName || typeof artistName !== "string") {
    const error = new Error("artist_name is required.");
    error.statusCode = 400;
    error.code = "invalid_artist_name";
    throw error;
  }

  const row = lastfmArtistTagRepo.findByArtistName(artistName);

  if (!row) {
    const error = new Error("No cached Last.fm suggestion found for this artist.");
    error.statusCode = 404;
    error.code = "suggestion_not_found";
    throw error;
  }

  const mappedGenres = JSON.parse(row.mapped_genres_json || "[]");

  if (mappedGenres.length === 0) {
    const error = new Error("Cached Last.fm suggestion has no mapped Crate genres.");
    error.statusCode = 400;
    error.code = "no_mapped_genres";
    throw error;
  }

  const result = artistGenreRepo.insertArtistGenres({
    artistName: row.artist_name,
    genres: mappedGenres,
    source: "lastfm",
  });

  lastfmArtistTagRepo.markApplied(row.artist_name);

  return {
    artist_name: row.artist_name,
    inserted_count: result.inserted,
    source: "lastfm",
    mapped_genres: mappedGenres,
  };
}

function applySafeLastfmArtistGenreSuggestionBatch() {
  const rows = lastfmArtistTagRepo.listSafeBatchToApply(25);
  const artistNamesApplied = [];

  for (const row of rows) {
    const mappedGenres = JSON.parse(row.mapped_genres_json || "[]");

    if (mappedGenres.length === 0) {
      continue;
    }

    artistGenreRepo.insertArtistGenres({
      artistName: row.artist_name,
      genres: mappedGenres,
      source: "lastfm",
    });
    lastfmArtistTagRepo.markApplied(row.artist_name);
    artistNamesApplied.push(row.artist_name);
  }

  return {
    applied_count: artistNamesApplied.length,
    skipped_count: rows.length - artistNamesApplied.length,
    artist_names: artistNamesApplied,
  };
}

module.exports = {
  applyLastfmArtistGenreSuggestion,
  applySafeLastfmArtistGenreSuggestionBatch,
  fetchLastfmArtistGenreSuggestions,
  getLastfmArtistGenreSuggestions,
};
