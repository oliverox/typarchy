# Typarchy

Survival speed-typing for [Omarchy](https://omarchy.org), with a worldwide leaderboard.

One word at a time, one shrinking clock. Type the word before the bar empties;
every word makes the clock tighter. A wrong key breaks your streak.

The repo is both the Omarchy shell plugin (repo root) and its Convex backend (`backend/`).

## Install

```bash
omarchy plugin add https://github.com/oliverox/typarchy --enable
```

Or for local development, link the checkout:

```bash
ln -sfn ~/Work/typarchy ~/.config/omarchy/plugins/typarchy.game
omarchy-shell shell rescanPlugins
omarchy plugin enable typarchy.game
```

The shell doesn't watch files behind a symlink and caches loaded QML, so run
`omarchy restart shell` after editing to see changes.

Add a keybinding in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + SHIFT + T", "Typarchy", "omarchy-shell shell toggle typarchy.game")
```

The bar widget (keyboard icon) shows your best score and rank. Left click plays,
right click opens the leaderboard.

## Uninstall

```bash
omarchy plugin remove typarchy.game
rm -rf ~/.local/state/typarchy   # optional: forget your nickname token and cached words
```

Removing the plugin doesn't delete your leaderboard entry. Remove any keybinding you added to
`bindings.lua` yourself.

## Dependencies and network use

Typarchy needs no extra packages beyond Omarchy's shell. The ranked mode talks over HTTPS to
the Typarchy leaderboard, a [Convex](https://convex.dev) deployment (`Config.js`). It sends
only your chosen nickname, its token, and run data (word timings and typo counts). Nothing
else leaves your machine. Offline practice needs no network.

The `backend/` folder is the server code. You don't need to install it to play.

## Controls

| Key | |
|---|---|
| Enter | start a run / run it back |
| letters | type the word — it completes automatically when it matches |
| Backspace, Ctrl+Backspace, Ctrl+W | delete a letter / clear the word |
| Tab | switch between survival and leaderboard |
| R | refresh the leaderboard |
| Esc | abandon the run, leave the leaderboard, or close |

## Rules

- The first word gets 4.2s. Each completed word shrinks the next window by 3.5%, down to 1.2s.
- A word scores `letters × 10 + remaining time / 100ms`.
- A wrong keystroke breaks the streak but costs no time.
- The run ends when the clock hits zero.

Rules live in `backend/convex/lib/rules.ts` and are mirrored in `Rules.js`;
`npm test` in `backend/` replays simulated runs through both to keep them identical.

## How ranking works

- **Nicknames, no accounts.** Claiming a nickname returns a secret token stored in
  `~/.local/state/typarchy/identity.json` (directory mode 700). Lose the file, lose the name.
- **Server-run sessions.** The server starts each run and issues its words. The client
  checks in every 10 words (and receives more words), then submits per-word timestamps
  and typo counts. The server replays the run with the same rules, computes the score
  itself, and rejects runs whose timing doesn't line up with its own clock (paused or
  invented timestamps, impossibly fast words). A bot that actually plays can still win;
  forged score submissions can't.
- **Offline.** If the leaderboard is unreachable the game falls back to an unranked
  practice run using words cached from your last ranked run.

## Words

Words come from Wiktionary, not from this repo. `wordSync.refresh` pulls the
[English Wikipedia (2016) frequency list](https://en.wiktionary.org/wiki/Wiktionary:Frequency_lists/English/Wikipedia_(2016))
through the Wiktionary API, keeps lowercase 3–12 letter words, and drops anything in
Wiktionary's English vulgarity, offensive, slur, and swear-word categories. It runs
weekly via cron and stores the pool in Convex.

## Backend

```bash
cd backend
npm install
npx convex dev                       # dev deployment, writes .env.local
npx convex run wordSync:refresh      # fill the word pool (≈30s)
npm test
```

The plugin talks to the URL in `Config.js` (override with `TYPARCHY_CONVEX_URL` in the
shell's environment).

### Going to production

```bash
cd backend
npx convex deploy
npx convex run --prod wordSync:refresh
```

Then set `Config.js` → `convexUrl` to the production deployment URL.

### Moderation

```bash
npx convex run admin:removePlayer '{"name":"someone"}'   # add --prod for production
```

## License

[MIT](LICENSE)
