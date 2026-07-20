const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = path.join(os.tmpdir(), `crate-pi-test-${process.pid}.sqlite`);
process.env.SESSION_SECRET = "playlist-intelligence-test-secret-000000";

const { closeDatabase, openDatabase } = require("../src/db");
const { applyMigrations } = require("../src/db/migrate");
const {
  addArtistToCollection,
  addTrackToCollection,
  applyPlaylistIntelligenceCsvImport,
  createPlaylistIntelligenceCollection,
  previewPlaylistIntelligenceCsvImport,
  updateArtist,
  updateTrack,
} = require("../src/crate/playlistIntelligence");
const { listArtistIntelligenceRecommendations } = require("../src/crate/artistIntelligenceRecommendations");

applyMigrations();

function uniqueCode(prefix) {
  return `${prefix}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
}

function createCollection(prefix = "pi_test") {
  const collectionCode = uniqueCode(prefix);
  createPlaylistIntelligenceCollection({
    collection_code: collectionCode,
    collection_name: collectionCode.replace(/_/g, " "),
    identity_description: "Test collection",
    research_status: "active",
  });
  return collectionCode;
}

test.after(() => {
  closeDatabase();
});

test("CSV artist parsing preserves comma names instead of splitting them", () => {
  const collectionCode = createCollection("comma_artist");
  const preview = previewPlaylistIntelligenceCsvImport(collectionCode, {
    files: [{
      name: "comma-name.csv",
      content: "artist,track_name\n\"Tyler, The Creator\",EARFQUAKE\n",
    }],
  });

  assert.equal(preview.artists, 1);
  assert.equal(preview.sample_artists[0].artist_name, "Tyler, The Creator");
});

test("preview matches existing Crate artist identities by Spotify artist ID", () => {
  const db = openDatabase();
  const collectionCode = createCollection("spotify_artist_match");
  db.prepare(`
    INSERT INTO artist_intelligence (normalized_artist_name, display_artist_name, spotify_artist_id)
    VALUES ('existing artist', 'Existing Artist', 'spotify-artist-1')
  `).run();

  const preview = previewPlaylistIntelligenceCsvImport(collectionCode, {
    files: [{
      name: "same-artist-id.csv",
      content: "artist,spotify_artist_id,track_name\nAlias Name,spotify-artist-1,Test Song\n",
    }],
  });

  assert.equal(preview.existing_artists, 1);
  assert.equal(preview.new_artists, 0);
});

test("duplicate upload detection blocks the same playlist content under a new filename", () => {
  const collectionCode = createCollection("duplicate_upload");
  const content = "artist,track_name\nSlowdive,Alison\n";

  const first = applyPlaylistIntelligenceCsvImport(collectionCode, {
    files: [{ name: "shoegaze-source.csv", content }],
  });
  assert.equal(first.source_playlists_inserted, 1);

  assert.throws(
    () => applyPlaylistIntelligenceCsvImport(collectionCode, {
      files: [{ name: "renamed-source.csv", content }],
    }),
    /Duplicate upload/,
  );
});

test("approving Playlist Intelligence artist evidence updates production artist intelligence", () => {
  const collectionCode = createCollection("artist_bridge");
  const artist = addArtistToCollection(collectionCode, {
    artist_name: "Yoke Lore",
    spotify_artist_id: "spotify-yoke-lore",
    review_status: "candidate",
    confidence_score: 82,
  });

  const updated = updateArtist(artist.id, {
    review_status: "approved",
    confidence_score: 92,
    adminUser: { id: 7 },
  });

  assert.equal(updated.production_intelligence.learned, true);
  const source = openDatabase().prepare(`
    SELECT sources.*
    FROM artist_intelligence_sources sources
    INNER JOIN artist_intelligence artists ON artists.id = sources.artist_intelligence_id
    WHERE artists.spotify_artist_id = 'spotify-yoke-lore'
      AND sources.source = ?
  `).get(`playlist_intelligence:${collectionCode}`);
  assert.ok(source);
});

test("approving Playlist Intelligence track evidence updates production track intelligence", () => {
  const collectionCode = createCollection("track_bridge");
  const track = addTrackToCollection(collectionCode, {
    track_name: "Alison",
    artist_name: "Slowdive",
    spotify_track_id: "spotify-track-alison",
    isrc: "US1234567890",
    review_status: "candidate",
    confidence_score: 85,
  });

  const updated = updateTrack(track.id, {
    review_status: "approved",
    confidence_score: 91,
    adminUser: { id: 7 },
  });

  assert.equal(updated.production_intelligence.learned, true);
  const source = openDatabase().prepare(`
    SELECT sources.*
    FROM track_intelligence_sources sources
    INNER JOIN track_intelligence tracks ON tracks.id = sources.track_intelligence_id
    WHERE tracks.spotify_track_id = 'spotify-track-alison'
      AND sources.source = ?
  `).get(`playlist_intelligence:${collectionCode}`);
  assert.ok(source);
});

test("candidate Playlist Intelligence evidence appears in recommendations before approval", () => {
  const db = openDatabase();
  db.prepare(`
    INSERT INTO artist_intelligence (normalized_artist_name, display_artist_name, confidence_score)
    VALUES ('clairo', 'Clairo', 60)
  `).run();
  addArtistToCollection("bedroom_pop", {
    artist_name: "Clairo",
    review_status: "candidate",
    confidence_score: 90,
    source_count: 5,
    evidence_count: 43,
  });
  addTrackToCollection("bedroom_pop", {
    track_name: "Bags",
    artist_name: "Clairo",
    review_status: "candidate",
    confidence_score: 90,
    evidence_count: 12,
  });

  const recommendations = listArtistIntelligenceRecommendations({ confidenceMin: 85, limit: 25 });
  const clairo = recommendations.find((row) => row.artist.artist_name === "Clairo");
  assert.ok(clairo);
  const bedroomPop = clairo.recommendations.find((row) => row.genre === "bedroom pop");
  assert.ok(bedroomPop);
  assert.equal(bedroomPop.playlist_intelligence_collections[0].collection_name, "Bedroom Pop");
  assert.equal(bedroomPop.playlist_intelligence_consensus_count, 5);
  assert.equal(bedroomPop.playlist_intelligence_supporting_tracks, 1);
  assert.ok(bedroomPop.confidence_score >= 85);
});

test("scene Playlist Intelligence collections do not create primary genre recommendations", () => {
  const db = openDatabase();
  const artists = [
    { name: "Busta Rhymes", normalized: "busta rhymes", approvedGenre: "hip hop" },
    { name: "Bobby Brown", normalized: "bobby brown", approvedGenre: "r&b" },
    { name: "3rd Bass", normalized: "3rd bass", approvedGenre: "hip hop" },
  ];

  for (const artist of artists) {
    db.prepare(`
      INSERT INTO artist_intelligence (normalized_artist_name, display_artist_name, confidence_score)
      VALUES (?, ?, 60)
    `).run(artist.normalized, artist.name);
    db.prepare(`
      INSERT OR IGNORE INTO artist_genres (artist_name, genre, source)
      VALUES (?, ?, 'test')
    `).run(artist.name, artist.approvedGenre);
    addArtistToCollection("college_radio", {
      artist_name: artist.name,
      review_status: "candidate",
      confidence_score: 95,
      source_count: 8,
      evidence_count: 24,
    });
  }

  const recommendations = listArtistIntelligenceRecommendations({ confidenceMin: 85, limit: 50 });
  for (const artist of artists) {
    const row = recommendations.find((candidate) => candidate.artist.artist_name === artist.name);
    assert.ok(!row?.recommendations.some((recommendation) => recommendation.genre === "college rock"));
  }
});

test("a single genre Playlist Intelligence collection does not override approved artist genres", () => {
  const db = openDatabase();
  const artists = [
    { name: "Busta Rhymes", normalized: "busta rhymes single pi", approvedGenre: "hip hop" },
    { name: "Bobby Brown", normalized: "bobby brown single pi", approvedGenre: "r&b" },
    { name: "3rd Bass", normalized: "3rd bass single pi", approvedGenre: "hip hop" },
  ];

  for (const artist of artists) {
    db.prepare(`
      INSERT INTO artist_intelligence (normalized_artist_name, display_artist_name, confidence_score)
      VALUES (?, ?, 60)
    `).run(artist.normalized, artist.name);
    db.prepare(`
      INSERT OR IGNORE INTO artist_genres (artist_name, genre, source)
      VALUES (?, ?, 'test')
    `).run(artist.name, artist.approvedGenre);
    addArtistToCollection("indie_pop", {
      artist_name: artist.name,
      review_status: "candidate",
      confidence_score: 95,
      source_count: 8,
      evidence_count: 24,
    });
  }

  const recommendations = listArtistIntelligenceRecommendations({ confidenceMin: 85, limit: 50 });
  for (const artist of artists) {
    const row = recommendations.find((candidate) => candidate.artist.artist_name === artist.name);
    assert.ok(!row?.recommendations.some((recommendation) => recommendation.genre === "indie pop"));
  }
});
