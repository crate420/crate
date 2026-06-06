const { openDatabase } = require("../db");
const playlistSeedRegistry = require("./playlistSeedRegistry");
const { normalizeText } = require("./curatedSeedImport");
const curatedSeedRepo = require("../repositories/curatedPlaylistSeeds");

function parseJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch (err) { return fallback; }
}

function normalizeArtist(value) { return normalizeText(value).replace(/^the\s+/, ""); }
function trackKey(track, artist) { return normalizeText(track) + "::" + normalizeArtist(artist); }

function getUserTracks(userId) {
  return openDatabase().prepare("SELECT tracks.spotify_track_id, tracks.name, tracks.artist_names, tracks.raw_json, user_tracks.playlist_code FROM user_tracks INNER JOIN tracks ON tracks.id = user_tracks.track_id WHERE user_tracks.user_id = ?").all(userId).map((row) => {
    const artistNames = parseJson(row.artist_names, []);
    const raw = parseJson(row.raw_json, {});
    const isrc = raw && raw.external_ids ? raw.external_ids.isrc || null : null;
    return {
      spotify_track_id: row.spotify_track_id,
      track_name: row.name,
      artist_names: artistNames,
      primary_artist: artistNames[0] || "",
      isrc,
      playlist_code: row.playlist_code,
      key: trackKey(row.name, artistNames[0] || ""),
    };
  });
}

function getSpotifySeedTracks(seedCode) {
  return openDatabase().prepare("SELECT * FROM playlist_seed_tracks WHERE seed_code = ? ORDER BY position ASC").all(seedCode).map((row) => {
    const artists = parseJson(row.artist_names_json, []);
    return {
      source_type: "spotify",
      seed_code: seedCode,
      spotify_track_id: row.spotify_track_id,
      isrc: row.isrc,
      track_name: row.track_name,
      artist_names: artists,
      primary_artist: artists[0] || "",
      key: trackKey(row.track_name, artists[0] || ""),
    };
  });
}

function getCuratedSeedTracks(seedCode) {
  return curatedSeedRepo.listCuratedSeedTracks(seedCode).map((row) => ({
    source_type: row.source_type,
    seed_code: seedCode,
    spotify_track_id: row.spotify_track_id,
    isrc: null,
    track_name: row.track_name,
    artist_names: row.artist_names || [row.artist_name],
    primary_artist: row.artist_name,
    key: row.normalized_track + "::" + row.normalized_artist,
  }));
}

function countSharedArtists(leftTracks, rightTracks) {
  const left = new Set(leftTracks.map((track) => normalizeArtist(track.primary_artist)).filter(Boolean));
  const right = new Set(rightTracks.map((track) => normalizeArtist(track.primary_artist)).filter(Boolean));
  let shared = 0;
  for (const artist of left) if (right.has(artist)) shared += 1;
  return { shared_artist_count: shared, left_artist_count: left.size, right_artist_count: right.size, shared_artist_percent: left.size ? Math.round((shared / left.size) * 100) : 0 };
}

function compareSpotifyAndCurated(seedCode) {
  const spotifyTracks = getSpotifySeedTracks(seedCode);
  const curatedTracks = getCuratedSeedTracks(seedCode);
  const spotifyKeys = new Set(spotifyTracks.map((track) => track.key));
  const curatedKeys = new Set(curatedTracks.map((track) => track.key));
  let sharedTracks = 0;
  for (const key of curatedKeys) if (spotifyKeys.has(key)) sharedTracks += 1;
  const artistOverlap = countSharedArtists(spotifyTracks, curatedTracks);
  return {
    seed_code: seedCode,
    spotify_track_count: spotifyTracks.length,
    curated_track_count: curatedTracks.length,
    shared_track_count: sharedTracks,
    overlap_percent: spotifyTracks.length ? Math.round((sharedTracks / spotifyTracks.length) * 100) : 0,
    unique_spotify_tracks: Math.max(0, spotifyTracks.length - sharedTracks),
    unique_curated_tracks: Math.max(0, curatedTracks.length - sharedTracks),
    ...artistOverlap,
  };
}

function buildIndexes(tracks) {
  return {
    spotify: new Map(tracks.filter((track) => track.spotify_track_id).map((track) => [track.spotify_track_id, track])),
    isrc: new Map(tracks.filter((track) => track.isrc).map((track) => [track.isrc, track])),
    key: new Map(tracks.map((track) => [track.key, track])),
  };
}

function matchUserTrack(userTrack, spotifyIndex, curatedIndex) {
  if (userTrack.spotify_track_id && spotifyIndex.spotify.has(userTrack.spotify_track_id)) return { type: "spotify_exact", weight: 100 };
  if (userTrack.isrc && spotifyIndex.isrc.has(userTrack.isrc)) return { type: "isrc", weight: 95 };
  if (curatedIndex.spotify.has(userTrack.spotify_track_id)) return { type: "curated_spotify_id", weight: 90 };
  if (curatedIndex.key.has(userTrack.key)) return { type: "curated_artist_title", weight: 82 };
  if (spotifyIndex.key.has(userTrack.key)) return { type: "fallback_artist_title", weight: 70 };
  return null;
}

function recommendationStatus(overlapCount, confidenceScore, sourceAgreementScore) {
  if (overlapCount >= 25 && confidenceScore >= 88 && sourceAgreementScore >= 50) return "recommended";
  if (overlapCount >= 10 && confidenceScore >= 75) return "available";
  if (overlapCount >= 3) return "possible";
  return "insufficient";
}

function buildOpportunity(seed, userTracks) {
  const spotifyTracks = getSpotifySeedTracks(seed.seed_code);
  const curatedTracks = getCuratedSeedTracks(seed.seed_code);
  const spotifyIndex = buildIndexes(spotifyTracks);
  const curatedIndex = buildIndexes(curatedTracks);
  const matchCounts = {};
  let scoreTotal = 0;
  let overlapCount = 0;
  for (const userTrack of userTracks) {
    const match = matchUserTrack(userTrack, spotifyIndex, curatedIndex);
    if (!match) continue;
    overlapCount += 1;
    scoreTotal += match.weight;
    matchCounts[match.type] = (matchCounts[match.type] || 0) + 1;
  }
  const confidenceScore = overlapCount ? Math.round(scoreTotal / overlapCount) : 0;
  const comparison = compareSpotifyAndCurated(seed.seed_code);
  const sourceAgreementScore = comparison.spotify_track_count && comparison.curated_track_count ? Math.round((comparison.overlap_percent + comparison.shared_artist_percent) / 2) : (curatedTracks.length ? 55 : 0);
  return {
    seed_code: seed.seed_code,
    source_type: seed.source_type || "spotify",
    playlist_name: seed.playlist_name,
    supports_playlist_code: seed.supports_playlist_code,
    overlap_count: overlapCount,
    confidence_score: confidenceScore,
    source_agreement_score: sourceAgreementScore,
    recommendation_status: recommendationStatus(overlapCount, confidenceScore, sourceAgreementScore),
    match_counts: matchCounts,
    spotify_seed_tracks: spotifyTracks.length,
    curated_seed_tracks: curatedTracks.length,
  };
}

function getSeedIntelligenceReport(userId) {
  const seeds = playlistSeedRegistry.getActivePlaylistSeeds().filter((seed) => ["yacht_rock", "southern_soul", "motown", "disco", "new_wave", "pop_punk", "beach_vibes"].includes(seed.seed_code));
  const userTracks = getUserTracks(userId);
  const comparisons = seeds.map((seed) => compareSpotifyAndCurated(seed.seed_code));
  const opportunities = seeds.map((seed) => buildOpportunity(seed, userTracks)).sort((a, b) => b.overlap_count - a.overlap_count);
  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    user_id: userId,
    curated_seed_summary: curatedSeedRepo.summarizeCuratedSeeds(),
    comparisons,
    opportunities,
    thresholds: { possible: "3+ overlaps", available: "10+ overlaps and confidence >= 75", recommended: "25+ overlaps, confidence >= 88, source agreement >= 50" },
  };
}

module.exports = {
  compareSpotifyAndCurated,
  getSeedIntelligenceReport,
};
