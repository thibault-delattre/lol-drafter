# LoL Draft Coach

<p align="center">
  <img src="assets/icon.png" width="96" alt="LoL Draft Coach icon">
</p>

<p align="center">
  A real-time League of Legends draft and itemization assistant for Windows.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-c8aa6e"></a>
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-4b8bbe">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-33-47848f">
  <img alt="Tests" src="https://img.shields.io/badge/tests-93%20offline%20%2B%2019%20live-3fb950">
</p>

LoL Draft Coach follows champion select in real time, evaluates both compositions, and recommends
legal picks for your role. Once your champion is locked, it switches to item advice for the lane and
the enemy team. During the match, a small click-through overlay reacts to observed inventories.

It combines local draft analysis, current Riot item data, Emerald+ matchup/build statistics, and an
optional written analysis generated through your installed Claude CLI. It never clicks, picks, bans,
or buys anything for you.

## Preview

| Draft coach | In-game item overlay |
|:--:|:--:|
| [![Draft coach showing blind-pick recommendations](docs/screenshots/draft-coach.png)](docs/screenshots/draft-coach.png) | [![Item overlay reacting to a Vayne lane and enemy builds](docs/screenshots/item-overlay.png)](docs/screenshots/item-overlay.png) |

The draft view gives an immediate answer even before the model finishes. In the example above, the
enemy top is still hidden, so the app recommends safe blind picks against the four revealed enemies
without pretending that it has matchup win-rate data for an unknown lane.

## Features

- Reads picks, hovers, bans, pick order, assigned role, and timer from the local League client.
- Preserves the client roster order and distinguishes a hover from a completed lock-in.
- Infers enemy roles across the whole composition and keeps flex picks marked as uncertain.
- Lets you manually correct your role or lane opponent when the draft is ambiguous.
- Shows instant blind-pick options when the opposing laner has not been revealed.
- Ranks measured counters using game win rate, sample size, and a Wilson confidence bound.
- Keeps every recommendation legal by filtering bans, locked champions, and allied hovers twice.
- Uses current Riot item definitions and filters removed or unavailable items.
- Considers build win rate only among alternatives from the same purchase slot.
- Shows the opening combination's win rate separately from champion and individual-item rates.
- Reacts to enemy crit, healing, damage mix, true damage, and your current inventory.
- Enforces one boots recommendation and removes completed items or covered components.
- Continues with deterministic item rules when u.gg or the model is unavailable.

## Quick start

### Requirements

- Windows 10 or 11
- Node.js 20 or newer
- The League of Legends client
- The [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/overview), installed and signed in,
  for written recommendations

The instant counter list, composition analysis, and rule-based item overlay do not require Claude.

### Install and run

```powershell
git clone https://github.com/thibault-delattre/lol-drafter.git
cd lol-drafter
npm install
npm.cmd start
```

Open the coach before champion select, or launch it during a game. It detects the client automatically.
Use League in **Borderless** or **Windowed** mode so the overlay can remain visible.

### Overlay controls

- `Ctrl+Shift+O` — hide or show the item overlay.
- `Ctrl+Shift+M` — move it to the top-left corner of the monitor under your cursor.

The overlay never takes keyboard focus and allows mouse clicks to pass through to League.

## How recommendations are selected

### Draft

When the enemy laner is known, the lane is the first priority. The app retrieves the observed
Emerald+ result for each available champion into that opponent, removes samples below 300 games,
then ranks the survivors by the lower bound of a 95% Wilson interval. Composition fit breaks ties
between viable lane choices.

When the laner is unknown, the app avoids inventing a matchup. It shows a provisional blind-pick
shortlist based on a curated role pool, the revealed enemy champions, damage balance, frontline,
crowd control, and engage. Flex champions remain explicitly uncertain until the draft resolves.

These percentages describe whole-game outcomes, not lane win rates or gold at 15 minutes. They are
useful evidence, but do not prove that one champion wins the lane in every context.

### Builds

The statistical baseline comes from worldwide Emerald+ ranked solo/duo games. The current patch is
requested first; a previous-patch fallback is visibly labeled. Build alternatives are compared only
within the same purchase stage, using both win rate and sample size. If every option is thin, the app
uses a clearly marked popularity fallback.

The baseline is then adapted to the actual game:

- Offensive power spikes remain the default when survival does not require a deviation. For example,
  Vayne keeps Berserker's Greaves against a mixed or magic-heavy team unless physical attacks are the
  concrete reason she cannot deal damage.
- Randuin's Omen appears for suitable tanks after meaningful crit purchases are observed.
- Anti-heal accounts for how it is applied. Bramble Vest requires the enemy to attack its owner, so
  it is not treated as a reliable answer to Vladimir's spell healing.
- Vayne's Silver Bolts are treated as max-health true damage; armor is never described as reducing it.
- Only one completed pair of boots is recommended, including after model output is validated.

Item win rates are observational and contain purchase-timing and survivor bias. A high late-item win
rate is never compared directly with a first-item rate.

## Data and privacy

| Source | Purpose |
|---|---|
| Riot League Client API | Local champion-select state |
| Riot Live Client Data API | Local in-game teams, roles, and visible inventories |
| Riot Data Dragon | Champion identities, icons, and current item definitions |
| u.gg statistical files | Role-specific matchup and build aggregates |
| Claude CLI | Optional natural-language draft and build reasoning |

League credentials, lockfile tokens, and player data stay on the local machine. The application does
not include a Riot API key or an Anthropic API key. u.gg's endpoints and the champion-select API are
undocumented, so they can change without notice. See [the data review](docs/DATA_RESEARCH.md) for the
source assumptions and verified payload structure.

## Development

```powershell
npm.cmd test             # deterministic offline and orchestration checks
npm.cmd run test:stats   # current u.gg feed and orientation checks
npm.cmd run test:ui      # hidden Electron render and lifecycle checks
npm.cmd run test:build   # real Claude response smoke test
```

Preview without a running League client:

```powershell
$env:COACH_MOCK = '1'       # draft view
npm.cmd start

$env:COACH_MOCK = 'build'   # locked champion and build view
npm.cmd start
```

The runtime has one npm dependency: Electron. Application code uses CommonJS and has no build step.

### Project structure

| Path | Responsibility |
|---|---|
| `src/main/draft.js` | Normalizes champion select and enforces availability |
| `src/main/lanes.js` | Enemy role assignment and flex-pick handling |
| `src/main/ugg.js` | Matchup/build retrieval, caching, and statistical ranking |
| `src/main/analyze.js` | Local composition analysis |
| `src/main/items.js` | Immediate inventory-aware item options |
| `src/main/live.js` | Riot Live Client Data normalization |
| `src/main/prompt.js` | Pure draft and build prompt construction |
| `src/main/main.js` | Polling, scheduling, IPC, and window lifecycle |
| `src/renderer/` | Main UI and click-through overlay |

More detail is available in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limitations

- Enemy roles are inferred during ranked champion select. Flex picks can remain ambiguous until the
  final enemy champion appears; use the opponent selector if a lane swap is known.
- Exclusive fullscreen can cover desktop overlays. Borderless mode is recommended.
- Statistical feeds may lag immediately after a patch and can become unavailable.
- Written model recommendations can still be wrong; deterministic legality and item checks provide
  guardrails rather than a guarantee of an optimal pick or build.
- New champions initially use derived attributes until their curated entries are added.

## License

Released under the [MIT License](LICENSE).

LoL Draft Coach is not endorsed by Riot Games and does not reflect the views or opinions of Riot
Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and
all associated properties are trademarks or registered trademarks of Riot Games, Inc.
