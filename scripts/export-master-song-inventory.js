const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const config = require("../src/config");
const { buildRecovery } = require("../src/crate/masterSongRecovery");

const root = config.rootDir;
const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "recovery");
const currentDbPath = path.join(root, "data/crate.sqlite");
const olderDbPath = path.join(root, "data/crate.before-admin-review.sqlite");
const fields = [
  "spotify_track_id", "track_name", "artist_name", "spotify_artist_id", "album", "release_date", "release_year", "spotify_uri", "isrc",
  "current_crate_category", "effective_crate_category", "historical_backup_category", "classification_sources", "manual_override_status", "manual_override_category",
  "matched_status", "current_library_presence", "track_intelligence_presence", "track_confidence_and_authority",
  "track_intelligence_evidence", "playlist_collection_evidence", "playlist_seed_presence", "research_playlist_presence",
  "source_genres", "artist_level_genres", "artist_level_evidence", "artist_level_playlist_evidence", "era", "popularity", "explicit", "duration_ms",
  "record_labels", "source_tables", "source_record_count", "data_quality_flags", "safe_metadata_json",
];

function clean(value) {
  const result = String(value ?? "").trim();
  return /^(undefined|null|none|n\/a)$/i.test(result) ? "" : result;
}
function normalized(value) { return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((item) => item.trim());
  return rows.filter((items) => items.some((item) => item !== "")).map((items) => Object.fromEntries(headers.map((key, i) => [key, items[i] || ""])));
}
function get(row, ...keys) {
  const byLower = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
  for (const key of keys) { const value = byLower.get(key.toLowerCase().replace(/[^a-z0-9]/g, "")); if (clean(value)) return value; }
  return "";
}
function spotifyId(value) {
  const raw = clean(value);
  const uri = raw.match(/spotify:track:([^?/#]+)/i);
  if (uri) return uri[1];
  const url = raw.match(/open\.spotify\.com\/track\/([^?/#]+)/i);
  return url ? url[1] : raw;
}
function rowKey(row) {
  const id = spotifyId(row.spotify_track_id);
  return id ? `spotify:${id}` : `metadata:${[row.artist_name, row.track_name, row.album].map(normalized).join("|")}`;
}
function recordFor(map, source) {
  const key = rowKey(source);
  let out = map.get(key);
  if (!out) {
    out = Object.fromEntries(fields.map((field) => [field, new Set()]));
    out._quality = new Set();
    out._dbMain = false;
    out._dbAny = false;
    out._currentLibrary = false;
    out._currentMatched = false;
    out._currentUnmatched = false;
    out._trackIntel = false;
    out._manual = false;
    out._artistIntel = false;
    out._playlistEvidence = false;
    out._seed = false;
    out._research = false;
    out._rows = 0;
    map.set(key, out);
  }
  return out;
}
function add(out, field, value) {
  if (value === null || value === undefined || value === "") return;
  if (Array.isArray(value)) value.forEach((item) => add(out, field, item));
  else if (out[field]) {
    const parts = field === "safe_metadata_json" ? [String(value)] : String(value).split(" | ").filter(Boolean);
    parts.forEach((item) => out[field].add(item));
  }
}
function addDatabaseRows(map, result, label, isCurrent) {
  const externalRecords = [];
  for (const row of result.rows) {
    const sourceTables = clean(row.source_tables).split(" | ").filter(Boolean);
    const tableKinds = new Set(sourceTables.map((source) => source.slice(source.indexOf(".") + 1)));
    const record = recordFor(map, row);
    record._rows += Number(row.source_record_count || 1);
    add(record, "spotify_track_id", row.spotify_track_id);
    for (const f of ["track_name", "artist_name", "spotify_artist_id", "album", "release_date", "release_year", "spotify_uri", "isrc", "era", "popularity", "explicit", "duration_ms"]) add(record, f, row[f]);
    for (const source of sourceTables) add(record, "source_tables", source);
    add(record, "safe_metadata_json", row.additional_metadata_json);
    record._dbAny = true;
    if (tableKinds.has("tracks")) { record._dbMain ||= isCurrent; }
    if (tableKinds.has("user_tracks")) {
      record._currentLibrary ||= isCurrent;
      record._currentMatched ||= isCurrent && Boolean(row.approved_genre_category);
      record._currentUnmatched ||= isCurrent && String(row.classification_sort_status).includes("unmatched");
      add(record, "matched_status", isCurrent ? (row.classification_sort_status || "in_library") : "historical_backup_record");
    }
    if (isCurrent) {
      add(record, "current_crate_category", row.library_assigned_category);
      add(record, "manual_override_category", row.manual_override_category);
      add(record, "effective_crate_category", row.manual_override_category || row.library_assigned_category);
    } else add(record, "historical_backup_category", row.library_assigned_category);
    add(record, "artist_level_genres", row.artist_level_genres);
    add(record, "artist_level_evidence", row.artist_level_evidence);
    add(record, "artist_level_playlist_evidence", row.artist_level_playlist_evidence);
    add(record, "track_intelligence_evidence", row.intelligence_source_evidence);
    add(record, "classification_sources", sourceTables.filter((name) => /user_tracks|track_overrides|playlist_collection_tracks/.test(name)));
    add(record, "manual_override_status", sourceTables.includes(`${label}.track_overrides`) ? "manual_track_override" : "");
    if (sourceTables.includes(`${label}.track_overrides`)) record._manual = true;
    if (tableKinds.has("track_intelligence") || tableKinds.has("track_intelligence_sources") || tableKinds.has("track_learning_profiles")) record._trackIntel = true;
    if (row.artist_level_genres || row.artist_level_evidence || row.artist_level_playlist_evidence) record._artistIntel = true;
    if (tableKinds.has("playlist_collection_tracks")) { record._playlistEvidence = true; add(record, "playlist_collection_evidence", row.additional_genre_category_intelligence); }
    if (tableKinds.has("playlist_seed_tracks") || tableKinds.has("curated_playlist_seed_tracks")) { record._seed = true; add(record, "playlist_seed_presence", sourceTables.filter((name) => /playlist_seed_tracks|curated_playlist_seed_tracks/.test(name))); }
    if (row.additional_genre_category_intelligence) add(record, "playlist_collection_evidence", row.additional_genre_category_intelligence);
    if (row.approval_status) add(record, "manual_override_status", row.approval_status);
    if (row.classification_sort_status) add(record, "matched_status", row.classification_sort_status);
    if (row.spotify_track_id && !/^[A-Za-z0-9]{22}$/.test(row.spotify_track_id)) record._quality.add("malformed_spotify_track_id");
    if (!row.track_name) record._quality.add("missing_track_name");
    if (!row.artist_name) record._quality.add("missing_artist_name");
    const intel = JSON.parse(row.additional_metadata_json || "{}");
    for (const [tableName, tableRows] of Object.entries(intel)) for (const item of tableRows || []) {
      if (!item || typeof item !== "object") continue;
      if (item.confidence_score !== undefined) add(record, "track_confidence_and_authority", `confidence:${item.confidence_score}`);
      if (item.review_status) add(record, "track_confidence_and_authority", `review:${item.review_status}`);
      if (tableName === "track_overrides" && item.override_playlist_code) { record._manual = true; add(record, "manual_override_category", item.override_playlist_code); }
      if (item.seed_code) { record._seed = true; add(record, "playlist_seed_presence", item.seed_code); }
      if (item.genres_json) add(record, "source_genres", item.genres_json);
      if (item.record_label) add(record, "record_labels", item.record_label);
    }
  }
  return externalRecords;
}
function addResearchRecord(map, data, sourcePath, sourceGenre, recordLabel) {
  const id = spotifyId(get(data, "spotify_track_id", "track_uri", "spotify_uri", "uri"));
  const trackName = clean(get(data, "track_name", "name"));
  let artistName = clean(get(data, "artist_name", "artist_names", "artists"));
  try { if (artistName.startsWith("[")) artistName = JSON.parse(artistName).join("; "); } catch {}
  if (!id && !trackName) return;
  const source = { spotify_track_id: id, track_name: trackName, artist_name: artistName, album: clean(get(data, "album_name", "album")) };
  const record = recordFor(map, source);
  record._rows += 1;
  for (const [field, keys] of Object.entries({ release_date: ["release_date"], release_year: ["release_year"], spotify_uri: ["track_uri", "spotify_uri", "uri"], isrc: ["isrc"], duration_ms: ["duration_ms"], popularity: ["popularity"], explicit: ["explicit"], record_labels: ["record_label", "label"] })) add(record, field, get(data, ...keys));
  add(record, "spotify_track_id", id); add(record, "track_name", trackName); add(record, "artist_name", artistName); add(record, "album", source.album);
  add(record, "source_tables", sourcePath);
  const overrideCode = clean(get(data, "override_playlist_code", "approved_genre_category"));
  const isTrainingOverride = sourcePath === "data/training-export.json" && Boolean(overrideCode);
  if (sourceGenre && !isTrainingOverride) add(record, "source_genres", sourceGenre);
  if (recordLabel && !isTrainingOverride) add(record, "playlist_collection_evidence", recordLabel);
  if (isTrainingOverride) {
    record._manual = true;
    add(record, "manual_override_status", "historical_exported_track_override");
    add(record, "manual_override_category", overrideCode);
    add(record, "classification_sources", sourcePath);
  } else {
    add(record, "research_playlist_presence", sourcePath);
    record._research = true;
    record._playlistEvidence = true;
    if (sourcePath.includes("playlist_seed") || sourcePath.includes("curated")) { record._seed = true; add(record, "playlist_seed_presence", sourcePath); }
  }
  if (id.startsWith("spotify:episode:")) record._quality.add("non_track_spotify_item");
  else if (id.startsWith("spotify:local:")) record._quality.add("spotify_local_track_identifier_not_portable");
  else if (id && !/^[A-Za-z0-9]{22}$/.test(id)) record._quality.add("malformed_spotify_track_id");
  if (!trackName) record._quality.add("missing_track_name");
  if (!artistName) record._quality.add("missing_artist_name");
}
function walkFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full, ext) : (entry.name.toLowerCase().endsWith(ext) ? [full] : []);
  });
}
function mergeSets(out) {
  return Object.fromEntries(fields.map((field) => [field, [...out[field]].filter(Boolean).join(" | ")]));
}
function makeFlags(record) {
  const flags = new Set(record._quality);
  const conflicts = (values) => new Set([...values].map(normalized).filter(Boolean)).size > 1;
  const ids = record.spotify_track_id;
  if (ids.size > 1) flags.add("conflicting_spotify_track_ids_for_merged_song");
  for (const field of ["track_name", "artist_name", "album"]) if (conflicts(record[field])) flags.add(`conflicting_${field}`);
  if (record.current_crate_category.size > 1) flags.add("conflicting_current_crate_categories");
  if (record.historical_backup_category.size > 1) flags.add("conflicting_historical_categories");
  if (record.current_crate_category.size && record.manual_override_category.size && ![...record.manual_override_category].some((override) => record.current_crate_category.has(override))) flags.add("override_category_differs_from_assigned_category");
  return [...flags];
}
function finalRow(record) {
  const row = mergeSets(record);
  row.source_record_count = String(record._rows);
  row.current_library_presence = record._currentLibrary ? "yes" : "no";
  row.track_intelligence_presence = record._trackIntel ? "yes" : "no";
  row.playlist_seed_presence = record._seed ? (row.playlist_seed_presence || "yes") : row.playlist_seed_presence;
  row.research_playlist_presence = record._research ? (row.research_playlist_presence || "yes") : row.research_playlist_presence;
  row.data_quality_flags = makeFlags(record).join(" | ");
  return row;
}
function quote(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function databaseDiagnostics(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const count = (sql) => Number(db.prepare(sql).get().count || 0);
    const result = { foreign_key_violations: db.pragma("foreign_key_check").length, duplicate_track_ids: 0, orphan_evidence: {}, table_counts: {} };
    for (const name of ["tracks", "user_tracks", "track_overrides", "track_intelligence", "track_intelligence_sources", "track_learning_profiles", "artist_genres", "artist_intelligence", "playlist_seed_tracks", "curated_playlist_seed_tracks", "playlist_collection_artists", "playlist_collection_tracks", "playlist_intelligence_import_logs", "genre_recommendation_approvals", "admin_intelligence_review_decisions", "unmatched_genre_logs"]) {
      if (tables.has(name)) result.table_counts[name] = count(`SELECT COUNT(*) AS count FROM "${name}"`);
    }
    if (tables.has("tracks")) result.duplicate_track_ids = count("SELECT COUNT(*) AS count FROM (SELECT spotify_track_id FROM tracks WHERE spotify_track_id IS NOT NULL AND spotify_track_id != '' GROUP BY spotify_track_id HAVING COUNT(*) > 1)");
    const joins = {
      track_overrides: "SELECT COUNT(*) AS count FROM track_overrides o LEFT JOIN tracks t ON t.id=o.track_id WHERE t.id IS NULL",
      track_era_overrides: "SELECT COUNT(*) AS count FROM track_era_overrides o LEFT JOIN tracks t ON t.id=o.track_id WHERE t.id IS NULL",
      track_learning_profiles: "SELECT COUNT(*) AS count FROM track_learning_profiles p LEFT JOIN tracks t ON t.id=p.track_id WHERE t.id IS NULL",
      track_intelligence_sources: "SELECT COUNT(*) AS count FROM track_intelligence_sources s LEFT JOIN track_intelligence t ON t.id=s.track_intelligence_id WHERE t.id IS NULL",
      playlist_track_links: "SELECT COUNT(*) AS count FROM playlist_collection_tracks p LEFT JOIN track_intelligence t ON t.id=p.production_track_intelligence_id WHERE p.production_track_intelligence_id IS NOT NULL AND t.id IS NULL",
      unmatched_genre_track_ids: "SELECT COUNT(*) AS count FROM unmatched_genre_logs u LEFT JOIN tracks t ON t.spotify_track_id=u.spotify_track_id WHERE u.spotify_track_id IS NOT NULL AND t.id IS NULL",
    };
    for (const [key, sql] of Object.entries(joins)) {
      const sourceTable = key === "playlist_track_links" ? "playlist_collection_tracks" : key === "unmatched_genre_track_ids" ? "unmatched_genre_logs" : key;
      if (tables.has(sourceTable) && tables.has(key === "track_intelligence_sources" || key === "playlist_track_links" ? "track_intelligence" : "tracks")) result.orphan_evidence[key] = count(sql);
    }
    return result;
  } finally { db.close(); }
}

function main() {
  const inventory = new Map();
  const current = buildRecovery({ databasePath: currentDbPath, sourceLabel: "current_database" });
  const older = buildRecovery({ databasePath: olderDbPath, sourceLabel: "historical_backup" });
  addDatabaseRows(inventory, current, "current_database", true);
  addDatabaseRows(inventory, older, "historical_backup", false);

  const researchDir = path.join(root, "research");
  const csvFiles = walkFiles(researchDir, ".csv");
  let csvRowsParsed = 0;
  for (const file of csvFiles) {
    const relative = path.relative(root, file);
    const collection = path.basename(path.dirname(file)).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
    const entries = parseCsv(fs.readFileSync(file, "utf8"));
    csvRowsParsed += entries.length;
    for (const entry of entries) {
      addResearchRecord(inventory, entry, relative, get(entry, "genres"), `${collection}:${path.basename(file)}`);
    }
  }

  let seedJsonSongs = 0;
  const jsonFiles = [...walkFiles(path.join(root, "data"), ".json"), ...walkFiles(researchDir, ".json")];
  for (const file of jsonFiles) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const relative = path.relative(root, file);
    const visit = (value) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object") return;
      if (get(value, "spotify_track_id", "spotify_uri", "uri") || get(value, "track_name")) {
        addResearchRecord(inventory, value, relative, get(value, "genres", "genres_json"), get(value, "seed_code", "collection_code"));
        seedJsonSongs += 1;
      }
      for (const [key, child] of Object.entries(value)) if (key !== "raw_json" && key !== "raw_payload_json") visit(child);
    };
    visit(parsed);
  }

  const rows = [...inventory.values()].map(finalRow).sort((a, b) => a.artist_name.localeCompare(b.artist_name) || a.track_name.localeCompare(b.track_name) || a.spotify_track_id.localeCompare(b.spotify_track_id));
  const songRows = rows.filter((row) => !row.data_quality_flags.includes("non_track_spotify_item"));
  const nonTrackItems = rows.filter((row) => row.data_quality_flags.includes("non_track_spotify_item")).map((row) => ({ spotify_item_id: row.spotify_track_id, title: row.track_name, artist: row.artist_name, source_tables: row.source_tables }));
  const ids = new Set(songRows.map((row) => row.spotify_track_id).filter(Boolean));
  const stats = {
    total_unique_songs: songRows.length,
    unique_spotify_track_ids: new Set(rows.filter((r) => /^[A-Za-z0-9]{22}$/.test(r.spotify_track_id)).map((r) => r.spotify_track_id)).size,
    unique_nonstandard_source_ids: ids.size - new Set(songRows.filter((r) => /^[A-Za-z0-9]{22}$/.test(r.spotify_track_id)).map((r) => r.spotify_track_id)).size,
    without_spotify_track_id: songRows.filter((r) => !r.spotify_track_id).length,
    current_main_tracks: rows.filter((r) => r.source_tables.split(" | ").includes("current_database.tracks")).length,
    historical_backup_tracks: rows.filter((r) => r.source_tables.split(" | ").includes("historical_backup.tracks")).length,
    seed_import_research_only_songs: rows.filter((r) => !r.data_quality_flags.includes("non_track_spotify_item") && !r.source_tables.split(" | ").some((s) => s.endsWith(".tracks")) && (r.research_playlist_presence || r.playlist_seed_presence)).length,
    classified_current_main_songs: rows.filter((r) => r.current_crate_category || r.manual_override_category).length,
    current_library_unmatched_songs: rows.filter((r) => r.current_library_presence === "yes" && !r.current_crate_category).length,
    manual_track_decisions: rows.filter((r) => r.manual_override_status || r.manual_override_category).length,
    reusable_global_track_intelligence: rows.filter((r) => r.track_intelligence_presence === "yes").length,
    songs_with_artist_level_evidence_but_no_track_intelligence: rows.filter((r) => (r.artist_level_genres || r.artist_level_evidence || r.artist_level_playlist_evidence) && r.track_intelligence_presence !== "yes" && !r.manual_override_status.includes("manual_track_override") && !r.manual_override_category).length,
    songs_with_artist_level_playlist_evidence: rows.filter((r) => r.artist_level_playlist_evidence).length,
    song_or_seed_playlist_evidence_supported_songs: rows.filter((r) => !r.data_quality_flags.includes("non_track_spotify_item") && (r.playlist_collection_evidence || r.playlist_seed_presence || r.research_playlist_presence)).length,
    playlist_evidence_supported_songs: rows.filter((r) => !r.data_quality_flags.includes("non_track_spotify_item") && (r.playlist_collection_evidence || r.playlist_seed_presence || r.research_playlist_presence || r.artist_level_playlist_evidence)).length,
    unique_artist_credits: new Set(rows.map((r) => normalized(r.artist_name)).filter(Boolean)).size,
    unique_spotify_artist_ids: new Set(rows.flatMap((r) => r.spotify_artist_id.split(" | ").flatMap((value) => value.split("; "))).filter(Boolean)).size,
    malformed_spotify_track_ids: rows.filter((r) => r.data_quality_flags.includes("malformed_spotify_track_id")).length,
    nonportable_local_track_ids: rows.filter((r) => r.data_quality_flags.includes("spotify_local_track_identifier_not_portable")).length,
    non_track_items_excluded_from_song_total: rows.filter((r) => r.data_quality_flags.includes("non_track_spotify_item")).length,
    conflicting_song_metadata: rows.filter((r) => /conflicting_(track_name|artist_name|album)/.test(r.data_quality_flags)).length,
    conflicting_current_categories: rows.filter((r) => r.data_quality_flags.includes("conflicting_current_crate_categories")).length,
    research_csv_files: csvFiles.length,
    research_csv_rows_parsed: csvRowsParsed,
    repository_json_track_records_seen: seedJsonSongs,
    source_file_paths: jsonFiles.concat(csvFiles).map((f) => path.relative(root, f)).sort(),
    current_database_diagnostics: databaseDiagnostics(currentDbPath),
    historical_backup_diagnostics: databaseDiagnostics(olderDbPath),
    current_database_summary: Object.fromEntries(Object.entries(current.summary).filter(([key]) => key !== "database_path")),
    historical_backup_summary: Object.fromEntries(Object.entries(older.summary).filter(([key]) => key !== "database_path")),
  };

  const out = path.join(outputDir, "exports");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "master-song-inventory.csv"), `\uFEFF${fields.map(quote).join(",")}\r\n${songRows.map((row) => fields.map((f) => quote(row[f])).join(",")).join("\r\n")}\r\n`);
  fs.writeFileSync(path.join(out, "master-song-inventory.json"), JSON.stringify({ schema: "crate.master-song-inventory", version: 1, generated_at: new Date().toISOString(), summary: stats, songs: songRows, non_track_items: nonTrackItems }, null, 2) + "\n");
  console.log(JSON.stringify({ output_directory: out, csv_rows: songRows.length, non_track_items: nonTrackItems.length, summary: stats }, null, 2));
}

main();
