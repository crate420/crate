const { PLAYLIST_DEFINITIONS } = require("./playlistDefinitions");
const { scorePlaylistCode } = require("./sortRules");
const { mapGenreToTaxonomy, normalizeGenreName } = require("./taxonomyMap");

const PLAYLIST_LABELS = new Map(
  PLAYLIST_DEFINITIONS.map((definition) => [
    definition.playlistCode,
    definition.displayName.replace(/^Crate:\s*/i, ""),
  ]),
);

const EXPLICIT_GENRE_SUGGESTIONS = new Map([
  ["pop punk", { playlistCode: "alternative", confidence: "medium" }],
  ["swedish pop", { playlistCode: "pop", confidence: "high" }],
  ["europop", { playlistCode: "pop", confidence: "high" }],
  ["edm", { playlistCode: "dance", confidence: "high" }],
  ["tech house", { playlistCode: "dance", confidence: "high" }],
  ["melodic rap", { playlistCode: "hiphop", confidence: "medium" }],
  ["emo rap", { playlistCode: "hiphop", confidence: "medium" }],
  ["musicals", { playlistCode: "soundtrack", confidence: "high" }],
  ["folk metal", { playlistCode: "metal", confidence: "medium" }],
  ["proto punk", { playlistCode: "punk", confidence: "medium" }],
  ["baroque pop", { playlistCode: "pop", confidence: "medium" }],
  ["folk punk", { playlistCode: "punk", confidence: "medium" }],
  ["acoustic pop", { playlistCode: "singer_songwriter", confidence: "low" }],
  ["indie", { playlistCode: "alternative", confidence: "low" }],
  ["alternative", { playlistCode: "alternative", confidence: "high" }],
  ["afrobeats", { playlistCode: null, confidence: "none" }],
]);

const TAXONOMY_PLAYLIST_CODES = new Map([
  ["Pop", "pop"],
  ["Rock", "rock"],
  ["Country", "country"],
  ["Hip Hop", "hiphop"],
  ["R&B", "rb"],
  ["Blues", "blues"],
  ["Jazz", "jazz"],
  ["Folk", "folk"],
  ["Reggae", "reggae"],
  ["Latin", "latin"],
  ["Dance", "dance"],
  ["Electronic", "electronic"],
  ["K-Pop", "pop"],
  ["Classic Rock", "classic_rock"],
  ["Yacht Rock", "soft_rock"],
  ["Hard Rock", "hard_rock"],
  ["Hair Metal", "hard_rock"],
  ["Punk", "punk"],
  ["New Wave", "newwave"],
  ["Alternative Rock", "alternative"],
  ["Indie Rock", "alternative"],
  ["Grunge", "alternative"],
  ["Americana", "folk"],
  ["Outlaw Country", "country"],
  ["Red Dirt Country", "country"],
  ["Southern Soul", "soul"],
  ["Motown", "soul"],
  ["Funk", "funk_disco"],
  ["Disco", "funk_disco"],
  ["Reggaeton", "latin"],
  ["House", "dance"],
  ["Techno", "electronic"],
  ["Trance", "dance"],
  ["Singer-Songwriter", "singer_songwriter"],
  ["Stage & Screen", "soundtrack"],
  ["Soundtrack", "soundtrack"],
  ["Christian", "christian"],
]);

function noSuggestion(reason = "No safe existing Crate playlist suggestion.") {
  return {
    playlist_code: null,
    playlist_label: null,
    confidence: "none",
    reason,
    source: "none",
    score: null,
  };
}

function buildSuggestion({ playlistCode, confidence, reason, source, score = null }) {
  if (!playlistCode || !PLAYLIST_LABELS.has(playlistCode)) {
    return noSuggestion(reason);
  }

  return {
    playlist_code: playlistCode,
    playlist_label: PLAYLIST_LABELS.get(playlistCode),
    confidence,
    reason,
    source,
    score,
  };
}

function confidenceForScore(score) {
  if (score >= 100) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function suggestionFromAttemptContext(playlistAttemptContext) {
  const candidate = playlistAttemptContext?.top_candidates?.[0];

  if (!candidate?.playlist_code) {
    return null;
  }

  return buildSuggestion({
    playlistCode: candidate.playlist_code,
    confidence: confidenceForScore(Number(candidate.score) || 0),
    reason: candidate.main_reason || "Existing sort attempt produced a positive playlist candidate.",
    source: "playlist_attempt_context",
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
  });
}

function suggestionFromExplicitMapping(genre) {
  const normalizedGenre = normalizeGenreName(genre);
  const mapping = EXPLICIT_GENRE_SUGGESTIONS.get(normalizedGenre);

  if (!mapping) {
    return null;
  }

  if (!mapping.playlistCode) {
    return noSuggestion(`Explicit review mapping: ${genre} has no safe existing Crate playlist lane.`);
  }

  return buildSuggestion({
    playlistCode: mapping.playlistCode,
    confidence: mapping.confidence,
    reason: `Explicit read-only mapping for ${genre}.`,
    source: "explicit_mapping",
  });
}

function suggestionFromSyntheticScore({ genre, artistName, trackName }) {
  const decision = scorePlaylistCode({
    track: { name: trackName || "" },
    album: { name: "", releaseDate: null },
    artists: [],
    artistNames: artistName ? [artistName] : [],
    genres: genre ? [genre] : [],
    spotifyGenres: genre ? [genre] : [],
    fallbackGenres: [],
    fallbackGenresByArtistName: new Map(),
  });
  const candidate = decision.candidates?.[0];

  if (!candidate?.playlistCode) {
    return null;
  }

  return buildSuggestion({
    playlistCode: candidate.playlistCode,
    confidence: confidenceForScore(Number(candidate.score) || 0),
    reason: candidate.reasons?.[0]?.reason || candidate.reasons?.[0]?.matched || "Existing sort rules recognize this genre signal.",
    source: "synthetic_rule_score",
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
  });
}

function suggestionFromTaxonomy(genre) {
  const taxonomy = mapGenreToTaxonomy(genre);
  const labels = [
    ...(taxonomy.coreGenres || []),
    ...(taxonomy.scenes || []),
    ...(taxonomy.collections || []),
    ...(taxonomy.specialInterest || []),
  ];
  const playlistCodes = [...new Set(labels.map((label) => TAXONOMY_PLAYLIST_CODES.get(label)).filter(Boolean))];

  if (playlistCodes.length !== 1) {
    return null;
  }

  return buildSuggestion({
    playlistCode: playlistCodes[0],
    confidence: "low",
    reason: `Discovery taxonomy maps ${genre} to one existing Crate playlist lane.`,
    source: "taxonomy",
  });
}

function suggestPlaylist({ genre, artistName, trackName, playlistAttemptContext } = {}) {
  return suggestionFromAttemptContext(playlistAttemptContext) ||
    suggestionFromExplicitMapping(genre) ||
    suggestionFromSyntheticScore({ genre, artistName, trackName }) ||
    suggestionFromTaxonomy(genre) ||
    noSuggestion();
}

module.exports = {
  suggestPlaylist,
};
