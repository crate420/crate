const { findPlaylistSeedByCode, getActivePlaylistSeeds } = require("./playlistSeedRegistry");
const { requestSpotify } = require("../spotify/client");
const playlistSeedCacheRepo = require("../repositories/playlistSeedCache");

function createSeedError(message, statusCode = 400, code = "playlist_seed_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseReleaseYear(releaseDate) {
  const year = Number.parseInt(String(releaseDate || "").slice(0, 4), 10);
  return Number.isInteger(year) && year > 0 ? year : null;
}

function getBestImage(images = []) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => {
    const aSize = Number(a?.width || a?.height || 0);
    const bSize = Number(b?.width || b?.height || 0);
    return bSize - aSize;
  });
  return sorted.find((image) => image?.url)?.url || null;
}

function normalizePlaylistMetadata(seed, playlist, fetchedAt, cachedTrackCount) {
  return {
    seed_code: seed.seed_code,
    playlist_id: playlist.id || seed.playlist_id,
    playlist_name: playlist.name || seed.playlist_name,
    owner_id: playlist.owner?.id || seed.owner_id || null,
    owner_name: playlist.owner?.display_name || seed.owner_name || null,
    description: playlist.description || null,
    snapshot_id: playlist.snapshot_id || null,
    follower_count: Number.isInteger(playlist.followers?.total) ? playlist.followers.total : 0,
    image_url: getBestImage(playlist.images) || seed.image_url || null,
    track_count: Number.isInteger(cachedTrackCount) ? cachedTrackCount : 0,
    fetched_at: fetchedAt,
  };
}

function normalizePlaylistTrackItem(item, position, fetchedAt) {
  const track = item?.track;

  if (!track || track.type !== "track" || !track.id) {
    return { skipped: true, reason: "non_track_or_missing_id" };
  }

  const artists = Array.isArray(track.artists) ? track.artists : [];
  const releaseDate = track.album?.release_date || null;

  return {
    skipped: false,
    track: {
      seed_code: null,
      spotify_track_id: track.id,
      spotify_uri: track.uri || null,
      isrc: track.external_ids?.isrc || null,
      track_name: track.name || "Unknown Track",
      artist_names: artists.map((artist) => artist.name).filter(Boolean),
      artist_ids: artists.map((artist) => artist.id).filter(Boolean),
      album_name: track.album?.name || null,
      release_date: releaseDate,
      release_year: parseReleaseYear(releaseDate),
      position,
      fetched_at: fetchedAt,
    },
  };
}

async function fetchPlaylistMetadata(userId, playlistId) {
  const fields = [
    "id",
    "name",
    "description",
    "owner(id,display_name,type,uri)",
    "followers(total)",
    "images(url,height,width)",
    "public",
    "collaborative",
    "snapshot_id",
    "tracks(total,href)",
  ].join(",");

  return requestSpotify(
    userId,
    "/playlists/" + encodeURIComponent(playlistId) + "?fields=" + encodeURIComponent(fields),
  );
}

async function fetchPlaylistTracks(userId, playlistId, fetchedAt) {
  const fields = "items(track(id,type,name,uri,artists(id,name),album(name,release_date),external_ids(isrc))),next,total";
  let nextUrl = "/playlists/" + encodeURIComponent(playlistId) + "/tracks?fields=" + encodeURIComponent(fields) + "&limit=100";
  let position = 0;
  let skippedNonTrack = 0;
  let skippedDuplicate = 0;
  const seenTrackIds = new Set();
  const tracks = [];

  while (nextUrl) {
    const page = await requestSpotify(userId, nextUrl);

    for (const item of page.items || []) {
      position += 1;
      const normalized = normalizePlaylistTrackItem(item, position, fetchedAt);
      if (normalized.skipped) {
        skippedNonTrack += 1;
        continue;
      }

      const track = normalized.track;
      if (seenTrackIds.has(track.spotify_track_id)) {
        skippedDuplicate += 1;
        continue;
      }

      seenTrackIds.add(track.spotify_track_id);
      tracks.push(track);
    }

    nextUrl = page.next;
  }

  return {
    tracks,
    skipped_non_track_count: skippedNonTrack,
    skipped_duplicate_count: skippedDuplicate,
  };
}

async function fetchPlaylistSeed(userId, seedCode) {
  const seed = findPlaylistSeedByCode(seedCode);
  if (!seed || !seed.active) {
    throw createSeedError("Unknown or inactive playlist seed: " + seedCode, 404, "playlist_seed_not_found");
  }
  if (seed.source_type && seed.source_type !== "spotify") {
    throw createSeedError("Playlist seed is not a Spotify-backed seed: " + seedCode, 400, "playlist_seed_not_spotify");
  }
  if (!seed.playlist_id) {
    throw createSeedError("Playlist seed is missing a Spotify playlist ID: " + seedCode, 400, "playlist_seed_missing_playlist_id");
  }

  const fetchedAt = new Date().toISOString();
  console.log("[Playlist Seed Cache] fetch started", {
    seed_code: seed.seed_code,
    playlist_id: seed.playlist_id,
  });

  const playlist = await fetchPlaylistMetadata(userId, seed.playlist_id);
  if (!playlist?.id || playlist.id !== seed.playlist_id) {
    throw createSeedError("Spotify returned an unexpected playlist for this seed.", 502, "playlist_seed_mismatch");
  }

  const trackResult = await fetchPlaylistTracks(userId, seed.playlist_id, fetchedAt);
  const metadata = playlistSeedCacheRepo.upsertSeedMetadata(
    normalizePlaylistMetadata(seed, playlist, fetchedAt, trackResult.tracks.length),
  );
  const replaceResult = playlistSeedCacheRepo.replaceSeedTracks(seed.seed_code, trackResult.tracks, fetchedAt);

  const result = {
    status: "ok",
    seed_code: seed.seed_code,
    playlist_id: seed.playlist_id,
    playlist_name: metadata.playlist_name,
    owner_id: metadata.owner_id,
    owner_name: metadata.owner_name,
    snapshot_id: metadata.snapshot_id,
    fetched_at: fetchedAt,
    playlist_track_count: playlist.tracks?.total || trackResult.tracks.length,
    cached_track_count: replaceResult.replaced,
    skipped_count: trackResult.skipped_non_track_count + trackResult.skipped_duplicate_count,
    skipped_non_track_count: trackResult.skipped_non_track_count,
    skipped_duplicate_count: trackResult.skipped_duplicate_count,
  };

  console.log("[Playlist Seed Cache] fetch completed", result);
  return result;
}

async function fetchAllPlaylistSeeds(userId) {
  const seeds = getActivePlaylistSeeds().filter((seed) => !seed.source_type || seed.source_type === "spotify");
  const summary = {
    status: "ok",
    attempted: seeds.length,
    succeeded: 0,
    failed: 0,
    total_cached_tracks: 0,
    results: [],
    errors: [],
  };

  for (const seed of seeds) {
    try {
      const result = await fetchPlaylistSeed(userId, seed.seed_code);
      summary.succeeded += 1;
      summary.total_cached_tracks += result.cached_track_count || 0;
      summary.results.push(result);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        seed_code: seed.seed_code,
        playlist_id: seed.playlist_id,
        error: err.code || "playlist_seed_fetch_failed",
        message: err.message,
      });
      console.warn("[Playlist Seed Cache] fetch failed", {
        seed_code: seed.seed_code,
        playlist_id: seed.playlist_id,
        message: err.message,
      });
    }
  }

  if (summary.failed > 0) {
    summary.status = summary.succeeded > 0 ? "partial" : "error";
  }

  return summary;
}

module.exports = {
  fetchAllPlaylistSeeds,
  fetchPlaylistSeed,
};
