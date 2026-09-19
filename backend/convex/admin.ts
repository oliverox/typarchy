import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
