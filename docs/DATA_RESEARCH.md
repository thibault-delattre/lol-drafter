# Data research and implementation review — 2026-09-05

Riot's [version feed](https://ddragon.leagueoflegends.com/api/versions.json) returned
16.17.1 during validation. The corresponding statistics key is 16_17. Discover versions
at runtime instead of treating this date's version as a permanent latest patch.

## Source choices

| Source | Use | Limit |
|---|---|---|
| [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) | Champion identities, current item availability, effects, components and stats | Static data; no matchup performance. Regional client versions may differ. |
| [u.gg matchup files](https://stats2.u.gg/lol/1.5/matchups/16_17/ranked_solo_5x5/17/1.5.0.json) | Role-specific observed game outcomes; existing low-latency integration | Undocumented schema, no contractual uptime, not lane gold or causal counter strength. |
| [u.gg overview files](https://stats2.u.gg/lol/1.5/overview/16_17/ranked_solo_5x5/36/1.5.0.json) | Champion/role opening build, boots, subsequent item options | Completion and selection bias; highest item win rate is not proof of the best rush. |
| [LoLalytics Mundo analysis](https://lolalytics.com/lol/drmundo/build/) | Independent methodological cross-check | Uses individual-player rank brackets; its raw percentages should not be pooled with another provider's population. |
| [Riot Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api) | Read local current teams, positions and observed inventories | Only available while the game client serves it; interrupted feeds must be marked stale. |

LoLalytics publishes normalized matchup deltas, distinguishing a champion's general strength
from how it performs in a particular matchup. It also explains that its player-tier sampling
differs from game-average-tier sampling. This is useful context, but no compatible, verified
normalized-delta feed was integrated here. Mixing those rates with u.gg would create false precision.

The implemented statistical improvement is consistent population selection, actual patch provenance,
correct opening-build parsing, and confidence-based counter ranking. The app does not calculate
cross-patch trend slopes or infer lane dominance from a game win rate. Prompts now state those limits.

## Verified mechanics

The current [Riot Vayne definition](https://ddragon.leagueoflegends.com/cdn/16.17.1/data/en_US/champion/Vayne.json)
describes Silver Bolts as max-health bonus true damage on the third consecutive hit. An AD archetype
label must not erase that part of the damage profile.

The [current item definitions](https://ddragon.leagueoflegends.com/cdn/16.17.1/data/en_US/item.json)
describe Randuin's critical-strike mitigation and Bramble's attack-triggered wounds. Oblivion Orb
applies wounds through magic damage. These definitions are cached and supplied to build prompts;
the immediate rule engine distinguishes the application conditions and checks current availability.

## Payload findings

- Matchup rows credit the champion named in the row. Worldwide Emerald+ is region 12 / tier 17.
- Overview section 3 contains an opening path that includes core items and boots. Section 5
  contains later item alternatives. The old parser skipped the opening and called later items a rush.
- The observed Mundo payload had an opening of Warmog's Armor, Heartsteel, and Boots of Swiftness;
  Spirit Visage was the most frequent usable next item. That is a population baseline, not a mandate
  to stack health into Vayne.
- Opening-path records describe the combination, so the parser deliberately leaves individual-item
  win rates unset for those opening items.
- Current integration reads returned 70,582 Teemo top matchup games and 65,607 Mundo top build
  games. These sample sizes are observations from this run, not permanent assertions.

## Validation

Offline tests cover real lock-in vs hover, ban intent changes, role identity, observed inventory
updates, Vayne true damage, crit-triggered Randuin options, wounds application, ownership filtering,
rank consistency, opening build order, and analysis scheduling/preemption. Electron UI checks
exercise the popup and build-to-next-draft reset. Live statistics checks verify current feeds,
reciprocal matchups, confidence ordering, and the Emerald+ build population. A real Claude build
call was also exercised; it is a model-output smoke test, not a factual proof of every sentence.
Validation completed with 83 offline checks (65 original plus 18 new), 19 live statistics
checks, and a passing Electron UI smoke test.

Screenshot follow-up: 86 offline checks now include the Diana/Xayah/Viktor/Karma draft,
Wukong's final pick, instant legal blind recommendations, and Vayne's offensive boots versus
that team. Electron checks also assert client roster order and blind-panel rendering.
The provisional shortlist is curated decision support, not a newly measured win-rate model.

[Electron's window API](https://www.electronjs.org/docs/latest/api/browser-window) provides
always-on-top and non-focusing display options. The popup uses these with click-through behavior.
Exclusive-fullscreen visibility is not guaranteed; use borderless/windowed League. A real running
game was not available for end-to-end confirmation in this session.
