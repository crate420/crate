const artistGenreRepo = require("../repositories/artistGenres");
const lastfmArtistTagRepo = require("../repositories/lastfmArtistTags");
const trackRepo = require("../repositories/tracks");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { getMissingArtistGenres } = require("./missingArtistGenres");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const APPROVAL_GENRE_BY_PLAYLIST_CODE = {
  alternative: "alternative rock",
  christian: "christian",
  classic_rock: "classic rock",
  funk_disco: "funk",
  hard_rock: "hard rock",
  hiphop: "hiphop",
  newwave: "new wave",
  pop_punk: "pop punk",
  rb: "r&b",
  singer_songwriter: "singer-songwriter",
  soft_rock: "soft rock",
  sunshine_pop: "sunshine pop",
};

const APPROVAL_GENRE_OPTIONS = ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => ({
  value: APPROVAL_GENRE_BY_PLAYLIST_CODE[definition.playlistCode] || definition.playlistCode,
  label: definition.shortLabel,
  playlist_code: definition.playlistCode,
}));

const ALLOWED_GENRES = new Set(APPROVAL_GENRE_OPTIONS.map((option) => option.value));
const SAFE_RECOMMENDATIONS = new Map(Object.entries({
  "ben e. king": { genres: ["soul"], playlistCode: "soul", confidence: "high" },
  "emily reid": { genres: ["country"], playlistCode: "country", confidence: "high" },
  "frankie smith": { genres: ["funk"], playlistCode: "funk_disco", confidence: "high" },
  "j. brown": { genres: ["r&b"], playlistCode: "rb", confidence: "high" },
  "joy williams": { genres: ["singer-songwriter"], playlistCode: "singer_songwriter", confidence: "high" },
  "jvke": { genres: ["pop"], playlistCode: "pop", confidence: "high" },
  "key glock": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "lucas": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "mindy smith": { genres: ["country"], playlistCode: "country", confidence: "high" },
  "nathaniel rateliff & the night sweats": { genres: ["soul"], playlistCode: "soul", confidence: "high" },
  "nitty": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "olly alexander (years & years)": { genres: ["pop"], playlistCode: "pop", confidence: "high" },
  "orianthi": { genres: ["hard rock"], playlistCode: "hard_rock", confidence: "high" },
  "pete droge": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "rainbow kitten surprise": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "rixton": { genres: ["pop"], playlistCode: "pop", confidence: "high" },
  "rosa linn": { genres: ["pop"], playlistCode: "pop", confidence: "high" },
  "royal & the serpent": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "run river north": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "schoolboy q": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "sexyy red": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "sheppard": { genres: ["pop"], playlistCode: "pop", confidence: "high" },
  "snow": { genres: ["reggae"], playlistCode: "reggae", confidence: "high" },
  "stampeders": { genres: ["classic rock"], playlistCode: "classic_rock", confidence: "high" },
  "surfaces": { genres: ["pop"], playlistCode: "pop", confidence: "high" },
  "terror squad": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "the folk implosion": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "the funeral portrait": { genres: ["hard rock"], playlistCode: "hard_rock", confidence: "high" },
  "the glorious sons": { genres: ["rock"], playlistCode: "rock", confidence: "high" },
  "the happy fits": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "the ides of march": { genres: ["classic rock"], playlistCode: "classic_rock", confidence: "high" },
  "the orphan the poet": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "the unlikely candidates": { genres: ["alternative rock"], playlistCode: "alternative", confidence: "high" },
  "the wreckers": { genres: ["country"], playlistCode: "country", confidence: "high" },
  "tom morello": { genres: ["hard rock"], playlistCode: "hard_rock", confidence: "high" },
  "toya": { genres: ["r&b"], playlistCode: "rb", confidence: "high" },
  "v.i.c.": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
  "van mccoy & the soul city symphony": { genres: ["funk"], playlistCode: "funk_disco", confidence: "high" },
  "young black teenagers": { genres: ["hiphop"], playlistCode: "hiphop", confidence: "high" },
}));

function normalizeArtistName(value) { return String(value || "").trim().toLowerCase(); }
function playlistLabel(playlistCode) { return ACTIVE_PLAYLIST_DEFINITIONS.find((row) => row.playlistCode === playlistCode)?.shortLabel || playlistCode; }
function parseJsonArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch (err) { return []; } }

function buildSampleTracksByArtist(userId) {
  const samples = new Map();
  for (const row of trackRepo.getAllUnmatchedTracksForUser(userId)) {
    const rawTrack = parseRawTrack(row.raw_json);
    for (const artistName of getArtistNames(row, rawTrack)) {
      if (!samples.has(artistName)) samples.set(artistName, { track_id: row.track_id, title: row.name, album_name: row.album_name, spotify_track_id: row.spotify_track_id });
    }
  }
  return samples;
}

function serializeLastfmSuggestion(row) {
  if (!row) return { suggested_genres: [], suggested_tags: [], status: "uncached" };
  return { suggested_genres: parseJsonArray(row.mapped_genres_json), suggested_tags: parseJsonArray(row.raw_tags_json).map((tag) => tag.name).filter(Boolean), status: row.status };
}

function recommendationForArtist(artistName, trackCount) {
  const row = SAFE_RECOMMENDATIONS.get(normalizeArtistName(artistName));
  return row ? { artist_name: artistName, track_count: trackCount, genres: row.genres, playlist_code: row.playlistCode, playlist_label: playlistLabel(row.playlistCode), confidence: row.confidence } : null;
}

async function getAdminReviewQueue(userId) {
  const missing = await getMissingArtistGenres(userId, { limit: 500 });
  const samplesByArtist = buildSampleTracksByArtist(userId);
  const approvedGenresByArtist = artistGenreRepo.findGenresByArtistNames(
    missing.artists.map((artist) => artist.artist_name),
  );
  const artists = missing.artists.flatMap((artist) => {
    if (approvedGenresByArtist.has(normalizeArtistName(artist.artist_name))) return [];
    const lastfmRow = lastfmArtistTagRepo.findByArtistName(artist.artist_name);
    if (lastfmRow?.status === "ignored") return [];
    return [{ ...artist, sample_track: samplesByArtist.get(artist.artist_name) || null, recommendation: recommendationForArtist(artist.artist_name, artist.unmatched_track_count), ...serializeLastfmSuggestion(lastfmRow) }];
  });
  return { count: artists.length, artists, genre_options: APPROVAL_GENRE_OPTIONS, recommended_approvals: artists.map((artist) => artist.recommendation).filter(Boolean) };
}

function normalizeGenres(genres) {
  if (!Array.isArray(genres)) { const error = new Error("genres must be an array."); error.statusCode = 400; error.code = "invalid_genres"; throw error; }
  const normalized = [...new Set(genres.map((genre) => String(genre).trim()).filter(Boolean))];
  const invalid = normalized.filter((genre) => !ALLOWED_GENRES.has(genre));
  if (normalized.length === 0 || invalid.length > 0) { const error = new Error(invalid.length ? `Invalid genre(s): ${invalid.join(", ")}.` : "At least one genre is required."); error.statusCode = 400; error.code = "invalid_genres"; throw error; }
  return normalized;
}
function requireArtistName(artistName) { if (!artistName || typeof artistName !== "string") { const error = new Error("artist_name is required."); error.statusCode = 400; error.code = "invalid_artist_name"; throw error; } return artistName.trim(); }

function applyAdminReviewQueueArtist({ artistName, genres }) {
  const normalizedArtistName = requireArtistName(artistName);
  const normalizedGenres = normalizeGenres(genres);
  const result = artistGenreRepo.insertArtistGenres({ artistName: normalizedArtistName, genres: normalizedGenres, source: "admin_review" });
  const lastfmResult = lastfmArtistTagRepo.markApplied(normalizedArtistName);
  return { artist_name: normalizedArtistName, genres: normalizedGenres, inserted_count: result.inserted, lastfm_row_marked_applied: lastfmResult.changes > 0 };
}

async function applyAdminReviewQueueBulk(userId, options = {}) {
  let approvals = Array.isArray(options.approvals) ? options.approvals : [];
  if (options.safeRecommendations === true) approvals = (await getAdminReviewQueue(userId)).recommended_approvals.map((row) => ({ artist_name: row.artist_name, genres: row.genres }));
  if (approvals.length === 0) { const error = new Error("At least one artist approval is required."); error.statusCode = 400; error.code = "missing_approvals"; throw error; }
  if (approvals.length > 100) { const error = new Error("Bulk approval is limited to 100 artists per request."); error.statusCode = 400; error.code = "too_many_approvals"; throw error; }
  const seen = new Set(); const results = []; const errors = []; let inserted = 0; let duplicates = 0;
  for (const approval of approvals) {
    const artistName = requireArtistName(approval?.artist_name); const key = normalizeArtistName(artistName);
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    try { const result = applyAdminReviewQueueArtist({ artistName, genres: approval?.genres }); inserted += result.inserted_count; if (!result.inserted_count) duplicates += 1; results.push(result); }
    catch (err) { errors.push({ artist_name: artistName, error: err.code || "admin_review_queue_error", message: err.message }); }
  }
  return { attempted_count: seen.size, approved_count: results.length, inserted_genres_count: inserted, duplicates_skipped: duplicates, error_count: errors.length, results, errors };
}

function ignoreAdminReviewQueueArtist(artistName) { const normalizedArtistName = requireArtistName(artistName); const result = lastfmArtistTagRepo.markIgnored(normalizedArtistName); return { artist_name: normalizedArtistName, lastfm_row_marked_ignored: result.changes > 0 }; }

module.exports = { APPROVAL_GENRE_OPTIONS, applyAdminReviewQueueArtist, applyAdminReviewQueueBulk, getAdminReviewQueue, ignoreAdminReviewQueueArtist };
