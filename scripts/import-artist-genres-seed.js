const { importArtistGenreSeed } = require("../src/crate/artistGenreSeedImport");

try {
  const result = importArtistGenreSeed({
    seedPath: process.env.ARTIST_GENRES_SEED_PATH,
  });

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
