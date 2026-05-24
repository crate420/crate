const CORE_GENRES = [
  "Pop",
  "Rock",
  "Country",
  "Hip Hop",
  "R&B",
  "Blues",
  "Jazz",
  "Folk",
  "Reggae",
  "Latin",
  "Dance",
  "Electronic",
  "K-Pop",
];

const SCENES = [
  "Classic Rock",
  "Yacht Rock",
  "Hard Rock",
  "Hair Metal",
  "Punk",
  "New Wave",
  "Alternative Rock",
  "Indie Rock",
  "Grunge",
  "Progressive Rock",
  "Americana",
  "Outlaw Country",
  "Red Dirt Country",
  "Southern Soul",
  "Motown",
  "Funk",
  "Disco",
  "Reggaeton",
  "House",
  "Techno",
  "Trance",
  "Oldies",
  "Afrobeats",
];

const COLLECTIONS = [
  "Beach Vibes",
  "Singer-Songwriter",
  "British Invasion",
  "College Radio",
  "Stage & Screen",
  "Soundtrack",
  "Road Trip",
  "Sunday Morning",
  "Summer Cruisin'",
  "Pool Party",
  "Coffeehouse",
  "Acoustic Chill",
  "One Hit Wonders",
];

const SPECIAL_INTEREST = ["Christian"];

const EMPTY_TAXONOMY = Object.freeze({
  coreGenres: Object.freeze([]),
  scenes: Object.freeze([]),
  collections: Object.freeze([]),
  specialInterest: Object.freeze([]),
});

const TAXONOMY_LABELS = new Set([
  ...CORE_GENRES,
  ...SCENES,
  ...COLLECTIONS,
  ...SPECIAL_INTEREST,
]);

const GENRE_MAPPINGS = [
  { match: ["k-pop", "kpop", "korean pop"], coreGenres: ["K-Pop"] },
  { match: ["hip hop", "hip-hop", "rap", "trap", "pop rap", "conscious hip hop", "southern hip hop", "east coast hip hop", "west coast hip hop", "old school hip hop"], coreGenres: ["Hip Hop"] },
  { match: ["r&b", "rnb", "rb", "contemporary r&b", "urban contemporary", "new jack swing", "quiet storm", "alternative r&b"], coreGenres: ["R&B"] },
  { match: ["pop", "dance pop", "art pop", "electropop", "indie pop", "synthpop", "pop rock", "power pop"], coreGenres: ["Pop"] },
  { match: ["rock", "album rock", "modern rock", "pop rock", "roots rock"], coreGenres: ["Rock"] },
  { match: ["country", "country pop", "country rock", "classic country", "traditional country", "bluegrass", "honky tonk", "red dirt"], coreGenres: ["Country"] },
  { match: ["blues", "electric blues", "chicago blues", "delta blues", "modern blues", "country blues", "texas blues", "soul blues"], coreGenres: ["Blues"] },
  { match: ["jazz", "vocal jazz", "cool jazz", "bebop", "hard bop", "big band", "swing music", "jazz fusion", "acid jazz"], coreGenres: ["Jazz"] },
  { match: ["folk", "indie folk", "folk rock", "traditional folk", "contemporary folk", "chamber folk", "acoustic folk"], coreGenres: ["Folk"] },
  { match: ["reggae", "roots reggae", "dancehall", "ska", "rocksteady", "dub", "lovers rock", "reggae fusion", "jamaican"], coreGenres: ["Reggae"] },
  { match: ["latin", "latin pop", "latin rock", "latin dance", "salsa", "bachata", "merengue", "cumbia", "urbano latino", "latin hip hop", "regional mexican", "mariachi", "bossa nova", "samba", "tango"], coreGenres: ["Latin"] },
  { match: ["dance", "edm", "club", "dance pop", "big room", "tropical house", "nu disco"], coreGenres: ["Dance"] },
  { match: ["electronic", "electronica", "idm", "ambient", "downtempo", "glitch", "trip hop", "industrial", "synthwave", "chillwave", "drum and bass", "dubstep"], coreGenres: ["Electronic"] },

  { match: ["classic rock", "album rock", "roots rock", "southern rock", "psychedelic rock", "british invasion", "arena rock"], scenes: ["Classic Rock"] },
  { match: ["yacht rock", "soft rock", "mellow gold", "adult contemporary"], scenes: ["Yacht Rock"] },
  { match: ["hard rock", "active rock", "modern hard rock", "post-grunge", "alternative metal", "heavy rock"], scenes: ["Hard Rock"] },
  { match: ["hair metal", "glam metal", "sleaze rock"], scenes: ["Hair Metal"] },
  { match: ["punk", "punk rock", "hardcore punk", "street punk", "riot grrrl", "pop punk", "skate punk"], scenes: ["Punk"] },
  { match: ["new wave", "new romantic", "synth-pop", "synthpop", "dance rock", "sophisti-pop"], scenes: ["New Wave"] },
  { match: ["alternative rock", "alt rock", "college rock", "post-grunge", "emo", "modern rock"], scenes: ["Alternative Rock"] },
  { match: ["indie rock", "indie pop", "garage rock", "jangle pop", "lo-fi indie"], scenes: ["Indie Rock"] },
  { match: ["grunge", "post-grunge", "seattle sound"], scenes: ["Grunge"] },
  { match: ["progressive rock", "prog rock", "art rock", "symphonic rock"], scenes: ["Progressive Rock"] },
  { match: ["americana", "alt country", "roots rock", "folk rock"], scenes: ["Americana"] },
  { match: ["outlaw country"], scenes: ["Outlaw Country"] },
  { match: ["red dirt", "texas country"], scenes: ["Red Dirt Country"] },
  { match: ["southern soul", "memphis soul", "stax", "gospel soul"], scenes: ["Southern Soul"] },
  { match: ["motown", "classic soul", "northern soul"], scenes: ["Motown"] },
  { match: ["funk", "p-funk", "soul funk", "funk rock", "electro-funk", "funk metal"], scenes: ["Funk"] },
  { match: ["disco", "post-disco", "boogie", "disco funk", "nu disco", "dance-funk"], scenes: ["Disco"] },
  { match: ["reggaeton", "urbano latino", "trap latino"], scenes: ["Reggaeton"], coreGenres: ["Latin"] },
  { match: ["house", "electro house", "progressive house", "deep house", "disco house", "tropical house"], scenes: ["House"], coreGenres: ["Dance"] },
  { match: ["techno", "detroit techno", "minimal techno"], scenes: ["Techno"], coreGenres: ["Electronic", "Dance"] },
  { match: ["trance", "progressive trance", "vocal trance"], scenes: ["Trance"], coreGenres: ["Dance", "Electronic"] },
  { match: ["oldies", "doo-wop", "rock-and-roll", "rockabilly", "brill building pop"], scenes: ["Oldies"] },
  { match: ["afrobeats", "afrobeat", "afropop", "azonto", "amapiano"], scenes: ["Afrobeats"] },

  { match: ["beach", "surf", "surf rock", "island", "tropical", "beach music"], collections: ["Beach Vibes"] },
  { match: ["singer-songwriter", "acoustic singer-songwriter", "indie singer-songwriter", "piano singer-songwriter"], collections: ["Singer-Songwriter"] },
  { match: ["british invasion", "merseybeat"], collections: ["British Invasion"] },
  { match: ["college rock", "alternative rock", "indie rock", "jangle pop"], collections: ["College Radio"] },
  { match: ["broadway", "show tunes", "musical", "original cast recording", "cast recording"], collections: ["Stage & Screen", "Soundtrack"] },
  { match: ["soundtrack", "original soundtrack", "film score", "movie score", "television soundtrack", "game soundtrack", "video game music", "anime soundtrack"], collections: ["Soundtrack"] },
  { match: ["road", "heartland rock", "driving rock", "classic rock", "americana"], collections: ["Road Trip"] },
  { match: ["easy listening", "mellow gold", "soft rock", "quiet storm", "vocal jazz", "adult standards"], collections: ["Sunday Morning"] },
  { match: ["summer", "surf", "beach", "tropical", "island", "yacht rock"], collections: ["Summer Cruisin'"] },
  { match: ["pool party", "dance pop", "disco", "funk", "nu disco", "tropical house"], collections: ["Pool Party"] },
  { match: ["coffeehouse", "acoustic", "acoustic pop", "indie folk", "singer-songwriter"], collections: ["Coffeehouse"] },
  { match: ["acoustic", "acoustic chill", "acoustic pop", "indie folk", "chamber folk"], collections: ["Acoustic Chill"] },
  { match: ["one hit wonder", "novelty", "novelty song"], collections: ["One Hit Wonders"] },

  { match: ["christian", "christian music", "ccm", "worship", "praise and worship", "gospel", "christian rock", "christian pop", "christian hip hop", "christian metal", "christian alternative"], specialInterest: ["Christian"] },
];

function normalizeGenreName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeMatchValue(value) {
  return normalizeGenreName(value).replace(/\band\b/g, "").replace(/\s+/g, " ").trim();
}

function emptyTaxonomy() {
  return {
    coreGenres: [],
    scenes: [],
    collections: [],
    specialInterest: [],
  };
}

function addLabels(target, key, labels = []) {
  for (const label of labels) {
    if (TAXONOMY_LABELS.has(label) && !target[key].includes(label)) {
      target[key].push(label);
    }
  }
}

function matchesGenre(normalizedGenre, needle) {
  const normalizedNeedle = normalizeMatchValue(needle);

  if (!normalizedGenre || !normalizedNeedle) {
    return false;
  }

  return normalizedGenre === normalizedNeedle ||
    ` ${normalizedGenre} `.includes(` ${normalizedNeedle} `);
}

function mapGenreToTaxonomy(genre) {
  const normalizedGenre = normalizeMatchValue(genre);

  if (!normalizedGenre) {
    return emptyTaxonomy();
  }

  const result = emptyTaxonomy();

  for (const mapping of GENRE_MAPPINGS) {
    if (!mapping.match.some((needle) => matchesGenre(normalizedGenre, needle))) {
      continue;
    }

    addLabels(result, "coreGenres", mapping.coreGenres);
    addLabels(result, "scenes", mapping.scenes);
    addLabels(result, "collections", mapping.collections);
    addLabels(result, "specialInterest", mapping.specialInterest);
  }

  return result;
}

function mergeTaxonomy(target, source) {
  addLabels(target, "coreGenres", source?.coreGenres);
  addLabels(target, "scenes", source?.scenes);
  addLabels(target, "collections", source?.collections);
  addLabels(target, "specialInterest", source?.specialInterest);

  return target;
}

function getTrackTaxonomy(input = {}) {
  const genres = Array.isArray(input)
    ? input
    : [
      ...(Array.isArray(input.genres) ? input.genres : []),
      ...(Array.isArray(input.spotifyGenres) ? input.spotifyGenres : []),
      ...(Array.isArray(input.fallbackGenres) ? input.fallbackGenres : []),
    ];
  const result = emptyTaxonomy();

  for (const genre of genres) {
    mergeTaxonomy(result, mapGenreToTaxonomy(genre));
  }

  return result;
}

function incrementCounts(counts, labels = []) {
  for (const label of labels) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }
}

function rankedCounts(counts, limit) {
  const rows = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

  return Number.isInteger(limit) ? rows.slice(0, limit) : rows;
}

function summarizeDiscovery(items = [], options = {}) {
  const limit = Number.isInteger(options.limit) ? options.limit : 10;
  const coreGenreCounts = new Map();
  const sceneCounts = new Map();
  const collectionCounts = new Map();
  const specialInterestCounts = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const taxonomy = item && (
      Array.isArray(item.coreGenres) ||
      Array.isArray(item.scenes) ||
      Array.isArray(item.collections) ||
      Array.isArray(item.specialInterest)
    )
      ? item
      : getTrackTaxonomy(item || {});

    incrementCounts(coreGenreCounts, taxonomy.coreGenres);
    incrementCounts(sceneCounts, taxonomy.scenes);
    incrementCounts(collectionCounts, taxonomy.collections);
    incrementCounts(specialInterestCounts, taxonomy.specialInterest);
  }

  return {
    topGenres: rankedCounts(coreGenreCounts, limit),
    topScenes: rankedCounts(sceneCounts, limit),
    topCollections: rankedCounts(collectionCounts, limit),
    topSpecialInterest: rankedCounts(specialInterestCounts, limit),
  };
}

module.exports = {
  CORE_GENRES,
  SCENES,
  COLLECTIONS,
  SPECIAL_INTEREST,
  normalizeGenreName,
  mapGenreToTaxonomy,
  getTrackTaxonomy,
  summarizeDiscovery,
};
