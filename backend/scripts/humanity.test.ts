import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, OLD_CLIENT_REASON, type KeyedEvent } from "../convex/lib/humanity.ts";

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ["axe", "comet", "harbor", "velvet", "ultraviolet", "zinc", "pendulum", "quartz", "the", "because"];

type Typist = {
  // Time to the first key, and between keys: medians and log-normal spread.
  reactionMs: number;
  gapMs: number;
  spread: number;
  typoRate: number;
};

// Person-like typing: log-normal gaps (some letter pairs roll, others
// stretch), occasional wrong letters fixed with a backspace.
function play(typist: Typist, seed: number, wordCount = 40) {
  const rand = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const logNormal = (median: number, s: number) => median * Math.exp(s * normal());
  const words = Array.from({ length: wordCount }, () => POOL[Math.floor(rand() * POOL.length)]);
  const events: KeyedEvent[] = [];
  let clock = 0;
  for (const word of words) {
    const keys: number[] = [];
    let typos = 0;
    clock += Math.max(1, Math.round(logNormal(typist.reactionMs, typist.spread * 0.6)));
    for (let i = 0; i < word.length; i++) {
      if (i > 0) clock += Math.round(logNormal(typist.gapMs, typist.spread));
      if (rand() < typist.typoRate) {
        typos++;
        keys.push(clock);
        clock += Math.round(logNormal(typist.gapMs * 2.5, typist.spread));
        keys.push(clock); // backspace
        clock += Math.round(logNormal(typist.gapMs, typist.spread));
      }
      keys.push(clock);
    }
    events.push({ t: clock, typos, keys });
  }
  return { words, events };
}

// A script that types every key after a fixed delay, plus up to ±jitter.
function metronome(delayMs: number, jitter: number, seed: number, wordCount = 40) {
  const rand = mulberry32(seed);
  const words = Array.from({ length: wordCount }, () => POOL[Math.floor(rand() * POOL.length)]);
  const events: KeyedEvent[] = [];
  let clock = 0;
  for (const word of words) {
    const keys: number[] = [];
    for (let i = 0; i < word.length; i++) {
      clock += Math.round(delayMs * (1 + jitter * (2 * rand() - 1)));
      keys.push(clock);
    }
    events.push({ t: clock, typos: 0, keys });
  }
  return { words, events };
}

const EVERYDAY: Typist = { reactionMs: 420, gapMs: 120, spread: 0.45, typoRate: 0.02 };
const FAST: Typist = { reactionMs: 300, gapMs: 75, spread: 0.4, typoRate: 0.015 };
const ELITE: Typist = { reactionMs: 240, gapMs: 50, spread: 0.35, typoRate: 0.01 };

test("everyday and fast typists are ranked without review", () => {
  for (const typist of [EVERYDAY, FAST]) {
    let flagged = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const { words, events } = play(typist, seed);
      const verdict = analyze(words, events);
      assert.ok(verdict.ok, `seed ${seed}: ${!verdict.ok && verdict.reason}`);
      if (verdict.flags.length) flagged++;
    }
    assert.ok(flagged <= 5, `${flagged}/500 runs held for review`);
  }
});

test("elite typists are never rejected (at worst held for review)", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const { words, events } = play(ELITE, seed);
    const verdict = analyze(words, events);
    assert.ok(verdict.ok, `seed ${seed}: ${!verdict.ok && verdict.reason}`);
  }
});

test("scripts typing at a steady beat are rejected", () => {
  for (const [delay, jitter] of [[45, 0], [45, 0.05], [80, 0.15], [120, 0.2]]) {
    for (let seed = 1; seed <= 50; seed++) {
      const { words, events } = metronome(delay, jitter, seed);
      const verdict = analyze(words, events);
      assert.equal(verdict.ok, false, `${delay}ms ±${jitter * 100}% seed ${seed}`);
    }
  }
});

test("scripts with looser jitter are held for review", () => {
  const { words, events } = metronome(90, 0.4, 3);
  const verdict = analyze(words, events);
  assert.ok(verdict.ok && verdict.flags.includes("even keystrokes"), JSON.stringify(verdict));
});

test("a person-like script faster than people is held for review", () => {
  const bot: Typist = { reactionMs: 160, gapMs: 38, spread: 0.4, typoRate: 0 };
  const { words, events } = play(bot, 11, 80);
  const verdict = analyze(words, events);
  assert.ok(verdict.ok, !verdict.ok ? verdict.reason : "");
  for (const flag of ["very fast typing", "very fast reactions", "no typos"]) {
    assert.ok(verdict.flags.includes(flag), `missing ${flag}: ${verdict.flags}`);
  }
});

test("runs without keystrokes come from an old client", () => {
  const verdict = analyze(["comet"], [{ t: 1000, typos: 0 }]);
  assert.deepEqual(verdict, { ok: false, reason: OLD_CLIENT_REASON });
});

test("keystrokes must match the run", () => {
  const words = ["comet", "zinc"];
  const good = [
    { t: 1000, typos: 0, keys: [400, 550, 700, 860, 1000] },
    { t: 1900, typos: 1, keys: [1400, 1500, 1600, 1650, 1780, 1900] },
  ];
  assert.ok(analyze(words, good).ok);
  const broken: Record<string, KeyedEvent[]> = {
    "last key isn't the completion": [{ ...good[0], keys: [400, 550, 700, 860, 990] }],
    "fewer keys than letters": [{ ...good[0], keys: [400, 700, 1000] }],
    "typos without their keys": [{ t: 1000, typos: 2, keys: [400, 550, 700, 860, 1000] }],
    "keys out of order": [{ ...good[0], keys: [400, 700, 550, 860, 1000] }],
    "key before the word appeared": [good[0], { ...good[1], keys: [900, 1500, 1600, 1650, 1780, 1900] }],
  };
  for (const [name, events] of Object.entries(broken)) {
    assert.equal(analyze(words, events).ok, false, name);
  }
});
