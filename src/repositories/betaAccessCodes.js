const { openDatabase } = require("../db");

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function findByToken(token) {
  if (!token) return null;

  return openDatabase()
    .prepare(`
      SELECT code, claimed_at, claimed_by_user_id, claimed_name, claimed_email
      FROM beta_access_codes
      WHERE beta_token = ?
        AND claimed_at IS NOT NULL
    `)
    .get(token);
}

function normalizeContact(value) {
  const text = String(value || "").trim();
  return text || null;
}

function claimCode(code, betaToken, userId = null, contact = {}) {
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
          beta_token = @betaToken,
          claimed_name = @claimedName,
          claimed_email = @claimedEmail
      WHERE code = @code
        AND claimed_at IS NULL
    `).run({
      code: normalizedCode,
      userId,
      betaToken,
      claimedName: normalizeContact(contact.name),
      claimedEmail: normalizeContact(contact.email),
    });

    return { status: "claimed_now", code: normalizedCode };
  })();
}

function listClaims() {
  return openDatabase()
    .prepare(`
      SELECT
        code,
        claimed_at,
        claimed_by_user_id,
        claimed_name,
        claimed_email
      FROM beta_access_codes
      WHERE claimed_at IS NOT NULL
      ORDER BY claimed_at DESC, code ASC
    `)
    .all();
}

module.exports = {
  claimCode,
  findByToken,
  listClaims,
  normalizeCode,
};
