.pragma library

// Replies from bin/typarchy-api, which calls Convex's HTTP function API
// (POST <deployment>/api/{query,mutation}) with a hard byte cap, no redirects
// and no proxies. The helper prints the HTTP status on the first line and the
// body after it; it exits 3 when the server is unreachable and 4 when the
// reply is larger than any real one.
//
// parse() returns { error, value }. `error` is null on success, otherwise
// { code, message, offline } where `offline` means the server was unreachable.

var MAX_MESSAGE_CHARS = 200

function message(value, fallback) {
  var text = typeof value === "string" ? value : fallback
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, MAX_MESSAGE_CHARS)
}

function fail(code, text, offline) {
  return { error: { code: code, message: text, offline: offline }, value: null }
}

// exitCode is null when the call was killed (timeout or cancelled).
function parse(exitCode, output) {
  if (exitCode === 4) return fail("TOO_LARGE", "Leaderboard reply was too large.", false)
  if (exitCode !== 0) return fail("OFFLINE", "Can't reach the leaderboard.", true)

  var newline = output.indexOf("\n")
  var status = parseInt(newline > 0 ? output.slice(0, newline) : "", 10)
  var body = null
  try { body = JSON.parse(output.slice(newline + 1)) } catch (e) {}

  if (body && body.status === "success") return { error: null, value: body.value }
  if (body && body.status === "error") {
    var data = body.errorData || {}
    return fail(message(data.code, "SERVER"), message(data.message || body.errorMessage, "Server error"), false)
  }
  status = isFinite(status) ? status : 0
  return fail("HTTP_" + status, "Leaderboard error (" + status + ")", status >= 500)
}
