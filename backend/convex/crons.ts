import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.weekly(
  "refresh word pool from Wiktionary",
  { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 0 },
  internal.wordSync.refresh,
  {},
);

crons.hourly("expire abandoned runs", { minuteUTC: 15 }, internal.game.expireSessions, {});

export default crons;
