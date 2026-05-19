const { openDatabase } = require("../db");

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function findByToken(token) {
  if (!token) return null;

  return openDatabase()
    .prepare(`
      SELECT code, claimed_at, claimed_by_user_id
      FROM beta_access_codes
      WHERE beta_token = ?
        AND claimed_at IS NOT NULL
    `)
    .get(token);
}

function claimCode(code, betaToken, userId = null) {
  const normalizedCode = normalizeCode(code);
  const db = openDatabase();

  return db.transaction(() => {
    const row = db
      .prepare("SELECT code, claimed_at, beta_token FROM beta_access_codes WHERE code = ?")
      .get(normalizedCode);

    if (!row) {
      return { status: "invalid" };
    }

    if (row.claimed_at) {
      return row.beta_token === betaToken
        ? { status: "already_claimed_by_current_user", code: row.code }
        : { status: "claimed" };
    }

    db.prepare(`
      UPDATE beta_access_codes
      SET claimed_at = CURRENT_TIMESTAMP,
          claimed_by_user_id = @userId,
          beta_token = @betaToken
      WHERE code = @code
        AND claimed_at IS NULL
    `).run({
      code: normalizedCode,
      userId,
      betaToken,
    });

    return { status: "claimed_now", code: normalizedCode };
  })();
}

module.exports = {
  claimCode,
  findByToken,
  normalizeCode,
};
