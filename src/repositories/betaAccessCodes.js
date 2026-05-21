const { openDatabase } = require("../db");

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function findByToken(token) {
  if (!token) return null;

  return openDatabase()
    .prepare(`
      SELECT code, claimed_at, claimed_by_user_id, claimed_name, claimed_email, beta_token
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

function createTesterRegistration(code, betaToken, userId = null, contact = {}) {
  const normalizedCode = normalizeCode(code);
  const db = openDatabase();

  db.prepare(`
    INSERT INTO beta_access_codes (
      code,
      claimed_at,
      claimed_by_user_id,
      beta_token,
      claimed_name,
      claimed_email
    )
    VALUES (
      @code,
      CURRENT_TIMESTAMP,
      @userId,
      @betaToken,
      @claimedName,
      @claimedEmail
    )
  `).run({
    code: normalizedCode,
    userId,
    betaToken,
    claimedName: normalizeContact(contact.name),
    claimedEmail: normalizeContact(contact.email),
  });

  return { status: "registered", code: normalizedCode };
}

function attachUserToToken(betaToken, userId) {
  if (!betaToken || !userId) return { updated: 0 };

  const result = openDatabase()
    .prepare(`
      UPDATE beta_access_codes
      SET claimed_by_user_id = COALESCE(claimed_by_user_id, @userId)
      WHERE beta_token = @betaToken
        AND claimed_at IS NOT NULL
    `)
    .run({ betaToken, userId });

  return { updated: result.changes };
}

function listClaims() {
  return openDatabase()
    .prepare(`
      SELECT
        beta_access_codes.code,
        beta_access_codes.claimed_at,
        beta_access_codes.claimed_by_user_id,
        beta_access_codes.claimed_name,
        beta_access_codes.claimed_email,
        users.spotify_user_id,
        users.display_name AS spotify_display_name,
        users.email AS spotify_email
      FROM beta_access_codes
      LEFT JOIN users ON users.id = beta_access_codes.claimed_by_user_id
      WHERE beta_access_codes.claimed_at IS NOT NULL
      ORDER BY beta_access_codes.claimed_at DESC, beta_access_codes.code ASC
    `)
    .all();
}

module.exports = {
  attachUserToToken,
  createTesterRegistration,
  findByToken,
  listClaims,
  normalizeCode,
};
