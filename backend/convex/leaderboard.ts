import { v } from "convex/values";
import { query } from "./_generated/server";
import { weekOf, WEEK_MS } from "./lib/weeks";

const row = v.object({
  rank: v.number(),
  name: v.string(),
  country: v.union(v.string(), v.null()),
  score: v.number(),
  words: v.number(),
  // Typing speed of that best run; null when it predates keystroke stats.
  wpm: v.union(v.number(), v.null()),
});

export const top = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(row),
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
      country: p.country ?? null,
      score: p.bestScore,
      words: p.bestWords,
      wpm: p.bestWpm ?? null,
    }));
  },
});

// Each player's best ranked run since Monday 00:00 UTC. The board empties
// itself when the week turns: last week's bests no longer match.
// The plugin calls this once per refresh rather than subscribing, so reading
// the clock here can't leave a stale week on screen.
export const weekly = query({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ endsAt: v.number(), players: v.array(row) }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
    const week = weekOf(Date.now());
    const players = await ctx.db
      .query("players")
      .withIndex("by_week", (q) => q.eq("week", week).gt("weekScore", 0))
      .order("desc")
      .take(limit);
    return {
      endsAt: week + WEEK_MS,
      players: players.map((p, i) => ({
        rank: i + 1,
        name: p.name,
        country: p.country ?? null,
        score: p.weekScore ?? 0,
        words: p.weekWords ?? 0,
        wpm: p.weekWpm ?? null,
      })),
    };
  },
});
