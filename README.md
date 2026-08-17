# AI Usage Widget

An always-on-top desktop widget that shows how much of your AI coding quota you have left — for
**Claude**, **Codex**, **GitHub Copilot** and **Antigravity** — in one place, updated live.

Every number is read from files and local services already on your machine. There is no cloud relay,
no browser-cookie scraping, no account to create, and no telemetry. Zero runtime dependencies.

> **Windows only, today.** The launcher and icon scripts are PowerShell, autostart uses Task
> Scheduler, and the Copilot source falls back to Windows `gh.exe` install paths. The Electron app and
> collector themselves are largely portable, so ports are welcome.

## Why

Each tool hides its usage somewhere different — a web page, a settings panel, a CLI, nowhere at all —
so "am I about to hit my weekly limit?" meant checking four places. This puts all four on one small
window that sits in the corner of the screen.

![The widget in wide mode, showing all four sources side by side](assets/screenshot.png)

*Wide mode — all four sources at once. There is also a narrow single-tab mode for parking in a corner.*

## Features

- **Four tabs**, each with the detail that tool actually exposes:
  - **Claude** — arc gauge for the 5-hour window, weekly bar, per-model limits, token split with a
    Today / Week / Month / All switcher, and a 30-day sparkline
  - **Codex** — arc gauge, weekly bar, latest-session token totals, plan badge
  - **Copilot** — hero numbers, usage bar, full quota card, plan badge
  - **Antigravity** — 5-hour and weekly quota per model group, activity counts, 30-day sparkline
- **Two view modes**, toggled by the grid icon in the titlebar and remembered between launches:
  **tabs** (one source at a time, a narrow column) and **wide** (all four side by side). Both render
  the *same* full detail — wide mode reuses the identical page renderers, so there is no
  second, simplified view to fall out of sync.
- **Frameless, always-on-top, draggable**, with adjustable opacity. Closes to the system tray rather
  than quitting, and remembers its position per view mode.
- **Freshness at a glance** — a coloured dot per section, with thresholds tuned per source, plus
  live countdowns to each quota reset that tick every second.
- **Colour escalation** at 80% (amber) and 95% (red).
- **Optional autostart** via a scheduled task, and a one-click launcher shortcut.
- **Graceful degradation** — a tool you do not use, or one that is not running, greys out its own
  section and explains why. It never blanks the rest of the widget.

## How it works

Two processes:

```text
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Electron widget        │  HTTP   │  Local collector             │
│  (renderer + tray)      ├────────▶│  127.0.0.1:8787              │
│                         │  Bearer │  GET /v1/summary             │
└─────────────────────────┘         └───────────┬──────────────────┘
                                                │ reads
                    ┌───────────────────────────┼───────────────────────────┐
                    ▼                ▼          ▼            ▼              ▼
              ~/.claude/       ~/.codex/    gh auth    Antigravity     ~/.gemini/
              (creds + logs)   sessions    token→API   language server  conversations
```

The widget polls `GET http://127.0.0.1:8787/v1/summary` with a bearer token and renders the JSON.
The collector is a dependency-free Node HTTP server that gathers each signal on its own schedule and
caches the result. The app spawns the collector automatically on launch and points itself at it, so
there is nothing to configure on first run.

The collector binds **loopback only** and requires a bearer token minted locally on first run — it
serves personal usage data and must never be reachable from the network.

You can also run the collector standalone (`npm run collector`) and point the widget at it, which is
how you debug a misbehaving source.

## Data sources

| Section | Where it comes from |
|---|---|
| Claude limits | `GET api.anthropic.com/api/oauth/usage`, authorised with the OAuth token Claude Code already stores in `~/.claude/.credentials.json`. Gives the 5-hour and 7-day windows plus per-model limits. |
| Claude tokens | Your local Claude Code transcripts (`~/.claude/projects/**/*.jsonl`). Parsed incrementally — byte offsets and daily totals are cached, so a few hundred transcripts cost milliseconds per poll. Deduped by message id, because resuming a session replays earlier messages into a new file. |
| Codex limits | The newest rollout log under `~/.codex/sessions/`, reading the last recorded rate-limit event. |
| Copilot quota | `gh auth token` → GitHub's Copilot user endpoint. Treated as a soft failure, since it is not a documented API. |
| Antigravity quota | Antigravity's **own local language server**, over loopback — the same source that backs its Settings → Models & Usage panel, so the numbers match exactly. Requires Antigravity to be **running**; otherwise this section reports itself unavailable. |
| Antigravity activity | The local conversation databases under `~/.gemini/antigravity/conversations/`. Independent of the quota call above, so activity counts and the sparkline work whether or not Antigravity is open. |

Every source is isolated in its own `try`/`catch`. When one fails it nulls only its own section, adds
a line to the response's `warnings[]`, and **keeps the last good value** so the section ages visibly
instead of going blank. Rate-limited endpoints back off exponentially.

If you do not use one of these tools, its section simply stays empty — nothing to disable.

## Privacy

This reads credentials, so it is worth being precise about what happens to them:

- **Nothing is transmitted anywhere except the vendor's own API**, using the credential that vendor
  already issued to you. There is no relay, no analytics, no crash reporting, no outbound call to any
  server the author controls.
- **`~/.claude/.credentials.json` is opened read-only and never written.** Claude Code owns that file
  and refreshes it; writing to it could clobber a live session.
- The collector listens on `127.0.0.1` only, and rejects any request without the locally generated
  bearer token (compared in constant time).
- From Antigravity's status response the collector takes **only the plan name**. That response also
  contains the signed-in account name and email; the widget has no reason to keep either, so it
  does not.
- All state stays on your machine, in `%APPDATA%/usage-widget/` — the config file and a parse cache.
  Both are gitignored.

## Download

Grab a single file from the [latest release](https://github.com/razikallayi/ai-usage-widget/releases/latest):

| File | Use it if |
|---|---|
| **`AI Usage Widget Setup 1.0.0.exe`** | You want it installed properly — creates Start Menu and desktop shortcuts. Installs per-user, so no admin prompt. |
| **`AI Usage Widget 1.0.0.exe`** | You just want to try it. Portable, nothing installed, no shortcuts. |

Nothing to configure — it detects your tools on first launch (see
[Setting up on a new PC](#setting-up-on-a-new-pc)). It starts in the system tray, so if no window
appears, look there.

> Windows may show a SmartScreen warning ("unknown publisher") because these builds are not code
> signed — a certificate costs a few hundred dollars a year. Choose *More info → Run anyway*, or
> build it yourself from source with `npm run dist:win` if you would rather not trust a binary.

## Setting up on a new PC

There is no configuration step. On first launch the app generates its own local token, starts its
collector, and finds everything by looking in the standard per-user locations — so it picks up
whichever account is signed in on that machine:

| Source | Detected from |
|---|---|
| Claude | `~/.claude/.credentials.json` and `~/.claude/projects/` — whatever Claude Code is signed into |
| Codex | `~/.codex/sessions/` |
| Copilot | `gh auth token`, i.e. whichever GitHub account the CLI is logged into. `gh` is found on `PATH` or in its standard install directories |
| Antigravity | Its language server, discovered live each cycle — the port and token change every launch, so nothing is remembered |

No paths, usernames, tokens or machine names are baked into the build. Anything you have not
installed simply leaves its section empty, and its own settings live in `%APPDATA%/usage-widget/` on
that machine.

## Requirements

- Windows 10/11
- Node.js 18+ (only to install; the app runs on Electron's bundled Node)
- Whichever tools you want to track. Each is optional:
  - Claude Code, signed in — for both Claude sections
  - Codex — for the Codex tab
  - [GitHub CLI](https://cli.github.com/) (`gh`), authenticated — for the Copilot tab
  - Antigravity, running — for Antigravity quota (activity counts need only that it has been used)

## Install

```bash
git clone https://github.com/razikallayi/ai-usage-widget.git
cd ai-usage-widget
npm install
npm start
```

The collector starts automatically. There is no setup step.

```bash
npm start            # launch the widget
npm run dev          # launch with DevTools open
npm run collector    # run the collector on its own; prints its URL + read token
npm run icon         # regenerate assets/icon.ico and tray-icon.png
```

## Autostart and launcher

```bash
npm run launcher                      # create the shortcut + register autostart
npm run launcher -- -DelayMinutes 5   # same, with a different startup delay
npm run launcher:remove               # remove the shortcut, task, and startup script
```

This creates `AI Usage Widget.lnk` in the project root — it points straight at Electron, so there is
no console window — and registers a scheduled task that starts the widget a couple of minutes after
logon, once Windows has settled. The task runs unelevated on purpose: an elevated always-on-top
window cannot exchange drag-drop or clipboard with normal apps.

The shortcut is gitignored, since a `.lnk` embeds absolute paths from the machine that made it.

Relaunching is always safe — the app holds a single-instance lock and focuses the existing window
instead of starting a second copy.

## Configuration

Settings live in the in-app modal (right-click the tray icon, or the gear in the titlebar). They are
persisted to `%APPDATA%/usage-widget/config.json`:

| Key | Default | Meaning |
|---|---|---|
| `viewMode` | `wide` | `tabs` or `wide` |
| `opacity` | `1` | Window opacity |
| `alwaysOnTop` | `true` | Keep above other windows |
| `pollIntervalMs` | `20000` | How often the widget re-polls the collector |
| `collectorAutoStart` | `true` | Set `false` to run the collector yourself |
| `collectorPort` | `8787` | Collector port |
| `relayUrl` / `readToken` | auto | Filled in automatically for the local collector |
| `windowBounds` / `wideBounds` | — | Geometry, one per view mode |

`config.json.example` shows the shape.

> **Do not hand-edit `config.json` while the widget is running.** Window bounds are saved on a
> debounce, so your edit will be overwritten seconds later. Quit the app first.

### Polling cadence

The collector deliberately polls each source at a different rate — the Anthropic usage endpoint
answers `429` well below a 30-second cadence, while local file scans are essentially free. These
windows move over hours, so slow polling costs nothing in accuracy.

| Source | Interval | Why |
|---|---|---|
| Claude limits | 120s | Rate limited; the windows are hours long |
| Claude tokens | 30s | Local, incremental file scan |
| Codex | 30s | Local file scan |
| Copilot | 300s | It is a monthly counter |
| Antigravity activity | 60s | Local database scan, cached on mtime |
| Antigravity quota | 120s | Local RPC, but no faster than the panel updates |

A `429` doubles that source's interval, capped at 15 minutes, and clears on the next success. Because
the cadences differ, staleness colours are per-section rather than one global rule — otherwise the
Copilot dot would sit permanently red.

Running two collectors at once will trip the Anthropic rate limit and blank the Claude gauge.

## Troubleshooting

**Start with `warnings[]`** in the summary response — it names any source that failed, and why:

```bash
curl -H "Authorization: Bearer <readToken>" http://127.0.0.1:8787/v1/summary
```

**Is a source throttled or actually broken?** From the outside both look like an empty section.
`GET /health` distinguishes them, reporting `hasValue`, `lastOkSec`, `lastTrySec`, `backoffSec` and
`lastError` per source. A `backoffSec` above zero means throttled, not failing.

```bash
curl http://127.0.0.1:8787/health
```

**The Antigravity tab says quota unavailable.** Its quota comes from Antigravity's own local
language server, so Antigravity has to be running. Activity counts keep working regardless.

**The Codex tab looks stale.** Codex reports two ages, and they mean different things: collector
freshness (the titlebar dot) versus "last session *N*h ago" in the tab footer, which is how long
since you last used Codex. An idle Codex is not a broken collector.

**`Cannot read properties of undefined (reading 'requestSingleInstanceLock')`.** Something in your
environment has set `ELECTRON_RUN_AS_NODE=1`, which makes Electron boot as plain Node. `npm start`
goes through `launch.js`, which strips it; launching Electron directly from such a shell does not.
Clear the variable, or launch from Explorer.

**Every setting reset itself.** The config file was probably saved with a UTF-8 BOM by Notepad or
`Set-Content -Encoding UTF8`. Recent versions strip it on load; an unparseable file is moved aside to
`config.json.bak` rather than silently discarded.

## Demo mode

The widget ships realistic mock data, which is how to work on the UI without waiting on live sources —
and how to take screenshots without publishing your own account details.

```js
// DevTools console (npm run dev)
window.demo.start()
window.demo.stop()
```

`src/renderer/scripts/pages/demo.js` is also the authoritative description of the API payload shape;
the page renderers were written against it.

## Project layout

```text
collector/          zero-dependency Node HTTP server
  sources/          one module per data source, each independently failable
  server.js         scheduling, per-source backoff, /v1/summary + /health
src/main/           Electron main process: window, tray, IPC, config, collector spawn
src/renderer/
  scripts/pages/    one renderer per tab, plus demo.js (the payload contract)
  scripts/          gauges, sparklines, countdowns, staleness, settings
  styles/           CSS; wide mode is CSS-only
scripts/            PowerShell: launcher install/uninstall, icon generation
```

## API contract

`GET /v1/summary` with `Authorization: Bearer <token>` returns `claude.limits`, `claude.tokens`,
`codex.limits`, `codex.tokens`, `codex.history`, `copilot.quota`, `antigravity.quota` and
`antigravity.activity` — each nullable, each carrying `ageSec` and reset countdowns — plus a
top-level `warnings[]`.

## License

MIT — see [LICENSE](LICENSE).
