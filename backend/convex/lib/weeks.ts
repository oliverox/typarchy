// The weekly board. A week runs Monday 00:00 UTC to the next, and is named by
// the timestamp it starts at. Nothing resets it: each player carries the week
// their weekly best belongs to, and a best from an older week just stops
// matching the current one.

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
// 1970-01-05, the first Monday after the epoch.
const FIRST_MONDAY_MS = 4 * DAY_MS;

export function weekOf(at: number): number {
  return at - ((at - FIRST_MONDAY_MS) % WEEK_MS);
}

export type WeekBest = { week?: number; weekScore?: number; weekWords?: number; weekWpm?: number };

// The player's best score in `week`, 0 if they haven't ranked a run in it.
export function weekScore(player: WeekBest, week: number): number {
  return player.week === week ? (player.weekScore ?? 0) : 0;
}

// The weekly best after `runs` are ranked. A run from a newer week replaces
// the best outright; one from an older week than the player's is ignored.
export function creditWeek(
  player: WeekBest,
  runs: { at: number; score: number; words: number; wpm?: number }[],
): { week: number; weekScore: number; weekWords: number; weekWpm: number | undefined } {
  let best = {
    week: player.week ?? 0,
    weekScore: player.weekScore ?? 0,
    weekWords: player.weekWords ?? 0,
    weekWpm: player.weekWpm,
  };
  for (const run of runs) {
    const week = weekOf(run.at);
    if (week > best.week || (week === best.week && run.score > best.weekScore)) {
      best = { week, weekScore: run.score, weekWords: run.words, weekWpm: run.wpm };
    }
  }
  return best;
}
