# Typarchy backend

The [Convex](https://convex.dev) deployment behind Typarchy's worldwide leaderboard: players,
run sessions, server-side replay and bot checks, the review queue, and the word pool.
Players don't need any of this; it's for running the leaderboard.

## Setup

From this folder:

```bash
npm install
npx convex dev                       # dev deployment, writes .env.local
npx convex run wordSync:refresh      # fill the word pool (≈30s)
npm test
```

The plugin talks to the URL in [`Config.js`](../Config.js) (override with `TYPARCHY_CONVEX_URL` in the
shell's environment).

## Going to production

```bash
npx convex deploy
npx convex run --prod wordSync:refresh
```

Then set [`Config.js`](../Config.js) → `convexUrl` to the production deployment URL.

## Moderation

Admins review held runs in the game: the leaderboard tab lists them with approve and
reject buttons. Only players flagged as admin see the list, and the server checks the flag
on every call, so a modified client gets nowhere. The flag can only be set with deploy
access:

```bash
npx convex run admin:setAdmin '{"name":"someone","isAdmin":true}'
```

The same review works from the command line:

```bash
npx convex run admin:pendingRuns                           # runs held for review, with why
npx convex run admin:approveRun '{"runId":"..."}'           # rank it
npx convex run admin:rejectRun '{"runId":"..."}'            # keep it off the board
npx convex run admin:removePlayer '{"name":"someone"}'      # delete a player and their runs
```

Add `--prod` to run these against production.
