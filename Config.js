.pragma library

// The leaderboard's Convex deployment is fixed in bin/typarchy-api (CONVEX_URL).

// TYPARCHY_CONVEX_URL may point the game at a local backend (`npx convex dev`),
// and only at one on this machine. A dev backend gets its own nickname token,
// kept in ~/.local/state/typarchy-dev, so the real one never leaves for it.
function devUrl(value) {
  var url = String(value || "")
  return /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]{1,5})?\/?$/.test(url) ? url : ""
}

// Strings from state files or the server, made safe for sinks the shell
// renders as rich text (bar tooltips): no markup, no control characters, capped.
function plain(value, max) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[<>&\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .slice(0, max || 64)
}
