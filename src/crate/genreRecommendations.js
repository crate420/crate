const { openDatabase } = require("../db");
const artistGenreRepo = require("../repositories/artistGenres");
const { sourceComparisonSignals } = require("./artistIntelligenceComparison");
const { getArtistIds, getArtistNames, parseRawTrack } = require("./trackContext");
const { ACTIVE_PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");

const PLAYLIST_LABELS = Object.fromEntries(ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => [definition.playlistCode, definition.shortLabel || definition.displayName]));

const APPROVAL_GENRE_BY_PLAYLIST_CODE = {
  alternative: "alternative rock",
  blues: "blues",
  christian: "christian",
  classic_rock: "classic rock",
  country: "country",
  dance: "dance",
  electronic: "electronic",
  folk: "folk",
  funk_disco: "funk",
  hard_rock: "hard rock",
  hiphop: "hiphop",
  jazz: "jazz",
  latin: "latin",
  metal: "metal",
  newwave: "new wave",
  pop: "pop",
  pop_punk: "pop punk",
  punk: "punk",
  rb: "r&b",
  reggae: "reggae",
  rock: "rock",
  singer_songwriter: "singer-songwriter",
  soft_rock: "soft rock",
  soul: "soul",
  soundtrack: "soundtrack",
  sunshine_pop: "sunshine pop",
};

const PLAYLIST_SIGNAL_RULES = [
  { playlist_code: "hiphop", signals: ["trap", "rap", "hip hop", "hip-hop", "southern hip hop", "melodic rap", "emo rap", "atl hip hop", "pop rap"] },
  { playlist_code: "rb", signals: ["rnb", "r&b", "neo-soul", "neo soul", "rhythm and blues", "contemporary r&b", "soul r&b"] },
  { playlist_code: "alternative", signals: ["alternative", "alternative rock", "alt rock", "indie", "indie rock", "modern rock"] },
  { playlist_code: "dance", signals: ["electronic", "dance", "house", "edm", "tech house", "electro house", "dance pop"] },
  { playlist_code: "pop", signals: ["synthpop", "electropop", "pop", "swedish pop", "europop"] },
  { playlist_code: "rock", signals: ["rock", "pop rock"] },
  { playlist_code: "classic_rock", signals: ["classic rock", "album rock", "mellow gold"] },
  { playlist_code: "hard_rock", signals: ["hard rock", "post-grunge", "nu metal", "rap metal"] },
  { playlist_code: "newwave", signals: ["new wave", "new-wave", "new romantic"] },
  { playlist_code: "pop_punk", signals: ["pop punk", "emo pop", "easycore", "skate punk", "neon pop punk"] },
  { playlist_code: "punk", signals: ["punk", "punk rock", "folk punk", "proto-punk", "garage punk"] },
  { playlist_code: "metal", signals: ["metal", "heavy metal", "folk metal", "alternative metal", "thrash metal"] },
  { playlist_code: "soul", signals: ["soul", "motown", "southern soul", "classic soul"] },
  { playlist_code: "funk_disco", signals: ["funk", "disco", "boogie", "post-disco"] },
  { playlist_code: "folk", signals: ["folk", "folk pop", "americana", "stomp and holler"] },
  { playlist_code: "country", signals: ["country", "country pop", "modern country", "red dirt"] },
  { playlist_code: "reggae", signals: ["reggae", "dancehall", "ska", "reggae rock", "roots reggae"] },
  { playlist_code: "latin", signals: ["latin", "reggaeton", "latin pop", "salsa", "cumbia"] },
  { playlist_code: "electronic", signals: ["electronica", "trip hop", "ambient", "downtempo", "synthwave"] },
  { playlist_code: "soundtrack", signals: ["soundtrack", "musicals", "broadway", "show tunes", "showtunes", "movie tunes"] },
  { playlist_code: "christian", signals: ["christian", "ccm", "worship", "gospel", "christian music"] },
  { playlist_code: "blues", signals: ["blues", "electric blues", "modern blues"] },
  { playlist_code: "jazz", signals: ["jazz", "vocal jazz", "smooth jazz"] },
  { playlist_code: "sunshine_pop", signals: ["sunshine pop", "baroque pop", "chamber pop", "orchestral pop", "brill building pop"] },
  { playlist_code: "singer_songwriter", signals: ["singer-songwriter", "singer songwriter", "acoustic pop", "lilith"] },
];

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function normalizeSignal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^genre:/, "")
    .replace(/^tag:/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeArtistName(value) {
  return String(value || "").trim().toLowerCase();
}

function confidenceTier(confidence) {
  if (confidence >= 95) return "Safe";
  if (confidence >= 85) return "Strong";
  if (confidence >= 70) return "Review";
  return "Manual";
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch (err) {
    return fallback;
  }
}

function sourceSignals(source) {
  return sourceComparisonSignals(source).map(normalizeSignal).filter(Boolean);
}

function approvedGenreSignals(artist) {
  return (artist.approved_artist_genres || []).map(normalizeSignal).filter(Boolean);
}

function readApprovedGenresByArtist(db) {
  const result = new Map();
  if (!tableExists(db, "artist_genres")) return result;
  const rows = db.prepare("SELECT artist_name, genre, source FROM artist_genres ORDER BY artist_name, genre").all();
  for (const row of rows) {
    const key = normalizeArtistName(row.artist_name);
    if (!key) continue;
    const item = result.get(key) || { genres: new Set(), sources: new Set() };
    item.genres.add(row.genre);
    item.sources.add(row.source);
    result.set(key, item);
  }
  return result;
}

function readSourcesByArtist(db) {
  const byName = new Map();
  const bySpotifyId = new Map();
  if (!tableExists(db, "artist_intelligence") || !tableExists(db, "artist_intelligence_sources")) {
    return { byName, bySpotifyId };
  }

  const rows = db.prepare(`
    SELECT
      artist_intelligence.id AS artist_intelligence_id,
      artist_intelligence.normalized_artist_name,
      artist_intelligence.display_artist_name,
      artist_intelligence.spotify_artist_id,
      artist_intelligence.confidence_score,
      artist_intelligence.source_count,
      artist_intelligence_sources.source,
      artist_intelligence_sources.normalized_signals_json,
      artist_intelligence_sources.error_code,
      artist_intelligence_sources.fetched_at
    FROM artist_intelligence
    LEFT JOIN artist_intelligence_sources
      ON artist_intelligence_sources.artist_intelligence_id = artist_intelligence.id
    ORDER BY artist_intelligence.normalized_artist_name, artist_intelligence_sources.source
  `).all();

  for (const row of rows) {
    const key = row.normalized_artist_name;
    if (!key) continue;
    const entry = byName.get(key) || {
      artist_intelligence_id: row.artist_intelligence_id,
      normalized_artist_name: row.normalized_artist_name,
      display_artist_name: row.display_artist_name,
      spotify_artist_id: row.spotify_artist_id,
      confidence_score: row.confidence_score,
      source_count: row.source_count,
      sources: [],
    };
    if (row.source) {
      entry.sources.push({
        source: row.source,
        normalized_signals_json: row.normalized_signals_json,
        normalized_signals: parseJson(row.normalized_signals_json, []),
        error_code: row.error_code,
        fetched_at: row.fetched_at,
      });
    }
    byName.set(key, entry);
    if (entry.spotify_artist_id) bySpotifyId.set(entry.spotify_artist_id, entry);
  }

  return { byName, bySpotifyId };
}

function makeArtistRecord(artistName) {
  return {
    artist_name: artistName,
    normalized_artist_name: normalizeArtistName(artistName),
    affected_user_ids: new Set(),
    affected_users: new Map(),
    unmatched_track_ids: new Set(),
    total_occurrences: 0,
    spotify_artist_ids: new Set(),
    approved_artist_genres: new Set(),
    approved_sources: new Set(),
    sample_tracks: [],
    estimated_match_gain_if_approved: 0,
  };
}

function readUnmatchedArtistGaps(db) {
  const approvedByArtist = readApprovedGenresByArtist(db);
  const rows = db.prepare(`
    SELECT
      users.id AS user_id,
      users.display_name,
      users.email,
      tracks.id AS track_id,
      tracks.spotify_track_id,
      tracks.name AS track_name,
      tracks.album_name,
      tracks.artist_names,
      tracks.raw_json
    FROM user_tracks
    INNER JOIN tracks ON tracks.id = user_tracks.track_id
    INNER JOIN users ON users.id = user_tracks.user_id
    WHERE user_tracks.playlist_code IS NULL
    ORDER BY users.id ASC, tracks.name COLLATE NOCASE ASC
  `).all();

  const recordsByArtist = new Map();
  for (const row of rows) {
    const rawTrack = parseRawTrack(row.raw_json);
    const artistNames = getArtistNames(row, rawTrack);
    const artistIds = getArtistIds(rawTrack);
    const safeArtistNames = artistNames.length ? artistNames : ["Unknown Artist"];

    safeArtistNames.forEach((artistName, index) => {
      const normalizedArtistName = normalizeArtistName(artistName);
      if (!normalizedArtistName) return;
      const record = recordsByArtist.get(normalizedArtistName) || makeArtistRecord(artistName);
      const approved = approvedByArtist.get(normalizedArtistName);
      record.affected_user_ids.add(row.user_id);
      record.affected_users.set(row.user_id, {
        user_id: row.user_id,
        name: row.display_name || null,
        email: row.email || null,
      });
      record.unmatched_track_ids.add(row.track_id);
      record.total_occurrences += 1;
      if (artistIds[index]) record.spotify_artist_ids.add(artistIds[index]);
      if (approved) {
        for (const genre of approved.genres) record.approved_artist_genres.add(genre);
        for (const source of approved.sources) record.approved_sources.add(source);
      } else {
        record.estimated_match_gain_if_approved += 1;
      }
      if (record.sample_tracks.length < 8) {
        record.sample_tracks.push({
          user_id: row.user_id,
          track_id: row.track_id,
          track_name: row.track_name,
          album_name: row.album_name,
        });
      }
      recordsByArtist.set(normalizedArtistName, record);
    });
  }

  return [...recordsByArtist.values()].map((record) => ({
    artist_name: record.artist_name,
    normalized_artist_name: record.normalized_artist_name,
    affected_user_count: record.affected_user_ids.size,
    affected_users: [...record.affected_users.values()].sort((a, b) => a.user_id - b.user_id),
    unmatched_track_count: record.unmatched_track_ids.size,
    total_occurrences: record.total_occurrences,
    spotify_artist_ids: [...record.spotify_artist_ids].sort(),
    spotify_artist_id: [...record.spotify_artist_ids][0] || null,
    approved_artist_genres: [...record.approved_artist_genres].sort((a, b) => a.localeCompare(b)),
    approved_sources: [...record.approved_sources].sort((a, b) => a.localeCompare(b)),
    estimated_match_gain_if_approved: record.estimated_match_gain_if_approved,
    sample_tracks: record.sample_tracks,
  })).sort((left, right) => {
    if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
    if (right.unmatched_track_count !== left.unmatched_track_count) return right.unmatched_track_count - left.unmatched_track_count;
    if (right.estimated_match_gain_if_approved !== left.estimated_match_gain_if_approved) return right.estimated_match_gain_if_approved - left.estimated_match_gain_if_approved;
    return left.artist_name.localeCompare(right.artist_name);
  });
}

function signalMatchesRule(signal, ruleSignal) {
  if (!signal || !ruleSignal) return false;
  return signal === ruleSignal || signal.includes(ruleSignal);
}

function collectEvidenceForRule(artist, intelligence, rule) {
  const evidence = [];

  for (const signal of approvedGenreSignals(artist)) {
    for (const ruleSignal of rule.signals) {
      if (signalMatchesRule(signal, ruleSignal)) {
        evidence.push({ source: "approved_artist_genres", signal, matched_signal: ruleSignal });
      }
    }
  }

  for (const source of intelligence?.sources || []) {
    if (source.error_code) continue;
    for (const signal of sourceSignals(source)) {
      for (const ruleSignal of rule.signals) {
        if (signalMatchesRule(signal, ruleSignal)) {
          evidence.push({ source: source.source, signal, matched_signal: ruleSignal });
        }
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of evidence) {
    const key = item.source + "::" + item.signal + "::" + item.matched_signal;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function scoreRecommendation(artist, evidence, intelligence) {
  const sources = new Set(evidence.map((item) => item.source));
  const signals = new Set(evidence.map((item) => item.signal));
  let confidence = 48;
  confidence += Math.min(30, sources.size * 10);
  confidence += Math.min(12, signals.size * 4);
  confidence += Math.min(7, Number(artist.affected_user_count || 0) * 2);
  confidence += Math.min(8, Number(artist.estimated_match_gain_if_approved || 0));
  if (sources.has("approved_artist_genres")) confidence += 12;
  if (intelligence?.spotify_artist_id || artist.spotify_artist_id) confidence += 3;
  return Math.min(99, confidence);
}

function bestRecommendationForArtist(artist, intelligence) {
  const candidates = PLAYLIST_SIGNAL_RULES.map((rule) => {
    const evidence = collectEvidenceForRule(artist, intelligence, rule);
    const confidence = evidence.length ? scoreRecommendation(artist, evidence, intelligence) : 0;
    return { rule, evidence, confidence };
  })
    .filter((candidate) => candidate.evidence.length > 0)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      if (right.evidence.length !== left.evidence.length) return right.evidence.length - left.evidence.length;
      return (PLAYLIST_LABELS[left.rule.playlist_code] || left.rule.playlist_code).localeCompare(PLAYLIST_LABELS[right.rule.playlist_code] || right.rule.playlist_code);
    });

  return candidates[0] || null;
}

function serializeRecommendation(artist, best, intelligence) {
  const sourceNames = [...new Set(best.evidence.map((item) => item.source))].sort();
  const confidence = best.confidence;
  return {
    recommendation_key: artist.normalized_artist_name + "::" + best.rule.playlist_code,
    artist: artist.artist_name,
    normalized_artist_name: artist.normalized_artist_name,
    spotify_artist_id: artist.spotify_artist_id,
    affected_user_count: artist.affected_user_count,
    affected_users: artist.affected_users,
    unmatched_tracks: artist.unmatched_track_count,
    estimated_gain: artist.estimated_match_gain_if_approved,
    recommended_playlist_code: best.rule.playlist_code,
    recommended_crate_playlist: PLAYLIST_LABELS[best.rule.playlist_code] || best.rule.playlist_code,
    approved_genre: APPROVAL_GENRE_BY_PLAYLIST_CODE[best.rule.playlist_code] || best.rule.playlist_code,
    confidence,
    confidence_tier: confidenceTier(confidence),
    source_agreement: sourceNames.length,
    supporting_sources: sourceNames,
    supporting_evidence: best.evidence,
    sample_tracks: artist.sample_tracks || [],
    artist_intelligence_id: intelligence?.artist_intelligence_id || null,
    artist_intelligence_confidence: intelligence?.confidence_score || 0,
  };
}


function isRecommendationAlreadyApproved(db, recommendation) {
  if (!tableExists(db, "artist_genres")) return false;
  const row = db.prepare(`
    SELECT 1 AS found
    FROM artist_genres
    WHERE lower(trim(artist_name)) = @artistName
      AND lower(trim(genre)) = @genre
    LIMIT 1
  `).get({
    artistName: recommendation.normalized_artist_name,
    genre: normalizeSignal(recommendation.approved_genre),
  });
  return Boolean(row);
}

function buildRecommendations({ db = openDatabase(), includeApproved = false } = {}) {
  const sources = readSourcesByArtist(db);
  const recommendations = [];

  for (const artist of readUnmatchedArtistGaps(db)) {
    const intelligence = (artist.spotify_artist_id && sources.bySpotifyId.get(artist.spotify_artist_id))
      || sources.byName.get(artist.normalized_artist_name)
      || null;
    const best = bestRecommendationForArtist(artist, intelligence);
    if (!best) continue;
    const recommendation = serializeRecommendation(artist, best, intelligence);
    if (!includeApproved && isRecommendationAlreadyApproved(db, recommendation)) continue;
    recommendations.push(recommendation);
  }

  return recommendations.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    if (right.estimated_gain !== left.estimated_gain) return right.estimated_gain - left.estimated_gain;
    if (right.affected_user_count !== left.affected_user_count) return right.affected_user_count - left.affected_user_count;
    return left.artist.localeCompare(right.artist);
  });
}

function summarizeTiers(recommendations) {
  const counts = { Safe: 0, Strong: 0, Review: 0, Manual: 0 };
  for (const recommendation of recommendations) {
    counts[recommendation.confidence_tier] = (counts[recommendation.confidence_tier] || 0) + 1;
  }
  return counts;
}

function filterPreview(recommendations, preview) {
  if (preview === "safe") return recommendations.filter((row) => row.confidence >= 95);
  if (preview === "strong_plus") return recommendations.filter((row) => row.confidence >= 85);
  return recommendations;
}

async function getAdminGenreRecommendations(options = {}) {
  const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 50, 1), 500);
  const preview = String(options.preview || "all").trim();
  const recommendations = buildRecommendations();
  const previewed = filterPreview(recommendations, preview);
  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    preview,
    recommendation_count: recommendations.length,
    filtered_count: previewed.length,
    counts_by_confidence_tier: summarizeTiers(recommendations),
    estimated_total_match_gain: recommendations.reduce((sum, row) => sum + Number(row.estimated_gain || 0), 0),
    preview_estimated_match_gain: previewed.reduce((sum, row) => sum + Number(row.estimated_gain || 0), 0),
    recommendations: previewed.slice(0, limit),
  };
}

function findRecommendation(artistName, playlistCode) {
  const normalizedArtistName = normalizeArtistName(artistName);
  const normalizedPlaylistCode = String(playlistCode || "").trim();
  return buildRecommendations({ includeApproved: true }).find((row) => row.normalized_artist_name === normalizedArtistName && row.recommended_playlist_code === normalizedPlaylistCode) || null;
}

function writeApprovalLog(db, recommendation, adminUser) {
  db.prepare(`
    INSERT INTO genre_recommendation_approvals (
      artist_name,
      normalized_artist_name,
      recommended_playlist_code,
      approved_genre,
      confidence,
      confidence_tier,
      estimated_gain,
      evidence_json,
      admin_user_id,
      admin_spotify_user_id
    ) VALUES (
      @artistName,
      @normalizedArtistName,
      @recommendedPlaylistCode,
      @approvedGenre,
      @confidence,
      @confidenceTier,
      @estimatedGain,
      @evidenceJson,
      @adminUserId,
      @adminSpotifyUserId
    )
  `).run({
    artistName: recommendation.artist,
    normalizedArtistName: recommendation.normalized_artist_name,
    recommendedPlaylistCode: recommendation.recommended_playlist_code,
    approvedGenre: recommendation.approved_genre,
    confidence: recommendation.confidence,
    confidenceTier: recommendation.confidence_tier,
    estimatedGain: recommendation.estimated_gain || 0,
    evidenceJson: JSON.stringify(recommendation.supporting_evidence || []),
    adminUserId: adminUser?.id || null,
    adminSpotifyUserId: adminUser?.spotify_user_id || null,
  });
}

function applyGenreRecommendation(recommendation, adminUser) {
  if (!recommendation) {
    const error = new Error("Recommendation was not found or no longer has enough evidence.");
    error.statusCode = 404;
    error.code = "recommendation_not_found";
    throw error;
  }

  const db = openDatabase();
  const run = db.transaction(() => {
    const result = artistGenreRepo.insertArtistGenres({
      artistName: recommendation.artist,
      genres: [recommendation.approved_genre],
      source: "genre_recommendation_admin",
    });
    writeApprovalLog(db, recommendation, adminUser);
    return result.inserted;
  });

  const inserted = run();
  console.log("[Genre Recommendations] approved", {
    artist: recommendation.artist,
    playlist: recommendation.recommended_playlist_code,
    approved_genre: recommendation.approved_genre,
    confidence: recommendation.confidence,
    tier: recommendation.confidence_tier,
    estimated_gain: recommendation.estimated_gain,
    admin_user_id: adminUser?.id || null,
    inserted,
  });

  return {
    artist: recommendation.artist,
    normalized_artist_name: recommendation.normalized_artist_name,
    recommended_playlist_code: recommendation.recommended_playlist_code,
    recommended_crate_playlist: recommendation.recommended_crate_playlist,
    approved_genre: recommendation.approved_genre,
    confidence: recommendation.confidence,
    confidence_tier: recommendation.confidence_tier,
    estimated_gain: recommendation.estimated_gain,
    inserted_count: inserted,
    duplicate_skipped: inserted === 0,
  };
}

async function approveGenreRecommendation(options = {}) {
  const recommendation = findRecommendation(options.artist, options.playlistCode);
  return {
    status: "ok",
    mode: "single",
    result: applyGenreRecommendation(recommendation, options.adminUser),
    message: "Approval saved. Run a separate future sort/rescan to apply the estimated match gain.",
  };
}

async function approveSelectedGenreRecommendations(options = {}) {
  const selections = Array.isArray(options.selections) ? options.selections : [];
  if (selections.length === 0) {
    const error = new Error("At least one recommendation selection is required.");
    error.statusCode = 400;
    error.code = "missing_selections";
    throw error;
  }
  if (selections.length > 100) {
    const error = new Error("Selected approval is limited to 100 recommendations per request.");
    error.statusCode = 400;
    error.code = "too_many_selections";
    throw error;
  }

  const seen = new Set();
  const results = [];
  const errors = [];
  let inserted = 0;
  let duplicates = 0;

  for (const selection of selections) {
    const key = normalizeArtistName(selection?.artist) + "::" + String(selection?.playlistCode || selection?.playlist_code || "").trim();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    try {
      const recommendation = findRecommendation(selection?.artist, selection?.playlistCode || selection?.playlist_code);
      const result = applyGenreRecommendation(recommendation, options.adminUser);
      inserted += result.inserted_count;
      if (result.duplicate_skipped) duplicates += 1;
      results.push(result);
    } catch (err) {
      errors.push({
        artist: selection?.artist || null,
        playlist_code: selection?.playlistCode || selection?.playlist_code || null,
        error: err.code || "genre_recommendation_approval_error",
        message: err.message,
      });
    }
  }

  return {
    status: errors.length ? "partial" : "ok",
    mode: "selected",
    attempted_count: seen.size,
    approved_count: results.length,
    inserted_genres_count: inserted,
    duplicates_skipped: duplicates,
    error_count: errors.length,
    results,
    errors,
    message: "Approval saved. Run a separate future sort/rescan to apply the estimated match gain.",
  };
}

module.exports = {
  buildRecommendations,
  approveGenreRecommendation,
  approveSelectedGenreRecommendations,
  getAdminGenreRecommendations,
};
