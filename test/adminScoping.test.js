const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { IncomingMessage, ServerResponse } = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const test = require("node:test");

process.env.DATABASE_URL = path.join(os.tmpdir(), `crate-admin-scope-${process.pid}.sqlite`);
process.env.SESSION_SECRET = "admin-scope-test-secret-000000000000";
process.env.ADMIN_SPOTIFY_USER_ID = "admin-spotify-user";

const { closeDatabase, openDatabase } = require("../src/db");
const { applyMigrations } = require("../src/db/migrate");
const { createApp } = require("../src/app");
const { readUsersSummary } = require("../src/crate/adminUserRecovery");
const { getCrateStatus, getGlobalCrateStatus } = require("../src/crate/status");

applyMigrations();

let seededAdminUserId;
let seededBetaUserId;

function seedUser({ spotifyUserId, displayName }) {
  const db = openDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO users (spotify_user_id, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(spotifyUserId, displayName, now, now);
  return Number(result.lastInsertRowid);
}

function seedTrack({ userId, index, playlistCode = null }) {
  const db = openDatabase();
  const spotifyTrackId = `spotify-track-${userId}-${index}`;
  const track = db.prepare(`
    INSERT INTO tracks (spotify_track_id, uri, name, artist_names, album_name, raw_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    spotifyTrackId,
    `spotify:track:${spotifyTrackId}`,
    `Track ${userId}-${index}`,
    JSON.stringify([`Artist ${userId}`]),
    "Scope Test",
    JSON.stringify({ album: { release_date: "2001-01-01" } }),
  );
  db.prepare(`
    INSERT INTO user_tracks (user_id, track_id, playlist_code)
    VALUES (?, ?, ?)
  `).run(userId, Number(track.lastInsertRowid), playlistCode);
}

test.before(() => {
  seededAdminUserId = seedUser({ spotifyUserId: "admin-spotify-user", displayName: "Admin User" });
  seededBetaUserId = seedUser({ spotifyUserId: "beta-spotify-user", displayName: "Beta User" });

  seedTrack({ userId: seededAdminUserId, index: 1, playlistCode: "pop" });
  seedTrack({ userId: seededAdminUserId, index: 2, playlistCode: null });
  seedTrack({ userId: seededBetaUserId, index: 1, playlistCode: "rock" });
  seedTrack({ userId: seededBetaUserId, index: 2, playlistCode: "rock" });
  seedTrack({ userId: seededBetaUserId, index: 3, playlistCode: null });
});

test.after(() => {
  closeDatabase();
});

test("admin user summary lists multiple users instead of only the authenticated admin", () => {
  const summary = readUsersSummary();

  assert.equal(summary.users.length, 2);
  assert.deepEqual(summary.users.map((user) => user.name), ["Admin User", "Beta User"]);
});

test("admin dashboard/global totals include all users", () => {
  const status = getGlobalCrateStatus();

  assert.equal(status.scope, "global");
  assert.equal(status.total_user_tracks_count, 5);
  assert.equal(status.matched_tracks_count, 3);
  assert.equal(status.unmatched_tracks_count, 2);
});

test("User Recovery picker data includes all users with per-user counts", () => {
  const users = readUsersSummary().users;
  const admin = users.find((user) => user.name === "Admin User");
  const beta = users.find((user) => user.name === "Beta User");

  assert.ok(admin);
  assert.ok(beta);
  assert.equal(admin.total_songs, 2);
  assert.equal(admin.matched, 1);
  assert.equal(admin.unmatched, 1);
  assert.equal(beta.total_songs, 3);
  assert.equal(beta.matched, 2);
  assert.equal(beta.unmatched, 1);
});

test("normal user status remains scoped to the current user", () => {
  const users = readUsersSummary().users;
  const admin = users.find((user) => user.name === "Admin User");
  const beta = users.find((user) => user.name === "Beta User");

  const adminStatus = getCrateStatus({ userId: admin.user_id });
  const betaStatus = getCrateStatus({ userId: beta.user_id });

  assert.equal(adminStatus.scope, "user");
  assert.equal(adminStatus.total_user_tracks_count, 2);
  assert.equal(adminStatus.matched_tracks_count, 1);
  assert.equal(adminStatus.unmatched_tracks_count, 1);
  assert.equal(betaStatus.scope, "user");
  assert.equal(betaStatus.total_user_tracks_count, 3);
  assert.equal(betaStatus.matched_tracks_count, 2);
  assert.equal(betaStatus.unmatched_tracks_count, 1);
});

function signedUserCookie(userId) {
  const payload = Buffer.from(String(userId)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `crate_user_id=${payload}.${signature}`;
}

async function requestJson(app, pathName, userId) {
  const chunks = [];
  const socket = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  socket.cork = () => {};
  socket.uncork = () => {};
  socket.setTimeout = () => {};
  socket.destroy = () => {};
  socket.readable = true;
  socket.writable = true;

  const request = new IncomingMessage(socket);
  request.method = "GET";
  request.url = pathName;
  request.headers = {
    host: "127.0.0.1",
    ...(userId ? { cookie: signedUserCookie(userId) } : {}),
  };
  request.socket = { encrypted: false };
  request.connection = request.socket;

  const response = new ServerResponse(request);
  response.assignSocket(socket);

  return await new Promise((resolve, reject) => {
    response.on("finish", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const text = raw.includes("\r\n\r\n") ? raw.slice(raw.indexOf("\r\n\r\n") + 4) : raw;
      resolve({
        response: { status: response.statusCode, headers: response.getHeaders() },
        body: text ? JSON.parse(text) : {},
      });
    });
    response.on("error", reject);
    app.handle(request, response, reject);
  });
}

test("admin API summary endpoint lists all users for the configured admin", async () => {
  const app = createApp();
  const { response, body } = await requestJson(app, "/crate/admin/users/summary?force_refresh=true", seededAdminUserId);

  assert.equal(response.status, 200);
  assert.equal(body.users.length, 2);
  assert.deepEqual(body.users.map((user) => user.name), ["Admin User", "Beta User"]);
});

test("non-admin users cannot access all-user admin summaries", async () => {
  const app = createApp();
  const { response, body } = await requestJson(app, "/crate/admin/users/summary?force_refresh=true", seededBetaUserId);

  assert.equal(response.status, 403);
  assert.equal(body.error, "forbidden");
  assert.equal(body.users, undefined);
});

test("normal status endpoint returns only the authenticated user's library", async () => {
  const app = createApp();
  const { response, body } = await requestJson(app, "/crate/status", seededBetaUserId);

  assert.equal(response.status, 200);
  assert.equal(body.scope, "user");
  assert.equal(body.user_id, seededBetaUserId);
  assert.equal(body.total_user_tracks_count, 3);
  assert.equal(body.matched_tracks_count, 2);
  assert.equal(body.unmatched_tracks_count, 1);
});

test('music snapshot is own-account only and cannot select another account',async()=>{
 const app=createApp();
 const own=await requestJson(app,'/crate/sorting-snapshot?limit=1',seededBetaUserId);
 assert.equal(own.response.status,200);assert.equal(own.body.total,1);assert.equal(own.body.tracks[0].artist_names[0],`Artist ${seededBetaUserId}`);
 assert.doesNotMatch(JSON.stringify(own.body),/email|display_name|refresh_token|access_token|raw_json|liked_at/);
 const other=await requestJson(app,`/crate/sorting-snapshot?user_id=${seededAdminUserId}`,seededBetaUserId);assert.equal(other.response.status,400);
 const integrity=await requestJson(app,'/crate/admin/music-integrity',seededBetaUserId);assert.equal(integrity.response.status,403);
 const allowed=await requestJson(app,'/crate/admin/music-integrity',seededAdminUserId);assert.equal(allowed.response.status,200);assert.equal(allowed.body.counts.associations_missing_track,0);
 const unauth=await requestJson(app,'/crate/sorting-snapshot',99999999);assert.equal(unauth.response.status,401);
});
test('snapshot pagination is consistent and rejects changed versions without writes',async()=>{
 const app=createApp();const before=openDatabase().prepare('SELECT total_changes() n').get().n;
 const first=await requestJson(app,'/crate/sorting-snapshot?limit=1&offset=0',seededAdminUserId);
 const second=await requestJson(app,'/crate/sorting-snapshot?limit=1&offset=1&snapshot='+first.body.snapshot,seededAdminUserId);
 assert.equal(first.response.status,200);assert.equal(second.response.status,200);assert.equal(second.body.snapshot,first.body.snapshot);assert.equal(second.body.count,0);
 const stale=await requestJson(app,'/crate/sorting-snapshot?snapshot=stale',seededAdminUserId);assert.equal(stale.response.status,409);
 const invalid=await requestJson(app,'/crate/sorting-snapshot?limit=1001',seededAdminUserId);assert.equal(invalid.response.status,400);
 assert.equal(openDatabase().prepare('SELECT total_changes() n').get().n,before);
});

test('snapshot makes no provider calls, retains manual locks, rejects unauthenticated access',async()=>{
 const db=openDatabase();const row=db.prepare('SELECT track_id FROM user_tracks WHERE user_id=? AND playlist_code IS NULL LIMIT 1').get(seededAdminUserId);
 db.prepare('INSERT INTO track_overrides (track_id,override_playlist_code) VALUES (?,?)').run(row.track_id,'jazz');
 const old=global.fetch;let calls=0;global.fetch=()=>{calls++;throw new Error('Unexpected network call');};
 try {const app=createApp();const before=db.prepare('SELECT total_changes() n').get().n;
 const result=await requestJson(app,'/crate/sorting-snapshot?limit=1000',seededAdminUserId);assert.equal(result.body.tracks[0].manual_override,'jazz');assert.equal(result.body.tracks[0].manual_override_scope,'legacy_global_lock');
 const denied=await requestJson(app,'/crate/sorting-snapshot');assert.equal(denied.response.status,401);
 assert.equal(calls,0);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 }finally{global.fetch=old;}
});
