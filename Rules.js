.pragma library

// Survival rules, mirrored from backend/convex/lib/rules.ts. The server replays
// every submitted run with its copy; backend/scripts/rules.test.ts checks the
// two agree.

var START_WINDOW_MS = 4200
var MIN_WINDOW_MS = 1200
var WINDOW_DECAY = 0.965
var RULES_VERSION = 2
var AVERAGE_LETTERS = 7
var REACTION_LETTERS = 2
var MIN_REACTION_MS = 150
var MIN_MS_PER_KEY = 35

function nextWindow(windowMs) {
  return Math.max(MIN_WINDOW_MS, windowMs * WINDOW_DECAY)
}

// A word's own window: the clock is sized for an average-length word and
// scales with its letters plus a reaction worth REACTION_LETTERS.
function wordWindow(windowMs, word) {
  return windowMs * (REACTION_LETTERS + word.length) / (REACTION_LETTERS + AVERAGE_LETTERS)
}

function wordScore(word, remainingMs) {
  return word.length * 10 + Math.round(remainingMs / 100)
}

function minimumWordMs(word) {
  return MIN_REACTION_MS + (word.length - 1) * MIN_MS_PER_KEY
}

// Words per minute from a run's keystrokes, as the server works it out
// (msPerLetter in backend/convex/lib/humanity.ts, then wpm): the time from
// each word's first key to its last, over the letters after the first, at
// five letters a word. 0 when there's nothing to time.
function wpm(words, events) {
  var typingMs = 0
  var laterLetters = 0
  for (var i = 0; i < events.length; i++) {
    var keys = events[i].keys
    if (!keys || keys.length === 0) continue
    typingMs += events[i].t - keys[0]
    laterLetters += words[i].length - 1
  }
  if (laterLetters === 0 || typingMs <= 0) return 0
  var msPerLetter = Math.round(typingMs / laterLetters * 100) / 100
  return Math.round(60000 / (5 * msPerLetter))
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
    var end = deadline(wordStart, wordWindow(windowMs, word))
    if (t > end) return { ok: false, reason: "word " + i + " finished after the clock ran out" }

    score += wordScore(word, end - t)
    streak = typos > 0 ? 1 : streak + 1
    bestStreak = Math.max(bestStreak, streak)
    windowMs = nextWindow(windowMs)
    wordStart = t
  }

  var last = words[events.length]
  var endT = deadline(wordStart, last === undefined ? windowMs : wordWindow(windowMs, last))
  return { ok: true, score: score, words: events.length, bestStreak: bestStreak, endT: endT }
}
