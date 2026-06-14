const { openDatabase } = require("../db");
const { sourceComparisonSignals } = require("./artistIntelligenceComparison");
const { buildDiagnosticsForUser } = require("./unmatchedDiagnostics");
const { releaseYearFromDate } = require("./eraYears");
const { parseRawTrack } = require("./trackContext");
const { normalizeArtistName } = require("../repositories/artistGenres");
const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const { fetchAndCacheSpotifyArtistIntelligence } = require("./spotifyArtistIntelligence");
const { fetchAndCacheLastfmArtistIntelligence } = require("./lastfmGenreSuggestions");
const { fetchAndCacheMusicBrainzArtistIntelligence } = require("./musicbrainzArtistIntelligence");
const { buildRecommendations } = require("./genreRecommendations");

const IDENTITY_RULES = [
  {
    label: "Sad Girl Pop",
    destination: "Pop",
    signals: ["sad girl", "sad pop", "melancholia", "melancholy", "art pop", "chamber pop", "baroque pop", "dream pop", "indie pop", "folk pop", "piano pop", "singer-songwriter"],
    artists: ["taylor swift", "lana del rey", "phoebe bridgers", "gracie abrams", "mitski", "olivia rodrigo", "boygenius"],
  },
  {
    label: "Alt R&B",
    destination: "R&B",
    signals: ["alternative r&b", "alternative rb", "alternative rnb", "alt r&b", "alt rb", "alt rnb", "contemporary r&b", "modern r&b", "trap soul", "neo soul", "r&b", "rnb"],
    artists: ["sza", "frank ocean", "daniel caesar", "the weeknd", "summer walker", "jhene aiko", "victoria monet"],
  },
  {
    label: "Indie Pop",
    destination: "Pop",
    signals: ["indie pop", "bedroom pop", "alt pop", "alternative pop", "modern indie pop", "pov: indie", "art pop", "lo-fi pop", "lo fi pop"],
    artists: ["the 1975", "clairo", "girl in red", "beabadoobee", "mxmtoon", "rex orange county"],
  },
  {
    label: "Acoustic Chill",
    destination: "Singer-Songwriter",
    signals: ["acoustic", "acoustic pop", "coffeehouse", "chill", "mellow", "piano pop", "folk pop", "indie folk", "soft pop"],
    artists: [],
  },
  {
    label: "Modern Singer-Songwriter",
    destination: "Singer-Songwriter",
    signals: ["singer-songwriter", "singer songwriter", "acoustic singer-songwriter", "piano singer-songwriter", "folk pop", "indie folk", "confessional", "lilith"],
    artists: ["taylor swift", "lana del rey", "noah kahan", "gracie abrams", "phoebe bridgers"],
  },
  {
    label: "College Radio",
    destination: "Alternative Rock",
    signals: ["college rock", "college radio", "modern rock", "alternative rock", "indie rock", "indie", "jangle pop", "post-punk", "new wave", "synthpop"],
    artists: ["the 1975", "phoebe bridgers", "boygenius", "vampire weekend", "arctic monkeys"],
  },
  {
    label: "Dream Pop",
    destination: "Alternative Rock",
    signals: ["dream pop", "shoegaze", "ethereal", "indie pop", "bedroom pop", "art pop", "chamber pop", "ambient pop"],
    artists: ["lana del rey", "mazzy star", "beach house", "cigarettes after sex"],
  },
];

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^genre:/, "")
    .replace(/^tag:/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function normalizeLimit(value, fallback = 250, maximum = 1000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function normalizeUserId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function countBy(values, keyName) {
  const counts = new Map();
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ [keyName]: value, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function readUser(userId) {
  return openDatabase().prepare(`
    SELECT id AS user_id, spotify_user_id, display_name, email, created_at, updated_at
    FROM users
    WHERE id = ?
  `).get(userId);
}

function readUserStats(userId) {
  const row = openDatabase().prepare(`
    SELECT
      COUNT(*) AS total_tracks,
      SUM(CASE WHEN playlist_code IS NOT NULL THEN 1 ELSE 0 END) AS matched_tracks,
      SUM(CASE WHEN playlist_code IS NULL THEN 1 ELSE 0 END) AS unmatched_tracks
    FROM user_tracks
    WHERE user_id = ?
  `).get(userId);
  const total = Number(row?.total_tracks || 0);
  const matched = Number(row?.matched_tracks || 0);
  const unmatched = Number(row?.unmatched_tracks || 0);

  return {
    total_tracks: total,
    matched_tracks: matched,
    unmatched_tracks: unmatched,
    match_percent: total ? Math.round((matched / total) * 1000) / 10 : 0,
  };
}

function readTrackMetadata(trackIds) {
  if (!trackIds.length) return new Map();
  const placeholders = trackIds.map(() => "?").join(", ");
  const rows = openDatabase().prepare(`
    SELECT id, raw_json
    FROM tracks
    WHERE id IN (${placeholders})
  `).all(...trackIds);
  const byTrackId = new Map();

  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    const releaseDate = rawTrack?.album?.release_date || null;
    byTrackId.set(row.id, {
      release_date: releaseDate,
      release_year: releaseYearFromDate(releaseDate),
    });
  }

  return byTrackId;
}

function readArtistIntelligence() {
  const db = openDatabase();
  const byName = new Map();
  const bySpotifyId = new Map();
  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { byName, bySpotifyId };
  }

  const rows = db.prepare(`
    SELECT
      artist_intelligence.id,
      artist_intelligence.normalized_artist_name,
      artist_intelligence.display_artist_name,
      artist_intelligence.spotify_artist_id,
      artist_intelligence.confidence_score,
      artist_intelligence.source_count,
      artist_intelligence_sources.source,
      artist_intelligence_sources.normalized_signals_json,
      artist_intelligence_sources.error_code
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
    ORDER BY artist_intelligence.normalized_artist_name COLLATE NOCASE ASC,
      artist_intelligence_sources.source COLLATE NOCASE ASC
  `).all();

  for (const row of rows) {
    const key = normalizeArtistName(row.normalized_artist_name || row.display_artist_name);
    if (!key) continue;
    const entry = byName.get(key) || {
      artist_intelligence_id: row.id,
      normalized_artist_name: key,
      display_artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: Number(row.confidence_score || 0),
      source_count: Number(row.source_count || 0),
      sources: [],
      source_names: [],
      signals: [],
    };

    if (row.source) {
      const source = {
        source: row.source,
        normalized_signals_json: row.normalized_signals_json,
        error_code: row.error_code,
      };
      entry.sources.push(source);
      if (!row.error_code) {
        entry.source_names.push(row.source);
        entry.signals.push(...sourceComparisonSignals(source));
      }
    }

    entry.source_names = unique(entry.source_names);
    entry.signals = unique(entry.signals.map(normalize));
    byName.set(key, entry);
    if (entry.spotify_artist_id) bySpotifyId.set(entry.spotify_artist_id, entry);
  }

  return { byName, bySpotifyId };
}

function intelligenceForRecord(record, intelligenceMaps) {
  const matches = [];
  for (const artistName of record.artist_names || []) {
    const byName = intelligenceMaps.byName.get(normalizeArtistName(artistName));
    if (byName) matches.push(byName);
  }
  for (const artistId of record.spotify_artist_ids || []) {
    const byId = intelligenceMaps.bySpotifyId.get(artistId);
    if (byId) matches.push(byId);
  }

  const deduped = new Map();
  for (const match of matches) {
    deduped.set(match.artist_intelligence_id || match.normalized_artist_name, match);
  }

  return [...deduped.values()];
}

function recordSignals(record, intelligence = []) {
  return unique([
    ...(record.spotify_artist_genres || []),
    ...(record.approved_artist_genres || []),
    ...(record.merged_genre_context || []),
    ...intelligence.flatMap((entry) => entry.signals || []),
  ].map(normalize));
}

function classifyIdentity(record, intelligence = []) {
  const signals = recordSignals(record, intelligence);
  const artists = (record.artist_names || []).map(normalize);
  const labels = [];

  for (const rule of IDENTITY_RULES) {
    const matchedSignals = signals.filter((signal) => rule.signals.some((needle) => signal === needle || signal.includes(needle)));
    const matchedArtists = artists.filter((artist) => rule.artists.includes(artist));
    if (matchedSignals.length || matchedArtists.length) {
      labels.push({
        label: rule.label,
        destination: rule.destination,
        evidence: unique([...matchedSignals, ...matchedArtists.map((artist) => `artist:${artist}`)]).slice(0, 8),
      });
    }
  }

  return labels.length ? labels : [{ label: "Other", destination: likelyDestinationFromCandidates(record), evidence: [] }];
}

function likelyDestinationFromCandidates(record, identityLabels = []) {
  const topCandidate = (record.matched_playlist_candidates || []).find((candidate) => Number(candidate.score || 0) > 0);
  if (topCandidate?.playlist_code) return topCandidate.playlist_code;
  const firstIdentityDestination = identityLabels.find((item) => item.destination && item.label !== "Other")?.destination;
  if (firstIdentityDestination) return firstIdentityDestination;
  if ((record.approved_artist_genres || []).length) return "Review existing approved genre mapping";
  if ((record.spotify_artist_genres || []).length) return "Review genre alias/rule coverage";
  return "Needs artist intelligence or manual review";
}

function evidenceSummary(record, intelligence = []) {
  return unique([
    ...(record.spotify_artist_genres || []).map((value) => `spotify:${value}`),
    ...(record.approved_artist_genres || []).map((value) => `approved:${value}`),
    ...intelligence.flatMap((entry) => (entry.signals || []).slice(0, 8).map((value) => `${entry.source_names.join("+") || "intelligence"}:${value}`)),
  ]).slice(0, 24);
}

function recoveryOpportunity(record, intelligence = []) {
  if ((record.approved_artist_genres || []).length && ["approved_genres_exist_no_rule_match", "artist_genres_found_but_no_rule_match"].includes(record.final_unmatched_reason)) {
    return "rule_or_alias_review";
  }
  if ((record.spotify_artist_genres || []).length && ["spotify_genres_exist_no_rule_match", "spotify_genres_found_but_no_rule_match"].includes(record.final_unmatched_reason)) {
    return "genre_alias_review";
  }
  if (intelligence.some((entry) => (entry.signals || []).length)) {
    return "artist_intelligence_approval";
  }
  if ((record.matched_playlist_candidates || []).length) {
    return "track_level_review";
  }
  return "missing_intelligence";
}

function summarizeArtists(records, intelligenceMaps, limit, recommendationsByArtist = new Map()) {
  const byArtist = new Map();

  for (const record of records) {
    const intelligence = intelligenceForRecord(record, intelligenceMaps);
    const allSignals = recordSignals(record, intelligence);
    for (const artistName of record.artist_names && record.artist_names.length ? record.artist_names : ["Unknown Artist"]) {
      const key = normalizeArtistName(artistName) || "unknown artist";
      const item = byArtist.get(key) || {
        artist: artistName,
        unmatched_track_count: 0,
        approved_artist_genres: new Set(),
        spotify_genres: new Set(),
        artist_intelligence_sources_present: new Set(),
        artist_intelligence_signals: new Set(),
        reasons: new Map(),
        opportunities: new Map(),
      };
      item.unmatched_track_count += 1;
      for (const genre of record.approved_artist_genres || []) item.approved_artist_genres.add(genre);
      for (const genre of record.spotify_artist_genres || []) item.spotify_genres.add(genre);
      for (const entry of intelligence) {
        for (const source of entry.source_names || []) item.artist_intelligence_sources_present.add(source);
        for (const signal of entry.signals || []) item.artist_intelligence_signals.add(signal);
      }
      item.reasons.set(record.final_unmatched_reason, (item.reasons.get(record.final_unmatched_reason) || 0) + 1);
      const opportunity = recoveryOpportunity(record, intelligence);
      const recommendation = recommendationsByArtist.get(key);
      if (recommendation) item.recommendation = recommendation;
      item.opportunities.set(opportunity, (item.opportunities.get(opportunity) || 0) + 1);
      for (const signal of allSignals.slice(0, 20)) item.artist_intelligence_signals.add(signal);
      byArtist.set(key, item);
    }
  }

  return [...byArtist.values()]
    .map((item) => ({
      artist: item.artist,
      unmatched_track_count: item.unmatched_track_count,
      approved_artist_genres: [...item.approved_artist_genres].sort(),
      spotify_genres: [...item.spotify_genres].sort(),
      artist_intelligence_sources_present: [...item.artist_intelligence_sources_present].sort(),
      artist_intelligence_signals: [...item.artist_intelligence_signals].sort().slice(0, 20),
      reason_unmatched: [...item.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
      estimated_recovery_opportunity: [...item.opportunities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown",
      recommended_playlist_code: item.recommendation?.recommended_playlist_code || null,
      recommended_playlist: item.recommendation?.recommended_crate_playlist || null,
      recommended_genre_fallback: item.recommendation?.approved_genre || null,
      recommendation_confidence: item.recommendation?.confidence || null,
      recommendation_confidence_tier: item.recommendation?.confidence_tier || null,
      recommendation_evidence: item.recommendation?.supporting_evidence || [],
    }))
    .sort((left, right) => right.unmatched_track_count - left.unmatched_track_count || left.artist.localeCompare(right.artist))
    .slice(0, limit);
}

function summarizeGenreEvidence(trackRows) {
  return countBy(trackRows.flatMap((row) => row.current_evidence || []), "genre_or_tag");
}

async function getAdminUserUnmatchedExport(options = {}) {
  const userId = normalizeUserId(options.userId);
  if (!userId) {
    const error = new Error("user_id is required.");
    error.code = "missing_user_id";
    error.statusCode = 400;
    throw error;
  }

  const user = readUser(userId);
  if (!user) {
    const error = new Error("User was not found.");
    error.code = "user_not_found";
    error.statusCode = 404;
    throw error;
  }

  const limit = normalizeLimit(options.limit);
  const diagnostics = await buildDiagnosticsForUser(userId);
  const metadataByTrackId = readTrackMetadata(diagnostics.map((record) => record.track_id));
  const intelligenceMaps = readArtistIntelligence();
  const recommendationsByArtist = new Map(buildRecommendations({ includeApproved: true }).map((row) => [row.normalized_artist_name, row]));

  const topUnmatchedTracks = diagnostics.map((record) => {
    const intelligence = intelligenceForRecord(record, intelligenceMaps);
    const identityLabels = classifyIdentity(record, intelligence);
    const primaryArtistKey = normalizeArtistName((record.artist_names || [])[0] || "");
    const recommendation = recommendationsByArtist.get(primaryArtistKey);
    return {
      track_id: record.track_id,
      spotify_track_id: record.spotify_track_id,
      track: record.track_name,
      artist: (record.artist_names || []).join(", "),
      artists: record.artist_names || [],
      album: record.album_name,
      release_year: metadataByTrackId.get(record.track_id)?.release_year || null,
      spotify_genres: record.spotify_artist_genres || [],
      approved_genres: record.approved_artist_genres || [],
      current_evidence: evidenceSummary(record, intelligence),
      artist_intelligence_sources_present: unique(intelligence.flatMap((entry) => entry.source_names || [])).sort(),
      artist_intelligence_evidence: unique(intelligence.flatMap((entry) => entry.signals || [])).sort().slice(0, 30),
      matched_playlist_candidates: record.matched_playlist_candidates || [],
      unmatched_reason: record.final_unmatched_reason,
      cached_artist_intelligence_sources: record.cached_artist_intelligence_sources || [],
      cached_artist_intelligence_signals: record.cached_artist_intelligence_signals || [],
      recommended_playlist_code: recommendation?.recommended_playlist_code || null,
      recommended_playlist: recommendation?.recommended_crate_playlist || null,
      recommended_genre_fallback: recommendation?.approved_genre || null,
      recommendation_confidence: recommendation?.confidence || null,
      recommendation_confidence_tier: recommendation?.confidence_tier || null,
      candidate_identity_labels: identityLabels,
      likely_crate_destination: likelyDestinationFromCandidates(record, identityLabels),
      estimated_recovery_opportunity: recoveryOpportunity(record, intelligence),
    };
  });

  const identityClusterCounts = countBy(topUnmatchedTracks.flatMap((track) => track.candidate_identity_labels.map((item) => item.label)), "identity_cluster");
  const opportunityCounts = countBy(topUnmatchedTracks.map((track) => track.estimated_recovery_opportunity), "opportunity");
  const unmatchedReasonCounts = countBy(topUnmatchedTracks.map((track) => track.unmatched_reason), "reason");
  const cachedEvidenceNoApproval = summarizeArtists(
    diagnostics.filter((record) => record.final_unmatched_reason === "artist_intelligence_exists_not_approved"),
    intelligenceMaps,
    limit,
    recommendationsByArtist,
  );

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    user,
    user_stats: readUserStats(userId),
    total_unmatched_tracks: diagnostics.length,
    unmatched_reason_counts: unmatchedReasonCounts,
    top_unmatched_artists: summarizeArtists(diagnostics, intelligenceMaps, limit, recommendationsByArtist),
    cached_evidence_without_approval_artists: cachedEvidenceNoApproval,
    top_unmatched_tracks: topUnmatchedTracks.slice(0, limit),
    top_unmatched_genre_tag_evidence: summarizeGenreEvidence(topUnmatchedTracks).slice(0, limit),
    identity_cluster_counts: identityClusterCounts,
    recovery_opportunity_counts: opportunityCounts,
    notes: [
      "Read-only admin report. No sorting, approvals, playlist creation, or Spotify writes are performed.",
      "Identity labels are informational clustering attempts, not playlist assignments.",
    ],
  };
}

const REFRESH_SOURCES = ["spotify", "lastfm", "musicbrainz"];
const REFRESH_MAX_LIMIT = 50;
const REFRESH_TTL_GRACE_MS = 0;

function normalizeRefreshSources(value) {
  const input = Array.isArray(value) ? value : REFRESH_SOURCES;
  return [...new Set(input.map((source) => String(source || "").trim().toLowerCase()))]
    .filter((source) => REFRESH_SOURCES.includes(source));
}

function comparableSignalsForSource(sourceRow) {
  return sourceComparisonSignals({
    normalized_signals_json: sourceRow?.normalized_signals_json,
    normalized_signals: sourceRow?.normalized_signals,
  });
}

function isPayloadEmpty(sourceRow) {
  const payload = parseJson(sourceRow?.raw_payload_json, null);
  if (!payload || typeof payload !== "object") return true;
  return Object.keys(payload).length === 0;
}

function getSourceRefreshStatus(sourceRow, nowMs, options = {}) {
  const refreshEmpty = options.refreshEmpty !== false;

  if (!sourceRow) {
    return {
      status: "missing_source",
      eligible: true,
      signal_count: 0,
      fetched_at: null,
      expires_at: null,
      error_code: null,
    };
  }

  const signals = comparableSignalsForSource(sourceRow);
  const signalCount = signals.length;
  const payloadEmpty = isPayloadEmpty(sourceRow);
  const expiresAt = sourceRow.expires_at ? new Date(sourceRow.expires_at).getTime() : null;
  const hasExpiry = Number.isFinite(expiresAt);
  const expired = hasExpiry ? expiresAt <= nowMs + REFRESH_TTL_GRACE_MS : false;
  const hasUsableEvidence = signalCount > 0 && !payloadEmpty;

  if (sourceRow.error_code) {
    const retryable = !hasExpiry || expired;
    return {
      status: retryable ? "fetch_error" : "cooldown_blocked",
      eligible: retryable,
      signal_count: signalCount,
      fetched_at: sourceRow.fetched_at || null,
      expires_at: sourceRow.expires_at || null,
      error_code: sourceRow.error_code,
      error_message: sourceRow.error_message || null,
    };
  }

  if (expired) {
    return {
      status: hasUsableEvidence ? "stale_with_signals" : "stale_empty",
      eligible: true,
      signal_count: signalCount,
      fetched_at: sourceRow.fetched_at || null,
      expires_at: sourceRow.expires_at || null,
      error_code: null,
    };
  }

  if (!hasUsableEvidence) {
    return {
      status: "fresh_empty",
      eligible: refreshEmpty,
      signal_count: signalCount,
      fetched_at: sourceRow.fetched_at || null,
      expires_at: sourceRow.expires_at || null,
      error_code: null,
    };
  }

  return {
    status: "fresh_with_signals",
    eligible: false,
    signal_count: signalCount,
    fetched_at: sourceRow.fetched_at || null,
    expires_at: sourceRow.expires_at || null,
    error_code: null,
  };
}

async function refreshSourceForArtist(adminUserId, source, artist) {
  if (source === "spotify") {
    return fetchAndCacheSpotifyArtistIntelligence(adminUserId, { artistIntelligenceId: artist.id });
  }
  if (source === "lastfm") {
    return fetchAndCacheLastfmArtistIntelligence({ artistIntelligenceId: artist.id });
  }
  return fetchAndCacheMusicBrainzArtistIntelligence({ artistIntelligenceId: artist.id });
}

async function refreshUserUnmatchedArtistIntelligence(options = {}) {
  const userId = normalizeUserId(options.userId);
  if (!userId) {
    const error = new Error("user_id is required.");
    error.code = "missing_user_id";
    error.statusCode = 400;
    throw error;
  }

  const adminUserId = normalizeUserId(options.adminUserId) || userId;
  const limit = normalizeLimit(options.limit, 25, REFRESH_MAX_LIMIT);
  const refreshEmpty = options.refreshEmpty !== false;
  const sources = normalizeRefreshSources(options.sources);
  if (!sources.length) {
    const error = new Error("At least one source is required.");
    error.code = "missing_sources";
    error.statusCode = 400;
    throw error;
  }

  const diagnostics = await buildDiagnosticsForUser(userId);
  const byArtist = new Map();
  for (const record of diagnostics) {
    if ((record.approved_artist_genres || []).length || (record.spotify_artist_genres || []).length) continue;
    (record.artist_names && record.artist_names.length ? record.artist_names : ["Unknown Artist"]).forEach((artistName, index) => {
      const normalized = normalizeArtistName(artistName);
      if (!normalized) return;
      const item = byArtist.get(normalized) || {
        artistName,
        normalizedArtistName: normalized,
        spotifyArtistId: (record.spotify_artist_ids || [])[index] || null,
        unmatched_track_count: 0,
        affected_user_count: 1,
        sample_tracks: [],
      };
      item.unmatched_track_count += 1;
      if (!item.spotifyArtistId && (record.spotify_artist_ids || [])[index]) item.spotifyArtistId = (record.spotify_artist_ids || [])[index];
      if (item.sample_tracks.length < 5) {
        item.sample_tracks.push({
          track_id: record.track_id,
          track_name: record.track_name,
          spotify_track_id: record.spotify_track_id,
        });
      }
      byArtist.set(normalized, item);
    });
  }

  const selectedArtists = [...byArtist.values()]
    .sort((left, right) => {
      if (right.unmatched_track_count !== left.unmatched_track_count) return right.unmatched_track_count - left.unmatched_track_count;
      if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
      return left.artistName.localeCompare(right.artistName);
    })
    .slice(0, limit);
  const summary = {
    status: "ok",
    user_id: userId,
    limit,
    sources,
    refresh_empty: refreshEmpty,
    artists_considered: byArtist.size,
    artists_selected: selectedArtists.length,
    attempted: 0,
    updated: 0,
    empty: 0,
    skipped: 0,
    failed: 0,
    source_status_counts: {},
    results: [],
    errors: [],
    note: "Admin-only bounded refresh. No approvals, sorting, rescans, playlist assignments, or Spotify writes are performed.",
  };

  for (const item of selectedArtists) {
    const artist = artistIntelligenceRepo.getOrCreateArtistIntelligence({
      artistName: item.artistName,
      spotifyArtistId: item.spotifyArtistId,
    });
    const sourceRows = new Map(artistIntelligenceRepo.listArtistIntelligenceSources(artist.id).map((row) => [row.source, row]));
    const artistResult = {
      artist_name: item.artistName,
      normalized_artist_name: item.normalizedArtistName,
      artist_intelligence_id: artist.id,
      spotify_artist_id: artist.spotify_artist_id || item.spotifyArtistId || null,
      unmatched_track_count: item.unmatched_track_count,
      affected_user_count: item.affected_user_count,
      sample_tracks: item.sample_tracks,
      sources: [],
    };

    for (const source of sources) {
      const sourceStatus = getSourceRefreshStatus(sourceRows.get(source), Date.now(), { refreshEmpty });
      summary.source_status_counts[sourceStatus.status] = (summary.source_status_counts[sourceStatus.status] || 0) + 1;
      if (!sourceStatus.eligible) {
        summary.skipped += 1;
        artistResult.sources.push({ source, action: "skipped", ...sourceStatus });
        continue;
      }
      summary.attempted += 1;
      try {
        const result = await refreshSourceForArtist(adminUserId, source, artist);
        const comparableSignals = sourceComparisonSignals({ normalized_signals: result.normalized_signals || [] });
        const signalCount = comparableSignals.length;
        if (signalCount > 0) summary.updated += 1;
        else summary.empty += 1;
        artistResult.sources.push({
          source,
          action: "attempted",
          previous_status: sourceStatus.status,
          status: signalCount > 0 ? "updated" : "empty",
          signal_count: signalCount,
          top_signals: comparableSignals.slice(0, 8),
          fetched_at: result.fetched_at || null,
          expires_at: result.expires_at || null,
        });
      } catch (err) {
        summary.failed += 1;
        const error = { artist_name: item.artistName, source, error: err.code || `${source}_refresh_error`, message: err.message };
        summary.errors.push(error);
        artistResult.sources.push({ source, action: "attempted", previous_status: sourceStatus.status, status: "fetch_error", error: error.error, message: error.message });
      }
    }

    summary.results.push(artistResult);
  }

  return summary;
}

module.exports = {
  getAdminUserUnmatchedExport,
  refreshUserUnmatchedArtistIntelligence,
};
