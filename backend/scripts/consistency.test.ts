import { test } from "node:test";
import assert from "node:assert/strict";
import { rhythmMatch, runPairs, speedJump, updateProfile, type Profile } from "../convex/lib/consistency.ts";
import type { KeyedEvent } from "../convex/lib/humanity.ts";

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

const POOL = (
  "there other about would these their which first could people after where those " +
  "should under never every think great still between another through without " +
  "because before something during always number second against nothing country " +
  "however possible example perhaps general several whether children important"
).split(" ");

// A typist: each letter pair has its own lasting speed, plus noise per press.
// A script that randomises timing gets a fresh "typist" every run.
function typist(seed: number) {
  const rand = mulberry32(seed);
  const pairSpeed = new Map<string, number>();
  return (pair: string) => {
    if (!pairSpeed.has(pair)) pairSpeed.set(pair, Math.exp(0.4 * normal(rand)));
    return pairSpeed.get(pair)!;
  };
}

function play(speed: (pair: string) => number, seed: number, wordCount = 25) {
  const rand = mulberry32(seed);
  const words = Array.from({ length: wordCount }, () => POOL[Math.floor(rand() * POOL.length)]);
  const events: KeyedEvent[] = [];
  let t = 0;
  for (const word of words) {
    t += 500 + rand() * 300;
    const keys = [Math.round(t)];
    for (let k = 1; k < word.length; k++) {
      t += 150 * speed(word[k - 1] + word[k]) * Math.exp(0.25 * normal(rand));
      keys.push(Math.round(t));
    }
    events.push({ t: keys[keys.length - 1], typos: 0, keys });
  }
  return { words, events };
}

function profileOf(speed: (pair: string) => number, runs: number, seed: number): Profile {
  let profile: Profile = {};
  for (let i = 0; i < runs; i++) {
    const { words, events } = play(speed, seed + i);
    profile = updateProfile(profile, runPairs(words, events));
  }
  return profile;
}

test("a typist's run matches their own rhythm and not someone else's", () => {
  const me = typist(1);
  const profile = profileOf(me, 8, 100);
  const own: number[] = [];
  const other: number[] = [];
  const scripted: number[] = [];
  for (let i = 0; i < 40; i++) {
    const mine = play(me, 1000 + i);
    own.push(rhythmMatch(profile, runPairs(mine.words, mine.events))!);
    const them = play(typist(500 + i), 2000 + i);
    other.push(rhythmMatch(profile, runPairs(them.words, them.events))!);
    const bot = play(() => Math.exp(0.4 * normal(mulberry32(3000 + i))), 4000 + i);
    scripted.push(rhythmMatch(profile, runPairs(bot.words, bot.events))!);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(own.every((r) => r !== null) && mean(own) > 0.4, `own ${mean(own)}`);
  assert.ok(Math.abs(mean(other)) < 0.15, `other ${mean(other)}`);
  assert.ok(Math.abs(mean(scripted)) < 0.15, `scripted ${mean(scripted)}`);
});

test("only clean words feed the rhythm", () => {
  const words = ["comet", "harbor"];
  const events: KeyedEvent[] = [
    { t: 1000, typos: 0, keys: [600, 700, 800, 900, 1000] },
    { t: 2200, typos: 1, keys: [1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200] },
  ];
  const pairs = runPairs(words, events);
  assert.deepEqual([...pairs.keys()].sort(), ["co", "et", "me", "om"]);
});

test("too little in common gives no verdict", () => {
  const { words, events } = play(typist(1), 1, 2);
  assert.equal(rhythmMatch({}, runPairs(words, events)), null);
});

test("the profile caps its sample count so old play fades", () => {
  const profile = profileOf(typist(1), 30, 7);
  assert.ok(Object.values(profile).every((p) => p.n <= 40));
});

test("speed jumps", () => {
  const history = [60, 62, 58, 65, 61, 59, 63, 60, 64, 62];
  assert.equal(speedJump(88, history), false, "1.4× the usual: people do that");
  assert.equal(speedJump(95, history), true, "1.5× and +34");
  assert.equal(speedJump(95, history.slice(0, 9)), false, "not enough history");
  assert.equal(speedJump(30, [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]), false, "1.5× but only +10");
});
