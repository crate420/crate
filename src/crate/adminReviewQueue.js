const artistGenreRepo = require("../repositories/artistGenres");
const lastfmArtistTagRepo = require("../repositories/lastfmArtistTags");
const trackRepo = require("../repositories/tracks");
const { getMissingArtistGenres } = require("./missingArtistGenres");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const ALLOWED_GENRES = new Set([
  "rock",
  "pop",
  "hiphop",
  "soul",
  "rb",
  "jazz",
  "dance",
  "country",
  "blues",
  "alternative",
  "newwave",
  "electronic",
  "seasonal",
  "singer_songwriter",
  "folk",
  "soundtrack",
  "metal",
  "punk",
]);

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function buildSampleTracksByArtist(userId) {
  const samples = new Map();
  const rows = trackRepo.getAllUnmatchedTracksForUser(userId);

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);

    for (const artistName of getArtistNames(row, rawTrack)) {
      if (samples.has(artistName)) {
        continue;
      }

      samples.set(artistName, {
        track_id: row.track_id,
        title: row.name,
        album_name: row.album_name,
        spotify_track_id: row.spotify_track_id,
      });
    }
  }

  return samples;
}

function serializeLastfmSuggestion(row) {
  if (!row) {
    return {
      suggested_genres: [],
      suggested_tags: [],
      status: "uncached",
    };
  }

  return {
    suggested_genres: parseJsonArray(row.mapped_genres_json),
    suggested_tags: parseJsonArray(row.raw_tags_json).map((tag) => tag.name).filter(Boolean),
    status: row.status,
  };
}

async function getAdminReviewQueue(userId) {
  const missing = await getMissingArtistGenres(userId, { limit: 500 });
  const samplesByArtist = buildSampleTracksByArtist(userId);
  const artists = missing.artists.flatMap((artist) => {
    const lastfmRow = lastfmArtistTagRepo.findByArtistName(artist.artist_name);

    if (lastfmRow?.status === "ignored") {
      return [];
    }

    const suggestion = serializeLastfmSuggestion(lastfmRow);

    return [{
      artist_name: artist.artist_name,
      track_count: artist.unmatched_track_count,
      sample_track: samplesByArtist.get(artist.artist_name) || null,
      ...suggestion,
    }];
  });

  return {
    count: artists.length,
    artists,
  };
}

function normalizeGenres(genres) {
  if (!Array.isArray(genres)) {
    const error = new Error("genres must be an array.");
    error.statusCode = 400;
    error.code = "invalid_genres";
    throw error;
  }

  const normalized = [...new Set(genres.map((genre) => String(genre).trim()).filter(Boolean))];
  const invalid = normalized.filter((genre) => !ALLOWED_GENRES.has(genre));

  if (normalized.length === 0 || invalid.length > 0) {
    const error = new Error(
      invalid.length > 0
        ? `Invalid genre(s): ${invalid.join(", ")}.`
        : "At least one genre is required.",
    );
    error.statusCode = 400;
    error.code = "invalid_genres";
    throw error;
  }

  return normalized;
}

function requireArtistName(artistName) {
  if (!artistName || typeof artistName !== "string") {
    const error = new Error("artist_name is required.");
    error.statusCode = 400;
    error.code = "invalid_artist_name";
    throw error;
  }

  return artistName.trim();
}

function applyAdminReviewQueueArtist({ artistName, genres }) {
  const normalizedArtistName = requireArtistName(artistName);
  const normalizedGenres = normalizeGenres(genres);
  const result = artistGenreRepo.insertArtistGenres({
    artistName: normalizedArtistName,
    genres: normalizedGenres,
    source: "admin_review",
  });
  const lastfmResult = lastfmArtistTagRepo.markApplied(normalizedArtistName);

  return {
    artist_name: normalizedArtistName,
    genres: normalizedGenres,
    inserted_count: result.inserted,
    lastfm_row_marked_applied: lastfmResult.changes > 0,
  };
}

function ignoreAdminReviewQueueArtist(artistName) {
  const normalizedArtistName = requireArtistName(artistName);
  const result = lastfmArtistTagRepo.markIgnored(normalizedArtistName);

  return {
    artist_name: normalizedArtistName,
    lastfm_row_marked_ignored: result.changes > 0,
  };
}

module.exports = {
  applyAdminReviewQueueArtist,
  getAdminReviewQueue,
  ignoreAdminReviewQueueArtist,
};
