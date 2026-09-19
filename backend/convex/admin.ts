import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Moderation: `npx convex run admin:removePlayer '{"name":"someone"}'`
// Deletes the player with their runs and any live session.
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
    await Promise.all([
      ...runs.map((r) => ctx.db.delete("runs", r._id)),
      ...sessions.map((s) => ctx.db.delete("sessions", s._id)),
      ctx.db.delete("players", player._id),
    ]);
    return { removed: true, runs: runs.length };
  },
});

// Review queue: `npx convex run admin:pendingRuns`
// Runs that would have raised a player's best but looked unusual (see
// lib/humanity.ts) or would have reshaped the top of the board.
export const pendingRuns = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      runId: v.id("runs"),
      name: v.string(),
      score: v.number(),
      words: v.number(),
      currentBest: v.number(),
      playedAt: v.string(),
      flags: v.array(v.string()),
      stats: v.any(),
    }),
  ),
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(100);
    const rows = [];
    for (const run of runs) {
      const player = await ctx.db.get("players", run.playerId);
      if (!player) continue;
      rows.push({
        runId: run._id,
        name: player.name,
        score: run.score,
        words: run.words,
        currentBest: player.bestScore,
        playedAt: new Date(run._creationTime).toISOString(),
        flags: run.flags ?? [],
        stats: run.stats ?? null,
      });
    }
    return rows;
  },
});

// `npx convex run admin:approveRun '{"runId":"..."}'`
// Ranks the run and raises the player's best if it's higher.
export const approveRun = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.object({ name: v.string(), bestScore: v.number() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.status !== "pending") throw new Error("No pending run with that id");
    const player = await ctx.db.get("players", run.playerId);
    if (!player) throw new Error("That run's player no longer exists");
    await ctx.db.patch("runs", run._id, { status: "ranked" });
    if (run.score > player.bestScore) {
      await ctx.db.patch("players", player._id, { bestScore: run.score, bestWords: run.words });
    }
    return { name: player.name, bestScore: Math.max(run.score, player.bestScore) };
  },
});

// `npx convex run admin:rejectRun '{"runId":"..."}'`
// Keeps the run in the player's history as rejected; the board never sees it.
export const rejectRun = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.status !== "pending") throw new Error("No pending run with that id");
    await ctx.db.patch("runs", run._id, { status: "rejected" });
    return null;
  },
});
