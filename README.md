# LoL Draft Coach

A desktop app that reads your live League of Legends champion select and tells you what to pick,
using Claude for the reasoning.

Double-click **LoL Draft Coach** on your desktop. Leave it open — it detects champion select on its
own and goes back to standby when the game starts.

## What it does

While you draft it shows, updating live:

- **Both teams** — your allies with their assigned roles, the enemy as they lock in. Champions that
  are only *hovered* show in gold, so you see intent before it is locked.
- **All 10 bans**, crossed out.
- **Composition meters** for both teams — AD/AP damage split, frontline, crowd control, and engage,
  with warnings like *"Damage is 100% AD - enemy just builds armor"* or *"No frontline at all"*.
- **Three recommended picks**, each with the lane matchup, what it adds to your comp, and its main
  risk — plus champions to avoid.
- **Best into your lane** — the champions with the highest measured win rate against your actual lane
  opponent, from u.gg. This appears within a second of them locking in, because it is pure data and
  does not wait for Claude. When the pick timer is nearly out, this is the panel to read.
- **The measured win rate** of each written recommendation into that same opponent, with the sample
  size behind it.

Once you lock your champion in, the pick question is settled and the panel switches to **how to build
against this specific enemy team** — see *Building for the game* below.

When it is your turn a gold banner appears and the analysis is re-run immediately. During the ban
phase it recommends bans instead of picks — see below, because banning asks a different question.

## How it decides

**Step 1 — who are you actually laning against?** Riot hides enemy assigned roles in ranked, so the
app infers them. Riot's own data only exposes *classes* (it calls Teemo a "marksman/mage", which
cannot tell you he is a toplaner), so roles come from u.gg's measured role distribution for all 173
champions, with a bundled lane table as the offline fallback. Champions with only one plausible lane
are seated by confidence, not by pick order: the strongest champion/lane pairings are settled first,
so Kled takes Top ahead of a flex pick like Neeko, and a one-lane Teemo beats a three-lane Gragas to
it.

**Step 2 — what actually beats them?** Once the opponent is known, the app pulls the real win rate of
every champion into them, in your role, from u.gg, at **Emerald+ worldwide** — the same slice u.gg
shows by default, so the numbers agree with what you see on the site. A champion's top-lane file at
that rank holds roughly 30,000–110,000 games.

Three things keep the list honest:

- **The rank bucket is pinned, not guessed.** u.gg's payload is indexed by undocumented region and
  tier codes. Region 12 / tier 17 was identified by reproducing a published figure exactly — Gwen
  54.68% into K'Sante, top lane, Emerald+. An earlier version picked whichever bucket had the most
  games, which silently reported a *different rank's* numbers.
- **A champion below 50% is never listed as a counter.** It goes in the "loses to" list instead.
- **Thin samples cannot lead.** Emerald+ is narrow — the median matchup has well under a hundred
  games — so anything under 300 games is dropped, and what survives is ordered by the **lower bound
  of a Wilson confidence interval** rather than the raw percentage. 58% over 250 games ranks below
  54% over 10,000. The raw rate and the sample size are both displayed, so you can judge for yourself.

**One caveat on what the number means:** it is the win rate of the whole game when those two
champions meet in that lane, not a score for the laning phase alone. A scaling champion can lose lane
and still show above 50%.

### The bug that made this worth writing down

Each row in u.gg's matchup file carries the wins of the champion *named in that row* — not of the
champion whose file it is. Reading it the other way inverts every single matchup, and that is exactly
what this app did at first. It confidently reported that Vayne beat Teemo 62.7% (Teemo in fact wins
that lane 62%) and that Malphite was one of the worst picks into Vayne (he is the *best*, at 62.4%).

Both anchors are now regression-tested against live data in `npm run test:stats`: the published
Gwen/K'Sante figure must reproduce, Teemo must beat Vayne, and Malphite must beat Vayne. If the
orientation ever flips again, those fail immediately. That list is
filtered to champions you can still pick, shown to you immediately in the *Best into your lane* panel,
and handed to Claude — both the winning side and the losing side — with this instruction:
*statistics outrank intuition; if you recommend a champion that is not winning the matchup, say the
data is against it and give a concrete reason it is still right.*

Grounding the model in measured numbers matters, but the numbers have to be right first — see the bug
above. With the corrected feed, the best picks into Teemo top are Olaf (55.8%), Malphite (54.0%) and
Sion (53.1%), and the champions that lose hardest to him are Vayne (38.0%) and Volibear (41.4%).

**Bans invert the question.** For a pick, the subject of the statistics is your *enemy laner* and the
list you want is "who beats them". For a ban, the subject is the champion *you* intend to play, and
the same list becomes "who beats you" — that is the ban shortlist. Bans previously got no data at all,
which is how the app once suggested banning Renekton while hovering Vayne: Renekton actually *loses*
to Vayne at 46.0%, so it was spending a ban on a lane you already win. The champions that genuinely
beat Vayne top are Malphite (62.4%), Teemo (62.0%) and Nasus (59.5%).

A ban is not only a lane decision, so it weighs three separate things and has to say which one drove
the choice:

1. **Lane threat** — who measurably beats what you intend to play.
2. **Teamfight threat** — a champion can deserve the ban *even when it loses your lane*, if its kit
   dismantles your composition in a fight: AoE burst or long-range engage into squishy immobile
   carries, for instance. It must name which of your champions it punishes.
3. **General strength** — do not spend a ban on a champion nobody picks.

Sub-50% numbers are explicitly flagged so it cannot describe a losing champion as winning the lane.

**Step 3 — how much should the lane matter?** The weighting shifts with your draft position:

| Situation | What gets weighed first |
|---|---|
| Lane opponent known, allies still to pick after you | **The lane.** Someone else can still fix the composition, so beat your opponent. |
| You are your team's **last pick** | **The composition.** It is otherwise fixed, so this is the last chance to cover what is missing. |
| Lane opponent not revealed yet | **Safety.** The enemy picks after you and can respond, so prefer champions that are hard to hard-counter. |

**Damage balance becomes a hard rule, not a preference**, once your team is 75%+ one damage type with
two or fewer picks left. It is then told to recommend the missing damage type, and may only suggest
another champion of the over-represented type if it is a *decisive* answer to your lane opponent — in
which case it must say in the "risk" field that it worsens the imbalance. On last pick behind an
all-AD team (Kha'Zix / Zed / Twitch / Pyke) into that same Teemo, the answer became Gwen — AP, and
still 54.2% into the matchup.

## Building for the game

Lock your champion in and the app stops talking about picks and starts on items. It pulls the
statistical build for your champion and role from u.gg — summoners, starting items, boots, the usual
first three items with their win rates, and the skill order — and then asks Claude to bend that
baseline toward the team you are actually facing: armour versus magic resist for their damage split,
boots for what actually kills you, grievous wounds against healing, percent-health damage against
stacked health, Zhonya's or Quicksilver against their specific burst or lockdown.

The baseline is shown underneath, unchanged, so you can always see what was altered and why. Two real
examples, same app, opposite calls — both overriding the statistical boots:

- **Vayne top into Rakan / Miss Fortune / Vex / Sylas / Ambessa** (60% AP, heavy CC): u.gg says
  Berserker's Greaves; the app says **Mercury's Treads** — *"tenacity cuts Rakan charm / Sylas stun /
  Ambessa CC chain; MR vs 60% AP burst"*.
- **Orianna mid into Darius / Zed** (100% AD): the app says **Plated Steelcaps** — *"cuts AA damage
  from Zed's reset combos and Darius's autos, better than MR boots vs 0% AP enemy"*.

It updates as the enemy team fills in, so the advice reflects the final composition rather than the
half-finished one.

## Champions it will never suggest

A recommendation is dropped unless the champion is actually takeable. Excluded are:

- all 10 bans (both teams),
- every champion already locked by either team,
- champions an **ally** is hovering (you cannot take those),

but *not* the champion you are hovering yourself. This is enforced twice: the ban list is given to
Claude in the prompt, and every returned name is re-checked against the live client state before it
reaches the screen. Anything that slips through is filtered and listed under the recommendations, so
you can see it was caught rather than silently dropped.

## How it works

| Piece | What it does |
|---|---|
| `src/main/lcu.js` | Talks to the League client's local API. Reads the port and password from `lockfile`, with a fallback that reads them off the running process if League is installed somewhere unusual. |
| `src/main/champdata.js` | Pulls the champion list from Data Dragon and caches it to disk, so the app still works offline after the first run. |
| `src/main/attributes.js` | Curated table of damage type, frontline, CC and engage for 171 champions. Champions released after the table was written fall back to values derived from Riot's own tags. |
| `src/main/draft.js` | Turns the client's champ-select session into clean state: teams, roles, bans, hovers, whose turn it is. |
| `src/main/lanes.js` | Curated lane table (which champions are played where) and the inference that guesses enemy roles. |
| `src/main/ugg.js` | Fetches matchup win rates, champion roles and statistical builds from u.gg, distils and caches them. Degrades to null on any failure. |
| `src/main/analyze.js` | Computes the composition meters and gap warnings. Instant, no network. |
| `src/main/ai.js` | Runs the `claude` CLI, streams the reply, and validates every suggested champion against the live ban/pick list. |
| `src/renderer/` | The UI. |

The composition analysis is local and appears instantly. Only the written recommendations wait on
Claude.

For the developer-level view — module contracts, the u.gg payload formats, the invariants and the
current defect list — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) and [CLAUDE.md](CLAUDE.md).

## About the response time

This routes through the `claude` CLI on your existing subscription, so there is no API key and no
per-draft cost. The trade-off is latency: measured runs ranged from **6 to 60 seconds**, and it is
queueing on Anthropic's side rather than anything the app controls (Haiku tested *slower* than
Sonnet, so the model choice is not the lever).

Six things are done to keep that usable:

- **It analyses ahead of your turn.** Every time someone picks or bans, an analysis starts, so
  results are normally already on screen before your turn arrives.
- **Runs are never cancelled mid-flight.** An analysis takes longer than the gap between draft
  actions, so restarting on every pick meant none ever finished. A newer draft state now queues and
  runs next instead of killing the one in progress.
- **Your own hover never restarts it.** Scrolling the champion grid changes nothing about what is
  good for you, so it no longer resets the analysis to zero.
- **Recommendations stream in one at a time** as they are generated, and the previous answer stays
  on screen (dimmed) while a newer one is being written, rather than blanking out.
- **Your lane opponent locking in preempts the running analysis.** It is the one input that dominates
  the answer, so an analysis that predates it is abandoned rather than waited for — the single
  exception to the rule above.
- **Advice that predates an enemy pick says so.** A banner names the champions picked since it was
  written, so a stale answer can never be mistaken for a current one.

The statistical counter list is the safety net for all of this: it is on screen in milliseconds and
stays correct no matter how long the written analysis takes.

The refresh button (top right) forces a re-run at any time.

If you want more consistent speed, the alternative is an Anthropic API key; see *Switching models*.

## Switching models

Default is Sonnet. To change it, edit the model name in `src/main/main.js`:

```js
let analyzer = new Analyzer({ model: 'sonnet' });
```

## Testing without a game

```
npm test
```

runs the offline suite — draft parsing, ban/pick legality, composition maths, lane inference,
re-analysis triggers, draft-position weighting, stats parsing, build parsing and counter-ranking statistics (65 checks).
No network needed.

```
node test/ai-live.js
```

additionally makes a real Claude call against a sample draft and prints what it recommends.

```
npm run test:draft            # weighting + real stats for two sample drafts
npm run test:draft -- --live  # and what Claude actually recommends for each
npm run test:stats            # checks the u.gg feed itself is alive and sane
npm run test:bans             # a live ban phase: what it denies while hovering Vayne
npm run test:build            # champion locked: the build it recommends vs a real enemy team
```

These run under Electron because u.gg is Cloudflare-gated (see below). `test:draft` compares a known
lane opponent mid-draft against a last pick into an all-AD team; `test:stats` is what to run first if
recommendations stop citing win rates.

To see the full UI without being in a game:

```
set COACH_MOCK=1
npm start

set COACH_MOCK=build
npm start
```

The second form locks a champion in, which is how you exercise the build panel without a game.

## Troubleshooting

**"League client not running"** — the app looks for `lockfile` in the standard install folders and,
failing that, reads the credentials from the running `LeagueClientUx.exe`. Start the client and it
connects within a couple of seconds.

**Recommendations never arrive** — check the CLI works on its own:

```
claude -p "say ok"
```

If that fails, the app cannot reach Claude either.

**Champion portraits missing** — Data Dragon images load from Riot's CDN and need internet. The rest
of the app works offline from the cache.

**Nothing happens on double-click** — set `COACH_DEBUG=1` and run `npm start` from a terminal to see
the error.

## A note on Riot's rules

This only *reads* the client's local API, the same one Blitz, Porofessor and similar tools use. It
never picks, bans, or clicks anything for you — every decision stays yours. Riot tolerates read-only
LCU tools; automating gameplay actions is what breaks the rules, and this deliberately does not.

## Limits worth knowing

- **The stats come from an undocumented endpoint.** u.gg does not publish an API; these are the
  static files their own site reads, and nothing obliges them to keep the format or the URLs. If they
  change or block it, the app silently drops the stats section and falls back to Claude's own
  knowledge — it will not break, it will just get less precise. Requests are cached for 12 hours and
  only the enemy laner's file is ever fetched, so a draft costs at most one or two requests.
- **Enemy roles are inferred, not known.** Riot hides enemy assigned positions in ranked. The app now
  uses u.gg's real role distribution for all 173 champions, which is far better than guessing, but a
  flex pick can still be seated in the wrong lane. Champions it cannot place are passed to Claude
  marked "role unclear" rather than asserted. Early in the draft the inference is thin simply because
  few enemies have picked.
- **The newest champions are weakest.** Two champions on patch 16.17.1 (Locke, Zaahen) are newer than
  the curated attribute table and use derived values, and Claude may not know them well either.
