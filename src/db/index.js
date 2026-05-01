const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const config = require("../config");

let db;

function shouldCreateDatabaseDirectory(databasePath) {
  if (databasePath.startsWith("/var/data")) {
    return false;
  }

  const directory = path.dirname(databasePath);

  return !path.isAbsolute(databasePath) || !directory.startsWith("/var");
}

function openDatabase() {
  if (db) {
    return db;
  }

  if (shouldCreateDatabaseDirectory(config.databasePath)) {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }

  db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = {
  openDatabase,
  closeDatabase,
  shouldCreateDatabaseDirectory,
};
