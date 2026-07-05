const fs = require("node:fs");
const path = require("node:path");
const { openDatabase, closeDatabase } = require("../src/db");

const DEFAULT_INPUT = path.resolve(__dirname, "..", "research", "playlist-intelligence-seed.json");
const PROTECTED_STATUSES = new Set(["approved", "rejected", "ignored"]);

function argFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function cleanText(value) {
  return String(value || "").trim();
}

function readSeed(inputPath) {
  const seed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (seed.schema !== "crate.playlist_intelligence.seed" || seed.version !== 1 || !Array.isArray(seed.collections)) {
    throw new Error("Invalid Playlist Intelligence seed file.");
  }
  return seed;
}

function pickStatus(existingStatus, nextStatus, overwriteStatus) {
  if (!overwriteStatus && PROTECTED_STATUSES.has(existingStatus)) return existingStatus;
  return nextStatus || existingStatus || "candidate";
}

function upsertCollection(db, collection, summary, dryRun) {
  const existing = db.prepare("SELECT * FROM playlist_collection_definitions WHERE collection_code = ?").get(collection.collection_code);
  if (existing) {
    if (!dryRun) {
      db.prepare(`
        UPDATE playlist_collection_definitions
        SET collection_name = @collection_name,
            identity_description = @identity_description,
            research_status = @research_status,
            notes = @notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE collection_code = @collection_code
      `).run(collection);
    }
    summary.collections_updated += 1;
    return existing.id;
  }
  if (!dryRun) {
    const result = db.prepare(`
      INSERT INTO playlist_collection_definitions
        (collection_code, collection_name, identity_description, research_status, notes)
      VALUES
        (@collection_code, @collection_name, @identity_description, @research_status, @notes)
    `).run(collection);
    summary.collections_inserted += 1;
    return result.lastInsertRowid;
  }
  summary.collections_inserted += 1;
  return null;
}

function existingSource(db, collectionId, source) {
  return db.prepare(`
    SELECT *
    FROM playlist_collection_sources
    WHERE collection_id = ? AND lower(playlist_name) = lower(?) AND source_type = ?
  `).get(collectionId, source.playlist_name, source.source_type || "manual");
}

function upsertSource(db, collectionId, source, summary, options) {
  const existing = collectionId ? existingSource(db, collectionId, source) : null;
  const payload = {
    collection_id: collectionId,
    playlist_name: cleanText(source.playlist_name),
    source_type: source.source_type || "manual",
    review_status: pickStatus(existing?.review_status, source.review_status || "candidate", options.overwriteStatus),
    trust_level: source.trust_level || "medium",
    source_name: source.source_name || source.playlist_name || "",
    source_author: source.source_author || "",
    source_url: source.source_url || "",
    spotify_playlist_id: source.spotify_playlist_id || "",
    weight: Number(source.weight || 1),
    include_in_consensus: source.include_in_consensus === 0 ? 0 : 1,
    active: source.active === 0 ? 0 : 1,
    notes: source.notes || "",
  };
  if (existing && existing.review_status === payload.review_status && PROTECTED_STATUSES.has(existing.review_status) && !options.overwriteStatus) {
    summary.protected_status_preserved += 1;
  }
  if (existing) {
    if (!options.dryRun) {
      db.prepare(`
        UPDATE playlist_collection_sources
        SET playlist_name = @playlist_name,
            source_type = @source_type,
            review_status = @review_status,
            trust_level = @trust_level,
            source_name = @source_name,
            source_author = @source_author,
            source_url = @source_url,
            spotify_playlist_id = @spotify_playlist_id,
            weight = @weight,
            include_in_consensus = @include_in_consensus,
            active = @active,
            notes = @notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ ...payload, id: existing.id });
    }
    summary.sources_updated += 1;
    return;
  }
  if (!options.dryRun) {
    db.prepare(`
      INSERT INTO playlist_collection_sources
        (collection_id, playlist_name, source_type, review_status, trust_level, source_name, source_author, source_url, spotify_playlist_id, weight, include_in_consensus, active, notes)
      VALUES
        (@collection_id, @playlist_name, @source_type, @review_status, @trust_level, @source_name, @source_author, @source_url, @spotify_playlist_id, @weight, @include_in_consensus, @active, @notes)
    `).run(payload);
  }
  summary.sources_inserted += 1;
}

function existingArtist(db, collectionId, artist) {
  return db.prepare(`
    SELECT *
    FROM playlist_collection_artists
    WHERE collection_id = ? AND lower(artist_name) = lower(?)
  `).get(collectionId, artist.artist_name);
}

function upsertArtist(db, collectionId, artist, summary, options) {
  const existing = collectionId ? existingArtist(db, collectionId, artist) : null;
  const reviewStatus = pickStatus(existing?.review_status, artist.review_status || "candidate", options.overwriteStatus);
  const payload = {
    collection_id: collectionId,
    artist_name: cleanText(artist.artist_name),
    appearance_count: Number(artist.appearance_count || 0),
    evidence_count: Number(artist.evidence_count || artist.appearance_count || 0),
    source_count: Number(artist.source_count || 0),
    review_status: reviewStatus,
    confidence_score: Number(artist.confidence_score || 0),
    approved: reviewStatus === "approved" ? 1 : 0,
    notes: artist.notes || "",
  };
  if (existing && existing.review_status === payload.review_status && PROTECTED_STATUSES.has(existing.review_status) && !options.overwriteStatus) {
    summary.protected_status_preserved += 1;
  }
  if (existing) {
    if (!options.dryRun) {
      db.prepare(`
        UPDATE playlist_collection_artists
        SET artist_name = @artist_name,
            appearance_count = @appearance_count,
            evidence_count = @evidence_count,
            source_count = @source_count,
            review_status = @review_status,
            confidence_score = @confidence_score,
            approved = @approved,
            notes = @notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ ...payload, id: existing.id });
    }
    summary.artists_updated += 1;
    return;
  }
  if (!options.dryRun) {
    db.prepare(`
      INSERT INTO playlist_collection_artists
        (collection_id, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
      VALUES
        (@collection_id, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
    `).run(payload);
  }
  summary.artists_inserted += 1;
}

function existingTrack(db, collectionId, track) {
  return db.prepare(`
    SELECT *
    FROM playlist_collection_tracks
    WHERE collection_id = ? AND lower(track_name) = lower(?) AND lower(artist_name) = lower(?)
  `).get(collectionId, track.track_name, track.artist_name);
}

function upsertTrack(db, collectionId, track, summary, options) {
  const existing = collectionId ? existingTrack(db, collectionId, track) : null;
  const reviewStatus = pickStatus(existing?.review_status, track.review_status || "candidate", options.overwriteStatus);
  const payload = {
    collection_id: collectionId,
    track_name: cleanText(track.track_name),
    artist_name: cleanText(track.artist_name),
    appearance_count: Number(track.appearance_count || 0),
    evidence_count: Number(track.evidence_count || track.appearance_count || 0),
    source_count: Number(track.source_count || 0),
    review_status: reviewStatus,
    confidence_score: Number(track.confidence_score || 0),
    approved: reviewStatus === "approved" ? 1 : 0,
    notes: track.notes || "",
  };
  if (existing && existing.review_status === payload.review_status && PROTECTED_STATUSES.has(existing.review_status) && !options.overwriteStatus) {
    summary.protected_status_preserved += 1;
  }
  if (existing) {
    if (!options.dryRun) {
      db.prepare(`
        UPDATE playlist_collection_tracks
        SET track_name = @track_name,
            artist_name = @artist_name,
            appearance_count = @appearance_count,
            evidence_count = @evidence_count,
            source_count = @source_count,
            review_status = @review_status,
            confidence_score = @confidence_score,
            approved = @approved,
            notes = @notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ ...payload, id: existing.id });
    }
    summary.tracks_updated += 1;
    return;
  }
  if (!options.dryRun) {
    db.prepare(`
      INSERT INTO playlist_collection_tracks
        (collection_id, track_name, artist_name, appearance_count, evidence_count, source_count, review_status, confidence_score, approved, notes)
      VALUES
        (@collection_id, @track_name, @artist_name, @appearance_count, @evidence_count, @source_count, @review_status, @confidence_score, @approved, @notes)
    `).run(payload);
  }
  summary.tracks_inserted += 1;
}

function applyPlaylistIntelligenceSeed(inputPath = DEFAULT_INPUT, options = {}) {
  const seed = readSeed(inputPath);
  const db = openDatabase();
  const summary = {
    status: "ok",
    input_path: inputPath,
    dry_run: options.dryRun,
    overwrite_status: options.overwriteStatus,
    collections_inserted: 0,
    collections_updated: 0,
    sources_inserted: 0,
    sources_updated: 0,
    artists_inserted: 0,
    artists_updated: 0,
    tracks_inserted: 0,
    tracks_updated: 0,
    protected_status_preserved: 0,
  };

  const apply = db.transaction(() => {
    for (const item of seed.collections) {
      const collectionId = upsertCollection(db, item.collection, summary, options.dryRun);
      const resolvedCollectionId = collectionId || db.prepare("SELECT id FROM playlist_collection_definitions WHERE collection_code = ?").get(item.collection.collection_code)?.id;
      for (const source of item.sources || []) upsertSource(db, resolvedCollectionId, source, summary, options);
      for (const artist of item.artists || []) upsertArtist(db, resolvedCollectionId, artist, summary, options);
      for (const track of item.tracks || []) upsertTrack(db, resolvedCollectionId, track, summary, options);
    }
  });

  apply();
  return summary;
}

try {
  console.log(JSON.stringify(applyPlaylistIntelligenceSeed(path.resolve(argValue("in", DEFAULT_INPUT)), {
    dryRun: argFlag("dry-run"),
    overwriteStatus: argFlag("overwrite-status"),
  }), null, 2));
} catch (err) {
  console.error(JSON.stringify({ status: "error", message: err.message }, null, 2));
  process.exitCode = 1;
} finally {
  closeDatabase();
}

module.exports = { applyPlaylistIntelligenceSeed };
