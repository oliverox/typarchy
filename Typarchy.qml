import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "Api.js" as Api
import "Config.js" as Config
import "Countries.js" as Countries
import "Rules.js" as Rules

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string pluginId: (manifest && manifest.id) || "typarchy.game"
  // A local dev backend (see Config.devUrl) gets its own state directory and token.
  readonly property string devUrl: Config.devUrl(Quickshell.env("TYPARCHY_CONVEX_URL"))
  readonly property bool devBackend: devUrl !== ""
  readonly property string stateHelper: Qt.resolvedUrl("bin/typarchy-state").toString().replace(/^file:\/\//, "")
  readonly property string apiHelper: Qt.resolvedUrl("bin/typarchy-api").toString().replace(/^file:\/\//, "")

  property bool opened: false
  // "board" shows the leaderboard instead of the game.
  property string view: "game"
  onViewChanged: root.typeTitle()

  // How much of "TYPARCHY" is showing; typed out on open and on view changes.
  readonly property string titleText: "TYPARCHY"
  property int titleLetters: titleText.length
  readonly property bool titleTyping: titleLetters < titleText.length

  function typeTitle() {
    root.titleLetters = 0
    titleTimer.restart()
  }

  // Uneven gaps between letters, like a person typing.
  Timer {
    id: titleTimer
    interval: 60
    repeat: true
    onTriggered: {
      root.titleLetters += 1
      if (!root.titleTyping) stop()
      else interval = 45 + Math.random() * 70
    }
  }

  // --- Identity and profile (persisted under stateDir) ---
  property bool identityLoaded: false
  property string playerName: ""
  property string playerToken: ""
  property var me: null
  property var topPlayers: []
  property bool boardLoading: false
  property string boardError: ""
  property var practiceWords: []
  // Held runs, fetched only for admins (the server refuses everyone else).
  property var pendingRuns: []
  property string reviewError: ""

  // --- Country, shown as a flag next to the name ---
  // Suggested from the system timezone (offline); the player confirms or
  // changes it when claiming a nickname, or later with `c` on the leaderboard.
  property string countryGuess: ""
  property string countryDraft: ""
  property bool countryEditing: false
  property bool countrySaving: false
  property string countryError: ""

  // --- Nickname entry ---
  property string nicknameDraft: ""
  property string nicknameError: ""
  property bool registering: false

  // --- Run state ---
  // nickname | idle | starting | running | over
  property string phase: "idle"
  property bool ranked: false
  property string notice: ""
  property string sessionId: ""
  property int checkpointEvery: 10
  property var words: []
  property int wordIndex: 0
  property string typed: ""
  property int typos: 0
  property real windowMs: Rules.START_WINDOW_MS
  property real wordStart: 0
  property real runStartedAt: 0
  property real now: 0
  property var events: []
  // Run-relative times of the keys that touched the current word; sent with
  // each word so the server can tell typing from a script.
  property var wordKeys: []
  property int score: 0
  property int streak: 0
  property int bestStreak: 0

  // --- Result of the last run ---
  // "" | submitting | accepted | rejected | offline | practice
  property string submitState: ""
  property var submitResult: null
  property string submitError: ""

  readonly property string currentWord: wordIndex < words.length ? words[wordIndex] : ""
  // windowMs is the clock for an average word; this is the current word's share.
  readonly property real wordWindowMs: currentWord ? Rules.wordWindow(windowMs, currentWord) : windowMs
  readonly property real deadline: Rules.deadline(wordStart, wordWindowMs)
  readonly property real remainingMs: phase === "running" ? Math.max(0, deadline - (now - runStartedAt)) : (phase === "over" ? 0 : wordWindowMs)
  readonly property real clockFraction: Math.max(0, Math.min(1, remainingMs / wordWindowMs))

  // --- Theme ---
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color accent: Color.accent
  property color urgent: Color.urgent
  property color dim: Util.alpha(foreground, 0.5)
  property color faint: Util.alpha(foreground, 0.12)
  readonly property string fontFamily: Style.font.family
  readonly property int cornerRadius: Style.cornerRadius
  readonly property int pad: Style.spacing.panelPadding
  readonly property int cardWidth: Math.min(Style.space(720), panel.width - Style.gapsOut * 2)
  readonly property int cardHeight: Math.min(Style.space(500), panel.height - Style.gapsOut * 2)

  // ------------------------------------------------------------------
  // Shell lifecycle
  // ------------------------------------------------------------------

  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) {}
    root.opened = true
    root.view = payload.view === "board" ? "board" : "game"
    root.typeTitle()
    if (root.phase === "over" || root.phase === "idle") root.notice = ""
    root.refreshBoard()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    if (root.phase === "running" || root.phase === "starting") root.abandonRun()
  }

  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  Component.onCompleted: root.loadState()

  // ------------------------------------------------------------------
  // Networking
  // ------------------------------------------------------------------

  Component {
    id: watchdogComponent
    Timer { repeat: false }
  }

  // Convex calls go through bin/typarchy-api: fixed host (or loopback in dev),
  // no redirects, the reply capped at 256 KiB while it is read. The request,
  // token included, travels on stdin. timeoutMs is a hard deadline for the call.
  function request(kind, path, args, timeoutMs, callback) {
    var command = [root.apiHelper].concat(root.devBackend ? ["--dev", root.devUrl] : [])
    var input = JSON.stringify({ kind: kind, path: path, args: args || {} }) + "\n"
    root.runHelper(command, input, 270000, timeoutMs, function(code, text) {
      var reply = Api.parse(code, text)
      if (reply.error && reply.error.code === "UNKNOWN_PLAYER") root.forgetIdentity()
      callback(reply.error, reply.value)
    })
  }

  function refreshBoard() {
    root.boardLoading = true
    root.request("query", "leaderboard:top", { limit: 20 }, 8000, function(error, value) {
      root.boardLoading = false
      root.boardError = error ? error.message : ""
      if (!error) root.topPlayers = root.cleanBoard(value)
    })
    if (!root.playerToken) return
    root.request("query", "players:me", { token: root.playerToken }, 8000, function(error, value) {
      value = error ? null : root.cleanMe(value)
      if (value) {
        root.me = value
        root.saveProfile()
        if (value.isAdmin) root.refreshPending()
        else root.pendingRuns = []
      }
    })
  }

  function refreshPending() {
    root.request("query", "moderation:pending", { token: root.playerToken }, 8000, function(error, value) {
      if (!error) root.pendingRuns = root.cleanPending(value)
    })
  }

  // ------------------------------------------------------------------
  // Server replies: keep only the expected shape, with bounded sizes
  // ------------------------------------------------------------------

  function count(value, max) {
    return Number.isInteger(value) && value >= 0 && value <= (max || 1e9) ? value : 0
  }

  function nickname(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{3,16}$/.test(value) ? value : "?"
  }

  function cleanWords(value, max) {
    if (!Array.isArray(value)) return []
    return value.slice(0, max).filter(function(w) { return typeof w === "string" && /^[a-z]{1,32}$/.test(w) })
  }

  function cleanBoard(value) {
    if (!Array.isArray(value)) return []
    return value.slice(0, 50).map(function(p) {
      p = p || {}
      return {
        rank: root.count(p.rank),
        name: root.nickname(p.name),
        country: Countries.known(p.country) ? p.country : "",
        score: root.count(p.score),
        words: root.count(p.words),
        // 0 when the server has no speed for that best run.
        wpm: root.count(p.wpm, 1000)
      }
    })
  }

  function cleanMe(value) {
    if (!value || typeof value !== "object") return null
    var runs = Array.isArray(value.recentRuns) ? value.recentRuns.slice(0, 5) : []
    return {
      name: root.nickname(value.name),
      bestScore: root.count(value.bestScore),
      runCount: root.count(value.runCount),
      rank: root.count(value.rank) || null,
      country: Countries.known(value.country) ? value.country : "",
      isAdmin: value.isAdmin === true,
      recentRuns: runs.map(function(r) {
        r = r || {}
        var status = r.status === "pending" || r.status === "rejected" ? r.status : "ranked"
        return { score: root.count(r.score), words: root.count(r.words), playedAt: typeof r.playedAt === "number" && isFinite(r.playedAt) ? r.playedAt : 0, status: status }
      })
    }
  }

  function cleanPending(value) {
    if (!Array.isArray(value)) return []
    return value.slice(0, 100).filter(function(r) {
      return r && typeof r.runId === "string" && /^[A-Za-z0-9]{1,64}$/.test(r.runId)
    }).map(function(r) {
      var st = r.stats && typeof r.stats === "object" ? r.stats : null
      var number = function(n) { return typeof n === "number" && isFinite(n) ? n : 0 }
      return {
        runId: r.runId,
        name: root.nickname(r.name),
        score: root.count(r.score),
        words: root.count(r.words),
        flags: (Array.isArray(r.flags) ? r.flags.slice(0, 8) : []).map(function(f) { return Api.message(f, "?").slice(0, 60) }),
        stats: st ? { msPerLetter: number(st.msPerLetter), medianReactionMs: number(st.medianReactionMs), typos: root.count(st.typos) } : null
      }
    })
  }

  function reviewRun(runId, decision) {
    root.reviewError = ""
    root.request("mutation", "moderation:review", { token: root.playerToken, runId: runId, decision: decision }, 8000, function(error) {
      if (error) root.reviewError = error.message
      root.refreshBoard()
    })
  }

  // ------------------------------------------------------------------
  // Identity
  // ------------------------------------------------------------------

  // Runs one of the bundled helpers with `input` on stdin, an absolute deadline
  // and a cap on what it may print. callback(exitCode, stdout); exitCode is null
  // when the helper was killed for running over either limit.
  Component {
    id: helperComponent
    Process {
      id: proc
      property string buf: ""
      property int maxChars: 32768
      property bool killed: false
      property string input: ""
      property var done: null
      function kill() { proc.killed = true; proc.buf = ""; proc.signal(9) }
      stdinEnabled: true
      stdout: SplitParser {
        splitMarker: ""
        onRead: function(chunk) {
          if (proc.killed) return
          proc.buf += chunk
          if (proc.buf.length > proc.maxChars) proc.kill()
        }
      }
      onStarted: { write(proc.input); proc.input = "" }
      onExited: function(code) {
        var cb = proc.done
        proc.done = null
        if (cb) cb(proc.killed ? null : code, proc.buf)
        proc.destroy()
      }
    }
  }

  function runHelper(command, input, maxChars, timeoutMs, callback) {
    var watchdog = watchdogComponent.createObject(root, { interval: timeoutMs })
    var proc = helperComponent.createObject(root, {
      command: ["/usr/bin/python3", "-I", "-S"].concat(command),
      input: input,
      maxChars: maxChars,
      done: function(code, text) {
        watchdog.stop()
        watchdog.destroy()
        callback(code, text)
      }
    })
    watchdog.triggered.connect(function() { proc.kill() })
    watchdog.start()
    proc.running = true
  }

  // State files are read and written only through bin/typarchy-state: it refuses
  // symlinks and oversized files, creates everything 0600 in a 0700 directory,
  // replaces files atomically and validates the schema. The token goes over stdin.
  function runState(args, input, callback) {
    var command = [root.stateHelper].concat(args, root.devBackend ? ["--dev"] : [])
    root.runHelper(command, input, 32768, 5000, function(code, text) { callback(code === 0, text) })
  }

  function readState(kind, callback) {
    root.runState(["read", kind], "", function(ok, text) {
      var data = null
      if (ok) { try { data = JSON.parse(text) } catch (e) {} }
      callback(data)
    })
  }

  // One write per file at a time; a newer payload replaces a queued one.
  property var stateWrites: ({})

  function writeState(kind, doc) {
    var q = root.stateWrites[kind] || (root.stateWrites[kind] = { busy: false, pending: null })
    q.pending = JSON.stringify(doc) + "\n"
    if (!q.busy) root.flushState(kind)
  }

  function flushState(kind) {
    var q = root.stateWrites[kind]
    if (q.pending === null) { q.busy = false; return }
    var payload = q.pending
    q.pending = null
    q.busy = true
    root.runState(["write", kind], payload, function(ok) {
      if (!ok) console.warn("typarchy: couldn't save " + kind + ".json")
      root.flushState(kind)
    })
  }

  function loadState() {
    root.readState("identity", function(data) {
      if (data === null) root.notice = "Couldn't read your saved nickname; see the shell journal."
      else if (data.token) {
        root.playerName = data.name
        root.playerToken = data.token
      }
      root.finishIdentityLoad()
    })
    root.readState("profile", function(data) {
      if (data && data.practiceWords) root.practiceWords = data.practiceWords
    })
    root.runHelper([root.stateHelper, "timezone-country"], "", 4096, 5000, function(code, text) {
      var data = null
      if (code === 0) { try { data = JSON.parse(text) } catch (e) {} }
      if (!data || !Countries.known(data.country)) return
      root.countryGuess = data.country
      if (!root.countryDraft) root.countryDraft = data.country
    })
  }

  function finishIdentityLoad() {
    if (root.identityLoaded) return
    root.identityLoaded = true
    root.phase = root.playerToken ? "idle" : "nickname"
    if (root.opened) root.refreshBoard()
  }

  function forgetIdentity() {
    root.playerName = ""
    root.playerToken = ""
    root.me = null
    root.writeState("identity", {})
    root.saveProfile()
    if (root.phase !== "running") root.phase = "nickname"
  }

  // The bar widget watches this file for the best score and rank.
  function saveProfile() {
    root.writeState("profile", {
      name: root.playerName,
      bestScore: root.me ? root.me.bestScore : 0,
      rank: root.me ? root.me.rank : null,
      practiceWords: root.practiceWords
    })
  }

  function registerNickname() {
    var name = root.nicknameDraft
    if (root.registering) return
    if (!/^[A-Za-z0-9_-]{3,16}$/.test(name)) {
      root.nicknameError = "3–16 letters, digits, _ or -"
      return
    }
    root.registering = true
    root.nicknameError = ""
    var args = { name: name }
    if (Countries.known(root.countryDraft)) args.country = root.countryDraft
    root.request("mutation", "players:register", args, 8000, function(error, value) {
      root.registering = false
      if (error) {
        root.nicknameError = error.message
        return
      }
      if (!value || !/^[A-Za-z0-9_-]{3,16}$/.test(value.name) || !/^[0-9a-f]{64}$/.test(value.token)) {
        root.nicknameError = "Unexpected reply from the leaderboard."
        return
      }
      root.playerName = value.name
      root.playerToken = value.token
      root.writeState("identity", { name: value.name, token: value.token })
      root.nicknameDraft = ""
      root.phase = "idle"
      root.refreshBoard()
    })
  }

  function countryLabel(code) {
    return Countries.known(code) ? Countries.flag(code) + "  " + Countries.name(code) : "no flag"
  }

  // One step through the list, or to the next/previous initial letter with
  // shift. "No flag" sits before the first country.
  function stepCountry(code, step, byLetter) {
    var n = Countries.list.length
    var i = Countries.indexOf(code)
    if (!byLetter) {
      i += step
      if (i < -1) i = n - 1
      if (i >= n) i = -1
      return i < 0 ? "" : Countries.list[i][0]
    }
    var initial = function(j) { return j < 0 ? "" : Countries.list[j][1].charAt(0) }
    var here = initial(i)
    var j
    if (step > 0) {
      j = i + 1
      while (j < n && initial(j) === here) j++
      return j >= n ? "" : Countries.list[j][0]
    }
    j = i < 0 ? n - 1 : i - 1
    if (j < 0) return ""
    var prev = initial(j)
    while (j > 0 && initial(j - 1) === prev) j--
    return Countries.list[j][0]
  }

  function editCountry() {
    if (!root.me) return
    root.countryDraft = root.me.country || root.countryGuess
    root.countryError = ""
    root.countryEditing = true
  }

  function saveCountry() {
    if (root.countrySaving) return
    root.countrySaving = true
    root.countryError = ""
    var country = Countries.known(root.countryDraft) ? root.countryDraft : null
    root.request("mutation", "players:setCountry", { token: root.playerToken, country: country }, 8000, function(error) {
      root.countrySaving = false
      if (error) {
        root.countryError = error.code === "RATE_LIMITED" || error.code === "BAD_COUNTRY"
          ? error.message : "Couldn't save your country. Try again in a moment."
        return
      }
      root.countryEditing = false
      root.refreshBoard()
    })
  }

  // Country name under a hovered flag on the leaderboard.
  function showFlagTip(item, text) {
    if (!text) {
      flagTip.text = ""
      return
    }
    flagTip.text = text
    var p = item.mapToItem(boardView, item.width / 2, item.height)
    flagTip.x = Math.max(0, Math.min(boardView.width - flagTip.width, p.x - flagTip.width / 2))
    flagTip.y = p.y + Style.spacing.xs
  }

  // ------------------------------------------------------------------
  // Game loop
  // ------------------------------------------------------------------

  Timer {
    interval: 16
    repeat: true
    running: root.phase === "running"
    onTriggered: {
      root.now = Date.now()
      if (root.remainingMs <= 0) root.endRun()
    }
  }

  function startRun() {
    if (root.phase === "starting" || root.phase === "running") return
    root.view = "game"
    root.notice = ""
    if (!root.playerToken) {
      root.phase = "nickname"
      return
    }
    root.phase = "starting"
    root.request("mutation", "game:start", { token: root.playerToken, rules: Rules.RULES_VERSION }, 6000, function(error, value) {
      if (root.phase !== "starting") return
      var words = error ? [] : root.cleanWords(value && value.words, 400)
      if (!error && (words.length === 0 || typeof value.sessionId !== "string" || value.sessionId.length > 64)) {
        error = { code: "BAD_REPLY", message: "Unexpected reply from the leaderboard.", offline: false }
      }
      if (!error) {
        root.sessionId = value.sessionId
        root.checkpointEvery = Math.max(1, Math.min(100, root.count(value.checkpointEvery) || 10))
        root.practiceWords = words
        root.saveProfile()
        root.beginRun(words, true)
      } else if (error.offline && root.practiceWords.length > 0) {
        root.notice = "Offline — practice run, not ranked"
        root.beginRun(root.shuffled(root.practiceWords), false)
      } else {
        root.phase = root.playerToken ? "idle" : "nickname"
        root.notice = error.offline
          ? "Can't reach the leaderboard, and no words are cached for practice yet."
          : error.message
      }
    })
  }

  function shuffled(list) {
    var copy = list.slice()
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp
    }
    return copy
  }

  function beginRun(runWords, isRanked) {
    root.ranked = isRanked
    if (!isRanked) root.sessionId = ""
    root.words = runWords
    root.wordIndex = 0
    root.typed = ""
    root.typos = 0
    root.windowMs = Rules.START_WINDOW_MS
    root.wordStart = 0
    root.events = []
    root.wordKeys = []
    root.score = 0
    root.streak = 0
    root.bestStreak = 0
    root.submitState = ""
    root.submitResult = null
    root.submitError = ""
    root.runStartedAt = Date.now()
    root.now = root.runStartedAt
    root.phase = "running"
  }

  function abandonRun() {
    root.sessionId = ""
    root.phase = root.playerToken ? "idle" : "nickname"
  }

  function recordKey() {
    root.wordKeys.push(Math.round(root.now - root.runStartedAt))
  }

  function typeLetter(letter) {
    root.now = Date.now()
    if (root.remainingMs <= 0) {
      root.endRun()
      return
    }
    root.recordKey()
    var word = root.currentWord
    var next = (root.typed + letter).slice(0, word.length + 4)
    if (next === word) {
      root.completeWord(root.now - root.runStartedAt)
    } else {
      if (word.indexOf(next) !== 0) {
        root.typos += 1
        root.streak = 0
      }
      root.typed = next
    }
  }

  function completeWord(t) {
    var word = root.currentWord
    root.score += Rules.wordScore(word, root.deadline - t)
    root.streak = root.typos > 0 ? 1 : root.streak + 1
    root.bestStreak = Math.max(root.bestStreak, root.streak)
    root.events = root.events.concat([{ t: t, typos: root.typos, keys: root.wordKeys }])
    root.wordKeys = []
    root.windowMs = Rules.nextWindow(root.windowMs)
    root.wordStart = t
    root.typos = 0
    root.typed = ""
    root.wordIndex += 1

    if (root.ranked && root.events.length % root.checkpointEvery === 0) root.sendCheckpoint(root.events.length, t)
    if (root.wordIndex >= root.words.length) {
      if (root.ranked) root.endRun()
      else root.words = root.words.concat(root.shuffled(root.practiceWords))
    }
  }

  function sendCheckpoint(count, t) {
    var session = root.sessionId
    root.request("mutation", "game:checkpoint", { token: root.playerToken, sessionId: session, count: count, t: t }, 8000, function(error, value) {
      var extra = error ? [] : root.cleanWords(value && value.words, 400)
      if (session !== root.sessionId || extra.length === 0 || root.words.length > 8000) return
      root.words = root.words.concat(extra)
    })
  }

  function endRun() {
    if (root.phase !== "running") return
    root.phase = "over"
    if (!root.ranked) {
      root.submitState = "practice"
      return
    }
    root.submitState = "submitting"
    var session = root.sessionId
    root.sessionId = ""
    root.request("mutation", "game:submit", {
      token: root.playerToken,
      sessionId: session,
      events: root.events
    }, 10000, function(error, value) {
      if (error) {
        root.submitState = error.offline ? "offline" : "rejected"
        root.submitError = error.message
        return
      }
      value = value || {}
      root.submitResult = {
        pending: value.pending === true,
        rank: root.count(value.rank) || null,
        personalBest: root.count(value.personalBest),
        isPersonalBest: value.isPersonalBest === true
      }
      root.submitState = value.accepted === true ? "accepted" : "rejected"
      if (value.accepted !== true) root.submitError = Api.message(value.reason, "run rejected")
      root.refreshBoard()
    })
  }

  function resultLine() {
    switch (root.submitState) {
    case "submitting": return "verifying run…"
    case "practice": return "practice run — not ranked"
    case "offline": return "couldn't reach the leaderboard — run not ranked"
    case "rejected": return "not ranked: " + root.submitError
    case "accepted":
      var r = root.submitResult
      if (r.pending) return "held for review — it counts once an admin approves it"
      var rank = r.rank ? "#" + r.rank + " worldwide" : "unranked"
      return r.isPersonalBest ? "new personal best · " + rank : "best " + r.personalBest + " · " + rank
    }
    return ""
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------

  function handleKey(event) {
    var ctrl = (event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) !== 0
    var key = event.key

    if (key === Qt.Key_Escape) {
      if (root.phase === "running" || root.phase === "starting") root.abandonRun()
      else if (root.countryEditing) root.countryEditing = false
      else if (root.view === "board") root.view = "game"
      else root.dismiss()
      return true
    }

    if (root.phase === "running") {
      if (key === Qt.Key_Backspace || (ctrl && key === Qt.Key_W)) {
        root.now = Date.now()
        if (root.remainingMs > 0) root.recordKey()
        root.typed = key === Qt.Key_Backspace && !ctrl ? root.typed.slice(0, -1) : ""
        return true
      }
      var letter = ctrl ? "" : Rules.normalizeKey(event.text)
      if (letter.length === 1) root.typeLetter(letter)
      return true
    }

    if (key === Qt.Key_Tab || key === Qt.Key_Backtab) {
      if (root.phase !== "starting") {
        root.countryEditing = false
        root.view = root.view === "board" ? "game" : "board"
        if (root.view === "board") root.refreshBoard()
      }
      return true
    }

    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    if (root.view === "board") {
      if (root.countryEditing) {
        if (key === Qt.Key_Left || key === Qt.Key_Right) {
          root.countryDraft = root.stepCountry(root.countryDraft, key === Qt.Key_Right ? 1 : -1, shift)
          root.countryError = ""
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
          root.saveCountry()
        }
        return true
      }
      if (key === Qt.Key_C && !ctrl && root.me) root.editCountry()
      else if (key === Qt.Key_R && !ctrl) root.refreshBoard()
      else if (key === Qt.Key_Return || key === Qt.Key_Enter) root.startRun()
      return true
    }

    if (root.phase === "nickname") {
      if (key === Qt.Key_Return || key === Qt.Key_Enter) {
        root.registerNickname()
      } else if (key === Qt.Key_Left || key === Qt.Key_Right) {
        root.countryDraft = root.stepCountry(root.countryDraft, key === Qt.Key_Right ? 1 : -1, shift)
      } else if (key === Qt.Key_Backspace) {
        root.nicknameDraft = root.nicknameDraft.slice(0, -1)
        root.nicknameError = ""
      } else if (!ctrl && /^[A-Za-z0-9_-]$/.test(event.text) && root.nicknameDraft.length < 16) {
        root.nicknameDraft += event.text
        root.nicknameError = ""
      }
      return true
    }

    if ((key === Qt.Key_Return || key === Qt.Key_Enter) && (root.phase === "idle" || root.phase === "over")) {
      root.startRun()
      return true
    }
    return false
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------

  // Small uppercase text. PlainText like every other Text here.
  component Caption: Text {
    textFormat: Text.PlainText
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: Style.space(2)
    font.capitalization: Font.AllUppercase
  }

  component ReviewButton: Rectangle {
    id: reviewButton
    property string label
    property color tint
    signal clicked()
    implicitWidth: buttonText.implicitWidth + Style.spacing.md * 2
    implicitHeight: buttonText.implicitHeight + Style.spacing.xs * 2
    radius: root.cornerRadius
    color: buttonMouse.containsMouse ? Util.alpha(tint, 0.25) : Util.alpha(tint, 0.12)
    Text {
      id: buttonText
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: reviewButton.label
      color: reviewButton.tint
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
    MouseArea {
      id: buttonMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: reviewButton.clicked()
    }
  }

  component Stat: Column {
    property string label
    property string value
    property color valueColor: root.foreground
    spacing: Style.spacing.xs
    Caption { text: parent.label }
    Text {
      textFormat: Text.PlainText
      text: parent.value
      color: parent.valueColor
      font.family: root.fontFamily
      font.pixelSize: Style.font.display
      font.bold: true
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "typarchy"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.pad

      MouseArea { anchors.fill: parent; onClicked: keyCatcher.forceActiveFocus() }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) { event.accepted = root.handleKey(event) }
      }

      Item {
        id: content
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset

        // Header: title, tabs, player summary
        Item {
          id: header
          anchors { top: parent.top; left: parent.left; right: parent.right }
          height: title.implicitHeight

          Row {
            id: title
            spacing: 0
            Text {
              textFormat: Text.PlainText
              text: root.titleText.slice(0, Math.min(3, root.titleLetters))
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.displayLarge
              font.bold: true
            }
            Text {
              textFormat: Text.PlainText
              text: root.titleText.slice(3, Math.max(3, root.titleLetters))
              color: root.accent
              font.family: root.fontFamily
              font.pixelSize: Style.font.displayLarge
              font.bold: true
            }
            Rectangle {
              width: Style.space(3)
              height: Style.font.displayLarge
              anchors.verticalCenter: parent.verticalCenter
              anchors.verticalCenterOffset: Style.space(1)
              color: root.accent
              // Solid while the title types, blinking once it's done.
              property real blink: 1
              opacity: root.titleTyping ? 1 : blink
              SequentialAnimation on blink {
                running: root.opened && !root.titleTyping
                loops: Animation.Infinite
                NumberAnimation { to: 0; duration: 530; easing.type: Easing.InQuad }
                NumberAnimation { to: 1; duration: 530; easing.type: Easing.OutQuad }
              }
            }
          }

          Column {
            anchors { right: parent.right; verticalCenter: parent.verticalCenter }
            spacing: Style.spacing.xs
            Caption {
              anchors.right: parent.right
              text: root.playerName ? root.playerName : "no nickname yet"
              color: root.playerName ? root.foreground : root.dim
            }
            Caption {
              anchors.right: parent.right
              text: {
                if (!root.me) return root.playerName ? "—" : ""
                var rank = root.me.rank ? "#" + root.me.rank : "unranked"
                return "best " + root.me.bestScore + " · " + rank
              }
            }
          }
        }

        Row {
          id: tabs
          anchors { top: header.bottom; topMargin: Style.spacing.lg; left: parent.left }
          spacing: Style.spacing.xxl
          Repeater {
            model: [{ id: "game", label: "survival" }, { id: "board", label: "leaderboard" }]
            delegate: Caption {
              required property var modelData
              text: modelData.label
              color: root.view === modelData.id ? root.accent : root.dim
              font.underline: root.view === modelData.id
            }
          }
        }

        Rectangle {
          id: rule
          anchors { top: tabs.bottom; topMargin: Style.spacing.md; left: parent.left; right: parent.right }
          height: 1
          color: root.faint
        }

        Caption {
          id: footer
          anchors { bottom: parent.bottom; horizontalCenter: parent.horizontalCenter }
          text: {
            if (root.phase === "running") return "esc abandon run"
            if (root.view === "board" && root.countryEditing) return "← → country · shift+← → by letter · enter save · esc cancel"
            if (root.view === "board") return "enter play · r refresh" + (root.me ? " · c country" : "") + " · tab survival · esc back"
            if (root.phase === "nickname") return "enter claim nickname · ← → country · tab leaderboard · esc close"
            return "enter play · tab leaderboard · esc close"
          }
        }

        // ---------------- Game view ----------------
        Item {
          id: gameView
          visible: root.view === "game"
          anchors { top: rule.bottom; topMargin: Style.spacing.huge; bottom: footer.top; bottomMargin: Style.spacing.lg; left: parent.left; right: parent.right }

          Row {
            id: stats
            visible: root.phase !== "nickname"
            anchors { top: parent.top; left: parent.left; right: parent.right }
            Stat { width: stats.width / 3; label: "score"; value: String(root.score) }
            Stat { width: stats.width / 3; label: "words"; value: String(root.events.length) }
            Stat { width: stats.width / 3; label: "streak"; value: String(root.streak); valueColor: root.accent }
          }

          Rectangle {
            id: clockTrack
            visible: root.phase !== "nickname"
            anchors { top: stats.bottom; topMargin: Style.spacing.huge; left: parent.left; right: parent.right }
            height: Style.space(6)
            color: root.faint
            Rectangle {
              anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
              width: parent.width * root.clockFraction
              color: root.clockFraction < 0.3 ? root.urgent : root.accent
            }
          }

          Item {
            id: stage
            anchors { top: clockTrack.bottom; bottom: parent.bottom; left: parent.left; right: parent.right }

            // Nickname entry
            Column {
              visible: root.phase === "nickname"
              anchors.centerIn: parent
              width: parent.width
              spacing: Style.spacing.xxl
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                wrapMode: Text.WordWrap
                text: "Pick a nickname for the worldwide leaderboard."
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
              }
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: (root.nicknameDraft || "") + "▏"
                color: root.nicknameDraft ? root.accent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge * 1.4
                font.bold: true
              }
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: "◂  " + root.countryLabel(root.countryDraft) + "  ▸"
                color: root.countryDraft ? root.foreground : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
              Caption {
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.registering ? "claiming…" : (root.nicknameError || "3–16 letters, digits, _ or -")
                color: root.nicknameError ? root.urgent : root.dim
                font.capitalization: Font.MixedCase
                font.letterSpacing: 0
                font.pixelSize: Style.font.body
              }
            }

            // Idle / starting
            Column {
              visible: root.phase === "idle" || root.phase === "starting"
              anchors.centerIn: parent
              width: parent.width
              spacing: Style.spacing.xxl
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                wrapMode: Text.WordWrap
                text: "Type each word before the bar empties. Every word makes the clock tighter."
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: root.phase === "starting" ? "connecting…" : "press enter to begin"
                color: root.accent
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
                font.bold: true
              }
              Caption {
                visible: root.notice !== ""
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.notice
                color: root.urgent
                font.capitalization: Font.MixedCase
                font.letterSpacing: 0
                font.pixelSize: Style.font.body
              }
            }

            // Running
            Column {
              visible: root.phase === "running"
              anchors.centerIn: parent
              width: parent.width
              spacing: Style.spacing.huge

              Row {
                anchors.horizontalCenter: parent.horizontalCenter
                Repeater {
                  model: root.currentWord.length
                  delegate: Text {
                    required property int index
                    textFormat: Text.PlainText
                    text: root.currentWord.charAt(index)
                    color: index >= root.typed.length ? root.dim
                      : (root.typed.charAt(index) === root.currentWord.charAt(index) ? root.accent : root.urgent)
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.displayLarge * 1.9
                    font.bold: true
                  }
                }
              }

              Item {
                anchors.horizontalCenter: parent.horizontalCenter
                width: Math.min(parent.width, Style.space(360))
                height: typedText.implicitHeight + Style.spacing.md
                Text {
                  id: typedText
                  anchors.horizontalCenter: parent.horizontalCenter
                  textFormat: Text.PlainText
                  text: root.typed + "▏"
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.heading
                }
                Rectangle {
                  anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                  height: 1
                  color: root.typos > 0 ? root.urgent : root.accent
                }
              }

              Caption {
                visible: root.notice !== ""
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.notice
              }
            }

            // Game over
            Column {
              visible: root.phase === "over"
              anchors.centerIn: parent
              width: parent.width
              spacing: Style.spacing.lg
              Caption {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "run terminated"
                color: root.urgent
              }
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: String(root.score)
                color: root.accent
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge * 2.2
                font.bold: true
              }
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: root.events.length + " words · best streak " + root.bestStreak
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
              Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                wrapMode: Text.WordWrap
                text: root.resultLine()
                color: root.submitState === "accepted" ? root.foreground : (root.submitState === "submitting" || root.submitState === "practice" ? root.dim : root.urgent)
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
            }
          }
        }

        // ---------------- Leaderboard view ----------------
        Item {
          id: boardView
          visible: root.view === "board"
          onVisibleChanged: flagTip.text = ""

          Rectangle {
            id: flagTip
            property string text: ""
            visible: text !== ""
            z: 100
            width: flagTipText.implicitWidth + Style.spacing.md * 2
            height: flagTipText.implicitHeight + Style.spacing.xs * 2
            radius: root.cornerRadius
            color: root.background
            border.color: root.border
            border.width: 1
            Text {
              id: flagTipText
              anchors.centerIn: parent
              textFormat: Text.PlainText
              text: flagTip.text
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }
          anchors { top: rule.bottom; topMargin: Style.spacing.xxl; bottom: footer.top; bottomMargin: Style.spacing.lg; left: parent.left; right: parent.right }

          Column {
            id: topColumn
            anchors { top: parent.top; bottom: parent.bottom; left: parent.left }
            width: (parent.width - Style.spacing.huge * 2) * 0.58
            spacing: Style.spacing.md

            // Admins only: runs held for review, oldest first.
            Column {
              visible: !!root.me && root.me.isAdmin && root.pendingRuns.length > 0
              width: parent.width
              spacing: Style.spacing.sm

              Caption { text: "held for review"; color: root.urgent }
              Caption {
                visible: root.reviewError !== ""
                text: root.reviewError
                color: root.urgent
                font.capitalization: Font.MixedCase
                font.letterSpacing: 0
                font.pixelSize: Style.font.bodySmall
              }
              Repeater {
                model: root.pendingRuns
                delegate: Column {
                  required property var modelData
                  width: parent.width
                  spacing: Style.spacing.xs
                  Row {
                    width: parent.width
                    spacing: Style.spacing.lg
                    Text {
                      width: parent.width - Style.space(64) - approveButton.width - rejectButton.width - Style.spacing.lg * 3
                      textFormat: Text.PlainText
                      elide: Text.ElideRight
                      text: modelData.name + " · " + modelData.words + "w"
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }
                    Text {
                      width: Style.space(64)
                      horizontalAlignment: Text.AlignRight
                      textFormat: Text.PlainText
                      text: String(modelData.score)
                      color: root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                    }
                    ReviewButton { id: approveButton; label: "approve"; tint: root.accent; onClicked: root.reviewRun(modelData.runId, "approve") }
                    ReviewButton { id: rejectButton; label: "reject"; tint: root.urgent; onClicked: root.reviewRun(modelData.runId, "reject") }
                  }
                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    elide: Text.ElideRight
                    text: {
                      var st = modelData.stats
                      var parts = [modelData.flags.join(", ")]
                      if (st) parts.push(Math.round(st.msPerLetter) + "ms/letter", "react " + Math.round(st.medianReactionMs) + "ms", st.typos + " typos")
                      return parts.join(" · ")
                    }
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }
              }
              Rectangle { width: parent.width; height: 1; color: root.faint }
            }

            Caption { text: "top typists worldwide" }

            Caption {
              visible: root.topPlayers.length === 0
              text: root.boardLoading ? "loading…" : (root.boardError || "no runs yet — be the first")
              color: root.boardError ? root.urgent : root.dim
              font.capitalization: Font.MixedCase
              font.letterSpacing: 0
              font.pixelSize: Style.font.body
            }

            ListView {
              width: parent.width
              height: parent.height - y
              clip: true
              interactive: true
              boundsBehavior: Flickable.StopAtBounds
              model: root.topPlayers
              delegate: Item {
                required property var modelData
                readonly property bool isMe: modelData.name === root.playerName
                width: ListView.view.width
                height: Style.font.body + Style.spacing.md * 2
                Rectangle {
                  anchors.fill: parent
                  color: parent.isMe ? Util.alpha(root.accent, 0.12) : "transparent"
                }
                Row {
                  anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Style.spacing.sm; rightMargin: Style.spacing.sm }
                  spacing: Style.spacing.lg
                  Text {
                    width: Style.space(28)
                    textFormat: Text.PlainText
                    text: String(modelData.rank)
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                  }
                  // Flag and name as one unit, the flag just before the name.
                  Row {
                    width: parent.width - Style.space(28) - Style.space(44) - Style.space(56) - Style.space(64) - Style.spacing.lg * 4
                    spacing: Style.spacing.sm
                    Text {
                      id: flagText
                      // Centred on the name's line, nudged down: the emoji font
                      // sits higher than the text font.
                      anchors.verticalCenter: nameText.verticalCenter
                      anchors.verticalCenterOffset: Style.space(1)
                      width: Style.space(16)
                      textFormat: Text.PlainText
                      text: Countries.flag(modelData.country)
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      MouseArea {
                        anchors.fill: parent
                        hoverEnabled: true
                        onContainsMouseChanged: root.showFlagTip(flagText, containsMouse ? Countries.name(modelData.country) : "")
                      }
                    }
                    Text {
                      id: nameText
                      width: parent.width - flagText.width - parent.spacing
                      textFormat: Text.PlainText
                      elide: Text.ElideRight
                      text: modelData.name
                      color: parent.parent.parent.isMe ? root.accent : root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }
                  }
                  Text {
                    width: Style.space(44)
                    horizontalAlignment: Text.AlignRight
                    textFormat: Text.PlainText
                    text: modelData.words + "w"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                  Text {
                    width: Style.space(56)
                    horizontalAlignment: Text.AlignRight
                    textFormat: Text.PlainText
                    text: modelData.wpm > 0 ? modelData.wpm + " wpm" : ""
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                  Text {
                    width: Style.space(64)
                    horizontalAlignment: Text.AlignRight
                    textFormat: Text.PlainText
                    text: String(modelData.score)
                    color: root.accent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                  }
                }
              }
            }
          }

          Rectangle {
            anchors { top: parent.top; bottom: parent.bottom; left: topColumn.right; leftMargin: Style.spacing.huge }
            width: 1
            color: root.faint
          }

          Column {
            anchors { top: parent.top; right: parent.right }
            width: (parent.width - Style.spacing.huge * 2) * 0.42
            spacing: Style.spacing.md

            Caption { text: "you" }
            Text {
              visible: !!root.me
              textFormat: Text.PlainText
              text: root.countryEditing
                ? "◂  " + root.countryLabel(root.countryDraft) + "  ▸" + (root.countrySaving ? "  saving…" : "")
                : root.countryLabel(root.me ? root.me.country : "")
              color: root.countryEditing ? root.accent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
            Caption {
              visible: root.countryError !== ""
              width: parent.width
              elide: Text.ElideRight
              text: root.countryError
              color: root.urgent
              font.capitalization: Font.MixedCase
              font.letterSpacing: 0
              font.pixelSize: Style.font.bodySmall
            }
            Row {
              visible: !!root.me
              spacing: Style.spacing.huge
              Stat { label: "best"; value: root.me ? String(root.me.bestScore) : "0"; valueColor: root.accent }
              Stat { label: "rank"; value: root.me && root.me.rank ? "#" + root.me.rank : "—" }
              Stat { label: "runs"; value: root.me ? String(root.me.runCount) : "0" }
            }
            Caption {
              visible: !root.me
              text: root.playerName ? "loading…" : "pick a nickname to get ranked"
              font.capitalization: Font.MixedCase
              font.letterSpacing: 0
              font.pixelSize: Style.font.body
            }

            Item { width: 1; height: Style.spacing.lg }
            Caption { text: "last runs"; visible: !!root.me }
            Caption {
              visible: !!root.me && root.me.recentRuns.length === 0
              text: "no runs yet"
              font.capitalization: Font.MixedCase
              font.letterSpacing: 0
              font.pixelSize: Style.font.body
            }
            Repeater {
              model: root.me ? root.me.recentRuns : []
              delegate: Row {
                required property var modelData
                spacing: Style.spacing.lg
                Text {
                  width: Style.space(96)
                  textFormat: Text.PlainText
                  text: Qt.formatDateTime(new Date(modelData.playedAt), "dd MMM hh:mm")
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
                Text {
                  width: Style.space(36)
                  horizontalAlignment: Text.AlignRight
                  textFormat: Text.PlainText
                  text: modelData.words + "w"
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
                Text {
                  width: Style.space(56)
                  horizontalAlignment: Text.AlignRight
                  textFormat: Text.PlainText
                  text: String(modelData.score)
                  color: modelData.status === "pending" || modelData.status === "rejected" ? root.dim : root.accent
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.strikeout: modelData.status === "rejected"
                }
                Text {
                  visible: modelData.status === "pending"
                  textFormat: Text.PlainText
                  text: "review"
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
              }
            }
          }
        }
      }
    }
  }
}
