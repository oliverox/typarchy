.pragma library

// Minimal client for Convex's HTTP function API:
// POST <deployment>/api/{query,mutation} {path, args, format: "json"}.
//
// callback(error, value). `error` is null on success, otherwise
// { code, message, offline } where `offline` means the server was unreachable.
//
// QML's XMLHttpRequest has no timeout support, so calls return the request and
// callers abort() it from a Timer; an aborted request reports as offline.

function call(baseUrl, kind, path, args, callback) {
  var xhr = new XMLHttpRequest()
  var finished = false
  function finish(error, value) {
    if (finished) return
    finished = true
    callback(error, value)
  }

  xhr.onreadystatechange = function() {
    if (xhr.readyState !== XMLHttpRequest.DONE) return
    if (xhr.status === 0) {
      finish({ code: "OFFLINE", message: "Can't reach the leaderboard.", offline: true })
      return
    }
    var body = null
    try { body = JSON.parse(xhr.responseText) } catch (e) {}
    if (body && body.status === "success") {
      finish(null, body.value)
    } else if (body && body.status === "error") {
      var data = body.errorData || {}
      finish({ code: data.code || "SERVER", message: data.message || body.errorMessage || "Server error", offline: false })
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
