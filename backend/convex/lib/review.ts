import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

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

export async function listPending(ctx: QueryCtx) {
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
      playedAt: run._creationTime,
      flags: run.flags ?? [],
      stats: run.stats ?? null,
    });
  }
  return rows;
}

// Approving ranks the run and raises the player's best if it's higher.
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
    const player = await ctx.db.get("players", run.playerId);
    if (player && run.score > player.bestScore) {
      await ctx.db.patch("players", player._id, { bestScore: run.score, bestWords: run.words });
    }
  }
  return null;
}
