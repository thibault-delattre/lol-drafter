# Architecture — LoL Draft Coach

Developer reference. The [README](../README.md) explains *what the app does and why*, in prose,
and is the better first read for product intent. This file is the map of the code: what each
module owns, the exact shapes that cross module boundaries, the external data formats, and the
invariants that must survive any change.

Companion documents:
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — verified defects and the prioritised backlog.
- [../CLAUDE.md](../CLAUDE.md) — working rules for an agent picking this project up.

---

## 1. What this program is

An Electron desktop app that polls the local League of Legends client during champion select,
enriches the draft with measured statistics from u.gg, asks Claude (through the `claude` CLI)
what to pick / ban / build, and renders the answer.

- **Runtime:** Electron 33, Node inside it. Windows-only in practice (see §9).
- **Dependencies:** exactly one, `electron`, and it is a *devDependency*. No runtime npm
  packages. Everything else is Node stdlib.
- **No API key.** Claude is reached by spawning the `claude` CLI, which runs on the user's own
  subscription. This is the single largest constraint on the design — see §6.
- **No build step.** `npm start` runs the source directly. There is no bundler, no transpiler,
  no packaging config.
- **Not a git repository.** See KNOWN_ISSUES.md #9.

### Three questions, one pipeline

The app answers a different question depending on where you are in the draft, and this is the
organising idea of the whole codebase:

| Draft state | Question | Statistics subject | Prompt builder |
|---|---|---|---|
| Ban phase | What should I ban? | **the champion I am hovering** — "who beats *me*" | `buildPrompt` + `banWeighting` |
| Pick phase | What should I pick? | **my lane opponent** — "who beats *them*" | `buildPrompt` + `priorityBlock` |
| Locked in | How do I build? | (no matchup stats; uses the champion's build page) | `buildBuildPrompt` |

`statsFocus()` in [src/main/main.js](../src/main/main.js) is the switch between the first two.
`isLockedIn()` is the switch to the third.

---

## 2. Module map

```
src/main/            Electron main process — all logic, all network, all state
  main.js      501   Orchestrator: poll loop, run scheduling, IPC, view models
  lcu.js       130   League client local API (credentials, HTTPS, phase, session)
  draft.js      98   LCU session  ->  normalised draft state  + change signature
  champdata.js 115   Data Dragon: champions, items, runes, spells (+ disk cache)
  attributes.js 217  Curated per-champion damage/frontline/CC/engage table
  analyze.js    88   Composition meters and gap warnings (local, instant)
  lanes.js      89   Curated lane table + greedy enemy-role assignment
  ugg.js       449   u.gg matchups, primary roles, statistical builds (+ disk cache)
  prompt.js    360   Every prompt string the model ever sees
  ai.js        195   Spawns the claude CLI, streams it, validates its output
  preload.js    13   contextBridge surface
src/renderer/        Renderer process — deliberately dumb, no logic
  index.html    87   Static skeleton; every section is populated by app.js
  app.js       484   DOM rendering + IPC listeners
  styles.css   161   Dark theme, CSS custom properties at :root
src/data/            Write-through caches (checked in; safe to delete)
  champions.cache.json    Data Dragon champion list, 173 champions, patch 16.17.1
  gamedata.cache.json     868 items, 67 runes, 34 summoner spells
  ugg/*.json              12-hour TTL u.gg responses
test/                See §8
```

**Dependency direction.** `main.js` depends on everything; nothing depends on `main.js`.
`prompt.js` imports `lanes.js` and (lazily, inside a function) `attributes.js`. `analyze.js`
imports `attributes.js`. Everything else is a leaf. There are no cycles.

---

## 3. The main loop

`tick()` runs every `POLL_MS = 1500` ms, started once the renderer signals `did-finish-load`.

```
tick()
 |- COACH_MOCK set?  --> mockSession() from test/fixture.js, skip the LCU entirely
 |- lcu.getPhase()
 |    \- not "ChampSelect" --> cancel any run, reset state, send('state', {status:'waiting'})
 |- lcu.getSession()  -->  parseSession()  -->  state
 |- analyzeDraft(state, champions)  -->  analysis      (local, sub-millisecond)
 |- send('state', {status:'draft', draft: toViewModel(state, analysis)})   <- every tick
 \- signature(state) changed?
      |- inferEnemyRoles()  -->  roles
      |- pushCounters(state, roles)          <- u.gg, milliseconds when cached
      |- opponent changed && pick mode?  --> preemptAi()
      \- scheduleAi(state, analysis, urgent)
```

### Why the signature exists

`signature(state)` in [src/main/draft.js](../src/main/draft.js) is a fingerprint of everything
that *should* cause a re-analysis. **Your own hover is deliberately excluded** — scrolling the
champion grid must not restart a 6–60 second analysis, and what is good for you does not depend
on which champion your cursor is over. Five tests in `run-tests.js` lock this behaviour in.

### Run scheduling — three rules that fight each other

The scheduler exists because an analysis (6–60 s) routinely takes longer than the gap between
draft actions. Three rules resolve that:

1. **Serialise, don't cancel** (`startAi` / `finishAi` / `pendingRun`). A newer draft state
   queues; the run in flight is allowed to finish. Cancelling on every pick meant *none* ever
   finished.
2. **Debounce** (`scheduleAi`, `AI_DEBOUNCE_MS = 700`, or 200 ms when `urgent`). `urgent` is
   true when your turn just started, or the stats subject just changed.
3. **Preempt on one input only** (`preemptAi`). Your lane opponent locking in dominates the
   answer, so an analysis that predates it is abandoned. `aiRunId` is bumped *before* the kill,
   which orphans the dying run's callbacks so the cancellation is never reported to the UI as an
   error. This is the single exception to rule 1.

`aiRunId` is the guard throughout: every `.then`/`.catch` in `runAi` starts with
`if (runId !== aiRunId) return;`.

### `preemptAi` scope

Preemption fires only for `focus.mode === 'pick'`. During a ban the subject is your own hover,
which changes constantly and is only a comfort signal — preempting on it would thrash.

---

## 4. Data contracts

### 4.1 Draft state — `parseSession(session)` returns `state`

```js
{
  localCellId: 3,
  me:          <player | null>,
  myPosition:  'Top' | 'Jungle' | 'Mid' | 'Bot' | 'Support' | null,
  myTeam:      [<player> x5],
  theirTeam:   [<player> x5],
  allyBans:    [championId, ...],
  enemyBans:   [championId, ...],
  unavailable: Set<championId>,     // <- the legality source of truth
  isMyTurn:    boolean,
  myActionType:'pick' | 'ban' | null,
  timeLeft:    seconds | null,
  phase:       'BAN_PICK' | ... | null,
}

player = {
  cellId, position, championId /* 0 if none */, hoveredId /* 0 if locked */, isLocal
}
```

`unavailable` = all 10 bans + every locked champion on both teams + every **ally** hover.
Your own hover is **not** in it. That set is the one thing the whole legality guarantee rests on.

### 4.2 Composition analysis — `analyzeDraft(state, champions)` returns `analysis`

```js
{ ally: <team>, enemy: <team> }

team = {
  picked, ad, ap, adPct, apPct, frontline, cc, engage,
  gaps:      ['No frontline at all - nothing absorbs damage', ...],
  strengths: ['Strong frontline', ...],
  champions: ['Malphite', 'Jinx', ...],
}
```

Hovers count as intent, **including your own** — see KNOWN_ISSUES.md #4, this is a bug.

### 4.3 u.gg lane stats — `ugg.buildLaneStats(...)` returns `stats | null`

```js
{
  opponent:   'Teemo',              // the SUBJECT, not necessarily an enemy (ban mode = you)
  mode:       'pick' | 'ban',
  asOf:       '2026-09-03T22:58:34.217589Z',
  totalGames: 63106,
  counters:   [{championId, name, games, wins, winRate, confidence}, ...],  // <=14, beat subject
  losers:     [{...}, ...],                                                 // <=6,  lose to subject
  matchups:   <raw laneMatchups result>,
}
```

Both lists are already filtered to champions that are still legal (`unavailable`) and that
resolve to a real name. `null` whenever u.gg is unreachable — every caller must tolerate that.

### 4.4 IPC — main to renderer

Four channels, all one-way pushes from main, exposed through
[src/main/preload.js](../src/main/preload.js) as `window.coach.onX`.

| Channel | Payload |
|---|---|
| `ready` | `{ patch, championCount }` |
| `state` | `{status:'waiting', phase}` or `{status:'error', message}` or `{status:'draft', draft:<viewModel>}` |
| `counters` | `null` or `{opponent, mode, asOf, totalGames, list:[{name, winRate, games, img, damage}]}` |
| `ai` | see below |

`ai` payloads, in the order they can arrive:

```js
{status:'queued'}                                                    // another run is in flight
{status:'running', startedAt, mode?:'build'}
{status:'streaming', picks, rejected, startedAt}                     // one pick at a time
{status:'done', read, picks, avoid, rejected, basedOn, opponent, elapsed}
{status:'done', mode:'build', build:<shaped build>, elapsed}
{status:'error', message, raw?}
```

Renderer to main, all `ipcRenderer.invoke`:

| Handle | Effect |
|---|---|
| `init` | returns `readyInfo` (the renderer calls this in case it missed the `ready` push) |
| `refresh` | forces `runAi(lastState, lastAnalysis)` — **bypasses the `aiBusy` guard**, see KNOWN_ISSUES.md #3 |
| `set-model` | replaces the `Analyzer` instance |
| `set-always-on-top` | `win.setAlwaysOnTop(v)` |

The view model (`toViewModel`) resolves every champion id to `{id, name, slug, img, damage}`
in main, so the renderer never needs the champion table. Keep it that way.

---

## 5. External data sources

### 5.1 League Client (LCU) — [lcu.js](../src/main/lcu.js)

Credentials come from `lockfile` (`LeagueClient:<pid>:<port>:<password>:https`) in one of four
hardcoded install paths, falling back to reading `--app-port` / `--remoting-auth-token` off the
running `LeagueClientUx.exe` command line via PowerShell.

> **The lockfile paths are currently broken** — the backslashes are unescaped inside a JS string
> literal, so `'C:\Riot Games\...'` evaluates to `C:Riot GamesLeague of Legendslockfile`.
> Every run silently falls through to the PowerShell process scan. See KNOWN_ISSUES.md #1.

Two endpoints are used:

- `GET /lol-gameflow/v1/gameflow-phase` — a bare JSON string, e.g. `"ChampSelect"`, `"Lobby"`, `"InProgress"`.
- `GET /lol-champ-select/v1/session` — the champ select session.

Auth is HTTP Basic `riot:<password>`. The client serves a self-signed certificate, so the
agent sets `rejectUnauthorized: false` — acceptable here because the host is pinned to
`127.0.0.1`. `get()` retries once after re-discovering credentials, which handles the client
restarting on a new port.

**Session fields the app reads:** `localPlayerCellId`, `myTeam[]`, `theirTeam[]`
(`cellId`, `assignedPosition`, `championId`, `championPickIntent`), `bans.myTeamBans`,
`bans.theirTeamBans`, `actions[][]` (`actorCellId`, `championId`, `completed`, `type`,
`isAllyAction`, `isInProgress`), `timer.adjustedTimeLeftInPhase`, `timer.phase`.

`actions` is a 2-D array (one inner array per draft step) and is flattened on read. A player's
hover is `championPickIntent`, or the `championId` on their own in-progress `pick` action.

Riot does **not** expose `assignedPosition` for the enemy team in ranked. That absence is the
reason `lanes.js` and `inferEnemyRoles` exist.

### 5.2 Data Dragon — [champdata.js](../src/main/champdata.js)

Plain `https.get`, no special headers. Network-first, disk-cache fallback.

```
https://ddragon.leagueoflegends.com/api/versions.json            -> ["16.17.1", ...]
https://ddragon.leagueoflegends.com/cdn/<v>/data/en_US/champion.json
                                              .../item.json
                                              .../runesReforged.json
                                              .../summoner.json
https://ddragon.leagueoflegends.com/cdn/<v>/img/champion/<slug>.png
https://ddragon.leagueoflegends.com/cdn/<v>/img/item/<id>.png
```

`itemMeta[id] = {gold, consumable, boots, trinket}` is derived here and is what lets
`ugg.championBuild` tell a real core item from a potion.

### 5.3 u.gg — [ugg.js](../src/main/ugg.js)

Undocumented static JSON that u.gg's own site reads. **Cloudflare fingerprints the TLS
handshake**, and Node's differs from a browser's, so `https.get` gets a challenge page no matter
what headers it sends. The module therefore prefers `electron.net` (Chromium's network stack),
which is let through, and keeps the raw `https` path only for running outside Electron. *This is
why the live tests must run under Electron.*

```
https://stats2.u.gg/lol/1.5/primary_roles/<patch>/1.5.0.json
https://stats2.u.gg/lol/1.5/matchups/<patch>/ranked_solo_5x5/<championId>/1.5.0.json
https://stats2.u.gg/lol/1.5/overview/<patch>/ranked_solo_5x5/<championId>/1.5.0.json
```

`<patch>` is the `16_17` form (`patchKey('16.17.1')`). Every fetch tries the current patch, then
the previous one — u.gg can lag a day after a patch ships.

**Role ids:** `{Jungle:1, Support:2, Bot:3, Top:4, Mid:5}`.

**Matchup / overview payload shape:** `data[region][tier][roleId] = [rows, timestampString]`.

**Matchup rows:** `[opponentChampionId, wins, games]`.

> **The most important fact in this codebase.** The `wins` in a row belong to the champion
> **named in that row**, not to the champion whose file it is. Reading it the other way inverts
> every single matchup, and the app shipped that way once — it claimed Vayne beat Teemo 62.7%
> (Teemo in fact wins that lane 62%) and called Malphite one of the worst picks into Vayne (he
> is the best, 62.4%). Three regression tests in `npm run test:stats` exist solely to catch a
> re-inversion. Never "fix" the orientation without running them.

**Rank bucket:** matchups are pinned to `region 12 / tier 17` = **World / Emerald+**, the slice
u.gg shows by default. Those codes were identified by reproducing a published figure exactly
(Gwen 54.68% into K'Sante, top, Emerald+) and that reproduction is a test. An earlier version
picked whichever bucket had the most games, which silently reported a *different rank's*
numbers. `pickBucket` falls back to the largest bucket only if the pinned one is missing or has
fewer than `MIN_BUCKET_GAMES = 3000` games.

> `championBuild` still uses the old largest-bucket heuristic, so builds and matchups can come
> from different rank slices. See KNOWN_ISSUES.md #2.

**Overview (build) payload sections** — the `BUILD` index map, confirmed by decoding a champion
whose build is well known (Darius: Flash+Ghost, Doran's Blade, Conqueror):

```
0 runes   1 spells   2 starting   3 boots   4 skills   5 items   6 record   8 shards
```

Item slots contain potions and repeats of items bought earlier, so `pickTop` filters by
`itemMeta` (not consumable, not trinket, not boots, at least 1600 gold) and by an already-taken
set — without that, Thresh "builds Thornmail twice".

**Ranking.** `rankCounters` drops anything under `MIN_MATCHUP_GAMES = 300` games or at/below
50% win rate, then orders by the **lower bound of a Wilson score interval** rather than the raw
percentage, so 58% over 250 games ranks below 54% over 10,000. The raw rate and sample size are
always displayed; `confidence` is used for ordering only.

**Caching.** `src/data/ugg/<name>.json`, 12-hour TTL by file mtime. Best-effort: every read and
write is wrapped and failures are ignored. Deleting the directory is always safe.

**Every u.gg function returns `null` on any failure and never throws.** Callers omit the section
rather than degrading. Preserve this.

### 5.4 The `claude` CLI — [ai.js](../src/main/ai.js)

Spawned, not shelled, where possible: `resolveClaude()` looks for the native binary at
`%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` then
`%LOCALAPPDATA%\Programs\claude\claude.exe`, and falls back to `claude` on `PATH` with
`shell: true`. Spawning the binary directly avoids Windows `.cmd` quoting problems.

```
claude -p --output-format stream-json --include-partial-messages --verbose \
       --allowed-tools '' --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
       --setting-sources '' --model <model>
```

The prompt goes over **stdin**, so its length and quoting never matter. Tools, MCP and settings
sources are all disabled so a user's local config cannot change the app's behaviour.

Output is NDJSON. Two message types are consumed: `stream_event` with
`event.type === 'content_block_delta'` (accumulated into `full`, and forwarded to `onDelta`),
and `result` (used as the authoritative final text if it is longer, and to surface `is_error`).

---

## 6. The latency problem and the six mitigations

Routing through the CLI means no API key and no per-draft cost, at the price of latency:
measured runs ranged **6 to 60 seconds**, queueing on Anthropic's side. Haiku tested *slower*
than Sonnet, so the model is not the lever. Six things make it usable, and each one is load
bearing:

1. Analysis starts on every draft change, ahead of your turn.
2. Runs are serialised, never cancelled mid-flight (§3).
3. Your own hover never restarts it (`signature`).
4. Recommendations stream in one at a time (`progressivePicks`).
5. Your lane opponent locking in preempts the running analysis — the one exception.
6. Stale advice announces itself (`basedOn` fed to `refreshStaleWarning` in the renderer).

**And the safety net:** the statistical counter list (`pushCounters`) is on screen in
milliseconds and stays correct however long Claude takes. When the pick timer is nearly out,
that panel is the answer. Anything that makes it slower or less reliable is a regression, even
if the written analysis improves.

### `progressivePicks`

A hand-rolled brace-matching scanner over the partial stream: it finds `"picks"`, finds the `[`,
then emits each `{...}` object as it closes. It is not a JSON parser and does not need to be —
it stops at the array's closing `]` at depth 0 and silently skips anything that fails
`JSON.parse`. Each partial batch is run through `validate()` before it reaches the screen.

---

## 7. Prompting — [prompt.js](../src/main/prompt.js)

Every string the model sees lives in this one file, and it is pure: no network, no I/O. That is
what makes prompt behaviour testable offline (`damageConstraint`, `priorityBlock` and
`statsBlock` all have direct tests).

### Composable blocks

| Function | Emits |
|---|---|
| `describeAllies` | your team by role, `ME - choosing now` for you, `(hovering)` suffix |
| `inferEnemyRoles` | `{picked, assigned, unplaced, opponent}` — see below |
| `describeEnemies` | enemies by inferred role, plus `role unclear:` and `(N still to pick)` |
| `priorityBlock` | *pick* weighting, branching on draft position (3 cases) |
| `banWeighting` | *ban* weighting: lane threat / teamfight threat / general strength |
| `damageConstraint` | the hard AD-AP rule, or `null` |
| `statsBlock` | the u.gg numbers, worded differently for pick vs ban, or `null` |
| `buildPrompt` | assembles all of the above |
| `buildBuildPrompt` | the post-lock item prompt |

### Draft-position weighting (`priorityBlock`)

| Situation | Weighed first |
|---|---|
| Opponent known, allies still to pick | **The lane** — someone else can still fix the comp |
| You are last pick | **The composition** — it is otherwise fixed |
| Opponent not revealed | **Safety** — the enemy picks after you and can respond |

### The hard damage rule (`damageConstraint`)

Fires only when `ally.picked >= 3` **and** `picksLeft <= 2` **and** the team is at least 75% one
damage type. It then *requires* the missing damage type, permitting the over-represented type
only as a decisive lane answer — and if so, the `risk` field must say it worsens the imbalance.

### Response contract

The model must return **only** a JSON object, no fence, every string under 110 characters.

```jsonc
// pick / ban
{"read":"...","picks":[{"champ":"Name","score":0-100,"lane":"...","fit":"...","risk":"..."}],
 "avoid":[{"champ":"Name","why":"..."}]}
// exactly 3 picks, 1-2 avoid

// build
{"summary":"...","boots":{"item":"Name","why":"..."},
 "core":[{"item":"Name","keep":true,"why":"..."}],
 "situational":[{"item":"Name","insteadOf":"Name|null","why":"..."}]}
// exactly 3 core (in order), 2-3 situational
```

In ban mode the three fields are re-documented in place (`fieldDocs`) to mean *how it beats
what you intend to play* / *which of your champions it punishes* / *why this ban may be wrong*.

### The legality guarantee

Enforced **twice**, and both halves must stay:

1. The prompt lists banned and taken champions under `MUST NOT BE SUGGESTED`.
2. `validate()` in `ai.js` re-checks every returned name against the live `state.unavailable`
   *after* the model answers. Unknown names are flagged `unknown`; blocked ones `blocked`.
   Neither reaches `picks` — they go to `rejected`, which the UI displays, so a caught mistake is
   visible rather than silently swallowed.

Ten tests in `run-tests.js` cover this. It is the app's one hard promise; do not weaken it.

Note that `avoid` entries are validated but **not** filtered — naming a banned champion in
"avoid" is harmless and occasionally informative.

### Enemy role inference (`lanes.js` + `inferEnemyRoles`)

Riot hides enemy assigned positions, so roles are inferred. Riot's own data exposes only
*classes* (it calls Teemo a "marksman/mage", which cannot tell you he is a toplaner), so the
lane data is either u.gg's measured role distribution (`loadPrimaryRoles`, all 173 champions,
ordered best-first) or the bundled curated table as the offline fallback. `lanesLookup()` in
`main.js` picks between them.

`assignRoles` is a greedy assignment sorted by **rank, then breadth, then pick order**:

- *rank* — u.gg lists a champion's real main lane first, so a champion's main lane is settled
  before its off-lanes.
- *breadth* — for sources that only list plausible lanes, a one-lane Teemo beats a three-lane
  Gragas to Top.
- *order* — pick order is the last tiebreak only, so the same five champions always produce the
  same assignment regardless of draft order (tested).

If the greedy pass leaves your lane unassigned, `inferEnemyRoles` makes one more attempt: an
unplaced champion whose *only* plausible lane is yours is your opponent anyway.

### Curated tables — coverage as of patch 16.17.1

| Table | Entries | Missing |
|---|---|---|
| `attributes.js` `TABLE` | 171 of 173 champions | Locke, Zaahen — fall back to `derive()` from Data Dragon tags |
| `lanes.js` `BY_LANE` | 171 real names + 1 dead (`Velkoz`) | Locke, Zaahen — u.gg roles cover them |

`attributes.js` columns: `name | damage (AD/AP/MIXED/TRUE) | frontline 0-2 | cc 0-3 | engage 0-1`.
`derive()` is the fallback for champions newer than the table: Marksman to AD, Mage to AP,
Fighter/Assassin to AD, else AP; Tank gets frontline 2, a melee Fighter 1; Tank/Support get cc 2,
else 1; Tank gets engage 1. It marks its output `derived: true`.

**When a new champion ships, add a row to both tables.** That is the whole maintenance burden.

---

## 8. Testing

```
npm test                      # 65 offline checks, no network, plain Node
node test/ai-live.js          # + one real Claude call (MODEL=... to override)
npm run test:stats            # u.gg feed liveness + the inversion guards   [Electron]
npm run test:draft            # two sample drafts: weighting + real stats   [Electron]
npm run test:draft -- --live  # ...and what Claude actually recommends
npm run test:bans             # a live ban phase while hovering Vayne       [Electron]
npm run test:build            # locked-in champion -> build vs a real team  [Electron]
```

The `[Electron]` ones **must** run under Electron — u.gg is Cloudflare-gated against Node's TLS
fingerprint (§5.3). Running them under plain Node is not a failure, it just silently yields no
stats.

`test/run-tests.js` is a single flat script with a `check(label, fn)` helper; there is no test
framework. It is grouped into: draft state, legality, composition analysis, gap detection,
attributes, recommendation filtering, re-analysis triggers, lane inference, draft-position
weighting, u.gg parsing, a reported-draft regression, build parsing, and confidence ranking.

`test/fixture.js` is the shared mock session (you are Mid, cellId 3, your turn to pick) and is
reused by `COACH_MOCK`.

**What is not covered:** nothing in `main.js` (scheduling, preemption, the view model, the
tick loop), nothing in `lcu.js`, nothing in the renderer, and no end-to-end path. That is the
biggest structural gap — see KNOWN_ISSUES.md #10.

### Running the UI without a game

```
set COACH_MOCK=1      && npm start   # sample draft, pick recommendations
set COACH_MOCK=build  && npm start   # champion locked, build panel
set COACH_DEBUG=1     && npm start   # log ai/counters IPC and data loading to stdout
```

---

## 9. Platform assumptions

Windows-only in practice, in four places:

- `lcu.js` `LOCKFILE_PATHS` are Windows drive paths.
- `lcu.js` `credsFromProcess()` shells out to `powershell.exe` with a `Get-CimInstance` query.
- `ai.js` `resolveClaude()` looks for `.exe` under `%APPDATA%` / `%LOCALAPPDATA%`.
- The README's install story is a desktop shortcut.

Nothing else is Windows-specific. macOS support would need those three functions plus a lockfile
path under `/Applications/League of Legends.app/Contents/LoL/lockfile`.

---

## 10. Invariants — do not break these

1. **`state.unavailable` is the only legality authority**, and `validate()` re-checks against it
   after the model answers. Both the prompt-side list and the post-hoc check must stay.
2. **Every u.gg function returns `null`, never throws.** The app must work with u.gg entirely
   down, degrading to Claude's own knowledge.
3. **Champion data must work offline** from `src/data/*.cache.json` after one successful run.
4. **Your own hover must not appear in `signature()`.** It restarts the analysis if it does.
5. **The matchup row orientation** (§5.3). Guarded by three live tests.
6. **The Emerald+ bucket is pinned, not searched for**, in `laneMatchups`.
7. **`pushCounters` must not wait on Claude.** It is the timer-is-running answer.
8. **The renderer stays dumb.** All resolution (ids to names, images, damage types) happens in
   main's `toViewModel` / `pushCounters` / `shapeBuild`.
9. **`prompt.js` stays pure** — no network, no I/O, no `require` of anything stateful. That is
   what makes prompt behaviour offline-testable.
10. **Sub-50% is never described as a counter.** `rankCounters` excludes it outright and
    `statsBlock` says so explicitly in both pick and ban wording.

---

## 11. Code conventions

- `'use strict';` at the top of every file. CommonJS. No transpilation.
- Two-space indent, semicolons, single quotes, roughly a 100-column soft limit.
- `module.exports = { ... }` at the bottom.
- **Comments explain *why*, and specifically why the obvious thing is wrong.** The best comments
  in this codebase (`draft.js` `signature`, `ugg.js` row orientation, `main.js` `finishAi`) each
  record a bug that actually shipped. Match that: when you fix something subtle, leave the
  counterexample behind, not a restatement of the code.
- Errors degrade, they do not throw. `catch (_) { /* reason */ }` is the house idiom.
- No new runtime dependencies. The zero-dependency property is deliberate.
