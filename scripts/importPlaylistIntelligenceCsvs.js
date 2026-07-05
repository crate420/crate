const fs = require("node:fs");
const path = require("node:path");
const { openDatabase, closeDatabase } = require("../src/db");

const ROOT_DIR = path.resolve(__dirname, "..");
const RESEARCH_ROOT = path.join(ROOT_DIR, "research", "playlist-intelligence");
const DEFAULT_STATUS = "candidate";
const DEFAULT_CONFIDENCE = 70;
const REVIEW_STATUSES = new Set(["candidate", "approved", "rejected", "ignored"]);
const PROTECTED_STATUSES = new Set(["approved", "rejected", "ignored"]);
const COLLECTION_CODE_ALIASES = {
  "alt_r&b": "alt_rb",
};
const COLLECTION_FOLDER_ALIASES = {
  alt_rb: "alt_r&b",
};
const ARTIST_HEADERS = [
  "artist",
  "artists",
  "artist_name",
  "artist_names",
  "artist_name_s",
  "artist_names_s",
  "main_artist",
  "primary_artist",
];

function usage() {
  return [
    "Usage: node scripts/importPlaylistIntelligenceCsvs.js <collection_code> [--dry-run] [--reimport] [--no-sources] [--overwrite-status] [--status=candidate] [--confidence=70]",
    "",
    "Example: node scripts/importPlaylistIntelligenceCsvs.js shoegaze --dry-run",
  ].join("\n");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const collectionCode = args.find((arg) => !arg.startsWith("--"));
  const options = {
    dryRun: args.includes("--dry-run"),
    reimport: args.includes("--reimport"),
    insertSources: !args.includes("--no-sources"),
    overwriteStatus: args.includes("--overwrite-status"),
    status: DEFAULT_STATUS,
    confidence: DEFAULT_CONFIDENCE,
  };

  for (const arg of args.filter((item) => item.startsWith("--"))) {
    if (arg.startsWith("--status=")) options.status = arg.slice("--status=".length).trim();
    if (arg.startsWith("--confidence=")) options.confidence = Number.parseInt(arg.slice("--confidence=".length), 10);
  }

  if (!collectionCode) {
    const error = new Error(usage());
    error.showUsage = true;
    throw error;
  }
  if (!REVIEW_STATUSES.has(options.status)) {
    throw new Error("Invalid --status. Use candidate, approved, rejected, or ignored.");
  }
  if (!Number.isInteger(options.confidence) || options.confidence < 0 || options.confidence > 100) {
    throw new Error("Invalid --confidence. Use a number from 0 to 100.");
  }

  return { collectionCode, options };
}

function normalizeOptions(options = {}) {
  const normalized = {
    dryRun: options.dryRun === true || options.dry_run === true,
    reimport: options.reimport === true,
    insertSources: options.insertSources !== false && options.insert_sources !== false,
    overwriteStatus: options.overwriteStatus === true || options.overwrite_status === true,
    status: cleanText(options.status || options.review_status || DEFAULT_STATUS),
    confidence: Number.parseInt(options.confidence ?? options.confidence_score ?? DEFAULT_CONFIDENCE, 10),
  };
  if (!REVIEW_STATUSES.has(normalized.status)) {
    throw new Error("Invalid status. Use candidate, approved, rejected, or ignored.");
  }
  if (!Number.isInteger(normalized.confidence) || normalized.confidence < 0 || normalized.confidence > 100) {
    throw new Error("Invalid confidence. Use a number from 0 to 100.");
  }
  return normalized;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeHeader(value) {
  return cleanText(value)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeArtistName(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((value) => cleanText(value))) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => cleanText(value))) rows.push(row);
  return rows;
}

function csvObjects(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (rows.length < 2) return { headers: rows[0] || [], rows: [] };
  const headers = rows[0].map(normalizeHeader);
  return {
    headers,
    rows: rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]))),
  };
}

function splitArtists(value) {
  return cleanText(value)
    .split(/\s*(?:;|\|)\s*/g)
    .map(cleanText)
    .filter(Boolean);
}

function artistNamesForRow(row) {
  for (const header of ARTIST_HEADERS) {
    if (row[header]) return splitArtists(row[header]);
  }
  return [];
}

function playlistNameFromFile(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " ").trim();
}

function requireCollection(db, collectionCode) {
  const resolvedCode = COLLECTION_CODE_ALIASES[collectionCode] || collectionCode;
  const collection = db.prepare("SELECT * FROM playlist_collection_definitions WHERE collection_code = ?").get(resolvedCode);
  if (!collection) throw new Error(`Playlist Intelligence collection not found: ${collectionCode}`);
  return collection;
}

function ensureResearchDirectory(collectionCode) {
  const directory = path.join(RESEARCH_ROOT, collectionCode);
  if (!fs.existsSync(directory)) throw new Error(`CSV directory not found: ${directory}`);
  const files = fs.readdirSync(directory)
    .filter((file) => file.toLowerCase().endsWith(".csv"))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => path.join(directory, file));
  if (!files.length) throw new Error(`No CSV files found in ${directory}`);
  return { directory, files };
}

function existingSource(db, collectionId, playlistName) {
  return db.prepare(`
    SELECT id FROM playlist_collection_sources
    WHERE collection_id = ? AND lower(playlist_name) = lower(?)
  `).get(collectionId, playlistName);
}

function insertSource(db, collectionId, playlistName, dryRun) {
  if (dryRun) return;
  db.prepare(`
    INSERT INTO playlist_collection_sources
      (collection_id, playlist_name, source_type, review_status, trust_level, source_name, weight, include_in_consensus, active, notes)
    VALUES
      (?, ?, 'manual', 'candidate', 'medium', ?, 1, 1, 1, 'Imported from research/playlist-intelligence CSV')
  `).run(collectionId, playlistName, playlistName);
}

function collectArtistEvidence(files, collection, options, db) {
  const artists = new Map();
  const summary = {
    collection_code: collection.collection_code,
    directory: path.join(RESEARCH_ROOT, collection.collection_code),
    dry_run: options.dryRun,
    files_processed: 0,
    files_skipped_existing_source: 0,
    rows_read: 0,
    skipped_rows: 0,
    artists_found: 0,
    artists_inserted: 0,
    artists_updated: 0,
    protected_status_preserved: 0,
    sources_inserted: 0,
    errors: [],
  };

  for (const filePath of files) {
    const playlistName = playlistNameFromFile(filePath);
    if (options.insertSources && existingSource(db, collection.id, playlistName) && !options.reimport) {
      summary.files_skipped_existing_source += 1;
      continue;
    }

    const parsed = csvObjects(filePath);
    const hasArtistHeader = parsed.headers.some((header) => ARTIST_HEADERS.includes(header));
    if (!hasArtistHeader) {
      summary.errors.push({ file: filePath, message: "No supported artist header found." });
      continue;
    }

    summary.files_processed += 1;
    summary.rows_read += parsed.rows.length;
    for (const row of parsed.rows) {
      const artistNames = artistNamesForRow(row);
      if (!artistNames.length) {
        summary.skipped_rows += 1;
        continue;
      }
      for (const artistName of artistNames) {
        const key = normalizeArtistName(artistName);
        if (!key) continue;
        const current = artists.get(key) || {
          artist_name: artistName,
          appearance_count: 0,
          evidence_count: 0,
          sources: new Set(),
        };
        current.appearance_count += 1;
        current.evidence_count += 1;
        current.sources.add(playlistName);
        artists.set(key, current);
      }
    }

    if (options.insertSources && !existingSource(db, collection.id, playlistName)) {
      insertSource(db, collection.id, playlistName, options.dryRun);
      summary.sources_inserted += 1;
    }
  }

  summary.artists_found = artists.size;
  return { artists, summary };
}

function writeArtists(db, collection, artists, summary, options) {
  const rows = [...artists.values()];
  const write = db.transaction(() => {
    for (const row of rows) {
      const existing = db.prepare(`
        SELECT * FROM playlist_collection_artists
        WHERE collection_id = ? AND lower(artist_name) = lower(?)
      `).get(collection.id, row.artist_name);
      const sourceCount = row.sources.size;
      const nextStatus = existing && PROTECTED_STATUSES.has(existing.review_status) && !options.overwriteStatus
        ? existing.review_status
        : options.status;
      const approved = nextStatus === "approved" ? 1 : 0;
      if (existing && nextStatus === existing.review_status && PROTECTED_STATUSES.has(existing.review_status) && !options.overwriteStatus) {
        summary.protected_status_preserved += 1;
      }

      const payload = {
        collection_id: collection.id,
        artist_name: existing?.artist_name || row.artist_name,
        appearance_count: Number(existing?.appearance_count || 0) + row.appearance_count,
        evidence_count: Number(existing?.evidence_count || 0) + row.evidence_count,
        source_count: Number(existing?.source_count || 0) + sourceCount,
        review_status: nextStatus,
        confidence_score: Math.max(Number(existing?.confidence_score || 0), options.confidence),
        approved,
        notes: existing?.notes || "",
      };

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
      } else {
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
    }
  });

  write();
}

function runImport(collectionCode, options) {
  const normalizedOptions = normalizeOptions(options);
  const db = openDatabase();
  const collection = requireCollection(db, collectionCode);
  const folderCode = COLLECTION_FOLDER_ALIASES[collectionCode] || collectionCode;
  const { directory, files } = ensureResearchDirectory(folderCode);
  const { artists, summary } = collectArtistEvidence(files, collection, normalizedOptions, db);
  summary.directory = directory;
  writeArtists(db, collection, artists, summary, normalizedOptions);
  return summary;
}

if (require.main === module) {
  try {
    const { collectionCode, options } = parseArgs(process.argv);
    console.log(JSON.stringify(runImport(collectionCode, options), null, 2));
  } catch (err) {
    console.error(err.showUsage ? err.message : JSON.stringify({ status: "error", message: err.message }, null, 2));
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

module.exports = {
  runImport,
};
