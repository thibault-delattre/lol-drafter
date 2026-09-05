// Reproduces the reported ban phase: hovering Vayne top, allies Miss Fortune + Alistar.
const { app } = require('electron');
const { loadChampions } = require('../src/main/champdata');
const { parseSession } = require('../src/main/draft');
const { analyzeDraft } = require('../src/main/analyze');
const { buildPrompt, inferEnemyRoles } = require('../src/main/prompt');
const { lanesFor } = require('../src/main/lanes');
const { Analyzer, extractJson, validate } = require('../src/main/ai');
const ugg = require('../src/main/ugg');

app.whenReady().then(async () => {
  const { champions, version } = await loadChampions();
  const byName = {};
  for (const k of Object.keys(champions)) byName[champions[k].name] = parseInt(k, 10);
  const uggRoles = await ugg.loadPrimaryRoles(version);
  const lookup = (n) => { const r = uggRoles && uggRoles[byName[n]]; return r && r.length ? r : lanesFor(n); };

  const session = {
    localPlayerCellId: 0,
    timer: { adjustedTimeLeftInPhase: 25000, phase: 'BAN_PICK' },
    bans: { myTeamBans: [], theirTeamBans: [] },
    myTeam: [
      { cellId: 0, assignedPosition: 'top',     championId: 0, championPickIntent: byName.Vayne },
      { cellId: 1, assignedPosition: 'jungle',  championId: 0, championPickIntent: 0 },
      { cellId: 2, assignedPosition: 'middle',  championId: 0, championPickIntent: 0 },
      { cellId: 3, assignedPosition: 'bottom',  championId: byName['Miss Fortune'], championPickIntent: 0 },
      { cellId: 4, assignedPosition: 'utility', championId: byName.Alistar, championPickIntent: 0 },
    ],
    theirTeam: [0, 1, 2, 3, 4].map((i) => ({ cellId: 5 + i, assignedPosition: '', championId: 0, championPickIntent: 0 })),
    actions: [[{ actorCellId: 0, championId: 0, completed: false, type: 'ban', isAllyAction: true, isInProgress: true }]],
  };

  const state = parseSession(session);
  const analysis = analyzeDraft(state, champions);
  const roles = inferEnemyRoles(state, champions, lookup);
  const mine = state.me.championId || state.me.hoveredId;

  const stats = await ugg.buildLaneStats({
    opponentId: mine, opponentName: champions[mine].name, mode: 'ban',
    role: state.myPosition, patch: version, champions, unavailable: state.unavailable,
  });

  console.log('action           : ' + state.myActionType.toUpperCase());
  console.log('I intend to play : ' + champions[mine].name + ' ' + state.myPosition);
  console.log('my allies        : Miss Fortune (bot), Alistar (support)');
  console.log('stats supplied   : ' + (stats ? 'YES - threats to ' + stats.opponent : 'NO'));
  if (stats) {
    console.log('  beats Vayne  : ' + stats.counters.slice(0, 6).map((c) => c.name + ' ' + c.winRate + '%').join(', '));
    console.log('  loses to Vayne: ' + stats.losers.slice(0, 4).map((c) => c.name + ' ' + c.winRate + '%').join(', '));
  }

  const prompt = buildPrompt(state, analysis, champions, { patch: version, stats, enemyRoles: roles, lanesLookup: lookup });
  console.log('\n--- live Claude call ---');
  const raw = await new Analyzer({ model: 'sonnet' }).run(prompt, {});
  const result = validate(extractJson(raw), state, champions);
  console.log('READ: ' + result.read);
  for (const p of result.picks) {
    const wr = ugg.winRateAgainst(stats.matchups, p.championId);
    console.log(`\n  BAN ${p.champ} (${p.score})` + (wr ? `  -> ${wr.winRate}% vs Vayne (${wr.games.toLocaleString()} games)` : '  (no matchup sample)'));
    console.log(`     lane: ${p.lane}`);
    console.log(`     fit : ${p.fit}`);
  }
  app.exit(0);
});
