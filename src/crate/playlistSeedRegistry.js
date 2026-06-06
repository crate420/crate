const PLAYLIST_SEEDS = [
  {
    seed_code: "yacht_rock",
    source_type: "spotify",
    playlist_id: "5mMwgU3jW7Wxxkr5F7GzSj",
    playlist_name: "YACHT ROCK | TOP 100 SONGS",
    owner_id: "myplay.com",
    owner_name: "Filtr US",
    category: "specialty",
    supports_playlist_code: "soft_rock",
    active: true,
    refresh_interval_days: 30,
    track_count: 126,
    follower_count: 204281,
    image_url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da84ee912239e8a440ebd8eee42a",
    quality: "high",
    notes: "Strong yacht rock and smooth soft-rock reference seed; public playlist, not Spotify-owned.",
  },
  {
    seed_code: "disco",
    source_type: "spotify",
    playlist_id: "1Fy5p1KbV1XBE16GKF9jOS",
    playlist_name: "Disco Classics (Top 100)",
    owner_id: "31squddjtl7ycsxqzqfjnxqsbdx4",
    owner_name: "UNCOMMON",
    category: "specialty",
    supports_playlist_code: "funk_disco",
    active: true,
    refresh_interval_days: 30,
    track_count: 92,
    follower_count: 168130,
    image_url: "https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da843948c16f87b079ccc05f270a",
    quality: "high",
    notes: "Compact disco classics seed with high follower count; useful for splitting Disco from broader Funk & Disco.",
  },
  {
    seed_code: "southern_soul",
    source_type: "crate_curated",
    playlist_id: "5Q3wLZoh8pyDIboX6XolLp",
    playlist_name: "The Sound of Southern Soul",
    owner_id: "thesoundsofspotify",
    owner_name: "The Sounds of Spotify",
    category: "specialty",
    supports_playlist_code: "soul",
    active: true,
    refresh_interval_days: 30,
    track_count: 404,
    follower_count: 1465,
    image_url: "https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da847b213fbf20b0a890a48b8de2",
    quality: "medium_high",
    notes: "Useful genre-map style seed for Southern Soul; larger and less editorial than top hits seeds.",
  },
  {
    seed_code: "motown",
    source_type: "spotify",
    playlist_id: "7JJy3JRnYGhJeHQl5XeptL",
    playlist_name: "Motown Greatest Hits",
    owner_id: "x1zjvqmqhjsnb572sc000pt7s",
    owner_name: "Christopher Mclaren",
    category: "specialty",
    supports_playlist_code: "soul",
    active: true,
    refresh_interval_days: 30,
    track_count: 190,
    follower_count: 257047,
    image_url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da8477fa5bc529b9a3116a14143f",
    quality: "high",
    notes: "High-followed Motown hits seed; watch remaster years and compilation release dates.",
  },
  {
    seed_code: "funk",
    source_type: "spotify",
    playlist_id: "01ShyhH6iluuvP0fcMcwWz",
    playlist_name: "Top 100 Funk Songs of All Time",
    owner_id: "31pggae4cpylyapopqm6dbc5vkay",
    owner_name: "Student of Guitar",
    category: "specialty",
    supports_playlist_code: "funk_disco",
    active: true,
    refresh_interval_days: 30,
    track_count: 100,
    follower_count: 14862,
    image_url: "https://mosaic.scdn.co/640/ab67616d00001e0217f9e7e7784ed40b223e261cab67616d00001e029d52169c3b609d4630e04433ab67616d00001e02a14b08b9a6616e121df5e8b0ab67616d00001e02d419ed4f1e89669ce14bd369",
    quality: "medium_high",
    notes: "Direct funk classics reference; useful for distinguishing Funk from Disco.",
  },
  {
    seed_code: "new_wave",
    source_type: "spotify",
    playlist_id: "1ydxatu4wrujF0H2hGU8IR",
    playlist_name: "The Sound of New Wave",
    owner_id: "thesoundsofspotify",
    owner_name: "The Sounds of Spotify",
    category: "specialty",
    supports_playlist_code: "newwave",
    active: true,
    refresh_interval_days: 30,
    track_count: 261,
    follower_count: 4389,
    image_url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da842a3dd4eef868e973d9107f5a",
    quality: "high",
    notes: "Strong New Wave seed with canonical tracks; useful for validating the existing New Wave lane.",
  },
  {
    seed_code: "pop_punk",
    source_type: "spotify",
    playlist_id: "4ASGb9HSoMEUekd7ClxZxZ",
    playlist_name: "Pop Punk Throwback Bangers - 2000s Emo Punk Rock Hits",
    owner_id: "1221028518",
    owner_name: "Ray Fontaine",
    category: "specialty",
    supports_playlist_code: "pop_punk",
    active: true,
    refresh_interval_days: 30,
    track_count: 235,
    follower_count: 80560,
    image_url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000d72cb3d49c3a363031b08727a0de",
    quality: "high",
    notes: "Strong 2000s pop punk and emo-pop seed; supports the new Pop Punk lane.",
  },
  {
    seed_code: "broadway",
    source_type: "spotify",
    playlist_id: "1ad0I6DVtMkehjcZPefbMl",
    playlist_name: "Top 100 Broadway Songs",
    owner_id: "j732000",
    owner_name: "jasutin",
    category: "specialty",
    supports_playlist_code: "soundtrack",
    active: true,
    refresh_interval_days: 30,
    track_count: 100,
    follower_count: 22557,
    image_url: "https://mosaic.scdn.co/640/ab67616d00001e0268b085566bfa0165e44b945bab67616d00001e02d272c37389bd3d9c20564166ab67616d00001e02f3eaae22e1c6b26400073c05ab67616d00001e02fbb690abbb502edd3c70f933",
    quality: "high",
    notes: "Broadway/showtunes seed for future Stage & Screen or Showtunes specialty recommendations.",
  },
  {
    seed_code: "beach_vibes",
    source_type: "user_curated",
    playlist_id: null,
    playlist_name: "Beach Vibes",
    owner_id: null,
    owner_name: "Crate Curated",
    category: "specialty",
    supports_playlist_code: "reggae",
    active: true,
    refresh_interval_days: 90,
    track_count: 150,
    follower_count: 0,
    image_url: null,
    quality: "medium_high",
    notes: "Curated beach, reggae-rock, surf, and coastal pop reference seed imported from CSV.",
  },
  {
    seed_code: "classic_rock",
    source_type: "spotify",
    playlist_id: "1ti3v0lLrJ4KhSTuxt4loZ",
    playlist_name: "Top Classic Rock Hits Of All Time",
    owner_id: "12162444321",
    owner_name: "Tom Schumacher",
    category: "reference",
    supports_playlist_code: "classic_rock",
    active: true,
    refresh_interval_days: 30,
    track_count: 716,
    follower_count: 241514,
    image_url: "https://mosaic.scdn.co/640/ab67616d00001e0223290120a609a65e14cfe018ab67616d00001e0243058ea096fa35ac33c43587ab67616d00001e0249e6168f69625252689c2526ab67616d00001e02ce4f1737bc8a646c8c4bd25a",
    quality: "medium",
    notes: "Broad Classic Rock reference seed; useful but includes some broad/adjacent rock, so use cautiously.",
  },
];

function cloneSeed(seed) {
  return { ...seed };
}

function getActivePlaylistSeeds() {
  return PLAYLIST_SEEDS.filter((seed) => seed.active).map(cloneSeed);
}

function findPlaylistSeedByCode(seedCode) {
  const normalizedCode = String(seedCode || "").trim().toLowerCase();
  const seed = PLAYLIST_SEEDS.find((candidate) => candidate.seed_code === normalizedCode);
  return seed ? cloneSeed(seed) : null;
}

function groupPlaylistSeedsBySupportedPlaylist(seeds = getActivePlaylistSeeds()) {
  return seeds.reduce((groups, seed) => {
    const key = seed.supports_playlist_code || "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(cloneSeed(seed));
    return groups;
  }, {});
}

function summarizePlaylistSeedQuality(seeds = getActivePlaylistSeeds()) {
  return seeds.reduce((summary, seed) => {
    const quality = seed.quality || "unknown";
    summary[quality] = (summary[quality] || 0) + 1;
    return summary;
  }, {});
}

module.exports = {
  PLAYLIST_SEEDS,
  findPlaylistSeedByCode,
  getActivePlaylistSeeds,
  groupPlaylistSeedsBySupportedPlaylist,
  summarizePlaylistSeedQuality,
};
