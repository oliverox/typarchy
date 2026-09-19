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
  }).index("by_player", ["playerId"]),
});
