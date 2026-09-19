import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

// Token bucket: `capacity` actions at once, refilled at `perHour`.
export type Limit = { capacity: number; perHour: number };

// Starting runs, per player. Leaves room for quick restarts, not for grinding.
export const RUN_STARTS: Limit = { capacity: 30, perHour: 60 };
// Claiming nicknames, across everyone: the server can't tell callers apart, so
// this caps how fast a script can mint fresh players.
export const NICKNAME_CLAIMS: Limit = { capacity: 20, perHour: 20 };

export async function consume(ctx: MutationCtx, key: string, limit: Limit): Promise<void> {
  const now = Date.now();
  const refillPerMs = limit.perHour / 3_600_000;
  const bucket = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const tokens = bucket
    ? Math.min(limit.capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs)
    : limit.capacity;

  if (tokens < 1) {
    const waitMinutes = Math.ceil((1 - tokens) / refillPerMs / 60_000);
    throw new ConvexError({
      code: "RATE_LIMITED",
      message: `Too many tries. Wait ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`,
    });
  }
  if (bucket) await ctx.db.patch("rateLimits", bucket._id, { tokens: tokens - 1, updatedAt: now });
  else await ctx.db.insert("rateLimits", { key, tokens: tokens - 1, updatedAt: now });
}
