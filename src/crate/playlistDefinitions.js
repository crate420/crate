const PLAYLIST_DEFINITIONS = [
  { playlistCode: "alternative", displayName: "Crate: Alternative" },
  { playlistCode: "blues", displayName: "Crate: Blues" },
  { playlistCode: "christian", displayName: "Crate: Christian & Gospel" },
  { playlistCode: "classical", displayName: "Crate: Classical" },
  { playlistCode: "classic_rock", displayName: "Crate: Classic Rock" },
  { playlistCode: "country", displayName: "Crate: Country" },
  { playlistCode: "dance", displayName: "Crate: Dance" },
  { playlistCode: "electronic", displayName: "Crate: Electronic" },
  { playlistCode: "folk", displayName: "Crate: Folk" },
  { playlistCode: "funk_disco", displayName: "Crate: Funk & Disco" },
  { playlistCode: "hard_rock", displayName: "Crate: Hard Rock" },
  { playlistCode: "hiphop", displayName: "Crate: Hip-Hop" },
  { playlistCode: "jazz", displayName: "Crate: Jazz" },
  { playlistCode: "latin", displayName: "Crate: Latin" },
  { playlistCode: "metal", displayName: "Crate: Metal" },
  { playlistCode: "newwave", displayName: "Crate: New Wave" },
  { playlistCode: "pop", displayName: "Crate: Pop" },
  { playlistCode: "punk", displayName: "Crate: Punk" },
  { playlistCode: "rb", displayName: "Crate: R&B" },
  { playlistCode: "reggae", displayName: "Crate: Reggae" },
  { playlistCode: "rock", displayName: "Crate: Rock" },
  { playlistCode: "seasonal", displayName: "Crate: Seasonal" },
  { playlistCode: "singer_songwriter", displayName: "Crate: Singer-Songwriter" },
  { playlistCode: "soft_rock", displayName: "Crate: Soft Rock & Adult Contemporary" },
  { playlistCode: "soul", displayName: "Crate: Soul" },
  { playlistCode: "soundtrack", displayName: "Crate: Soundtrack" },
];

const PLAYLIST_CODES = new Set(
  PLAYLIST_DEFINITIONS.map((definition) => definition.playlistCode),
);

module.exports = {
  PLAYLIST_CODES,
  PLAYLIST_DEFINITIONS,
};
