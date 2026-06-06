const { getSeedIntelligenceReport } = require("./seedIntelligence");
const { getSpecialtyTrackPreviewSummariesForUser, specialtyPlaylistCodeForSeed } = require("./specialtyTrackResolver");

const VISIBLE_STATUSES = new Set(["available", "recommended"]);
const MIN_OVERLAP_COUNT = 10;
const MIN_CONFIDENCE = 85;

const DISPLAY_NAMES = {
  beach_vibes: "Beach Vibes",
  disco: "Disco",
  motown: "Motown",
  new_wave: "New Wave",
  pop_punk: "Pop Punk",
  southern_soul: "Southern Soul",
  yacht_rock: "Yacht Rock",
};

function humanizeSeedCode(seedCode) {
  return String(seedCode || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayNameForSeed(seedCode, fallbackName) {
  return DISPLAY_NAMES[seedCode] || String(fallbackName || "").trim() || humanizeSeedCode(seedCode);
}

function normalizeSuggestion(opportunity) {
  const seedCode = String(opportunity?.seed_code || "").trim();
  const displayName = displayNameForSeed(seedCode, opportunity?.playlist_name);
  const overlapCount = Number(opportunity?.overlap_count || 0);

  return {
    seed_code: seedCode,
    playlist_code: specialtyPlaylistCodeForSeed(seedCode),
    display_name: displayName,
    overlap_count: overlapCount,
    confidence: Number(opportunity?.confidence_score || 0),
    source_type: opportunity?.source_type || "spotify",
    supported_playlist_code: opportunity?.supports_playlist_code || null,
    status: opportunity?.recommendation_status || "insufficient",
    reason: `${overlapCount.toLocaleString()} of your liked songs match ${displayName} seed playlists.`,
    send_enabled: true,
    prototype_only: false,
  };
}

function isVisibleOpportunity(opportunity) {
  const status = opportunity?.recommendation_status || "";
  const overlapCount = Number(opportunity?.overlap_count || 0);
  const confidence = Number(opportunity?.confidence_score || 0);
  return VISIBLE_STATUSES.has(status) && overlapCount >= MIN_OVERLAP_COUNT && confidence >= MIN_CONFIDENCE;
}

function getSpecialtySuggestionsForUser(userId) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) return [];

  const report = getSeedIntelligenceReport(Number(userId));
  const opportunities = Array.isArray(report?.opportunities) ? report.opportunities : [];

  const suggestions = opportunities
    .filter(isVisibleOpportunity)
    .map(normalizeSuggestion)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return right.overlap_count - left.overlap_count;
    });
  const summariesBySeedCode = getSpecialtyTrackPreviewSummariesForUser(Number(userId), suggestions.map((suggestion) => suggestion.seed_code));
  return suggestions.map((suggestion) => ({
    ...suggestion,
    preview_summary: summariesBySeedCode[suggestion.seed_code] || null,
  }));
}

module.exports = {
  getSpecialtySuggestionsForUser,
  isVisibleOpportunity,
  normalizeSuggestion,
};
