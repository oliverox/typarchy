import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { findPlayer, hashToken, newToken, requirePlayer } from "./lib/auth";
import { COUNTRY_CODES } from "./lib/countries";
import { wpm } from "./lib/humanity";
import { consume, COUNTRY_CHANGES, NICKNAME_CLAIMS } from "./lib/rateLimit";

const NAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;
const RANK_SCAN_LIMIT = 10_000;

// A known country code, or undefined for "no flag". Anything else is refused.
function checkCountry(country: string | null | undefined): string | undefined {
  if (country === null || country === undefined || country === "") return undefined;
  if (!COUNTRY_CODES.has(country)) {
    throw new ConvexError({ code: "BAD_COUNTRY", message: "Unknown country." });
  }
  return country;
}

export const register = mutation({
  args: { name: v.string(), country: v.optional(v.string()) },
  returns: v.object({ name: v.string(), token: v.string() }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!NAME_PATTERN.test(name)) {
      throw new ConvexError({
        code: "BAD_NAME",
        message: "Nicknames are 3–16 letters, digits, _ or -.",
      });
    }
    const country = checkCountry(args.country);
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
      ...(country ? { country } : {}),
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

// The flag a player shows next to their name, or none.
export const setCountry = mutation({
  args: { token: v.string(), country: v.union(v.string(), v.null()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.token);
    const country = checkCountry(args.country);
    await consume(ctx, `country:${player._id}`, COUNTRY_CHANGES);
    await ctx.db.patch("players", player._id, { country });
    return country ?? null;
  },
});

export const me = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      bestScore: v.number(),
      runCount: v.number(),
      rank: v.union(v.number(), v.null()),
      country: v.union(v.string(), v.null()),
      isAdmin: v.boolean(),
      recentRuns: v.array(
        v.object({
          score: v.number(),
          words: v.number(),
          bestStreak: v.number(),
          // Typing speed; null for runs from before keystroke stats.
          wpm: v.union(v.number(), v.null()),
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
      country: player.country ?? null,
      isAdmin: player.isAdmin === true,
      recentRuns: runs.map((r) => ({
        score: r.score,
        words: r.words,
        bestStreak: r.bestStreak,
        wpm: wpm(r.stats) ?? null,
        playedAt: r._creationTime,
        status: r.status ?? "ranked",
      })),
    };
  },
});
