# CLAUDE.md — working rules for this project

Read this first, then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The
[README](README.md) is the user-facing story and explains *why* most decisions were made —
it is unusually good and worth reading before proposing changes.

## What this is

An Electron app that reads the live League of Legends champion select, joins it to measured
win-rate data from u.gg, and asks Claude (via the `claude` CLI) what to pick, ban or build.
Zero runtime dependencies, no build step, no API key, Windows-only in practice.

## Commands

```
npm start                     # run the app (needs the League client for real data)
npm test                      # 65 offline checks, plain Node, no network — must stay green
npm run test:stats            # u.gg liveness + the matchup-inversion guards  [Electron only]
npm run test:draft            # two sample drafts, real stats                 [Electron only]
npm run test:bans             # live ban phase                                [Electron only]
npm run test:build            # locked-in champion, build advice              [Electron only]
node test/ai-live.js          # one real Claude call against the fixture

set COACH_MOCK=1     && npm start   # full UI, no game needed (pick path)
set COACH_MOCK=build && npm start   # full UI, no game needed (build path)
set COACH_DEBUG=1    && npm start   # log IPC and data loading to stdout
```

The `[Electron only]` tests must run under Electron: u.gg is behind Cloudflare, which rejects
Node's TLS fingerprint. Under plain Node they do not fail — they silently return no stats.

## Before you change anything

1. **Read [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).** There are five verified defects
   waiting. If the user reports something odd, check there before diagnosing from scratch.
2. **This is not a git repository yet.** KNOWN_ISSUES #9. Getting it under version control
   should happen before any substantial work, so changes are reviewable and revertible.
3. **`npm test` must stay at 65/65.** Add tests alongside fixes; every test in that file exists
   because something broke in a real draft.

## The ten invariants

Full statements with rationale in ARCHITECTURE §10. In short:

1. `state.unavailable` is the only legality authority, and `validate()` re-checks the model's
   answer against it. Both halves stay.
2. Every `ugg.js` function returns `null` on failure and never throws.
3. Champion data works offline from `src/data/*.cache.json`.
4. Your own hover must never enter `signature()` — it would restart the analysis on every scroll.
5. u.gg matchup rows credit the champion **named in the row**, not the file's champion. This was
   inverted once and reported every matchup backwards.
6. The Emerald+ bucket (region 12 / tier 17) is pinned, not searched for.
7. `pushCounters` never waits on Claude — it is the answer when the pick timer is nearly out.
8. The renderer stays dumb; all resolution happens in main's view models.
9. `prompt.js` stays pure — no network, no I/O.
10. A sub-50% champion is never described as a counter.

## House style

- CommonJS, `'use strict';`, two-space indent, semicolons, single quotes, ~100 columns.
- **No new runtime dependencies.** The single-dependency property is deliberate.
- Errors degrade rather than throw; `catch (_) { /* why */ }` is the idiom.
- Comments say *why the obvious thing is wrong*. When you fix something subtle, leave the
  counterexample in a comment — that is the convention the existing comments follow, and it is
  why the u.gg orientation bug can never quietly come back.
- Keep changes surgical. Do not reformat, rename or "improve" code you were not asked to touch.

## Where things live

| I want to change... | Go to |
|---|---|
| What the model is told | `src/main/prompt.js` — every prompt string, and it is pure |
| How stats are fetched or ranked | `src/main/ugg.js` |
| When the analysis re-runs | `signature()` in `src/main/draft.js`, scheduler in `main.js` |
| Enemy role guessing | `src/main/lanes.js` + `inferEnemyRoles` in `prompt.js` |
| Composition meters | `src/main/analyze.js` + the table in `src/main/attributes.js` |
| Anything on screen | `src/renderer/app.js` (and only there) |

## Adding a new champion

Two curated tables need a row each, or the champion falls back to derived values:
`src/main/attributes.js` (`name damage frontline cc engage`) and `src/main/lanes.js`
(`BY_LANE`). As of patch 16.17.1, Locke and Zaahen are missing from both.
