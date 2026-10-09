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

The plugin talks to the URL in [`bin/typarchy-api`](../bin/typarchy-api) (`CONVEX_URL`). To play against a local backend, set
`TYPARCHY_CONVEX_URL=http://127.0.0.1:3210` in the shell's environment. Only loopback
`http://127.0.0.1` or `http://localhost` URLs are accepted; anything else is ignored. A local
backend gets its own nickname and token in `~/.local/state/typarchy-dev/`, so your real
token is never sent to it.

## Going to production

```bash
npx convex deploy
npx convex run --prod wordSync:refresh
```

Then set `CONVEX_URL` in [`bin/typarchy-api`](../bin/typarchy-api) to the production deployment URL.

The weekly board needs no cron: each player's weekly best is stamped with its week
(Monday 00:00 UTC, see `convex/lib/weeks.ts`) and stops counting when the week turns. On a
deployment that already has runs from before the weekly board existed, fill in the current
week once:

```bash
npx convex run --prod admin:backfillWeek
```

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
