import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  players: defineTable({
    name: v.string(),
    nameKey: v.string(),
    tokenHash: v.string(),
    bestScore: v.number(),
    bestWords: v.number(),
    runCount: v.number(),
    // Can approve and reject held runs from the game. Only settable with
    // deploy access: `npx convex run --prod admin:setAdmin`.
    isAdmin: v.optional(v.boolean()),
  })
    .index("by_nameKey", ["nameKey"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_bestScore", ["bestScore"]),

  // A run in progress. The server hands out the words and timestamps every
  // checkpoint, so a submitted run has to line up with real elapsed time.
  sessions: defineTable({
    playerId: v.id("players"),
    startedAt: v.number(),
    words: v.array(v.string()),
    checkpoints: v.array(
      v.object({ count: v.number(), t: v.number(), at: v.number() }),
    ),
  })
    .index("by_player", ["playerId"])
    .index("by_startedAt", ["startedAt"]),

  // One document: common English words pulled from Wiktionary by wordSync.
  wordPool: defineTable({
    words: v.array(v.string()),
    source: v.string(),
    refreshedAt: v.number(),
  }),

  runs: defineTable({
    playerId: v.id("players"),
    score: v.number(),
    words: v.number(),
    bestStreak: v.number(),
    durationMs: v.number(),
    // Missing on runs from before review existed: those count as ranked.
    // A pending run waits for `admin:approveRun` before it counts.
    status: v.optional(v.union(v.literal("ranked"), v.literal("pending"), v.literal("rejected"))),
    // Why the run was held for review.
    flags: v.optional(v.array(v.string())),
    // The admin who approved or rejected a held run.
    reviewedBy: v.optional(v.id("players")),
    stats: v.optional(
      v.object({
        medianReactionMs: v.number(),
        msPerLetter: v.number(),
        keyGapCv: v.union(v.number(), v.null()),
        reactionCv: v.union(v.number(), v.null()),
        typos: v.number(),
      }),
    ),
  })
    .index("by_player", ["playerId"])
    .index("by_status", ["status"]),

  rateLimits: defineTable({
    key: v.string(),
    tokens: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
