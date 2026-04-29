const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const config = require("../config");

let db;

function openDatabase() {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

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
};
