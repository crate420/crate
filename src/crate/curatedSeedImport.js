const fs = require("node:fs");
const path = require("node:path");
const curatedSeedRepo = require("../repositories/curatedPlaylistSeeds");

const CURATED_SEED_FILES = [
  { seedCode: "beach_vibes", sourceType: "user_curated", filename: "Beach_Vibes.csv" },
  { seedCode: "disco", sourceType: "user_curated", filename: "Disco_Fever.csv" },
  { seedCode: "motown", sourceType: "user_curated", filename: "Motown.csv" },
  { seedCode: "pop_punk", sourceType: "user_curated", filename: "Pure_Pop_Punk.csv" },
  { seedCode: "southern_soul", sourceType: "crate_curated", filename: "Southern_Soul.csv" },
  { seedCode: "yacht_rock", sourceType: "user_curated", filename: "Yacht_Rock.csv" },
];

function normalizeText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|with)\b.*$/i, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const normalized = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") { field += "\""; index += 1; }
      else { inQuotes = !inQuotes; }
    } else if (char === "," && !inQuotes) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = []; field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function spotifyTrackIdFromUri(uri) {
  const value = String(uri || "").trim();
  if (value.startsWith("spotify:track:")) return value.split(":").pop();
  return value || null;
}

function splitArtists(value) {
  return String(value || "").split(";").map((artist) => artist.trim()).filter(Boolean);
}

function splitGenres(value) {
  return String(value || "").split(",").map((genre) => genre.trim()).filter(Boolean);
}

function normalizeCsvTrack(row, position) {
  const artistNames = splitArtists(row["Artist Name(s)"]);
  const primaryArtist = artistNames[0] || row["Artist Name(s)"] || "Unknown Artist";
  return {
    spotify_uri: row["Track URI"] || null,
    spotify_track_id: spotifyTrackIdFromUri(row["Track URI"]),
    track_name: row["Track Name"] || "Unknown Track",
    artist_name: primaryArtist,
    artist_names: artistNames,
    normalized_track: normalizeText(row["Track Name"]),
    normalized_artist: normalizeText(primaryArtist).replace(/^the\s+/, ""),
    album_name: row["Album Name"] || null,
    release_date: row["Release Date"] || null,
    genres: splitGenres(row.Genres),
    position,
  };
}

function summarizeTracks(tracks) {
  const trackKeys = new Map();
  const artistKeys = new Map();
  for (const track of tracks) {
    const key = track.normalized_track + "::" + track.normalized_artist;
    trackKeys.set(key, (trackKeys.get(key) || 0) + 1);
    artistKeys.set(track.normalized_artist, (artistKeys.get(track.normalized_artist) || 0) + 1);
  }
  return {
    track_count: tracks.length,
    artist_count: artistKeys.size,
    duplicate_tracks: [...trackKeys.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0),
    duplicate_artists: [...artistKeys.values()].filter((count) => count > 1).length,
  };
}

function importCuratedSeedCsv({ seedCode, sourceType, filePath }) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  const tracks = rows.map((row, index) => normalizeCsvTrack(row, index + 1)).filter((track) => track.normalized_track && track.normalized_artist);
  const importedAt = new Date().toISOString();
  curatedSeedRepo.replaceCuratedSeedTracks({ seedCode, sourceType, tracks, importedAt });
  return { seed_code: seedCode, source_type: sourceType, file_path: filePath, imported_at: importedAt, ...summarizeTracks(tracks) };
}

function importCuratedSeedCsvDirectory(csvDirectory) {
  return CURATED_SEED_FILES.map((entry) => {
    const filePath = path.join(csvDirectory, entry.filename);
    if (!fs.existsSync(filePath)) {
      return { seed_code: entry.seedCode, source_type: entry.sourceType, file_path: filePath, error: "missing_file" };
    }
    return importCuratedSeedCsv({ seedCode: entry.seedCode, sourceType: entry.sourceType, filePath });
  });
}

module.exports = {
  CURATED_SEED_FILES,
  importCuratedSeedCsv,
  importCuratedSeedCsvDirectory,
  normalizeText,
  parseCsv,
};
