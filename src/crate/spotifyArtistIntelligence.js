const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const spotifyArtists = require("../spotify/artists");

const ARTIST_INTELLIGENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueSignals(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeSpotifySignals(artist) {
  return uniqueSignals([
    ...(artist.genres || []).map((genre) => `genre:${normalizeText(genre)}`),
    Number.isInteger(artist.popularity) ? `popularity:${artist.popularity}` : null,
    Number.isInteger(artist.followers?.total) ? `followers_total:${artist.followers.total}` : null,
    artist.id ? `spotify_artist_id:${artist.id}` : null,
    artist.name ? `artist_name:${artist.name}` : null,
  ]);
}

function findBestSpotifyArtist(artistName, artists) {
  const normalizedArtistName = normalizeText(artistName);

  return artists.find((artist) => normalizeText(artist.name) === normalizedArtistName)
    || artists[0]
    || null;
}

function resolveArtistIntelligence({ artistName, artistIntelligenceId }) {
  if (artistIntelligenceId) {
    const existing = artistIntelligenceRepo.getArtistIntelligenceById(artistIntelligenceId);

    if (!existing) {
      const error = new Error("Artist intelligence record not found.");
      error.code = "artist_intelligence_not_found";
      error.statusCode = 404;
      throw error;
    }

    return existing;
  }

  return artistIntelligenceRepo.getOrCreateArtistIntelligence({ artistName });
}

async function loadSpotifyArtist(userId, artistIntelligence, artistName) {
  if (artistIntelligence.spotify_artist_id) {
    return spotifyArtists.getArtistById(userId, artistIntelligence.spotify_artist_id);
  }

  const searchResult = await spotifyArtists.searchArtists(userId, artistName);
  const matchedArtist = findBestSpotifyArtist(artistName, searchResult.artists?.items || []);

  if (!matchedArtist) {
    const error = new Error("No Spotify artist match found.");
    error.code = "spotify_artist_not_found";
    error.statusCode = 404;
    throw error;
  }

  return spotifyArtists.getArtistById(userId, matchedArtist.id);
}

async function fetchAndCacheSpotifyArtistIntelligence(userId, { artistName, artistIntelligenceId } = {}) {
  const artistIntelligence = resolveArtistIntelligence({ artistName, artistIntelligenceId });
  const lookupName = String(artistName || artistIntelligence.display_artist_name || "").trim();
  const spotifyArtist = await loadSpotifyArtist(userId, artistIntelligence, lookupName);
  const refreshedIntelligence = artistIntelligenceRepo.getOrCreateArtistIntelligence({
    artistName: artistIntelligence.display_artist_name,
    spotifyArtistId: spotifyArtist.id,
  });
  const fetchedAt = new Date();
  const source = artistIntelligenceRepo.upsertArtistIntelligenceSource({
    artistIntelligenceId: refreshedIntelligence.id,
    source: "spotify",
    sourceArtistId: spotifyArtist.id,
    sourceArtistName: spotifyArtist.name,
    rawPayload: spotifyArtist,
    normalizedSignals: normalizeSpotifySignals(spotifyArtist),
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + ARTIST_INTELLIGENCE_TTL_MS).toISOString(),
  });
  const refreshedArtist = artistIntelligenceRepo.getArtistIntelligenceById(refreshedIntelligence.id);

  return {
    artist_intelligence_id: refreshedArtist.id,
    artist_name: refreshedArtist.display_artist_name,
    spotify_artist_id: refreshedArtist.spotify_artist_id,
    source: source.source,
    source_artist_id: source.source_artist_id,
    source_artist_name: source.source_artist_name,
    normalized_signals: JSON.parse(source.normalized_signals_json || "[]"),
    fetched_at: source.fetched_at,
    expires_at: source.expires_at,
    source_count: refreshedArtist.source_count,
    confidence_score: refreshedArtist.confidence_score,
  };
}

module.exports = {
  fetchAndCacheSpotifyArtistIntelligence,
  findBestSpotifyArtist,
  normalizeSpotifySignals,
};
