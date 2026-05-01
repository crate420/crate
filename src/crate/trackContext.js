const { normalizeArtistName } = require("../repositories/artistGenres");

function parseRawTrack(rawJson) {
  if (!rawJson) {
    return null;
  }

  try {
    return JSON.parse(rawJson);
  } catch (err) {
    return null;
  }
}

function getArtistIds(track) {
  return (track?.artists || [])
    .map((artist) => artist.id)
    .filter(Boolean);
}

function getArtistNames(row, rawTrack) {
  if (rawTrack?.artists?.length) {
    return rawTrack.artists.map((artist) => artist.name).filter(Boolean);
  }

  try {
    return JSON.parse(row.artist_names || "[]");
  } catch (err) {
    return [];
  }
}

function getReleaseDate(rawTrack) {
  return rawTrack?.album?.release_date || null;
}

function getGenresForTrack(
  rawTrack,
  artistsById,
  fallbackGenresByArtistName = new Map(),
  fallbackArtistNames = [],
) {
  const { spotifyGenres, fallbackGenres } = getGenreSignalsForTrack(
    rawTrack,
    artistsById,
    fallbackGenresByArtistName,
    fallbackArtistNames,
  );

  return [...new Set([...spotifyGenres, ...fallbackGenres])];
}

function getGenreSignalsForTrack(
  rawTrack,
  artistsById,
  fallbackGenresByArtistName = new Map(),
  fallbackArtistNames = [],
) {
  const artistIds = getArtistIds(rawTrack);
  const artists = artistIds.map((artistId) => artistsById.get(artistId)).filter(Boolean);
  const artistNames = rawTrack?.artists?.length
    ? rawTrack.artists.map((artist) => artist.name).filter(Boolean)
    : fallbackArtistNames;
  const fallbackGenres = artistNames.flatMap(
    (artistName) => fallbackGenresByArtistName.get(normalizeArtistName(artistName)) || [],
  );
  const spotifyGenres = artists.flatMap((artist) => artist.genres || []);

  return {
    spotifyGenres: [...new Set(spotifyGenres)],
    fallbackGenres: [...new Set(fallbackGenres)],
  };
}

function getTrackContext(row, artistsById, fallbackGenresByArtistName = new Map()) {
  const rawTrack = parseRawTrack(row.raw_json);
  const artistIds = getArtistIds(rawTrack);
  const artists = artistIds.map((artistId) => artistsById.get(artistId)).filter(Boolean);
  const artistNames = getArtistNames(row, rawTrack);
  const genres = getGenresForTrack(
    rawTrack,
    artistsById,
    fallbackGenresByArtistName,
    artistNames,
  );
  const { spotifyGenres, fallbackGenres } = getGenreSignalsForTrack(
    rawTrack,
    artistsById,
    fallbackGenresByArtistName,
    artistNames,
  );

  return {
    track: {
      id: row.track_id,
      spotifyTrackId: row.spotify_track_id,
      name: row.name,
      uri: row.uri,
      popularity: row.popularity,
      explicit: Boolean(row.explicit),
    },
    album: {
      name: row.album_name,
      releaseDate: getReleaseDate(rawTrack),
    },
    artists,
    artistNames,
    genres,
    spotifyGenres,
    fallbackGenres,
  };
}

module.exports = {
  getArtistIds,
  getArtistNames,
  getGenresForTrack,
  getGenreSignalsForTrack,
  getReleaseDate,
  getTrackContext,
  parseRawTrack,
};
