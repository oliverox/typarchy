// Survival rules. The plugin mirrors these in Rules.js; scripts/rules.test.ts
// replays the same runs through both so the two can't drift apart.

export const START_WINDOW_MS = 4200;
export const MIN_WINDOW_MS = 1200;
export const WINDOW_DECAY = 0.965;

// Bumped whenever a change here would make the server reject runs played by
// the previous rules. Clients send it to `game:start`.
export const RULES_VERSION = 2;

// The clock above is sized for a word of AVERAGE_LETTERS (the pool averages
// ~7.25). Each word's own window scales with its letters plus a reaction worth
// REACTION_LETTERS, so a long word gets the same pace per letter as a short one.
export const AVERAGE_LETTERS = 7;
export const REACTION_LETTERS = 2;

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

export function wordWindow(windowMs: number, word: string): number {
  return (windowMs * (REACTION_LETTERS + word.length)) / (REACTION_LETTERS + AVERAGE_LETTERS);
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
    const deadline = wordStart + wordWindow(windowMs, word);
    if (t > deadline) {
      return { ok: false, reason: `word ${i} finished after the clock ran out` };
    }

    score += wordScore(word, deadline - t);
    streak = typos > 0 ? 1 : streak + 1;
    bestStreak = Math.max(bestStreak, streak);
    windowMs = nextWindow(windowMs);
    wordStart = t;
  }

  // The word on screen when the clock ran out. A run can only outlast its
  // issued words by ending on the last one, so fall back to the bare clock.
  const last = words[events.length];
  const endT = wordStart + (last === undefined ? windowMs : wordWindow(windowMs, last));
  return { ok: true, score, words: events.length, bestStreak, endT };
}

export type FastWord = { index: number; word: string; ms: number; minimumMs: number };

// Words finished sooner after the previous one than anyone can read and type
// them. Kept out of replay so the server can decide how many to forgive: one
// can be a timing hiccup on the player's machine, a habit of it can't.
// Expects events that replay accepted.
export function tooFastWords(words: readonly string[], events: readonly WordEvent[]): FastWord[] {
  const fast: FastWord[] = [];
  let wordStart = 0;
  for (let i = 0; i < events.length; i++) {
    const ms = events[i].t - wordStart;
    const minimumMs = minimumWordMs(words[i]);
    if (ms < minimumMs) fast.push({ index: i, word: words[i], ms, minimumMs });
    wordStart = events[i].t;
  }
  return fast;
}
