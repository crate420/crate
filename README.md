# Crate MVP

Crate is a backend-first Spotify playlist automation MVP. This repository currently contains the project foundation, Spotify OAuth login, Liked Songs import, sorting, review tooling, and Spotify playlist syncing.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
cp .env.example .env
npm run migrate
```

Edit `.env` before starting the server.

```txt
NODE_ENV=development
PORT=3000
DATABASE_PATH=./data/crate.sqlite
SESSION_SECRET=replace-with-a-long-random-string

SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/spotify/callback

LASTFM_API_KEY=your-lastfm-api-key
ADMIN_SPOTIFY_USER_ID=your-spotify-user-id
```

`SESSION_SECRET` must be at least 32 characters.

## Run

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default.

## Render Deployment

Crate pins Node 20 LTS for Render compatibility with `better-sqlite3`.

Recommended Render settings:

- Build command: `npm install`
- Start command: `npm start`
- Node version: `20`
- Persistent disk mount path: `/var/data`
- `DATABASE_PATH=/var/data/crate.sqlite`
- `SPOTIFY_REDIRECT_URI=https://crate-nhfe.onrender.com/auth/spotify/callback`

Do not run migrations in the Render build command. The app applies pending SQLite migrations on startup, which is appropriate when using the mounted persistent disk. Without a persistent disk, SQLite data will be lost on deploy/restart.

The included `render.yaml` captures the safe defaults for Node 20, startup, and persistent SQLite storage. Set Spotify credentials, `SESSION_SECRET`, and optional `LASTFM_API_KEY` in Render environment variables.

## Training Data Export/Import

Use this one-time workflow to move trained local Crate data into Render without copying users, tokens, tracks, `user_tracks`, playlist IDs, or sync history.

### Artist Genre Seed Only

Use this smaller workflow when you only want to move the trained `artist_genres` fallback data into production.

Export local artist genres:

```bash
npm run artist-genres:export
```

This writes:

```txt
data/artist-genres-seed.json
```

The export normalizes artist names with `trim().toLowerCase()` and includes only:

- `artist_name`
- `genre`
- `source`
- `created_at`

It does not include users, tokens, tracks, `user_tracks`, playlist definitions, playlist sync history, Last.fm cache rows, or track overrides.

After deploying the seed file to Render, sign in with the Spotify account configured as `ADMIN_SPOTIFY_USER_ID`, then import from the production browser console:

```js
fetch("/crate/admin/import-artist-genres", {
  method: "POST",
  credentials: "include"
}).then((response) => response.json()).then(console.log);
```

The import is idempotent and safe to rerun:

- New artist/genre rows are inserted with normalized artist names.
- Existing rows are matched by `lower(trim(artist_name))` plus `genre`.
- Existing production values are not overwritten unless the existing field is blank.
- The response includes `inserted`, `skipped_existing`, `skipped_invalid`, and `updated` counts.

If production tracks were already sorted before importing the seed, run the one-time admin resort endpoint afterward:

```js
fetch("/crate/admin/resort-all", {
  method: "POST",
  credentials: "include"
}).then((response) => response.json()).then(console.log);
```

### Full Training Export

The export includes only:

- `artist_genres`
- `lastfm_artist_tags`
- `track_overrides` as `spotify_track_id` plus `override_playlist_code`

It does not include:

- `users`
- Spotify tokens
- `tracks`
- `user_tracks`
- `playlist_definitions`
- `playlist_sync_runs`

Export local training data:

```bash
npm run training:export
```

This writes:

```txt
data/training-export.json
```

`data/training-export.json` is intentionally allowed through `.gitignore`; SQLite database files remain ignored.

Import on Render after production migrations have run and after production Liked Songs have been synced at least once:

```bash
npm run training:import
```

On Render, make sure:

```txt
DATABASE_PATH=/var/data/crate.sqlite
ADMIN_SPOTIFY_USER_ID=your-spotify-user-id
```

Safety notes:

- The importer uses `INSERT OR IGNORE` for `artist_genres`.
- Last.fm cache rows are upserted by `artist_name`, preserving exported `applied`, `ignored`, or `pending` status.
- Track overrides are matched by `spotify_track_id`; missing production tracks are skipped.
- The importer performs no deletes and does not touch production users, tokens, `user_tracks`, or Spotify playlist IDs.
- Back up `/var/data/crate.sqlite` before importing.

Render free tier does not provide shell access. For the one-time production import, deploy `data/training-export.json`, sign in with the configured admin Spotify account, then call:

```bash
curl -X POST https://crate-nhfe.onrender.com/crate/admin/import-training
```

The route requires an active Crate session cookie and only runs when the logged-in Spotify user ID matches `ADMIN_SPOTIFY_USER_ID`.

## Health Check

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "crate-mvp",
  "uptime_seconds": 12,
  "timestamp": "2026-04-24T12:00:00.000Z"
}
```

You can also run:

```bash
npm run health
```

## Spotify OAuth

Create a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

```txt
http://127.0.0.1:3000/auth/spotify/callback
```

Then fill in these `.env` values:

```txt
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/spotify/callback
```

Start login by opening:

```txt
http://localhost:3000/auth/spotify
```

After approving access, Spotify redirects back to Crate and the app stores:

- Spotify user profile
- Access token
- Refresh token
- Token expiration timestamp
- Granted token scope

Useful auth routes:

- `GET /auth/spotify` - start Spotify login
- `GET /auth/spotify/callback` - Spotify redirect callback
- `GET /auth/me` - show the current connected Crate user
- `POST /auth/logout` - clear the local Crate session cookie

OAuth state and the local user session are stored in signed, HTTP-only cookies. Spotify credentials are stored in SQLite for the MVP.

## Liked Songs Sync

To quickly verify Spotify can return the logged-in user's Liked Songs without storing anything:

```bash
curl http://127.0.0.1:3000/crate/spotify/liked-songs
```

This returns the first page of track names, artist names, and albums from Spotify.

After connecting Spotify, import the current user's Liked Songs:

```bash
curl -X POST http://127.0.0.1:3000/crate/sync-liked-songs
```

When called from a browser or API client that has the Crate session cookie, this route:

- Refreshes the Spotify access token when needed
- Fetches all Liked Songs from `GET /me/tracks` in pages of 50
- Upserts tracks into SQLite
- Upserts the user's liked-track relationship
- Records a `crate_runs` row with summary counts

The endpoint is idempotent. Re-running it updates existing rows and does not duplicate tracks.

## Sorting Tracks

After importing Liked Songs, assign unsorted tracks to placeholder playlist codes:

```bash
curl -X POST http://127.0.0.1:3000/crate/sort
```

The sorter:

- Reads tracks where `user_tracks.playlist_code IS NULL`
- Pulls artist genres from Spotify in batches
- Uses approved local `artist_genres` rows as fallback genres when Spotify has no genres
- Matches genres against the v1 Crate category rules
- Saves the matched `playlist_code` back to `user_tracks`
- Leaves unmatched tracks nullable for later refinement

## Playlist Sync

After tracks have `playlist_code` values, create or update the Spotify playlists managed by Crate:

```bash
curl -X POST http://127.0.0.1:3000/crate/playlists/sync
```

The endpoint:

- Reads sorted tracks from SQLite
- Groups tracks by Crate playlist/category code
- Creates missing private Spotify playlists named like `Crate: Rock`
- Stores created Spotify playlist IDs in `playlist_definitions`
- Reads existing playlist tracks from Spotify before adding anything
- Adds only missing track URIs in batches of 100
- Logs each run in `playlist_sync_runs`

The sync is idempotent. Re-running it should skip tracks already present in Spotify playlists instead of duplicating them.
Crate also removes stale tracks from Crate-managed playlists when a track's effective playlist assignment changes.

Example response:

```json
{
  "status": "ok",
  "run_id": 1,
  "playlists_checked": 17,
  "playlists_created": 17,
  "tracks_added": 5859,
  "duplicates_skipped": 0,
  "errors": []
}
```

## Track Overrides

Use a track-level override when a sorted track belongs in a different Crate playlist than the rule engine selected.

A minimal admin page is available after Spotify login:

```txt
http://127.0.0.1:3000/crate/admin/playlists
```

It shows Crate playlist counts, track lists, override dropdowns, and a button to re-sync Spotify playlists.

Inspect one track:

```bash
curl http://127.0.0.1:3000/crate/track/123
```

Apply or update an override:

```bash
curl -X POST http://127.0.0.1:3000/crate/track/override \
  -H "Content-Type: application/json" \
  -d '{"track_id":123,"playlist_code":"rock"}'
```

The override is saved in `track_overrides`, updates the current `user_tracks.playlist_code`, and is also respected by future sorting runs. Re-run playlist sync afterward:

```bash
curl -X POST http://127.0.0.1:3000/crate/playlists/sync
```

## Review Unmatched Tracks

Inspect tracks that did not match a sorting rule:

```bash
curl "http://127.0.0.1:3000/crate/unmatched?limit=100&offset=0"
```

The endpoint returns JSON sorted by artist name, then track title. `limit` defaults to `100` and is capped at `500`.

Each item includes:

- Track title
- Artist names
- Album name
- Album release date
- Spotify genres from the track artists, when available

Summarize the most common Spotify genres among unmatched tracks:

```bash
curl "http://127.0.0.1:3000/crate/unmatched-genres?limit=100"
```

The endpoint returns:

- Total unmatched tracks
- Total unique genres
- Genre counts sorted highest to lowest

For a fuller diagnostic split:

```bash
curl "http://127.0.0.1:3000/crate/unmatched-diagnostics"
```

This returns total unmatched tracks, counts for unmatched tracks with and without Spotify genres, the top 50 unmatched genres, and 25 sample unmatched tracks with no genres.

Review artists from unmatched tracks where Spotify returned no genre signal:

```bash
curl "http://127.0.0.1:3000/crate/missing-artist-genres?limit=100"
```

This is for manually planning fallback entries in the local `artist_genres` table. Crate does not auto-assign fallback genres yet.

Review curated fallback suggestions for missing artist genres:

```bash
curl "http://127.0.0.1:3000/crate/missing-artist-genre-suggestions?limit=100"
```

This endpoint uses only a local curated seed map for now. It returns suggested genres, suggested playlist code, confidence, and source when a known artist has a seed suggestion; unknown artists return `null` suggestion fields. Suggestions are not auto-applied.

List all curated artist genre suggestions:

```bash
curl "http://127.0.0.1:3000/crate/artist-genre-suggestions?status=unapplied"
```

Supported statuses are `unapplied`, `applied`, and `all`. The default is `unapplied`. Each row includes whether all suggested genres for that artist already exist in `artist_genres`.

Apply a curated artist genre suggestion:

```bash
curl -X POST http://127.0.0.1:3000/crate/artist-genre-suggestions/apply \
  -H "Content-Type: application/json" \
  -d '{"artist_name":"Toad The Wet Sprocket"}'
```

This writes the suggested genres into `artist_genres` with `source = "curated_seed"` and ignores duplicates. Accepted fallback genres are used by the sorting engine on the next `POST /crate/sort` run.

Apply all high-confidence unapplied curated suggestions:

```bash
curl -X POST http://127.0.0.1:3000/crate/artist-genre-suggestions/apply-all
```

This is idempotent and returns the number of artists applied, genre rows inserted, and existing genre rows skipped.

## Last.fm Genre Suggestions

Crate can optionally use Last.fm `artist.getTopTags` as a second-source suggestion cache for artists that still have no Spotify genre data. Last.fm suggestions are review-only by default. They do not affect sorting until you explicitly apply one into the local `artist_genres` fallback table.

Add a Last.fm API key to `.env`:

```txt
LASTFM_API_KEY=...
```

Fetch and cache suggestions for missing artists:

```bash
curl -X POST "http://127.0.0.1:3000/crate/lastfm-artist-genre-suggestions/fetch?limit=25"
```

This endpoint requires auth, skips artists already present in `artist_genres`, skips artists already cached in `lastfm_artist_tags`, and stores raw Last.fm tags plus conservative Crate category mappings.

Review cached Last.fm suggestions:

```bash
curl "http://127.0.0.1:3000/crate/lastfm-artist-genre-suggestions?status=pending"
```

Supported statuses are `pending`, `applied`, `ignored`, `error`, and `all`.

Apply one reviewed Last.fm suggestion:

```bash
curl -X POST http://127.0.0.1:3000/crate/lastfm-artist-genre-suggestions/apply \
  -H "Content-Type: application/json" \
  -d '{"artist_name":"Gorillaz"}'
```

This writes the mapped Crate genres into `artist_genres` with `source = "lastfm"` and marks the cached suggestion as `applied`. Re-run `POST /crate/sort` afterward to classify newly covered tracks.

## Database

SQLite is used for the MVP. By default, the database file lives at:

```txt
./data/crate.sqlite
```

Run migrations with:

```bash
npm run migrate
```

Migration files live in `src/db/migrations`. The migration runner records applied migrations in the `_migrations` table and skips files that have already run.

## Project Structure

```txt
src/
  app.js                 Express app factory
  config.js              Environment config
  server.js              Runtime entrypoint
  db/
    index.js             SQLite connection helper
    migrate.js           Migration runner
    migrations/          SQL migration files
  repositories/
    runs.js              Run logging persistence
    playlists.js         Playlist definition and playlist sync persistence
    tracks.js            Track persistence
    users.js             User persistence
  routes/
    auth.js              Spotify OAuth routes
    crate.js             Crate sync routes
    health.js            Health check route
  crate/
    sortRules.js         Placeholder sorting rules
    sortTracks.js        Track sorting pipeline
    syncPlaylists.js     Spotify playlist creation/update pipeline
    trackContext.js      Shared track parsing helpers
    syncLikedSongs.js    Liked Songs import pipeline
    unmatchedTracks.js   Unmatched track inspection
  spotify/
    artists.js           Spotify artist API calls
    auth.js              Spotify OAuth/token calls
    client.js            Spotify API request helper
    playlists.js         Spotify playlist API calls
    tracks.js            Liked Songs API calls
    tokens.js            Access-token refresh helper
  utils/
    authSession.js       Current-user cookie helper
    cookies.js           Signed cookie helpers
scripts/
  check-health.js        Local health check helper
```

## Available Scripts

- `npm start` - start the server
- `npm run dev` - start the local server
- `npm run migrate` - apply pending database migrations
- `npm run health` - check the running server health endpoint
