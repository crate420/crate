const config = require("../config");
const Database = require("better-sqlite3");

const CANONICAL_COLUMNS = [
  "spotify_track_id", "track_name", "artist_name", "spotify_artist_id", "album",
  "release_date", "release_year", "spotify_uri", "isrc", "popularity", "explicit",
  "duration_ms", "approved_genre_category", "additional_genre_category_intelligence",
  "artist_level_genres", "artist_level_evidence", "artist_level_playlist_evidence",
  "library_assigned_category", "manual_override_category",
  "era", "classification_sort_status", "intelligence_source_evidence", "approval_status",
  "first_seen_date", "last_updated_date", "user_occurrence_count", "source_tables",
  "source_record_count", "additional_metadata_json",
];

const KNOWN_RELATED_TABLES = new Set([
  "artist_genres", "artist_intelligence", "artist_intelligence_sources",
  "genre_recommendation_approvals", "lastfm_artist_tags",
  "playlist_collection_definitions", "playlist_collection_sources",
  "playlist_collection_artists",
]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value);
}

function first(row, names) {
  for (const name of names) {
    if (row[name] !== null && row[name] !== undefined && text(row[name])) return row[name];
  }
  return "";
}

function normalized(value) {
  return text(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalSpotifyTrackId(value) {
  const raw = text(value);
  const uri = raw.match(/spotify:track:([^?/#]+)/i);
  if (uri) return uri[1];
  const url = raw.match(/open\.spotify\.com\/track\/([^?/#]+)/i);
  return url ? url[1] : raw;
}

function jsonValue(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function stringList(value) {
  const parsed = jsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => typeof item === "object" ? (item.name || item.id || JSON.stringify(item)) : item).filter(Boolean);
  }
  return text(value) ? [text(value)] : [];
}

function inspectSchema(db) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'
    ORDER BY name
  `).all().map((row) => row.name);

  return tables.map((name) => ({
    name,
    columns: db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().map((column) => column.name),
  }));
}

function isRelevantTable(table) {
  const columns = new Set(table.columns);
  return KNOWN_RELATED_TABLES.has(table.name)
    || table.name === "tracks"
    || table.name === "user_tracks"
    || columns.has("spotify_track_id")
    || columns.has("track_name")
    || columns.has("track_id")
    || columns.has("track_intelligence_id");
}

function readRelevantTables(db) {
  return inspectSchema(db).filter(isRelevantTable).map((table) => ({
    ...table,
    rows: db.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`).all(),
  }));
}

function candidateFromRow(tableName, row) {
  const spotifyTrackId = canonicalSpotifyTrackId(first(row, ["spotify_track_id", "spotify_uri", "uri"]));
  const trackName = text(first(row, ["track_name", ...(tableName === "tracks" ? ["name"] : [])]));
  const artistValues = stringList(first(row, ["artist_names_json", "artist_names"]));
  const artistName = text(first(row, ["artist_name", "source_artist_name"])) || artistValues.join("; ");
  if (!spotifyTrackId && !trackName) return null;

  const raw = jsonValue(row.raw_json);
  const albumObject = raw && typeof raw.album === "object" ? raw.album : null;
  const artists = albumObject && Array.isArray(raw.artists) ? raw.artists : [];
  const artistIds = stringList(first(row, ["artist_ids_json"]));
  return {
    spotify_track_id: spotifyTrackId,
    track_name: trackName,
    artist_name: artistName || artists.map((artist) => artist.name).filter(Boolean).join("; "),
    spotify_artist_id: text(first(row, ["spotify_artist_id"])) || artistIds.join("; ") || artists.map((artist) => artist.id).filter(Boolean).join("; "),
    album: text(first(row, ["album_name", "album"])) || text(albumObject?.name),
    release_date: text(first(row, ["release_date"])) || text(albumObject?.release_date),
    release_year: text(first(row, ["release_year", "effective_release_year", "original_release_year"])),
    spotify_uri: text(first(row, ["spotify_uri", "uri"])),
    isrc: text(first(row, ["isrc"])) || text(raw?.external_ids?.isrc),
    popularity: text(first(row, ["popularity"])),
    explicit: text(first(row, ["explicit"])),
    duration_ms: text(first(row, ["duration_ms"])),
  };
}

function makeRecoveredTrack(candidate) {
  const values = {};
  for (const column of CANONICAL_COLUMNS) values[column] = new Set();
  return { values, metadata: {}, internalTrackIds: new Set(), intelligenceIds: new Set(), userIds: new Set() };
}

function addValue(track, field, value) {
  if (!track.values[field]) return;
  if (Array.isArray(value)) value.forEach((item) => addValue(track, field, item));
  else if (text(value)) track.values[field].add(text(value));
}

function addCandidate(track, table, row, candidate, sourceLabel) {
  for (const [field, value] of Object.entries(candidate)) addValue(track, field, value);
  addValue(track, "source_tables", `${sourceLabel}.${table.name}`);
  addValue(track, "source_record_count", `${table.name}:${row.id ?? row.track_id ?? row.spotify_track_id ?? "row"}`);
  if (table.name === "tracks" && row.id != null) track.internalTrackIds.add(String(row.id));
  if (table.name === "track_intelligence" && row.id != null) track.intelligenceIds.add(String(row.id));
}

function metadataKey(candidate) {
  return [candidate.artist_name, candidate.track_name, candidate.album].map(normalized).join("|");
}

function shorterMetadataKey(candidate) {
  return [candidate.artist_name, candidate.track_name].map(normalized).join("|");
}

function setMetadata(track, tableName, row) {
  const excluded = new Set([
    "raw_json", "raw_payload_json", "user_id", "admin_user_id", "admin_spotify_user_id",
    "spotify_user_id", "email", "access_token", "refresh_token", "token_expires_at", "token_scope",
    "liked_at", "first_seen_at", "last_seen_at",
  ]);
  if (tableName === "user_tracks") return;
  const useful = Object.fromEntries(Object.entries(row).filter(([key, value]) =>
    value !== null && value !== "" && !excluded.has(key) && !CANONICAL_COLUMNS.includes(key)));
  if (Object.keys(useful).length) {
    if (!track.metadata[tableName]) track.metadata[tableName] = [];
    track.metadata[tableName].push(useful);
  }
}

function buildRecoveryFromDb(db, databasePath, sourceLabel) {
  const tables = readRelevantTables(db);
  const recovered = [];
  const bySpotifyId = new Map();
  const byMetadata = new Map();
  const rowCandidates = [];

  for (const table of tables) {
    for (const row of table.rows) {
      const candidate = candidateFromRow(table.name, row);
      if (!candidate) continue;
      const spotifyKey = text(candidate.spotify_track_id);
      const fullKey = metadataKey(candidate);
      const shortKey = shorterMetadataKey(candidate);
      let track = spotifyKey
        ? bySpotifyId.get(spotifyKey)
        : (byMetadata.get(fullKey) || byMetadata.get(shortKey));
      if (!track) {
        track = makeRecoveredTrack(candidate);
        recovered.push(track);
      }
      addCandidate(track, table, row, candidate, sourceLabel);
      setMetadata(track, table.name, row);
      rowCandidates.push({ table, row, candidate, track });
      if (spotifyKey) bySpotifyId.set(spotifyKey, track);
      if (fullKey !== "||") byMetadata.set(fullKey, track);
      if (shortKey !== "|") byMetadata.set(shortKey, track);
    }
  }

  const byTrackId = new Map();
  const byIntelligenceId = new Map();
  for (const track of recovered) {
    for (const id of track.internalTrackIds) byTrackId.set(id, track);
    for (const id of track.intelligenceIds) byIntelligenceId.set(id, track);
  }

  const collectionDefinitions = new Map();
  try {
    for (const row of db.prepare("SELECT * FROM playlist_collection_definitions").all()) collectionDefinitions.set(String(row.id), row);
  } catch {}

  let collectionSources = [];
  try { collectionSources = db.prepare("SELECT * FROM playlist_collection_sources").all(); } catch {}

  for (const { table, row, track } of rowCandidates) {
    if (table.name !== "playlist_collection_tracks") continue;
    const collection = collectionDefinitions.get(String(row.collection_id));
    if (collection) {
      addValue(track, "additional_genre_category_intelligence", `${collection.collection_code}:${collection.collection_name}`);
      if (Number(row.approved) === 1 || row.review_status === "approved") {
        addValue(track, "approval_status", "playlist_intelligence_approved");
      } else {
        addValue(track, "approval_status", row.review_status);
      }
      addValue(track, "intelligence_source_evidence", collectionSources
        .filter((source) => String(source.collection_id) === String(row.collection_id))
        .map((source) => [source.source_type, source.source_name || source.playlist_name, source.source_url].filter(Boolean).join(":")));
    }
  }

  function enrich(track, tableName, row) {
    addValue(track, "source_tables", `${sourceLabel}.${tableName}`);
    setMetadata(track, tableName, row);
    if (tableName === "user_tracks") {
      addValue(track, "approved_genre_category", row.playlist_code);
      addValue(track, "library_assigned_category", row.playlist_code);
      addValue(track, "classification_sort_status", row.playlist_code ? `sorted:${row.playlist_code}` : "unmatched");
      addValue(track, "first_seen_date", first(row, ["liked_at", "first_seen_at"]));
      addValue(track, "last_updated_date", row.last_seen_at);
      if (row.user_id !== null && row.user_id !== undefined) track.userIds.add(String(row.user_id));
    } else if (tableName === "track_overrides") {
      addValue(track, "approved_genre_category", row.override_playlist_code);
      addValue(track, "manual_override_category", row.override_playlist_code);
      addValue(track, "classification_sort_status", `manual_override:${row.override_playlist_code}`);
      addValue(track, "approval_status", "manual_override");
      addValue(track, "last_updated_date", first(row, ["updated_at", "created_at"]));
    } else if (tableName === "track_era_overrides") {
      addValue(track, "release_year", first(row, ["effective_release_year", "original_release_year", "spotify_release_year"]));
      addValue(track, "era", row.effective_release_year ? `${Math.floor(Number(row.effective_release_year) / 10) * 10}s` : "");
      addValue(track, "intelligence_source_evidence", [row.source, row.reason, row.confidence].filter(Boolean).join(":"));
    } else if (tableName === "track_learning_profiles") {
      addValue(track, "classification_sort_status", [row.current_playlist_code, row.top_candidate_playlist_code].filter(Boolean));
      addValue(track, "intelligence_source_evidence", first(row, ["evidence_summary_json", "derived_profile_json"]));
      addValue(track, "last_updated_date", first(row, ["updated_at", "generated_at"]));
    } else if (tableName === "track_intelligence_sources") {
      addValue(track, "intelligence_source_evidence", [row.source, row.normalized_signals_json, row.metadata_json].filter(Boolean).join(":"));
      addValue(track, "last_updated_date", first(row, ["updated_at", "fetched_at"]));
    }
  }

  for (const table of tables) {
    for (const row of table.rows) {
      const track = (row.track_id != null && byTrackId.get(String(row.track_id)))
        || (row.track_intelligence_id != null && byIntelligenceId.get(String(row.track_intelligence_id)));
      if (track) enrich(track, table.name, row);
    }
  }

  // Artist-level approved genres and evidence are useful for every matching recovered track.
  const artistInfo = new Map();
  function infoFor(name) {
    const key = normalized(name);
    if (!key) return null;
    if (!artistInfo.has(key)) artistInfo.set(key, { genres: new Set(), ids: new Set(), evidence: new Set(), playlistEvidence: new Set(), approvals: new Set() });
    return artistInfo.get(key);
  }
  try {
    for (const row of db.prepare("SELECT * FROM artist_genres").all()) {
      const info = infoFor(row.artist_name); if (!info) continue;
      info.genres.add(text(row.genre)); info.evidence.add(`artist_genres:${text(row.source)}`);
    }
  } catch {}
  try {
    for (const row of db.prepare("SELECT * FROM genre_recommendation_approvals").all()) {
      const info = infoFor(row.artist_name); if (!info) continue;
      info.genres.add(text(row.approved_genre)); info.evidence.add(`genre_recommendation:${text(row.evidence_json)}`);
    }
  } catch {}
  try {
    for (const row of db.prepare("SELECT * FROM artist_intelligence").all()) {
      const info = infoFor(row.display_artist_name); if (!info) continue;
      info.ids.add(text(row.spotify_artist_id));
      info.evidence.add(`artist_review_status:${text(row.review_status)};confidence:${text(row.confidence_score)}`);
    }
  } catch {}
  try {
    const intelligenceById = new Map(db.prepare("SELECT * FROM artist_intelligence").all().map((row) => [String(row.id), row]));
    for (const row of db.prepare("SELECT * FROM artist_intelligence_sources").all()) {
      const artist = intelligenceById.get(String(row.artist_intelligence_id));
      const info = infoFor(artist?.display_artist_name); if (!info) continue;
      info.evidence.add(`artist_intelligence:${[row.source, row.normalized_signals_json].filter(Boolean).join(":")}`);
    }
  } catch {}
  try {
    const collections = new Map(db.prepare("SELECT id, collection_code, collection_name FROM playlist_collection_definitions").all().map((row) => [String(row.id), row]));
    for (const row of db.prepare("SELECT * FROM playlist_collection_artists").all()) {
      const info = infoFor(row.artist_name);
      const collection = collections.get(String(row.collection_id));
      if (!info || !collection) continue;
      info.playlistEvidence.add(`${collection.collection_code}:${collection.collection_name};status:${row.review_status || (Number(row.approved) ? "approved" : "candidate")};confidence:${row.confidence_score ?? ""};sources:${row.source_count ?? ""};evidence:${row.evidence_count ?? ""}`);
      info.evidence.add(`playlist_collection_artist:${collection.collection_code}`);
    }
  } catch {}

  for (const track of recovered) {
    const artistNames = [...track.values.artist_name].flatMap((value) => value.split(";")).map((value) => value.trim());
    for (const artistName of artistNames) {
      const info = artistInfo.get(normalized(artistName));
      if (!info) continue;
      addValue(track, "artist_level_genres", [...info.genres]);
      addValue(track, "spotify_artist_id", [...info.ids]);
      addValue(track, "artist_level_evidence", [...info.evidence]);
      addValue(track, "artist_level_playlist_evidence", [...info.playlistEvidence]);
      if (info.playlistEvidence.size) addValue(track, "source_tables", `${sourceLabel}.playlist_collection_artists`);
    }
    const date = [...track.values.release_date][0];
    if (!track.values.release_year.size && /^\d{4}/.test(date || "")) addValue(track, "release_year", date.slice(0, 4));
    if (!track.values.era.size && track.values.release_year.size) {
      const year = Number([...track.values.release_year][0]);
      if (Number.isFinite(year)) addValue(track, "era", `${Math.floor(year / 10) * 10}s`);
    }
  }

  const rows = recovered.map((track) => {
    const output = {};
    for (const column of CANONICAL_COLUMNS) {
      if (column === "source_record_count") output[column] = track.values[column].size;
      else if (column === "user_occurrence_count") output[column] = track.userIds.size;
      else if (column === "additional_metadata_json") output[column] = JSON.stringify(track.metadata);
      else output[column] = [...track.values[column]].join(" | ");
    }
    return output;
  }).sort((a, b) => a.artist_name.localeCompare(b.artist_name) || a.track_name.localeCompare(b.track_name));

  const uniqueSpotifyIds = new Set(rows.map((row) => text(row.spotify_track_id)).filter(Boolean));
  const withoutSpotify = rows.filter((row) => !row.spotify_track_id).length;
  const withApproved = rows.filter((row) => row.approved_genre_category).length;
  return {
    rows,
    summary: {
      database_path: databasePath,
      relevant_tables_found: tables.map((table) => table.name),
      total_raw_track_related_records: tables.reduce((sum, table) => sum + table.rows.length, 0),
      unique_spotify_track_ids: uniqueSpotifyIds.size,
      unique_tracks_without_spotify_ids: withoutSpotify,
      total_unique_recovered_songs: rows.length,
      songs_with_approved_genre_category_intelligence: withApproved,
      songs_without_approved_genre_category_intelligence: rows.length - withApproved,
    },
  };
}

function buildRecovery(options = {}) {
  const databasePath = options.databasePath || config.databasePath;
  const db = options.db || new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return buildRecoveryFromDb(db, databasePath, options.sourceLabel || "current_database");
  } finally {
    if (!options.db) db.close();
  }
}

function csvCell(value) {
  const safe = text(value).replaceAll('"', '""');
  return `"${safe}"`;
}

function getMasterSongRecoverySummary(options) {
  return buildRecovery(options).summary;
}

function getMasterSongRecoveryCsv(options) {
  const { rows } = buildRecovery(options);
  return `\uFEFF${CANONICAL_COLUMNS.map(csvCell).join(",")}\r\n${rows.map((row) => CANONICAL_COLUMNS.map((column) => csvCell(row[column])).join(",")).join("\r\n")}\r\n`;
}

module.exports = { CANONICAL_COLUMNS, buildRecovery, canonicalSpotifyTrackId, getMasterSongRecoveryCsv, getMasterSongRecoverySummary, inspectSchema };
