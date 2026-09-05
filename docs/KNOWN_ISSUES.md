# Known issues and backlog

Update 2026-09-05: the entries below are the historical audit. Issues 1–5, 7, 9, and
the role-override part of 11 are now fixed. Scheduler, live inventory and renderer
coverage was added for 10. The opening-build parser also had an additional defect:
it skipped section 3's opening core and read section 5's later items as a rush; fixed
with a regression test. See [current README](../README.md) and [data review](DATA_RESEARCH.md).
Remaining limitations include exclusive-fullscreen visibility, incomplete curated
champion traits, undocumented data endpoints, model factual errors, and no measured
lane-gold or cross-patch trend model. Other entries below may describe superseded behavior.

Every entry below was found by reading the code on 2026-09-05 against patch 16.17.1, with
`npm test` green (65/65). Each one states how it was verified, so you can re-check rather than
trust this file. Nothing here has been fixed — this is a to-do list, not a changelog.

Ordered by impact. #1–#5 are defects with user-visible consequences; #6–#8 are cleanups;
#9–#14 are project-level gaps and ideas.

---

## 1. All four lockfile paths are broken by unescaped backslashes — HIGH

[src/main/lcu.js:6-11](../src/main/lcu.js#L6-L11)

```js
const LOCKFILE_PATHS = [
  'C:\Riot Games\League of Legends\lockfile',
  ...
];
```

In a JavaScript single-quoted string, `\R` and `\L` are not escape sequences, so they collapse
to `R` and `L`. Every path in the list evaluates to garbage:

```
$ node -e "console.log('C:\Riot Games\League of Legends\lockfile')"
C:Riot GamesLeague of Legendslockfile
```

**Consequence.** `credsFromLockfile()` can never succeed. Every single connection silently falls
through to `credsFromProcess()`, which spawns PowerShell with an 8-second timeout and a
`Get-CimInstance Win32_Process` query. The app still works — which is exactly why this went
unnoticed — but connection is slower than designed, needs PowerShell available, and the
documented fast path is dead code.

**Fix.** Escape them (`'C:\\Riot Games\\...'`) or use forward slashes, which Node accepts on
Windows. Then verify the fast path is actually taken (add a `COACH_DEBUG` line saying which
credential source won).

**Also worth doing while there:** the four hardcoded drives are fragile. Reading the install
directory from the registry (`HKLM:\SOFTWARE\WOW6432Node\Riot Games, Inc\League of Legends`) or
from `%ALLUSERSPROFILE%\Riot Games\Metadata\league_of_legends.live\league_of_legends.live.product_settings.yaml`
would cover non-standard installs without the PowerShell scan.

---

## 2. Builds and matchups read different rank buckets — HIGH

[src/main/ugg.js:369-388](../src/main/ugg.js#L369-L388)

`laneMatchups` pins region 12 / tier 17 (World / Emerald+) via `pickBucket`, and there are tests
proving it. `championBuild` still does the old thing:

```js
// Same trick as the matchups: take the broadest bucket rather than trusting
// u.gg's region/tier numbering.
```

That comment is stale — it describes what `laneMatchups` used to do before the fix. `championBuild`
iterates every region and tier and takes whichever has the most games, which will typically be a
much wider rank slice than Emerald+.

**Consequence.** The "u.gg baseline" shown under the build advice does not correspond to the
same population as the matchup numbers shown elsewhere in the app, and does not match what
u.gg's site shows by default. Nobody has verified which bucket it lands on.

**Fix.** Reuse `pickBucket`, generalised to take a section-shape callback (matchup buckets and
overview buckets have different inner shapes but the same `[region][tier][role]` outer shape).
Add an anchor test the way `test/ugg-live.js` does for Gwen/K'Sante: pick a champion whose
Emerald+ build u.gg publishes and assert it reproduces.

---

## 3. The refresh button can run two analyses at once — MEDIUM

[src/main/main.js:482-490](../src/main/main.js#L482-L490)

```js
ipcMain.handle('refresh', () => {
  if (lastState && lastAnalysis) {
    lastAiAt = Date.now();
    runAi(lastState, lastAnalysis);   // <- calls runAi directly
```

Every other caller goes through `startAi()`, which owns the `aiBusy` flag and the `pendingRun`
queue. `refresh` bypasses both.

**Consequence.** Pressing refresh mid-analysis: `runAi` bumps `aiRunId` and `analyzer.run()`
kills the in-flight process, so the old run's `.catch` fires, sees `runId !== aiRunId`, returns
early — but still hits `.finally(finishAi)`. That sets `aiBusy = false` and immediately starts
`pendingRun` if one is queued, while the refresh run is still going. Two concurrent `claude`
processes, and `aiBusy` no longer reflects reality.

**Fix.** Route refresh through `startAi()`. If the intent is "refresh should preempt", make that
explicit: call `preemptAi()` then `startAi()`.

---

## 4. Your own hover counts toward your team's composition — MEDIUM

[src/main/analyze.js:64-71](../src/main/analyze.js#L64-L71)

`teamChampions()` uses `p.championId || p.hoveredId` for *all* players, including the local one.

Verified:

```
$ node -e "... buildSession with myTeam[3].championPickIntent = Viktor ..."
ally champions counted: [ 'Malphite', 'Jinx', 'Viktor', 'Leona' ]
picked= 4 adPct= 25
```

**Consequence.** Two of them.

- `damageConstraint(analysis.ally, picksLeft)` sees your own hover as an already-committed pick.
  Hover an AP champion on an all-AD team and the "your team is 100% AD" hard constraint
  evaporates — precisely when it matters most. The model is then told the comp is already
  balanced by a pick that has not happened.
- It contradicts `signature()`, which deliberately excludes your hover (invariant #4). The comp
  meter in the UI therefore updates on hover while the analysis does not, so the numbers on
  screen can disagree with the numbers the model was given.

**Fix.** `teamChampions` should skip `hoveredId` when `p.isLocal`. Add a test: hovering an AP
champion on an all-AD team must not clear the constraint. Decide deliberately whether the *UI*
meter should still preview your hover — if so, compute two analyses and only send the
hover-inclusive one to the renderer.

---

## 5. After one game where you locked in, the pick panel never comes back — MEDIUM

[src/renderer/app.js:448](../src/renderer/app.js#L448)

```js
if (msg.status === 'done' && msg.mode === 'build') {
  ...
  $('recsSection') && ($('recsSection').hidden = true);
```

Nothing ever sets it back to `false`. The `waiting` handler resets `hasResult`, `adviceBasedOn`,
the counters and the build panel, but not `recsSection.hidden`.

**Consequence.** Play a game to the point of locking a champion, let the app return to standby,
then start a second draft: the "Recommended picks" section stays hidden for the rest of the
process's life. The app looks like the analysis is broken. Restarting fixes it.

There is a narrower version of the same bug within one draft: if you are locked in but
`ugg.championBuild` returns `null` (u.gg down), `runAi` falls through to the *pick* prompt and
sends a plain `done`, which renders into a hidden section.

**Fix.** Unhide `recsSection` in the plain `done`/`streaming`/`running` branches and in
`waiting`. A `setMode('picks' | 'build')` helper that owns the visibility of both sections would
be cleaner than scattering `hidden` assignments.

---

## 6. Dead code — LOW

All verified by grep; none of these change behaviour.

| Where | What |
|---|---|
| [main.js:28,314,484](../src/main/main.js#L28) | `lastAiAt` is assigned three times and never read. |
| [app.js:11,383,420](../src/renderer/app.js#L11) | `buildMode` is assigned twice and never read. |
| [analyze.js:41,59](../src/main/analyze.js#L41) | `const remaining = 5 - t.picked;` is used only by `if (remaining > 0) gaps.forEach((g, i) => { gaps[i] = g; });`, which assigns each element to itself. Either the intended behaviour (soften warnings while picks remain?) was lost, or both lines should go. |
| [lanes.js:32](../src/main/lanes.js#L32) | `Velkoz` in the Support list is not a Data Dragon name (`Vel'Koz` is, and is also present), so it never matches. |
| [lanes.js:13-18](../src/main/lanes.js#L13) | `Diana` and `Kayn` appear twice in the Jungle list. Harmless (deduplicated on build) but confusing. |
| [lcu.js:124](../src/main/lcu.js#L124) | `getCurrentSummoner()` is exported and never called. |
| [preload.js:11](../src/main/preload.js#L11) | `setModel` is bridged and never called by the renderer — there is no model picker in the UI, and README tells users to edit `main.js` instead. Either add the control or drop the bridge. |

---

## 7. `set-model` leaks the running process — LOW

[src/main/main.js:491-493](../src/main/main.js#L491-L493)

```js
ipcMain.handle('set-model', (_e, model) => {
  analyzer = new Analyzer({ model });
```

The old `Analyzer` is dropped without `cancel()`, so a `claude` process in flight is orphaned
and its stream handlers keep appending to a `full` string nobody reads. Unreachable today
(nothing calls `setModel`), which is why it is LOW — but it becomes real the moment a model
picker is added. Call `analyzer.cancel()` first.

---

## 8. Inconsistent `lastOpponent` type between the mock and live paths — LOW

[main.js:355](../src/main/main.js#L355) sets `lastOpponent = roles.opponent` (a champion *name*).
[main.js:398](../src/main/main.js#L398) sets `lastOpponent = focusKey` (a string like `pick:17`).

The two branches are mutually exclusive within a process, so nothing misbehaves today. But the
mock path never computes `focusKey`, so `COACH_MOCK` cannot exercise the preemption logic at
all — which is a testing gap as much as a tidiness one. Make the mock path build a `focusKey`
the same way.

---

## 9. Not under version control — HIGH (process, not code)

There is no `.git` directory and no `.gitignore`. `node_modules/` (63 packages), the two
`*.cache.json` files, `src/data/ugg/*.json` and a 477 KB `image.png` at the repo root are all
sitting loose in the working directory.

**Do this first, before any other change**, so the work below is reviewable:

```
git init
printf 'node_modules/\nsrc/data/ugg/\n*.log\n' > .gitignore
git add -A && git commit -m "Initial commit"
```

Keep `champions.cache.json` and `gamedata.cache.json` checked in — they are the documented
offline fallback. Do **not** keep `src/data/ugg/` — it is a 12-hour TTL cache and it churns.

`image.png` at the root appears to be a leftover screenshot; the README does not reference it.
Confirm with the owner before deleting.

---

## 10. No coverage of the orchestration layer — HIGH (process)

`main.js` is 501 lines and holds every piece of logic that has actually caused user-visible
bugs — the scheduler, preemption, the pick/ban stats switch, the build/pick mode switch — and
none of it is tested. `lcu.js` and the renderer are likewise untested.

The obstacle is that `main.js` mixes pure logic with Electron globals. The pure parts extract
cleanly with no behaviour change:

- `statsFocus(state, roles)` — pure. Test it directly: ban mode picks your hover, pick mode
  picks the opponent, both return `null` when there is nothing to focus on.
- `toViewModel(state, analysis)` — pure given `champions` and `patch`; pass them in.
- `shapeBuild(parsed, baseline)` — pure given `gameData`; pass it in. It already has non-obvious
  behaviour worth pinning (the `Seeker's Armguard (rush)` bare-name fallback).
- The scheduler (`startAi`/`finishAi`/`pendingRun`/`aiBusy`/`aiRunId`) is a small state machine.
  Extracted behind an injected `run(state)` function it becomes fully testable with a fake, and
  would catch #3 immediately.

`parseLockfile` in `lcu.js` is already exported and pure — it has no test either.

---

## 11. Stats are unavailable whenever your role is unknown — MEDIUM (limitation)

`gatherStats` returns `null` unless `state.myPosition` is set, and `myPosition` comes from
Riot's `assignedPosition`, which is empty in blind pick, normals, ARAM and some flex queues.

**Consequence.** In those queues the app loses the entire statistical layer — the counter panel
never appears and the prompt has no numbers — while still confidently producing written advice.
Nothing tells the user this happened.

**Fix (smallest useful).** When `myPosition` is missing, say so in the UI where the counter panel
would be, rather than rendering nothing. **Fix (better).** Let the user pick their role manually;
one dropdown in the header would restore the whole statistics path for every queue.

---

## 12. Backlog: things worth building next

Roughly in value order. None of these is started.

- **Role override control.** Fixes #11 and also lets the user correct a bad `assignedPosition`.
  Small, high leverage.
- **Correct a mis-inferred enemy role.** The README already admits flex picks get seated wrong.
  Clicking an enemy row to reassign their lane would feed straight into `inferEnemyRoles` and
  fix the matchup subject, which is the single biggest input to the answer.
- **Show *why* a champion is recommended, numerically.** `stats.counters` is already computed
  with `confidence`; only the raw win rate is surfaced. Showing the Wilson lower bound (or a
  simple "high/low confidence" mark) would let the user judge a 250-game entry themselves.
- **Cache the analysis by draft signature.** Re-entering the same draft state (common when the
  enemy hovers and un-hovers) re-runs a 6–60 s analysis for an answer already computed.
- **Rune recommendations.** `championBuild` already parses `runes` and `shards`, `champdata.js`
  already resolves `runeNames`, and `buildBuildPrompt` already prints them into the prompt — but
  nothing is ever asked about them or rendered. This is the cheapest new feature in the codebase.
- **Packaging.** There is no `electron-builder` config despite the README telling users to
  double-click a desktop shortcut. Whoever set that shortcut up did it by hand.
- **macOS support** — see ARCHITECTURE §9. Three functions.

---

## 13. Fragilities to keep an eye on (not bugs)

- **u.gg is undocumented.** The URLs, the `[region][tier][role]` layout, the `BUILD` section
  indices and the region/tier codes are all reverse-engineered. `npm run test:stats` is the
  canary — run it first whenever recommendations stop citing win rates.
- **`1.5.0.json` / `lol/1.5/` in the URLs is a version u.gg controls.** If they bump it,
  everything statistical goes dark at once and silently.
- **The `claude` CLI's `stream-json` output shape** is a contract `ai.js` depends on
  (`stream_event` + `content_block_delta` + `result`). A CLI upgrade could change it.
- **Two champions (Locke, Zaahen) are newer than both curated tables** and use derived values.
  Every new champion adds one more until the tables are updated.
- **`rejectUnauthorized: false`** in `lcu.js` is correct for the client's self-signed cert on
  `127.0.0.1`, but if that host is ever made configurable it becomes a real vulnerability.

---

## 14. How to verify a fix

```
npm test                 # must stay at 65/65 (or higher — add tests with fixes)
npm run test:stats       # after ANY change to ugg.js; guards the matchup inversion
set COACH_MOCK=1 && npm start        # UI smoke test, pick path
set COACH_MOCK=build && npm start    # UI smoke test, build path
```

For #5 specifically, the mock cannot reproduce it (there is no waiting-to-draft transition in
mock mode) — it needs either a real game or a small harness that pushes a `waiting` state
followed by a fresh `draft` state at the renderer.
