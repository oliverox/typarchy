// Does a run's keystroke log look like a person typing?
//
// Each submitted word carries `keys`: the run-relative time of every key that
// touched it (letters, typos, backspaces), ending with the letter that
// completed it. A script can call the API or drive the real client, so none of
// this proves a human played. It stops runs that are machine-regular, and holds
// runs that are merely unusual for a person to look at (see game.ts).

import { MIN_REACTION_MS } from "./rules.ts";

export type KeyedEvent = { t: number; typos: number; keys?: number[] };

export type RunStats = {
  // Median time from a word appearing to its first key.
  medianReactionMs: number;
  // Average time per letter after the first, over the whole run.
  msPerLetter: number;
  // Spread of the gaps between keys inside words (std / mean). People are
  // uneven: some letter pairs roll, others stretch. Scripts are metronomes.
  keyGapCv: number | null;
  // Spread of reaction times, same idea.
  reactionCv: number | null;
  typos: number;
};

export type Verdict =
  | { ok: true; stats: RunStats; flags: string[] }
  | { ok: false; reason: string };

const MAX_KEYS_PER_WORD = 200;
// Enough samples before judging a spread.
const MIN_GAPS_FOR_CV = 40;
const MIN_WORDS_FOR_REACTION_CV = 15;

// Below these no person types: reject.
const REJECT_KEY_GAP_CV = 0.15;
const REJECT_REACTION_CV = 0.08;

// Possible for a person, but worth a look before it reaches the board.
const REVIEW_KEY_GAP_CV = 0.25;
const REVIEW_MS_PER_LETTER = 55; // ≈ 220 WPM sustained
const REVIEW_MEDIAN_REACTION_MS = 200;
const REVIEW_CLEAN_WORDS = 60;
const MIN_WORDS_FOR_SPEED_FLAGS = 10;

export const OLD_CLIENT_REASON =
  "this version of Typarchy can't be ranked any more. Update it with `omarchy plugin update typarchy.game`";

function spread(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function analyze(words: readonly string[], events: readonly KeyedEvent[]): Verdict {
  const reactions: number[] = [];
  const gaps: number[] = [];
  let typingMs = 0;
  let laterLetters = 0;
  let typos = 0;
  let wordStart = 0;

  for (let i = 0; i < events.length; i++) {
    const { t, keys } = events[i];
    const word = words[i];
    if (!keys) return { ok: false, reason: OLD_CLIENT_REASON };
    const bad = { ok: false as const, reason: `keystrokes for word ${i} don't match the run` };
    if (keys.length < word.length + events[i].typos || keys.length > MAX_KEYS_PER_WORD) return bad;
    if (keys[keys.length - 1] !== t || keys[0] < wordStart) return bad;
    for (let k = 1; k < keys.length; k++) {
      if (!Number.isFinite(keys[k]) || keys[k] < keys[k - 1]) return bad;
      gaps.push(keys[k] - keys[k - 1]);
    }
    reactions.push(keys[0] - wordStart);
    typingMs += t - keys[0];
    laterLetters += word.length - 1;
    typos += events[i].typos;
    wordStart = t;
  }

  const keyGapCv = gaps.length >= MIN_GAPS_FOR_CV ? spread(gaps) : null;
  const reactionCv = reactions.length >= MIN_WORDS_FOR_REACTION_CV ? spread(reactions) : null;
  if (keyGapCv !== null && keyGapCv < REJECT_KEY_GAP_CV) {
    return { ok: false, reason: "keystroke timing is too even to be a person typing" };
  }
  if (reactionCv !== null && reactionCv < REJECT_REACTION_CV) {
    return { ok: false, reason: "reaction times are too even to be a person typing" };
  }

  const stats: RunStats = {
    medianReactionMs: reactions.length ? median(reactions) : 0,
    msPerLetter: laterLetters ? round2(typingMs / laterLetters) : 0,
    keyGapCv: keyGapCv === null ? null : round2(keyGapCv),
    reactionCv: reactionCv === null ? null : round2(reactionCv),
    typos,
  };

  const flags: string[] = [];
  if (keyGapCv !== null && keyGapCv < REVIEW_KEY_GAP_CV) flags.push("even keystrokes");
  if (events.length >= MIN_WORDS_FOR_SPEED_FLAGS) {
    if (stats.msPerLetter < REVIEW_MS_PER_LETTER) flags.push("very fast typing");
    if (stats.medianReactionMs < REVIEW_MEDIAN_REACTION_MS) flags.push("very fast reactions");
  }
  if (events.length >= REVIEW_CLEAN_WORDS && typos === 0) flags.push("no typos");
  // First keys sooner than anyone can read the word. One can be a stray key;
  // a habit of it can't.
  const instant = reactions.filter((r) => r < MIN_REACTION_MS).length;
  if (instant >= 3 && instant >= reactions.length * 0.05) flags.push("instant first keys");

  return { ok: true, stats, flags };
}
