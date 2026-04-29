const { openDatabase } = require("../db");

function startRun(userId, status = "running") {
  const result = openDatabase()
    .prepare(`
      INSERT INTO crate_runs (user_id, status)
      VALUES (?, ?)
    `)
    .run(userId, status);

  return findById(result.lastInsertRowid);
}

function finishRun(runId, status, summary = {}) {
  openDatabase()
    .prepare(`
      UPDATE crate_runs
      SET
        status = @status,
        finished_at = @finishedAt,
        summary_json = @summaryJson,
        updated_at = @finishedAt
      WHERE id = @runId
    `)
    .run({
      runId,
      status,
      finishedAt: new Date().toISOString(),
      summaryJson: JSON.stringify(summary),
    });

  return findById(runId);
}

function findById(runId) {
  return openDatabase()
    .prepare("SELECT * FROM crate_runs WHERE id = ?")
    .get(runId);
}

module.exports = {
  finishRun,
  startRun,
};
