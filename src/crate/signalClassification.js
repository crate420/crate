const SIGNAL_TYPES = ["GENRE", "COUNTRY", "REGION", "ERA", "DESCRIPTOR", "MOOD", "STYLE", "UNKNOWN"];

const EXACT = {
  COUNTRY: new Set(["american", "australian", "brazilian", "british", "canadian", "jamaican", "mexican"]),
  REGION: new Set(["african", "asian", "european", "latin american", "new york", "southern", "west coast"]),
  ERA: new Set(["60s", "70s", "80s", "90s", "2000s", "2010s"]),
  DESCRIPTOR: new Set(["female vocalists", "legendary", "male vocalists", "queer", "seen live"]),
  MOOD: new Set(["chill", "energetic", "happy", "party", "sad"]),
  STYLE: new Set(["acoustic", "instrumental", "live", "singer-songwriter"]),
  GENRE: new Set([
    "alt r&b", "alternative r&b", "alternative rock", "blues", "britpop", "classical", "college rock", "country",
    "dance", "disco", "electronic", "folk", "funk", "grunge", "hip hop", "house", "indie rock", "jazz", "metal",
    "motown", "new wave", "pop", "post-grunge", "punk", "r&b", "reggae", "reggaeton", "rock", "shoegaze", "soul",
    "southern rock", "surf rock", "synthpop", "techno", "trance",
  ]),
};

const GENRE_SUFFIXES = [" blues", " country", " disco", " folk", " funk", " hip hop", " house", " jazz", " metal", " pop", " punk", " reggae", " rock", " soul", " techno", " trance"];

function normalizeClassifiedSignal(value) {
  const signal = String(value || "").trim().toLowerCase();
  if (signal.startsWith("genre:")) return signal.slice("genre:".length).trim();
  if (signal.startsWith("tag:")) return signal.slice("tag:".length).trim();
  return signal;
}

function classifySignal(value) {
  const signal = normalizeClassifiedSignal(value);
  if (!signal) return "UNKNOWN";
  for (const type of SIGNAL_TYPES.filter((item) => item !== "UNKNOWN" && item !== "GENRE")) {
    if (EXACT[type].has(signal)) return type;
  }
  if (EXACT.GENRE.has(signal) || GENRE_SUFFIXES.some((suffix) => signal.endsWith(suffix))) return "GENRE";
  return "UNKNOWN";
}

function classifySignals(values = []) {
  return [...new Set(values.map(normalizeClassifiedSignal).filter(Boolean))]
    .map((signal) => ({ signal, classification: classifySignal(signal) }))
    .sort((left, right) => left.classification.localeCompare(right.classification) || left.signal.localeCompare(right.signal));
}

module.exports = { SIGNAL_TYPES, classifySignal, classifySignals, normalizeClassifiedSignal };
