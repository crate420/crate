function parseSignals(value) {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function normalizeSignal(value) {
  return String(value || "").trim().toLowerCase();
}

function comparableSignal(value) {
  const signal = normalizeSignal(value);

  if (!signal) return null;
  if (signal.startsWith("genre:")) return signal.slice("genre:".length).trim() || null;
  if (signal.startsWith("tag:")) return signal.slice("tag:".length).trim() || null;
  if (signal.includes(":")) return null;

  return signal;
}

function sourceComparisonSignals(source) {
  return [...new Set(parseSignals(source.normalized_signals_json || source.normalized_signals)
    .map(comparableSignal)
    .filter(Boolean))];
}

function sourceFreshness(source, nowMs) {
  const expiresAtMs = source.expires_at ? new Date(source.expires_at).getTime() : null;
  const expired = Number.isFinite(expiresAtMs) ? expiresAtMs <= nowMs : false;

  return {
    source: source.source,
    fetched_at: source.fetched_at,
    expires_at: source.expires_at,
    expired,
    freshness: expired ? "expired" : "fresh",
    has_error: Boolean(source.error_code),
  };
}

function compareArtistIntelligenceSources(sources = [], { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const comparableSources = sources.map((source) => ({
    source: source.source,
    signals: sourceComparisonSignals(source),
    has_error: Boolean(source.error_code),
  }));
  const signalSources = new Map();

  for (const source of comparableSources.filter((item) => !item.has_error)) {
    for (const signal of source.signals) {
      const names = signalSources.get(signal) || new Set();
      names.add(source.source);
      signalSources.set(signal, names);
    }
  }

  const sharedSignals = [...signalSources.entries()]
    .filter(([, names]) => names.size >= 2)
    .map(([signal]) => signal)
    .sort();
  const sourceOnlySignals = Object.fromEntries(comparableSources.map((source) => [
    source.source,
    source.signals.filter((signal) => (signalSources.get(signal)?.size || 0) === 1).sort(),
  ]));
  const freshness = sources.map((source) => sourceFreshness(source, nowMs));
  const notes = [];

  if (sources.length >= 2 && sharedSignals.length === 0) {
    notes.push("No shared exact genre or tag signals across cached sources.");
  }

  if (Object.values(sourceOnlySignals).some((signals) => signals.length > 0)) {
    notes.push("Some cached signals appear in only one source.");
  }

  if (freshness.some((source) => source.expired)) {
    notes.push("One or more cached sources are expired.");
  }

  return {
    source_count: sources.length,
    shared_signals: sharedSignals,
    source_only_signals: sourceOnlySignals,
    freshness,
    has_disagreement: notes.length > 0,
    disagreement_notes: notes,
  };
}

function calculateArtistIntelligenceConfidence(artist, sources = []) {
  if (sources.length === 0 || sources.every((source) => Boolean(source.error_code))) {
    return 0;
  }

  const baseScores = { 1: 35, 2: 60, 3: 75 };
  const comparison = compareArtistIntelligenceSources(sources);
  let score = baseScores[Math.min(sources.length, 3)] || 0;

  if (comparison.shared_signals.length > 0) score += 10;
  if (artist?.spotify_artist_id) score += 10;
  if (sources.some((source) => source.source === "musicbrainz" && !source.error_code)) score += 5;

  return Math.min(score, 95);
}

module.exports = {
  calculateArtistIntelligenceConfidence,
  compareArtistIntelligenceSources,
  sourceComparisonSignals,
};
