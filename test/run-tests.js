'use strict';
const assert = require('assert');
const { loadChampions } = require('../src/main/champdata');
const { parseSession, signature } = require('../src/main/draft');
const { analyzeDraft } = require('../src/main/analyze');
const { attributesFor } = require('../src/main/attributes');
const { validate } = require('../src/main/ai');
const { buildSession } = require('./fixture');
const { assignRoles, lanesFor } = require('../src/main/lanes');
const { damageConstraint, priorityBlock, statsBlock } = require('../src/main/prompt');
const ugg = require('../src/main/ugg');

let passed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  PASS  ' + label); }
  catch (e) { console.log('  FAIL  ' + label + '\n        ' + e.message); process.exitCode = 1; }
}

(async () => {
  const { champions } = await loadChampions();
  const byName = {};
  for (const id of Object.keys(champions)) byName[champions[id].name] = parseInt(id, 10);
  const id = (n) => {
    if (!byName[n]) throw new Error('unknown champion in test fixture: ' + n);
    return byName[n];
  };

  // Mock: I am Mid (cellId 3) and it is my turn to pick.
  const session = {
    localPlayerCellId: 3,
    timer: { adjustedTimeLeftInPhase: 24500, phase: 'BAN_PICK' },
    bans: {
      myTeamBans: [id('Yasuo'), id('Katarina')],
      theirTeamBans: [id('Ahri'), id('Sylas')],
    },
    myTeam: [
      { cellId: 0, assignedPosition: 'top',     championId: id('Malphite'), championPickIntent: 0 },
      { cellId: 1, assignedPosition: 'jungle',  championId: 0,              championPickIntent: 0 },
      { cellId: 2, assignedPosition: 'bottom',  championId: id('Jinx'),     championPickIntent: 0 },
      { cellId: 3, assignedPosition: 'middle',  championId: 0,              championPickIntent: id('Viktor') },
      { cellId: 4, assignedPosition: 'utility', championId: id('Leona'),    championPickIntent: 0 },
    ],
    theirTeam: [
      { cellId: 5, assignedPosition: '', championId: id('Darius'), championPickIntent: 0 },
      { cellId: 6, assignedPosition: '', championId: id('Zed'),    championPickIntent: 0 },
      { cellId: 7, assignedPosition: '', championId: 0,            championPickIntent: 0 },
      { cellId: 8, assignedPosition: '', championId: 0,            championPickIntent: 0 },
      { cellId: 9, assignedPosition: '', championId: 0,            championPickIntent: 0 },
    ],
    actions: [
      [{ actorCellId: 0, championId: id('Yasuo'), completed: true, type: 'ban', isAllyAction: true, isInProgress: false }],
      [{ actorCellId: 5, championId: id('Ahri'),  completed: true, type: 'ban', isAllyAction: false, isInProgress: false }],
      [{ actorCellId: 3, championId: id('Viktor'), completed: false, type: 'pick', isAllyAction: true, isInProgress: true }],
      // Enemy is hovering Vi but has not locked it in.
      [{ actorCellId: 7, championId: id('Vi'), completed: false, type: 'pick', isAllyAction: false, isInProgress: true }],
    ],
  };

  const state = parseSession(session);

  console.log('\nDraft state');
  check('identifies my assigned role', () => assert.strictEqual(state.myPosition, 'Mid'));
  check('detects it is my turn to pick', () => {
    assert.strictEqual(state.isMyTurn, true);
    assert.strictEqual(state.myActionType, 'pick');
  });
  check('reads the pick timer', () => assert.strictEqual(state.timeLeft, 25));

  console.log('\nLegality (the critical rule)');
  check('all 4 bans are unavailable', () => {
    for (const n of ['Yasuo', 'Katarina', 'Ahri', 'Sylas']) {
      assert.ok(state.unavailable.has(id(n)), n + ' should be banned out');
    }
  });
  check('champions already picked are unavailable', () => {
    for (const n of ['Malphite', 'Jinx', 'Leona', 'Darius', 'Zed']) {
      assert.ok(state.unavailable.has(id(n)), n + ' is taken');
    }
  });
  check('enemy hover is unavailable', () => assert.ok(state.unavailable.has(id('Vi'))));
  check('my own hover stays available', () => assert.ok(!state.unavailable.has(id('Viktor'))));
  check('unpicked champion is available', () => assert.ok(!state.unavailable.has(id('Orianna'))));

  console.log('\nComposition analysis');
  const a = analyzeDraft(state, champions);
  check('counts my hover toward my team comp', () => {
    assert.deepStrictEqual(a.ally.champions.sort(), ['Jinx', 'Leona', 'Malphite', 'Viktor'].sort());
  });
  check('AD/AP split is right (Jinx AD vs Malph/Leona/Viktor AP)', () => {
    assert.strictEqual(a.ally.ad, 1);
    assert.strictEqual(a.ally.ap, 3);
    assert.strictEqual(a.ally.adPct, 25);
  });
  check('frontline totals Malphite 2 + Leona 2 = 4', () => assert.strictEqual(a.ally.frontline, 4));
  check('flags strong frontline and engage', () => {
    assert.ok(a.ally.strengths.includes('Strong frontline'));
    assert.ok(a.ally.strengths.includes('Multiple engage tools'));
  });

  console.log('\nGap detection on a deliberately broken comp');
  const squishy = [champions[id('Zed')], champions[id('Talon')], champions[id('Master Yi')],
                   champions[id('Kha\'Zix')], champions[id('Twitch')]];
  const { analyzeTeam, findGaps } = require('../src/main/analyze');
  const t = analyzeTeam(squishy);
  const f = findGaps(t);
  check('all-AD comp is flagged', () => assert.ok(f.gaps.some((g) => g.includes('% AD'))));
  check('no-frontline comp is flagged', () => assert.ok(f.gaps.some((g) => g.includes('frontline'))));
  check('no-engage comp is flagged', () => assert.ok(f.gaps.some((g) => g.includes('engage'))));

  console.log('\nAttributes sanity');
  check('Ornn reads as a tank', () => {
    const o = attributesFor(champions[id('Ornn')]);
    assert.strictEqual(o.frontline, 2);
    assert.strictEqual(o.damage, 'AP');
  });

  console.log('');
  console.log('Recommendation filtering (champion already taken)');
  // Forge a reply suggesting champions taken by each team, plus a ban and one legal pick.
  const forged = {
    picks: [
      { champ: 'Malphite', score: 95 },   // locked by MY team
      { champ: 'Zed',      score: 93 },   // locked by the ENEMY team
      { champ: 'Leona',    score: 91 },   // locked by an ally
      { champ: 'Darius',   score: 90 },   // locked by an enemy
      { champ: 'Yasuo',    score: 89 },   // banned
      { champ: 'Orianna',  score: 88 },   // legal
    ],
    avoid: [],
  };
  const g = validate(forged, state, champions);
  const surfaced = g.picks.map((p) => p.champ);
  const blocked = g.rejected.map((p) => p.champ);

  check('champion picked by MY team is not recommended', () =>
    assert.ok(!surfaced.includes('Malphite') && blocked.includes('Malphite')));
  check('champion picked by ENEMY team is not recommended', () =>
    assert.ok(!surfaced.includes('Zed') && blocked.includes('Zed')));
  check('every taken champion on both teams is filtered', () => {
    for (const n of ['Malphite', 'Zed', 'Leona', 'Darius']) {
      assert.ok(!surfaced.includes(n), n + ' is already picked and must not be recommended');
    }
  });
  check('banned champion is still filtered', () =>
    assert.ok(!surfaced.includes('Yasuo') && blocked.includes('Yasuo')));
  check('only the legal champion survives', () =>
    assert.deepStrictEqual(surfaced, ['Orianna']));
  check('a hallucinated champion name is filtered', () => {
    const h = validate({ picks: [{ champ: 'Notachampion' }] }, state, champions);
    assert.strictEqual(h.picks.length, 0);
    assert.ok(h.rejected[0].unknown);
  });

  console.log('');
  console.log('Re-analysis triggers (the bug: hovering restarted the analysis)');
  const base = buildSession(id);
  const sigBase = signature(parseSession(base));

  check('hovering a champion myself does NOT trigger re-analysis', () => {
    const hovering = buildSession(id);
    hovering.myTeam[3].championPickIntent = id('Vayne');
    assert.strictEqual(signature(parseSession(hovering)), sigBase);
  });
  check('changing my own hover again still does NOT re-trigger', () => {
    const a = buildSession(id); a.myTeam[3].championPickIntent = id('Vayne');
    const b = buildSession(id); b.myTeam[3].championPickIntent = id('Riven');
    assert.strictEqual(signature(parseSession(a)), signature(parseSession(b)));
  });
  check('an ALLY hovering DOES trigger re-analysis', () => {
    const ally = buildSession(id);
    ally.myTeam[1].championPickIntent = id('Vi');
    assert.notStrictEqual(signature(parseSession(ally)), sigBase);
  });
  check('an enemy locking a champion DOES trigger re-analysis', () => {
    const enemy = buildSession(id);
    enemy.theirTeam[2].championId = id('Nidalee');
    assert.notStrictEqual(signature(parseSession(enemy)), sigBase);
  });
  check('a new ban DOES trigger re-analysis', () => {
    const banned = buildSession(id);
    banned.bans.myTeamBans = banned.bans.myTeamBans.concat([id('Vayne')]);
    assert.notStrictEqual(signature(parseSession(banned)), sigBase);
  });

  console.log('');
  console.log('Lane inference');
  check('Teemo is read as a toplaner', () =>
    assert.deepStrictEqual(lanesFor('Teemo'), ['Top']));
  check('a full enemy team is assigned sensible roles', () => {
    const { assigned } = assignRoles(['Teemo', 'Lee Sin', 'Ahri', 'Jinx', 'Thresh']);
    assert.strictEqual(assigned.Top, 'Teemo');
    assert.strictEqual(assigned.Jungle, 'Lee Sin');
    assert.strictEqual(assigned.Bot, 'Jinx');
    assert.strictEqual(assigned.Support, 'Thresh');
  });
  check('single-lane champions are seated before flexible ones', () => {
    // Gragas can go top/jungle/mid; Teemo cannot, so Teemo must take Top.
    const { assigned } = assignRoles(['Gragas', 'Teemo']);
    assert.strictEqual(assigned.Top, 'Teemo');
  });

  console.log('');
  console.log('Draft-position weighting');
  check('all-AD comp on the last pick forces an AP requirement', () => {
    const c = damageConstraint({ picked: 4, adPct: 100, apPct: 0 }, 1);
    assert.ok(c && c.includes('AP (magic)'), 'constraint should demand AP');
    assert.ok(c.includes('ONLY if'), 'constraint should allow a decisive lane exception');
  });
  check('all-AP comp on the last pick forces an AD requirement', () => {
    const c = damageConstraint({ picked: 4, adPct: 0, apPct: 100 }, 1);
    assert.ok(c && c.includes('AD (physical)'));
  });
  check('a balanced comp triggers no damage constraint', () =>
    assert.strictEqual(damageConstraint({ picked: 4, adPct: 50, apPct: 50 }, 1), null));
  check('skew early in the draft is not yet a constraint', () =>
    assert.strictEqual(damageConstraint({ picked: 4, adPct: 100, apPct: 0 }, 4), null));

  check('last pick weighs composition first', () => {
    const t = priorityBlock({ isLastPick: true, opponent: 'Teemo', alliesAfter: 0 });
    assert.ok(t.indexOf('1. TEAM COMPOSITION') !== -1);
    assert.ok(t.indexOf('1. TEAM COMPOSITION') < t.indexOf('2. LANE'));
  });
  check('known lane opponent mid-draft weighs the lane first', () => {
    const t = priorityBlock({ isLastPick: false, opponent: 'Teemo', alliesAfter: 2 });
    assert.ok(t.indexOf('1. LANE') !== -1);
    assert.ok(t.indexOf('1. LANE') < t.indexOf('2. TEAM COMPOSITION'));
    assert.ok(t.includes('Teemo'));
  });
  check('unknown opponent weighs safety first', () => {
    const t = priorityBlock({ isLastPick: false, opponent: null, alliesAfter: 3 });
    assert.ok(t.includes('1. SAFETY'));
  });

  console.log('');
  console.log('u.gg stats parsing (offline)');
  check('ddragon version maps to a u.gg patch key', () => {
    assert.strictEqual(ugg.patchKey('16.17.1'), '16_17');
    assert.strictEqual(ugg.patchKey('9.3.1'), '9_3');
    assert.strictEqual(ugg.patchKey('garbage'), null);
  });
  check('previous patch is derived for fallback', () => {
    assert.strictEqual(ugg.previousPatch('16_17'), '16_16');
    assert.strictEqual(ugg.previousPatch('16_1'), null);
  });
  check('the largest-sample bucket is chosen, not a hardcoded tier', () => {
    // [region][tier][role] = [rows, timestamp]; rows are [oppId, wins, games].
    const payload = {
      1: { 8: { 4: [[[1, 5, 10], [2, 5, 10]], 'ts-small'] } },
      12: { 8: { 4: [[[1, 600, 1000], [2, 400, 1000]], 'ts-big'] } },
    };
    const b = ugg.largestBucket(payload, 4);
    assert.strictEqual(b.games, 2000);
    assert.strictEqual(b.asOf, 'ts-big');
  });
  check('a role with no data yields no bucket', () =>
    assert.strictEqual(ugg.largestBucket({ 1: { 8: { 4: [[[1, 1, 1]], 't'] } } }, 2), null));

  const matchups = {
    against: [
      { championId: 10, games: 9000, winRate: 56.0 },
      { championId: 11, games: 8000, winRate: 52.0 },
      { championId: 12, games: 100,  winRate: 71.0 },   // too few games to trust
      { championId: 13, games: 7000, winRate: 44.0 },
    ],
  };
  check('counters are ordered best first', () => {
    const r = ugg.rankCounters(matchups, { minGames: 1500 });
    assert.deepStrictEqual(r.map((x) => x.championId), [10, 11]);
  });
  check('a champion that loses the matchup is not called a counter', () => {
    const r = ugg.rankCounters(matchups, { minGames: 1500 });
    assert.ok(!r.some((x) => x.championId === 13), '44% is not a counter');
  });
  check('the losing side is reported separately', () => {
    const v = ugg.rankVictims(matchups, { minGames: 1500 });
    assert.deepStrictEqual(v.map((x) => x.championId), [13]);
  });
  check('no counters at all yields an empty list, not a losing one', () => {
    const allLosing = { against: [{ championId: 9, games: 9000, winRate: 41.0 }] };
    assert.deepStrictEqual(ugg.rankCounters(allLosing, { minGames: 1500 }), []);
  });
  check('small samples are excluded however good they look', () => {
    const r = ugg.rankCounters(matchups, { minGames: 1500 });
    assert.ok(!r.some((x) => x.championId === 12), '71% over 100 games must be dropped');
  });
  check('win rate lookup finds a specific matchup', () => {
    assert.strictEqual(ugg.winRateAgainst(matchups, 11).winRate, 52.0);
    assert.strictEqual(ugg.winRateAgainst(matchups, 999), null);
  });
  check('missing stats degrade to no stats section', () => {
    assert.strictEqual(statsBlock(null, 'Top'), null);
    assert.strictEqual(statsBlock({ counters: [] }, 'Top'), null);
  });
  check('stats section names winners and losers explicitly', () => {
    const t = statsBlock({
      opponent: 'Teemo', totalGames: 502729, asOf: '2026-09-03T00:00:00Z',
      counters: [{ name: 'Vayne', winRate: 62.7, games: 7374 }],
      losers: [{ name: 'Malphite', winRate: 48.1, games: 29367 }],
    }, 'Top');
    assert.ok(t.includes('BEATS TEEMO'));
    assert.ok(t.includes('Vayne 62.7%'));
    assert.ok(t.includes('LOSES TO TEEMO'));
    assert.ok(t.includes('Malphite 48.1%'));
    assert.ok(t.includes('Statistics outrank intuition'));
  });

  console.log('');
  console.log('Reported draft: enemy Jinx / Neeko / Kled, me on Top');
  check('Kled is identified as the Top opponent, not a flex pick', () => {
    const { assigned } = assignRoles(['Jinx', 'Neeko', 'Kled']);
    assert.strictEqual(assigned.Top, 'Kled');
  });
  check('Neeko does not steal Top from a dedicated toplaner', () => {
    const { assigned } = assignRoles(['Jinx', 'Neeko', 'Kled']);
    assert.notStrictEqual(assigned.Top, 'Neeko');
    assert.strictEqual(assigned.Bot, 'Jinx');
  });
  check('order of enemy picks does not change the assignment', () => {
    const a = assignRoles(['Kled', 'Neeko', 'Jinx']).assigned;
    const b = assignRoles(['Neeko', 'Jinx', 'Kled']).assigned;
    assert.strictEqual(a.Top, 'Kled');
    assert.strictEqual(b.Top, 'Kled');
  });

  check('a champion is seated in its main lane, not its first-listed one', () => {
    // Zed appears under both Jungle and Mid in the local table; Mid is the lane
    // that matters, and this is what left Mid with no opponent in a live draft.
    const ranked = (n) => ({ Zed: ['Mid', 'Jungle'], Darius: ['Top'] }[n] || []);
    const { assigned } = assignRoles(['Darius', 'Zed'], ranked);
    assert.strictEqual(assigned.Mid, 'Zed');
    assert.strictEqual(assigned.Top, 'Darius');
  });

  console.log('');
  console.log('Build parsing (offline)');
  // Item metadata as champdata exposes it: gold cost plus category flags.
  const meta = {
    '2003': { gold: 50, consumable: true, boots: false, trinket: false },   // Health Potion
    '3047': { gold: 1100, consumable: false, boots: true, trinket: false }, // Plated Steelcaps
    '3075': { gold: 2700, consumable: false, boots: false, trinket: false },// Thornmail
    '6333': { gold: 3300, consumable: false, boots: false, trinket: false },// Death's Dance
    '1055': { gold: 450, consumable: false, boots: false, trinket: false }, // Doran's Blade
  };
  const isRealItem = (id) => {
    const m = meta[String(id)];
    return !!m && !m.consumable && !m.trinket && !m.boots && m.gold >= 1600;
  };

  check('consumables never count as a core item', () => {
    // Health Potion has the most games but must not be picked.
    const top = ugg.pickTop([[2003, 500, 1000], [6333, 100, 200]], { isRealItem });
    assert.strictEqual(top.id, 6333);
  });
  check('boots and cheap components are excluded from core', () => {
    const top = ugg.pickTop([[3047, 900, 1000], [1055, 800, 900], [3075, 50, 100]], { isRealItem });
    assert.strictEqual(top.id, 3075, 'only Thornmail is a real core item here');
  });
  check('an item already bought is not repeated in a later slot', () => {
    const taken = new Set([3075]);
    const top = ugg.pickTop([[3075, 900, 1000], [6333, 100, 200]], { isRealItem, taken });
    assert.strictEqual(top.id, 6333, 'Thresh must not build Thornmail twice');
  });
  check('the most played option wins within a slot', () => {
    const top = ugg.pickTop([[6333, 60, 100], [3075, 400, 900]], { isRealItem });
    assert.strictEqual(top.id, 3075);
  });
  check('win rate is computed from wins over games', () => {
    const top = ugg.pickTop([[6333, 565, 1000]], { isRealItem });
    assert.strictEqual(top.winRate, 56.5);
  });
  check('a slot with nothing usable yields null', () =>
    assert.strictEqual(ugg.pickTop([[2003, 900, 1000]], { isRealItem }), null));

  console.log('');
  console.log('Counter ranking is confidence-adjusted');
  check('a lucky thin sample cannot outrank a well-evidenced one', () => {
    const thin = ugg.wilsonLowerBound(145, 250);     // 58.0% over 250 games
    const thick = ugg.wilsonLowerBound(5400, 10000); // 54.0% over 10k games
    assert.ok(thick > thin, '54% over 10k should outrank 58% over 250');
  });
  check('a solid sample is still allowed to win on merit', () => {
    // 56% over 1.6k games is real evidence, not noise - it should lead.
    const solid = ugg.wilsonLowerBound(896, 1600);
    const thick = ugg.wilsonLowerBound(5400, 10000);
    assert.ok(solid > thick, 'the adjustment must not simply favour the biggest sample');
  });
  check('more evidence at the same rate ranks higher', () => {
    assert.ok(ugg.wilsonLowerBound(5400, 10000) > ugg.wilsonLowerBound(540, 1000));
  });
  check('the confidence floor sits below the raw rate', () => {
    const floor = ugg.wilsonLowerBound(560, 1000);
    assert.ok(floor < 56 && floor > 45, 'got ' + floor);
  });
  check('an empty sample scores zero rather than dividing by zero', () =>
    assert.strictEqual(ugg.wilsonLowerBound(0, 0), 0));
  check('ranking still reports the raw win rate for display', () => {
    const ranked = ugg.rankCounters({
      against: [
        { championId: 1, games: 10000, wins: 5400, winRate: 54.0 },
        { championId: 2, games: 250, wins: 145, winRate: 58.0 },
      ],
    }, { minGames: 0 });
    assert.strictEqual(ranked[0].championId, 1, 'the 10k-game entry should lead the 250-game one');
    assert.strictEqual(ranked[0].winRate, 54.0, 'display value stays the raw rate');
    assert.ok(ranked[0].confidence < ranked[0].winRate);
  });

  console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
})().catch((e) => { console.error('TEST HARNESS ERROR:', e); process.exit(1); });
