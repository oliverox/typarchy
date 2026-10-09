import { test } from "node:test";
import assert from "node:assert/strict";
import { creditWeek, weekOf, weekScore, WEEK_MS } from "../convex/lib/weeks.ts";

const at = (iso: string) => Date.parse(iso);

test("a week starts on Monday 00:00 UTC", () => {
  const monday = at("2026-10-05T00:00:00Z");
  assert.equal(weekOf(monday), monday);
  assert.equal(weekOf(at("2026-10-09T13:37:00Z")), monday);
  assert.equal(weekOf(at("2026-10-11T23:59:59.999Z")), monday);
  assert.equal(weekOf(at("2026-10-12T00:00:00Z")), monday + WEEK_MS);
  assert.equal(new Date(weekOf(at("2031-03-01T12:00:00Z"))).getUTCDay(), 1);
});

test("a weekly best only counts in its own week", () => {
  const week = weekOf(at("2026-10-07T00:00:00Z"));
  const player = { week, weekScore: 900, weekWords: 30 };
  assert.equal(weekScore(player, week), 900);
  assert.equal(weekScore(player, week + WEEK_MS), 0);
  assert.equal(weekScore({}, week), 0);
});

test("ranked runs raise the weekly best, and a new week starts it over", () => {
  const week = weekOf(at("2026-10-07T00:00:00Z"));
  const player = { week, weekScore: 900, weekWords: 30, weekWpm: 70 };
  const run = (iso: string, score: number, wpm?: number) => ({ at: at(iso), score, words: score / 30, wpm });

  assert.deepEqual(creditWeek(player, [run("2026-10-08T10:00:00Z", 600)]), player);
  assert.deepEqual(creditWeek(player, [run("2026-10-08T10:00:00Z", 1200, 95)]), {
    week,
    weekScore: 1200,
    weekWords: 40,
    weekWpm: 95,
  });
  // Lower than last week's best, but it's a new week.
  assert.deepEqual(creditWeek(player, [run("2026-10-13T10:00:00Z", 300)]), {
    week: week + WEEK_MS,
    weekScore: 300,
    weekWords: 10,
    // No keystroke stats on that run, so last week's speed doesn't carry over.
    weekWpm: undefined,
  });
  // A held run approved after its week ended doesn't touch this week's best.
  assert.deepEqual(creditWeek(player, [run("2026-09-30T10:00:00Z", 5000)]), player);
  assert.deepEqual(creditWeek({}, [run("2026-10-08T10:00:00Z", 300, 60), run("2026-10-09T10:00:00Z", 150, 80)]), {
    week,
    weekScore: 300,
    weekWords: 10,
    weekWpm: 60,
  });
});
