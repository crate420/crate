const { PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const spotifyArtists = require("../spotify/artists");
const trackRepo = require("../repositories/tracks");
const {
  getArtistIds,
  getArtistNames,
  getGenresForTrack,
  getReleaseDate,
  parseRawTrack,
} = require("./trackContext");

function releaseYearFromDate(value) {
  const year = Number.parseInt(String(value || "").slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reviewStatusForGenres(genres) {
  return genres.length > 0
    ? "Has Spotify genres, no playlist rule matched"
    : "No Spotify genre data available";
}

async function getAdminUnmatchedReview(userId, options = {}) {
  const limit = Math.min(Math.max(Number.parseInt(options.limit || "2000", 10) || 2000, 1), 5000);
  const offset = Math.max(Number.parseInt(options.offset || "0", 10) || 0, 0);
  const rows = trackRepo.getUnmatchedTracksForUser(userId, { limit, offset });
  const artistIds = rows.flatMap((row) => getArtistIds(parseRawTrack(row.raw_json)));
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);

  const tracks = rows.map((row) => {
    const rawTrack = parseRawTrack(row.raw_json);
    const releaseDate = getReleaseDate(rawTrack);
    const spotifyGenres = getGenresForTrack(rawTrack, artistsById);

    return {
      track_id: row.track_id,
      spotify_track_id: row.spotify_track_id,
      title: row.name,
      artist_names: getArtistNames(row, rawTrack),
      album_name: row.album_name,
      release_date: releaseDate,
      release_year: releaseYearFromDate(releaseDate),
      spotify_genres: spotifyGenres,
      status: reviewStatusForGenres(spotifyGenres),
    };
  });

  return {
    status: "ok",
    limit,
    offset,
    count: tracks.length,
    playlist_definitions: PLAYLIST_DEFINITIONS,
    tracks,
  };
}

async function getAdminUnmatchedReviewCsv(userId) {
  const rows = trackRepo.getAllUnmatchedTracksForUser(userId);
  const artistIds = rows.flatMap((row) => getArtistIds(parseRawTrack(row.raw_json)));
  const artistsById = await spotifyArtists.getArtistsByIds(userId, artistIds);
  const header = [
    "track_id",
    "spotify_track_id",
    "title",
    "artist_names",
    "album_name",
    "release_date",
    "release_year",
    "spotify_genres",
    "status",
    "manual_playlist_code",
  ];

  const lines = [header.join(",")];

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    const releaseDate = getReleaseDate(rawTrack);
    const spotifyGenres = getGenresForTrack(rawTrack, artistsById);
    lines.push([
      row.track_id,
      row.spotify_track_id,
      row.name,
      getArtistNames(row, rawTrack),
      row.album_name,
      releaseDate,
      releaseYearFromDate(releaseDate),
      spotifyGenres,
      reviewStatusForGenres(spotifyGenres),
      "",
    ].map(csvEscape).join(","));
  }

  return lines.join("\n") + "\n";
}

module.exports = {
  getAdminUnmatchedReview,
  getAdminUnmatchedReviewCsv,
};
