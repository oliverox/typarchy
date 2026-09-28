.pragma library

// Minimal client for Convex's HTTP function API:
// POST <deployment>/api/{query,mutation} {path, args, format: "json"}.
//
// callback(error, value). `error` is null on success, otherwise
// { code, message, offline } where `offline` means the server was unreachable.
//
// QML's XMLHttpRequest has no timeout support, so calls return the request and
// callers abort() it from a Timer; an aborted request reports as offline.

// The largest reply is a fresh session's 150 words; nothing legitimate comes near this.
var MAX_RESPONSE_CHARS = 262144
var MAX_MESSAGE_CHARS = 200

function message(value, fallback) {
  var text = typeof value === "string" ? value : fallback
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, MAX_MESSAGE_CHARS)
}

function call(baseUrl, kind, path, args, callback) {
  var xhr = new XMLHttpRequest()
  var finished = false
  function finish(error, value) {
    if (finished) return
    finished = true
    callback(error, value)
  }
  // Stop reading as soon as the reply is bigger than any real one, instead of
  // measuring it after the whole body is in memory.
  function tooLarge() {
    finish({ code: "TOO_LARGE", message: "Leaderboard reply was too large.", offline: false })
    xhr.abort()
  }

  if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud$|^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$/.test(baseUrl.replace(/\/$/, ""))) {
    finish({ code: "BAD_URL", message: "Leaderboard address isn't allowed.", offline: false })
    return xhr
  }

  xhr.onreadystatechange = function() {
    if (finished) return
    if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
      var declared = parseInt(xhr.getResponseHeader("Content-Length") || "0", 10)
      if (declared > MAX_RESPONSE_CHARS) tooLarge()
      return
    }
    if (xhr.readyState === XMLHttpRequest.LOADING) {
      if (xhr.responseText.length > MAX_RESPONSE_CHARS) tooLarge()
      return
    }
    if (xhr.readyState !== XMLHttpRequest.DONE) return
    if (xhr.status === 0) {
      finish({ code: "OFFLINE", message: "Can't reach the leaderboard.", offline: true })
      return
    }
    if (xhr.responseText.length > MAX_RESPONSE_CHARS) {
      tooLarge()
      return
    }
    var body = null
    try { body = JSON.parse(xhr.responseText) } catch (e) {}
    if (body && body.status === "success") {
      finish(null, body.value)
    } else if (body && body.status === "error") {
      var data = body.errorData || {}
      finish({
        code: message(data.code, "SERVER"),
        message: message(data.message || body.errorMessage, "Server error"),
        offline: false
      })
    } else {
      finish({ code: "HTTP_" + xhr.status, message: "Leaderboard error (" + xhr.status + ")", offline: xhr.status >= 500 })
    }
  }

  xhr.open("POST", baseUrl.replace(/\/$/, "") + "/api/" + kind)
  xhr.setRequestHeader("Content-Type", "application/json")
  xhr.send(JSON.stringify({ path: path, args: args || {}, format: "json" }))
  return xhr
}

function query(baseUrl, path, args, callback) {
  return call(baseUrl, "query", path, args, callback)
}

function mutation(baseUrl, path, args, callback) {
  return call(baseUrl, "mutation", path, args, callback)
}
