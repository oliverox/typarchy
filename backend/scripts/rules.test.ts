import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as server from "../convex/lib/rules.ts";

// The plugin's Rules.js is a QML `.pragma library` script, not a module.
const pluginSource = readFileSync(new URL("../../Rules.js", import.meta.url), "utf8")
  .replace(".pragma library", "");
const plugin = new Function(`${pluginSource}; return { replay, nextWindow, wordScore, START_WINDOW_MS, MIN_WINDOW_MS, WINDOW_DECAY, MIN_MS_PER_LETTER };`)();

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ["axe", "comet", "harbor", "velvet", "ultraviolet", "zinc", "pendulum", "quartz"];

// A plausible player: mostly in time, sometimes a typo (which costs no time,
// only the streak), occasionally too slow.
function simulate(seed: number) {
  const rand = mulberry32(seed);
  const words = Array.from({ length: 200 }, () => POOL[Math.floor(rand() * POOL.length)]);
  const events: server.WordEvent[] = [];
  let windowMs = server.START_WINDOW_MS;
  let wordStart = 0;
  for (const word of words) {
    const typos = rand() < 0.15 ? 1 + Math.floor(rand() * 2) : 0;
    const budget = windowMs;
    const minimum = word.length * server.MIN_MS_PER_LETTER;
    const took = minimum + rand() * (budget - minimum) * 1.08;
    if (took > budget) return { words, events };
    wordStart += Math.round(took);
    events.push({ t: wordStart, typos });
    windowMs = server.nextWindow(windowMs);
  }
  return { words, events };
}

test("plugin constants match the server", () => {
  for (const key of ["START_WINDOW_MS", "MIN_WINDOW_MS", "WINDOW_DECAY", "MIN_MS_PER_LETTER"] as const) {
    assert.equal(plugin[key], server[key], key);
  }
});

test("plugin and server replay 500 simulated runs identically", () => {
  let accepted = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const { words, events } = simulate(seed);
    const a = server.replay(words, events);
    const b = plugin.replay(words, events);
    assert.deepEqual(b, a, `seed ${seed}`);
    if (a.ok) accepted++;
  }
  assert.ok(accepted > 450, `expected most simulated runs to be valid, got ${accepted}`);
});

test("score, streak and end time for a known run", () => {
  const words = ["comet", "harbor", "zinc"];
  const events = [
    { t: 1000, typos: 0 },
    { t: 2500, typos: 1 },
    { t: 3400, typos: 0 },
  ];
  const result = server.replay(words, events);
  // A typo costs the streak, not time, so every deadline is wordStart + window.
  // comet: 50 + round(3200/100)=82 · harbor: 60 + round((1000+4053-2500)/100)=86
  // zinc: 40 + round((2500+3911.145-3400)/100)=70
  assert.deepEqual(result, {
    ok: true,
    score: 82 + 86 + 70,
    words: 3,
    bestStreak: 2,
    endT: 3400 + 4200 * 0.965 ** 3,
  });
});

test("typos cost the streak but never time", () => {
  const words = ["comet", "harbor"];
  const clean = server.replay(words, [{ t: 4000, typos: 0 }]);
  const typed = server.replay(words, [{ t: 4000, typos: 3 }]);
  assert.ok(clean.ok && typed.ok);
  assert.equal(typed.score, clean.score, "same score");
  assert.equal(typed.endT, clean.endT, "same end time");
  assert.equal(typed.bestStreak, 1);
});

test("rejects impossible runs", () => {
  const words = ["comet", "harbor"];
  assert.equal(server.replay(words, [{ t: 4300, typos: 0 }]).ok, false, "after the clock");
  assert.equal(server.replay(words, [{ t: 100, typos: 0 }]).ok, false, "too fast");
  assert.equal(server.replay(words, [{ t: 1000, typos: 0 }, { t: 2000, typos: 0 }, { t: 3000, typos: 0 }]).ok, false, "unissued words");
  assert.equal(server.replay(words, [{ t: 1000, typos: -1 }]).ok, false, "negative typos");
});
