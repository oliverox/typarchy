.pragma library

// Survival rules, mirrored from backend/convex/lib/rules.ts. The server replays
// every submitted run with its copy; backend/scripts/rules.test.ts checks the
// two agree.

var START_WINDOW_MS = 4200
var MIN_WINDOW_MS = 1200
var WINDOW_DECAY = 0.965
var MIN_REACTION_MS = 150
var MIN_MS_PER_KEY = 35

function nextWindow(windowMs) {
  return Math.max(MIN_WINDOW_MS, windowMs * WINDOW_DECAY)
}

function wordScore(word, remainingMs) {
  return word.length * 10 + Math.round(remainingMs / 100)
}

function minimumWordMs(word) {
  return MIN_REACTION_MS + (word.length - 1) * MIN_MS_PER_KEY
}

function deadline(wordStart, windowMs) {
  return wordStart + windowMs
}

// Letters only, lowercased: what a keystroke contributes to the typed word.
function normalizeKey(text) {
  return String(text || "").toLowerCase().replace(/[^a-z]/g, "")
}

function replay(words, events) {
  if (events.length > words.length) return { ok: false, reason: "more words than were issued" }

  var windowMs = START_WINDOW_MS
  var wordStart = 0
  var score = 0
  var streak = 0
  var bestStreak = 0

  for (var i = 0; i < events.length; i++) {
    var t = events[i].t
    var typos = events[i].typos
    var word = words[i]
    if (!isFinite(t) || Math.floor(typos) !== typos || typos < 0)
      return { ok: false, reason: "malformed event " + i }
    if (t - wordStart < minimumWordMs(word))
      return { ok: false, reason: "word " + i + " typed impossibly fast" }
    var end = deadline(wordStart, windowMs)
    if (t > end) return { ok: false, reason: "word " + i + " finished after the clock ran out" }

    score += wordScore(word, end - t)
    streak = typos > 0 ? 1 : streak + 1
    bestStreak = Math.max(bestStreak, streak)
    windowMs = nextWindow(windowMs)
    wordStart = t
  }

  var endT = deadline(wordStart, windowMs)
  return { ok: true, score: score, words: events.length, bestStreak: bestStreak, endT: endT }
}
