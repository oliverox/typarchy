import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { findPlayer, hashToken, newToken } from "./lib/auth";
import { consume, NICKNAME_CLAIMS } from "./lib/rateLimit";

const NAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;
const RANK_SCAN_LIMIT = 10_000;

export const register = mutation({
  args: { name: v.string() },
  returns: v.object({ name: v.string(), token: v.string() }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!NAME_PATTERN.test(name)) {
      throw new ConvexError({
        code: "BAD_NAME",
        message: "Nicknames are 3–16 letters, digits, _ or -.",
      });
    }
    const nameKey = name.toLowerCase();
    const taken = await ctx.db
      .query("players")
      .withIndex("by_nameKey", (q) => q.eq("nameKey", nameKey))
      .unique();
    if (taken) {
      throw new ConvexError({
        code: "NAME_TAKEN",
        message: `"${taken.name}" is already taken.`,
      });
    }

    await consume(ctx, "register", NICKNAME_CLAIMS);
    const token = newToken();
    await ctx.db.insert("players", {
      name,
      nameKey,
      tokenHash: await hashToken(token),
      bestScore: 0,
      bestWords: 0,
      runCount: 0,
    });
    return { name, token };
  },
});

// Players ranked strictly above this score, plus one. Capped so the scan stays
// cheap; beyond the cap the caller just shows the cap.
export async function rankFor(ctx: QueryCtx, player: Doc<"players">) {
  if (player.bestScore <= 0) return null;
  const above = await ctx.db
    .query("players")
    .withIndex("by_bestScore", (q) => q.gt("bestScore", player.bestScore))
    .take(RANK_SCAN_LIMIT);
  return above.length + 1;
}

export const me = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      bestScore: v.number(),
      runCount: v.number(),
      rank: v.union(v.number(), v.null()),
      recentRuns: v.array(
        v.object({
          score: v.number(),
          words: v.number(),
          bestStreak: v.number(),
          playedAt: v.number(),
          status: v.union(v.literal("ranked"), v.literal("pending"), v.literal("rejected")),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    if (!player) return null;
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .order("desc")
      .take(5);
    return {
      name: player.name,
      bestScore: player.bestScore,
      runCount: player.runCount,
      rank: await rankFor(ctx, player),
      recentRuns: runs.map((r) => ({
        score: r.score,
        words: r.words,
        bestStreak: r.bestStreak,
        playedAt: r._creationTime,
        status: r.status ?? "ranked",
      })),
    };
  },
});
