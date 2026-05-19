// V2 genre matching: weighted playlist scoring with the original v1 rule buckets.
// Rule order still matters as a tie-breaker so old behavior is preserved when scores are equal.
const SORT_RULES = [
  {
    playlistCode: "seasonal",
    genreIncludes: [
      // Seasonal is also scored as a high-priority thematic override below.
      "christmas",
      "holiday",
    ],
    weakGenreIncludes: [
      "novelty",
      "lounge holiday",
      "christmas jazz",
      "surf christmas",
    ],
  },
  {
    playlistCode: "newwave",
    genreIncludes: [
      "newwave",
      "new wave",
      "synthpop",
      "synth-pop",
      "sophisti-pop",
      "dance rock",
      "new romantic",
      "synthwave",
      // V1 fallback aliases from unmatched Spotify genres.
      "neue deutsche welle",
    ],
    weakGenreIncludes: [
      "post-punk",
      "art pop",
      "electro-pop",
      "electropop",
    ],
    genrePenalties: [
      "post-punk",
      "gothic rock",
      "goth rock",
      "darkwave",
      "industrial",
      "industrial rock",
      "hardcore punk",
      "deathrock",
      "indie pop",
      "indie electronic",
      "dance pop",
      "electronic",
      "edm",
    ],
    eraRange: { from: 1977, to: 1989 },
  },
  {
    playlistCode: "metal",
    genreIncludes: [
      "heavy metal",
      "thrash metal",
      "death metal",
      "black metal",
      "doom metal",
      "groove metal",
      "industrial metal",
      "nu metal",
      "progressive metal",
      "metalcore",
      "power metal",
      "symphonic metal",
      // Keep exact generic metal as a fallback for artists tagged only as metal.
      "metal",
      // V1 fallback alias, narrowed from generic sludge.
      "sludge metal",
    ],
    weakGenreIncludes: [
      "glam metal",
      "hair metal",
      "rap metal",
      "alternative metal",
    ],
    genrePenalties: [
      "classic rock",
      "hard rock",
      "arena rock",
      "blues rock",
      "southern rock",
    ],
  },
  {
    playlistCode: "punk",
    genreIncludes: [
      "punk",
      "punk rock",
      "hardcore punk",
      "anarcho-punk",
      "street punk",
      "horror punk",
      "oi",
      "crust punk",
      "riot grrrl",
    ],
    weakGenreIncludes: ["post-punk"],
    genrePenalties: [
      "pop punk",
      "emo",
      "emo pop",
      "mall emo",
      "neon pop punk",
      "alternative rock",
      "pop rock",
      "skate punk",
    ],
  },
  {
    playlistCode: "alternative",
    genreIncludes: [
      "alternative rock",
      "alt-rock",
      "alt rock",
      "indie rock",
      "college rock",
      "jangle pop",
      "grunge",
      "britpop",
      "madchester",
      "shoegaze",
      // V1 fallback aliases from unmatched Spotify genres.
      "southern gothic",
    ],
    weakGenreIncludes: [
      "post-grunge",
      "post grunge",
      "art rock",
      "garage rock",
      "emo",
      "emo pop",
      "skate punk",
    ],
    phraseBlocks: [
      "alternative hip hop",
      "alternative r&b",
      "alternative rb",
      "christian alternative rock",
    ],
    genrePenalties: [
      "hip hop",
      "rap",
      "alternative hip hop",
      "r&b",
      "rb",
      "alternative r&b",
      "alternative rb",
      "edm",
      "k-pop",
      "k pop",
      "christian",
      "ccm",
      "worship",
      "gospel",
      "christian rock",
      "christian alternative rock",
    ],
  },
  {
    playlistCode: "christian",
    genreIncludes: [
      "christian",
      "christian music",
      "contemporary christian",
      "ccm",
      "worship",
      "praise and worship",
      "gospel",
      "southern gospel",
      "black gospel",
      "christian rock",
      "christian pop",
      "christian hip hop",
      "christian rap",
      "christian metal",
      "christian alternative",
      "gospel soul",
    ],
    genrePenalties: [
      "pop",
      "rock",
      "hip hop",
      "rap",
      "metal",
      "country",
      "soul",
      "rb",
      "r&b",
      "rnb",
    ],
  },
  {
    playlistCode: "reggae",
    genreIncludes: [
      "reggae",
      "roots reggae",
      "dancehall",
      "ska",
      "rocksteady",
      "dub",
      "lovers rock",
      "reggae fusion",
      "caribbean",
      "jamaican",
      "ragga",
    ],
    weakGenreIncludes: [
      "reggaeton",
    ],
    genrePenalties: [
      "r&b",
      "rb",
      "rnb",
      "soul",
      "pop",
      "hip hop",
      "rap",
      "latin",
      "reggaeton",
      "urbano latino",
    ],
  },
  {
    playlistCode: "latin",
    genreIncludes: [
      "latin",
      "latin pop",
      "latin rock",
      "latin dance",
      "salsa",
      "bachata",
      "merengue",
      "cumbia",
      "reggaeton",
      "urbano latino",
      "latin hip hop",
      "latin alternative",
      "regional mexican",
      "banda",
      "norteño",
      "norteno",
      "mariachi",
      "tejano",
      "ranchera",
      "bolero",
      "flamenco",
      "bossa nova",
      "samba",
      "tango",
    ],
    genrePenalties: [
      "pop",
      "dance",
      "hip hop",
      "rap",
      "jazz",
      "rock",
    ],
  },
  {
    playlistCode: "soft_rock",
    genreIncludes: [
      "soft rock",
      "adult contemporary",
      "mellow gold",
      "yacht rock",
      "easy rock",
    ],
    weakGenreIncludes: [
      "album rock",
      "pop rock",
      "singer-songwriter pop",
      "singer songwriter pop",
    ],
    phraseBlocks: [
      "hard rock",
      "classic rock",
      "alternative rock",
      "indie rock",
    ],
    genrePenalties: [
      "hard rock",
      "heavy metal",
      "alternative rock",
      "indie rock",
      "punk",
      "metal",
      "country",
      "country rock",
      "country pop",
      "americana",
      "alt country",
      "bluegrass",
    ],
  },
  {
    playlistCode: "classic_rock",
    genreIncludes: [
      "classic rock",
      "album rock",
      "blues rock",
      "roots rock",
      "southern rock",
      "psychedelic rock",
      "british invasion",
      "glam rock",
      "arena rock",
    ],
    weakGenreIncludes: [
      "folk rock",
      "rock",
    ],
    phraseBlocks: [
      "classical",
      "classical music",
      "soft rock",
      "yacht rock",
      "alternative rock",
      "indie rock",
    ],
    genrePenalties: [
      "soft rock",
      "adult contemporary",
      "mellow gold",
      "yacht rock",
      "post-grunge",
      "post grunge",
      "alternative rock",
      "indie rock",
      "new wave",
    ],
  },
  {
    playlistCode: "hard_rock",
    genreIncludes: [
      "hard rock",
      "alternative metal",
      "glam metal",
      "hair metal",
      "sleaze rock",
      "heavy rock",
      "modern hard rock",
      "active rock",
      "butt rock",
      "arena hard rock",
    ],
    weakGenreIncludes: [
      "post-grunge",
      "post grunge",
      "nu metal",
      "rock",
    ],
    phraseBlocks: [
      "classic rock",
      "soft rock",
      "yacht rock",
      "indie rock",
    ],
    genrePenalties: [
      "thrash metal",
      "death metal",
      "black metal",
      "doom metal",
      "metalcore",
      "power metal",
      "symphonic metal",
      "classic rock",
      "soft rock",
      "yacht rock",
    ],
  },
  {
    playlistCode: "funk_disco",
    genreIncludes: [
      "funk",
      "disco",
      "post-disco",
      "post disco",
      "boogie",
      "electro-funk",
      "electro funk",
      "p-funk",
      "p funk",
      "disco funk",
      "disco-funk",
      "soul funk",
      "dance-funk",
      "dance funk",
      "nu-disco",
      "nu disco",
    ],
    weakGenreIncludes: [
      "funk metal",
      "disco house",
    ],
    phraseBlocks: [
      "funk rock",
      "funk metal",
      "house",
      "electro house",
    ],
    genrePenalties: [
      "edm",
      "house",
      "electro house",
      "progressive house",
      "hard rock",
      "metal",
      "heavy metal",
      "classic soul",
      "neo soul",
      "motown",
    ],
  },
  {
    playlistCode: "soul",
    genreIncludes: [
      "soul",
      "classic soul",
      "vintage soul",
      "motown",
      "stax",
      "memphis soul",
      "philly soul",
      "northern soul",
      "southern soul",
      "retro soul",
      "gospel soul",
      "funk soul",
      "soul funk",
      "soul blues",
      "doo-wop",
    ],
    weakGenreIncludes: [
      "rhythm and blues",
      "smooth soul",
      "pop soul",
      "blue-eyed soul",
      "blue eyed soul",
      "funk",
      "disco-funk",
      "disco funk",
    ],
    phraseBlocks: [
      "contemporary r&b",
      "contemporary rb",
      "contemporary rnb",
      "alternative r&b",
      "alternative rb",
      "alternative rnb",
      "modern r&b",
      "modern rb",
      "urban contemporary",
      "new jack swing",
      "quiet storm",
      "r&b",
      "rb",
      "rnb",
    ],
    genrePenalties: [
      "contemporary r&b",
      "contemporary rb",
      "contemporary rnb",
      "alternative r&b",
      "alternative rb",
      "alternative rnb",
      "modern r&b",
      "modern rb",
      "urban contemporary",
      "new jack swing",
      "quiet storm",
      "r&b",
      "rb",
      "rnb",
      "dance pop",
      "electropop",
      "adult standards",
      "singer-songwriter",
      "singer songwriter",
      "folk",
      "soft rock",
      "yacht rock",
      "jazz vocal",
      "smooth jazz",
      "vocal jazz",
      "hip hop",
      "rap",
      "dance",
      "house",
      "disco",
      "post-disco",
      "post disco",
      "boogie",
      "pop",
      "dancehall",
      "reggae",
      "roots reggae",
    ],
  },
  {
    playlistCode: "rb",
    genreIncludes: [
      "rb",
      "r&b",
      "rnb",
      "contemporary r&b",
      "contemporary rb",
      "contemporary rnb",
      "modern r&b",
      "modern rb",
      "urban contemporary",
      "alternative r&b",
      "alternative rb",
      "alternative rnb",
      "neo soul",
      "quiet storm",
      "new jack swing",
      "smooth r&b",
      "smooth rb",
      "smooth soul",
      "trap soul",
      "pop soul",
    ],
    weakGenreIncludes: [
      "soul",
      "funk",
      "motown",
      "melodic rap",
      "rhythmic pop",
    ],
    phraseBlocks: [
      "pop rap",
      "emo rap",
      "dance pop",
      "electropop",
      "reggae",
      "roots reggae",
      "reggae rock",
      "reggaeton",
      "dancehall",
    ],
    genrePenalties: [
      "pop",
      "dance pop",
      "electropop",
      "pop rap",
      "melodic rap",
      "emo rap",
      "rhythmic pop",
      "k-pop",
      "k pop",
      "edm",
      "electro house",
      "pop punk",
      "reggae",
      "roots reggae",
      "reggae rock",
      "reggaeton",
      "dancehall",
    ],
  },
  {
    playlistCode: "country",
    genreIncludes: [
      "country",
      "classic country",
      "traditional country",
      "honky tonk",
      "outlaw country",
      "acoustic country",
      "alt country",
      "americana",
      "bluegrass",
      "newgrass",
      "red dirt",
      "texas country",
    ],
    weakGenreIncludes: [
      "country pop",
      "pop country",
      "country rap",
      "country hip hop",
      "latin country",
      "country rock",
    ],
    phraseBlocks: [
      "country rock",
      "country blues",
      "country christian",
      "christian country",
      "country hip hop",
      "country rap",
    ],
    genrePenalties: [
      "classic rock",
      "southern rock",
      "blues rock",
      "folk rock",
      "yacht rock",
      "soft rock",
      "psychedelic rock",
      "acid rock",
      "blues",
      "classic blues",
      "modern blues",
      "edm",
      "dance",
      "pop",
      "art pop",
      "electropop",
    ],
  },
  {
    playlistCode: "jazz",
    genreIncludes: [
      "jazz",
      "vocal jazz",
      "cool jazz",
      "bebop",
      "hard bop",
      "modal jazz",
      "big band",
      "swing music",
      "ragtime",
      // Intentionally map brass band into the broader jazz bucket for v1.
      "brass band",
      "new orleans jazz",
      "jazz fusion",
    ],
    weakGenreIncludes: [
      "acid jazz",
      "jazz rap",
      "electro swing",
    ],
    phraseBlocks: [
      "new jack swing",
    ],
    genrePenalties: [
      "new jack swing",
      "r&b",
      "rb",
      "rnb",
      "hip hop",
      "old school hip hop",
      "east coast hip hop",
      "post-disco",
      "post disco",
      "pop",
      "dance",
    ],
  },
  {
    playlistCode: "blues",
    genreIncludes: [
      "blues",
      "chicago blues",
      "delta blues",
      "electric blues",
      "country blues",
      "texas blues",
      "acoustic blues",
      "modern blues",
      "soul blues",
      // Intentionally map zydeco into the broader blues bucket for v1.
      "zydeco",
    ],
    weakGenreIncludes: [
      "blues rock",
      "swamp blues",
      "southern blues",
    ],
    genrePenalties: [
      "classic rock",
      "hard rock",
      "southern rock",
      "glam rock",
      "arena rock",
      "indie rock",
      "alternative rock",
    ],
  },
  {
    playlistCode: "dance",
    genreIncludes: [
      "edm",
      "dance music",
      "house",
      "electro house",
      "progressive house",
      "big room",
      "trance",
      "techno",
      "drum and bass",
      "dubstep",
      "tropical house",
      "club",
      "hi-nrg",
      // V1 fallback aliases from unmatched Spotify genres.
      "freestyle",
      "miami bass",
    ],
    weakGenreIncludes: [
      "dance",
      "dance pop",
      "electropop",
      "nu disco",
      "disco house",
    ],
    phraseBlocks: [
      "synthpop",
      "indie pop",
      "bedroom pop",
      "trap",
      "pop rap",
      "melodic rap",
    ],
    genrePenalties: [
      "electropop",
      "synthpop",
      "indie pop",
      "bedroom pop",
      "trap",
      "pop rap",
      "melodic rap",
    ],
  },
  {
    playlistCode: "electronic",
    genreIncludes: [
      "electronic",
      "electronic music",
      "electronica",
      "idm",
      "glitch",
      "trip hop",
      "techno",
      "experimental electronic",
      "electro",
      "industrial",
      "synthwave",
      // V1 fallback aliases from unmatched Spotify genres.
      "big beat",
      "breakbeat",
    ],
    weakGenreIncludes: [
      "ambient",
      "downtempo",
      "chillwave",
      "electropop",
      "indie electronic",
      "synthpop",
      "nu disco",
    ],
    phraseBlocks: [
      "dance pop",
      "indie pop",
      "bedroom pop",
      "pop rock",
      "alternative rock",
    ],
    genrePenalties: [
      "dance pop",
      "indie pop",
      "bedroom pop",
      "pop rock",
      "alternative rock",
    ],
  },
  {
    playlistCode: "folk",
    genreIncludes: [
      "folk",
      "indie folk",
      "folk rock",
      "traditional folk",
      "folk revival",
      "roots music",
      "americana",
      "alt folk",
      "alt country",
      "bluegrass",
      "acoustic folk",
      "contemporary folk",
      // Intentionally map cajun into the broader folk bucket for v1.
      "cajun",
      // V1 fallback aliases from unmatched Spotify genres.
      "celtic",
      "sea shanties",
      "native american music",
    ],
    weakGenreIncludes: [
      "chamber folk",
      "neo-folk",
      "neo folk",
      "freak folk",
    ],
    phraseBlocks: [
      "acoustic pop",
      "piano pop",
      "adult contemporary",
      "mellow gold",
      "dance pop",
      "electropop",
      "pop rock",
    ],
    genrePenalties: [
      "acoustic pop",
      "piano pop",
      "adult contemporary",
      "mellow gold",
      "dance pop",
      "electropop",
      "pop rock",
    ],
  },
  {
    playlistCode: "singer_songwriter",
    genreIncludes: [
      "singer_songwriter",
      "singer-songwriter",
      "singer songwriter",
      "acoustic singer-songwriter",
      "acoustic singer songwriter",
      "contemporary folk singer-songwriter",
      "contemporary folk singer songwriter",
      "piano singer-songwriter",
      "piano singer songwriter",
      "indie singer-songwriter",
      "indie singer songwriter",
      "adult alternative",
      "lilith",
      "melancholia",
    ],
    phraseBlocks: [
      "soft rock",
      "adult contemporary",
      "mellow gold",
      "yacht rock",
      "country",
      "country rock",
      "country pop",
      "americana",
      "bluegrass",
    ],
    genrePenalties: [
      "soft rock",
      "adult contemporary",
      "mellow gold",
      "yacht rock",
      "country",
      "country rock",
      "country pop",
      "bluegrass",
    ],
  },
  {
    playlistCode: "classical",
    genreIncludes: [
      "classical",
      "classical music",
      "orchestral",
      "symphony",
      "concerto",
      "sonata",
      "chamber music",
      "opera",
      "aria",
      "baroque",
      "romantic",
      "renaissance",
      "choral",
      "choir",
      "classical piano",
      "classical violin",
      "string quartet",
      "composer",
      "piano concerto",
      "violin concerto",
    ],
    genrePenalties: [
      "soundtrack",
      "original soundtrack",
      "film score",
      "movie score",
      "jazz",
      "ambient",
      "electronic",
    ],
  },
  {
    playlistCode: "soundtrack",
    genreIncludes: [
      "soundtrack",
      "original soundtrack",
      "original motion picture soundtrack",
      "film score",
      "movie score",
      "television soundtrack",
      "tv soundtrack",
      "broadway",
      "musical",
      "show tunes",
      "orchestral soundtrack",
      "epic soundtrack",
      "anime soundtrack",
      "game soundtrack",
      "video game music",
      "original cast recording",
    ],
    weakGenreIncludes: [
      "music from and inspired by",
      "from the motion picture",
      "score",
      "cinematic",
      "cinematic orchestral",
      "trailer music",
      "epic music",
    ],
    genrePenalties: [
      "classical",
      "orchestral",
      "jazz",
      "ambient",
      "electronic",
      "synthwave",
      "rock",
      "pop",
      "dance",
    ],
  },
  {
    playlistCode: "pop",
    genreIncludes: ["pop", "dance pop", "indie pop", "art pop", "power pop", "soft pop", "electropop", "bedroom pop", "k-pop", "k pop"],
    phraseBlocks: [
      "pop rock",
      "country pop",
      "pop country",
      "country rap",
      "bro-country",
      "bro country",
      "country rock",
    ],
    genrePenalties: [
      "pop rock",
      "country pop",
      "pop country",
      "country rap",
      "bro-country",
      "bro country",
      "country rock",
    ],
  },
  {
    playlistCode: "hiphop",
    genreIncludes: [
      "hiphop",
      "hip hop",
      "boom bap",
      "east coast hip hop",
      "west coast hip hop",
      "old school hip hop",
      "conscious hip hop",
      "alternative hip hop",
      "hardcore hip hop",
      "dirty south",
      "southern hip hop",
      "trap",
      "drill",
      "rap",
      // Intentionally map New Orleans bounce into hiphop for v1.
      "new orleans bounce",
      // V1 fallback aliases from unmatched Spotify genres.
      "crunk",
    ],
    weakGenreIncludes: [
      "pop rap",
      "melodic rap",
      "trap soul",
      "rhythmic pop",
    ],
    phraseBlocks: [
      "dance pop",
      "electropop",
      "edm",
      "electro house",
      "k-pop",
      "k pop",
    ],
    genrePenalties: [
      "dance pop",
      "electropop",
      "edm",
      "electro house",
      "k-pop",
      "k pop",
    ],
  },
  {
    playlistCode: "rock",
    genreIncludes: [
      "rock",
      "modern rock",
      "mainstream rock",
      "radio rock",
      "post-grunge",
      "post grunge",
      "pop rock",
      "rap rock",
      "surf rock",
      // V1 fallback aliases from unmatched Spotify genres.
      "jam band",
      "aor",
    ],
    weakGenreIncludes: [
      "grunge",
    ],
    phraseBlocks: [
      "alternative rock",
      "indie rock",
      "christian rock",
      "country rock",
      "folk rock",
      "soft rock",
      "yacht rock",
      "art rock",
      "garage rock",
    ],
    genrePenalties: [
      "hard rock",
      "glam metal",
      "hair metal",
      "alternative metal",
      "modern hard rock",
      "active rock",
      "classic rock",
      "album rock",
      "soft rock",
      "adult contemporary",
      "yacht rock",
      "country rock",
      "country pop",
      "bro-country",
      "bro country",
    ],
  },
];

const SCORE_WEIGHTS = {
  primaryGenre: 100,
  secondaryGenre: 40,
  directGenreTag: 25,
  trackModifier: 15,
  eraModifier: 10,
  weakMatch: 5,
  exclusion: -100,
  seasonalTitleTheme: 240,
  seasonalGenreTheme: 180,
  seasonalWeakTheme: 60,
  soundtrackFamilySupport: 140,
  soundtrackWeakSupport: 70,
};

const SEASONAL_OVERRIDE_THRESHOLD = 150;
const SOUNDTRACK_OVERRIDE_THRESHOLD = 140;
const SOUNDTRACK_FAMILY_SUPPORT_POINTS = 140;

const CHRISTIAN_FAMILY_SUPPORT_POINTS = 120;
const LATIN_FAMILY_SUPPORT_POINTS = 80;
const REGGAE_FAMILY_SUPPORT_POINTS = 35;
const CLASSICAL_FAMILY_SUPPORT_POINTS = 90;
const SOFT_ROCK_FAMILY_SUPPORT_POINTS = 80;
const CLASSIC_ROCK_FAMILY_SUPPORT_POINTS = 70;
const HARD_ROCK_FAMILY_SUPPORT_POINTS = 90;
const NEWWAVE_FAMILY_SUPPORT_POINTS = 70;
const FUNK_DISCO_FAMILY_SUPPORT_POINTS = 80;
const REGGAE_CROSSOVER_SUPPRESSION_POINTS = -70;
const CLASSICAL_COLLABORATOR_SUPPRESSION_POINTS = -180;
const NEWWAVE_MODERN_CROSSOVER_SUPPRESSION_POINTS = -90;
const NEWWAVE_CORE_IDENTITY_SIGNALS = [
  "newwave",
  "new wave",
  "new romantic",
  "sophisti-pop",
  "dance rock",
  "neue deutsche welle",
];
const MAINSTREAM_POP_FALLBACK_POINTS = 45;
const MAINSTREAM_POP_FALLBACK_SIGNALS = [
  "pop",
  "pop rock",
  "dance pop",
  "electropop",
  "indie pop",
  "art pop",
  "power pop",
  "soft pop",
  "bedroom pop",
  "k-pop",
  "k pop",
];

const SOUNDTRACK_STRONG_SIGNALS = [
  "original soundtrack",
  "original motion picture soundtrack",
  "film score",
  "movie score",
  "television soundtrack",
  "tv soundtrack",
  "broadway",
  "show tunes",
  "orchestral soundtrack",
  "epic soundtrack",
  "anime soundtrack",
  "game soundtrack",
  "video game music",
  "original cast recording",
  "soundtrack",
  "musical",
];

const SOUNDTRACK_STRONG_TEXT_SIGNALS = [
  "original motion picture soundtrack",
  "motion picture soundtrack",
  "film score",
  "movie score",
  "television soundtrack",
  "tv soundtrack",
  "orchestral soundtrack",
  "epic soundtrack",
  "anime soundtrack",
  "game soundtrack",
  "video game music",
  "original cast recording",
  "original broadway cast recording",
];

const SOUNDTRACK_WEAK_SIGNALS = [
  "music from and inspired by",
  "from the motion picture",
  "soundtrack",
  "cinematic",
  "cinematic orchestral",
  "trailer music",
  "epic music",
  "cast recording",
];

const CHRISTIAN_FAMILY_SIGNALS = [
  "christian",
  "christian music",
  "contemporary christian",
  "ccm",
  "worship",
  "praise and worship",
  "gospel",
  "southern gospel",
  "black gospel",
  "christian rock",
  "christian pop",
  "christian hip hop",
  "christian rap",
  "christian metal",
  "christian alternative",
  "gospel soul",
];

const LATIN_FAMILY_SIGNALS = [
  "latin",
  "latin pop",
  "latin rock",
  "latin dance",
  "salsa",
  "bachata",
  "merengue",
  "cumbia",
  "reggaeton",
  "urbano latino",
  "latin hip hop",
  "latin alternative",
  "regional mexican",
  "banda",
  "norteño",
  "norteno",
  "mariachi",
  "tejano",
  "ranchera",
  "bolero",
  "flamenco",
  "bossa nova",
  "samba",
  "tango",
];

const REGGAE_FAMILY_SIGNALS = [
  "reggae",
  "roots reggae",
  "dancehall",
  "ska",
  "rocksteady",
  "dub",
  "lovers rock",
  "reggae fusion",
  "caribbean",
  "jamaican",
  "ragga",
];

const STRONG_REGGAE_IDENTITY_SIGNALS = [
  "roots reggae",
  "dancehall",
  "ska",
  "rocksteady",
  "dub",
  "lovers rock",
  "reggae fusion",
  "jamaican",
  "ragga",
];

const REGGAE_COMPETING_IDENTITY_SIGNALS = [
  "rock",
  "new wave",
  "newwave",
  "synthpop",
  "pop",
  "soul",
  "r&b",
  "rb",
  "rnb",
  "alternative rock",
  "alternative",
];

const CLASSICAL_FAMILY_SIGNALS = [
  "classical",
  "classical music",
  "orchestral",
  "symphony",
  "concerto",
  "sonata",
  "chamber music",
  "opera",
  "aria",
  "baroque",
  "romantic",
  "renaissance",
  "choral",
  "choir",
  "classical piano",
  "classical violin",
  "string quartet",
  "composer",
  "piano concerto",
  "violin concerto",
];

const CLASSICAL_COMPETING_IDENTITY_SIGNALS = [
  "rock",
  "hard rock",
  "classic rock",
  "pop",
  "metal",
  "glam metal",
  "hair metal",
  "alternative rock",
  "dance",
  "electronic",
  "soundtrack",
  "film score",
  "movie score",
];

const SOFT_ROCK_FAMILY_SIGNALS = [
  "soft rock",
  "adult contemporary",
  "mellow gold",
  "yacht rock",
  "easy rock",
];

const CLASSIC_ROCK_FAMILY_SIGNALS = [
  "classic rock",
  "album rock",
  "blues rock",
  "roots rock",
  "southern rock",
  "folk rock",
  "psychedelic rock",
  "british invasion",
  "glam rock",
  "arena rock",
];

const HARD_ROCK_FAMILY_SIGNALS = [
  "hard rock",
  "alternative metal",
  "glam metal",
  "hair metal",
  "sleaze rock",
  "heavy rock",
  "modern hard rock",
  "active rock",
  "butt rock",
  "arena hard rock",
];

const FUNK_DISCO_FAMILY_SIGNALS = [
  "funk",
  "disco",
  "post-disco",
  "post disco",
  "boogie",
  "electro-funk",
  "electro funk",
  "p-funk",
  "p funk",
  "disco funk",
  "disco-funk",
  "soul funk",
  "dance-funk",
  "dance funk",
  "nu-disco",
  "nu disco",
];

const SOUL_FAMILY_SIGNALS = [
  "soul",
  "classic soul",
  "vintage soul",
  "motown",
  "stax",
  "memphis soul",
  "philly soul",
  "northern soul",
  "southern soul",
  "retro soul",
  "gospel soul",
  "funk soul",
  "soul funk",
  "soul blues",
  "doo-wop",
];

const SOUL_FAMILY_SUPPORT_POINTS = 50;
const RB_FAMILY_SUPPORT_POINTS = 85;
const SINGER_SONGWRITER_FAMILY_SUPPORT_POINTS = 75;
const SINGER_SONGWRITER_FAMILY_SIGNALS = [
  "singer_songwriter",
  "singer-songwriter",
  "singer songwriter",
  "acoustic singer-songwriter",
  "acoustic singer songwriter",
  "contemporary folk singer-songwriter",
  "contemporary folk singer songwriter",
  "piano singer-songwriter",
  "piano singer songwriter",
  "indie singer-songwriter",
  "indie singer songwriter",
  "adult alternative",
  "lilith",
  "melancholia",
];
const CORE_FOLK_IDENTITY_SIGNALS = [
  "folk",
  "indie folk",
  "traditional folk",
  "folk revival",
  "roots music",
  "americana",
  "alt folk",
  "bluegrass",
  "acoustic folk",
  "contemporary folk",
];
const RB_FAMILY_SIGNALS = [
  "r&b",
  "rb",
  "rnb",
  "contemporary r&b",
  "contemporary rb",
  "contemporary rnb",
  "modern r&b",
  "modern rb",
  "urban contemporary",
  "alternative r&b",
  "alternative rb",
  "alternative rnb",
  "neo soul",
  "quiet storm",
  "new jack swing",
  "smooth r&b",
  "smooth rb",
  "trap soul",
];
const GENERIC_RB_SOUL_SUPPORT_BLOCKS = new Set(["r&b", "rb", "rnb"]);

const SEASONAL_STRONG_THEMES = [
  "christmas",
  "xmas",
  "noel",
  "santa claus",
  "sleigh",
  "jingle bells",
  "winter wonderland",
  "silent night",
  "o holy night",
  "have yourself a merry little christmas",
  "all i want for christmas",
  "last christmas",
  "blue christmas",
  "white christmas",
  "feliz navidad",
  "auld lang syne",
  "halloween",
  "spooky",
  "monster mash",
  "ghostbusters",
];

const SEASONAL_WEAK_THEMES = [
  "novelty",
  "lounge holiday",
  "christmas jazz",
  "surf christmas",
];

const TRUE_NEWWAVE_SIGNALS = [
  "newwave",
  "new wave",
  "synthpop",
  "synth-pop",
  "sophisti-pop",
  "dance rock",
  "new romantic",
  "synthwave",
  "neue deutsche welle",
];

const TRACK_MODIFIER_RULES = [
  { playlistCode: "dance", includes: ["remix", "club mix", "dance mix"], reason: "dance track title modifier" },
  { playlistCode: "electronic", includes: ["extended mix"], reason: "electronic track title modifier" },
  { playlistCode: "singer_songwriter", includes: ["acoustic", "stripped", "unplugged"], reason: "singer-songwriter track title modifier" },
];

const ROCK_CLUSTER_RULES = [
  {
    requiresAny: ["post-grunge", "post grunge", "modern rock"],
    requiresAnyAlso: ["rock", "hard rock"],
    points: 165,
    reason: "v1 rock refinement: post-grunge/modern-rock cluster with core rock signal",
  },
];

function normalizeGenreText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactGenreText(value) {
  return normalizeGenreText(value).replace(/[^a-z0-9]+/g, "");
}

function textIncludesGenreNeedle(value, needle) {
  const normalizedValue = normalizeGenreText(value);
  const normalizedNeedle = normalizeGenreText(needle);

  if (!normalizedValue || !normalizedNeedle) {
    return false;
  }

  return (
    normalizedValue.includes(normalizedNeedle) ||
    compactGenreText(normalizedValue).includes(compactGenreText(normalizedNeedle))
  );
}

function phraseBlocksRule(value, rule) {
  const normalizedValue = normalizeGenreText(value);

  return rule.phraseBlocks?.find((phrase) => normalizedValue === normalizeGenreText(phrase)) || null;
}

function textIncludesSeasonalTheme(value, needle) {
  const normalizedValue = normalizeGenreText(value);
  const normalizedNeedle = normalizeGenreText(needle);

  if (normalizedNeedle === "ghost") {
    return normalizedValue.includes("ghostbusters") ||
      normalizedValue.includes("halloween") ||
      normalizedValue.includes("spooky") ||
      normalizedValue.includes("haunted") ||
      normalizedValue.includes("monster") ||
      normalizedValue.includes("witch");
  }

  if (normalizedNeedle === "beach" && normalizedValue.includes("on the beach")) {
    return false;
  }

  if (["america", "usa", "u s a", "santa"].includes(normalizedNeedle)) {
    return normalizedValue === normalizedNeedle ||
      normalizedValue.startsWith(normalizedNeedle + " ") ||
      normalizedValue.endsWith(" " + normalizedNeedle) ||
      normalizedValue.includes(" " + normalizedNeedle + " ");
  }

  return textIncludesGenreNeedle(value, needle);
}

function findMatchingNeedle(value, rule) {
  const normalizedValue = normalizeGenreText(value);

  if (phraseBlocksRule(value, rule)) {
    return null;
  }

  return rule.genreIncludes.find((needle) => {
    const normalizedNeedle = normalizeGenreText(needle);

    // Keep Seasonal genre matching phrase-aware: exact christmas/holiday tags
    // are strong, while crossover tags like christmas jazz stay weak below.
    if (rule.playlistCode === "seasonal" && ["christmas", "holiday"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Alternative phrase-aware: generic grunge should not match post-grunge.
    if (rule.playlistCode === "alternative" && normalizedNeedle === "grunge") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Christian phrase-aware: generic christian/gospel/worship tags should be exact,
    // while explicit christian-rock/gospel-soul style phrases match normally.
    if (rule.playlistCode === "christian" && ["christian", "gospel", "worship"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Reggae phrase-aware: generic reggae/ska/dub should be exact so
    // reggaeton and other crossover words do not become pure Reggae.
    if (rule.playlistCode === "reggae" && ["reggae", "ska", "dub", "caribbean", "jamaican", "ragga"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Latin phrase-aware: generic latin must be exact so latin-pop and
    // reggaeton are explicit Latin signals rather than broad substrings.
    if (rule.playlistCode === "latin" && normalizedNeedle === "latin") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Classical phrase-aware: generic romantic/composer/orchestral terms
    // should be exact so pop/rock/classic-adjacent phrases do not leak in.
    if (rule.playlistCode === "classical" && ["classical", "orchestral", "symphony", "concerto", "sonata", "opera", "aria", "baroque", "romantic", "renaissance", "choral", "choir", "composer"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep the new Rock splits phrase-aware so broad root words do not steal
    // tracks from each other or from Classical/Pop/Soul.
    if (rule.playlistCode === "classic_rock" && normalizedNeedle === "rock") {
      return normalizedValue === normalizedNeedle;
    }

    if (rule.playlistCode === "hard_rock" && normalizedNeedle === "rock") {
      return normalizedValue === normalizedNeedle;
    }

    if (rule.playlistCode === "funk_disco" && ["funk", "disco", "boogie"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Soundtrack phrase-aware: generic score/cinematic/musical words should
    // be exact tags, while stronger soundtrack phrases match normally.
    if (rule.playlistCode === "soundtrack" && ["soundtrack", "score", "cinematic", "musical"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Soul phrase-aware: generic soul/funk/R&B aliases should be exact
    // so pop-soul, trap-soul, jazz vocal, and crossover tags do not over-score Soul.
    if (rule.playlistCode === "soul" && ["soul", "funk", "r&b", "rb", "rnb"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Metal phrase-aware: generic "metal" must be exact so glam/hair/rap
    // and alternative-metal crossovers do not become strong core Metal.
    if (rule.playlistCode === "metal" && normalizedNeedle === "metal") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Punk narrow: generic "punk" and "oi" must be exact tags, not substrings
    // inside pop-punk, post-punk, noise, or other adjacent genres.
    if (rule.playlistCode === "punk" && ["punk", "oi"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep R&B phrase-aware: short generic aliases should match exact tags only,
    // not every crossover phrase that happens to contain r&b/rb/rnb.
    if (rule.playlistCode === "rb" && ["rb", "r&b", "rnb", "soul", "funk"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Country phrase-aware: generic "country" must be exact so country-rock,
    // country-blues, and country-pop crossovers do not become strong Country.
    if (rule.playlistCode === "country" && normalizedNeedle === "country") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Folk phrase-aware: generic "folk" must be exact so acoustic-pop
    // and singer-songwriter crossover tags do not become strong Folk.
    if (rule.playlistCode === "folk" && normalizedNeedle === "folk") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Jazz phrase-aware: generic "jazz" must be exact so jazz-rap
    // stays weak, and generic swing is not matched inside new jack swing.
    if (rule.playlistCode === "jazz" && normalizedNeedle === "jazz") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Blues phrase-aware: generic "blues" must be exact so blues-rock
    // crossovers do not become strong Blues by substring.
    if (rule.playlistCode === "blues" && normalizedNeedle === "blues") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Hip-Hop phrase-aware: generic "rap" must be exact so pop rap,
    // melodic rap, and emo rap do not become strong Hip-Hop by substring.
    if (rule.playlistCode === "hiphop" && normalizedNeedle === "rap") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Dance phrase-aware: generic "dance" and "house" should not be
    // strong matches inside dance-pop/electropop/disco-house crossover tags.
    if (rule.playlistCode === "dance" && ["dance", "house"].includes(normalizedNeedle)) {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Electronic phrase-aware: generic "electro" should not be a strong
    // match inside electropop or electro-house crossover tags.
    if (rule.playlistCode === "electronic" && normalizedNeedle === "electro") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Pop phrase-aware: generic "pop" must be exact so pop-rock and
    // other crossover artist identities do not become mainstream Pop by default.
    if (rule.playlistCode === "pop" && normalizedNeedle === "pop") {
      return normalizedValue === normalizedNeedle;
    }

    // Keep Rock phrase-aware: generic "rock" must be an exact tag, not a
    // substring inside alternative/country/folk/soft/yacht rock crossovers.
    if (rule.playlistCode === "rock" && normalizedNeedle === "rock") {
      return normalizedValue === normalizedNeedle;
    }

    return textIncludesGenreNeedle(value, needle);
  }) || null;
}


function addScore(scores, playlistCode, points, reason) {
  if (!playlistCode || points === 0) {
    return;
  }

  const existing = scores.get(playlistCode) || { playlistCode, score: 0, reasons: [] };
  existing.score += points;
  existing.reasons.push({ points, ...reason });
  scores.set(playlistCode, existing);
}

function findWeakMatchingNeedle(value, rule) {
  if (phraseBlocksRule(value, rule)) {
    return null;
  }

  return rule.weakGenreIncludes?.find((needle) => textIncludesGenreNeedle(value, needle)) || null;
}

function scoreGenreSignal(scores, genre, points, reason) {
  for (const rule of SORT_RULES) {
    const matchedNeedle = findMatchingNeedle(genre, rule);
    const weakMatchedNeedle = !matchedNeedle ? findWeakMatchingNeedle(genre, rule) : null;

    if (matchedNeedle) {
      addScore(scores, rule.playlistCode, points, {
        ...reason,
        genre,
        matched: matchedNeedle,
      });
    } else if (weakMatchedNeedle) {
      addScore(scores, rule.playlistCode, SCORE_WEIGHTS.weakMatch, {
        ...reason,
        genre,
        matched: weakMatchedNeedle,
        weak: true,
      });
    }
  }
}

function scoreSpotifyArtistGenres(context, scores) {
  const artists = context.artists || [];
  const primaryArtistId = artists[0]?.id;

  for (const artist of artists) {
    const genres = artist.genres || [];

    genres.forEach((genre, genreIndex) => {
      const isPrimaryArtistPrimaryGenre = artist.id === primaryArtistId && genreIndex === 0;
      const points = isPrimaryArtistPrimaryGenre
        ? SCORE_WEIGHTS.primaryGenre
        : SCORE_WEIGHTS.secondaryGenre;

      scoreGenreSignal(scores, genre, points, {
        source: isPrimaryArtistPrimaryGenre ? "primary_spotify_artist_genre" : "secondary_spotify_artist_genre",
        artist: artist.name,
      });
    });
  }
}

function scoreFallbackArtistGenres(context, scores) {
  const artistNames = context.artistNames || [];
  const primaryArtistName = artistNames[0];

  for (const artistName of artistNames) {
    const genres = context.fallbackGenresByArtistName?.get(normalizeGenreText(artistName)) || [];

    genres.forEach((genre, genreIndex) => {
      const isPrimaryFallbackGenre = artistName === primaryArtistName && genreIndex === 0;
      const points = isPrimaryFallbackGenre
        ? SCORE_WEIGHTS.primaryGenre
        : SCORE_WEIGHTS.secondaryGenre;

      scoreGenreSignal(scores, genre, points, {
        source: isPrimaryFallbackGenre ? "primary_fallback_artist_genre" : "secondary_fallback_artist_genre",
        artist: artistName,
      });
    });
  }
}

function scoreDirectGenreTags(context, scores) {
  for (const genre of context.genres || []) {
    scoreGenreSignal(scores, genre, SCORE_WEIGHTS.directGenreTag, {
      source: "direct_genre_tag",
    });
  }
}

function scoreTrackModifiers(context, scores) {
  const searchableText = [context.track?.name, context.album?.name].filter(Boolean).join(" ");

  for (const modifier of TRACK_MODIFIER_RULES) {
    const matched = modifier.includes.find((needle) => textIncludesGenreNeedle(searchableText, needle));

    if (matched) {
      addScore(scores, modifier.playlistCode, SCORE_WEIGHTS.trackModifier, {
        source: "track_modifier",
        matched,
        reason: modifier.reason,
      });
    }
  }
}

function scoreSeasonalThemes(context, scores) {
  const titleText = [context.track?.name, context.album?.name].filter(Boolean).join(" ");

  const titleMatches = SEASONAL_STRONG_THEMES.filter((needle) => textIncludesSeasonalTheme(titleText, needle));
  for (const matched of titleMatches) {
    addScore(scores, "seasonal", SCORE_WEIGHTS.seasonalTitleTheme, {
      source: "seasonal_theme_override",
      matched,
      reason: "seasonal title/album theme crossed override threshold " + SEASONAL_OVERRIDE_THRESHOLD,
    });
  }
}

function getReleaseYear(context) {
  const releaseDate = context.album?.releaseDate;
  const year = Number.parseInt(String(releaseDate || "").slice(0, 4), 10);

  return Number.isInteger(year) ? year : null;
}

function hasExactGenre(context, needle) {
  return (context.genres || []).some((genre) => normalizeGenreText(genre) === normalizeGenreText(needle));
}

function hasGenreSignal(context, needle) {
  return (context.genres || []).some((genre) => textIncludesGenreNeedle(genre, needle));
}

function hasAnyGenreSignal(context, needles) {
  return needles.some((needle) => hasGenreSignal(context, needle));
}

function hasStrongReggaeIdentity(context) {
  return hasAnyGenreSignal(context, STRONG_REGGAE_IDENTITY_SIGNALS);
}

function hasReggaeCompetingIdentity(context) {
  return hasAnyGenreSignal(context, REGGAE_COMPETING_IDENTITY_SIGNALS);
}

function getPrimaryArtistFallbackGenres(context) {
  const primaryArtistName = context.artistNames?.[0];

  if (!primaryArtistName) {
    return [];
  }

  return context.fallbackGenresByArtistName?.get(normalizeGenreText(primaryArtistName)) || [];
}

function hasPrimaryClassicalIdentity(context) {
  const classicalRule = SORT_RULES.find((rule) => rule.playlistCode === "classical");
  const primaryArtistGenres = context.artists?.[0]?.genres || [];
  const primaryFallbackGenres = getPrimaryArtistFallbackGenres(context);

  return [...primaryArtistGenres, ...primaryFallbackGenres].some((genre) =>
    findMatchingNeedle(genre, classicalRule),
  );
}

function hasClassicalCompetingIdentity(context) {
  return hasAnyGenreSignal(context, CLASSICAL_COMPETING_IDENTITY_SIGNALS);
}

function applyReggaeCrossoverSuppression(context, scores) {
  if (!scores.has("reggae") || hasStrongReggaeIdentity(context) || !hasReggaeCompetingIdentity(context)) {
    return;
  }

  addScore(scores, "reggae", REGGAE_CROSSOVER_SUPPRESSION_POINTS, {
    source: "genre_cluster_suppression",
    matched: "generic reggae crossover",
    reason: "v1 reggae cleanup: generic reggae signal cannot beat stronger rock/new-wave/pop/soul identity by itself",
  });
}

function applyClassicalCollaboratorSuppression(context, scores) {
  if (!scores.has("classical") || hasPrimaryClassicalIdentity(context) || !hasClassicalCompetingIdentity(context)) {
    return;
  }

  addScore(scores, "classical", CLASSICAL_COLLABORATOR_SUPPRESSION_POINTS, {
    source: "collaborator_suppression",
    matched: "secondary classical/orchestral collaborator",
    reason: "v1 classical cleanup: collaborator-only orchestral tags cannot beat primary artist identity",
  });
}

function hasCoreNewWaveIdentity(context) {
  return hasAnyGenreSignal(context, NEWWAVE_CORE_IDENTITY_SIGNALS);
}

function applyNewWaveModernCrossoverSuppression(context, scores) {
  const releaseYear = getReleaseYear(context);

  if (!scores.has("newwave") || !releaseYear || releaseYear < 1995 || hasCoreNewWaveIdentity(context)) {
    return;
  }

  addScore(scores, "newwave", NEWWAVE_MODERN_CROSSOVER_SUPPRESSION_POINTS, {
    source: "era_suppression",
    releaseYear,
    matched: "modern synth/electronic crossover",
    reason: "v1 new wave refinement: post-1995 synth/electronic crossover needs explicit New Wave identity",
  });
}

function scoreSoundtrackFamilyModifiers(context, scores) {
  const soundtrackRule = SORT_RULES.find((rule) => rule.playlistCode === "soundtrack");
  const titleText = [context.track?.name, context.album?.name].filter(Boolean).join(" ");
  const strongTitleMatch = SOUNDTRACK_STRONG_TEXT_SIGNALS.find((needle) => textIncludesGenreNeedle(titleText, needle));
  const weakTitleMatch = SOUNDTRACK_WEAK_SIGNALS.find((needle) => textIncludesGenreNeedle(titleText, needle));
  const strongGenreMatch = (context.genres || []).find((genre) => findMatchingNeedle(genre, soundtrackRule));
  const weakGenreMatch = (context.genres || []).find((genre) => findWeakMatchingNeedle(genre, soundtrackRule));

  if (strongTitleMatch) {
    addScore(scores, "soundtrack", SOUNDTRACK_FAMILY_SUPPORT_POINTS, {
      source: "soundtrack_family_support",
      matched: strongTitleMatch,
      reason: "v1 soundtrack refinement: strong soundtrack title/album context",
    });
  }

  if (strongGenreMatch && scores.has("soundtrack") && (normalizeGenreText(strongGenreMatch) !== "soundtrack" || strongTitleMatch)) {
    addScore(scores, "soundtrack", SCORE_WEIGHTS.soundtrackFamilySupport, {
      source: "soundtrack_family_support",
      genre: strongGenreMatch,
      matched: strongGenreMatch,
      reason: "v1 soundtrack refinement: strong soundtrack genre/tag context",
    });
  }

  if (!strongTitleMatch && !strongGenreMatch) {
    const matched = weakTitleMatch || weakGenreMatch;

    if (matched) {
      addScore(scores, "soundtrack", SCORE_WEIGHTS.soundtrackWeakSupport, {
        source: "soundtrack_family_support",
        matched,
        weak: true,
        reason: "weak soundtrack support; protected genres still win unless soundtrack context strengthens",
      });
    }
  }
}

function scoreFamilyModifier(context, scores, { playlistCode, signals, points, reason }) {
  const rule = SORT_RULES.find((candidate) => candidate.playlistCode === playlistCode);
  const matched = (context.genres || []).find((genre) => findMatchingNeedle(genre, rule));

  if (matched && scores.has(playlistCode)) {
    addScore(scores, playlistCode, points, {
      source: "genre_cluster_modifier",
      genre: matched,
      matched,
      reason,
    });
  }
}

function scoreNewFamilyModifiers(context, scores) {
  scoreFamilyModifier(context, scores, {
    playlistCode: "christian",
    signals: CHRISTIAN_FAMILY_SIGNALS,
    points: CHRISTIAN_FAMILY_SUPPORT_POINTS,
    reason: "v1 christian refinement: prioritize strong Christian/Gospel identity over style genres",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "reggae",
    signals: REGGAE_FAMILY_SIGNALS,
    points: REGGAE_FAMILY_SUPPORT_POINTS,
    reason: "v1 reggae refinement: prioritize explicit Reggae/Ska/Dancehall identity over Soul/Pop leakage",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "latin",
    signals: LATIN_FAMILY_SIGNALS,
    points: LATIN_FAMILY_SUPPORT_POINTS,
    reason: "v1 latin refinement: prioritize explicit Latin identity over Pop/Dance/Hip-Hop leakage",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "classical",
    signals: CLASSICAL_FAMILY_SIGNALS,
    points: CLASSICAL_FAMILY_SUPPORT_POINTS,
    reason: "v1 classical refinement: prioritize explicit Classical/Orchestral identity unless Soundtrack context dominates",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "soft_rock",
    signals: SOFT_ROCK_FAMILY_SIGNALS,
    points: SOFT_ROCK_FAMILY_SUPPORT_POINTS,
    reason: "v1 soft-rock refinement: route adult-contemporary/yacht/mellow rock away from broad Pop/Rock",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "classic_rock",
    signals: CLASSIC_ROCK_FAMILY_SIGNALS,
    points: CLASSIC_ROCK_FAMILY_SUPPORT_POINTS,
    reason: "v1 classic-rock refinement: split classic/album/blues/southern rock from broad Rock",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "hard_rock",
    signals: HARD_ROCK_FAMILY_SIGNALS,
    points: HARD_ROCK_FAMILY_SUPPORT_POINTS,
    reason: "v1 hard-rock refinement: split hard/post-grunge/glam-metal rock from broad Rock/Metal",
  });
  scoreFamilyModifier(context, scores, {
    playlistCode: "funk_disco",
    signals: FUNK_DISCO_FAMILY_SIGNALS,
    points: FUNK_DISCO_FAMILY_SUPPORT_POINTS,
    reason: "v1 funk-disco refinement: route funk/disco/boogie away from broad Soul/Dance/Pop",
  });
}

function scoreNewWaveFamilyModifier(context, scores) {
  const matched = (context.genres || []).find((genre) =>
    NEWWAVE_CORE_IDENTITY_SIGNALS.some((needle) => textIncludesGenreNeedle(genre, needle)),
  );

  if (matched && scores.has("newwave")) {
    addScore(scores, "newwave", NEWWAVE_FAMILY_SUPPORT_POINTS, {
      source: "genre_cluster_modifier",
      genre: matched,
      matched,
      reason: "v1 new wave refinement: explicit New Wave identity beats generic Rock/Pop fallback ordering",
    });
  }
}

function scoreSoulFamilyModifiers(context, scores) {
  const soulRule = SORT_RULES.find((rule) => rule.playlistCode === "soul");
  const matched = (context.genres || []).find((genre) => findMatchingNeedle(genre, soulRule));

  if (
    matched &&
    scores.has("soul") &&
    !GENERIC_RB_SOUL_SUPPORT_BLOCKS.has(normalizeGenreText(matched))
  ) {
    addScore(scores, "soul", SOUL_FAMILY_SUPPORT_POINTS, {
      source: "genre_cluster_modifier",
      genre: matched,
      matched,
      reason: "v1 soul refinement: boost true Soul/R&B/Funk/Motown signal over generic crossover tags",
    });
  }
}

function hasCoreFolkIdentity(context) {
  return (context.genres || []).some((genre) =>
    CORE_FOLK_IDENTITY_SIGNALS.some((needle) => normalizeGenreText(genre) === normalizeGenreText(needle)),
  );
}

function scoreSingerSongwriterFamilyModifiers(context, scores) {
  const matched = (context.genres || []).find((genre) =>
    SINGER_SONGWRITER_FAMILY_SIGNALS.some((needle) => textIncludesGenreNeedle(genre, needle)),
  );

  if (matched && scores.has("singer_songwriter") && !hasCoreFolkIdentity(context)) {
    addScore(scores, "singer_songwriter", SINGER_SONGWRITER_FAMILY_SUPPORT_POINTS, {
      source: "genre_cluster_modifier",
      genre: matched,
      matched,
      reason: "v1 singer-songwriter refinement: explicit songwriting identity wins when core Folk identity is not primary",
    });
  }
}

function scoreRbFamilyModifiers(context, scores) {
  const matched = (context.genres || []).find((genre) =>
    RB_FAMILY_SIGNALS.some((needle) => textIncludesGenreNeedle(genre, needle)),
  );

  if (matched && scores.has("rb")) {
    addScore(scores, "rb", RB_FAMILY_SUPPORT_POINTS, {
      source: "genre_cluster_modifier",
      genre: matched,
      matched,
      reason: "v1 R&B refinement: explicit modern R&B identity beats generic Pop/Dance crossover tags",
    });
  }
}

function scoreRockClusterModifiers(context, scores) {
  for (const rule of ROCK_CLUSTER_RULES) {
    const hasClusterSignal = rule.requiresAny.some((needle) => hasGenreSignal(context, needle));
    const hasCoreRockSignal = rule.requiresAnyAlso.some((needle) => hasExactGenre(context, needle));
    const hasHardRockIdentity = hasStrongRuleSignal(context, "hard_rock");

    if (hasClusterSignal && hasCoreRockSignal && !hasHardRockIdentity) {
      addScore(scores, "rock", rule.points, {
        source: "genre_cluster_modifier",
        matched: rule.requiresAny.find((needle) => hasGenreSignal(context, needle)),
        reason: rule.reason,
      });
    }
  }
}

function scoreMainstreamPopFallback(context, scores) {
  const matched = (context.genres || []).find((genre) =>
    MAINSTREAM_POP_FALLBACK_SIGNALS.some((needle) => {
      if (normalizeGenreText(needle) === "pop") {
        return normalizeGenreText(genre) === "pop";
      }

      return textIncludesGenreNeedle(genre, needle);
    }),
  );

  if (!matched) {
    return;
  }

  addScore(scores, "pop", MAINSTREAM_POP_FALLBACK_POINTS, {
    source: "mainstream_pop_fallback",
    genre: matched,
    matched,
    reason: "v1 pop fallback: mainstream crossover signal is weak support only; explicit genre identity still wins",
  });
}

function scoreEraModifiers(context, scores) {
  const releaseYear = getReleaseYear(context);

  if (!releaseYear) {
    return;
  }

  for (const rule of SORT_RULES) {
    if (!rule.eraRange || !scores.has(rule.playlistCode)) {
      continue;
    }

    if (releaseYear >= rule.eraRange.from && releaseYear <= rule.eraRange.to) {
      addScore(scores, rule.playlistCode, SCORE_WEIGHTS.eraModifier, {
        source: "era_modifier",
        releaseYear,
      });
    }
  }
}

function getGenrePenaltyReason(rule) {
  if (rule.playlistCode === "christian") {
    return "v1 christian refinement: reduce style-genre crossover weight unless Christian/Gospel identity dominates";
  }

  if (rule.playlistCode === "reggae") {
    return "v1 reggae refinement: reduce Soul/Pop/Hip-Hop/Latin crossover weight unless Reggae identity dominates";
  }

  if (rule.playlistCode === "latin") {
    return "v1 latin refinement: reduce Pop/Dance/Hip-Hop/Jazz/Rock crossover weight unless Latin identity dominates";
  }

  if (rule.playlistCode === "classical") {
    return "v1 classical refinement: reduce Soundtrack/Jazz/Ambient/Electronic crossover weight unless Classical identity dominates";
  }

  if (rule.playlistCode === "soft_rock") {
    return "v1 soft-rock refinement: reduce hard/alternative/metal crossover weight unless Soft Rock identity dominates";
  }

  if (rule.playlistCode === "classic_rock") {
    return "v1 classic-rock refinement: reduce soft/hard/alternative crossover weight unless Classic Rock identity dominates";
  }

  if (rule.playlistCode === "hard_rock") {
    return "v1 hard-rock refinement: reduce extreme-metal/classic/soft crossover weight unless Hard Rock identity dominates";
  }

  if (rule.playlistCode === "funk_disco") {
    return "v1 funk-disco refinement: reduce EDM/rock/metal/soul crossover weight unless Funk/Disco identity dominates";
  }

  if (rule.playlistCode === "newwave") {
    return "v1 new wave refinement: reduce goth/dark/industrial post-punk weight unless New Wave signals dominate";
  }

  if (rule.playlistCode === "metal") {
    return "v1 metal refinement: reduce classic hard-rock/glam crossover weight unless Metal signals dominate";
  }

  if (rule.playlistCode === "punk") {
    return "v1 punk refinement: reduce pop-punk/emo/alt-rock-adjacent weight for core Punk";
  }

  if (rule.playlistCode === "alternative") {
    return "v1 alternative refinement: reduce non-Alternative genre-family weight";
  }

  if (rule.playlistCode === "pop") {
    return "v1 pop refinement: reduce country-family crossover weight when Country is stronger";
  }

  if (rule.playlistCode === "soul") {
    return "v1 soul refinement: reduce modern R&B/pop/rock/folk/jazz/hip-hop/dance crossover weight unless classic Soul-family signals dominate";
  }

  if (rule.playlistCode === "soundtrack") {
    return "v1 soundtrack refinement: reduce protected genre weight unless Soundtrack context dominates";
  }

  if (rule.playlistCode === "rb") {
    return "v1 R&B refinement: reduce pop/dance/reggae crossover weight unless modern R&B signals dominate";
  }

  if (rule.playlistCode === "rock") {
    return "v1 rock refinement: reduce split-bucket and country-family weight for core broad Rock";
  }

  if (rule.playlistCode === "hiphop") {
    return "v1 hip-hop refinement: reduce pop/dance/EDM crossover weight unless Hip-Hop signals dominate";
  }

  if (rule.playlistCode === "dance") {
    return "v1 dance refinement: reduce pop/hip-hop crossover weight unless Dance signals dominate";
  }

  if (rule.playlistCode === "country") {
    return "v1 country refinement: reduce rock/blues/pop/dance crossover weight unless Country signals dominate";
  }

  if (rule.playlistCode === "jazz") {
    return "v1 jazz refinement: reduce New Jack Swing/R&B/Hip-Hop/Pop crossover weight unless Jazz signals dominate";
  }

  if (rule.playlistCode === "blues") {
    return "v1 blues refinement: reduce rock crossover weight unless Blues signals dominate";
  }

  if (rule.playlistCode === "electronic") {
    return "v1 electronic refinement: reduce pop/alternative crossover weight unless Electronic signals dominate";
  }

  if (rule.playlistCode === "folk") {
    return "v1 folk refinement: reduce acoustic-pop/singer-songwriter crossover weight unless Folk signals dominate";
  }

  if (rule.playlistCode === "singer_songwriter") {
    return "v1 singer-songwriter refinement: reduce soft-rock/country/adult-contemporary crossover weight unless songwriting identity dominates";
  }

  return "v1 genre penalty";
}

function getGenrePenaltyWeight(rule) {
  if (["christian", "reggae", "latin", "classical", "soft_rock", "classic_rock", "hard_rock", "funk_disco", "newwave", "metal", "alternative", "pop", "soul", "rb", "hiphop", "dance", "country", "jazz", "blues", "electronic", "folk", "soundtrack"].includes(rule.playlistCode)) {
    return SCORE_WEIGHTS.primaryGenre;
  }

  return SCORE_WEIGHTS.secondaryGenre;
}

function hasStrongRuleSignal(context, playlistCode) {
  const rule = SORT_RULES.find((candidate) => candidate.playlistCode === playlistCode);

  return (context.genres || []).some((genre) => findMatchingNeedle(genre, rule));
}

function hasCountrySignal(context) {
  const countryRule = SORT_RULES.find((rule) => rule.playlistCode === "country");

  return (context.genres || []).some((genre) =>
    findMatchingNeedle(genre, countryRule) || findWeakMatchingNeedle(genre, countryRule),
  );
}

function hasStrongMetalSignal(context) {
  const metalRule = SORT_RULES.find((rule) => rule.playlistCode === "metal");

  return (context.genres || []).some((genre) => findMatchingNeedle(genre, metalRule));
}

function hasTrueNewWaveSignal(context) {
  return (context.genres || []).some((genre) =>
    TRUE_NEWWAVE_SIGNALS.some((needle) => textIncludesGenreNeedle(genre, needle)),
  );
}

function hasStrongSoulSignal(context) {
  const soulRule = SORT_RULES.find((rule) => rule.playlistCode === "soul");

  return (context.genres || []).some((genre) => findMatchingNeedle(genre, soulRule));
}

function hasStrongSoundtrackSignal(context) {
  const soundtrackRule = SORT_RULES.find((rule) => rule.playlistCode === "soundtrack");
  const titleText = [context.track?.name, context.album?.name].filter(Boolean).join(" ");

  return (
    (context.genres || []).some((genre) => findMatchingNeedle(genre, soundtrackRule)) ||
    SOUNDTRACK_STRONG_TEXT_SIGNALS.some((needle) => textIncludesGenreNeedle(titleText, needle))
  );
}

function genrePenaltyMatches(genre, needle, rule, context) {
  const normalizedGenre = normalizeGenreText(genre);
  const normalizedNeedle = normalizeGenreText(needle);

  if (["christian", "reggae", "latin", "classical"].includes(rule.playlistCode) && hasStrongRuleSignal(context, rule.playlistCode)) {
    return false;
  }

  if (rule.playlistCode === "newwave" && hasTrueNewWaveSignal(context)) {
    return false;
  }

  if (rule.playlistCode === "metal" && hasStrongMetalSignal(context)) {
    return false;
  }

  if (rule.playlistCode === "soul" && hasStrongSoulSignal(context)) {
    return false;
  }

  if (rule.playlistCode === "soundtrack" && hasStrongSoundtrackSignal(context)) {
    return false;
  }

  if (
    rule.playlistCode === "country" &&
    ["pop", "dance", "blues"].includes(normalizedNeedle)
  ) {
    if (normalizedNeedle === "pop" && hasCountrySignal(context)) {
      return false;
    }

    return normalizedGenre === normalizedNeedle;
  }

  return textIncludesGenreNeedle(genre, needle);
}

function applyGenrePenalties(context, scores) {
  for (const rule of SORT_RULES) {
    if (!rule.genrePenalties || !scores.has(rule.playlistCode)) {
      continue;
    }

    for (const genre of context.genres || []) {
      const matched = rule.genrePenalties.find((needle) => genrePenaltyMatches(genre, needle, rule, context));

      if (matched) {
        addScore(scores, rule.playlistCode, -getGenrePenaltyWeight(rule), {
          source: "genre_penalty",
          genre,
          matched,
          reason: getGenrePenaltyReason(rule),
        });
      }
    }
  }
}

function applyExclusions(context, scores) {
  for (const rule of SORT_RULES) {
    if (!rule.genreExcludes || !scores.has(rule.playlistCode)) {
      continue;
    }

    for (const genre of context.genres || []) {
      const matched = rule.genreExcludes.find((needle) => textIncludesGenreNeedle(genre, needle));

      if (matched) {
        addScore(scores, rule.playlistCode, SCORE_WEIGHTS.exclusion, {
          source: "exclusion",
          genre,
          matched,
        });
      }
    }
  }
}

function findOldFirstMatchPlaylistCode(context) {
  for (const rule of SORT_RULES) {
    const matchesRule = (context.genres || []).some((genre) => findMatchingNeedle(genre, rule));

    if (matchesRule) {
      return rule.playlistCode;
    }
  }

  return null;
}

function rankScoreEntries(scoreEntries, oldFirstMatchPlaylistCode) {
  const ruleIndexByPlaylistCode = new Map(
    SORT_RULES.map((rule, index) => [rule.playlistCode, index]),
  );

  return scoreEntries.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (a.playlistCode === oldFirstMatchPlaylistCode) {
      return -1;
    }

    if (b.playlistCode === oldFirstMatchPlaylistCode) {
      return 1;
    }

    return ruleIndexByPlaylistCode.get(a.playlistCode) - ruleIndexByPlaylistCode.get(b.playlistCode);
  });
}

function getPhraseBlockedMatches(context) {
  return SORT_RULES.flatMap((rule) =>
    (context.genres || []).flatMap((genre) => {
      const matched = phraseBlocksRule(genre, rule);

      return matched
        ? [{ playlistCode: rule.playlistCode, genre, matched }]
        : [];
    }),
  );
}

function scorePlaylistCode(context) {
  const scores = new Map();

  scoreSpotifyArtistGenres(context, scores);
  scoreFallbackArtistGenres(context, scores);
  scoreDirectGenreTags(context, scores);
  scoreTrackModifiers(context, scores);
  scoreSeasonalThemes(context, scores);
  scoreSoundtrackFamilyModifiers(context, scores);
  scoreNewFamilyModifiers(context, scores);
  scoreNewWaveFamilyModifier(context, scores);
  scoreSoulFamilyModifiers(context, scores);
  scoreSingerSongwriterFamilyModifiers(context, scores);
  scoreRbFamilyModifiers(context, scores);
  scoreRockClusterModifiers(context, scores);
  scoreMainstreamPopFallback(context, scores);
  applyReggaeCrossoverSuppression(context, scores);
  applyClassicalCollaboratorSuppression(context, scores);
  applyNewWaveModernCrossoverSuppression(context, scores);
  scoreEraModifiers(context, scores);
  applyGenrePenalties(context, scores);
  applyExclusions(context, scores);

  const oldFirstMatchPlaylistCode = findOldFirstMatchPlaylistCode(context);
  const phraseBlockedMatches = getPhraseBlockedMatches(context);
  const scoreEntries = [...scores.values()];
  const candidates = rankScoreEntries(
    scoreEntries.filter((entry) =>
      entry.score > 0 &&
      !(entry.playlistCode === "seasonal" && entry.score < SEASONAL_OVERRIDE_THRESHOLD) &&
      !(entry.playlistCode === "soundtrack" && entry.score < SOUNDTRACK_OVERRIDE_THRESHOLD)
    ),
    oldFirstMatchPlaylistCode,
  );
  const suppressedCandidates = scoreEntries.filter((entry) =>
    entry.score <= 0 ||
    (entry.playlistCode === "seasonal" && entry.score > 0 && entry.score < SEASONAL_OVERRIDE_THRESHOLD) ||
    (entry.playlistCode === "soundtrack" && entry.score > 0 && entry.score < SOUNDTRACK_OVERRIDE_THRESHOLD)
  );
  const winner = candidates[0] || null;

  return {
    playlistCode: winner?.playlistCode || null,
    score: winner?.score || 0,
    candidates,
    suppressedCandidates,
    oldFirstMatchPlaylistCode,
    phraseBlockedMatches,
  };
}

function matchPlaylistCode(context) {
  return scorePlaylistCode(context).playlistCode;
}

function formatScoreDebug(context, decision) {
  return {
    track: context.track?.name || null,
    artist: (context.artistNames || []).join(", "),
    winning_playlist: decision.playlistCode,
    winning_score: decision.score,
    winning_reason: decision.candidates[0]?.reasons?.[0]?.reason || decision.candidates[0]?.reasons?.[0]?.matched || null,
    artist_genres_used: {
      spotify: context.spotifyGenres || [],
      local_fallback: context.fallbackGenres || [],
    },
    track_audio_signals_used: [],
    top_candidate_scores: decision.candidates.slice(0, 3).map((candidate) => ({
      playlist_code: candidate.playlistCode,
      score: candidate.score,
      main_reason: candidate.reasons?.[0]?.reason || candidate.reasons?.[0]?.matched || null,
    })),
    old_first_match_playlist: decision.oldFirstMatchPlaylistCode,
    candidate_scores: decision.candidates.map((candidate) => ({
      playlist_code: candidate.playlistCode,
      score: candidate.score,
      reasons: candidate.reasons,
    })),
    suppressed_scores: (decision.suppressedCandidates || []).map((candidate) => ({
      playlist_code: candidate.playlistCode,
      score: candidate.score,
      reasons: candidate.reasons,
    })),
    phrase_blocked_matches: decision.phraseBlockedMatches || [],
  };
}

function maybeLogScoreDebug(context, decision) {
  if (process.env.CRATE_SORT_DEBUG !== "1") {
    return;
  }

  console.log("Crate sort score", JSON.stringify(formatScoreDebug(context, decision)));
}

const SOUNDTRACK_ALBUM_INDICATORS = [
  "original motion picture soundtrack",
  "motion picture soundtrack",
  "film score",
  "movie score",
  "television soundtrack",
  "tv soundtrack",
  "orchestral soundtrack",
  "epic soundtrack",
  "anime soundtrack",
  "game soundtrack",
  "video game music",
  "original cast recording",
  "original broadway cast recording",
  "music from and inspired by",
  "from the motion picture",
];

function normalizeAlbumTitle(albumTitle) {
  return String(albumTitle || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchAlbumPlaylistCode({ album }) {
  const normalizedAlbumTitle = normalizeAlbumTitle(album?.name);

  if (!normalizedAlbumTitle) {
    return null;
  }

  const matchesSoundtrack = SOUNDTRACK_ALBUM_INDICATORS.some((indicator) =>
    normalizedAlbumTitle.includes(normalizeAlbumTitle(indicator)),
  );

  return matchesSoundtrack ? "soundtrack" : null;
}

module.exports = {
  SCORE_WEIGHTS,
  SORT_RULES,
  formatScoreDebug,
  getReleaseYear,
  matchAlbumPlaylistCode,
  matchPlaylistCode,
  maybeLogScoreDebug,
  normalizeAlbumTitle,
  normalizeGenreText,
  scorePlaylistCode,
};
