const { openDatabase } = require("../db");
const { effectiveReleaseYearForRow, eraForYear, releaseYearFromDate } = require("./eraYears");

const ERA_KEYS = ["vintage", "classic", "retro", "modern"];
const STRONG_SIGNALS = [
  "remaster",
  "remastered",
  "anniversary",
  "expanded",
  "collector",
  "reissue",
  "stereo mix",
  "mono mix",
];
const ALL_SIGNALS = [...STRONG_SIGNALS, "deluxe"];

function normalizeLimit(value, fallback = 250, maximum = 1000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseArtistNames(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    return String(value || "")
      .split(/,|;|\|/)
      .map((artist) => artist.trim())
      .filter(Boolean);
  }
}

function parseRawTrack(rawJson) {
  try {
    return JSON.parse(rawJson || "{}");
  } catch (err) {
    return {};
  }
}



function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function detectEditionSignals(trackName, albumName) {
  const text = normalizeText([trackName, albumName].filter(Boolean).join(" "));
  const signals = [];

  if (/\bremastered?\b/.test(text) || /\bremaster\b/.test(text)) {
    signals.push(text.includes("remastered") ? "remastered" : "remaster");
  }

  for (const signal of ["anniversary", "expanded", "collector", "reissue", "stereo mix", "mono mix", "deluxe"]) {
    if (text.includes(signal)) {
      signals.push(signal);
    }
  }

  return [...new Set(signals)];
}

function confidenceForSignals(currentEra, signals) {
  const signalSet = new Set(signals);
  const hasStrongSignal = signals.some((signal) => STRONG_SIGNALS.includes(signal));
  const isDeluxeOnly = signalSet.has("deluxe") && !hasStrongSignal;

  if (currentEra === "modern" && hasStrongSignal) {
    return "strong";
  }

  if (isDeluxeOnly) {
    return "low";
  }

  if (hasStrongSignal) {
    return "medium";
  }

  return "low";
}

function suggestedActionFor(confidence, currentEra, signals) {
  if (confidence === "strong") {
    return "Review original release year; likely modern remaster/reissue date.";
  }

  if (signals.length === 1 && signals[0] === "deluxe") {
    return "Low confidence deluxe-only signal; keep Spotify year unless manually verified.";
  }

  if (currentEra && currentEra !== "modern") {
    return "No immediate action; Spotify year already lands in an older era.";
  }

  return "Review only if era placement looks suspicious.";
}

function countBy(records, key) {
  const counts = new Map();
  for (const record of records) {
    const values = Array.isArray(record[key]) ? record[key] : [record[key] || "unknown"];
    for (const value of values) {
      const label = String(value || "unknown");
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function matchesFilters(record, filters) {
  if (filters.currentEra && record.current_era !== filters.currentEra) return false;
  if (filters.playlist && record.playlist_code !== filters.playlist) return false;
  if (filters.signal && !record.detected_edition_signals.includes(filters.signal)) return false;
  if (filters.confidence && record.confidence_bucket !== filters.confidence) return false;
  return true;
}

function readUserTrackRows(userId) {
  return openDatabase().prepare(
    "SELECT " +
      "user_tracks.user_id, " +
      "user_tracks.track_id, " +
      "tracks.spotify_track_id, " +
      "tracks.uri, " +
      "tracks.name, " +
      "tracks.artist_names, " +
      "tracks.album_name, " +
      "tracks.raw_json, " +
      "track_era_overrides.spotify_release_year AS override_spotify_release_year, " +
      "track_era_overrides.original_release_year, " +
      "track_era_overrides.effective_release_year, " +
      "track_era_overrides.source AS era_override_source, " +
      "track_era_overrides.reason AS era_override_reason, " +
      "track_era_overrides.confidence AS era_override_confidence, " +
      "track_era_overrides.created_at AS era_override_created_at, " +
      "track_era_overrides.updated_at AS era_override_updated_at, " +
      "COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code) AS playlist_code " +
    "FROM user_tracks " +
    "INNER JOIN tracks ON tracks.id = user_tracks.track_id " +
    "LEFT JOIN track_overrides ON track_overrides.track_id = tracks.id " +
    "LEFT JOIN track_era_overrides ON track_era_overrides.track_id = tracks.id " +
    "WHERE user_tracks.user_id = ? " +
    "ORDER BY tracks.artist_names COLLATE NOCASE ASC, tracks.name COLLATE NOCASE ASC"
  ).all(userId);
}

function buildEraDiagnostic(row) {
  const rawTrack = parseRawTrack(row.raw_json);
  const spotifyReleaseDate = rawTrack.album?.release_date || rawTrack.release_date || null;
  const spotifyReleaseYear = releaseYearFromDate(spotifyReleaseDate);
  const effectiveReleaseYear = effectiveReleaseYearForRow({ raw_json: row.raw_json, effective_release_year: row.effective_release_year });
  const currentEra = eraForYear(effectiveReleaseYear);
  const signals = detectEditionSignals(row.name, row.album_name || rawTrack.album?.name);
  const confidence = confidenceForSignals(currentEra, signals);

  return {
    user_id: row.user_id,
    track_id: row.track_id,
    spotify_track_id: row.spotify_track_id,
    track_name: row.name,
    artist_names: parseArtistNames(row.artist_names),
    album_name: row.album_name || rawTrack.album?.name || null,
    spotify_release_date: spotifyReleaseDate,
    spotify_release_year: spotifyReleaseYear,
    original_release_year: row.original_release_year || null,
    effective_release_year: effectiveReleaseYear,
    era_override: row.effective_release_year ? {
      spotify_release_year: row.override_spotify_release_year || spotifyReleaseYear,
      original_release_year: row.original_release_year,
      effective_release_year: row.effective_release_year,
      source: row.era_override_source,
      reason: row.era_override_reason,
      confidence: row.era_override_confidence,
      created_at: row.era_override_created_at,
      updated_at: row.era_override_updated_at,
    } : null,
    spotify_release_date_precision: rawTrack.album?.release_date_precision || null,
    current_era: currentEra,
    playlist_code: row.playlist_code || null,
    detected_edition_signals: signals,
    isrc: rawTrack.external_ids?.isrc || null,
    confidence_bucket: confidence,
    suggested_action: suggestedActionFor(confidence, currentEra, signals),
  };
}

function getAdminEraDiagnostics(userId, options = {}) {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const filters = {
    currentEra: String(options.currentEra || options.era || "").trim().toLowerCase(),
    signal: String(options.signal || "").trim().toLowerCase(),
    playlist: String(options.playlist || "").trim(),
    confidence: String(options.confidence || "").trim().toLowerCase(),
  };

  const records = readUserTrackRows(userId)
    .map(buildEraDiagnostic)
    .filter((record) => record.detected_edition_signals.length > 0);
  const filtered = records.filter((record) => matchesFilters(record, filters));
  const strongSuspects = records.filter((record) => record.confidence_bucket === "strong");
  const deluxeOnly = records.filter((record) => (
    record.detected_edition_signals.length === 1 && record.detected_edition_signals[0] === "deluxe"
  ));

  return {
    status: "ok",
    user_id: userId,
    total_suspect_tracks: records.length,
    filtered_count: filtered.length,
    strong_suspect_count: strongSuspects.length,
    low_confidence_deluxe_only_count: deluxeOnly.length,
    limit,
    offset,
    filters,
    summary: {
      by_signal: countBy(records, "detected_edition_signals"),
      by_playlist: countBy(records, "playlist_code"),
      by_current_era: ERA_KEYS.map((era) => ({
        name: era,
        count: records.filter((record) => record.current_era === era).length,
      })),
      by_confidence: countBy(records, "confidence_bucket"),
    },
    suspect_tracks: filtered.slice(offset, offset + limit),
  };
}

module.exports = {
  ALL_SIGNALS,
  STRONG_SIGNALS,
  detectEditionSignals,
  getAdminEraDiagnostics,
};
