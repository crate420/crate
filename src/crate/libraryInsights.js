const { openDatabase } = require("../db");
const { findGenresByArtistNames, normalizeArtistName } = require("../repositories/artistGenres");
const { effectiveReleaseYearForRow, eraForYear, releaseYearFromDate } = require("./eraYears");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { getSpecialtySuggestionsForUser } = require("./specialtySuggestions");
const { getArtistNames, parseRawTrack } = require("./trackContext");

const ERA_LABELS = {
  vintage: "Vintage",
  classic: "Classic",
  retro: "Retro",
  modern: "Modern",
};

const ERA_ORDER = ["vintage", "classic", "retro", "modern"];

const playlistDefinitionsByCode = new Map(
  ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [definition.playlistCode, definition]),
);

function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT 1 AS found
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get(tableName);

  return Boolean(row);
}

function roundPercentage(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function parseArtistNames(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

function trackDisplayArtist(artistNames) {
  return artistNames.slice(0, 3).join(", ") || "Unknown Artist";
}

function releaseDateFromRawTrack(rawTrack) {
  return rawTrack?.album?.release_date || rawTrack?.release_date || null;
}

function isUsableReleaseYear(year) {
  const parsed = Number.parseInt(year, 10);
  const maxYear = new Date().getFullYear() + 1;
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= maxYear;
}

function decadeForYear(year) {
  if (!isUsableReleaseYear(year)) return null;
  return Math.floor(Number(year) / 10) * 10;
}

function displayDecade(decade) {
  return Number.isInteger(decade) ? `${decade}s` : null;
}

function formatCount(count, singular, plural = `${singular}s`) {
  const normalizedCount = Number(count || 0);
  return `${normalizedCount.toLocaleString()} ${normalizedCount === 1 ? singular : plural}`;
}

function playlistLabel(playlistCode) {
  const definition = playlistDefinitionsByCode.get(playlistCode);
  return String(definition?.shortLabel || definition?.displayName || playlistCode || "")
    .replace(/^Crate:\s*/i, "");
}

function getUserTrackRows(db, userId) {
  if (!tableExists(db, "user_tracks") || !tableExists(db, "tracks")) {
    return [];
  }

  const hasTrackOverrides = tableExists(db, "track_overrides");
  const hasTrackEraOverrides = tableExists(db, "track_era_overrides");
  const effectivePlaylistCode = hasTrackOverrides
    ? "COALESCE(track_overrides.override_playlist_code, user_tracks.playlist_code)"
    : "user_tracks.playlist_code";
  const joinTrackOverrides = hasTrackOverrides
    ? "LEFT JOIN track_overrides ON track_overrides.track_id = user_tracks.track_id"
    : "";
  const joinTrackEraOverrides = hasTrackEraOverrides
    ? "LEFT JOIN track_era_overrides ON track_era_overrides.track_id = user_tracks.track_id"
    : "";
  const effectiveReleaseYearSelect = hasTrackEraOverrides
    ? "track_era_overrides.effective_release_year"
    : "NULL";
  const spotifyReleaseYearSelect = hasTrackEraOverrides
    ? "track_era_overrides.spotify_release_year"
    : "NULL";

  return db.prepare(`
    SELECT
      user_tracks.user_id,
      user_tracks.track_id,
      user_tracks.liked_at,
      ${effectivePlaylistCode} AS playlist_code,
      tracks.spotify_track_id,
      tracks.uri,
      tracks.name,
      tracks.artist_names,
      tracks.album_name,
      tracks.raw_json,
      ${effectiveReleaseYearSelect} AS effective_release_year,
      ${spotifyReleaseYearSelect} AS spotify_release_year
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    ${joinTrackOverrides}
    ${joinTrackEraOverrides}
    WHERE user_tracks.user_id = @userId
  `).all({ userId });
}

function serializeTrack(row, rawTrack, artistNames, releaseYear) {
  return {
    track_id: row.track_id,
    spotify_track_id: row.spotify_track_id,
    title: row.name,
    artist: trackDisplayArtist(artistNames),
    artists: artistNames,
    album: row.album_name,
    uri: row.uri,
    release_date: releaseDateFromRawTrack(rawTrack),
    release_year: releaseYear,
  };
}

function buildTrackRecords(rows) {
  return rows.map((row) => {
    const rawTrack = parseRawTrack(row.raw_json);
    const rawArtistNames = getArtistNames(row, rawTrack);
    const artistNames = rawArtistNames.length ? rawArtistNames : parseArtistNames(row.artist_names);
    const spotifyReleaseYear = releaseYearFromDate(releaseDateFromRawTrack(rawTrack));
    const releaseYear = effectiveReleaseYearForRow({
      raw_json: row.raw_json,
      effective_release_year: row.effective_release_year,
      spotify_release_year: row.spotify_release_year || spotifyReleaseYear,
    });

    return {
      ...row,
      rawTrack,
      artistNames,
      releaseYear: isUsableReleaseYear(releaseYear) ? releaseYear : null,
      spotifyReleaseYear: isUsableReleaseYear(spotifyReleaseYear) ? spotifyReleaseYear : null,
    };
  });
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(countsByKey, labelKey) {
  return [...countsByKey.entries()]
    .map(([key, count]) => ({ [labelKey]: key, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return String(left[labelKey]).localeCompare(String(right[labelKey]));
    });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function compareTimelineTracks(direction) {
  return (left, right) => {
    if (left.releaseYear !== right.releaseYear) {
      return direction === "asc"
        ? left.releaseYear - right.releaseYear
        : right.releaseYear - left.releaseYear;
    }

    const leftDate = releaseDateFromRawTrack(left.rawTrack) || "";
    const rightDate = releaseDateFromRawTrack(right.rawTrack) || "";
    if (leftDate !== rightDate) {
      return direction === "asc"
        ? leftDate.localeCompare(rightDate)
        : rightDate.localeCompare(leftDate);
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  };
}

function buildTimeline(records) {
  const datedRecords = records.filter((record) => record.releaseYear);
  const releaseYears = datedRecords.map((record) => record.releaseYear);
  const byYear = new Map();
  const byDecade = new Map();

  for (const year of releaseYears) {
    increment(byYear, year);
    increment(byDecade, decadeForYear(year));
  }

  const earliestRecord = [...datedRecords].sort(compareTimelineTracks("asc"))[0] || null;
  const latestRecord = [...datedRecords].sort(compareTimelineTracks("desc"))[0] || null;
  const peakYear = topEntries(byYear, "year")[0] || null;
  const peakDecade = topEntries(byDecade, "decade")[0] || null;
  const spanYears = earliestRecord && latestRecord
    ? latestRecord.releaseYear - earliestRecord.releaseYear
    : null;

  return {
    earliest: earliestRecord
      ? {
          year: earliestRecord.releaseYear,
          track: serializeTrack(earliestRecord, earliestRecord.rawTrack, earliestRecord.artistNames, earliestRecord.releaseYear),
          display: `${earliestRecord.releaseYear}: ${earliestRecord.name} by ${trackDisplayArtist(earliestRecord.artistNames)}`,
        }
      : null,
    latest: latestRecord
      ? {
          year: latestRecord.releaseYear,
          track: serializeTrack(latestRecord, latestRecord.rawTrack, latestRecord.artistNames, latestRecord.releaseYear),
          display: `${latestRecord.releaseYear}: ${latestRecord.name} by ${trackDisplayArtist(latestRecord.artistNames)}`,
        }
      : null,
    span: earliestRecord && latestRecord
      ? {
          start_year: earliestRecord.releaseYear,
          end_year: latestRecord.releaseYear,
          years: spanYears,
          display: `${earliestRecord.releaseYear} -> ${latestRecord.releaseYear}`,
        }
      : null,
    peak_year: peakYear
      ? {
          year: Number(peakYear.year),
          count: peakYear.count,
          display: `${peakYear.year} is your peak year with ${formatCount(peakYear.count, "song")}.`,
        }
      : null,
    peak_decade: peakDecade
      ? {
          decade: Number(peakDecade.decade),
          label: displayDecade(Number(peakDecade.decade)),
          count: peakDecade.count,
          display: `${displayDecade(Number(peakDecade.decade))} is your peak decade with ${formatCount(peakDecade.count, "song")}.`,
        }
      : null,
    median_release_year: median(releaseYears),
    release_year_count: releaseYears.length,
  };
}

function buildLibrary(records) {
  const artistCounts = new Map();
  const artistNames = [];
  const playlistCounts = new Map();

  for (const record of records) {
    if (record.playlist_code) increment(playlistCounts, record.playlist_code);
    for (const artistName of record.artistNames) {
      const normalized = normalizeArtistName(artistName);
      if (!normalized) continue;
      artistNames.push(artistName);
      if (!artistCounts.has(normalized)) {
        artistCounts.set(normalized, { artist_name: artistName, count: 0 });
      }
      artistCounts.get(normalized).count += 1;
    }
  }

  const genresByArtistName = findGenresByArtistNames(artistNames);
  const uniqueGenres = new Set();
  const genreCounts = new Map();
  let tracksWithGenreEvidence = 0;

  for (const record of records) {
    const trackGenres = new Set();
    for (const artistName of record.artistNames) {
      for (const genre of genresByArtistName.get(normalizeArtistName(artistName)) || []) {
        const normalizedGenre = String(genre || "").trim();
        if (normalizedGenre) trackGenres.add(normalizedGenre);
      }
    }

    if (trackGenres.size) tracksWithGenreEvidence += 1;
    for (const genre of trackGenres) {
      uniqueGenres.add(genre);
      increment(genreCounts, genre);
    }
  }

  const topArtist = [...artistCounts.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.artist_name.localeCompare(right.artist_name);
  })[0] || null;
  const topGenre = topEntries(genreCounts, "genre")[0] || null;
  const sortedCount = [...playlistCounts.values()].reduce((sum, count) => sum + count, 0);
  const totalLikedSongs = records.length;

  return {
    total_liked_songs: totalLikedSongs,
    matched_sorted_count: sortedCount,
    matched_sorted_percentage: totalLikedSongs ? roundPercentage((sortedCount / totalLikedSongs) * 100) : null,
    unique_artist_count: artistCounts.size,
    unique_genre_count: uniqueGenres.size,
    top_artist: topArtist
      ? {
          artist_name: topArtist.artist_name,
          count: topArtist.count,
          display: `${topArtist.artist_name} shows up more than any other artist.`,
        }
      : null,
    top_genre: topGenre
      ? {
          genre: topGenre.genre,
          count: topGenre.count,
          display: `Your library leans hardest into ${topGenre.genre}.`,
        }
      : null,
    genre_evidence: {
      source: "approved_artist_genres",
      tracks_with_genre_evidence: tracksWithGenreEvidence,
      coverage_percentage: totalLikedSongs ? roundPercentage((tracksWithGenreEvidence / totalLikedSongs) * 100) : null,
    },
    playlist_counts: playlistCounts,
  };
}

function buildEra(records) {
  const eraCounts = new Map(ERA_ORDER.map((era) => [era, 0]));
  const represented = [];

  for (const record of records) {
    const era = eraForYear(record.releaseYear);
    if (!era) continue;
    increment(eraCounts, era);
  }

  for (const era of ERA_ORDER) {
    const count = eraCounts.get(era) || 0;
    if (count > 0) represented.push({ era, label: ERA_LABELS[era] || era, count });
  }

  const strongest = [...represented].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return ERA_ORDER.indexOf(left.era) - ERA_ORDER.indexOf(right.era);
  })[0] || null;

  return {
    strongest_era: strongest
      ? { ...strongest, display: `${strongest.label} is your strongest era.` }
      : null,
    earliest_era: represented[0] || null,
    latest_era: represented[represented.length - 1] || null,
    distribution: represented,
  };
}

function buildPlaylists(library, records, userId) {
  const playlistYears = new Map();

  for (const record of records) {
    if (!record.playlist_code || !record.releaseYear) continue;
    const years = playlistYears.get(record.playlist_code) || [];
    years.push(record.releaseYear);
    playlistYears.set(record.playlist_code, years);
  }

  const playlistRows = [...library.playlist_counts.entries()]
    .map(([playlistCode, count]) => {
      const years = playlistYears.get(playlistCode) || [];
      const sortedYears = years.sort((left, right) => left - right);
      return {
        playlist_code: playlistCode,
        display_name: playlistLabel(playlistCode),
        count,
        start_year: sortedYears[0] || null,
        end_year: sortedYears[sortedYears.length - 1] || null,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.display_name.localeCompare(right.display_name);
    });

  const specialtyPlaylists = getSpecialtySuggestionsForUser(userId).map((suggestion) => ({
    seed_code: suggestion.seed_code,
    playlist_code: suggestion.playlist_code,
    display_name: suggestion.display_name,
    overlap_count: suggestion.overlap_count,
    confidence: suggestion.confidence,
    status: suggestion.status,
    display: `${suggestion.display_name} is supported by ${formatCount(suggestion.overlap_count, "liked song")}.`,
  }));

  return {
    largest_generated_playlist: playlistRows[0] || null,
    top_generated_playlists: playlistRows.slice(0, 10),
    specialty_playlists_earned: specialtyPlaylists,
  };
}

function buildFunFacts({ timeline, library, era, playlists }) {
  const facts = [];

  if (timeline.span && timeline.span.years > 0) {
    facts.push({
      key: "collection_span",
      display: `Your collection spans ${timeline.span.years.toLocaleString()} years of music.`,
      source: "release_years",
    });
  }

  if (timeline.peak_year) {
    facts.push({
      key: "peak_year",
      display: timeline.peak_year.display,
      source: "release_years",
    });
  }

  if (library.top_artist) {
    facts.push({
      key: "top_artist",
      display: library.top_artist.display,
      source: "liked_song_artist_counts",
    });
  }

  if (library.top_genre) {
    facts.push({
      key: "top_genre",
      display: library.top_genre.display,
      source: library.genre_evidence.source,
    });
  }

  if (era.strongest_era) {
    facts.push({
      key: "strongest_era",
      display: era.strongest_era.display,
      source: "release_years",
    });
  }

  if (playlists.largest_generated_playlist) {
    facts.push({
      key: "largest_generated_playlist",
      display: `${playlists.largest_generated_playlist.display_name} is your largest generated playlist with ${formatCount(playlists.largest_generated_playlist.count, "song")}.`,
      source: "user_track_playlist_codes",
    });
  }

  return facts;
}

function getLibraryInsightsForUser(userId) {
  const parsedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    const error = new Error("A valid user id is required for library insights.");
    error.code = "invalid_user_id";
    error.statusCode = 400;
    throw error;
  }

  const db = openDatabase();
  const records = buildTrackRecords(getUserTrackRows(db, parsedUserId));
  const timeline = buildTimeline(records);
  const library = buildLibrary(records);
  const era = buildEra(records);
  const playlists = buildPlaylists(library, records, parsedUserId);
  const releaseYearCoverage = records.length
    ? roundPercentage((timeline.release_year_count / records.length) * 100)
    : null;

  return {
    status: "ok",
    user_id: parsedUserId,
    generated_at: new Date().toISOString(),
    data_quality: {
      total_tracks: records.length,
      tracks_with_release_year: timeline.release_year_count,
      release_year_coverage_percentage: releaseYearCoverage,
      tracks_with_genre_evidence: library.genre_evidence.tracks_with_genre_evidence,
      genre_evidence_source: library.genre_evidence.source,
      genre_evidence_coverage_percentage: library.genre_evidence.coverage_percentage,
    },
    timeline,
    library: {
      total_liked_songs: library.total_liked_songs,
      matched_sorted_count: library.matched_sorted_count,
      matched_sorted_percentage: library.matched_sorted_percentage,
      unique_artist_count: library.unique_artist_count,
      unique_genre_count: library.unique_genre_count,
      top_artist: library.top_artist,
      top_genre: library.top_genre,
    },
    era,
    playlists,
    fun_facts: buildFunFacts({ timeline, library, era, playlists }),
  };
}

module.exports = {
  getLibraryInsightsForUser,
};
