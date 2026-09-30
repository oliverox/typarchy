import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const pendingRow = v.object({
  runId: v.id("runs"),
  name: v.string(),
  score: v.number(),
  words: v.number(),
  currentBest: v.number(),
  playedAt: v.number(),
  flags: v.array(v.string()),
  stats: v.union(
    v.null(),
    v.object({
      medianReactionMs: v.number(),
      msPerLetter: v.number(),
      keyGapCv: v.union(v.number(), v.null()),
      reactionCv: v.union(v.number(), v.null()),
      typos: v.number(),
    }),
  ),
});

function pendingRuns(ctx: QueryCtx) {
  return ctx.db
    .query("runs")
    .withIndex("by_status", (q) => q.eq("status", "pending"))
    .take(100);
}

// One row per player: their highest held run. A player on a streak can pile
// up several held runs that each beat #1, but only the top one can change the
// board. Approving it settles the rest; rejecting it brings up the next.
export async function listPending(ctx: QueryCtx) {
  const top = new Map<Id<"players">, Doc<"runs">>();
  for (const run of await pendingRuns(ctx)) {
    const held = top.get(run.playerId);
    if (!held || run.score > held.score) top.set(run.playerId, run);
  }
  const rows = [];
  for (const run of top.values()) {
    const player = await ctx.db.get("players", run.playerId);
    if (!player) continue;
    rows.push({
      runId: run._id,
      name: player.name,
      score: run.score,
      words: run.words,
      currentBest: player.bestScore,
      playedAt: run._creationTime,
      flags: run.flags ?? [],
      stats: run.stats ?? null,
    });
  }
  return rows;
}

// Approving ranks the run and raises the player's best if it's higher, and
// ranks the player's lower held runs with it: they can't change the board.
// Rejecting keeps it in their history, off the board.
export async function reviewRun(
  ctx: MutationCtx,
  runId: Id<"runs">,
  status: "ranked" | "rejected",
  reviewedBy: Id<"players"> | undefined,
): Promise<null> {
  const run = await ctx.db.get("runs", runId);
  if (!run || run.status !== "pending") throw new Error("No pending run with that id");
  await ctx.db.patch("runs", run._id, { status, reviewedBy });
  if (status === "ranked") {
    for (const other of await pendingRuns(ctx)) {
      if (other.playerId === run.playerId && other.score <= run.score) {
        await ctx.db.patch("runs", other._id, { status, reviewedBy });
      }
    }
    const player = await ctx.db.get("players", run.playerId);
    if (player && run.score > player.bestScore) {
      await ctx.db.patch("players", player._id, { bestScore: run.score, bestWords: run.words });
    }
  }
  return null;
}
