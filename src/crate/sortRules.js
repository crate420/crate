// V1 genre matching: simple Spotify artist genre keyword buckets.
// This is intentionally first-match-wins for now; no scoring or tie-breaking yet.
const SORT_RULES = [
  {
    playlistCode: "seasonal",
    genreIncludes: [
      // Intentionally route holiday-specific genres to a seasonal playlist.
      "christmas",
      "holiday",
    ],
  },
  {
    playlistCode: "newwave",
    genreIncludes: [
      "newwave",
      "new wave",
      "new romantic",
      "synthpop",
      "post-punk",
      // V1 fallback aliases from unmatched Spotify genres.
      "neue deutsche welle",
    ],
  },
  {
    playlistCode: "metal",
    genreIncludes: ["metal", "doom", "black metal", "death metal", "thrash", "sludge"],
  },
  {
    playlistCode: "punk",
    genreIncludes: ["punk", "hardcore", "ska punk", "emo"],
  },
  {
    playlistCode: "alternative",
    genreIncludes: [
      "alternative",
      "alt-rock",
      "indie rock",
      "shoegaze",
      "britpop",
      "garage rock",
      // V1 fallback aliases from unmatched Spotify genres.
      "indie",
      "madchester",
      "riot grrrl",
      "southern gothic",
    ],
  },
  {
    playlistCode: "soul",
    genreIncludes: [
      "soul",
      "motown",
      "funk",
      "neo soul",
      // V1 fallback aliases from unmatched Spotify genres.
      "doo-wop",
    ],
  },
  {
    playlistCode: "rb",
    genreIncludes: [
      "rb",
      "r&b",
      "rnb",
      "contemporary r&b",
      "quiet storm",
      // V1 fallback aliases from unmatched Spotify genres.
      "reggae",
      "nz reggae",
    ],
  },
  {
    playlistCode: "country",
    genreIncludes: ["country", "americana", "bluegrass", "honky tonk", "red dirt"],
  },
  {
    playlistCode: "jazz",
    genreIncludes: [
      "jazz",
      "bebop",
      "swing",
      "vocal jazz",
      "cool jazz",
      "fusion",
      // Intentionally map brass band into the broader jazz bucket for v1.
      "brass band",
    ],
  },
  {
    playlistCode: "blues",
    genreIncludes: [
      "blues",
      "delta blues",
      "electric blues",
      "blues rock",
      // Intentionally map zydeco into the broader blues bucket for v1.
      "zydeco",
    ],
  },
  {
    playlistCode: "dance",
    genreIncludes: [
      "dance",
      "disco",
      "house",
      "club",
      "hi-nrg",
      // V1 fallback aliases from unmatched Spotify genres.
      "freestyle",
      "miami bass",
    ],
  },
  {
    playlistCode: "electronic",
    genreIncludes: [
      "electronic",
      "electronica",
      "techno",
      "ambient",
      "edm",
      "idm",
      "downtempo",
      // V1 fallback aliases from unmatched Spotify genres.
      "big beat",
      "breakbeat",
    ],
  },
  {
    playlistCode: "folk",
    genreIncludes: [
      "folk",
      "roots",
      "traditional",
      // Intentionally map cajun into the broader folk bucket for v1.
      "cajun",
      // V1 fallback aliases from unmatched Spotify genres.
      "celtic",
      "sea shanties",
      "native american music",
    ],
  },
  {
    playlistCode: "singer_songwriter",
    genreIncludes: ["singer_songwriter", "singer-songwriter", "lilith", "melancholia"],
  },
  {
    playlistCode: "soundtrack",
    genreIncludes: ["soundtrack", "score", "movie tunes", "broadway", "show tunes", "musical"],
  },
  {
    playlistCode: "pop",
    genreIncludes: ["pop", "dance pop", "indie pop", "art pop", "power pop", "soft pop"],
  },
  {
    playlistCode: "hiphop",
    genreIncludes: [
      "hiphop",
      "hip hop",
      "rap",
      "trap",
      "drill",
      // Intentionally map New Orleans bounce into hiphop for v1.
      "new orleans bounce",
      // V1 fallback aliases from unmatched Spotify genres.
      "crunk",
    ],
  },
  {
    playlistCode: "rock",
    genreIncludes: [
      "rock",
      "grunge",
      "classic rock",
      "hard rock",
      "soft rock",
      // V1 fallback aliases from unmatched Spotify genres.
      "jam band",
      "aor",
    ],
  },
];

function matchPlaylistCode({ genres }) {
  const normalizedGenres = genres.map((genre) => genre.toLowerCase());

  for (const rule of SORT_RULES) {
    const matchesRule = normalizedGenres.some((genre) =>
      rule.genreIncludes.some((needle) => genre.includes(needle)),
    );

    if (matchesRule) {
      return rule.playlistCode;
    }
  }

  return null;
}

const SOUNDTRACK_ALBUM_INDICATORS = [
  "original motion picture soundtrack",
  "soundtrack",
  "score",
  "music from and inspired by",
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
  SORT_RULES,
  matchAlbumPlaylistCode,
  matchPlaylistCode,
  normalizeAlbumTitle,
};
