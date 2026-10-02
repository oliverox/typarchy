import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { wpm } from "./lib/humanity";
import { listPending, pendingRow, reviewRun } from "./lib/review";

// Moderation: `npx convex run admin:removePlayer '{"name":"someone"}'`
// Deletes the player with their runs, rhythm profile and any live session.
export const removePlayer = internalMutation({
  args: { name: v.string() },
  returns: v.object({ removed: v.boolean(), runs: v.number() }),
  handler: async (ctx, args) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_nameKey", (q) => q.eq("nameKey", args.name.trim().toLowerCase()))
      .unique();
    if (!player) return { removed: false, runs: 0 };

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();
    const rhythms = await ctx.db
      .query("rhythms")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();
    await Promise.all([
      ...rhythms.map((r) => ctx.db.delete("rhythms", r._id)),
      ...runs.map((r) => ctx.db.delete("runs", r._id)),
      ...sessions.map((s) => ctx.db.delete("sessions", s._id)),
      ctx.db.delete("players", player._id),
    ]);
    return { removed: true, runs: runs.length };
  },
});

// `npx convex run --prod admin:setAdmin '{"name":"andre","isAdmin":true}'`
// Admins see held runs in the game's leaderboard and can approve or reject them.
export const setAdmin = internalMutation({
  args: { name: v.string(), isAdmin: v.boolean() },
  returns: v.object({ name: v.string(), isAdmin: v.boolean() }),
  handler: async (ctx, args) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_nameKey", (q) => q.eq("nameKey", args.name.trim().toLowerCase()))
      .unique();
    if (!player) throw new Error(`No player named ${args.name}`);
    await ctx.db.patch("players", player._id, { isAdmin: args.isAdmin });
    return { name: player.name, isAdmin: args.isAdmin };
  },
});

// Review queue: `npx convex run admin:pendingRuns`
// Runs that would have raised a player's best but looked unusual (see
// lib/humanity.ts) or would have reshaped the top of the board.
export const pendingRuns = internalQuery({
  args: {},
  returns: v.array(pendingRow),
  handler: async (ctx) => await listPending(ctx),
});

// `npx convex run admin:approveRun '{"runId":"..."}'`
// Ranks the run and raises the player's best if it's higher.
export const approveRun = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => await reviewRun(ctx, args.runId, "ranked", undefined),
});

// `npx convex run admin:rejectRun '{"runId":"..."}'`
// Keeps the run in the player's history as rejected; the board never sees it.
export const rejectRun = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => await reviewRun(ctx, args.runId, "rejected", undefined),
});

// One-off: `npx convex run --prod admin:backfillBestWpm`
// Sets bestWpm from each player's best counted run, for bests set before the
// leaderboard showed speed. Players whose best has no keystroke stats keep none.
export const backfillBestWpm = internalMutation({
  args: {},
  returns: v.object({ players: v.number(), filled: v.number() }),
  handler: async (ctx) => {
    const players = await ctx.db.query("players").take(1000);
    let filled = 0;
    for (const player of players) {
      if (player.bestWpm !== undefined || player.bestScore <= 0) continue;
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_player", (q) => q.eq("playerId", player._id))
        .collect();
      const best = runs.find(
        (r) => r.score === player.bestScore && (r.status ?? "ranked") === "ranked" && r.stats,
      );
      const speed = wpm(best?.stats);
      if (speed === undefined) continue;
      await ctx.db.patch("players", player._id, { bestWpm: speed });
      filled++;
    }
    return { players: players.length, filled };
  },
});
