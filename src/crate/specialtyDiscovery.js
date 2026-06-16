const { openDatabase } = require("../db");
const { getSpecialtyDiscoveryCatalog } = require("./specialtyDiscoveryCatalog");
const { getSeedIntelligenceReport } = require("./seedIntelligence");
const { getAdminPlaylistDnaValidation } = require("./playlistDnaValidation");

const SCORE_WEIGHTS = Object.freeze({
  footprint: 20,
  genres: 20,
  artist_intelligence: 15,
  seed_overlap: 15,
  playlist_dna: 15,
  track_signals: 10,
  identity_cluster: 5,
});

const BAND_LABELS = Object.freeze({
  strongly_supported: "Strongly Supported",
  supported: "Supported",
  weak: "Weak",
  not_supported: "Not Supported",
});

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeArtist(value) {
  return normalizeText(value).replace(/^the\s+/, "");
}

function rounded(value) {
  return Math.round(Math.max(0, Number(value) || 0));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function percent(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

function hasAnyTerm(values, terms) {
  const normalizedTerms = (terms || []).map(normalizeText).filter(Boolean);
  if (!normalizedTerms.length) return false;
  return (values || []).map(normalizeText).filter(Boolean).some((value) => (
    normalizedTerms.some((term) => value === term || value.includes(term) || term.includes(value))
  ));
}

function matchingTerms(values, terms) {
  const normalizedTerms = (terms || []).map((term) => ({ raw: term, normalized: normalizeText(term) })).filter((term) => term.normalized);
  const matches = new Set();
  for (const value of values || []) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) continue;
    for (const term of normalizedTerms) {
      if (normalizedValue === term.normalized || normalizedValue.includes(term.normalized) || term.normalized.includes(normalizedValue)) {
        matches.add(term.raw);
      }
    }
  }
  return [...matches].sort((a, b) => a.localeCompare(b));
}

function getRawArtistGenres(raw) {
  const artists = Array.isArray(raw?.artists) ? raw.artists : [];
  return artists.flatMap((artist) => Array.isArray(artist.genres) ? artist.genres : []).filter(Boolean);
}

function readUserTracks(db, userId) {
  return db.prepare(`
    SELECT
      user_tracks.track_id,
      user_tracks.playlist_code,
      tracks.spotify_track_id,
      tracks.name AS track_name,
      tracks.artist_names,
      tracks.album_name,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    WHERE user_tracks.user_id = ?
  `).all(userId).map((row) => {
    const artistNames = parseJson(row.artist_names, []);
    const raw = parseJson(row.raw_json, {});
    return {
      track_id: row.track_id,
      playlist_code: row.playlist_code || null,
      spotify_track_id: row.spotify_track_id || null,
      track_name: row.track_name || "",
      artist_names: artistNames,
      primary_artist: artistNames[0] || "",
      normalized_primary_artist: normalizeArtist(artistNames[0] || ""),
      album_name: row.album_name || "",
      raw,
      spotify_artist_genres: getRawArtistGenres(raw),
    };
  });
}

function readApprovedGenres(db, tracks) {
  const artists = [...new Set(tracks.flatMap((track) => track.artist_names || []).map(normalizeArtist).filter(Boolean))];
  if (!artists.length) return new Map();
  const rows = db.prepare("SELECT artist_name, genre FROM artist_genres").all();
  const wanted = new Set(artists);
  const byArtist = new Map();
  for (const row of rows) {
    const key = normalizeArtist(row.artist_name);
    if (!wanted.has(key) || !row.genre) continue;
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(row.genre);
  }
  return byArtist;
}

function readArtistIntelligenceSignals(db, tracks) {
  const artists = [...new Set(tracks.flatMap((track) => track.artist_names || []).map(normalizeArtist).filter(Boolean))];
  if (!artists.length) return new Map();
  const wanted = new Set(artists);
  const rows = db.prepare(`
    SELECT artist_intelligence.normalized_artist_name, artist_intelligence_sources.normalized_signals_json
    FROM artist_intelligence
    INNER JOIN artist_intelligence_sources ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
    WHERE artist_intelligence_sources.error_code IS NULL
  `).all();
  const byArtist = new Map();
  for (const row of rows) {
    const key = normalizeArtist(row.normalized_artist_name);
    if (!wanted.has(key)) continue;
    const signals = parseJson(row.normalized_signals_json, []);
    if (!signals.length) continue;
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(...signals);
  }
  return byArtist;
}

function readTrackSignals(db, tracks) {
  if (!tracks.length) return new Map();
  const tracksBySpotifyId = new Map(tracks.filter((track) => track.spotify_track_id).map((track) => [track.spotify_track_id, track]));
  const tracksByArtistTitle = new Map(tracks.map((track) => [
    normalizeArtist(track.primary_artist) + "::" + normalizeText(track.track_name),
    track,
  ]));
  const rows = db.prepare(`
    SELECT
      track_intelligence.spotify_track_id,
      track_intelligence.normalized_artist_name,
      track_intelligence.normalized_track_name,
      track_intelligence_sources.normalized_signals_json
    FROM track_intelligence
    INNER JOIN track_intelligence_sources ON track_intelligence_sources.track_intelligence_id = track_intelligence.id
    WHERE track_intelligence_sources.error_code IS NULL
  `).all();
  const byTrack = new Map();
  for (const row of rows) {
    const track = (row.spotify_track_id && tracksBySpotifyId.get(row.spotify_track_id)) ||
      tracksByArtistTitle.get(normalizeArtist(row.normalized_artist_name) + "::" + normalizeText(row.normalized_track_name));
    if (!track) continue;
    const signals = parseJson(row.normalized_signals_json, []);
    if (!signals.length) continue;
    if (!byTrack.has(track.track_id)) byTrack.set(track.track_id, []);
    byTrack.get(track.track_id).push(...signals);
  }
  return byTrack;
}

function readTrackLearning(db, tracks) {
  if (!tracks.length) return new Map();
  const trackIds = new Set(tracks.map((track) => track.track_id));
  const rows = db.prepare(`
    SELECT track_id, current_playlist_code, top_candidate_playlist_code, confidence_score, specialty_matches_json, unmatched_occurrence_count
    FROM track_learning_profiles
  `).all();
  const byTrack = new Map();
  for (const row of rows) {
    if (!trackIds.has(row.track_id)) continue;
    byTrack.set(row.track_id, {
      current_playlist_code: row.current_playlist_code || null,
      top_candidate_playlist_code: row.top_candidate_playlist_code || null,
      confidence_score: Number(row.confidence_score || 0),
      specialty_matches: parseJson(row.specialty_matches_json, []),
      unmatched_occurrence_count: Number(row.unmatched_occurrence_count || 0),
    });
  }
  return byTrack;
}

function readSeedOpportunities(userId) {
  try {
    const report = getSeedIntelligenceReport(userId);
    return new Map((report.opportunities || []).map((row) => [row.seed_code, row]));
  } catch (err) {
    return new Map();
  }
}

function readDnaProfiles() {
  try {
    return getAdminPlaylistDnaValidation({ limit: 25 }).playlist_dna_profiles || [];
  } catch (err) {
    return [];
  }
}

function flattenDnaSignals(profile) {
  return [
    ...(profile.top_signals || []),
    ...(profile.approved_artist_genres || []),
    ...(profile.spotify_artist_genres || []),
    ...(profile.lastfm_artist_tags || []),
    ...(profile.lastfm_track_tags || []),
    ...(profile.musicbrainz_tags || []),
    ...(profile.specialty_signals || []),
  ].map((row) => row.signal || row.value || row.name).filter(Boolean);
}

function dnaScoreForSpecialty(specialty, dnaProfiles) {
  const terms = [...specialty.positive_genres, ...specialty.positive_terms, ...specialty.seed_codes.map((seed) => `specialty_${seed}`)];
  let best = { score: 0, playlist_code: null, playlist_label: null, matched_terms: [] };
  for (const profile of dnaProfiles || []) {
    const profileSignals = flattenDnaSignals(profile);
    const matched = matchingTerms(profileSignals, terms);
    const directPlaylistSupport = specialty.playlist_codes.includes(profile.playlist_code) ? 10 : 0;
    const directSpecialtySupport = hasAnyTerm(profile.specialty_signals?.map((row) => row.signal) || [], specialty.seed_codes.map((seed) => `specialty_${seed}`)) ? 6 : 0;
    const score = clamp((matched.length * 4) + directPlaylistSupport + directSpecialtySupport, 0, 15);
    if (score > best.score) {
      best = {
        score,
        playlist_code: profile.playlist_code,
        playlist_label: profile.playlist_label,
        matched_terms: matched.slice(0, 8),
      };
    }
  }
  return best;
}

function scoreFootprint({ trackCount, artistCount, specialty }) {
  const trackPart = clamp(trackCount / Math.max(1, specialty.min_tracks), 0, 1) * 10;
  const artistPart = clamp(artistCount / Math.max(1, specialty.min_artists), 0, 1) * 10;
  return rounded(trackPart + artistPart);
}

function topCounts(values, limit = 8) {
  const counts = new Map();
  for (const value of values || []) {
    const key = String(value || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function bandForScore(score, suppressed) {
  if (suppressed || score < 55) return "not_supported";
  if (score >= 85) return "strongly_supported";
  if (score >= 70) return "supported";
  return "weak";
}

function analyzeSpecialty({ specialty, tracks, approvedGenres, artistSignals, trackSignals, trackLearning, seedOpportunities, dnaProfiles }) {
  const supportingTrackIds = new Set();
  const supportingArtists = new Set();
  const conflictTrackIds = new Set();
  const approvedMatches = [];
  const spotifyMatches = [];
  const artistIntelMatches = [];
  const trackIntelMatches = [];
  const learningMatches = [];
  const unmatchedClusterTrackIds = new Set();
  const artistTrackCounts = new Map();
  const terms = [...specialty.positive_genres, ...specialty.positive_terms];

  for (const track of tracks) {
    const artistKey = track.normalized_primary_artist;
    const approved = approvedGenres.get(artistKey) || [];
    const spotify = track.spotify_artist_genres || [];
    const artistIntel = artistSignals.get(artistKey) || [];
    const trackIntel = trackSignals.get(track.track_id) || [];
    const learning = trackLearning.get(track.track_id) || null;
    const learningSpecialtyValues = (learning?.specialty_matches || []).flatMap((match) => [
      match.seed_code,
      match.playlist_code,
      match.match_type,
      match.match_source,
    ]).filter(Boolean);
    const matchedApproved = matchingTerms(approved, terms);
    const matchedSpotify = matchingTerms(spotify, terms);
    const matchedArtistIntel = matchingTerms(artistIntel, terms);
    const matchedTrackIntel = matchingTerms(trackIntel, terms);
    const matchedLearning = matchingTerms(learningSpecialtyValues, [...terms, ...specialty.seed_codes, specialty.code]);
    const hasSupport = matchedApproved.length || matchedSpotify.length || matchedArtistIntel.length || matchedTrackIntel.length || matchedLearning.length;

    if (hasSupport) {
      supportingTrackIds.add(track.track_id);
      if (artistKey) supportingArtists.add(artistKey);
      artistTrackCounts.set(artistKey || "unknown", (artistTrackCounts.get(artistKey || "unknown") || 0) + 1);
      approvedMatches.push(...matchedApproved);
      spotifyMatches.push(...matchedSpotify);
      artistIntelMatches.push(...matchedArtistIntel);
      trackIntelMatches.push(...matchedTrackIntel);
      learningMatches.push(...matchedLearning);
      if (learning?.unmatched_occurrence_count > 0 || !track.playlist_code) unmatchedClusterTrackIds.add(track.track_id);
    }

    const conflictValues = [...approved, ...spotify, ...artistIntel, ...trackIntel];
    if (hasAnyTerm(conflictValues, specialty.conflict_terms)) {
      conflictTrackIds.add(track.track_id);
    }
  }

  const trackCount = supportingTrackIds.size;
  const artistCount = supportingArtists.size;
  const conflictCount = [...conflictTrackIds].filter((trackId) => supportingTrackIds.has(trackId)).length;
  const singleArtistMax = Math.max(0, ...artistTrackCounts.values());
  const singleArtistDominance = percent(singleArtistMax, trackCount);
  const seedRows = specialty.seed_codes.map((seedCode) => seedOpportunities.get(seedCode)).filter(Boolean);
  const seedOverlap = seedRows.reduce((sum, row) => sum + Number(row.overlap_count || 0), 0);
  const seedConfidence = seedRows.length ? Math.round(seedRows.reduce((sum, row) => sum + Number(row.confidence_score || 0), 0) / seedRows.length) : 0;
  const seedScore = seedRows.length ? clamp((clamp(seedOverlap / Math.max(10, specialty.min_tracks), 0, 1) * 9) + (seedConfidence / 100 * 6), 0, SCORE_WEIGHTS.seed_overlap) : 0;
  const dna = dnaScoreForSpecialty(specialty, dnaProfiles);

  const footprintScore = scoreFootprint({ trackCount, artistCount, specialty });
  const approvedGenreScore = clamp((new Set(approvedMatches.map(normalizeText)).size / 3) * 12, 0, 12);
  const spotifyGenreScore = clamp((new Set(spotifyMatches.map(normalizeText)).size / 4) * 8, 0, 8);
  const genreScore = rounded(approvedGenreScore + spotifyGenreScore);
  const artistIntelScore = rounded(clamp((new Set(artistIntelMatches.map(normalizeText)).size / 4) * SCORE_WEIGHTS.artist_intelligence, 0, SCORE_WEIGHTS.artist_intelligence));
  const trackIntelScore = clamp((new Set(trackIntelMatches.map(normalizeText)).size / 4) * 5, 0, 5);
  const learningScore = clamp((new Set(learningMatches.map(normalizeText)).size / 3) * 5, 0, 5);
  const trackSignalScore = rounded(trackIntelScore + learningScore);
  const identityClusterScore = rounded(clamp(unmatchedClusterTrackIds.size / Math.max(5, specialty.min_tracks / 2), 0, 1) * SCORE_WEIGHTS.identity_cluster);
  const userEvidencePresent = trackCount > 0 || seedOverlap > 0 || approvedMatches.length > 0 || artistIntelMatches.length > 0 || trackIntelMatches.length > 0 || learningMatches.length > 0;
  const dnaScore = userEvidencePresent ? dna.score : 0;
  const rawScore = rounded(footprintScore + genreScore + artistIntelScore + seedScore + dnaScore + trackSignalScore + identityClusterScore);

  const suppressionReasons = [];
  if (trackCount < specialty.min_tracks) suppressionReasons.push(`only ${trackCount} supporting track(s); minimum is ${specialty.min_tracks}`);
  if (artistCount < specialty.min_artists) suppressionReasons.push(`only ${artistCount} supporting artist(s); minimum is ${specialty.min_artists}`);
  if (trackCount > 0 && singleArtistDominance > 60) suppressionReasons.push(`single artist dominance is ${singleArtistDominance}%`);
  if (trackCount > 0 && percent(conflictCount, trackCount) > 30) suppressionReasons.push(`conflict evidence appears on ${percent(conflictCount, trackCount)}% of supporting tracks`);
  if (rawScore > 0 && !approvedMatches.length && !artistIntelMatches.length && !trackIntelMatches.length && seedOverlap < 3) {
    suppressionReasons.push("no approved, intelligence, track, or meaningful seed evidence");
  }

  const conflictPenalty = Math.min(35, Math.round((percent(conflictCount, Math.max(1, trackCount)) * 0.25) + (singleArtistDominance > 60 ? 10 : 0)));
  const finalScore = clamp(rawScore - conflictPenalty, 0, 100);
  const suppressed = suppressionReasons.length > 0;
  const band = bandForScore(finalScore, suppressed);

  return {
    code: specialty.code,
    label: specialty.label,
    catalog_status: specialty.status,
    score: finalScore,
    raw_score: rawScore,
    band,
    band_label: BAND_LABELS[band],
    suppressed,
    show_recommendation: band === "strongly_supported",
    optional_suggestion: band === "supported",
    suppression_reasons: suppressionReasons,
    evidence: {
      track_count: trackCount,
      artist_count: artistCount,
      conflict_track_count: conflictCount,
      conflict_percent: percent(conflictCount, trackCount),
      single_artist_dominance_percent: singleArtistDominance,
      seed_overlap_count: seedOverlap,
      seed_confidence: seedConfidence,
      dna_playlist_code: dna.playlist_code,
      dna_playlist_label: dna.playlist_label,
      dna_matched_terms: dna.matched_terms,
      identity_cluster_track_count: unmatchedClusterTrackIds.size,
      top_approved_genres: topCounts(approvedMatches),
      top_spotify_genres: topCounts(spotifyMatches),
      top_artist_intelligence: topCounts(artistIntelMatches),
      top_track_signals: topCounts(trackIntelMatches),
      top_learning_signals: topCounts(learningMatches),
    },
    score_breakdown: {
      footprint: footprintScore,
      genres: genreScore,
      artist_intelligence: artistIntelScore,
      seed_overlap: rounded(seedScore),
      playlist_dna: rounded(dnaScore),
      track_signals: trackSignalScore,
      identity_cluster: identityClusterScore,
      conflict_penalty: conflictPenalty,
    },
  };
}

function summarizeUser({ db, userId, tracks }) {
  const user = db.prepare("SELECT id, display_name, email, spotify_user_id FROM users WHERE id = ?").get(userId) || {};
  const sorted = tracks.filter((track) => track.playlist_code).length;
  const artists = new Set(tracks.flatMap((track) => track.artist_names || []).map(normalizeArtist).filter(Boolean));
  const playlistCounts = topCounts(tracks.map((track) => track.playlist_code).filter(Boolean), 10);
  return {
    user_id: userId,
    display_name: user.display_name || null,
    email: user.email || null,
    spotify_user_id: user.spotify_user_id || null,
    total_tracks: tracks.length,
    matched_tracks: sorted,
    unmatched_tracks: Math.max(0, tracks.length - sorted),
    artist_count: artists.size,
    top_playlist_codes: playlistCounts,
  };
}

function getSpecialtyDiscoveryForUser(userId, options = {}) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    const error = new Error("user_id must be a positive integer.");
    error.code = "invalid_user_id";
    error.statusCode = 400;
    throw error;
  }

  const db = openDatabase();
  const tracks = readUserTracks(db, normalizedUserId);
  const catalog = getSpecialtyDiscoveryCatalog();
  const context = {
    tracks,
    approvedGenres: readApprovedGenres(db, tracks),
    artistSignals: readArtistIntelligenceSignals(db, tracks),
    trackSignals: readTrackSignals(db, tracks),
    trackLearning: readTrackLearning(db, tracks),
    seedOpportunities: readSeedOpportunities(normalizedUserId),
    dnaProfiles: options.dnaProfiles || readDnaProfiles(),
  };
  const specialties = catalog
    .map((specialty) => analyzeSpecialty({ specialty, ...context }))
    .sort((a, b) => b.score - a.score || b.evidence.track_count - a.evidence.track_count || a.label.localeCompare(b.label));
  const bands = Object.fromEntries(Object.keys(BAND_LABELS).map((band) => [
    band,
    specialties.filter((row) => row.band === band),
  ]));

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    user_summary: summarizeUser({ db, userId: normalizedUserId, tracks }),
    thresholds: {
      show_automatically: "85-100 and not suppressed",
      suggest_optionally: "70-84 and not suppressed",
      admin_only_weak: "55-69",
      suppress_entirely: "0-54 or any hard suppression reason",
    },
    score_weights: SCORE_WEIGHTS,
    bands,
    specialties,
    notes: [
      "Read-only Specialty Playlist Discovery report.",
      "No sorting changes, approvals, rescans, playlist sends, Spotify writes, or user-facing UI changes are performed.",
    ],
  };
}

function percentile(sortedScores, score) {
  if (!sortedScores.length) return null;
  const belowOrEqual = sortedScores.filter((value) => value <= score).length;
  return Math.round((belowOrEqual / sortedScores.length) * 100);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function p75(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
}

function listUsersForCohort(db, limit) {
  return db.prepare(`
    SELECT users.id, users.display_name, users.email, users.spotify_user_id, COUNT(user_tracks.track_id) AS track_count
    FROM users
    INNER JOIN user_tracks ON user_tracks.user_id = users.id
    GROUP BY users.id
    HAVING track_count > 0
    ORDER BY users.id ASC
    LIMIT ?
  `).all(limit);
}

function buildPriorityRecommendation(row) {
  if (row.strongly_supported_users >= 3 || row.supported_or_better_users >= 6) return "build_next";
  if (row.supported_or_better_users >= 2 || row.p75_score >= 70) return "watch_cohort";
  if (row.p75_score >= 55) return "research_only";
  return "do_not_build_yet";
}

function getSpecialtyDiscoveryCohort(options = {}) {
  const db = openDatabase();
  const limit = clamp(Number.parseInt(options.limit, 10) || 100, 1, 500);
  const users = listUsersForCohort(db, limit);
  const dnaProfiles = readDnaProfiles();
  const userReports = users.map((user) => getSpecialtyDiscoveryForUser(user.id, { dnaProfiles }));
  const catalog = getSpecialtyDiscoveryCatalog();
  const bySpecialty = catalog.map((specialty) => {
    const rows = userReports.map((report) => report.specialties.find((row) => row.code === specialty.code)).filter(Boolean);
    const scores = rows.map((row) => row.score);
    const benchmark = rows.find((row, index) => userReports[index].user_summary.user_id === 29);
    const stronglySupported = rows.filter((row) => row.band === "strongly_supported").length;
    const supported = rows.filter((row) => row.band === "supported").length;
    const weak = rows.filter((row) => row.band === "weak").length;
    const notSupported = rows.filter((row) => row.band === "not_supported").length;
    const totalTracks = rows.reduce((sum, row) => sum + row.evidence.track_count, 0);
    const totalArtists = rows.reduce((sum, row) => sum + row.evidence.artist_count, 0);
    const row = {
      code: specialty.code,
      label: specialty.label,
      catalog_status: specialty.status,
      build_priority_hint: specialty.build_priority_hint,
      users_analyzed: rows.length,
      strongly_supported_users: stronglySupported,
      supported_users: supported,
      supported_or_better_users: stronglySupported + supported,
      weak_users: weak,
      not_supported_users: notSupported,
      median_score: median(scores),
      p75_score: p75(scores),
      total_supporting_tracks: totalTracks,
      total_supporting_artists: totalArtists,
      user_29_score: benchmark?.score ?? null,
      user_29_band: benchmark?.band || null,
      user_29_percentile: benchmark ? percentile(scores, benchmark.score) : null,
    };
    return {
      ...row,
      build_recommendation: buildPriorityRecommendation(row),
    };
  }).sort((a, b) => {
    if (b.supported_or_better_users !== a.supported_or_better_users) return b.supported_or_better_users - a.supported_or_better_users;
    if (b.p75_score !== a.p75_score) return b.p75_score - a.p75_score;
    return b.total_supporting_tracks - a.total_supporting_tracks;
  });

  const candidateBuildPriority = bySpecialty
    .filter((row) => row.catalog_status === "candidate")
    .sort((a, b) => {
      const rank = { build_next: 0, watch_cohort: 1, research_only: 2, do_not_build_yet: 3 };
      if (rank[a.build_recommendation] !== rank[b.build_recommendation]) return rank[a.build_recommendation] - rank[b.build_recommendation];
      if (b.supported_or_better_users !== a.supported_or_better_users) return b.supported_or_better_users - a.supported_or_better_users;
      return b.p75_score - a.p75_score;
    });

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    summary: {
      users_analyzed: users.length,
      specialty_count: catalog.length,
      benchmark_user_id: 29,
    },
    cohort_comparison: bySpecialty,
    candidate_build_priority: candidateBuildPriority,
    notes: [
      "Read-only cohort Specialty Playlist Discovery report.",
      "No sorting changes, approvals, rescans, playlist sends, Spotify writes, schema changes, or user-facing UI changes are performed.",
    ],
  };
}

module.exports = {
  getSpecialtyDiscoveryCohort,
  getSpecialtyDiscoveryForUser,
};
