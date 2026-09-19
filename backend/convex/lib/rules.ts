// Survival rules. The plugin mirrors these in Rules.js; scripts/rules.test.ts
// replays the same runs through both so the two can't drift apart.

export const START_WINDOW_MS = 4200;
export const MIN_WINDOW_MS = 1200;
export const WINDOW_DECAY = 0.965;

// A word appears only when the previous one is done, so nobody can start it
// early: seeing it and pressing the first key takes at least MIN_REACTION_MS,
// and every further letter at least MIN_MS_PER_KEY on average (≈340 WPM,
// beyond the fastest human bursts).
export const MIN_REACTION_MS = 150;
export const MIN_MS_PER_KEY = 35;

export function minimumWordMs(word: string): number {
  return MIN_REACTION_MS + (word.length - 1) * MIN_MS_PER_KEY;
}

export type WordEvent = {
  // Milliseconds since the run started when the word was completed.
  t: number;
  // Wrong keystrokes made while typing this word. They break the streak but
  // cost no time.
  typos: number;
};

export type Replay =
  | {
      ok: true;
      score: number;
      words: number;
      bestStreak: number;
      // When the clock ran out on the word that ended the run.
      endT: number;
    }
  | { ok: false; reason: string };

export function nextWindow(windowMs: number): number {
  return Math.max(MIN_WINDOW_MS, windowMs * WINDOW_DECAY);
}

export function wordScore(word: string, remainingMs: number): number {
  return word.length * 10 + Math.round(remainingMs / 100);
}

export function replay(
  words: readonly string[],
  events: readonly WordEvent[],
): Replay {
  if (events.length > words.length) {
    return { ok: false, reason: "more words than were issued" };
  }

  let windowMs = START_WINDOW_MS;
  let wordStart = 0;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;

  for (let i = 0; i < events.length; i++) {
    const { t, typos } = events[i];
    const word = words[i];
    if (!Number.isFinite(t) || !Number.isInteger(typos) || typos < 0) {
      return { ok: false, reason: `malformed event ${i}` };
    }
    if (t - wordStart < minimumWordMs(word)) {
      return { ok: false, reason: `word ${i} typed impossibly fast` };
    }
    const deadline = wordStart + windowMs;
    if (t > deadline) {
      return { ok: false, reason: `word ${i} finished after the clock ran out` };
    }

    score += wordScore(word, deadline - t);
    streak = typos > 0 ? 1 : streak + 1;
    bestStreak = Math.max(bestStreak, streak);
    windowMs = nextWindow(windowMs);
    wordStart = t;
  }

  return { ok: true, score, words: events.length, bestStreak, endT: wordStart + windowMs };
}
