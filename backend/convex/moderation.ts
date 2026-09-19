import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { findPlayer } from "./lib/auth";
import { listPending, pendingRow, reviewRun } from "./lib/review";

// Moderation from inside the game. Callable by anyone, so every function
// looks the caller up by their secret token and checks the isAdmin flag on
// their player record, which only admin:setAdmin (deploy access) can set.
// Nicknames and whatever the client shows are never trusted.

async function requireAdmin(ctx: QueryCtx, token: string) {
  const player = await findPlayer(ctx, token);
  if (!player?.isAdmin) {
    throw new ConvexError({ code: "NOT_ADMIN", message: "Only admins can review runs." });
  }
  return player;
}

export const pending = query({
  args: { token: v.string() },
  returns: v.array(pendingRow),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await listPending(ctx);
  },
});

export const review = mutation({
  args: {
    token: v.string(),
    runId: v.id("runs"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    const status = args.decision === "approve" ? "ranked" : "rejected";
    try {
      return await reviewRun(ctx, args.runId, status, admin._id);
    } catch {
      throw new ConvexError({ code: "NO_RUN", message: "That run was already reviewed." });
    }
  },
});
