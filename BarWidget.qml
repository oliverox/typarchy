import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import "Config.js" as Config

BarWidget {
  id: root
  moduleName: "typarchy.game"

  readonly property bool devBackend: Config.devUrl(Quickshell.env("TYPARCHY_CONVEX_URL")) !== ""
  readonly property string stateHelper: Qt.resolvedUrl("bin/typarchy-state").toString().replace(/^file:\/\//, "")
  readonly property string profilePath: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state")
    + (devBackend ? "/typarchy-dev" : "/typarchy") + "/profile.json"
  property int bestScore: 0
  property int rank: 0
  property string playerName: ""

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // The overlay rewrites profile.json whenever the player's standing changes.
  // FileView only watches; the helper does the reading (no symlinks, capped, validated).
  FileView {
    path: root.profilePath
    preload: false
    blockAllReads: true
    watchChanges: true
    printErrors: false
    onFileChanged: reader.restart()
  }

  Timer {
    id: reader
    interval: 150
    onTriggered: if (!readProc.running) readProc.running = true
  }

  Process {
    id: readProc
    property string buf: ""
    command: ["/usr/bin/python3", "-I", "-S", root.stateHelper, "read", "profile"].concat(root.devBackend ? ["--dev"] : [])
    stdout: SplitParser {
      splitMarker: ""
      onRead: function(chunk) {
        readProc.buf += chunk
        if (readProc.buf.length > 32768) { readProc.buf = ""; readProc.signal(9) }
      }
    }
    onExited: function(code) {
      var text = readProc.buf
      readProc.buf = ""
      if (code !== 0) return
      try {
        var data = JSON.parse(text)
        root.bestScore = Number.isInteger(data.bestScore) ? data.bestScore : 0
        root.rank = Number.isInteger(data.rank) ? data.rank : 0
        root.playerName = Config.plain(data.name, 16)
      } catch (e) {}
    }
  }

  Timer {
    interval: 5000
    running: readProc.running
    onTriggered: readProc.signal(9)
  }

  Component.onCompleted: readProc.running = true

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "T"
    tooltipText: {
      if (!root.playerName) return "Typarchy — pick a nickname and play"
      var standing = root.rank > 0 ? "#" + root.rank + " worldwide" : "unranked"
      return "Typarchy · " + root.playerName + " · best " + root.bestScore + " · " + standing
    }
    onPressed: function(b) {
      if (!root.bar || !root.bar.shell) return
      root.bar.shell.toggle("typarchy.game", b === Qt.RightButton ? "{\"view\":\"board\"}" : "{}")
    }
  }
}
