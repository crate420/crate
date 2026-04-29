const fs = require("node:fs");
const path = require("node:path");
const { openDatabase, closeDatabase } = require("./index");

const migrationsDir = path.join(__dirname, "migrations");

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function applyMigrations() {
  const db = openDatabase();
  ensureMigrationsTable(db);

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((row) => row.name),
  );

  const pending = getMigrationFiles().filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log("No pending migrations.");
    return { applied: 0 };
  }

  const insertMigration = db.prepare("INSERT INTO _migrations (name) VALUES (?)");

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

    const runMigration = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(file);
    });

    runMigration();
    console.log(`Applied migration: ${file}`);
  }

  return { applied: pending.length };
}

if (require.main === module) {
  try {
    const result = applyMigrations();
    console.log(`Migration complete. Applied ${result.applied} migration(s).`);
  } catch (err) {
    console.error("Migration failed.");
    console.error(err);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

module.exports = {
  applyMigrations,
};
