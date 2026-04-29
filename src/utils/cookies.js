const crypto = require("node:crypto");
const config = require("../config");

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(value)
    .digest("base64url");
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");

  if (config.env === "production") {
    parts.push("Secure");
  }

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }

  return parts.join("; ");
}

function parseCookies(req) {
  const header = req.headers.cookie;

  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) return cookies;

    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function createSignedValue(value) {
  const payload = base64Url(value);
  return `${payload}.${sign(payload)}`;
}

function readSignedValue(signedValue) {
  if (!signedValue) {
    return null;
  }

  const [payload, signature] = signedValue.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  return Buffer.from(payload, "base64url").toString("utf8");
}

function setSignedCookie(res, name, value, options) {
  res.append("Set-Cookie", serializeCookie(name, createSignedValue(value), options));
}

function clearCookie(res, name) {
  res.append("Set-Cookie", serializeCookie(name, "", { maxAgeSeconds: 0 }));
}

function readSignedCookie(req, name) {
  return readSignedValue(parseCookies(req)[name]);
}

module.exports = {
  clearCookie,
  readSignedCookie,
  setSignedCookie,
};
