function definePlaylist(playlistCode, displayName, shortLabel, description, category, sortOrder, icon) {
  return {
    playlistCode,
    displayName,
    shortLabel,
    description,
    category,
    active: true,
    sortOrder,
    icon,
  };
}

const PLAYLIST_DEFINITIONS = [
  definePlaylist("pop", "Crate: Pop", "Pop", "Mainstream pop, melodic crossover, and radio-ready favorites.", "core", 10, "sparkles"),
  definePlaylist("rock", "Crate: Rock", "Rock", "Mainstream modern rock and accessible rock-radio staples.", "core", 20, "guitar"),
  definePlaylist("country", "Crate: Country", "Country", "Country, Americana, bluegrass, and roots-driven favorites.", "core", 30, "music"),
  definePlaylist("hiphop", "Crate: Hip-Hop", "Hip-Hop / Rap", "Hip-hop, rap, trap, and regional rap lanes.", "core", 40, "mic"),
  definePlaylist("rb", "Crate: R&B", "R&B", "Contemporary R&B, neo-soul, and melodic urban crossover.", "core", 50, "heart"),
  definePlaylist("blues", "Crate: Blues", "Blues", "Classic, electric, acoustic, and modern blues.", "core", 60, "music"),
  definePlaylist("jazz", "Crate: Jazz", "Jazz", "Jazz, swing, bebop, vocal jazz, and related traditions.", "core", 70, "music"),
  definePlaylist("folk", "Crate: Folk", "Folk", "Folk, roots, revival, Americana, and acoustic traditions.", "core", 80, "music"),
  definePlaylist("reggae", "Crate: Reggae", "Reggae", "Reggae, roots, ska, dancehall, and island rhythms.", "core", 90, "sun"),
  definePlaylist("latin", "Crate: Latin", "Latin", "Latin pop, reggaeton, salsa, cumbia, and regional traditions.", "core", 100, "music"),
  definePlaylist("dance", "Crate: Dance", "Dance", "EDM, house, club, trance, and dance-floor energy.", "core", 110, "zap"),
  definePlaylist("electronic", "Crate: Electronic", "Electronic", "Electronica, synthwave, experimental electronic, and beat-driven sound.", "core", 120, "radio"),
  definePlaylist("classical", "Crate: Classical", "Classical", "Classical composers, orchestral works, chamber music, and opera.", "core", 130, "music"),
  definePlaylist("classic_rock", "Crate: Classic Rock", "Classic Rock", "Legacy rock, album rock, arena rock, and enduring guitar classics.", "scene", 140, "guitar"),
  definePlaylist("soft_rock", "Crate: Soft Rock & Adult Contemporary", "Soft Rock", "Mellow radio rock, yacht rock, and adult contemporary favorites.", "scene", 150, "waves"),
  definePlaylist("hard_rock", "Crate: Hard Rock", "Hard Rock", "Hard, heavy, active-rock, and arena-ready guitar favorites.", "scene", 160, "zap"),
  definePlaylist("alternative", "Crate: Alternative", "Alternative", "Alternative, indie rock, college rock, grunge, and adjacent scenes.", "scene", 170, "radio"),
  definePlaylist("newwave", "Crate: New Wave", "New Wave", "New wave, synthpop, new romantic, and related 80s scenes.", "scene", 180, "waves"),
  definePlaylist("punk", "Crate: Punk", "Punk", "Punk rock, hardcore, proto-punk, and garage-punk roots.", "scene", 190, "zap"),
  definePlaylist("pop_punk", "Crate: Pop Punk", "Pop Punk", "High-energy punk, pop punk, emo-pop, and melodic punk rock.", "scene", 200, "zap"),
  definePlaylist("metal", "Crate: Metal", "Metal", "Heavy, thrash, progressive, extreme, and folk-metal lanes.", "scene", 210, "zap"),
  definePlaylist("sunshine_pop", "Crate: Sunshine Pop & Baroque Pop", "Sunshine Pop", "Harmony-rich orchestral, chamber, and classic sunshine pop.", "scene", 220, "sun"),
  definePlaylist("funk_disco", "Crate: Funk & Disco", "Funk & Disco", "Funk, disco, boogie, post-disco, and dance-funk.", "scene", 230, "disc"),
  definePlaylist("soul", "Crate: Soul", "Soul", "Classic soul, Motown, Stax, gospel soul, and vintage vocal soul.", "scene", 240, "heart"),
  definePlaylist("singer_songwriter", "Crate: Singer-Songwriter", "Singer-Songwriter", "Intimate, lyrical, piano-led, and acoustic-forward songwriting.", "collection", 250, "mic"),
  definePlaylist("soundtrack", "Crate: Soundtrack", "Soundtrack", "Soundtracks, scores, cast recordings, and stage-and-screen music.", "collection", 260, "film"),
  definePlaylist("seasonal", "Crate: Seasonal", "Seasonal", "Holiday favorites and clearly seasonal songs.", "collection", 270, "calendar"),
  definePlaylist("christian", "Crate: Christian & Gospel", "Christian & Gospel", "Christian, worship, CCM, gospel, and faith-centered music.", "special_interest", 280, "heart"),
];

const ACTIVE_PLAYLIST_DEFINITIONS = PLAYLIST_DEFINITIONS
  .filter((definition) => definition.active)
  .sort((a, b) => a.sortOrder - b.sortOrder);

const PLAYLIST_CODES = new Set(
  ACTIVE_PLAYLIST_DEFINITIONS.map((definition) => definition.playlistCode),
);

module.exports = {
  ACTIVE_PLAYLIST_DEFINITIONS,
  PLAYLIST_CODES,
  PLAYLIST_DEFINITIONS,
};
