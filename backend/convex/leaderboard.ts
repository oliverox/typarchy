import { v } from "convex/values";
import { query } from "./_generated/server";

export const top = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      rank: v.number(),
      name: v.string(),
      score: v.number(),
      words: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
    const players = await ctx.db
      .query("players")
      .withIndex("by_bestScore", (q) => q.gt("bestScore", 0))
      .order("desc")
      .take(limit);
    return players.map((p, i) => ({
      rank: i + 1,
      name: p.name,
      score: p.bestScore,
      words: p.bestWords,
    }));
  },
});
