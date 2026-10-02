// Does a run look like the same person who played this account before?
//
// humanity.ts judges a run on its own. These compare it with the player's
// history, which a script adding random noise can't match from run to run:
//
// - Rhythm: people are reliably quicker on some letter pairs ("th", "er")
//   than others, and that pattern is personal. Each player keeps a profile of
//   how long every pair takes relative to their usual pace; a run's pairs
//   should line up with it.
// - Speed jumps: people improve gradually. A run far above the player's own
//   recent pace is worth a look.
//
// Like the other checks this only flags; a flag holds a run for review when
// it would raise the player's best (see game.ts).

import type { KeyedEvent } from "./humanity";

// Per letter pair: how many samples the profile has seen (capped so old play
// fades out) and their mean log(gap / the run's median gap).
export type Profile = Record<string, { n: number; mean: number }>;

const PROFILE_CAP = 40;
// A pair counts towards a match once the profile has this many samples of it.
const MIN_PAIR_SAMPLES = 3;
// Pairs the run and profile must share before a match is worth computing.
const MIN_SHARED_PAIRS = 15;

// Mean log-relative gap of each letter pair in a run, from words typed
// cleanly (no typos or backspaces), where each key maps to one letter.
export function runPairs(
  words: readonly string[],
  events: readonly KeyedEvent[],
): Map<string, { n: number; mean: number }> {
  const samples: { pair: string; gap: number }[] = [];
  for (let i = 0; i < events.length; i++) {
    const { keys, typos } = events[i];
    const word = words[i];
    if (!keys || typos > 0 || keys.length !== word.length) continue;
    for (let k = 1; k < keys.length; k++) {
      samples.push({ pair: word[k - 1] + word[k], gap: Math.max(1, keys[k] - keys[k - 1]) });
    }
  }
  const pairs = new Map<string, { n: number; mean: number }>();
  if (samples.length === 0) return pairs;
  const gaps = samples.map((s) => s.gap).sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  for (const { pair, gap } of samples) {
    const value = Math.log(gap / median);
    const p = pairs.get(pair) ?? { n: 0, mean: 0 };
    p.n += 1;
    p.mean += (value - p.mean) / p.n;
    pairs.set(pair, p);
  }
  return pairs;
}

// Pearson correlation between the run's pairs and the profile's, or null when
// they share too few pairs to say. People land well above 0; a script with
// its own made-up rhythm lands near it.
export function rhythmMatch(profile: Profile, run: Map<string, { n: number; mean: number }>): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [pair, r] of run) {
    const p = profile[pair];
    if (!p || p.n < MIN_PAIR_SAMPLES) continue;
    xs.push(p.mean);
    ys.push(r.mean);
  }
  if (xs.length < MIN_SHARED_PAIRS) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}

// The profile with a run's pairs folded in.
export function updateProfile(profile: Profile, run: Map<string, { n: number; mean: number }>): Profile {
  const next: Profile = { ...profile };
  for (const [pair, r] of run) {
    const p = next[pair] ?? { n: 0, mean: 0 };
    const n = p.n + r.n;
    const mean = p.mean + ((r.mean - p.mean) * r.n) / n;
    next[pair] = { n: Math.min(PROFILE_CAP, n), mean: Math.round(mean * 1000) / 1000 };
  }
  return next;
}

// Speed jumps. Measured on the board's players before this shipped: the
// biggest run over the player's own recent median was 1.39× (+38 wpm), and
// 1.3× came up in 3% of runs. Flag well past that.
const JUMP_RATIO = 1.5;
const JUMP_MIN_WPM = 25;
// Earlier runs needed before a jump means anything, and how many to compare
// against.
export const JUMP_MIN_HISTORY = 10;
export const JUMP_HISTORY = 30;
// Runs shorter than this are too noisy to judge or to compare against.
export const JUMP_MIN_WORDS = 10;

export function speedJump(runWpm: number, recentWpms: readonly number[]): boolean {
  if (recentWpms.length < JUMP_MIN_HISTORY) return false;
  const sorted = [...recentWpms].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return runWpm >= median * JUMP_RATIO && runWpm - median >= JUMP_MIN_WPM;
}
