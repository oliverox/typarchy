import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayer } from "./lib/auth";
import { replay } from "./lib/rules";
import { rankFor } from "./players";

const INITIAL_WORDS = 150;
const EXTRA_WORDS = 100;
// Top up once the player is this close to the end of the issued words.
const TOP_UP_MARGIN = 60;
// Convex arrays hold at most 8192 values.
const MAX_SESSION_WORDS = 8000;

export const CHECKPOINT_EVERY = 10;
// How many expected checkpoints may be lost to network trouble.
const MISSING_CHECKPOINT_ALLOWANCE = 2;

// lag = server time since start − client time since start. It starts at the
// request latency of `start` and should stay there. Growth means the client
// clock was paused (or its timestamps were invented).
const MIN_LAG_MS = -1500;
const MAX_LAG_MS = 10_000;

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

async function drawWords(ctx: MutationCtx, count: number): Promise<string[]> {
  const pool = await ctx.db.query("wordPool").first();
  if (!pool || pool.words.length === 0) {
    throw new ConvexError({
      code: "NO_WORDS",
      message: "The word pool is still loading from Wiktionary. Try again shortly.",
    });
  }
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    let word = pool.words[Math.floor(Math.random() * pool.words.length)];
    // Avoid the same word twice in a row, like the website does.
    if (word === drawn[drawn.length - 1] && pool.words.length > 1) {
      word = pool.words[(pool.words.indexOf(word) + 1) % pool.words.length];
    }
    drawn.push(word);
  }
  return drawn;
}

async function ownedSession(
  ctx: MutationCtx,
  player: Doc<"players">,
  sessionId: Id<"sessions">,
): Promise<Doc<"sessions">> {
  const session = await ctx.db.get("sessions", sessionId);
  if (!session || session.playerId !== player._id) {
    throw new ConvexError({
      code: "NO_SESSION",
      message: "That run is no longer active.",
    });
  }
  return session;
}

export const start = mutation({
  args: { token: v.string() },
  returns: v.object({
    sessionId: v.id("sessions"),
    words: v.array(v.string()),
    checkpointEvery: v.number(),
  }),
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.token);

    // One live run per player; starting again abandons the previous one.
    const previous = await ctx.db
      .query("sessions")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();
    await Promise.all(previous.map((s) => ctx.db.delete("sessions", s._id)));

    const words = await drawWords(ctx, INITIAL_WORDS);
    const sessionId = await ctx.db.insert("sessions", {
      playerId: player._id,
      startedAt: Date.now(),
      words,
      checkpoints: [],
    });
    return { sessionId, words, checkpointEvery: CHECKPOINT_EVERY };
  },
});

export const checkpoint = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("sessions"),
    count: v.number(),
    t: v.number(),
  },
  returns: v.object({ words: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.token);
    const session = await ownedSession(ctx, player, args.sessionId);

    const checkpoints = session.checkpoints.some((c) => c.count === args.count)
      ? session.checkpoints
      : [...session.checkpoints, { count: args.count, t: args.t, at: Date.now() }];

    let extra: string[] = [];
    const room = MAX_SESSION_WORDS - session.words.length;
    if (args.count + TOP_UP_MARGIN > session.words.length && room > 0) {
      extra = await drawWords(ctx, Math.min(EXTRA_WORDS, room));
    }

    await ctx.db.patch("sessions", session._id, {
      checkpoints,
      words: [...session.words, ...extra],
    });
    return { words: extra };
  },
});

export const submit = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("sessions"),
    events: v.array(v.object({ t: v.number(), typos: v.number() })),
  },
  returns: v.union(
    v.object({
      accepted: v.literal(true),
      score: v.number(),
      words: v.number(),
      bestStreak: v.number(),
      personalBest: v.number(),
      isPersonalBest: v.boolean(),
      rank: v.union(v.number(), v.null()),
    }),
    v.object({ accepted: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.token);
    const session = await ownedSession(ctx, player, args.sessionId);
    // Sessions are single-use whatever the verdict.
    await ctx.db.delete("sessions", session._id);

    const verdict = verify(session, args.events, Date.now());
    if (!verdict.ok) {
      return { accepted: false as const, reason: verdict.reason };
    }

    const isPersonalBest = verdict.score > player.bestScore;
    const updated = {
      ...player,
      runCount: player.runCount + 1,
      bestScore: isPersonalBest ? verdict.score : player.bestScore,
      bestWords: isPersonalBest ? verdict.words : player.bestWords,
    };
    await ctx.db.patch("players", player._id, {
      runCount: updated.runCount,
      bestScore: updated.bestScore,
      bestWords: updated.bestWords,
    });
    if (verdict.words > 0) {
      await ctx.db.insert("runs", {
        playerId: player._id,
        score: verdict.score,
        words: verdict.words,
        bestStreak: verdict.bestStreak,
        durationMs: Math.round(verdict.endT),
      });
    }

    return {
      accepted: true as const,
      score: verdict.score,
      words: verdict.words,
      bestStreak: verdict.bestStreak,
      personalBest: updated.bestScore,
      isPersonalBest,
      rank: await rankFor(ctx, updated),
    };
  },
});

function verify(
  session: Doc<"sessions">,
  events: { t: number; typos: number }[],
  now: number,
) {
  const result = replay(session.words, events);
  if (!result.ok) return result;

  const elapsed = now - session.startedAt;
  const lagOk = (lag: number) => lag >= MIN_LAG_MS && lag <= MAX_LAG_MS;
  if (!lagOk(elapsed - result.endT)) {
    return { ok: false as const, reason: "run timing didn't match the server clock" };
  }

  let matched = 0;
  for (const cp of session.checkpoints) {
    if (cp.count < 1 || cp.count > events.length) continue;
    if (Math.abs(events[cp.count - 1].t - cp.t) > 1) {
      return { ok: false as const, reason: `checkpoint ${cp.count} doesn't match the run` };
    }
    if (!lagOk(cp.at - session.startedAt - cp.t)) {
      return { ok: false as const, reason: `run was paused around word ${cp.count}` };
    }
    matched++;
  }
  const expected = Math.floor(events.length / CHECKPOINT_EVERY);
  if (matched < expected - MISSING_CHECKPOINT_ALLOWANCE) {
    return { ok: false as const, reason: "too many checkpoints never reached the server" };
  }

  return result;
}

export const expireSessions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_startedAt", (q) => q.lt("startedAt", Date.now() - SESSION_TTL_MS))
      .take(500);
    await Promise.all(stale.map((s) => ctx.db.delete("sessions", s._id)));
    return null;
  },
});
