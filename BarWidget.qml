import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui

BarWidget {
  id: root
  moduleName: "typarchy.game"

  readonly property string profilePath: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") + "/typarchy/profile.json"
  property int bestScore: 0
  property var rank: null
  property string playerName: ""

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // Written by the overlay whenever the player's standing changes.
  FileView {
    path: root.profilePath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try {
        var data = JSON.parse(text())
        root.bestScore = data.bestScore || 0
        root.rank = data.rank || null
        root.playerName = data.name || ""
      } catch (e) {}
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "T"
    tooltipText: {
      if (!root.playerName) return "Typarchy — pick a nickname and play"
      var standing = root.rank ? "#" + root.rank + " worldwide" : "unranked"
      return "Typarchy · " + root.playerName + " · best " + root.bestScore + " · " + standing
    }
    onPressed: function(b) {
      if (!root.bar) return
      if (b === Qt.RightButton) root.bar.run("omarchy-shell shell toggle typarchy.game '{\"view\":\"board\"}'")
      else root.bar.run("omarchy-shell shell toggle typarchy.game")
    }
  }
}
