const artistIntelligenceRepo = require("../repositories/artistIntelligence");
const musicbrainzClient = require("../musicbrainz/client");

const ARTIST_INTELLIGENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeSignal(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueSignals(values) {
  return [...new Set(values.map(normalizeSignal).filter(Boolean))];
}

function normalizeMusicBrainzSignals(artist) {
  return uniqueSignals([
    artist.type ? `type:${artist.type}` : null,
    artist.country ? `country:${artist.country}` : null,
    artist.disambiguation ? `disambiguation:${artist.disambiguation}` : null,
    ...(artist.tags || []).slice(0, 20).map((tag) => `tag:${tag.name}`),
    ...(artist.aliases || []).slice(0, 10).map((alias) => `alias:${alias.name}`),
  ]);
}

function findBestMusicBrainzArtist(artistName, artists) {
  const normalizedArtistName = normalizeSignal(artistName);

  return artists.find((artist) => normalizeSignal(artist.name) === normalizedArtistName)
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

async function fetchAndCacheMusicBrainzArtistIntelligence({ artistName, artistIntelligenceId } = {}) {
  const artistIntelligence = resolveArtistIntelligence({ artistName, artistIntelligenceId });
  const lookupName = String(artistName || artistIntelligence.display_artist_name || "").trim();
  const rawPayload = await musicbrainzClient.searchArtist(lookupName);
  const matchedArtist = findBestMusicBrainzArtist(lookupName, rawPayload.artists || []);

  if (!matchedArtist) {
    const error = new Error("No MusicBrainz artist match found.");
    error.code = "musicbrainz_artist_not_found";
    error.statusCode = 404;
    throw error;
  }

  const fetchedAt = new Date();
  const source = artistIntelligenceRepo.upsertArtistIntelligenceSource({
    artistIntelligenceId: artistIntelligence.id,
    source: "musicbrainz",
    sourceArtistId: matchedArtist.id,
    sourceArtistName: matchedArtist.name,
    rawPayload,
    normalizedSignals: normalizeMusicBrainzSignals(matchedArtist),
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + ARTIST_INTELLIGENCE_TTL_MS).toISOString(),
  });
  const refreshedArtist = artistIntelligenceRepo.getArtistIntelligenceById(artistIntelligence.id);

  return {
    artist_intelligence_id: refreshedArtist.id,
    artist_name: refreshedArtist.display_artist_name,
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
  fetchAndCacheMusicBrainzArtistIntelligence,
  findBestMusicBrainzArtist,
  normalizeMusicBrainzSignals,
};
